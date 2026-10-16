from __future__ import annotations

import base64
import calendar
import csv
import hashlib
import hmac
import io
import json
import math
import os
import re
import threading
import time
import unicodedata
import uuid
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Dict, List, Optional
from urllib.parse import parse_qsl, quote, urlencode, urlparse, urlunparse
from zoneinfo import ZoneInfo

import httpx
from openpyxl import load_workbook
import psycopg
from cryptography.fernet import Fernet, InvalidToken
from fastapi import Depends, FastAPI, Header, HTTPException
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool
from pydantic import BaseModel, Field

from journal import journal_canonical_data, normalize_misa_journal_row
from report_engine import (
    ReportEngineError,
    build_output,
    note_required_offsets,
    output_to_xlsx,
    required_offsets,
    shift_year,
)
from disclosure_engine import DISCLOSURE_REPORT_KEY, build_disclosure_output, disclosure_output_to_xlsx


SCHEMA_VERSION = "accounting-runtime.v3.20-report-result-imports"

TRIAL_BALANCE_SCRIPT_SUMMARY = (
    " ,coalesce(sum(case when grade = 1 then opening_debit_amount else 0 end), 0) as opening_debit_amount"
    ",coalesce(sum(case when grade = 1 then opening_credit_amount else 0 end), 0) as opening_credit_amount"
    ",coalesce(sum(case when grade = 1 then debit_amount else 0 end), 0) as debit_amount"
    ",coalesce(sum(case when grade = 1 then credit_amount else 0 end), 0) as credit_amount"
    ",coalesce(sum(case when grade = 1 then accum_debit_amount else 0 end), 0) as accum_debit_amount"
    ",coalesce(sum(case when grade = 1 then accum_credit_amount else 0 end), 0) as accum_credit_amount"
    ",coalesce(sum(case when grade = 1 then closing_debit_amount else 0 end), 0) as closing_debit_amount"
    ",coalesce(sum(case when grade = 1 then closing_credit_amount else 0 end), 0) as closing_credit_amount "
)
DATABASE_URL = os.getenv("ACCOUNTING_DATABASE_URL", "").strip()
WORKER_SECRET = os.getenv("ACCOUNTING_WORKER_SECRET", "").strip()
SCHEMA = os.getenv("ACCOUNTING_SCHEMA", "accounting_runtime").strip()
CONFIG_SCHEMA = os.getenv("ACCOUNTING_CONFIG_SCHEMA", "accounting_portal").strip()
ENVIRONMENT = os.getenv("ACCOUNTING_ENVIRONMENT", "development").strip().lower()
PAGE_BATCH = max(1, min(200, int(os.getenv("ACCOUNTING_PAGE_BATCH", "30"))))
SLICE_SECONDS = max(10, min(240, int(os.getenv("ACCOUNTING_SLICE_SECONDS", "40"))))
REQUEST_TIMEOUT = max(10, min(180, int(os.getenv("ACCOUNTING_REQUEST_TIMEOUT", "60"))))
MAX_PAGE_SIZE = max(100, min(5000, int(os.getenv("ACCOUNTING_MAX_PAGE_SIZE", "1000"))))
MAX_REPORT_ROWS = max(1000, min(500000, int(os.getenv("ACCOUNTING_MAX_REPORT_ROWS", "100000"))))
MAX_EXPORT_BYTES = max(1_000_000, min(100_000_000, int(os.getenv("ACCOUNTING_MAX_EXPORT_BYTES", "25000000"))))
DB_POOL_MAX = max(1, min(30, int(os.getenv("ACCOUNTING_DB_POOL_MAX", "6"))))
AUTORUN_ENABLED = os.getenv("ACCOUNTING_AUTORUN", "false").strip().lower() in {"1", "true", "yes", "on"}
MISA_BOOTSTRAP_TENANT_ID = os.getenv("ACCOUNTING_MISA_BOOTSTRAP_TENANT_ID", "").strip()
MISA_BOOTSTRAP_TENANT_CODE = os.getenv("ACCOUNTING_MISA_BOOTSTRAP_TENANT_CODE", "").strip()
MISA_BOOTSTRAP_DATABASE_ID = os.getenv("ACCOUNTING_MISA_BOOTSTRAP_DATABASE_ID", "").strip()
MISA_BOOTSTRAP_BRANCH_ID = os.getenv("ACCOUNTING_MISA_BOOTSTRAP_BRANCH_ID", "").strip()
MISA_BOOTSTRAP_COMPANY_KEY = os.getenv("ACCOUNTING_MISA_BOOTSTRAP_COMPANY_KEY", "").strip()
MISA_BOOTSTRAP_CONTEXTS = os.getenv("ACCOUNTING_MISA_BOOTSTRAP_CONTEXTS", "").strip()
LOCAL_TZ = ZoneInfo("Asia/Ho_Chi_Minh")

for schema_name, variable_name in (
    (SCHEMA, "ACCOUNTING_SCHEMA"),
    (CONFIG_SCHEMA, "ACCOUNTING_CONFIG_SCHEMA"),
):
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,62}", schema_name):
        raise RuntimeError(f"{variable_name} không hợp lệ")


def _psycopg_database_url(value: str) -> str:
    """Bỏ tham số chỉ Prisma hiểu khi worker dùng chung DATABASE_URL của Next.js."""
    if not value:
        return ""
    parsed = urlparse(value)
    prisma_only = {"schema", "connection_limit", "pool_timeout", "pgbouncer"}
    query = [(key, item) for key, item in parse_qsl(parsed.query, keep_blank_values=True) if key not in prisma_only]
    return urlunparse((parsed.scheme, parsed.netloc, parsed.path, parsed.params, urlencode(query), parsed.fragment))


PSYCOPG_DATABASE_URL = _psycopg_database_url(DATABASE_URL)


def _fernet() -> Fernet:
    configured = os.getenv("ACCOUNTING_CREDENTIAL_KEY", "").strip().encode("utf-8")
    if configured:
        key = configured
    else:
        if not WORKER_SECRET:
            raise RuntimeError("Thiếu ACCOUNTING_WORKER_SECRET")
        key = base64.urlsafe_b64encode(hashlib.sha256(WORKER_SECRET.encode("utf-8")).digest())
    try:
        return Fernet(key)
    except Exception as exc:
        raise RuntimeError("ACCOUNTING_CREDENTIAL_KEY phải là khóa Fernet hợp lệ") from exc


CIPHER = _fernet() if WORKER_SECRET else None
POOL: Optional[ConnectionPool] = None
AUTORUN_THREAD: Optional[threading.Thread] = None
AUTORUN_STOP = threading.Event()


class WorkerError(Exception):
    pass


class MisaAuthError(WorkerError):
    pass


class MisaTransientError(WorkerError):
    """Lỗi tạm thời từ MISA, được phép thử lại có giãn cách."""

    pass


class WorkerConfig(BaseModel):
    workerUrl: str = ""
    workerSecret: str = ""


class MisaSessionRequest(BaseModel):
    sourceKey: str
    sourceName: str = ""
    sourceType: str = "AMIS_SESSION"
    companyKey: str
    dataSpaceName: str = ""
    datasetType: str = "TRIAL_BALANCE"
    endpointUrl: str
    reportId: str = ""
    reportName: str = ""
    bearer: str
    misaContext: Any
    device: str = ""
    cookie: str = ""
    origin: str = "https://actapp.misa.vn"
    referer: str = "https://actapp.misa.vn/"
    requestBody: Dict[str, Any]
    pageSize: int = 100


class MisaBearerRefreshRequest(BaseModel):
    sourceKey: str
    bearer: str


class MisaCredentialCheckRequest(BaseModel):
    sourceKey: str = ""
    force: bool = False


class MisaDataSpaceDiscoveryRequest(BaseModel):
    sourceKey: str = ""
    profileKey: str = "TRIAL_BALANCE"
    companyKey: str = ""
    bearer: str = ""


class MisaDataSpaceConnectRequest(BaseModel):
    referenceSourceKey: str = ""
    profileKey: str = "TRIAL_BALANCE"
    companyKey: str
    databaseId: str
    bearer: str = ""


class StartRunRequest(BaseModel):
    sourceKey: str
    companyKey: str
    periodFrom: date
    periodTo: date
    requestedBy: str = ""
    pageSize: int = 100
    note: str = ""


class AccountingFilePreviewRequest(BaseModel):
    fileName: str
    fileDataUrl: str
    companyKey: str
    companyLabel: str = ""
    datasetType: str = "AUTO"
    versionId: str = ""
    reportKey: str = ""
    sheetName: str = ""
    headerRow: int = 0


class AccountingFileImportRequest(AccountingFilePreviewRequest):
    periodFrom: date
    periodTo: date
    dataSpaceName: str
    targetDataSpaceKey: str = ""
    requestedBy: str = ""
    note: str = ""


class BootstrapRequest(BaseModel):
    sourceKey: str = ""
    companyKey: str = ""
    dataSpaceKey: str = ""
    period: str = ""
    reviewStatus: str = ""
    changeType: str = ""
    limit: int = 80


class TestDataSpaceTarget(BaseModel):
    companyKey: str
    dataSpaceKey: str


class TestDataSpaceCleanupPreviewRequest(BaseModel):
    targets: List[TestDataSpaceTarget] = Field(default_factory=list)


class TestDataSpaceCleanupRequest(TestDataSpaceCleanupPreviewRequest):
    confirmation: str
    previewToken: str
    requestedBy: str = ""


class ChangeReviewRequest(BaseModel):
    changeIds: List[int] = Field(default_factory=list)
    reviewStatus: str
    note: str = ""
    reviewedBy: str = ""


class ChangeExportRequest(BootstrapRequest):
    limit: int = 10000


class BalanceQueryRequest(BaseModel):
    # Khi người dùng chọn một "Phiên dữ liệu hoàn chỉnh", đây là khóa của
    # snapshot bất biến. Nếu có giá trị, Worker tuyệt đối không thay bằng
    # snapshot đang active (điều đó sẽ làm báo cáo lịch sử bị đổi số).
    snapshotIds: List[str] = Field(default_factory=list)
    # Khi true, danh sách snapshot là lựa chọn đóng. Danh sách rỗng có nghĩa
    # không có dữ liệu cho kỳ này, không được âm thầm thay bằng snapshot active.
    lockSnapshotSelection: bool = False
    sourceKeys: List[str] = Field(default_factory=list)
    companyKeys: List[str] = Field(default_factory=list)
    dataSpaceKeys: List[str] = Field(default_factory=list)
    periodFrom: date
    periodTo: date
    accountNumbers: List[str] = Field(default_factory=list)
    # Một số công thức cần đọc nội dung/số chứng từ để phân loại nghiệp vụ.
    # Bảng cộng tháng không giữ các trường này, nên tầng dựng báo cáo sẽ bật
    # cờ này khi cấu hình có điều kiện chi tiết.
    journalDetailRequired: bool = False
    limit: int = 20000


class JournalQueryRequest(BaseModel):
    sourceKeys: List[str] = Field(default_factory=list)
    companyKeys: List[str] = Field(default_factory=list)
    dataSpaceKeys: List[str] = Field(default_factory=list)
    periodFrom: date
    periodTo: date
    accountNumber: str = ""
    correspondingAccountNumber: str = ""
    referenceNo: str = ""
    search: str = ""
    page: int = 1
    pageSize: int = 100


class ReportOutputRequest(BaseModel):
    versionId: str
    reportKey: str = "DATA_CHECK"
    snapshotIds: List[str] = Field(default_factory=list)
    # Khóa snapshot riêng cho từng kỳ công thức: 0 = kỳ đang xuất, -1 = cùng kỳ
    # năm trước. Điều này ngăn báo cáo lịch sử vô tình lấy bản active mới hơn.
    snapshotIdsByOffset: Dict[str, List[str]] = Field(default_factory=dict)
    sourceKeys: List[str] = Field(default_factory=list)
    companyKeys: List[str] = Field(default_factory=list)
    dataSpaceKeys: List[str] = Field(default_factory=list)
    noteItemIds: List[str] = Field(default_factory=list)
    disclosureItemKeys: List[str] = Field(default_factory=list)
    # Bút toán chỉ được cộng khi người dùng chọn rõ ở popup xuất báo cáo.
    # Danh sách rỗng tuyệt đối không được tự lấy toàn bộ khoản đã duyệt.
    adjustmentIds: List[str] = Field(default_factory=list)
    # Kết quả BCTC import cùng công ty/khối/kỳ được dùng làm lớp số liệu khóa
    # cho các cột tương ứng (đặc biệt là kỳ trước của B09).
    includeImportedReportResults: bool = True
    includeEvidence: bool = False
    periodFrom: date
    periodTo: date


class ReportExportRequest(ReportOutputRequest):
    format: str = "XLSX"
    fileName: str = ""


class ReportAdjustmentCreateRequest(BaseModel):
    externalKey: str
    versionId: str
    reportKey: str
    rowCode: str
    columnKey: str = ""
    companyKey: str
    dataSpaceKey: str
    dataSpaceName: str = ""
    periodFrom: date
    periodTo: date
    amount: Decimal = Decimal("0")
    reason: str
    sourceReference: str
    supportingData: Dict[str, Any] = Field(default_factory=dict)
    requestedBy: str
    status: str = "DRAFT"
    supersedesAdjustmentId: str = ""


class ReportAdjustmentStatusRequest(BaseModel):
    adjustmentId: str
    status: str
    actor: str
    note: str = ""


class ReportAdjustmentListRequest(BaseModel):
    versionId: str
    reportKey: str = ""
    companyKey: str = ""
    dataSpaceKey: str = ""
    periodFrom: date | None = None
    periodTo: date | None = None
    includeVoided: bool = False


class NoteCatalogRequest(BaseModel):
    sourceKeys: List[str] = Field(default_factory=list)
    subAccountingSystem: int = 99
    ensureFresh: bool = True
    includeHidden: bool = False
    search: str = ""
    limit: int = 2000


class NoteCatalogSyncRequest(BaseModel):
    sourceKey: str
    subAccountingSystem: int = 99
    force: bool = False


def _configuration_errors() -> List[str]:
    errors: List[str] = []
    if not DATABASE_URL:
        errors.append("Thiếu ACCOUNTING_DATABASE_URL")
    elif not DATABASE_URL.startswith(("postgresql://", "postgres://")):
        errors.append("ACCOUNTING_DATABASE_URL phải là kết nối PostgreSQL")
    if not WORKER_SECRET:
        errors.append("Thiếu ACCOUNTING_WORKER_SECRET")
    elif ENVIRONMENT == "production" and len(WORKER_SECRET) < 32:
        errors.append("ACCOUNTING_WORKER_SECRET production phải có ít nhất 32 ký tự")
    if ENVIRONMENT == "production" and not os.getenv("ACCOUNTING_CREDENTIAL_KEY", "").strip():
        errors.append("Production phải cấu hình ACCOUNTING_CREDENTIAL_KEY độc lập")
    return errors


def _startup() -> None:
    global POOL, AUTORUN_THREAD
    if DATABASE_URL:
        POOL = ConnectionPool(
            conninfo=PSYCOPG_DATABASE_URL,
            min_size=0,
            max_size=DB_POOL_MAX,
            kwargs={"row_factory": dict_row},
        )
        POOL.open(wait=False)
    if AUTORUN_ENABLED and DATABASE_URL:
        AUTORUN_STOP.clear()
        AUTORUN_THREAD = threading.Thread(target=_autorun_loop, name="accounting-sync-runner", daemon=True)
        AUTORUN_THREAD.start()


def _shutdown() -> None:
    AUTORUN_STOP.set()
    if POOL:
        POOL.close()


@asynccontextmanager
async def _lifespan(_: FastAPI):
    _startup()
    try:
        yield
    finally:
        _shutdown()


app = FastAPI(
    title="Thuan Viet Accounting Data Worker",
    version=SCHEMA_VERSION,
    lifespan=_lifespan,
    docs_url=None if ENVIRONMENT == "production" else "/docs",
    redoc_url=None if ENVIRONMENT == "production" else "/redoc",
    openapi_url=None if ENVIRONMENT == "production" else "/openapi.json",
)


def _auth(
    authorization: str = Header(default=""),
    x_accounting_worker_secret: str = Header(default="", alias="X-Accounting-Worker-Secret"),
) -> None:
    if not WORKER_SECRET:
        raise HTTPException(status_code=503, detail="Worker chưa có ACCOUNTING_WORKER_SECRET")
    bearer = authorization[7:].strip() if authorization.lower().startswith("bearer ") else ""
    bearer_ok = bool(bearer) and hmac.compare_digest(bearer, WORKER_SECRET)
    header_ok = bool(x_accounting_worker_secret) and hmac.compare_digest(
        x_accounting_worker_secret,
        WORKER_SECRET,
    )
    if not (bearer_ok or header_ok):
        raise HTTPException(status_code=401, detail="Sai mã bảo vệ worker")


def _pool() -> ConnectionPool:
    if not DATABASE_URL or not POOL:
        raise HTTPException(status_code=503, detail="Worker chưa có ACCOUNTING_DATABASE_URL")
    return POOL


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _safe(value: Any) -> Any:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, dict):
        return {key: _safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_safe(item) for item in value]
    return value


def _clean_key(value: Any, label: str = "Mã") -> str:
    text = re.sub(r"[^A-Za-z0-9_.-]+", "_", str(value or "").strip()).strip("_").upper()
    if not text:
        raise HTTPException(status_code=400, detail=f"Thiếu {label}")
    return text[:160]


def _clean_name(value: Any, label: str, max_length: int = 160) -> str:
    text = re.sub(r"\s+", " ", str(value or "").strip())
    if not text:
        raise HTTPException(status_code=400, detail=f"Thiếu {label}")
    return text[:max_length]


_TEST_DATA_SPACE_MARKERS = (
    "test",
    "demo",
    "sample",
    "sandbox",
    "thu nghiem",
    "du lieu thu",
    "ban nhap",
)


def _normalized_test_label(value: Any) -> str:
    normalized = unicodedata.normalize("NFD", str(value or "").lower())
    normalized = "".join(character for character in normalized if unicodedata.category(character) != "Mn")
    normalized = normalized.replace("đ", "d")
    return re.sub(r"[^a-z0-9]+", " ", normalized).strip()


def _has_test_data_space_marker(*values: Any) -> bool:
    label = " ".join(_normalized_test_label(value) for value in values if value)
    padded = f" {label} "
    return any(f" {marker} " in padded for marker in _TEST_DATA_SPACE_MARKERS)


def _cleanup_targets(targets: List[TestDataSpaceTarget]) -> List[Dict[str, str]]:
    unique: Dict[tuple[str, str], Dict[str, str]] = {}
    for target in targets:
        company_key = _clean_key(target.companyKey, "mã công ty")
        data_space_key = _clean_key(target.dataSpaceKey, "mã khối dữ liệu")
        unique[(company_key, data_space_key)] = {
            "companyKey": company_key,
            "dataSpaceKey": data_space_key,
        }
    if not unique:
        raise HTTPException(status_code=400, detail="Hãy chọn ít nhất một khối dữ liệu thử")
    if len(unique) > 10:
        raise HTTPException(status_code=400, detail="Mỗi lần chỉ được dọn tối đa 10 khối dữ liệu thử")
    return [unique[key] for key in sorted(unique)]


_CLEANUP_COUNT_LABELS = {
    "sourceConnections": "Kết nối nguồn MISA",
    "snapshots": "Phiên dữ liệu",
    "syncRuns": "Lần cập nhật",
    "syncPages": "Trang đã tải",
    "sourceRows": "Dòng bảng cân đối tài khoản",
    "journalEntries": "Dòng sổ nhật ký chung",
    "journalMonthly": "Nhóm nhật ký theo tháng",
    "dataControls": "Kết quả kiểm tra dữ liệu",
    "activeSnapshots": "Phiên đang dùng",
    "changeEvents": "Lịch sử thay đổi số liệu",
    "noteCatalogItems": "Dòng danh mục thuyết minh",
    "noteCatalogMeta": "Lần kiểm tra thuyết minh",
    "dirtyPeriods": "Kỳ chờ cập nhật lại",
    "reportResults": "Kết quả BCTC đã import",
    "reportCaches": "Bản báo cáo tạm",
}


def _test_data_space_metadata(
    conn: psycopg.Connection,
    target: Dict[str, str],
) -> Dict[str, Any]:
    rows = conn.execute(
        f"""SELECT source_key,source_name,data_space_name,dataset_type
              FROM {SCHEMA}.accounting_source_connections
             WHERE company_key=%s AND data_space_key=%s
             ORDER BY source_name,source_key""",
        (target["companyKey"], target["dataSpaceKey"]),
    ).fetchall()
    if not rows:
        raise HTTPException(
            status_code=404,
            detail=f"Không còn khối {target['dataSpaceKey']} của công ty {target['companyKey']}",
        )
    data_space_names = sorted({str(row.get("data_space_name") or "").strip() for row in rows if row.get("data_space_name")})
    source_names = sorted({str(row.get("source_name") or "").strip() for row in rows if row.get("source_name")})
    if not _has_test_data_space_marker(*(data_space_names + source_names + [target["dataSpaceKey"]])):
        raise HTTPException(
            status_code=409,
            detail=(
                f"Khối {data_space_names[0] if data_space_names else target['dataSpaceKey']} "
                "không có nhãn Test/Demo/Nháp nên hệ thống chặn xóa tại màn hình dọn dữ liệu thử"
            ),
        )
    return {
        **target,
        "dataSpaceName": data_space_names[0] if data_space_names else target["dataSpaceKey"],
        "dataSpaceNames": data_space_names,
        "sourceNames": source_names,
        "sourceKeys": [str(row["source_key"]) for row in rows],
        "datasetTypes": sorted({str(row.get("dataset_type") or "") for row in rows if row.get("dataset_type")}),
    }


def _test_data_space_counts(
    conn: psycopg.Connection,
    target: Dict[str, str],
) -> Dict[str, Any]:
    company_key = target["companyKey"]
    data_space_key = target["dataSpaceKey"]
    row = conn.execute(
        f"""SELECT
          (SELECT count(*) FROM {SCHEMA}.accounting_source_connections WHERE company_key=%s AND data_space_key=%s) AS source_connections,
          (SELECT count(*) FROM {SCHEMA}.accounting_snapshots WHERE company_key=%s AND data_space_key=%s) AS snapshots,
          (SELECT count(*) FROM {SCHEMA}.accounting_sync_runs WHERE company_key=%s AND data_space_key=%s) AS sync_runs,
          (SELECT count(*) FROM {SCHEMA}.accounting_sync_pages p WHERE p.run_id IN (
              SELECT run_id FROM {SCHEMA}.accounting_sync_runs WHERE company_key=%s AND data_space_key=%s)) AS sync_pages,
          (SELECT count(*) FROM {SCHEMA}.accounting_source_rows WHERE company_key=%s AND data_space_key=%s) AS source_rows,
          (SELECT count(*) FROM {SCHEMA}.accounting_journal_entries WHERE company_key=%s AND data_space_key=%s) AS journal_entries,
          (SELECT count(*) FROM {SCHEMA}.accounting_journal_monthly WHERE company_key=%s AND data_space_key=%s) AS journal_monthly,
          (SELECT count(*) FROM {SCHEMA}.accounting_data_controls d WHERE d.snapshot_id IN (
              SELECT snapshot_id FROM {SCHEMA}.accounting_snapshots WHERE company_key=%s AND data_space_key=%s)) AS data_controls,
          (SELECT count(*) FROM {SCHEMA}.accounting_active_snapshots WHERE company_key=%s AND data_space_key=%s) AS active_snapshots,
          (SELECT count(*) FROM {SCHEMA}.accounting_change_events WHERE company_key=%s AND data_space_key=%s) AS change_events,
          (SELECT count(*) FROM {SCHEMA}.accounting_note_catalog_items n WHERE n.source_key IN (
              SELECT source_key FROM {SCHEMA}.accounting_source_connections WHERE company_key=%s AND data_space_key=%s)) AS note_catalog_items,
          (SELECT count(*) FROM {SCHEMA}.accounting_note_catalog_meta n WHERE n.source_key IN (
              SELECT source_key FROM {SCHEMA}.accounting_source_connections WHERE company_key=%s AND data_space_key=%s)) AS note_catalog_meta,
          (SELECT count(*) FROM {SCHEMA}.accounting_dirty_periods WHERE company_key=%s AND data_space_key=%s) AS dirty_periods,
          (SELECT count(*) FROM {SCHEMA}.accounting_report_result_snapshots
             WHERE company_key=%s AND data_space_key=%s) AS report_results,
          (SELECT count(*) FROM {SCHEMA}.accounting_report_cache c WHERE EXISTS (
              SELECT 1 FROM {SCHEMA}.accounting_snapshots s
               WHERE s.company_key=%s AND s.data_space_key=%s
                 AND c.snapshot_refs::text LIKE ('%%' || s.snapshot_id::text || '%%'))) AS report_caches,
          (SELECT count(*) FROM {SCHEMA}.accounting_sync_runs
             WHERE company_key=%s AND data_space_key=%s AND status IN ('QUEUED','RUNNING','RETRY')) AS running_runs,
          (SELECT COALESCE(array_agg(snapshot_id::text ORDER BY snapshot_id::text), ARRAY[]::text[])
             FROM {SCHEMA}.accounting_snapshots WHERE company_key=%s AND data_space_key=%s) AS snapshot_ids""",
        (company_key, data_space_key) * 17,
    ).fetchone()
    raw = dict(row or {})
    counts = {
        key: int(raw.get(re.sub(r"(?<!^)(?=[A-Z])", "_", key).lower()) or 0)
        for key in _CLEANUP_COUNT_LABELS
    }
    return {
        "counts": counts,
        "runningRunCount": int(raw.get("running_runs") or 0),
        "snapshotIds": list(raw.get("snapshot_ids") or []),
    }


def _cleanup_confirmation_phrase(spaces: List[Dict[str, Any]]) -> str:
    labels = [f"{space['dataSpaceName']} [{space['companyKey']}]" for space in spaces]
    return "XÓA: " + " | ".join(labels)


def _secure_text_equal(left: Any, right: Any) -> bool:
    return hmac.compare_digest(
        str(left or "").encode("utf-8"),
        str(right or "").encode("utf-8"),
    )


def _test_data_space_cleanup_preview(
    conn: psycopg.Connection,
    targets: List[TestDataSpaceTarget],
) -> Dict[str, Any]:
    normalized_targets = _cleanup_targets(targets)
    spaces: List[Dict[str, Any]] = []
    totals = {key: 0 for key in _CLEANUP_COUNT_LABELS}
    token_payload: List[Dict[str, Any]] = []
    for target in normalized_targets:
        metadata = _test_data_space_metadata(conn, target)
        detail = _test_data_space_counts(conn, target)
        counts = detail["counts"]
        for key, value in counts.items():
            totals[key] += value
        public_space = {
            key: value for key, value in metadata.items() if key != "sourceKeys"
        }
        public_space.update({
            "counts": counts,
            "runningRunCount": detail["runningRunCount"],
            "recordCount": sum(counts.values()),
        })
        spaces.append(public_space)
        token_payload.append({
            "companyKey": metadata["companyKey"],
            "dataSpaceKey": metadata["dataSpaceKey"],
            "sourceKeys": metadata["sourceKeys"],
            "snapshotIds": detail["snapshotIds"],
            "counts": counts,
            "runningRunCount": detail["runningRunCount"],
        })
    preview_token = hashlib.sha256(
        json.dumps(token_payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    return {
        "ok": True,
        "spaces": spaces,
        "totals": totals,
        "countLabels": _CLEANUP_COUNT_LABELS,
        "recordCount": sum(totals.values()),
        "runningRunCount": sum(int(space["runningRunCount"]) for space in spaces),
        "confirmationPhrase": _cleanup_confirmation_phrase(spaces),
        "previewToken": preview_token,
    }


def _context_value(context: Dict[str, Any], key: str, default: Any = "") -> Any:
    expected = key.lower()
    for current_key, value in context.items():
        if str(current_key).lower() == expected:
            return value
    return default


def _misa_context(value: Any) -> tuple[Dict[str, Any], str]:
    if isinstance(value, dict):
        context = value
    else:
        text = str(value or "").strip()
        try:
            context = json.loads(text)
        except (TypeError, ValueError, json.JSONDecodeError) as exc:
            raise HTTPException(status_code=400, detail="X-MISA-Context phải là một khối JSON hợp lệ") from exc
    if not isinstance(context, dict) or not context:
        raise HTTPException(status_code=400, detail="Thiếu X-MISA-Context")
    return context, json.dumps(context, ensure_ascii=False, separators=(",", ":"))


def _misa_data_space(context: Dict[str, Any], endpoint_url: str) -> tuple[str, Dict[str, Any]]:
    database_id = str(_context_value(context, "DatabaseId") or "").strip()
    tenant_id = str(_context_value(context, "TenantId") or "").strip()
    if not database_id:
        raise HTTPException(
            status_code=400,
            detail="X-MISA-Context không có DatabaseId nên chưa xác định được khối dữ liệu MISA",
        )
    parsed = urlparse(endpoint_url)
    path_parts = [part for part in parsed.path.split("/") if part]
    identity = {
        "tenantId": tenant_id,
        "databaseId": database_id,
        "workingBook": _context_value(context, "WorkingBook", 0),
        "dbType": _context_value(context, "DBType", ""),
        "environment": path_parts[0] if path_parts else "",
    }
    canonical = json.dumps(identity, ensure_ascii=False, sort_keys=True, default=str, separators=(",", ":"))
    fingerprint = hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:24].upper()
    return f"MISA_{fingerprint}", identity


def _connection_source_key(base_source_key: str, company_key: str, data_space_key: str) -> str:
    suffix = hashlib.sha256(
        f"{base_source_key}|{company_key}|{data_space_key}".encode("utf-8")
    ).hexdigest()[:16].upper()
    base = base_source_key[: max(1, 160 - len(suffix) - 2)]
    return f"{base}__{suffix}"


def _compatible_data_space_key(
    conn: psycopg.Connection,
    company_key: str,
    identity: Dict[str, Any],
    proposed_key: str,
) -> str:
    """Reuse a logical MISA data space when MISA moves it between g1/g2.

    The environment segment identifies MISA infrastructure, not the accounting
    database. Tenant, database, working book and database type are the stable
    identity that report sources must share.
    """
    row = conn.execute(
        f"""SELECT c.data_space_key
              FROM {SCHEMA}.accounting_source_connections c
              LEFT JOIN {SCHEMA}.accounting_snapshots s
                ON s.company_key=c.company_key
               AND s.data_space_key=c.data_space_key
             WHERE c.company_key=%s
               AND COALESCE(c.data_space_identity->>'tenantId','')=%s
               AND COALESCE(c.data_space_identity->>'databaseId','')=%s
               AND COALESCE(c.data_space_identity->>'workingBook','')=%s
               AND COALESCE(c.data_space_identity->>'dbType','')=%s
             GROUP BY c.data_space_key, c.created_at
             ORDER BY count(s.snapshot_id) DESC, c.created_at ASC
             LIMIT 1""",
        (
            company_key,
            str(identity.get("tenantId") or ""),
            str(identity.get("databaseId") or ""),
            str(identity.get("workingBook") if identity.get("workingBook") is not None else ""),
            str(identity.get("dbType") if identity.get("dbType") is not None else ""),
        ),
    ).fetchone()
    return str(row["data_space_key"]) if row else proposed_key


def _allowed_misa_url(url: str) -> str:
    parsed = urlparse(str(url or "").strip())
    hostname = (parsed.hostname or "").lower()
    try:
        port = parsed.port
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Cổng endpoint MISA không hợp lệ") from exc
    if (
        parsed.scheme != "https"
        or not (hostname == "misa.vn" or hostname.endswith(".misa.vn"))
        or parsed.username
        or parsed.password
        or port not in (None, 443)
        or parsed.fragment
    ):
        raise HTTPException(status_code=400, detail="Chỉ cho phép endpoint HTTPS thuộc miền misa.vn")
    return parsed.geturl()


def _misa_api_url(endpoint_url: str, api_path: str, environment: str = "") -> str:
    parsed = urlparse(_allowed_misa_url(endpoint_url))
    path_parts = [part for part in parsed.path.split("/") if part]
    current_environment = path_parts[0] if path_parts else "g1"
    selected_environment = re.sub(r"[^A-Za-z0-9_-]+", "", str(environment or current_environment).strip()) or "g1"
    path = f"/{selected_environment}/{str(api_path or '').lstrip('/')}"
    return _allowed_misa_url(urlunparse((parsed.scheme, parsed.netloc, path, "", "", "")))


def _misa_endpoint_environment(endpoint_url: str, environment: str) -> str:
    parsed = urlparse(_allowed_misa_url(endpoint_url))
    path_parts = [part for part in parsed.path.split("/") if part]
    selected_environment = re.sub(r"[^A-Za-z0-9_-]+", "", str(environment or "").strip())
    if selected_environment:
        if path_parts:
            path_parts[0] = selected_environment
        else:
            path_parts.append(selected_environment)
    return _allowed_misa_url(urlunparse((parsed.scheme, parsed.netloc, "/" + "/".join(path_parts), "", parsed.query, "")))


def _misa_failure_detail(payload: Dict[str, Any]) -> tuple[int, str, bool]:
    """Đọc lỗi MISA mà không làm lộ context/thiết bị trong payload kỹ thuật."""
    try:
        failure_code = int(payload.get("Code"))
    except (TypeError, ValueError):
        failure_code = -1

    raw_messages = payload.get("ErrorsMessage") or []
    if isinstance(raw_messages, (str, dict)):
        raw_messages = [raw_messages]
    readable_messages: List[str] = []
    for message in raw_messages if isinstance(raw_messages, list) else []:
        if isinstance(message, str) and message.strip():
            readable_messages.append(message.strip())
            continue
        if not isinstance(message, dict):
            continue
        for key in ("Message", "message", "ErrorMessage", "errorMessage", "Reason", "reason"):
            value = message.get(key)
            if isinstance(value, str) and value.strip():
                readable_messages.append(value.strip())
                break

    for key in ("Message", "message", "ErrorMessage", "errorMessage"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            readable_messages.append(value.strip())

    data = payload.get("Data")
    if not readable_messages and isinstance(data, str) and data.strip():
        readable_messages.append(data.strip())

    has_readable_message = bool(readable_messages)
    detail = "; ".join(dict.fromkeys(readable_messages))
    if not detail:
        detail = "MISA tạm thời chưa xử lý được yêu cầu" + (
            f" (mã {failure_code})" if failure_code >= 0 else ""
        )
    return failure_code, detail[:220], has_readable_message


def _raise_misa_payload_failure(payload: Dict[str, Any]) -> None:
    failure_code, detail, has_readable_message = _misa_failure_detail(payload)
    message = "MISA báo lỗi: " + detail
    # Phản hồi không có lời giải thích thường là lỗi phiên dựng báo cáo tạm thời,
    # không phải căn cứ để kết luận Bearer hết hạn hay dữ liệu nguồn bị hỏng.
    if not has_readable_message or failure_code in {0, 500, 502, 503, 504}:
        raise MisaTransientError(message)
    raise WorkerError(message)


def _misa_platform_request(
    method: str,
    url: str,
    credentials: Dict[str, Any],
    body: Optional[Dict[str, Any]] = None,
    allowed_failure_codes: Optional[set[int]] = None,
) -> Dict[str, Any]:
    headers = {
        "Accept": "application/json, text/plain, */*",
        "Content-Type": "application/json",
        "Authorization": "Bearer " + str(credentials.get("bearer") or ""),
        "X-MISA-Context": str(credentials.get("misaContext") or ""),
        "Origin": str(credentials.get("origin") or "https://actapp.misa.vn"),
        "Referer": str(credentials.get("referer") or "https://actapp.misa.vn/"),
    }
    if credentials.get("device"):
        headers["X-Device"] = str(credentials["device"])
    if credentials.get("cookie"):
        headers["Cookie"] = str(credentials["cookie"])
    try:
        response = httpx.request(
            method.upper(),
            _allowed_misa_url(url),
            headers=headers,
            json=body if method.upper() != "GET" else None,
            timeout=REQUEST_TIMEOUT,
        )
    except httpx.HTTPError as exc:
        raise MisaTransientError(f"Không gọi được MISA: {str(exc)[:180]}") from exc
    if response.status_code in (401, 403):
        raise MisaAuthError("Phiên MISA đã hết hạn hoặc không còn quyền truy cập")
    if response.status_code < 200 or response.status_code >= 300:
        message = f"MISA trả HTTP {response.status_code}: {response.text[:220]}"
        if response.status_code == 429 or response.status_code >= 500:
            raise MisaTransientError(message)
        raise WorkerError(message)
    try:
        payload = response.json()
    except ValueError as exc:
        raise WorkerError("MISA không trả JSON hợp lệ") from exc
    if payload.get("Success") is False:
        failure_code, _, _ = _misa_failure_detail(payload)
        if failure_code in (allowed_failure_codes or set()):
            return payload
        _raise_misa_payload_failure(payload)
    return payload


def _misa_database_context(
    source: Dict[str, Any],
    credentials: Dict[str, Any],
    database_id: str,
    user_id: str,
) -> Dict[str, Any]:
    """Lấy context của khối và tự xác nhận nhánh Code 4 của MISA.

    MISA dùng Code 4 để yêu cầu ứng dụng xác nhận tiếp tục truy cập khối dữ
    liệu/sao lưu từ môi trường hiện tại. Đây không phải lỗi Bearer. Frontend
    MISA gọi lại cùng endpoint với isContinueAccessDBBackup=true.
    """
    context_url = _misa_api_url(
        source["endpoint_url"],
        "api/auth/v1/account/database-context/"
        + quote(database_id, safe="")
        + "/"
        + quote(user_id, safe=""),
    )
    first_payload = _misa_platform_request(
        "GET",
        context_url + "?isContinueAccessDBBackup=false",
        credentials,
        allowed_failure_codes={4},
    )
    if first_payload.get("Success") is not False:
        return first_payload
    try:
        failure_code = int(first_payload.get("Code"))
    except (TypeError, ValueError):
        failure_code = -1
    if failure_code != 4 or not isinstance(first_payload.get("Data"), dict):
        raise WorkerError("MISA chưa cho phép mở khối dữ liệu đã chọn")
    return _misa_platform_request(
        "GET",
        context_url + "?isContinueAccessDBBackup=true",
        credentials,
    )


def _credentials_with_bearer(credentials: Dict[str, Any], bearer_value: str) -> Dict[str, Any]:
    result = dict(credentials)
    bearer = re.sub(r"^Bearer\s+", "", str(bearer_value or result.get("bearer") or "").strip(), flags=re.I)
    if not bearer:
        raise HTTPException(status_code=400, detail="Thiếu Bearer của phiên MISA")
    # Trường exp trong JWT chỉ là thông tin tham khảo. MISA có thể tiếp tục chấp
    # nhận phiên sau mốc này, vì vậy chỉ phản hồi 401/403 thật từ MISA mới được
    # dùng để buộc Kế toán dán Bearer mới.
    result["bearer"] = bearer
    return result


def _jwt_claims(token: str) -> Dict[str, Any]:
    """Chỉ đọc claim công khai trong JWT; quyền thật vẫn do MISA xác minh."""
    try:
        parts = re.sub(r"^Bearer\s+", "", str(token or "").strip(), flags=re.I).split(".")
        if len(parts) != 3:
            return {}
        segment = parts[1] + "=" * (-len(parts[1]) % 4)
        payload = json.loads(base64.urlsafe_b64decode(segment.encode("ascii")).decode("utf-8"))
        return payload if isinstance(payload, dict) else {}
    except Exception:
        return {}


def _trial_balance_request_template() -> Dict[str, Any]:
    """Mẫu hệ thống cho Bảng cân đối tài khoản, độc lập với dữ liệu Test/Demo."""
    fields = [
        ("account_number", 12),
        ("account_name", 12),
        ("opening_debit_amount", 2),
        ("opening_credit_amount", 2),
        ("debit_amount", 2),
        ("credit_amount", 2),
        ("accum_debit_amount", 2),
        ("accum_credit_amount", 2),
        ("closing_debit_amount", 2),
        ("closing_credit_amount", 2),
    ]
    parameters = {
        "p_branch_id": "",
        "p_include_dependent_branch": False,
        "p_from_date": "2026-01-01T00:00:00.000Z",
        "p_to_date": "2026-01-31T00:00:00.000Z",
        "p_is_similar_branch": False,
        "p_is_balance_both_side": True,
        "p_is_management_book": False,
        "p_max_account_grade": 4,
        "p_accum_date_type": 2,
        "p_language": "vi",
        "p_is_refresh": True,
        "p_session_key": "",
    }
    return {
        "parameters": _encode_parameters(parameters),
        "report_id": "QWNjdW1HTEYwMV9ETg==",
        "actionLoadReport": 1,
        "reportList": {
            "group_id": 1,
            "sort_order": 1015,
            "accounting_system": 0,
            "inv_type_id": 0,
            "report_type": 5,
            "report_style": 9,
            "inv_method": 0,
            "reftype_category": 0,
            "show_total_page_number": 0,
            "is_beta": False,
            "is_invoice": False,
            "is_system": True,
            "is_show": True,
            "is_print_line_number": False,
            "report_id": "AccumGLF01_DN",
            "function_report_name": "func_rpt_fr_get_f01_management",
            "parameter_form_name": "AccumGLF01_DNParam.vue",
            "parameter_user_control": "/AccumGLF01_DNViewer.vue",
            "report_name": "Bảng cân đối tài khoản (Mẫu quản trị)",
            "report_file": "F01Accum.mrt",
            "reftype_list": "/",
            "table_name": "fr_f01_management",
            "report_detail_id": "102",
            "is_favorite": False,
            "is_disabled": False,
            "summary_type": 2,
            "script_summary": TRIAL_BALANCE_SCRIPT_SUMMARY,
            "default_sort": ";account_number;",
            "format_print_type": 0,
            "group_summary_type": 1,
            "is_pure": True,
            "preview_image": "BẢNG CÂN ĐỐI TÀI KHOẢN ( Mẫu quản trị ).png",
            "is_tree": False,
            "sub_accounting_system": 0,
            "org_report_type": 0,
            "current_report_type": 0,
            "version": 2,
            "rp_function_name_async": "func_rpt_fr_get_f01_management_v3",
            "apply_pending_data": "[1,3]",
            "state": 0,
            "is_created_from_old_db": False,
        },
        "isViewMCP": True,
        "pageIndex": 1,
        "pageSize": 100,
        "useSp": False,
        "columns": json.dumps(
            [{"field": field, "dataformat": data_format} for field, data_format in fields],
            ensure_ascii=False,
            separators=(",", ":"),
        ),
    }


def _general_ledger_request_template() -> Dict[str, Any]:
    """Mẫu hệ thống cho Sổ nhật ký chung chuẩn của MISA AMIS Kế toán."""
    amount_fields = {
        "debit_amount",
        "credit_amount",
        "debit_amount_oc",
        "credit_amount_oc",
        "exchange_rate",
    }
    fields = [
        "posted_date",
        "refdate",
        "refno",
        "inv_date",
        "inv_no",
        "journal_memo",
        "description",
        "account_number",
        "account_name",
        "corresponding_account_number",
        "corresponding_account_name",
        "debit_amount",
        "credit_amount",
        "debit_amount_oc",
        "credit_amount_oc",
        "currency_id",
        "exchange_rate",
        "reftype",
        "reftype_name",
        "account_object_code",
        "account_object_name",
        "employee_code",
        "employee_name",
        "loan_agreement_refno",
        "lending_agreement_refno",
        "expense_item_code",
        "expense_item_name",
        "budget_item_code",
        "budget_item_name",
        "job_code",
        "job_name",
        "project_work_code",
        "project_work_name",
        "order_no",
        "pu_contract_code",
        "contract_code",
        "list_item_code",
        "list_item_name",
        "organization_unit_code",
        "organization_unit_name",
        "un_resonable_cost",
        "branch_id",
        "branch_name",
    ]
    fields.extend(f"master_custom_field{index}" for index in range(1, 11))
    fields.extend(f"custom_field{index}" for index in range(1, 11))
    parameters = {
        "p_branch_id": "",
        "p_include_dependent_branch": False,
        "p_from_date": "2026-01-01T00:00:00.000Z",
        "p_to_date": "2026-01-31T00:00:00.000Z",
        "p_is_management_book": False,
        # Tên tham số phải khớp chính xác GLGeneralDiaryParam hiện tại của MISA.
        # Hai tên cũ p_is_sum_same_entry/p_is_show_accum khiến API nhận phiên đăng
        # nhập nhưng trả Code 211 với Data=null khi bắt đầu dựng báo cáo.
        "p_is_similar_sum": False,
        "p_is_show_accum_amount": False,
        "p_is_refresh": True,
        "p_session_key": "",
    }
    return {
        "parameters": _encode_parameters(parameters),
        "report_id": base64.b64encode(b"GLGeneralDiary").decode("ascii"),
        "actionLoadReport": 1,
        "reportList": {
            "group_id": 27,
            "sort_order": 270230,
            "accounting_system": 0,
            "report_type": 5,
            "report_style": 3,
            "inv_method": 2,
            "is_beta": False,
            "is_invoice": False,
            "is_system": True,
            "is_show": True,
            "is_print_line_number": False,
            "report_id": "GLGeneralDiary",
            "function_report_name": "func_rpt_gl_general_diary_book",
            "rp_function_name_async": "func_rpt_gl_general_diary_book_v4",
            "procedure_name": "Proc_GL_GeneralDiaryBook",
            "parameter_form_name": "GLGeneralDiaryParam",
            "parameter_user_control": "/GL/GLGeneralDiaryViewer.vue",
            "report_name": "Sổ nhật ký chung",
            "reftype_list": "/",
            "form_no": "Mẫu số: S03a-DN",
            "form_no133": "Mẫu số: S03a-DNN",
            "table_name": "gl_general_diary_book",
            "report_detail_id": "2702",
            "is_favorite": False,
            "is_disabled": False,
            "summary_type": 1,
            "script_summary": (
                ",coalesce(sum(debit_amount),0) as debit_amount"
                ",coalesce(sum(credit_amount),0) as credit_amount"
                ", coalesce(sum(debit_amount_oc),0) as debit_amount_oc"
                ",coalesce(sum(credit_amount_oc),0) as credit_amount_oc"
            ),
            "default_sort": ";posted_date;",
            "format_print_type": 0,
            "group_summary_type": 1,
            "is_pure": True,
            "is_tree": False,
            "sub_accounting_system": 0,
            "org_report_type": 0,
            "current_report_type": 0,
            "version": 2,
            "state": 0,
            "is_created_from_old_db": False,
        },
        "isViewMCP": True,
        "pageIndex": 1,
        "pageSize": 100,
        "useSp": False,
        "columns": json.dumps(
            [
                {"field": field, "dataformat": 2 if field in amount_fields else 12}
                for field in fields
            ],
            ensure_ascii=False,
            separators=(",", ":"),
        ),
    }


def _misa_system_profile(profile_key: str = "TRIAL_BALANCE") -> Dict[str, Any]:
    normalized = _clean_key(profile_key or "TRIAL_BALANCE", "mẫu kỹ thuật MISA")
    if normalized == "TRIAL_BALANCE":
        return {
            "profileKey": "TRIAL_BALANCE",
            "baseSourceKey": "AMIS_TRIAL_BALANCE",
            "sourceName": "Bảng cân đối tài khoản",
            "sourceType": "AMIS_SESSION",
            "datasetType": "TRIAL_BALANCE",
            "endpointUrl": "https://actapp.misa.vn/g1/api/report/v1/report/dynamic/v2/paging_filter",
            "reportId": "AccumGLF01_DN",
            "reportName": "Bảng cân đối tài khoản (Mẫu quản trị)",
            "pageSize": 100,
            "requestBody": _trial_balance_request_template(),
        }
    if normalized in JOURNAL_DATASET_TYPES:
        return {
            "profileKey": "GENERAL_LEDGER",
            "baseSourceKey": "AMIS_GENERAL_LEDGER",
            "sourceName": "Sổ nhật ký chung",
            "sourceType": "AMIS_SESSION",
            "datasetType": "GENERAL_LEDGER",
            "endpointUrl": "https://actapp.misa.vn/g1/api/report/v1/report/dynamic/v2/paging_filter",
            "reportId": "GLGeneralDiary",
            "reportName": "Sổ nhật ký chung",
            "pageSize": 100,
            "requestBody": _general_ledger_request_template(),
        }
    raise HTTPException(status_code=400, detail="Mẫu kỹ thuật MISA chưa được hệ thống hỗ trợ")


def _misa_system_profiles() -> List[Dict[str, Any]]:
    """Các bảng vận hành luôn đi cùng một khối dữ liệu kế toán MISA."""
    return [
        _misa_system_profile("TRIAL_BALANCE"),
        _misa_system_profile("GENERAL_LEDGER"),
    ]


def _misa_bootstrap_seed(company_key: str = "") -> Dict[str, Any]:
    """Lấy khối neo kỹ thuật theo công ty để MISA chấp nhận lần gọi đầu tiên.

    Bearer của MISA không chứa TenantId/DatabaseId/BranchId. Ba giá trị này không
    phải bí mật nhưng MISA vẫn bắt buộc chúng trong X-MISA-Context trước khi trả
    danh sách dữ liệu. Sau khi công ty đã có một nguồn lưu trong PostgreSQL, hệ
    thống dùng chính nguồn đó và không còn phụ thuộc khối neo này.
    """
    configured: Dict[str, Dict[str, Any]] = {}
    if MISA_BOOTSTRAP_CONTEXTS:
        try:
            payload = json.loads(MISA_BOOTSTRAP_CONTEXTS)
        except (TypeError, ValueError, json.JSONDecodeError) as exc:
            raise HTTPException(
                status_code=503,
                detail="Cấu hình kết nối nền MISA đang sai định dạng. Hãy báo quản trị hệ thống.",
            ) from exc
        if not isinstance(payload, dict):
            raise HTTPException(
                status_code=503,
                detail="Cấu hình kết nối nền MISA đang sai định dạng. Hãy báo quản trị hệ thống.",
            )
        for key, value in payload.items():
            if isinstance(value, dict):
                configured[str(key or "").strip().upper()] = dict(value)

    fallback = {
        "TenantId": MISA_BOOTSTRAP_TENANT_ID,
        "TenantCode": MISA_BOOTSTRAP_TENANT_CODE,
        "DatabaseId": MISA_BOOTSTRAP_DATABASE_ID,
        "BranchId": MISA_BOOTSTRAP_BRANCH_ID,
    }
    if any(str(value or "").strip() for value in fallback.values()):
        fallback_key = str(MISA_BOOTSTRAP_COMPANY_KEY or "DEFAULT").strip().upper()
        configured.setdefault(fallback_key, fallback)

    selected_key = str(company_key or "").strip().upper()
    seed = configured.get(selected_key) if selected_key else None
    if not seed:
        seed = configured.get("DEFAULT") or configured.get("*")
    if not seed and not selected_key and len(configured) == 1:
        seed = next(iter(configured.values()))
    return dict(seed or {})


def _misa_bootstrap_reference(
    bearer_value: str,
    profile_key: str = "TRIAL_BALANCE",
    company_key: str = "",
) -> tuple[Dict[str, Any], Dict[str, Any], Dict[str, Any]]:
    profile = _misa_system_profile(profile_key)
    credentials = _credentials_with_bearer({}, bearer_value)
    claims = _jwt_claims(credentials["bearer"])
    user_id = str(claims.get("uid") or claims.get("UserId") or claims.get("sub") or "").strip()
    if not user_id:
        raise HTTPException(status_code=400, detail="Bearer không có mã người dùng MISA hợp lệ")
    seed = _misa_bootstrap_seed(company_key)
    tenant_id = str(_context_value(seed, "TenantId") or "").strip()
    database_id = str(_context_value(seed, "DatabaseId") or "").strip()
    branch_id = str(_context_value(seed, "BranchId") or "").strip()
    if not tenant_id or not database_id or not branch_id:
        raise HTTPException(
            status_code=503,
            detail=(
                "Công ty đã chọn chưa có kết nối nền MISA hoàn chỉnh. "
                "Quản trị hệ thống cần thiết lập một lần; Kế toán không phải nhập JSON."
            ),
        )
    context = dict(seed)
    context.update({
        "TenantId": tenant_id,
        "TenantCode": str(_context_value(seed, "TenantCode") or "").strip(),
        "DatabaseId": database_id,
        "BranchId": branch_id,
        "WorkingBook": _context_value(seed, "WorkingBook", 0),
        "Language": str(_context_value(seed, "Language", "vi") or "vi"),
        "IncludeDependentBranch": _context_value(seed, "IncludeDependentBranch", "true"),
        "DBType": _context_value(seed, "DBType", 1),
        "AuthType": int(claims.get("aut") or _context_value(seed, "AuthType", 0) or 0),
        "UserId": user_id,
        "HasAgent": bool(_context_value(seed, "HasAgent", False)),
        "UserType": int(_context_value(seed, "UserType", 1) or 1),
        "art": int(_context_value(seed, "art", 0) or 0),
        "isc": bool(_context_value(seed, "isc", False)),
        "IsCorpV2": bool(_context_value(seed, "IsCorpV2", False)),
    })
    credentials.update({
        "misaContext": json.dumps(context, ensure_ascii=False, separators=(",", ":")),
        "device": "",
        "cookie": "",
        "origin": "https://actapp.misa.vn",
        "referer": "https://actapp.misa.vn/",
        "requestBody": profile["requestBody"],
    })
    source = {
        "source_key": "",
        "base_source_key": profile["baseSourceKey"],
        "source_name": profile["sourceName"],
        "source_type": profile["sourceType"],
        "dataset_type": profile["datasetType"],
        "endpoint_url": profile["endpointUrl"],
        "report_id": profile["reportId"],
        "report_name": profile["reportName"],
        "page_size": profile["pageSize"],
    }
    return source, credentials, profile


def _misa_visible_databases(source: Dict[str, Any], credentials: Dict[str, Any]) -> List[Dict[str, Any]]:
    context, _ = _misa_context(credentials.get("misaContext"))
    user_id = str(_context_value(context, "UserId") or "").strip()
    tenant_id = str(_context_value(context, "TenantId") or "").strip()
    if not user_id or not tenant_id:
        raise HTTPException(status_code=400, detail="Phiên MISA đã lưu thiếu UserId hoặc TenantId")
    basic_request = {
        "UserId": user_id,
        "TenantId": tenant_id,
        "AuthType": _context_value(context, "AuthType", 0),
    }
    management_request = dict(basic_request)
    management_request.update({
        "IsCheckConnectOtherApp": True,
        "ASPEmployee": bool(_context_value(context, "ASPEmployee", False)),
    })
    try:
        # Endpoint màn hình Quản lý dữ liệu của MISA đang dùng ở bản hiện hành.
        payload = _misa_platform_request(
            "POST",
            _misa_api_url(source["endpoint_url"], "api/system/v1/database/databases_user_can_see"),
            credentials,
            management_request,
        )
    except WorkerError:
        try:
            # Giữ tương thích cho tài khoản/phiên bản MISA chỉ có bộ chọn dữ liệu cũ.
            payload = _misa_platform_request(
                "POST",
                _misa_api_url(source["endpoint_url"], "api/system/v1/dbext/databases_has_permission"),
                credentials,
                basic_request,
            )
        except WorkerError as permission_error:
            raise WorkerError(
                "MISA chưa trả được danh sách khối dữ liệu. Hệ thống đã giữ nguyên Bearer; "
                "hãy thử lại, nếu lỗi lặp lại hãy báo quản trị kiểm tra kết nối nền của công ty."
            ) from permission_error
    rows = payload.get("Data") or []
    if not isinstance(rows, list):
        rows = []
    visible: List[Dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict) or int(row.get("user_status") or 0) == 2:
            continue
        database_id = str(row.get("database_id") or row.get("DatabaseId") or "").strip()
        if not database_id:
            continue
        name = str(row.get("database_name") or row.get("DatabaseName") or database_id).strip()
        visible.append({
            "databaseId": database_id,
            "databaseName": name,
            "tenantId": str(row.get("tenant_id") or row.get("TenantId") or tenant_id),
            "tenantCode": str(row.get("tenant_code") or row.get("TenantCode") or ""),
            "createdDate": row.get("created_date") or row.get("CreatedDate") or "",
            "accountingSystem": row.get("accounting_system") or row.get("AccountingSystem"),
            "databaseStatus": row.get("database_status") or row.get("DatabaseStatus"),
            "isCurrent": database_id.lower() == str(_context_value(context, "DatabaseId") or "").lower(),
        })
    visible.sort(key=lambda item: (not item["isCurrent"], item["databaseName"].casefold()))
    return visible


def _set_credential_health(
    conn: psycopg.Connection,
    source: Dict[str, Any],
    status: str,
    error: str = "",
    successful: bool = False,
) -> None:
    """Một Bearer thuộc cả khối MISA, không thuộc riêng từng bảng báo cáo."""
    conn.execute(
        f"""UPDATE {SCHEMA}.accounting_source_connections
            SET credential_status=%s,
                credential_last_checked_at=now(),
                credential_last_success_at=CASE WHEN %s THEN now() ELSE credential_last_success_at END,
                credential_last_error=%s,
                updated_at=now()
            WHERE company_key=%s AND data_space_key=%s""",
        (
            status,
            successful,
            str(error or "")[:500],
            source["company_key"],
            source["data_space_key"],
        ),
    )


def _request_template_for_context(template: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
    body = json.loads(json.dumps(template, ensure_ascii=False))
    params = _decode_parameters(body.get("parameters"))
    branch_id = str(_context_value(context, "BranchId") or "").strip()
    if branch_id:
        params["p_branch_id"] = branch_id + ","
    if "p_language" in params:
        params["p_language"] = str(_context_value(context, "Language", params.get("p_language") or "vi"))
    body["parameters"] = _encode_parameters(params)
    body["pageIndex"] = 1
    body["actionLoadReport"] = 1
    body["isViewMCP"] = True
    for key in ("sessionId", "requestFrom", "isOnlyData", "group_key"):
        body.pop(key, None)
    return body


def _jwt_exp(token: str) -> Optional[datetime]:
    try:
        value = int(_jwt_claims(token).get("exp") or 0)
        return datetime.fromtimestamp(value, tz=timezone.utc) if value else None
    except Exception:
        return None


def _encrypt(payload: Dict[str, Any]) -> str:
    if not CIPHER:
        raise HTTPException(status_code=503, detail="Worker chưa có khóa mã hóa")
    return CIPHER.encrypt(json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")).decode("ascii")


def _decrypt(ciphertext: str) -> Dict[str, Any]:
    if not CIPHER:
        raise WorkerError("Worker chưa có khóa mã hóa")
    try:
        return json.loads(CIPHER.decrypt(ciphertext.encode("ascii")).decode("utf-8"))
    except (InvalidToken, ValueError, json.JSONDecodeError) as exc:
        raise WorkerError("Không giải mã được phiên MISA đã lưu") from exc


def _schema_ready(conn: psycopg.Connection) -> bool:
    row = conn.execute(
        """SELECT to_regclass(%s) AS table_name,
           to_regclass(%s) AS journal_table,
           to_regclass(%s) AS journal_monthly_table,
           to_regclass(%s) AS control_table,
           EXISTS(
             SELECT 1 FROM information_schema.columns
             WHERE table_schema=%s AND table_name='accounting_sync_runs' AND column_name='data_space_key'
           ) AS data_space_ready""",
        (
            f"{SCHEMA}.accounting_sync_runs",
            f"{SCHEMA}.accounting_journal_entries",
            f"{SCHEMA}.accounting_journal_monthly",
            f"{SCHEMA}.accounting_data_controls",
            SCHEMA,
        ),
    ).fetchone()
    return bool(
        row
        and row["table_name"]
        and row["journal_table"]
        and row["journal_monthly_table"]
        and row["control_table"]
        and row["data_space_ready"]
    )


def _config_schema_ready(conn: psycopg.Connection) -> bool:
    row = conn.execute(
        "SELECT to_regclass(%s) AS records_table, to_regclass(%s) AS versions_table",
        (
            f"{CONFIG_SCHEMA}.config_records",
            f"{CONFIG_SCHEMA}.config_versions",
        ),
    ).fetchone()
    return bool(row and row["records_table"] and row["versions_table"])


def _note_catalog_schema_ready(conn: psycopg.Connection) -> bool:
    row = conn.execute(
        "SELECT to_regclass(%s) AS meta_table, to_regclass(%s) AS items_table",
        (
            f"{SCHEMA}.accounting_note_catalog_meta",
            f"{SCHEMA}.accounting_note_catalog_items",
        ),
    ).fetchone()
    return bool(row and row["meta_table"] and row["items_table"])


DDL = f"""
CREATE SCHEMA IF NOT EXISTS {SCHEMA};

CREATE TABLE IF NOT EXISTS {SCHEMA}.accounting_schema_meta (
  schema_version text PRIMARY KEY,
  installed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS {SCHEMA}.accounting_source_connections (
  source_key text PRIMARY KEY,
  base_source_key text NOT NULL,
  source_name text NOT NULL,
  source_type text NOT NULL,
  company_key text NOT NULL,
  data_space_key text NOT NULL,
  data_space_name text NOT NULL,
  data_space_identity jsonb NOT NULL DEFAULT '{{}}'::jsonb,
  dataset_type text NOT NULL,
  endpoint_url text NOT NULL,
  report_id text NOT NULL DEFAULT '',
  report_name text NOT NULL DEFAULT '',
  page_size integer NOT NULL DEFAULT 100,
  config jsonb NOT NULL DEFAULT '{{}}'::jsonb,
  credentials_ciphertext text NOT NULL,
  credential_expires_at timestamptz,
  credential_status text NOT NULL DEFAULT 'UNKNOWN',
  credential_last_checked_at timestamptz,
  credential_last_success_at timestamptz,
  credential_last_error text NOT NULL DEFAULT '',
  last_session_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE {SCHEMA}.accounting_source_connections ADD COLUMN IF NOT EXISTS base_source_key text NOT NULL DEFAULT '';
ALTER TABLE {SCHEMA}.accounting_source_connections ADD COLUMN IF NOT EXISTS data_space_key text NOT NULL DEFAULT 'LEGACY';
ALTER TABLE {SCHEMA}.accounting_source_connections ADD COLUMN IF NOT EXISTS data_space_name text NOT NULL DEFAULT 'Dữ liệu cũ';
ALTER TABLE {SCHEMA}.accounting_source_connections ADD COLUMN IF NOT EXISTS data_space_identity jsonb NOT NULL DEFAULT '{{}}'::jsonb;
ALTER TABLE {SCHEMA}.accounting_source_connections ADD COLUMN IF NOT EXISTS credential_status text NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE {SCHEMA}.accounting_source_connections ADD COLUMN IF NOT EXISTS credential_last_checked_at timestamptz;
ALTER TABLE {SCHEMA}.accounting_source_connections ADD COLUMN IF NOT EXISTS credential_last_success_at timestamptz;
ALTER TABLE {SCHEMA}.accounting_source_connections ADD COLUMN IF NOT EXISTS credential_last_error text NOT NULL DEFAULT '';
UPDATE {SCHEMA}.accounting_source_connections SET base_source_key=source_key WHERE base_source_key='';

CREATE TABLE IF NOT EXISTS {SCHEMA}.accounting_snapshots (
  snapshot_id uuid PRIMARY KEY,
  source_key text NOT NULL REFERENCES {SCHEMA}.accounting_source_connections(source_key),
  company_key text NOT NULL,
  data_space_key text NOT NULL,
  data_space_name text NOT NULL,
  dataset_type text NOT NULL,
  period_from date NOT NULL,
  period_to date NOT NULL,
  version_no integer NOT NULL,
  status text NOT NULL DEFAULT 'LOADING',
  row_count bigint NOT NULL DEFAULT 0,
  checksum text NOT NULL DEFAULT '',
  supersedes_snapshot_id uuid,
  is_published boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  UNIQUE(source_key, company_key, period_from, period_to, version_no)
);

ALTER TABLE {SCHEMA}.accounting_snapshots ADD COLUMN IF NOT EXISTS data_space_key text NOT NULL DEFAULT 'LEGACY';
ALTER TABLE {SCHEMA}.accounting_snapshots ADD COLUMN IF NOT EXISTS data_space_name text NOT NULL DEFAULT 'Dữ liệu cũ';

CREATE TABLE IF NOT EXISTS {SCHEMA}.accounting_sync_runs (
  run_id uuid PRIMARY KEY,
  snapshot_id uuid NOT NULL REFERENCES {SCHEMA}.accounting_snapshots(snapshot_id),
  source_key text NOT NULL REFERENCES {SCHEMA}.accounting_source_connections(source_key),
  company_key text NOT NULL,
  data_space_key text NOT NULL,
  data_space_name text NOT NULL,
  dataset_type text NOT NULL,
  period_from date NOT NULL,
  period_to date NOT NULL,
  status text NOT NULL DEFAULT 'QUEUED',
  stage text NOT NULL DEFAULT 'INIT',
  page_size integer NOT NULL DEFAULT 100,
  next_page integer NOT NULL DEFAULT 1,
  total_pages integer NOT NULL DEFAULT 0,
  processed_pages integer NOT NULL DEFAULT 0,
  source_total_rows bigint NOT NULL DEFAULT 0,
  imported_rows bigint NOT NULL DEFAULT 0,
  added_count bigint NOT NULL DEFAULT 0,
  updated_count bigint NOT NULL DEFAULT 0,
  deleted_count bigint NOT NULL DEFAULT 0,
  unchanged_count bigint NOT NULL DEFAULT 0,
  misa_session_id text NOT NULL DEFAULT '',
  attempt_count integer NOT NULL DEFAULT 0,
  last_error text NOT NULL DEFAULT '',
  requested_by text NOT NULL DEFAULT '',
  note text NOT NULL DEFAULT '',
  requested_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE {SCHEMA}.accounting_sync_runs ADD COLUMN IF NOT EXISTS data_space_key text NOT NULL DEFAULT 'LEGACY';
ALTER TABLE {SCHEMA}.accounting_sync_runs ADD COLUMN IF NOT EXISTS data_space_name text NOT NULL DEFAULT 'Dữ liệu cũ';

CREATE TABLE IF NOT EXISTS {SCHEMA}.accounting_sync_pages (
  run_id uuid NOT NULL REFERENCES {SCHEMA}.accounting_sync_runs(run_id) ON DELETE CASCADE,
  page_index integer NOT NULL,
  status text NOT NULL,
  row_count integer NOT NULL DEFAULT 0,
  checksum text NOT NULL DEFAULT '',
  attempt_count integer NOT NULL DEFAULT 1,
  last_error text NOT NULL DEFAULT '',
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  PRIMARY KEY(run_id, page_index)
);

CREATE TABLE IF NOT EXISTS {SCHEMA}.accounting_source_rows (
  snapshot_id uuid NOT NULL REFERENCES {SCHEMA}.accounting_snapshots(snapshot_id) ON DELETE CASCADE,
  source_key text NOT NULL,
  company_key text NOT NULL,
  data_space_key text NOT NULL,
  data_space_name text NOT NULL,
  period_from date NOT NULL,
  period_to date NOT NULL,
  source_row_key text NOT NULL,
  account_id text NOT NULL DEFAULT '',
  account_number text NOT NULL DEFAULT '',
  account_name text NOT NULL DEFAULT '',
  grade integer,
  is_leaf boolean NOT NULL DEFAULT true,
  opening_debit numeric(24,4) NOT NULL DEFAULT 0,
  opening_credit numeric(24,4) NOT NULL DEFAULT 0,
  period_debit numeric(24,4) NOT NULL DEFAULT 0,
  period_credit numeric(24,4) NOT NULL DEFAULT 0,
  ytd_debit numeric(24,4) NOT NULL DEFAULT 0,
  ytd_credit numeric(24,4) NOT NULL DEFAULT 0,
  closing_debit numeric(24,4) NOT NULL DEFAULT 0,
  closing_credit numeric(24,4) NOT NULL DEFAULT 0,
  row_hash text NOT NULL,
  canonical_data jsonb NOT NULL,
  source_page integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(snapshot_id, source_row_key)
);

ALTER TABLE {SCHEMA}.accounting_source_rows ADD COLUMN IF NOT EXISTS is_leaf boolean NOT NULL DEFAULT true;
ALTER TABLE {SCHEMA}.accounting_source_rows ADD COLUMN IF NOT EXISTS data_space_key text NOT NULL DEFAULT 'LEGACY';
ALTER TABLE {SCHEMA}.accounting_source_rows ADD COLUMN IF NOT EXISTS data_space_name text NOT NULL DEFAULT 'Dữ liệu cũ';

CREATE INDEX IF NOT EXISTS idx_accounting_source_rows_lookup_v2
  ON {SCHEMA}.accounting_source_rows(source_key, company_key, data_space_key, period_from, period_to, account_number);
CREATE INDEX IF NOT EXISTS idx_accounting_source_rows_snapshot
  ON {SCHEMA}.accounting_source_rows(snapshot_id, account_number);

CREATE TABLE IF NOT EXISTS {SCHEMA}.accounting_journal_entries (
  snapshot_id uuid NOT NULL REFERENCES {SCHEMA}.accounting_snapshots(snapshot_id) ON DELETE CASCADE,
  source_row_key text NOT NULL,
  source_key text NOT NULL,
  company_key text NOT NULL,
  data_space_key text NOT NULL,
  data_space_name text NOT NULL,
  period_from date NOT NULL,
  period_to date NOT NULL,
  posted_at timestamptz,
  document_at timestamptz,
  invoice_at timestamptz,
  reference_id text NOT NULL DEFAULT '',
  reference_no text NOT NULL DEFAULT '',
  invoice_no text NOT NULL DEFAULT '',
  journal_memo text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  debit_account text NOT NULL,
  credit_account text NOT NULL,
  amount numeric(24,4) NOT NULL,
  amount_original numeric(24,4) NOT NULL DEFAULT 0,
  currency_id text NOT NULL DEFAULT 'VND',
  exchange_rate numeric(24,8) NOT NULL DEFAULT 1,
  reference_type text NOT NULL DEFAULT '',
  reference_type_name text NOT NULL DEFAULT '',
  entry_type text NOT NULL DEFAULT '',
  is_closing_entry boolean NOT NULL DEFAULT false,
  is_reversal boolean NOT NULL DEFAULT false,
  intercompany_partner text NOT NULL DEFAULT '',
  branch_id text NOT NULL DEFAULT '',
  organization_unit_code text NOT NULL DEFAULT '',
  account_object_code text NOT NULL DEFAULT '',
  expense_item_code text NOT NULL DEFAULT '',
  transaction_class text NOT NULL DEFAULT '',
  dimensions jsonb NOT NULL DEFAULT '{{}}'::jsonb,
  raw_data jsonb NOT NULL DEFAULT '{{}}'::jsonb,
  posting_hash text NOT NULL,
  source_page integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(snapshot_id, source_row_key)
);

CREATE INDEX IF NOT EXISTS idx_accounting_journal_period_accounts
  ON {SCHEMA}.accounting_journal_entries(
    source_key,company_key,data_space_key,posted_at,debit_account,credit_account
  );
CREATE INDEX IF NOT EXISTS idx_accounting_journal_reference
  ON {SCHEMA}.accounting_journal_entries(company_key,data_space_key,reference_id,reference_no);
CREATE INDEX IF NOT EXISTS idx_accounting_journal_posting_hash
  ON {SCHEMA}.accounting_journal_entries(snapshot_id,posting_hash);
CREATE INDEX IF NOT EXISTS idx_accounting_journal_dimensions
  ON {SCHEMA}.accounting_journal_entries USING gin(dimensions);

CREATE TABLE IF NOT EXISTS {SCHEMA}.accounting_journal_monthly (
  snapshot_id uuid NOT NULL REFERENCES {SCHEMA}.accounting_snapshots(snapshot_id) ON DELETE CASCADE,
  source_key text NOT NULL,
  company_key text NOT NULL,
  data_space_key text NOT NULL,
  data_space_name text NOT NULL,
  month_start date NOT NULL,
  debit_account text NOT NULL,
  credit_account text NOT NULL,
  branch_id text NOT NULL DEFAULT '',
  organization_unit_code text NOT NULL DEFAULT '',
  account_object_code text NOT NULL DEFAULT '',
  expense_item_code text NOT NULL DEFAULT '',
  transaction_class text NOT NULL DEFAULT '',
  cash_flow_code text NOT NULL DEFAULT '',
  reference_type text NOT NULL DEFAULT '',
  entry_type text NOT NULL DEFAULT '',
  is_closing_entry boolean NOT NULL DEFAULT false,
  is_reversal boolean NOT NULL DEFAULT false,
  intercompany_partner text NOT NULL DEFAULT '',
  currency_id text NOT NULL DEFAULT 'VND',
  entry_count bigint NOT NULL DEFAULT 0,
  amount numeric(28,4) NOT NULL DEFAULT 0,
  amount_original numeric(28,4) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(
    snapshot_id,month_start,debit_account,credit_account,branch_id,
    organization_unit_code,account_object_code,expense_item_code,
    transaction_class,cash_flow_code,reference_type,entry_type,is_closing_entry,is_reversal,
    intercompany_partner,currency_id
  )
);

ALTER TABLE {SCHEMA}.accounting_journal_monthly
  ADD COLUMN IF NOT EXISTS cash_flow_code text NOT NULL DEFAULT '';
ALTER TABLE {SCHEMA}.accounting_journal_monthly
  DROP CONSTRAINT IF EXISTS accounting_journal_monthly_pkey;
ALTER TABLE {SCHEMA}.accounting_journal_monthly
  ADD CONSTRAINT accounting_journal_monthly_pkey PRIMARY KEY(
    snapshot_id,month_start,debit_account,credit_account,branch_id,
    organization_unit_code,account_object_code,expense_item_code,
    transaction_class,cash_flow_code,reference_type,entry_type,is_closing_entry,is_reversal,
    intercompany_partner,currency_id
  );

CREATE INDEX IF NOT EXISTS idx_accounting_journal_monthly_lookup
  ON {SCHEMA}.accounting_journal_monthly(
    source_key,company_key,data_space_key,month_start,debit_account,credit_account
  );

CREATE TABLE IF NOT EXISTS {SCHEMA}.accounting_data_controls (
  control_id bigserial PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES {SCHEMA}.accounting_sync_runs(run_id) ON DELETE CASCADE,
  snapshot_id uuid NOT NULL REFERENCES {SCHEMA}.accounting_snapshots(snapshot_id) ON DELETE CASCADE,
  control_key text NOT NULL,
  status text NOT NULL,
  debit_total numeric(28,4) NOT NULL DEFAULT 0,
  credit_total numeric(28,4) NOT NULL DEFAULT 0,
  difference numeric(28,4) NOT NULL DEFAULT 0,
  issue_count bigint NOT NULL DEFAULT 0,
  details jsonb NOT NULL DEFAULT '{{}}'::jsonb,
  checked_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(run_id,control_key)
);

CREATE INDEX IF NOT EXISTS idx_accounting_data_controls_snapshot
  ON {SCHEMA}.accounting_data_controls(snapshot_id,status,control_key);

CREATE TABLE IF NOT EXISTS {SCHEMA}.accounting_active_snapshots (
  source_key text NOT NULL,
  company_key text NOT NULL,
  data_space_key text NOT NULL,
  data_space_name text NOT NULL,
  period_from date NOT NULL,
  period_to date NOT NULL,
  snapshot_id uuid NOT NULL REFERENCES {SCHEMA}.accounting_snapshots(snapshot_id),
  activated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(source_key, company_key, period_from, period_to)
);

ALTER TABLE {SCHEMA}.accounting_active_snapshots ADD COLUMN IF NOT EXISTS data_space_key text NOT NULL DEFAULT 'LEGACY';
ALTER TABLE {SCHEMA}.accounting_active_snapshots ADD COLUMN IF NOT EXISTS data_space_name text NOT NULL DEFAULT 'Dữ liệu cũ';

CREATE TABLE IF NOT EXISTS {SCHEMA}.accounting_change_events (
  change_id bigserial PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES {SCHEMA}.accounting_sync_runs(run_id),
  source_key text NOT NULL,
  company_key text NOT NULL,
  data_space_key text NOT NULL,
  data_space_name text NOT NULL,
  period_from date NOT NULL,
  period_to date NOT NULL,
  source_row_key text NOT NULL,
  account_number text NOT NULL DEFAULT '',
  account_name text NOT NULL DEFAULT '',
  change_type text NOT NULL,
  before_data jsonb,
  after_data jsonb,
  changed_fields text[] NOT NULL DEFAULT ARRAY[]::text[],
  amount_deltas jsonb NOT NULL DEFAULT '{{}}'::jsonb,
  review_status text NOT NULL DEFAULT 'UNREVIEWED',
  review_note text NOT NULL DEFAULT '',
  reviewed_by text NOT NULL DEFAULT '',
  reviewed_at timestamptz,
  detected_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE {SCHEMA}.accounting_change_events ADD COLUMN IF NOT EXISTS data_space_key text NOT NULL DEFAULT 'LEGACY';
ALTER TABLE {SCHEMA}.accounting_change_events ADD COLUMN IF NOT EXISTS data_space_name text NOT NULL DEFAULT 'Dữ liệu cũ';

CREATE INDEX IF NOT EXISTS idx_accounting_changes_filter_v2
  ON {SCHEMA}.accounting_change_events(company_key, data_space_key, period_from, period_to, review_status, detected_at DESC);

CREATE TABLE IF NOT EXISTS {SCHEMA}.accounting_report_cache (
  cache_key text PRIMARY KEY,
  report_key text NOT NULL,
  config_version text NOT NULL,
  snapshot_refs jsonb NOT NULL,
  result_data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz
);

CREATE TABLE IF NOT EXISTS {SCHEMA}.accounting_report_result_snapshots (
  report_result_id uuid PRIMARY KEY,
  version_id text NOT NULL,
  report_key text NOT NULL,
  report_name text NOT NULL DEFAULT '',
  company_key text NOT NULL,
  data_space_key text NOT NULL,
  data_space_name text NOT NULL DEFAULT '',
  period_from date NOT NULL,
  period_to date NOT NULL,
  source_file_name text NOT NULL DEFAULT '',
  source_sheet_name text NOT NULL DEFAULT '',
  source_header_row integer NOT NULL DEFAULT 0,
  source_checksum text NOT NULL DEFAULT '',
  row_count bigint NOT NULL DEFAULT 0,
  output_data jsonb NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  note text NOT NULL DEFAULT '',
  created_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  supersedes_report_result_id uuid REFERENCES {SCHEMA}.accounting_report_result_snapshots(report_result_id),
  CHECK (period_from <= period_to),
  CHECK (status IN ('ACTIVE','SUPERSEDED','VOIDED'))
);

CREATE INDEX IF NOT EXISTS idx_accounting_report_result_lookup
  ON {SCHEMA}.accounting_report_result_snapshots(
    version_id,report_key,company_key,data_space_key,period_from,period_to,status,created_at DESC
  );

CREATE TABLE IF NOT EXISTS {SCHEMA}.accounting_report_adjustments (
  adjustment_id uuid PRIMARY KEY,
  external_key text NOT NULL UNIQUE,
  version_id text NOT NULL,
  report_key text NOT NULL,
  row_code text NOT NULL,
  column_key text NOT NULL DEFAULT '',
  company_key text NOT NULL,
  data_space_key text NOT NULL,
  data_space_name text NOT NULL DEFAULT '',
  period_from date NOT NULL,
  period_to date NOT NULL,
  amount numeric(28,4) NOT NULL DEFAULT 0,
  reason text NOT NULL,
  source_reference text NOT NULL,
  supporting_data jsonb NOT NULL DEFAULT '{{}}'::jsonb,
  status text NOT NULL DEFAULT 'DRAFT',
  supersedes_adjustment_id uuid REFERENCES {SCHEMA}.accounting_report_adjustments(adjustment_id),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_by text NOT NULL DEFAULT '',
  approved_at timestamptz,
  voided_by text NOT NULL DEFAULT '',
  voided_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (period_from <= period_to),
  CHECK (status IN ('DRAFT','REVIEW','APPROVED','VOIDED'))
);

CREATE INDEX IF NOT EXISTS idx_accounting_report_adjustments_lookup
  ON {SCHEMA}.accounting_report_adjustments(
    version_id,report_key,company_key,data_space_key,period_from,period_to,status,row_code
  );

CREATE TABLE IF NOT EXISTS {SCHEMA}.accounting_report_adjustment_events (
  event_id bigserial PRIMARY KEY,
  adjustment_id uuid NOT NULL REFERENCES {SCHEMA}.accounting_report_adjustments(adjustment_id) ON DELETE CASCADE,
  action text NOT NULL,
  before_status text NOT NULL DEFAULT '',
  after_status text NOT NULL DEFAULT '',
  note text NOT NULL DEFAULT '',
  actor text NOT NULL,
  event_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_accounting_report_adjustment_events_recent
  ON {SCHEMA}.accounting_report_adjustment_events(adjustment_id,event_at DESC,event_id DESC);

CREATE TABLE IF NOT EXISTS {SCHEMA}.accounting_note_catalog_meta (
  source_key text NOT NULL REFERENCES {SCHEMA}.accounting_source_connections(source_key) ON DELETE CASCADE,
  sub_accounting_system integer NOT NULL,
  row_count integer NOT NULL DEFAULT 0,
  checksum text NOT NULL DEFAULT '',
  last_checked_at timestamptz NOT NULL DEFAULT now(),
  last_changed_at timestamptz NOT NULL DEFAULT now(),
  last_error text NOT NULL DEFAULT '',
  PRIMARY KEY(source_key, sub_accounting_system)
);

CREATE TABLE IF NOT EXISTS {SCHEMA}.accounting_note_catalog_items (
  source_key text NOT NULL REFERENCES {SCHEMA}.accounting_source_connections(source_key) ON DELETE CASCADE,
  sub_accounting_system integer NOT NULL,
  item_id text NOT NULL,
  item_code text NOT NULL DEFAULT '',
  item_name text NOT NULL DEFAULT '',
  part text NOT NULL DEFAULT '',
  part_in_tab text NOT NULL DEFAULT '',
  item_index numeric(18,4),
  formula_type integer,
  is_bold boolean NOT NULL DEFAULT false,
  is_italic boolean NOT NULL DEFAULT false,
  hidden boolean NOT NULL DEFAULT false,
  formula jsonb NOT NULL DEFAULT '[]'::jsonb,
  raw_payload jsonb NOT NULL DEFAULT '{{}}'::jsonb,
  synced_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(source_key, sub_accounting_system, item_id)
);

CREATE INDEX IF NOT EXISTS idx_accounting_note_catalog_lookup
  ON {SCHEMA}.accounting_note_catalog_items(sub_accounting_system, part_in_tab, part, item_index, item_code);

CREATE TABLE IF NOT EXISTS {SCHEMA}.accounting_dirty_periods (
  source_key text NOT NULL,
  company_key text NOT NULL,
  data_space_key text NOT NULL,
  data_space_name text NOT NULL,
  period_from date NOT NULL,
  period_to date NOT NULL,
  reason_run_id uuid NOT NULL,
  reason text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'PENDING',
  detected_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(source_key, company_key, period_from, period_to)
);

ALTER TABLE {SCHEMA}.accounting_dirty_periods ADD COLUMN IF NOT EXISTS data_space_key text NOT NULL DEFAULT 'LEGACY';
ALTER TABLE {SCHEMA}.accounting_dirty_periods ADD COLUMN IF NOT EXISTS data_space_name text NOT NULL DEFAULT 'Dữ liệu cũ';

CREATE TABLE IF NOT EXISTS {SCHEMA}.accounting_cleanup_audit (
  cleanup_id bigserial PRIMARY KEY,
  company_key text NOT NULL,
  data_space_key text NOT NULL,
  data_space_name text NOT NULL,
  requested_by text NOT NULL DEFAULT '',
  deleted_counts jsonb NOT NULL DEFAULT '{{}}'::jsonb,
  preview_token text NOT NULL,
  deleted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_accounting_cleanup_audit_recent
  ON {SCHEMA}.accounting_cleanup_audit(deleted_at DESC, company_key, data_space_key);
"""


@app.get("/healthz")
def liveness() -> Dict[str, Any]:
    return {"ok": True, "service": "accounting-worker", "schemaVersion": SCHEMA_VERSION}


@app.get("/readyz")
def readiness() -> Dict[str, Any]:
    errors = _configuration_errors()
    if errors:
        raise HTTPException(status_code=503, detail="; ".join(errors))
    pool = _pool()
    try:
        with pool.connection(timeout=5) as conn:
            conn.execute("SELECT 1").fetchone()
            runtime_ready = _schema_ready(conn)
            config_ready = _config_schema_ready(conn)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"PostgreSQL chưa sẵn sàng: {str(exc)[:180]}") from exc
    if not runtime_ready or not config_ready:
        raise HTTPException(
            status_code=503,
            detail="Cấu trúc accounting_runtime hoặc accounting_portal chưa sẵn sàng",
        )
    return {
        "ok": True,
        "databaseConnected": True,
        "runtimeSchemaReady": True,
        "configSchemaReady": True,
    }


@app.get("/health")
def health(_: None = Depends(_auth)) -> Dict[str, Any]:
    pool = _pool()
    try:
        with pool.connection() as conn:
            row = conn.execute("SELECT current_database() AS database_name, current_user AS database_user").fetchone()
            ready = _schema_ready(conn)
            config_ready = _config_schema_ready(conn)
        return {
            "ok": True,
            "schemaVersion": SCHEMA_VERSION,
            "databaseConnected": True,
            "schemaReady": ready,
            "configSchemaReady": config_ready,
            "databaseName": row["database_name"],
            "databaseUser": row["database_user"],
            "schema": SCHEMA,
            "configSchema": CONFIG_SCHEMA,
            "autoRunEnabled": AUTORUN_ENABLED,
            "environment": ENVIRONMENT,
            "credentialKeyConfigured": bool(os.getenv("ACCOUNTING_CREDENTIAL_KEY", "").strip()),
            "configurationWarnings": _configuration_errors(),
        }
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Không kết nối được PostgreSQL: {str(exc)[:240]}") from exc


@app.post("/schema/initialize")
def initialize_schema(_: None = Depends(_auth)) -> Dict[str, Any]:
    pool = _pool()
    try:
        with pool.connection() as conn:
            with conn.transaction():
                conn.execute(DDL)
                conn.execute(
                    f"INSERT INTO {SCHEMA}.accounting_schema_meta(schema_version) VALUES (%s) ON CONFLICT DO NOTHING",
                    (SCHEMA_VERSION,),
                )
        return {"ok": True, "schemaReady": True, "schemaVersion": SCHEMA_VERSION, "schema": SCHEMA}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Không khởi tạo được cấu trúc PostgreSQL: {str(exc)[:260]}") from exc


@app.post("/sessions/misa")
def save_misa_session(request: MisaSessionRequest, _: None = Depends(_auth)) -> Dict[str, Any]:
    base_source_key = _clean_key(request.sourceKey, "mã nguồn")
    company_key = _clean_key(request.companyKey, "mã công ty")
    data_space_name = _clean_name(request.dataSpaceName, "tên khối dữ liệu MISA")
    endpoint = _allowed_misa_url(request.endpointUrl)
    bearer = re.sub(r"^Bearer\s+", "", request.bearer.strip(), flags=re.I)
    if not bearer:
        raise HTTPException(status_code=400, detail="Thiếu Bearer của phiên MISA")
    if not isinstance(request.requestBody, dict) or not request.requestBody:
        raise HTTPException(status_code=400, detail="Thiếu nội dung yêu cầu mẫu của báo cáo MISA")
    context, context_text = _misa_context(request.misaContext)
    data_space_key, data_space_identity = _misa_data_space(context, endpoint)
    expires_at = _jwt_exp(bearer)
    credentials = {
        "bearer": bearer,
        "misaContext": context_text,
        "device": request.device.strip(),
        "cookie": request.cookie.strip(),
        "origin": request.origin.strip() or "https://actapp.misa.vn",
        "referer": request.referer.strip() or "https://actapp.misa.vn/",
        "requestBody": request.requestBody,
    }
    try:
        _misa_visible_databases({"endpoint_url": endpoint}, credentials)
    except MisaAuthError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    except WorkerError as exc:
        raise HTTPException(status_code=502, detail=f"Chưa xác minh được Bearer với MISA: {str(exc)[:220]}") from exc
    encrypted = _encrypt(credentials)
    page_size = max(1, min(MAX_PAGE_SIZE, int(request.pageSize or 100)))
    pool = _pool()
    with pool.connection() as conn:
        if not _schema_ready(conn):
            raise HTTPException(status_code=409, detail="Hãy khởi tạo cấu trúc PostgreSQL trước")
        with conn.transaction():
            data_space_key = _compatible_data_space_key(
                conn,
                company_key,
                data_space_identity,
                data_space_key,
            )
            source_key = _connection_source_key(base_source_key, company_key, data_space_key)
            conn.execute(
                f"""
                INSERT INTO {SCHEMA}.accounting_source_connections(
                  source_key, base_source_key, source_name, source_type, company_key,
                  data_space_key, data_space_name, data_space_identity, dataset_type, endpoint_url,
                  report_id, report_name, page_size, config, credentials_ciphertext, credential_expires_at
                ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s,%s,%s,%s,%s,%s::jsonb,%s,%s)
                ON CONFLICT(source_key) DO UPDATE SET
                  base_source_key=excluded.base_source_key,
                  source_name=excluded.source_name, source_type=excluded.source_type,
                  company_key=excluded.company_key, dataset_type=excluded.dataset_type,
                  data_space_key=excluded.data_space_key, data_space_name=excluded.data_space_name,
                  data_space_identity=excluded.data_space_identity,
                  endpoint_url=excluded.endpoint_url, report_id=excluded.report_id,
                  report_name=excluded.report_name, page_size=excluded.page_size,
                  config=excluded.config, credentials_ciphertext=excluded.credentials_ciphertext,
                  credential_expires_at=excluded.credential_expires_at,
                  last_session_at=now(), updated_at=now()
                """,
                (
                    source_key, base_source_key, request.sourceName.strip() or base_source_key,
                    request.sourceType.strip().upper(), company_key,
                    data_space_key, data_space_name,
                    json.dumps(data_space_identity, ensure_ascii=False),
                    request.datasetType.strip().upper(), endpoint, request.reportId.strip(),
                    request.reportName.strip(), page_size,
                    json.dumps({
                        "hasCookie": bool(request.cookie),
                        "hasDevice": bool(request.device),
                        "dataSpaceIdentity": data_space_identity,
                    }, ensure_ascii=False),
                    encrypted, expires_at,
                ),
            )
            _set_credential_health(
                conn,
                {"company_key": company_key, "data_space_key": data_space_key},
                "VALID",
                successful=True,
            )
            conn.execute(
                f"UPDATE {SCHEMA}.accounting_sync_runs SET status='RETRY', stage='INIT', misa_session_id='', last_error='', updated_at=now() WHERE source_key=%s AND status='NEEDS_LOGIN'",
                (source_key,),
            )
            if _note_catalog_schema_ready(conn):
                conn.execute(
                    f"""UPDATE {SCHEMA}.accounting_note_catalog_meta
                        SET last_checked_at=now()-interval '25 hours',last_error=''
                        WHERE source_key=%s""",
                    (source_key,),
                )
    return {
        "ok": True,
        "sourceKey": source_key,
        "baseSourceKey": base_source_key,
        "companyKey": company_key,
        "dataSpaceKey": data_space_key,
        "dataSpaceName": data_space_name,
        "expiresAt": expires_at.isoformat() if expires_at else "",
        "message": f"Đã mã hóa và lưu phiên MISA cho khối {data_space_name} trong PostgreSQL.",
    }


@app.post("/sessions/misa/bearer")
def refresh_misa_bearer(request: MisaBearerRefreshRequest, _: None = Depends(_auth)) -> Dict[str, Any]:
    source_key = _clean_key(request.sourceKey, "mã nguồn đã kết nối")
    bearer = re.sub(r"^Bearer\s+", "", request.bearer.strip(), flags=re.I)
    if not bearer:
        raise HTTPException(status_code=400, detail="Thiếu Bearer mới của phiên MISA")
    expires_at = _jwt_exp(bearer)

    pool = _pool()
    with pool.connection() as conn:
        if not _schema_ready(conn):
            raise HTTPException(status_code=409, detail="Hãy khởi tạo cấu trúc PostgreSQL trước")
        with conn.transaction():
            source = conn.execute(
                f"SELECT * FROM {SCHEMA}.accounting_source_connections WHERE source_key=%s FOR UPDATE",
                (source_key,),
            ).fetchone()
            if not source:
                raise HTTPException(status_code=404, detail="Không tìm thấy khối dữ liệu MISA đã kết nối")
            group_sources = conn.execute(
                f"""SELECT * FROM {SCHEMA}.accounting_source_connections
                    WHERE company_key=%s AND data_space_key=%s
                      AND (source_type ILIKE '%%MISA%%' OR source_type ILIKE '%%AMIS%%')
                    FOR UPDATE""",
                (source["company_key"], source["data_space_key"]),
            ).fetchall()
            credentials = _credentials_with_bearer(_decrypt(source["credentials_ciphertext"]), bearer)
            try:
                _misa_visible_databases(source, credentials)
            except MisaAuthError as exc:
                raise HTTPException(status_code=401, detail=str(exc)) from exc
            except WorkerError as exc:
                raise HTTPException(status_code=502, detail=f"Chưa xác minh được Bearer với MISA: {str(exc)[:220]}") from exc
            source_keys: List[str] = []
            for group_source in group_sources:
                group_credentials = _credentials_with_bearer(
                    _decrypt(group_source["credentials_ciphertext"]),
                    bearer,
                )
                conn.execute(
                    f"""UPDATE {SCHEMA}.accounting_source_connections
                        SET credentials_ciphertext=%s,credential_expires_at=%s,last_session_at=now(),updated_at=now()
                        WHERE source_key=%s""",
                    (_encrypt(group_credentials), expires_at, group_source["source_key"]),
                )
                source_keys.append(str(group_source["source_key"]))
            _set_credential_health(conn, source, "VALID", successful=True)
            resumed = conn.execute(
                f"""UPDATE {SCHEMA}.accounting_sync_runs
                    SET status='RETRY',stage='INIT',misa_session_id='',last_error='',updated_at=now()
                    WHERE source_key=ANY(%s) AND status='NEEDS_LOGIN'""",
                (source_keys,),
            ).rowcount
            if _note_catalog_schema_ready(conn):
                conn.execute(
                    f"""UPDATE {SCHEMA}.accounting_note_catalog_meta
                        SET last_checked_at=now()-interval '25 hours',last_error=''
                        WHERE source_key=ANY(%s)""",
                    (source_keys,),
                )
    return {
        "ok": True,
        "sourceKey": source_key,
        "companyKey": source["company_key"],
        "dataSpaceKey": source["data_space_key"],
        "dataSpaceName": source["data_space_name"],
        "expiresAt": expires_at.isoformat() if expires_at else "",
        "updatedSourceCount": len(source_keys),
        "resumedRunCount": int(resumed or 0),
        "message": f"Đã cập nhật một Bearer cho toàn bộ {len(source_keys)} bảng dữ liệu trong khối; các thiết lập kỹ thuật cũ được giữ nguyên.",
    }


@app.post("/sessions/misa/check")
def check_misa_credentials(request: MisaCredentialCheckRequest, _: None = Depends(_auth)) -> Dict[str, Any]:
    """Kiểm tra Bearer bằng phản hồi thật của MISA, tối đa một lần mỗi ngày."""
    pool = _pool()
    with pool.connection() as conn:
        if not _schema_ready(conn):
            raise HTTPException(status_code=409, detail="Hãy khởi tạo cấu trúc PostgreSQL trước")
        with conn.transaction():
            if request.sourceKey:
                source_key = _clean_key(request.sourceKey, "mã nguồn đã kết nối")
                target = conn.execute(
                    f"SELECT company_key,data_space_key FROM {SCHEMA}.accounting_source_connections WHERE source_key=%s",
                    (source_key,),
                ).fetchone()
                if not target:
                    raise HTTPException(status_code=404, detail="Không tìm thấy khối dữ liệu MISA đã kết nối")
                sources = conn.execute(
                    f"""SELECT * FROM {SCHEMA}.accounting_source_connections
                        WHERE company_key=%s AND data_space_key=%s
                          AND (source_type ILIKE '%%MISA%%' OR source_type ILIKE '%%AMIS%%')
                        ORDER BY source_key""",
                    (target["company_key"], target["data_space_key"]),
                ).fetchall()
            else:
                sources = conn.execute(
                    f"""SELECT * FROM {SCHEMA}.accounting_source_connections
                        WHERE source_type ILIKE '%%MISA%%' OR source_type ILIKE '%%AMIS%%'
                        ORDER BY company_key,data_space_key,source_key"""
                ).fetchall()

        grouped: Dict[str, List[Dict[str, Any]]] = {}
        for raw_source in sources:
            source = dict(raw_source)
            group_key = f"{source['company_key']}::{source['data_space_key']}"
            grouped.setdefault(group_key, []).append(source)

        items: List[Dict[str, Any]] = []
        for group_sources in grouped.values():
            representative = group_sources[0]
            checked_times = [item.get("credential_last_checked_at") for item in group_sources]
            checked_at = max((item for item in checked_times if item), default=None)
            all_valid = all(str(item.get("credential_status") or "UNKNOWN") == "VALID" for item in group_sources)
            if not request.force and all_valid and checked_at and checked_at >= _now() - timedelta(hours=24):
                items.append({
                    "companyKey": representative["company_key"],
                    "dataSpaceKey": representative["data_space_key"],
                    "dataSpaceName": representative["data_space_name"],
                    "status": "VALID",
                    "checkedAt": checked_at.isoformat(),
                    "skipped": True,
                })
                continue
            try:
                credentials = _decrypt(representative["credentials_ciphertext"])
                _misa_visible_databases(representative, credentials)
                status = "VALID"
                message = "MISA xác nhận Bearer còn dùng được."
                with conn.transaction():
                    _set_credential_health(conn, representative, status, successful=True)
            except MisaAuthError as exc:
                status = "NEEDS_LOGIN"
                message = str(exc)
                with conn.transaction():
                    _set_credential_health(conn, representative, status, message)
            except Exception as exc:
                # Lỗi mạng hoặc MISA tạm gián đoạn không đồng nghĩa Bearer đã hết hạn.
                status = "CHECK_FAILED"
                message = str(exc)[:220]
                with conn.transaction():
                    _set_credential_health(conn, representative, status, message)
            items.append({
                "companyKey": representative["company_key"],
                "dataSpaceKey": representative["data_space_key"],
                "dataSpaceName": representative["data_space_name"],
                "sourceCount": len(group_sources),
                "status": status,
                "message": message,
                "checkedAt": _now().isoformat(),
                "skipped": False,
            })
    needs_login = sum(1 for item in items if item["status"] == "NEEDS_LOGIN")
    failed = sum(1 for item in items if item["status"] == "CHECK_FAILED")
    return {
        "ok": needs_login == 0,
        "checkedGroupCount": sum(1 for item in items if not item.get("skipped")),
        "needsLoginCount": needs_login,
        "checkFailedCount": failed,
        "items": items,
        "message": (
            f"Có {needs_login} khối MISA cần dán Bearer mới."
            if needs_login
            else "Các Bearer MISA được kiểm tra đang còn dùng được."
        ),
    }


@app.post("/sessions/misa/spaces")
def discover_misa_spaces(request: MisaDataSpaceDiscoveryRequest, _: None = Depends(_auth)) -> Dict[str, Any]:
    source_key = _clean_key(request.sourceKey, "mã khối MISA dùng để đọc danh sách") if request.sourceKey.strip() else ""
    profile_key = _clean_key(request.profileKey or "TRIAL_BALANCE", "mẫu kỹ thuật MISA")
    pool = _pool()
    with pool.connection() as conn:
        if not _schema_ready(conn):
            raise HTTPException(status_code=409, detail="Hãy khởi tạo cấu trúc PostgreSQL trước")
        if source_key:
            source = conn.execute(
                f"SELECT * FROM {SCHEMA}.accounting_source_connections WHERE source_key=%s",
                (source_key,),
            ).fetchone()
            if not source:
                raise HTTPException(status_code=404, detail="Không tìm thấy khối MISA dùng để đọc danh sách")
            source = dict(source)
            credentials = _credentials_with_bearer(_decrypt(source["credentials_ciphertext"]), request.bearer)
            discovery_profile = ""
        else:
            source, credentials, profile = _misa_bootstrap_reference(
                request.bearer,
                profile_key,
                request.companyKey,
            )
            discovery_profile = profile["profileKey"]
        try:
            databases = _misa_visible_databases(source, credentials)
        except MisaAuthError as exc:
            raise HTTPException(status_code=401, detail=str(exc)) from exc
        except WorkerError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc
        connected_rows = conn.execute(
            f"SELECT data_space_identity->>'databaseId' AS database_id FROM {SCHEMA}.accounting_source_connections"
        ).fetchall()
        connected_ids = {
            str(row.get("database_id") or "").strip().lower()
            for row in connected_rows
            if str(row.get("database_id") or "").strip()
        }
    for database in databases:
        database["connected"] = database["databaseId"].lower() in connected_ids
    return {
        "ok": True,
        "sourceKey": source_key,
        "profileKey": discovery_profile,
        "spaces": databases,
        "count": len(databases),
        "message": f"MISA cho phép tài khoản này truy cập {len(databases)} khối dữ liệu.",
    }


@app.post("/sessions/misa/spaces/connect")
def connect_misa_space(request: MisaDataSpaceConnectRequest, _: None = Depends(_auth)) -> Dict[str, Any]:
    reference_source_key = _clean_key(request.referenceSourceKey, "mã khối MISA dùng làm mẫu") if request.referenceSourceKey.strip() else ""
    profile_key = _clean_key(request.profileKey or "TRIAL_BALANCE", "mẫu kỹ thuật MISA")
    company_key = _clean_key(request.companyKey, "mã công ty")
    database_id = str(request.databaseId or "").strip()
    if not database_id:
        raise HTTPException(status_code=400, detail="Hãy chọn một khối dữ liệu MISA")
    pool = _pool()
    with pool.connection() as conn:
        if not _schema_ready(conn):
            raise HTTPException(status_code=409, detail="Hãy khởi tạo cấu trúc PostgreSQL trước")
        if reference_source_key:
            source = conn.execute(
                f"SELECT * FROM {SCHEMA}.accounting_source_connections WHERE source_key=%s",
                (reference_source_key,),
            ).fetchone()
            if not source:
                raise HTTPException(status_code=404, detail="Không tìm thấy khối MISA dùng làm mẫu")
            source = dict(source)
            credentials = _credentials_with_bearer(_decrypt(source["credentials_ciphertext"]), request.bearer)
            discovered_from = reference_source_key
        else:
            source, credentials, profile = _misa_bootstrap_reference(
                request.bearer,
                profile_key,
                company_key,
            )
            discovered_from = "SYSTEM_PROFILE:" + profile["profileKey"]
        try:
            databases = _misa_visible_databases(source, credentials)
            selected = next(
                (item for item in databases if item["databaseId"].lower() == database_id.lower()),
                None,
            )
            if not selected:
                raise HTTPException(status_code=403, detail="Tài khoản MISA không còn quyền truy cập khối đã chọn")
            current_context, _ = _misa_context(credentials.get("misaContext"))
            user_id = str(_context_value(current_context, "UserId") or "").strip()
            context_payload = _misa_database_context(
                source,
                credentials,
                database_id,
                user_id,
            )
        except MisaAuthError as exc:
            raise HTTPException(status_code=401, detail=str(exc)) from exc
        except WorkerError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc

    context_data = context_payload.get("Data") or {}
    if not isinstance(context_data, dict):
        raise HTTPException(status_code=502, detail="MISA không trả ngữ cảnh cho khối đã chọn")
    if context_data.get("Redirect"):
        raise HTTPException(status_code=409, detail="Khối đã chọn yêu cầu đăng nhập lại trực tiếp trên MISA")
    new_context, new_context_text = _misa_context(context_data.get("Context"))
    returned_database_id = str(_context_value(new_context, "DatabaseId") or "").strip()
    if returned_database_id.lower() != database_id.lower():
        raise HTTPException(status_code=502, detail="MISA trả ngữ cảnh không khớp khối dữ liệu đã chọn")
    selected_token = re.sub(
        r"^Bearer\s+",
        "",
        str(context_data.get("Token") or credentials.get("bearer") or "").strip(),
        flags=re.I,
    )
    if not selected_token:
        raise HTTPException(status_code=502, detail="MISA không cấp mã truy cập cho khối đã chọn")
    saved_sources: List[Dict[str, Any]] = []
    for profile in _misa_system_profiles():
        endpoint_url = _misa_endpoint_environment(
            profile["endpointUrl"],
            str(context_data.get("Env") or ""),
        )
        request_body = _request_template_for_context(profile["requestBody"], new_context)
        session_request = MisaSessionRequest(
            sourceKey=profile["baseSourceKey"],
            sourceName=profile["sourceName"],
            sourceType=profile["sourceType"],
            companyKey=company_key,
            dataSpaceName=selected["databaseName"],
            datasetType=profile["datasetType"],
            endpointUrl=endpoint_url,
            reportId=profile["reportId"],
            reportName=profile["reportName"],
            bearer=selected_token,
            misaContext=new_context_text,
            device=str(credentials.get("device") or ""),
            cookie=str(credentials.get("cookie") or ""),
            origin=str(credentials.get("origin") or "https://actapp.misa.vn"),
            referer=str(credentials.get("referer") or "https://actapp.misa.vn/"),
            requestBody=request_body,
            pageSize=int(profile["pageSize"]),
        )
        saved = save_misa_session(session_request, None)
        saved.update({
            "profileKey": profile["profileKey"],
            "datasetType": profile["datasetType"],
            "sourceName": profile["sourceName"],
        })
        saved_sources.append(saved)

    primary = dict(saved_sources[0])
    primary.update({
        "sources": saved_sources,
        "sourceCount": len(saved_sources),
        "message": (
            f"Đã kết nối khối {selected['databaseName']} và tạo đủ 2 bảng dữ liệu: "
            "Bảng cân đối tài khoản, Sổ nhật ký chung."
        ),
        "discoveredFrom": discovered_from,
    })
    return primary


def _note_catalog_source(
    conn: psycopg.Connection,
    source_key: str = "",
) -> Optional[Dict[str, Any]]:
    normalized = _clean_key(source_key) if str(source_key or "").strip() else ""
    if normalized:
        return conn.execute(
            f"""SELECT * FROM {SCHEMA}.accounting_source_connections
                WHERE source_key=%s""",
            (normalized,),
        ).fetchone()
    return conn.execute(
        f"""SELECT * FROM {SCHEMA}.accounting_source_connections
            ORDER BY last_session_at DESC, updated_at DESC LIMIT 1"""
    ).fetchone()


def _note_formula(value: Any) -> List[Dict[str, Any]]:
    candidate = value
    if isinstance(candidate, str) and candidate.strip():
        try:
            candidate = json.loads(candidate)
        except (TypeError, ValueError, json.JSONDecodeError):
            return []
    return [item for item in candidate if isinstance(item, dict)] if isinstance(candidate, list) else []


def _note_catalog_checksum(rows: List[Dict[str, Any]]) -> str:
    canonical = json.dumps(
        sorted(rows, key=lambda item: str(item.get("item_id") or "")),
        ensure_ascii=False,
        sort_keys=True,
        default=str,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _sync_note_catalog(
    conn: psycopg.Connection,
    source: Dict[str, Any],
    sub_accounting_system: int,
    *,
    force: bool = False,
) -> Dict[str, Any]:
    subsystem = max(0, min(9999, int(sub_accounting_system or 99)))
    meta = conn.execute(
        f"""SELECT * FROM {SCHEMA}.accounting_note_catalog_meta
            WHERE source_key=%s AND sub_accounting_system=%s""",
        (source["source_key"], subsystem),
    ).fetchone()
    freshness_cutoff = _now() - timedelta(hours=24)
    if (
        not force
        and meta
        and meta.get("last_checked_at")
        and meta["last_checked_at"] >= freshness_cutoff
    ):
        return {
            "ok": True,
            "changed": False,
            "skipped": True,
            "sourceKey": source["source_key"],
            "subAccountingSystem": subsystem,
            "rowCount": int(meta.get("row_count") or 0),
            "lastCheckedAt": _safe(meta.get("last_checked_at")),
            "message": "Danh mục thuyết minh đã được kiểm tra trong 24 giờ qua.",
        }

    credentials = _decrypt(source["credentials_ciphertext"])
    url = _misa_api_url(
        source["endpoint_url"],
        "api/frreport/v1/fr_report/description_template",
    )
    url += "?subAccountingSystem=" + quote(str(subsystem))
    try:
        payload = _misa_platform_request("GET", url, credentials)
        raw_rows = payload.get("Data") or []
        if not isinstance(raw_rows, list):
            raise WorkerError("MISA không trả danh sách thuyết minh hợp lệ")
        rows = [
            dict(item)
            for item in raw_rows
            if isinstance(item, dict) and str(item.get("item_id") or "").strip()
        ]
        checksum = _note_catalog_checksum(rows)
        changed = not meta or str(meta.get("checksum") or "") != checksum
        with conn.transaction():
            if changed:
                conn.execute(
                    f"""DELETE FROM {SCHEMA}.accounting_note_catalog_items
                        WHERE source_key=%s AND sub_accounting_system=%s""",
                    (source["source_key"], subsystem),
                )
                insert_rows = []
                for item in rows:
                    item_index = item.get("item_index")
                    try:
                        normalized_index = Decimal(str(item_index)) if item_index not in (None, "") else None
                    except Exception:
                        normalized_index = None
                    insert_rows.append(
                        (
                            source["source_key"],
                            subsystem,
                            str(item.get("item_id") or "").strip(),
                            str(item.get("item_code") or "").strip(),
                            str(item.get("item_name") or "").strip(),
                            str(item.get("part") or "").strip(),
                            str(item.get("part_in_tab") or "").strip(),
                            normalized_index,
                            int(item.get("formula_type")) if item.get("formula_type") not in (None, "") else None,
                            bool(item.get("is_bold")),
                            bool(item.get("is_italic")),
                            bool(item.get("hidden")),
                            json.dumps(_note_formula(item.get("formula")), ensure_ascii=False),
                            json.dumps(item, ensure_ascii=False, default=str),
                        )
                    )
                with conn.cursor() as cursor:
                    cursor.executemany(
                        f"""INSERT INTO {SCHEMA}.accounting_note_catalog_items(
                              source_key,sub_accounting_system,item_id,item_code,item_name,
                              part,part_in_tab,item_index,formula_type,is_bold,is_italic,
                              hidden,formula,raw_payload,synced_at
                            ) VALUES(
                              %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s::jsonb,now()
                            )""",
                        insert_rows,
                    )
            conn.execute(
                f"""INSERT INTO {SCHEMA}.accounting_note_catalog_meta(
                      source_key,sub_accounting_system,row_count,checksum,last_checked_at,
                      last_changed_at,last_error
                    ) VALUES(%s,%s,%s,%s,now(),now(),'')
                    ON CONFLICT(source_key,sub_accounting_system) DO UPDATE SET
                      row_count=excluded.row_count,
                      checksum=excluded.checksum,
                      last_checked_at=now(),
                      last_changed_at=CASE
                        WHEN {SCHEMA}.accounting_note_catalog_meta.checksum<>excluded.checksum
                        THEN now()
                        ELSE {SCHEMA}.accounting_note_catalog_meta.last_changed_at
                      END,
                      last_error=''""",
                (source["source_key"], subsystem, len(rows), checksum),
            )
        return {
            "ok": True,
            "changed": changed,
            "skipped": False,
            "sourceKey": source["source_key"],
            "subAccountingSystem": subsystem,
            "rowCount": len(rows),
            "lastCheckedAt": _now().isoformat(),
            "message": (
                f"Đã cập nhật {len(rows)} dòng thuyết minh từ MISA."
                if changed
                else "Danh mục thuyết minh MISA không thay đổi."
            ),
        }
    except (MisaAuthError, WorkerError, HTTPException) as exc:
        detail = exc.detail if isinstance(exc, HTTPException) else str(exc)
        conn.execute(
            f"""INSERT INTO {SCHEMA}.accounting_note_catalog_meta(
                  source_key,sub_accounting_system,row_count,checksum,last_checked_at,
                  last_changed_at,last_error
                ) VALUES(%s,%s,0,'',now(),now(),%s)
                ON CONFLICT(source_key,sub_accounting_system) DO UPDATE SET
                  last_checked_at=now(),last_error=excluded.last_error""",
            (source["source_key"], subsystem, str(detail)[:500]),
        )
        raise


@app.post("/notes/sync")
def sync_note_catalog(
    request: NoteCatalogSyncRequest,
    _: None = Depends(_auth),
) -> Dict[str, Any]:
    pool = _pool()
    with pool.connection() as conn:
        if not _schema_ready(conn):
            raise HTTPException(status_code=409, detail="Hãy khởi tạo cấu trúc PostgreSQL trước")
        source = _note_catalog_source(conn, request.sourceKey)
        if not source:
            raise HTTPException(status_code=404, detail="Không tìm thấy kết nối MISA đã chọn")
        try:
            return _sync_note_catalog(
                conn,
                dict(source),
                request.subAccountingSystem,
                force=request.force,
            )
        except MisaAuthError as exc:
            raise HTTPException(status_code=401, detail=str(exc)) from exc
        except WorkerError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.post("/notes/catalog")
def get_note_catalog(
    request: NoteCatalogRequest,
    _: None = Depends(_auth),
) -> Dict[str, Any]:
    pool = _pool()
    subsystem = max(0, min(9999, int(request.subAccountingSystem or 99)))
    requested_sources = [
        _clean_key(item)
        for item in request.sourceKeys
        if str(item or "").strip()
    ][:12]
    sync_warnings: List[str] = []
    with pool.connection() as conn:
        if not _schema_ready(conn):
            raise HTTPException(status_code=409, detail="Hãy khởi tạo cấu trúc PostgreSQL trước")
        sources: List[Dict[str, Any]] = []
        if requested_sources:
            sources = [
                dict(row)
                for row in conn.execute(
                    f"""SELECT * FROM {SCHEMA}.accounting_source_connections
                        WHERE source_key=ANY(%s)
                        ORDER BY last_session_at DESC""",
                    (requested_sources,),
                ).fetchall()
            ]
        else:
            source = _note_catalog_source(conn)
            if source:
                sources = [dict(source)]
        if request.ensureFresh:
            for source in sources:
                try:
                    _sync_note_catalog(conn, source, subsystem, force=False)
                except (MisaAuthError, WorkerError, HTTPException) as exc:
                    detail = exc.detail if isinstance(exc, HTTPException) else str(exc)
                    sync_warnings.append(
                        f"Chưa kiểm tra được danh mục mới của {source.get('data_space_name') or source['source_key']}: {detail}"
                    )
        source_keys = requested_sources or [source["source_key"] for source in sources]
        if not source_keys:
            return {
                "ok": True,
                "items": [],
                "meta": [],
                "warnings": ["Chưa có kết nối MISA để tải danh mục thuyết minh."],
                "cacheHours": 24,
            }
        where = [
            "i.sub_accounting_system=%s",
            "i.source_key=ANY(%s)",
            "(i.item_code<>'' OR i.item_name<>'')",
        ]
        params: List[Any] = [subsystem, source_keys]
        if not request.includeHidden:
            where.append("i.hidden=false")
        search = re.sub(r"\s+", " ", str(request.search or "").strip())
        if search:
            where.append("(i.item_code ILIKE %s OR i.item_name ILIKE %s OR i.part ILIKE %s)")
            pattern = f"%{search}%"
            params.extend([pattern, pattern, pattern])
        limit = max(1, min(5000, int(request.limit or 2000)))
        params.append(limit)
        rows = conn.execute(
            f"""SELECT DISTINCT ON (i.item_id)
                  i.*,m.last_checked_at,m.last_changed_at,m.last_error
                FROM {SCHEMA}.accounting_note_catalog_items i
                LEFT JOIN {SCHEMA}.accounting_note_catalog_meta m
                  ON m.source_key=i.source_key
                 AND m.sub_accounting_system=i.sub_accounting_system
                WHERE {' AND '.join(where)}
                ORDER BY i.item_id,i.synced_at DESC
                LIMIT %s""",
            tuple(params),
        ).fetchall()
        meta_rows = conn.execute(
            f"""SELECT m.source_key,c.data_space_key,c.data_space_name,m.sub_accounting_system,
                       m.row_count,m.checksum,m.last_checked_at,m.last_changed_at,m.last_error
                FROM {SCHEMA}.accounting_note_catalog_meta m
                JOIN {SCHEMA}.accounting_source_connections c ON c.source_key=m.source_key
                WHERE m.sub_accounting_system=%s AND m.source_key=ANY(%s)
                ORDER BY m.last_checked_at DESC""",
            (subsystem, source_keys),
        ).fetchall()
    items = [
        {
            "itemId": row["item_id"],
            "itemCode": row["item_code"],
            "itemName": row["item_name"],
            "part": row["part"],
            "partInTab": row["part_in_tab"],
            "itemIndex": _safe(row["item_index"]),
            "formulaType": row["formula_type"],
            "isBold": row["is_bold"],
            "isItalic": row["is_italic"],
            "hidden": row["hidden"],
            "sourceKey": row["source_key"],
        }
        for row in sorted(
            rows,
            key=lambda row: (
                str(row.get("part_in_tab") or ""),
                str(row.get("part") or ""),
                float(row.get("item_index") or 0),
                str(row.get("item_code") or ""),
            ),
        )
    ]
    return {
        "ok": True,
        "items": items,
        "meta": [_safe(dict(row)) for row in meta_rows],
        "warnings": sync_warnings,
        "cacheHours": 24,
        "rowCount": len(items),
    }


@app.post("/jobs/start")
def start_run(request: StartRunRequest, _: None = Depends(_auth)) -> Dict[str, Any]:
    if request.periodFrom > request.periodTo:
        raise HTTPException(status_code=400, detail="Từ ngày phải trước hoặc bằng đến ngày")
    source_key = _clean_key(request.sourceKey, "mã nguồn")
    company_key = _clean_key(request.companyKey, "mã công ty")
    pool = _pool()
    run_id = uuid.uuid4()
    snapshot_id = uuid.uuid4()
    with pool.connection() as conn:
        if not _schema_ready(conn):
            raise HTTPException(status_code=409, detail="Hãy khởi tạo cấu trúc PostgreSQL trước")
        with conn.transaction():
            source = conn.execute(
                f"SELECT * FROM {SCHEMA}.accounting_source_connections WHERE source_key=%s",
                (source_key,),
            ).fetchone()
            if not source:
                raise HTTPException(status_code=404, detail="Nguồn chưa có phiên MISA trong worker")
            if company_key != source["company_key"]:
                raise HTTPException(
                    status_code=400,
                    detail="Công ty đã chọn không khớp công ty của khối dữ liệu MISA",
                )
            running = conn.execute(
                f"""SELECT run_id, status FROM {SCHEMA}.accounting_sync_runs
                    WHERE source_key=%s AND company_key=%s AND period_from=%s AND period_to=%s
                      AND status IN ('QUEUED','RUNNING','RETRY','NEEDS_LOGIN')
                    ORDER BY requested_at DESC LIMIT 1""",
                (source_key, company_key, request.periodFrom, request.periodTo),
            ).fetchone()
            if running:
                return {
                    "ok": True,
                    "runId": str(running["run_id"]),
                    "status": running["status"],
                    "reused": True,
                    "autoRunEnabled": AUTORUN_ENABLED,
                    "dataSpaceKey": source["data_space_key"],
                    "dataSpaceName": source["data_space_name"],
                }
            version_row = conn.execute(
                f"SELECT COALESCE(MAX(version_no),0)+1 AS version_no FROM {SCHEMA}.accounting_snapshots WHERE source_key=%s AND company_key=%s AND period_from=%s AND period_to=%s",
                (source_key, company_key, request.periodFrom, request.periodTo),
            ).fetchone()
            version_no = int(version_row["version_no"])
            page_size = max(1, min(MAX_PAGE_SIZE, int(request.pageSize or source["page_size"] or 100)))
            if _is_journal_dataset(source.get("dataset_type")):
                # Endpoint Nhật ký chung hiện tại của MISA chỉ dựng ổn định theo
                # lô 100 dòng (30.064 dòng tương ứng 301 trang trên giao diện).
                page_size = 100
            conn.execute(
                f"""INSERT INTO {SCHEMA}.accounting_snapshots(
                    snapshot_id, source_key, company_key, data_space_key, data_space_name,
                    dataset_type, period_from, period_to, version_no
                  ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                (
                    snapshot_id, source_key, company_key, source["data_space_key"], source["data_space_name"],
                    source["dataset_type"], request.periodFrom, request.periodTo, version_no,
                ),
            )
            conn.execute(
                f"""INSERT INTO {SCHEMA}.accounting_sync_runs(
                    run_id, snapshot_id, source_key, company_key, data_space_key, data_space_name,
                    dataset_type, period_from, period_to, page_size, requested_by, note
                  ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                (
                    run_id, snapshot_id, source_key, company_key,
                    source["data_space_key"], source["data_space_name"], source["dataset_type"],
                    request.periodFrom, request.periodTo, page_size,
                    request.requestedBy.strip(), request.note.strip(),
                ),
            )
    return {
        "ok": True,
        "runId": str(run_id),
        "snapshotId": str(snapshot_id),
        "status": "QUEUED",
        "reused": False,
        "autoRunEnabled": AUTORUN_ENABLED,
        "dataSpaceKey": source["data_space_key"],
        "dataSpaceName": source["data_space_name"],
    }


def _decode_parameters(value: Any) -> Dict[str, Any]:
    if not value:
        return {}
    try:
        return json.loads(base64.b64decode(str(value)).decode("utf-8"))
    except Exception:
        return {}


def _encode_parameters(value: Dict[str, Any]) -> str:
    return base64.b64encode(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")).decode("ascii")


def _misa_parameter_text(value: Any) -> str:
    """Mô phỏng Utility.convertToString mà viewer MISA dùng để ký tham số."""
    if value in (None, False, 0, ""):
        return ""
    if value is True:
        return "true"
    if isinstance(value, list):
        return ",".join(_misa_parameter_text(item) for item in value)
    if isinstance(value, dict):
        return "[object Object]"
    text = str(value)
    # Viewer giữ ngày dưới dạng Date rồi gọi toUTCDateTime() khi tạo
    # p_session_key. Với mili giây bằng 0, chuỗi dùng để ký có hai chữ số
    # thập phân (.00Z), dù JSON gửi lên mạng được serialize thành .000Z.
    # Nếu ký trực tiếp chuỗi JSON thì MISA nhận request nhưng không dựng được
    # Bảng cân đối tài khoản và trả mã 99.
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z", text):
        return text[:-4] + "00Z"
    return text


def _misa_session_key(parameters: Dict[str, Any]) -> str:
    material = "".join(
        _misa_parameter_text(value)
        for key, value in parameters.items()
        if key not in {"p_session_key", "p_is_refresh"}
    )
    return hashlib.sha256(material.encode("utf-8")).hexdigest() if material else ""


def _misa_iso(local_date: date) -> str:
    local_midnight = datetime(local_date.year, local_date.month, local_date.day, tzinfo=LOCAL_TZ)
    return local_midnight.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _request_body(template: Dict[str, Any], run: Dict[str, Any], initial: bool, page_index: int = 1) -> Dict[str, Any]:
    body = json.loads(json.dumps(template, ensure_ascii=False))
    params = _decode_parameters(body.get("parameters"))
    dataset_type = str(run.get("dataset_type") or "").strip().upper()
    if _is_journal_dataset(dataset_type):
        # Tự nâng các khối đã lưu từ cấu hình Nhật ký chung cũ. Nhờ vậy kế toán
        # không phải xóa khối rồi kết nối lại chỉ vì MISA đổi tên tham số/version.
        params.pop("p_is_sum_same_entry", None)
        params.pop("p_is_show_accum", None)
        params.pop("p_is_similar_branch", None)
        params.pop("p_language", None)
        params.setdefault("p_is_similar_sum", False)
        params.setdefault("p_is_show_accum_amount", False)
        report_list = body.get("reportList")
        if isinstance(report_list, dict):
            report_list["version"] = 2
            report_list["rp_function_name_async"] = "func_rpt_gl_general_diary_book_v4"
            report_list.pop("timeout_interval", None)
    elif dataset_type == "TRIAL_BALANCE":
        # Các khối Bảng cân đối đã tạo trước v3.15 thiếu metadata tổng hợp của
        # AccumGLF01_DN. MISA vẫn nhận request và tạo session nhưng sau đó trả
        # Code 99. Nâng mẫu ngay lúc chạy để kế toán không phải xóa và nối lại khối.
        current_template = _trial_balance_request_template()
        body["report_id"] = current_template["report_id"]
        body["columns"] = current_template["columns"]
        report_list = body.get("reportList")
        if not isinstance(report_list, dict):
            report_list = {}
            body["reportList"] = report_list
        report_list.update(current_template["reportList"])
    params["p_from_date"] = _misa_iso(run["period_from"])
    params["p_to_date"] = _misa_iso(run["period_to"])
    params["p_is_refresh"] = bool(initial)
    params["p_session_key"] = _misa_session_key(params)
    body["parameters"] = _encode_parameters(params)
    body["pageSize"] = 100 if _is_journal_dataset(run.get("dataset_type")) else int(run["page_size"])
    body["pageIndex"] = int(page_index)
    body["actionLoadReport"] = 1
    is_journal = _is_journal_dataset(dataset_type)
    if initial:
        # BaseUserControlViewerV2 hiện hành của MISA khởi tạo mọi báo cáo V2
        # bằng chế độ MCP, nhận sessionId rồi mới chuyển isViewMCP=false.
        # Worker không có socket của trình duyệt nên ở bước đọc phiên bên dưới
        # phải dùng nhánh thăm dò định kỳ riêng.
        body["isViewMCP"] = True
        body.pop("sessionId", None)
        body.pop("requestFrom", None)
        body.pop("isOnlyData", None)
        body.pop("group_key", None)
    else:
        body["isViewMCP"] = False
        body["sessionId"] = run["misa_session_id"]
        if page_index <= 1:
            # Viewer Cân đối hiện tại dùng requestFrom=2 khi đọc phiên vừa tạo;
            # Nhật ký chung vẫn dùng requestFrom=1 như luồng đang vận hành tốt.
            body["requestFrom"] = 1 if is_journal else 2
            body.pop("isOnlyData", None)
            body.pop("group_key", None)
        else:
            body["isOnlyData"] = True
            body["group_key"] = None
            body.pop("requestFrom", None)
    return body


def _misa_call(source: Dict[str, Any], credentials: Dict[str, Any], body: Dict[str, Any]) -> Dict[str, Any]:
    headers = {
        "Accept": "application/json, text/plain, */*",
        "Content-Type": "application/json",
        "Authorization": "Bearer " + credentials["bearer"],
        "X-MISA-Context": credentials["misaContext"],
        "Origin": credentials.get("origin") or "https://actapp.misa.vn",
        "Referer": credentials.get("referer") or "https://actapp.misa.vn/",
    }
    if credentials.get("device"):
        headers["X-Device"] = credentials["device"]
    if credentials.get("cookie"):
        headers["Cookie"] = credentials["cookie"]
    try:
        response = httpx.post(source["endpoint_url"], headers=headers, json=body, timeout=REQUEST_TIMEOUT)
    except httpx.HTTPError as exc:
        raise MisaTransientError(f"Không gọi được MISA: {str(exc)[:180]}") from exc
    if response.status_code in (401, 403):
        raise MisaAuthError("Phiên MISA đã hết hạn hoặc không còn quyền truy cập")
    if response.status_code < 200 or response.status_code >= 300:
        message = f"MISA trả HTTP {response.status_code}: {response.text[:220]}"
        if response.status_code == 429 or response.status_code >= 500:
            raise MisaTransientError(message)
        raise WorkerError(message)
    try:
        payload = response.json()
    except ValueError as exc:
        raise WorkerError("MISA không trả JSON hợp lệ") from exc
    if payload.get("Success") is False:
        _raise_misa_payload_failure(payload)
    return payload


def _data_rows(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    data = payload.get("Data") or {}
    rows = data.get("PageData") or []
    if isinstance(rows, str):
        try:
            rows = json.loads(rows)
        except ValueError:
            rows = []
    return [row for row in rows if isinstance(row, dict)]


def _misa_report_session_id(payload: Dict[str, Any]) -> str:
    """Đọc mã phiên từ các biến thể phản hồi mà MISA đang dùng.

    Bảng cân đối thường trả ``Data.SessionId``. Một số báo cáo chi tiết (đặc
    biệt Sổ nhật ký chung) có lúc chỉ gắn ``session_id`` trong dòng dữ liệu đầu
    tiên, hoặc đổi kiểu viết hoa/thường của khóa. Không được coi các phản hồi
    hợp lệ đó là lỗi và tạo lại phiên liên tục.
    """

    def visit(value: Any, depth: int = 0) -> str:
        if depth > 4:
            return ""
        if isinstance(value, dict):
            for key, nested in value.items():
                normalized = re.sub(r"[^a-z0-9]", "", str(key or "").casefold())
                if normalized == "sessionid" and nested not in (None, ""):
                    return str(nested).strip()
            # Ưu tiên vùng dữ liệu báo cáo trước để tránh quét metadata không liên quan.
            for key in ("Data", "data", "PageData", "pageData", "page_data"):
                if key in value:
                    found = visit(value.get(key), depth + 1)
                    if found:
                        return found
            for nested in value.values():
                if isinstance(nested, (dict, list)):
                    found = visit(nested, depth + 1)
                    if found:
                        return found
        elif isinstance(value, list):
            for nested in value[:3]:
                found = visit(nested, depth + 1)
                if found:
                    return found
        elif isinstance(value, str) and value[:1] in ("{", "["):
            try:
                return visit(json.loads(value), depth + 1)
            except ValueError:
                return ""
        return ""

    return visit(payload)


def _misa_session_diagnostic(payload: Dict[str, Any]) -> str:
    """Chỉ trả metadata an toàn để quản trị biết MISA đã đổi dạng phản hồi."""
    data = payload.get("Data")
    if isinstance(data, dict):
        data_shape = ", ".join(sorted(str(key) for key in data.keys())[:12]) or "không có khóa"
    elif isinstance(data, list):
        data_shape = f"danh sách {len(data)} phần tử"
    else:
        data_shape = type(data).__name__
    return f"mã {payload.get('Code', 'không rõ')}; cấu trúc Data: {data_shape}"


def _misa_report_pending(payload: Dict[str, Any], rows: List[Dict[str, Any]]) -> bool:
    """Phân biệt báo cáo MISA đang dựng với một báo cáo rỗng thực sự."""
    if rows:
        return False
    data = payload.get("Data") or {}
    if not isinstance(data, dict) or int(data.get("Total") or 0) > 0:
        return False
    # Code 210 là phản hồi cấp/đang dựng phiên báo cáo của MISA. Code 211 mới
    # là phản hồi dữ liệu hoàn chỉnh; vì vậy không dùng riêng TableEmpty=False
    # để kết luận đang chờ (MISA vẫn có thể trả cờ này cho báo cáo thật sự rỗng).
    return int(payload.get("Code") or 0) in {210, 212} or data.get("isCheckSessionStatus") is True


def _validate_misa_page_row_count(
    rows: List[Dict[str, Any]], total_rows: int, page_size: int, page_index: int
) -> None:
    """Không chấp nhận một trang MISA bị thiếu tạm thời.

    MISA đôi khi vẫn trả HTTP/Code thành công nhưng ``PageData`` rỗng ở một
    trang giữa. Nếu đánh dấu trang đó hoàn tất, snapshot sẽ thiếu đúng một
    trang và chỉ bị phát hiện ở bước chốt cuối. Khi tổng số dòng đã biết, số
    dòng hợp lệ của từng trang cũng xác định được; lệch số phải được retry tại
    chính trang đó, tuyệt đối không kích hoạt bản dữ liệu khuyết.
    """
    if total_rows <= 0 or page_size <= 0 or page_index <= 0:
        return
    expected = min(page_size, max(0, total_rows - ((page_index - 1) * page_size)))
    actual = len(rows)
    if actual != expected:
        total_pages = int(math.ceil(total_rows / page_size))
        raise MisaTransientError(
            f"MISA tạm trả thiếu dữ liệu ở trang {page_index}/{total_pages}: "
            f"nhận {actual}/{expected} dòng"
        )


def _decimal(value: Any) -> Decimal:
    try:
        return Decimal(str(value if value not in (None, "") else 0))
    except Exception:
        return Decimal(0)


MAX_ACCOUNTING_FILE_BYTES = max(
    1_000_000,
    min(30_000_000, int(os.getenv("ACCOUNTING_MAX_IMPORT_BYTES", "20000000"))),
)
FILE_IMPORT_PAGE_SIZE = max(
    200,
    min(5000, int(os.getenv("ACCOUNTING_FILE_IMPORT_PAGE_SIZE", "2000"))),
)


def _file_header_text(value: Any) -> str:
    normalized = unicodedata.normalize("NFD", str(value or "").strip().lower())
    normalized = "".join(
        character
        for character in normalized
        if unicodedata.category(character) != "Mn"
    ).replace("đ", "d")
    return re.sub(r"[^a-z0-9]+", " ", normalized).strip()


FILE_HEADER_ALIASES: Dict[str, Dict[str, set[str]]] = {
    "TRIAL_BALANCE": {
        "account_number": {"so tai khoan", "ma tai khoan", "tai khoan"},
        "account_name": {"ten tai khoan", "ten tk"},
        "opening_debit_amount": {"dau ky no", "so du dau ky no", "du dau ky no"},
        "opening_credit_amount": {"dau ky co", "so du dau ky co", "du dau ky co"},
        "debit_amount": {"phat sinh no", "phat sinh trong ky no", "trong ky no"},
        "credit_amount": {"phat sinh co", "phat sinh trong ky co", "trong ky co"},
        "accum_debit_amount": {
            "phat sinh no luy ke", "phat sinh luy ke no", "luy ke no",
        },
        "accum_credit_amount": {
            "phat sinh co luy ke", "phat sinh luy ke co", "luy ke co",
        },
        "closing_debit_amount": {"cuoi ky no", "so du cuoi ky no", "du cuoi ky no"},
        "closing_credit_amount": {"cuoi ky co", "so du cuoi ky co", "du cuoi ky co"},
    },
    "GENERAL_LEDGER": {
        "posted_date": {"ngay hach toan", "ngay ghi so", "ngay ghi so cai"},
        "refdate": {"ngay chung tu", "ngay ct"},
        "refno": {"so chung tu", "so ct"},
        "inv_date": {"ngay hoa don", "ngay hd"},
        "inv_no": {"so hoa don", "so hd"},
        "journal_memo": {"dien giai chung", "noi dung chung"},
        "description": {"dien giai", "noi dung", "noi dung nghiep vu"},
        "account_number": {"tai khoan", "so tai khoan", "tk"},
        "corresponding_account_number": {
            "tk doi ung", "tai khoan doi ung", "so tai khoan doi ung",
        },
        "debit_amount": {"phat sinh no", "so tien no", "no"},
        "credit_amount": {"phat sinh co", "so tien co", "co"},
        "expense_item_code": {"ma kmcp", "ma khoan muc chi phi"},
        "expense_item_name": {"ten kmcp", "ten khoan muc chi phi"},
        "cash_flow_code": {"muc thu chi", "ma muc thu chi", "muc thu chi ma"},
        "cash_flow_name": {"ten muc thu chi", "muc thu chi ten"},
        "organization_unit_code": {"ma don vi", "ma phong ban"},
        "organization_unit_name": {"ten don vi", "ten phong ban"},
        "un_resonable_cost": {
            "cp hop ly khong hop ly", "chi phi hop ly khong hop ly",
        },
    },
}

FILE_REQUIRED_FIELDS = {
    "TRIAL_BALANCE": {
        "account_number", "account_name", "opening_debit_amount",
        "opening_credit_amount", "debit_amount", "credit_amount",
        "closing_debit_amount", "closing_credit_amount",
    },
    "GENERAL_LEDGER": {
        "posted_date", "account_number", "corresponding_account_number",
        "debit_amount", "credit_amount",
    },
}

FILE_FIELD_LABELS = {
    "posted_date": "Ngày hạch toán",
    "refdate": "Ngày chứng từ",
    "refno": "Số chứng từ",
    "inv_date": "Ngày hóa đơn",
    "inv_no": "Số hóa đơn",
    "journal_memo": "Diễn giải chung",
    "description": "Diễn giải",
    "account_number": "Tài khoản",
    "account_name": "Tên tài khoản",
    "corresponding_account_number": "Tài khoản đối ứng",
    "opening_debit_amount": "Đầu kỳ Nợ",
    "opening_credit_amount": "Đầu kỳ Có",
    "debit_amount": "Phát sinh Nợ",
    "credit_amount": "Phát sinh Có",
    "accum_debit_amount": "Lũy kế Nợ",
    "accum_credit_amount": "Lũy kế Có",
    "closing_debit_amount": "Cuối kỳ Nợ",
    "closing_credit_amount": "Cuối kỳ Có",
    "expense_item_code": "Mã khoản mục chi phí",
    "expense_item_name": "Tên khoản mục chi phí",
    "cash_flow_code": "Mục thu/chi",
    "cash_flow_name": "Tên mục thu/chi",
    "organization_unit_code": "Mã đơn vị",
    "organization_unit_name": "Tên đơn vị",
    "un_resonable_cost": "Chi phí hợp lý/không hợp lý",
}


def _decode_accounting_file(file_name: str, data_url: str) -> tuple[bytes, str]:
    safe_name = re.sub(r"[\\/]+", "_", str(file_name or "").strip())[:180]
    if not safe_name:
        raise HTTPException(status_code=400, detail="Tệp Excel chưa có tên")
    if not safe_name.lower().endswith((".xlsx", ".xlsm")):
        raise HTTPException(
            status_code=400,
            detail="Chỉ nhận tệp Excel .xlsx hoặc .xlsm; tệp .xls cũ cần lưu lại thành .xlsx",
        )
    encoded = str(data_url or "").strip()
    if "," in encoded and encoded.lower().startswith("data:"):
        encoded = encoded.split(",", 1)[1]
    try:
        content = base64.b64decode(encoded, validate=True)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Không đọc được nội dung tệp Excel") from exc
    if not content or len(content) > MAX_ACCOUNTING_FILE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Tệp Excel phải nhỏ hơn {MAX_ACCOUNTING_FILE_BYTES // 1_000_000} MB",
        )
    if not content.startswith(b"PK"):
        raise HTTPException(status_code=400, detail="Nội dung không phải tệp Excel .xlsx hợp lệ")
    return content, safe_name


def _open_accounting_workbook(content: bytes):
    try:
        return load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail="Không mở được tệp Excel. Hãy kiểm tra tệp có bị khóa mật khẩu hoặc hỏng không.",
        ) from exc


def _row_values(sheet: Any, row_index: int) -> List[Any]:
    return [cell.value for cell in next(sheet.iter_rows(min_row=row_index, max_row=row_index))]


def _combined_file_headers(sheet: Any, row_index: int, depth: int) -> List[str]:
    primary = _row_values(sheet, row_index)
    if depth <= 1 or row_index >= sheet.max_row:
        return [re.sub(r"\s+", " ", str(value or "").strip()) for value in primary]
    secondary = _row_values(sheet, row_index + 1)
    carried: List[str] = []
    parent = ""
    for value in primary:
        current = re.sub(r"\s+", " ", str(value or "").strip())
        if current:
            parent = current
        carried.append(parent)
    headers: List[str] = []
    for index in range(max(len(carried), len(secondary))):
        parent_value = carried[index] if index < len(carried) else ""
        child_value = re.sub(
            r"\s+", " ", str((secondary[index] if index < len(secondary) else "") or "").strip(),
        )
        if child_value and _file_header_text(child_value) != _file_header_text(parent_value):
            headers.append(f"{parent_value} {child_value}".strip())
        else:
            headers.append(parent_value or child_value)
    return headers


def _map_file_headers(headers: List[str], dataset_type: str) -> Dict[int, str]:
    aliases = FILE_HEADER_ALIASES[dataset_type]
    alias_to_field = {
        alias: field
        for field, values in aliases.items()
        for alias in values
    }
    mapping: Dict[int, str] = {}
    used: set[str] = set()
    for index, header in enumerate(headers):
        normalized = _file_header_text(header)
        field = alias_to_field.get(normalized)
        if field and field not in used:
            mapping[index] = field
            used.add(field)
    return mapping


def _file_header_candidate(
    sheet: Any,
    row_index: int,
    depth: int,
    dataset_type: str,
) -> Dict[str, Any]:
    headers = _combined_file_headers(sheet, row_index, depth)
    mapping = _map_file_headers(headers, dataset_type)
    recognized = set(mapping.values())
    required = FILE_REQUIRED_FIELDS[dataset_type]
    required_count = len(recognized & required)
    return {
        "datasetType": dataset_type,
        "headerRow": row_index,
        "headerDepth": depth,
        "headers": headers,
        "mapping": mapping,
        "recognizedCount": len(recognized),
        "requiredCount": required_count,
        "missing": sorted(required - recognized),
        "score": required_count * 100 + len(recognized) * 5 - (depth - 1),
    }


def _detect_file_layout(
    sheet: Any,
    requested_dataset_type: str = "AUTO",
    requested_header_row: int = 0,
) -> Dict[str, Any]:
    requested_type = str(requested_dataset_type or "AUTO").strip().upper()
    if requested_type == "GENERAL_JOURNAL":
        requested_type = "GENERAL_LEDGER"
    if requested_type not in {"AUTO", "TRIAL_BALANCE", "GENERAL_LEDGER"}:
        raise HTTPException(status_code=400, detail="Loại sổ Excel chưa được hỗ trợ")
    if requested_header_row < 0 or requested_header_row > sheet.max_row:
        raise HTTPException(status_code=400, detail="Dòng tiêu đề nằm ngoài phạm vi trang tính")
    row_indexes = (
        [requested_header_row]
        if requested_header_row
        else list(range(1, min(int(sheet.max_row or 1), 60) + 1))
    )
    dataset_types = (
        [requested_type]
        if requested_type != "AUTO"
        else ["TRIAL_BALANCE", "GENERAL_LEDGER"]
    )
    candidates: List[Dict[str, Any]] = []
    for row_index in row_indexes:
        for dataset_type in dataset_types:
            candidates.append(_file_header_candidate(sheet, row_index, 1, dataset_type))
            if row_index < sheet.max_row:
                candidates.append(_file_header_candidate(sheet, row_index, 2, dataset_type))
    candidate = max(candidates, key=lambda item: item["score"])
    # Tệp một dòng tiêu đề không được nhận nhầm dòng dữ liệu kế tiếp làm tầng 2.
    same_row_depth_one = next(
        (
            item for item in candidates
            if item["datasetType"] == candidate["datasetType"]
            and item["headerRow"] == candidate["headerRow"]
            and item["headerDepth"] == 1
        ),
        None,
    )
    if same_row_depth_one and same_row_depth_one["requiredCount"] == candidate["requiredCount"]:
        candidate = same_row_depth_one
    if candidate["requiredCount"] < len(FILE_REQUIRED_FIELDS[candidate["datasetType"]]):
        missing_labels = ", ".join(FILE_FIELD_LABELS.get(key, key) for key in candidate["missing"])
        raise HTTPException(
            status_code=400,
            detail=(
                f"Chưa nhận đủ cột của {('Bảng cân đối tài khoản' if candidate['datasetType'] == 'TRIAL_BALANCE' else 'Sổ nhật ký chung')}. "
                f"Còn thiếu: {missing_labels}. Hãy chọn lại dòng tiêu đề."
            ),
        )
    return candidate


def _infer_file_month_year(file_name: str, sheet: Any) -> tuple[int, int]:
    samples = [str(file_name or "")]
    for row in sheet.iter_rows(min_row=1, max_row=min(12, sheet.max_row), values_only=True):
        samples.extend(str(value) for value in row if value not in (None, ""))
    normalized = _file_header_text(" ".join(samples))
    patterns = (
        r"thang\s*(\d{1,2})\s*(?:nam\s*)?(20\d{2})",
        r"\bt\s*(\d{1,2})\s*(20\d{2})\b",
    )
    for pattern in patterns:
        match = re.search(pattern, normalized)
        if match:
            month, year = int(match.group(1)), int(match.group(2))
            if 1 <= month <= 12:
                return month, year
    return 0, 0


def _file_date_value(value: Any) -> str:
    if isinstance(value, datetime):
        local = value.replace(tzinfo=LOCAL_TZ) if value.tzinfo is None else value
        return local.isoformat()
    if isinstance(value, date):
        return datetime(value.year, value.month, value.day, tzinfo=LOCAL_TZ).isoformat()
    text = re.sub(r"\s+", " ", str(value or "").strip())
    if not text:
        return ""
    for format_value in ("%d/%m/%Y", "%d-%m-%Y", "%Y-%m-%d", "%m/%d/%Y"):
        try:
            parsed = datetime.strptime(text, format_value).replace(tzinfo=LOCAL_TZ)
            return parsed.isoformat()
        except ValueError:
            continue
    return text


def _file_cell_value(field: str, value: Any) -> Any:
    if field in {"posted_date", "refdate", "inv_date"}:
        return _file_date_value(value)
    if field in {
        "opening_debit_amount", "opening_credit_amount", "debit_amount",
        "credit_amount", "accum_debit_amount", "accum_credit_amount",
        "closing_debit_amount", "closing_credit_amount",
    }:
        return str(_decimal(value))
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def _mapped_file_row(values: tuple[Any, ...], mapping: Dict[int, str]) -> Dict[str, Any]:
    return {
        field: _file_cell_value(field, values[index] if index < len(values) else None)
        for index, field in mapping.items()
    }


def _file_row_is_data(raw: Dict[str, Any], dataset_type: str) -> bool:
    account_number = str(raw.get("account_number") or "").strip()
    if not account_number or _file_header_text(account_number) in {"tong", "tong cong", "cong"}:
        return False
    if dataset_type == "TRIAL_BALANCE":
        return True
    return bool(str(raw.get("corresponding_account_number") or "").strip()) and (
        _decimal(raw.get("debit_amount")) != 0
        or _decimal(raw.get("credit_amount")) != 0
    )


def _file_preview_rows(sheet: Any, layout: Dict[str, Any], limit: int = 5) -> tuple[List[Dict[str, Any]], int]:
    samples: List[Dict[str, Any]] = []
    row_count = 0
    start_row = int(layout["headerRow"]) + int(layout["headerDepth"])
    for values in sheet.iter_rows(min_row=start_row, values_only=True):
        raw = _mapped_file_row(values, layout["mapping"])
        if not _file_row_is_data(raw, layout["datasetType"]):
            continue
        row_count += 1
        if len(samples) < limit:
            samples.append(raw)
    return samples, row_count


def _workbook_company_name(sheet: Any) -> str:
    for row in sheet.iter_rows(min_row=1, max_row=min(12, sheet.max_row), values_only=True):
        for value in row:
            text = re.sub(r"\s+", " ", str(value or "").strip())
            normalized = _file_header_text(text)
            if normalized.startswith("cong ty ") and len(text) <= 180:
                return text
    return ""


def _proposed_file_space_name(company_label: str, company_key: str, year: int) -> str:
    base = re.sub(r"\s+", " ", str(company_label or company_key or "").strip())
    if year:
        return f"{base}_{year}"
    return base


def _accounting_file_preview(
    workbook: Any,
    request: AccountingFilePreviewRequest,
    safe_name: str,
) -> Dict[str, Any]:
    sheet_names = list(workbook.sheetnames)
    requested_sheet = str(request.sheetName or "").strip()
    if requested_sheet and requested_sheet not in sheet_names:
        raise HTTPException(status_code=400, detail="Không tìm thấy trang tính đã chọn")
    if requested_sheet:
        sheet = workbook[requested_sheet]
        layout = _detect_file_layout(sheet, request.datasetType, int(request.headerRow or 0))
    else:
        detected: List[tuple[Any, Dict[str, Any]]] = []
        errors: List[str] = []
        for name in sheet_names:
            candidate_sheet = workbook[name]
            try:
                candidate_layout = _detect_file_layout(
                    candidate_sheet, request.datasetType, int(request.headerRow or 0),
                )
                detected.append((candidate_sheet, candidate_layout))
            except HTTPException as exc:
                errors.append(str(exc.detail))
        if not detected:
            raise HTTPException(
                status_code=400,
                detail=errors[0] if errors else "Không tìm thấy trang tính có cấu trúc kế toán phù hợp",
            )
        sheet, layout = max(detected, key=lambda item: item[1]["score"])
    month, year = _infer_file_month_year(safe_name, sheet)
    period_from = ""
    period_to = ""
    if month and year:
        period_from = date(year, month, 1).isoformat()
        period_to = date(year, month, calendar.monthrange(year, month)[1]).isoformat()
    samples, row_count = _file_preview_rows(sheet, layout)
    mappings = [
        {
            "columnIndex": index + 1,
            "sourceHeader": layout["headers"][index],
            "targetField": field,
            "targetLabel": FILE_FIELD_LABELS.get(field, field),
        }
        for index, field in sorted(layout["mapping"].items())
    ]
    return {
        "ok": True,
        "fileName": safe_name,
        "sheetName": sheet.title,
        "sheetNames": sheet_names,
        "datasetType": layout["datasetType"],
        "datasetLabel": (
            "Bảng cân đối tài khoản"
            if layout["datasetType"] == "TRIAL_BALANCE"
            else "Sổ nhật ký chung"
        ),
        "headerRow": layout["headerRow"],
        "headerDepth": layout["headerDepth"],
        "periodFrom": period_from,
        "periodTo": period_to,
        "year": year,
        "rowCount": row_count,
        "workbookCompanyName": _workbook_company_name(sheet),
        "proposedDataSpaceName": _proposed_file_space_name(
            request.companyLabel, request.companyKey, year,
        ),
        "mappings": mappings,
        "sampleRows": samples,
        "message": (
            f"Đã nhận {layout['datasetType']} tại dòng tiêu đề {layout['headerRow']}"
            + ("–" + str(layout["headerRow"] + 1) if layout["headerDepth"] == 2 else "")
            + f", có {row_count:,} dòng dữ liệu."
        ),
    }


TRANSIENT_FIELDS = {"session_id", "detail_id", "row_index", "sort_index"}
AMOUNT_FIELDS = {
    "opening_debit": "opening_debit_amount",
    "opening_credit": "opening_credit_amount",
    "period_debit": "debit_amount",
    "period_credit": "credit_amount",
    "ytd_debit": "accum_debit_amount",
    "ytd_credit": "accum_credit_amount",
    "closing_debit": "closing_debit_amount",
    "closing_credit": "closing_credit_amount",
}
JOURNAL_DATASET_TYPES = {"GENERAL_LEDGER", "GENERAL_JOURNAL", "GL_GENERAL_DIARY"}


def _is_journal_dataset(dataset_type: Any) -> bool:
    return str(dataset_type or "").strip().upper() in JOURNAL_DATASET_TYPES


def _canonical_row(raw: Dict[str, Any], dataset_type: str) -> Dict[str, Any]:
    if _is_journal_dataset(dataset_type):
        normalized = normalize_misa_journal_row(raw)
        return journal_canonical_data(raw, normalized)
    removed = set(TRANSIENT_FIELDS)
    if dataset_type == "TRIAL_BALANCE":
        removed.update(AMOUNT_FIELDS.values())
    canonical = {key: value for key, value in raw.items() if key not in removed}
    if dataset_type == "TRIAL_BALANCE":
        for target, source in AMOUNT_FIELDS.items():
            canonical[target] = str(_decimal(raw.get(source)))
    return canonical


def _row_key(raw: Dict[str, Any], canonical: Dict[str, Any], dataset_type: str) -> str:
    if dataset_type == "TRIAL_BALANCE":
        stable = raw.get("account_id") or raw.get("account_number")
        if stable:
            return str(stable).strip()
    voucher = raw.get("voucher_id") or raw.get("refid") or raw.get("ref_id")
    line = raw.get("line_id") or raw.get("detail_id")
    if voucher and line:
        return f"{voucher}:{line}"
    stable_fields = {key: value for key, value in canonical.items() if key not in set(AMOUNT_FIELDS) | {"amount"}}
    return hashlib.sha256(json.dumps(stable_fields, ensure_ascii=False, sort_keys=True, default=str).encode("utf-8")).hexdigest()


def _insert_page(conn: psycopg.Connection, run: Dict[str, Any], rows: List[Dict[str, Any]], page_index: int) -> str:
    values = []
    journal_values = []
    page_digest = hashlib.sha256()
    for raw in rows:
        journal = (
            normalize_misa_journal_row(raw)
            if _is_journal_dataset(run["dataset_type"])
            else None
        )
        canonical = (
            journal_canonical_data(raw, journal)
            if journal is not None
            else _canonical_row(raw, run["dataset_type"])
        )
        source_row_key = _row_key(raw, canonical, run["dataset_type"])
        canonical_json = json.dumps(canonical, ensure_ascii=False, sort_keys=True, default=str, separators=(",", ":"))
        row_hash = hashlib.sha256(canonical_json.encode("utf-8")).hexdigest()
        page_digest.update(source_row_key.encode("utf-8"))
        page_digest.update(row_hash.encode("ascii"))
        values.append((
            run["snapshot_id"], run["source_key"], run["company_key"],
            run["data_space_key"], run["data_space_name"], run["period_from"], run["period_to"],
            source_row_key, str(raw.get("account_id") or ""), str(raw.get("account_number") or ""),
            str(raw.get("account_name") or ""), int(raw["grade"]) if raw.get("grade") not in (None, "") else None,
            _decimal(raw.get("opening_debit_amount")), _decimal(raw.get("opening_credit_amount")),
            journal["raw_debit"] if journal is not None else _decimal(raw.get("debit_amount")),
            journal["raw_credit"] if journal is not None else _decimal(raw.get("credit_amount")),
            _decimal(raw.get("accum_debit_amount")), _decimal(raw.get("accum_credit_amount")),
            _decimal(raw.get("closing_debit_amount")), _decimal(raw.get("closing_credit_amount")),
            row_hash, canonical_json, page_index,
        ))
        if journal is not None and journal["is_canonical_posting"]:
            journal_values.append((
                run["snapshot_id"], source_row_key, run["source_key"], run["company_key"],
                run["data_space_key"], run["data_space_name"], run["period_from"], run["period_to"],
                journal["posted_at"], journal["document_at"], journal["invoice_at"],
                journal["reference_id"], journal["reference_no"], journal["invoice_no"],
                journal["journal_memo"], journal["description"], journal["debit_account"],
                journal["credit_account"], journal["amount"], journal["amount_original"],
                journal["currency_id"], journal["exchange_rate"], journal["reference_type"],
                journal["reference_type_name"], journal["entry_type"], journal["is_closing_entry"],
                journal["is_reversal"], journal["intercompany_partner"], journal["branch_id"],
                journal["organization_unit_code"], journal["account_object_code"],
                journal["expense_item_code"], journal["transaction_class"],
                json.dumps(journal["dimensions"], ensure_ascii=False, default=str, separators=(",", ":")),
                json.dumps(journal["raw_data"], ensure_ascii=False, default=str, separators=(",", ":")),
                journal["posting_hash"], page_index,
            ))
    if values:
        with conn.cursor() as cursor:
            cursor.executemany(
                f"""INSERT INTO {SCHEMA}.accounting_source_rows(
              snapshot_id, source_key, company_key, data_space_key, data_space_name,
              period_from, period_to, source_row_key,
              account_id, account_number, account_name, grade,
              opening_debit, opening_credit, period_debit, period_credit,
              ytd_debit, ytd_credit, closing_debit, closing_credit,
              row_hash, canonical_data, source_page
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s)
            ON CONFLICT(snapshot_id, source_row_key) DO UPDATE SET
              data_space_key=excluded.data_space_key, data_space_name=excluded.data_space_name,
              account_id=excluded.account_id, account_number=excluded.account_number,
              account_name=excluded.account_name, grade=excluded.grade,
              opening_debit=excluded.opening_debit, opening_credit=excluded.opening_credit,
              period_debit=excluded.period_debit, period_credit=excluded.period_credit,
              ytd_debit=excluded.ytd_debit, ytd_credit=excluded.ytd_credit,
              closing_debit=excluded.closing_debit, closing_credit=excluded.closing_credit,
              row_hash=excluded.row_hash, canonical_data=excluded.canonical_data,
              source_page=excluded.source_page""",
                values,
            )
    if journal_values:
        with conn.cursor() as cursor:
            cursor.executemany(
                f"""INSERT INTO {SCHEMA}.accounting_journal_entries(
                  snapshot_id,source_row_key,source_key,company_key,data_space_key,data_space_name,
                  period_from,period_to,posted_at,document_at,invoice_at,reference_id,reference_no,
                  invoice_no,journal_memo,description,debit_account,credit_account,amount,
                  amount_original,currency_id,exchange_rate,reference_type,reference_type_name,
                  entry_type,is_closing_entry,is_reversal,intercompany_partner,branch_id,
                  organization_unit_code,account_object_code,expense_item_code,transaction_class,
                  dimensions,raw_data,posting_hash,source_page
                ) VALUES (
                  %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,
                  %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s::jsonb,%s,%s
                )
                ON CONFLICT(snapshot_id,source_row_key) DO UPDATE SET
                  posted_at=excluded.posted_at,document_at=excluded.document_at,
                  invoice_at=excluded.invoice_at,reference_id=excluded.reference_id,
                  reference_no=excluded.reference_no,invoice_no=excluded.invoice_no,
                  journal_memo=excluded.journal_memo,description=excluded.description,
                  debit_account=excluded.debit_account,credit_account=excluded.credit_account,
                  amount=excluded.amount,amount_original=excluded.amount_original,
                  currency_id=excluded.currency_id,exchange_rate=excluded.exchange_rate,
                  reference_type=excluded.reference_type,reference_type_name=excluded.reference_type_name,
                  entry_type=excluded.entry_type,is_closing_entry=excluded.is_closing_entry,
                  is_reversal=excluded.is_reversal,intercompany_partner=excluded.intercompany_partner,
                  branch_id=excluded.branch_id,organization_unit_code=excluded.organization_unit_code,
                  account_object_code=excluded.account_object_code,expense_item_code=excluded.expense_item_code,
                  transaction_class=excluded.transaction_class,dimensions=excluded.dimensions,
                  raw_data=excluded.raw_data,posting_hash=excluded.posting_hash,source_page=excluded.source_page""",
                journal_values,
            )
    return page_digest.hexdigest()


def _upsert_data_control(
    conn: psycopg.Connection,
    run: Dict[str, Any],
    control_key: str,
    status: str,
    debit_total: Decimal = Decimal(0),
    credit_total: Decimal = Decimal(0),
    difference: Decimal = Decimal(0),
    issue_count: int = 0,
    details: Optional[Dict[str, Any]] = None,
) -> None:
    conn.execute(
        f"""INSERT INTO {SCHEMA}.accounting_data_controls(
              run_id,snapshot_id,control_key,status,debit_total,credit_total,
              difference,issue_count,details
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb)
            ON CONFLICT(run_id,control_key) DO UPDATE SET
              status=excluded.status,debit_total=excluded.debit_total,
              credit_total=excluded.credit_total,difference=excluded.difference,
              issue_count=excluded.issue_count,details=excluded.details,checked_at=now()""",
        (
            run["run_id"], run["snapshot_id"], control_key, status,
            debit_total, credit_total, difference, int(issue_count),
            json.dumps(details or {}, ensure_ascii=False, default=str, separators=(",", ":")),
        ),
    )


def _finalize_journal(conn: psycopg.Connection, run: Dict[str, Any]) -> Dict[str, int]:
    snapshot_id = run["snapshot_id"]
    totals = conn.execute(
        f"""SELECT
              COALESCE(sum(period_debit),0) AS debit_total,
              COALESCE(sum(period_credit),0) AS credit_total,
              count(*) FILTER (WHERE canonical_data->>'posting_side'='ZERO') AS zero_rows,
              count(*) FILTER (WHERE canonical_data->>'posting_side'='MIXED') AS mixed_rows
            FROM {SCHEMA}.accounting_source_rows WHERE snapshot_id=%s""",
        (snapshot_id,),
    ).fetchone()
    debit_total = Decimal(totals["debit_total"] or 0)
    credit_total = Decimal(totals["credit_total"] or 0)
    balance_difference = debit_total - credit_total
    mixed_rows = int(totals["mixed_rows"] or 0)
    missing_dates = int(
        conn.execute(
            f"SELECT count(*) AS total FROM {SCHEMA}.accounting_journal_entries WHERE snapshot_id=%s AND posted_at IS NULL",
            (snapshot_id,),
        ).fetchone()["total"]
    )
    canonical_total = Decimal(
        conn.execute(
            f"SELECT COALESCE(sum(amount),0) AS total FROM {SCHEMA}.accounting_journal_entries WHERE snapshot_id=%s",
            (snapshot_id,),
        ).fetchone()["total"]
        or 0
    )
    mirror_issue_count = int(
        conn.execute(
            f"""SELECT count(*) AS total FROM (
                  SELECT canonical_data->>'posting_hash' AS posting_hash,
                         count(*) FILTER (WHERE canonical_data->>'posting_side'='DEBIT') AS debit_rows,
                         count(*) FILTER (WHERE canonical_data->>'posting_side'='CREDIT') AS credit_rows
                  FROM {SCHEMA}.accounting_source_rows
                  WHERE snapshot_id=%s AND canonical_data->>'posting_hash'<>''
                  GROUP BY canonical_data->>'posting_hash'
                  HAVING count(*) FILTER (WHERE canonical_data->>'posting_side'='DEBIT')
                       <> count(*) FILTER (WHERE canonical_data->>'posting_side'='CREDIT')
                ) mismatches""",
            (snapshot_id,),
        ).fetchone()["total"]
        or 0
    )
    canonical_difference = canonical_total - debit_total
    integrity_issues = mirror_issue_count + mixed_rows + missing_dates
    if (
        abs(balance_difference) > Decimal("0.01")
        or abs(canonical_difference) > Decimal("0.01")
        or integrity_issues
    ):
        raise WorkerError(
            "Chưa thể kích hoạt Nhật ký chung: "
            f"Nợ - Có {balance_difference}, lệch dòng chuẩn {canonical_difference}, "
            f"{mirror_issue_count} cặp đối xứng lỗi, {mixed_rows} dòng vừa Nợ vừa Có, "
            f"{missing_dates} dòng thiếu ngày hạch toán"
        )

    conn.execute(
        f"DELETE FROM {SCHEMA}.accounting_journal_monthly WHERE snapshot_id=%s",
        (snapshot_id,),
    )
    conn.execute(
        f"""INSERT INTO {SCHEMA}.accounting_journal_monthly(
              snapshot_id,source_key,company_key,data_space_key,data_space_name,month_start,
              debit_account,credit_account,branch_id,organization_unit_code,
              account_object_code,expense_item_code,transaction_class,cash_flow_code,reference_type,
              entry_type,is_closing_entry,is_reversal,intercompany_partner,currency_id,
              entry_count,amount,amount_original
            )
            SELECT snapshot_id,source_key,company_key,data_space_key,data_space_name,
              date_trunc('month',posted_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,
              debit_account,credit_account,branch_id,
              organization_unit_code,account_object_code,expense_item_code,transaction_class,
              COALESCE(dimensions->>'cash_flow_code',''),reference_type,entry_type,is_closing_entry,is_reversal,intercompany_partner,
              currency_id,count(*),sum(amount),sum(amount_original)
            FROM {SCHEMA}.accounting_journal_entries
            WHERE snapshot_id=%s AND posted_at IS NOT NULL
            GROUP BY snapshot_id,source_key,company_key,data_space_key,data_space_name,
              date_trunc('month',posted_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,
              debit_account,credit_account,branch_id,
              organization_unit_code,account_object_code,expense_item_code,transaction_class,
              COALESCE(dimensions->>'cash_flow_code',''),reference_type,entry_type,is_closing_entry,is_reversal,intercompany_partner,currency_id""",
        (snapshot_id,),
    )
    monthly_rows = int(
        conn.execute(
            f"SELECT count(*) AS total FROM {SCHEMA}.accounting_journal_monthly WHERE snapshot_id=%s",
            (snapshot_id,),
        ).fetchone()["total"]
    )
    entry_rows = int(
        conn.execute(
            f"SELECT count(*) AS total FROM {SCHEMA}.accounting_journal_entries WHERE snapshot_id=%s",
            (snapshot_id,),
        ).fetchone()["total"]
    )
    _upsert_data_control(
        conn, run, "JOURNAL_DOUBLE_ENTRY", "PASS",
        debit_total, credit_total, balance_difference, 0,
        {
            "rawRows": int(run.get("source_total_rows") or 0),
            "canonicalEntries": entry_rows,
            "monthlyGroups": monthly_rows,
            "zeroRows": int(totals["zero_rows"] or 0),
        },
    )
    _upsert_data_control(
        conn, run, "JOURNAL_MIRROR_COVERAGE", "PASS",
        canonical_total, debit_total, canonical_difference, 0,
        {"mirrorIssueCount": 0, "mixedRows": 0, "missingPostingDates": 0},
    )
    return {"journal_entry_rows": entry_rows, "journal_monthly_rows": monthly_rows}


def _reconcile_journal_to_trial_balance(
    conn: psycopg.Connection,
    run: Dict[str, Any],
    current_snapshot_id: uuid.UUID,
) -> None:
    if _is_journal_dataset(run["dataset_type"]):
        journal_snapshot_id = current_snapshot_id
        trial = conn.execute(
            f"""SELECT a.snapshot_id FROM {SCHEMA}.accounting_active_snapshots a
              JOIN {SCHEMA}.accounting_snapshots s ON s.snapshot_id=a.snapshot_id
              WHERE a.company_key=%s AND a.data_space_key=%s
                AND a.period_from=%s AND a.period_to=%s AND s.dataset_type='TRIAL_BALANCE'
              ORDER BY a.activated_at DESC LIMIT 1""",
            (
                run["company_key"], run["data_space_key"],
                run["period_from"], run["period_to"],
            ),
        ).fetchone()
        trial_snapshot_id = trial["snapshot_id"] if trial else None
    else:
        trial_snapshot_id = current_snapshot_id
        journal = conn.execute(
            f"""SELECT a.snapshot_id FROM {SCHEMA}.accounting_active_snapshots a
              JOIN {SCHEMA}.accounting_snapshots s ON s.snapshot_id=a.snapshot_id
              WHERE a.company_key=%s AND a.data_space_key=%s
                AND a.period_from<=%s AND a.period_to>=%s AND s.dataset_type=ANY(%s)
              ORDER BY (a.period_to-a.period_from),a.activated_at DESC LIMIT 1""",
            (
                run["company_key"], run["data_space_key"],
                run["period_from"], run["period_to"], sorted(JOURNAL_DATASET_TYPES),
            ),
        ).fetchone()
        journal_snapshot_id = journal["snapshot_id"] if journal else None
    if not journal_snapshot_id or not trial_snapshot_id:
        _upsert_data_control(
            conn, run, "JOURNAL_TO_TRIAL_BALANCE", "SKIPPED",
            details={
                "reason": "Chưa có đủ Nhật ký chung và Bảng cân đối tài khoản cùng công ty, khối dữ liệu và kỳ.",
                "journalSnapshotId": str(journal_snapshot_id or ""),
                "trialBalanceSnapshotId": str(trial_snapshot_id or ""),
            },
        )
        return
    mismatches = conn.execute(
        f"""WITH journal AS (
              SELECT account_number,sum(debit_amount) AS debit_amount,sum(credit_amount) AS credit_amount
              FROM (
                SELECT debit_account AS account_number,amount AS debit_amount,0::numeric AS credit_amount
                FROM {SCHEMA}.accounting_journal_entries
                WHERE snapshot_id=%s
                  AND (posted_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date BETWEEN %s AND %s
                UNION ALL
                SELECT credit_account,0::numeric,amount
                FROM {SCHEMA}.accounting_journal_entries
                WHERE snapshot_id=%s
                  AND (posted_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date BETWEEN %s AND %s
              ) entries GROUP BY account_number
            ), trial AS (
              SELECT account_number,sum(period_debit) AS debit_amount,sum(period_credit) AS credit_amount
              FROM {SCHEMA}.accounting_source_rows
              WHERE snapshot_id=%s AND is_leaf=true
              GROUP BY account_number
            )
            SELECT COALESCE(journal.account_number,trial.account_number) AS account_number,
              COALESCE(journal.debit_amount,0) AS journal_debit,
              COALESCE(trial.debit_amount,0) AS trial_debit,
              COALESCE(journal.credit_amount,0) AS journal_credit,
              COALESCE(trial.credit_amount,0) AS trial_credit,
              COALESCE(journal.debit_amount,0)-COALESCE(trial.debit_amount,0) AS debit_difference,
              COALESCE(journal.credit_amount,0)-COALESCE(trial.credit_amount,0) AS credit_difference
            FROM journal FULL OUTER JOIN trial USING(account_number)
            WHERE abs(COALESCE(journal.debit_amount,0)-COALESCE(trial.debit_amount,0))>0.01
               OR abs(COALESCE(journal.credit_amount,0)-COALESCE(trial.credit_amount,0))>0.01
            ORDER BY GREATEST(
              abs(COALESCE(journal.debit_amount,0)-COALESCE(trial.debit_amount,0)),
              abs(COALESCE(journal.credit_amount,0)-COALESCE(trial.credit_amount,0))
            ) DESC""",
        (
            journal_snapshot_id, run["period_from"], run["period_to"],
            journal_snapshot_id, run["period_from"], run["period_to"],
            trial_snapshot_id,
        ),
    ).fetchall()
    totals = conn.execute(
        f"""SELECT
              (SELECT COALESCE(sum(amount),0) FROM {SCHEMA}.accounting_journal_entries
               WHERE snapshot_id=%s
                 AND (posted_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date BETWEEN %s AND %s) AS journal_debit,
              (SELECT COALESCE(sum(period_debit),0) FROM {SCHEMA}.accounting_source_rows
               WHERE snapshot_id=%s AND is_leaf=true) AS trial_debit,
              (SELECT COALESCE(sum(period_credit),0) FROM {SCHEMA}.accounting_source_rows
               WHERE snapshot_id=%s AND is_leaf=true) AS trial_credit""",
        (
            journal_snapshot_id, run["period_from"], run["period_to"],
            trial_snapshot_id, trial_snapshot_id,
        ),
    ).fetchone()
    journal_total = Decimal(totals["journal_debit"] or 0)
    trial_debit = Decimal(totals["trial_debit"] or 0)
    trial_credit = Decimal(totals["trial_credit"] or 0)
    maximum_total_difference = max(
        abs(journal_total - trial_debit),
        abs(journal_total - trial_credit),
    )
    issue_count = len(mismatches)
    _upsert_data_control(
        conn,
        run,
        "JOURNAL_TO_TRIAL_BALANCE",
        "PASS" if issue_count == 0 else "FAIL",
        journal_total,
        journal_total,
        maximum_total_difference,
        issue_count,
        {
            "journalSnapshotId": str(journal_snapshot_id),
            "trialBalanceSnapshotId": str(trial_snapshot_id),
            "journalDebit": str(journal_total),
            "journalCredit": str(journal_total),
            "trialDebit": str(trial_debit),
            "trialCredit": str(trial_credit),
            "mismatches": [_safe(dict(row)) for row in mismatches[:50]],
            "truncatedMismatchDetails": issue_count > 50,
        },
    )


def _empty_snapshot_rejection_message(actual_row_count: int, previous_row_count: int) -> str:
    if actual_row_count == 0 and previous_row_count > 0:
        return (
            f"MISA trả 0 dòng; hệ thống giữ nguyên phiên tốt gần nhất "
            f"{previous_row_count:,} dòng để tránh mất dữ liệu."
        )
    return ""


def _finalize(conn: psycopg.Connection, run: Dict[str, Any]) -> Dict[str, int]:
    actual_row_count = int(conn.execute(
        f"SELECT count(*) AS total FROM {SCHEMA}.accounting_source_rows WHERE snapshot_id=%s",
        (run["snapshot_id"],),
    ).fetchone()["total"])
    expected_row_count = int(run.get("source_total_rows") or 0)
    if expected_row_count and actual_row_count != expected_row_count:
        raise WorkerError(
            f"Chưa thể kích hoạt dữ liệu: nguồn báo {expected_row_count} dòng nhưng PostgreSQL có {actual_row_count} dòng duy nhất"
        )
    active = conn.execute(
        f"""SELECT a.snapshot_id,s.row_count
            FROM {SCHEMA}.accounting_active_snapshots a
            JOIN {SCHEMA}.accounting_snapshots s ON s.snapshot_id=a.snapshot_id
            WHERE a.source_key=%s AND a.company_key=%s AND a.period_from=%s AND a.period_to=%s""",
        (run["source_key"], run["company_key"], run["period_from"], run["period_to"]),
    ).fetchone()
    old_snapshot = active["snapshot_id"] if active else None
    previous_row_count = int(active["row_count"] or 0) if active else 0
    rejection_message = _empty_snapshot_rejection_message(actual_row_count, previous_row_count)
    if rejection_message:
        conn.execute(
            f"UPDATE {SCHEMA}.accounting_snapshots SET status='FAILED',row_count=0 WHERE snapshot_id=%s",
            (run["snapshot_id"],),
        )
        conn.execute(
            f"""UPDATE {SCHEMA}.accounting_sync_runs
                SET status='FAILED',stage='SAFE_GUARD',imported_rows=0,
                    added_count=0,deleted_count=0,updated_count=0,unchanged_count=0,
                    last_error=%s,finished_at=now(),updated_at=now()
                WHERE run_id=%s""",
            (rejection_message, run["run_id"]),
        )
        return {"added_count": 0, "deleted_count": 0, "updated_count": 0, "unchanged_count": 0}
    if run["dataset_type"] == "TRIAL_BALANCE":
        mismatch_count = int(conn.execute(
            f"""SELECT count(*) AS total FROM {SCHEMA}.accounting_source_rows
                WHERE snapshot_id=%s AND abs((opening_debit-opening_credit+period_debit-period_credit)-(closing_debit-closing_credit))>0.01""",
            (run["snapshot_id"],),
        ).fetchone()["total"])
        if mismatch_count:
            raise WorkerError(f"Chưa thể kích hoạt dữ liệu: có {mismatch_count} tài khoản không khớp phương trình số dư")
    elif _is_journal_dataset(run["dataset_type"]):
        _finalize_journal(conn, run)
    new_snapshot = run["snapshot_id"]
    if run["dataset_type"] == "TRIAL_BALANCE":
        conn.execute(
            f"""UPDATE {SCHEMA}.accounting_source_rows parent SET is_leaf=NOT EXISTS(
                SELECT 1 FROM {SCHEMA}.accounting_source_rows child
                WHERE child.snapshot_id=parent.snapshot_id
                  AND child.account_number<>parent.account_number
                  AND child.account_number LIKE parent.account_number || '%%'
              ) WHERE parent.snapshot_id=%s""",
            (new_snapshot,),
        )
    if run["dataset_type"] == "TRIAL_BALANCE" or _is_journal_dataset(run["dataset_type"]):
        _reconcile_journal_to_trial_balance(conn, run, new_snapshot)
    if old_snapshot:
        count_row = conn.execute(
            f"""SELECT
              count(*) FILTER (WHERE old.source_row_key IS NULL) AS added_count,
              count(*) FILTER (WHERE new.source_row_key IS NULL) AS deleted_count,
              count(*) FILTER (WHERE old.source_row_key IS NOT NULL AND new.source_row_key IS NOT NULL AND old.row_hash<>new.row_hash) AS updated_count,
              count(*) FILTER (WHERE old.source_row_key IS NOT NULL AND new.source_row_key IS NOT NULL AND old.row_hash=new.row_hash) AS unchanged_count
            FROM {SCHEMA}.accounting_source_rows old
            FULL OUTER JOIN {SCHEMA}.accounting_source_rows new
              ON new.snapshot_id=%s AND old.snapshot_id=%s AND new.source_row_key=old.source_row_key
            WHERE old.snapshot_id=%s OR new.snapshot_id=%s""",
            (new_snapshot, old_snapshot, old_snapshot, new_snapshot),
        ).fetchone()
        conn.execute(
            f"""INSERT INTO {SCHEMA}.accounting_change_events(
              run_id, source_key, company_key, data_space_key, data_space_name,
              period_from, period_to, source_row_key,
              account_number, account_name, change_type, before_data, after_data,
              changed_fields, amount_deltas
            )
            SELECT %s,%s,%s,%s,%s,%s,%s,
              COALESCE(new.source_row_key, old.source_row_key),
              COALESCE(new.account_number, old.account_number),
              COALESCE(new.account_name, old.account_name),
              CASE WHEN old.source_row_key IS NULL THEN 'ADDED'
                   WHEN new.source_row_key IS NULL THEN 'DELETED' ELSE 'UPDATED' END,
              old.canonical_data, new.canonical_data,
              ARRAY(SELECT key FROM (
                SELECT jsonb_object_keys(COALESCE(old.canonical_data,'{{}}'::jsonb) || COALESCE(new.canonical_data,'{{}}'::jsonb)) AS key
              ) keys WHERE old.canonical_data->key IS DISTINCT FROM new.canonical_data->key),
              jsonb_build_object(
                'opening_debit', COALESCE(new.opening_debit,0)-COALESCE(old.opening_debit,0),
                'opening_credit', COALESCE(new.opening_credit,0)-COALESCE(old.opening_credit,0),
                'period_debit', COALESCE(new.period_debit,0)-COALESCE(old.period_debit,0),
                'period_credit', COALESCE(new.period_credit,0)-COALESCE(old.period_credit,0),
                'ytd_debit', COALESCE(new.ytd_debit,0)-COALESCE(old.ytd_debit,0),
                'ytd_credit', COALESCE(new.ytd_credit,0)-COALESCE(old.ytd_credit,0),
                'closing_debit', COALESCE(new.closing_debit,0)-COALESCE(old.closing_debit,0),
                'closing_credit', COALESCE(new.closing_credit,0)-COALESCE(old.closing_credit,0)
              )
            FROM {SCHEMA}.accounting_source_rows old
            FULL OUTER JOIN {SCHEMA}.accounting_source_rows new
              ON new.snapshot_id=%s AND old.snapshot_id=%s AND new.source_row_key=old.source_row_key
            WHERE (old.snapshot_id=%s OR new.snapshot_id=%s)
              AND (old.source_row_key IS NULL OR new.source_row_key IS NULL OR old.row_hash<>new.row_hash)""",
            (
             run["run_id"], run["source_key"], run["company_key"],
             run["data_space_key"], run["data_space_name"], run["period_from"], run["period_to"],
             new_snapshot, old_snapshot, old_snapshot, new_snapshot),
        )
    else:
        new_count = conn.execute(
            f"SELECT count(*) AS total FROM {SCHEMA}.accounting_source_rows WHERE snapshot_id=%s",
            (new_snapshot,),
        ).fetchone()["total"]
        count_row = {"added_count": new_count, "deleted_count": 0, "updated_count": 0, "unchanged_count": 0}
    total_rows = conn.execute(
        f"SELECT count(*) AS total FROM {SCHEMA}.accounting_source_rows WHERE snapshot_id=%s", (new_snapshot,)
    ).fetchone()["total"]
    if old_snapshot:
        conn.execute(
            f"UPDATE {SCHEMA}.accounting_snapshots SET status='SUPERSEDED' WHERE snapshot_id=%s AND is_published=false",
            (old_snapshot,),
        )
    conn.execute(
        f"UPDATE {SCHEMA}.accounting_snapshots SET status='ACTIVE', row_count=%s, supersedes_snapshot_id=%s, activated_at=now() WHERE snapshot_id=%s",
        (total_rows, old_snapshot, new_snapshot),
    )
    conn.execute(
        f"""INSERT INTO {SCHEMA}.accounting_active_snapshots(
              source_key,company_key,data_space_key,data_space_name,period_from,period_to,snapshot_id
            ) VALUES (%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT(source_key,company_key,period_from,period_to)
            DO UPDATE SET data_space_key=excluded.data_space_key,data_space_name=excluded.data_space_name,
              snapshot_id=excluded.snapshot_id, activated_at=now()""",
        (
            run["source_key"], run["company_key"], run["data_space_key"], run["data_space_name"],
            run["period_from"], run["period_to"], new_snapshot,
        ),
    )
    counts = {key: int(count_row[key] or 0) for key in ("added_count", "deleted_count", "updated_count", "unchanged_count")}
    if old_snapshot and (counts["added_count"] or counts["deleted_count"] or counts["updated_count"]):
        conn.execute(
            f"""INSERT INTO {SCHEMA}.accounting_dirty_periods(
                  source_key,company_key,data_space_key,data_space_name,period_from,period_to,reason_run_id,reason
                )
                SELECT source_key,company_key,data_space_key,data_space_name,period_from,period_to,
                  %s,'Kỳ trước vừa có điều chỉnh số liệu'
                FROM {SCHEMA}.accounting_active_snapshots
                WHERE source_key=%s AND company_key=%s AND period_from>%s
                ON CONFLICT(source_key,company_key,period_from,period_to)
                DO UPDATE SET data_space_key=excluded.data_space_key,data_space_name=excluded.data_space_name,
                  reason_run_id=excluded.reason_run_id,reason=excluded.reason,status='PENDING',detected_at=now()""",
            (run["run_id"], run["source_key"], run["company_key"], run["period_from"]),
        )
    conn.execute(
        f"DELETE FROM {SCHEMA}.accounting_dirty_periods WHERE source_key=%s AND company_key=%s AND period_from=%s AND period_to=%s",
        (run["source_key"], run["company_key"], run["period_from"], run["period_to"]),
    )
    conn.execute(f"DELETE FROM {SCHEMA}.accounting_report_cache")
    conn.execute(
        f"""UPDATE {SCHEMA}.accounting_sync_runs SET status='COMPLETED', stage='DONE',
            imported_rows=%s, added_count=%s, deleted_count=%s, updated_count=%s, unchanged_count=%s,
            finished_at=now(), updated_at=now(), last_error='' WHERE run_id=%s""",
        (total_rows, counts["added_count"], counts["deleted_count"], counts["updated_count"], counts["unchanged_count"], run["run_id"]),
    )
    return counts


def _accounting_file_existing_spaces(conn: psycopg.Connection, company_key: str) -> List[Dict[str, Any]]:
    rows = conn.execute(
        f"""SELECT data_space_key,data_space_name,
                   bool_or(source_type='FILE_UPLOAD') AS has_file_upload,
                   array_agg(DISTINCT dataset_type ORDER BY dataset_type) AS dataset_types
              FROM {SCHEMA}.accounting_source_connections
             WHERE company_key=%s
             GROUP BY data_space_key,data_space_name
             ORDER BY data_space_name,data_space_key""",
        (company_key,),
    ).fetchall()
    return [
        {
            "dataSpaceKey": row["data_space_key"],
            "dataSpaceName": row["data_space_name"],
            "hasFileUpload": bool(row["has_file_upload"]),
            "datasetTypes": list(row["dataset_types"] or []),
        }
        for row in rows
    ]


def _file_import_data_space(
    conn: psycopg.Connection,
    company_key: str,
    requested_name: str,
    target_key: str,
) -> tuple[str, str]:
    data_space_name = _clean_name(requested_name, "tên khối dữ liệu")
    if str(target_key or "").strip():
        data_space_key = _clean_key(target_key, "mã khối dữ liệu")
        existing = conn.execute(
            f"""SELECT data_space_name FROM {SCHEMA}.accounting_source_connections
                 WHERE company_key=%s AND data_space_key=%s
                 ORDER BY created_at LIMIT 1""",
            (company_key, data_space_key),
        ).fetchone()
        if not existing:
            raise HTTPException(
                status_code=404,
                detail="Khối dữ liệu muốn ghép không còn tồn tại trong công ty đã chọn",
            )
        return data_space_key, str(existing["data_space_name"])
    normalized_name = _file_header_text(data_space_name)
    fingerprint = hashlib.sha256(
        f"{company_key}|{normalized_name}".encode("utf-8")
    ).hexdigest()[:24].upper()
    return f"FILE_{fingerprint}", data_space_name


def _prepare_file_import_row(
    raw: Dict[str, Any],
    dataset_type: str,
    row_index: int,
    occurrences: Dict[str, int],
) -> Dict[str, Any]:
    prepared = dict(raw)
    account_number = str(prepared.get("account_number") or "").strip()
    prepared["account_number"] = account_number
    prepared["account_id"] = account_number
    prepared["row_index"] = row_index
    if dataset_type == "TRIAL_BALANCE":
        digits = re.sub(r"\D", "", account_number)
        prepared["grade"] = max(1, len(digits or account_number) - 2)
        if "accum_debit_amount" not in prepared:
            prepared["accum_debit_amount"] = prepared.get("debit_amount", "0")
        if "accum_credit_amount" not in prepared:
            prepared["accum_credit_amount"] = prepared.get("credit_amount", "0")
        return prepared
    voucher_identity = {
        "posted_date": prepared.get("posted_date") or "",
        "refdate": prepared.get("refdate") or "",
        "refno": prepared.get("refno") or "",
        "journal_memo": prepared.get("journal_memo") or "",
    }
    prepared["refid"] = "FILE-" + hashlib.sha256(
        json.dumps(voucher_identity, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()[:24]
    line_identity = {
        key: value
        for key, value in prepared.items()
        if key not in {"row_index", "line_id", "detail_id"}
    }
    line_fingerprint = hashlib.sha256(
        json.dumps(line_identity, ensure_ascii=False, sort_keys=True, default=str).encode("utf-8")
    ).hexdigest()
    occurrences[line_fingerprint] = occurrences.get(line_fingerprint, 0) + 1
    prepared["line_id"] = f"{line_fingerprint[:24]}-{occurrences[line_fingerprint]}"
    return prepared


REPORT_IMPORT_KEYS = {
    "BAO_CAO_TINH_HINH_TAI_CHINH",
    "BAO_CAO_KET_QUA_KINH_DOANH",
    "LUU_CHUYEN_TIEN_TE_TRUC_TIEP",
    "LUU_CHUYEN_TIEN_TE_GIAN_TIEP",
    DISCLOSURE_REPORT_KEY,
}


def _is_report_result_import(request: AccountingFilePreviewRequest) -> bool:
    dataset_type = str(request.datasetType or "").strip().upper()
    report_key = str(request.reportKey or "").strip().upper()
    return dataset_type in {"REPORT_RESULT", "FINANCIAL_REPORT"} or report_key in REPORT_IMPORT_KEYS


def _report_column_aliases(payload: Dict[str, Any]) -> set[str]:
    column_type = str(payload.get("columnType") or "").strip().upper()
    aliases = {_file_header_text(payload.get("columnLabel")), _file_header_text(payload.get("columnKey"))}
    semantic = {
        "LABEL": {"chi tieu", "tai san nguon von", "noi dung", "khoan muc thuyet minh"},
        "ROW_CODE": {"ma so", "ma chi tieu", "ma"},
        "NOTE_REFERENCE": {"thuyet minh", "ma thuyet minh"},
        "CURRENT_PERIOD": {"nam nay", "ky nay", "so cuoi nam", "so cuoi ky", "gia tri"},
        "PREVIOUS_PERIOD": {"nam truoc", "ky truoc", "so dau nam", "so dau ky"},
    }
    aliases.update(semantic.get(column_type, set()))
    return {value for value in aliases if value}


def _report_import_definition(records: List[Dict[str, Any]], report_key: str) -> Dict[str, Any]:
    normalized = _clean_key(report_key, "mã báo cáo")
    report = next(
        (
            record for record in records
            if record.get("recordType") == "REPORT"
            and _clean_key(record.get("entityKey") or (record.get("payload") or {}).get("reportKey"), "mã báo cáo") == normalized
        ),
        None,
    )
    if not report:
        raise HTTPException(status_code=404, detail=f"Không tìm thấy mẫu báo cáo {normalized} trong phiên bản đã chọn")
    columns = sorted(
        [
            record for record in records
            if record.get("recordType") == "REPORT_COLUMN"
            and _clean_key((record.get("payload") or {}).get("reportKey"), "mã báo cáo") == normalized
        ],
        key=lambda record: float(record.get("sortOrder") or 0),
    )
    rows = sorted(
        [
            record for record in records
            if record.get("recordType") == "REPORT_ROW"
            and _clean_key((record.get("payload") or {}).get("reportKey"), "mã báo cáo") == normalized
        ],
        key=lambda record: float(record.get("sortOrder") or 0),
    )
    return {"report": report, "columns": columns, "rows": rows}


def _report_row_matcher(definition: Dict[str, Any]) -> Dict[str, Any]:
    by_internal: Dict[str, Dict[str, Any]] = {}
    by_display: Dict[str, List[Dict[str, Any]]] = {}
    for record in definition["rows"]:
        payload = record.get("payload") or {}
        internal = _file_header_text(payload.get("rowCode") or record.get("displayCode"))
        display = _file_header_text(payload.get("displayCode") or record.get("displayCode") or payload.get("rowCode"))
        label = _file_header_text(payload.get("rowLabel") or record.get("displayName"))
        item = {"record": record, "internal": internal, "display": display, "label": label}
        if internal:
            by_internal[internal] = item
        if display:
            by_display.setdefault(display, []).append(item)
    return {"byInternal": by_internal, "byDisplay": by_display}


def _match_report_row(matcher: Dict[str, Any], code: Any, label: Any) -> Dict[str, Any] | None:
    normalized_code = _file_header_text(code)
    normalized_label = _file_header_text(label)
    if normalized_code and normalized_code in matcher["byInternal"]:
        return matcher["byInternal"][normalized_code]
    candidates = matcher["byDisplay"].get(normalized_code, []) if normalized_code else []
    if len(candidates) == 1:
        return candidates[0]
    if normalized_label:
        exact = next((item for item in candidates if item["label"] == normalized_label), None)
        if exact:
            return exact
        all_items = list(matcher["byInternal"].values())
        exact = next((item for item in all_items if item["label"] == normalized_label), None)
        if exact:
            return exact
    return None


def _report_file_candidate(sheet: Any, definition: Dict[str, Any], header_row: int, depth: int) -> Dict[str, Any]:
    headers = _combined_file_headers(sheet, header_row, depth)
    column_mapping: Dict[str, int] = {}
    for column_record in definition["columns"]:
        payload = column_record.get("payload") or {}
        aliases = _report_column_aliases(payload)
        best_index = None
        best_score = -1
        for index, header in enumerate(headers):
            normalized_header = _file_header_text(header)
            if not normalized_header:
                continue
            score = 3 if normalized_header in aliases else 2 if any(alias in normalized_header for alias in aliases) else -1
            if score > best_score:
                best_index, best_score = index, score
        if best_index is not None and best_score >= 0:
            column_mapping[str(payload.get("columnKey") or "")] = best_index
    columns_by_key = {
        str((record.get("payload") or {}).get("columnKey") or ""): record.get("payload") or {}
        for record in definition["columns"]
    }
    row_code_key = next((key for key, payload in columns_by_key.items() if str(payload.get("columnType") or "").upper() == "ROW_CODE"), "")
    label_key = next((key for key, payload in columns_by_key.items() if str(payload.get("columnType") or "").upper() == "LABEL"), "")
    numeric_keys = [
        key for key, payload in columns_by_key.items()
        if str(payload.get("columnType") or "").upper() not in {"LABEL", "ROW_CODE", "NOTE_REFERENCE"}
        and key in column_mapping
    ]
    matcher = _report_row_matcher(definition)
    matched_rows = 0
    start = header_row + depth
    for values in sheet.iter_rows(min_row=start, max_row=min(sheet.max_row, start + 120), values_only=True):
        code = values[column_mapping[row_code_key]] if row_code_key in column_mapping and column_mapping[row_code_key] < len(values) else ""
        label = values[column_mapping[label_key]] if label_key in column_mapping and column_mapping[label_key] < len(values) else ""
        if _match_report_row(matcher, code, label):
            matched_rows += 1
    report_payload = definition["report"].get("payload") or {}
    report_name = _file_header_text(report_payload.get("reportName") or definition["report"].get("displayName"))
    title_text = _file_header_text(" ".join(
        str(value or "") for row in sheet.iter_rows(min_row=1, max_row=min(12, sheet.max_row), values_only=True) for value in row
    ))
    title_score = 30 if report_name and report_name in title_text else 0
    score = matched_rows * 20 + len(numeric_keys) * 15 + len(column_mapping) * 3 + title_score
    return {
        "definition": definition,
        "sheet": sheet,
        "headerRow": header_row,
        "headerDepth": depth,
        "headers": headers,
        "columnMapping": column_mapping,
        "matchedRows": matched_rows,
        "numericKeys": numeric_keys,
        "score": score,
    }


def _build_imported_standard_report_output(candidate: Dict[str, Any], period_from: date | None, period_to: date | None) -> Dict[str, Any]:
    definition = candidate["definition"]
    sheet = candidate["sheet"]
    mapping = candidate["columnMapping"]
    columns = []
    columns_by_key: Dict[str, Dict[str, Any]] = {}
    for record in definition["columns"]:
        payload = record.get("payload") or {}
        key = str(payload.get("columnKey") or "")
        columns_by_key[key] = payload
        columns.append({
            "columnKey": key,
            "columnLabel": payload.get("columnLabel") or record.get("displayName"),
            "columnType": payload.get("columnType") or "CURRENT_PERIOD",
            "periodOffset": int(payload.get("periodOffset") or (-1 if str(payload.get("columnType") or "").upper() == "PREVIOUS_PERIOD" else 0)),
            "width": float(payload.get("width") or 16),
            "numberFormat": payload.get("numberFormat") or "#,##0;(#,##0);-",
        })
    row_code_key = next((key for key, payload in columns_by_key.items() if str(payload.get("columnType") or "").upper() == "ROW_CODE"), "")
    label_key = next((key for key, payload in columns_by_key.items() if str(payload.get("columnType") or "").upper() == "LABEL"), "")
    matcher = _report_row_matcher(definition)
    imported_values: Dict[str, Dict[str, Any]] = {}
    start = candidate["headerRow"] + candidate["headerDepth"]
    for excel_row, values in enumerate(sheet.iter_rows(min_row=start, values_only=True), start=start):
        code = values[mapping[row_code_key]] if row_code_key in mapping and mapping[row_code_key] < len(values) else ""
        label = values[mapping[label_key]] if label_key in mapping and mapping[label_key] < len(values) else ""
        matched = _match_report_row(matcher, code, label)
        if not matched:
            continue
        internal = str(((matched["record"].get("payload") or {}).get("rowCode") or matched["record"].get("displayCode") or ""))
        imported_values[internal] = {
            "excelRow": excel_row,
            "values": {
                key: values[index] if index < len(values) else None
                for key, index in mapping.items()
            },
        }
    output_rows = []
    non_zero = 0
    for record in definition["rows"]:
        payload = record.get("payload") or {}
        row_code = str(payload.get("rowCode") or record.get("displayCode") or "")
        row_label = str(payload.get("rowLabel") or record.get("displayName") or "")
        imported = imported_values.get(row_code)
        cells = []
        for column in columns:
            column_key = str(column.get("columnKey") or "")
            column_type = str(column.get("columnType") or "").upper()
            if column_type == "LABEL":
                cells.append({"columnKey": column_key, "kind": "TEXT", "text": row_label, "value": None, "formulaStatus": ""})
            elif column_type == "ROW_CODE":
                cells.append({"columnKey": column_key, "kind": "TEXT", "text": str(payload.get("displayCode") or record.get("displayCode") or row_code), "value": None, "formulaStatus": ""})
            elif column_type == "NOTE_REFERENCE":
                cells.append({"columnKey": column_key, "kind": "TEXT", "text": str(payload.get("noteReference") or ""), "value": None, "formulaStatus": ""})
            else:
                raw_value = (imported or {}).get("values", {}).get(column_key)
                value = float(_decimal(raw_value)) if imported is not None else None
                if value not in (None, 0):
                    non_zero += 1
                cells.append({
                    "columnKey": column_key,
                    "kind": "VALUE",
                    "text": "",
                    "value": value,
                    "formulaStatus": "IMPORTED" if imported is not None else "MISSING",
                    "evidence": {
                        "value": value,
                        "components": ([{
                            "label": f"File BCTC import · dòng Excel {imported['excelRow']}",
                            "sourceName": "Kết quả báo cáo đã import",
                            "signedValue": value,
                            "formulaSign": 1,
                            "tracePath": f"File BCTC → dòng {imported['excelRow']} → {row_code}",
                        }] if imported is not None else []),
                        "isComplete": imported is not None,
                        "difference": 0 if imported is not None else None,
                        "warning": "" if imported is not None else "Không tìm thấy dòng tương ứng trong file import.",
                    },
                })
        output_rows.append({
            "rowCode": row_code,
            "rowLabel": row_label,
            "rowType": str(payload.get("rowType") or "DATA").upper(),
            "cells": cells,
        })
    report_payload = definition["report"].get("payload") or {}
    coverage = len(imported_values) / max(1, len(definition["rows"]))
    return {
        "ok": True,
        "schemaVersion": "accounting-imported-report-output.v1",
        "report": {
            "reportKey": report_payload.get("reportKey") or definition["report"].get("entityKey"),
            "reportName": report_payload.get("reportName") or definition["report"].get("displayName"),
            "displayTitle": report_payload.get("displayTitle") or report_payload.get("reportName") or definition["report"].get("displayName"),
        },
        "columns": columns,
        "rows": output_rows,
        "periodFrom": period_from.isoformat() if period_from else "",
        "periodTo": period_to.isoformat() if period_to else "",
        "controlStatus": "READY" if coverage >= 0.5 and bool(candidate["numericKeys"]) else "NEEDS_REVIEW",
        "warnings": [] if coverage >= 0.5 else ["File import chỉ khớp một phần dòng của mẫu báo cáo."],
        "balanceRowCount": len(imported_values),
        "nonZeroCellCount": non_zero,
        "importCoverage": coverage,
    }


def _disclosure_normalized_text(value: Any) -> str:
    text = unicodedata.normalize("NFD", str(value or "").strip())
    text = "".join(character for character in text if unicodedata.category(character) != "Mn")
    text = text.replace("đ", "d").replace("Đ", "D").upper()
    return re.sub(r"^_+|_+$", "", re.sub(r"[^A-Z0-9]+", "_", text))


def _disclosure_period_side(value: Any) -> str:
    text = _disclosure_normalized_text(value)
    if re.search(
        r"(^|_)(NAM_TRUOC|KY_TRUOC|DAU_NAM|DAU_KY|PRIOR|PREVIOUS|OPENING|BEGINNING)(_|$)",
        text,
    ):
        return "PRIOR"
    if re.search(
        r"(^|_)(NAM_NAY|KY_NAY|CUOI_NAM|CUOI_KY|CURRENT|THIS|CLOSING|ENDING)(_|$)",
        text,
    ):
        return "CURRENT"
    return "UNKNOWN"


def _disclosure_target_period_side(
    target: Dict[str, Any],
    cells: List[Dict[str, Any]],
    start_row: int,
) -> str:
    row = int(target.get("row") or 0)
    column = int(target.get("column") or 0)
    headers = sorted(
        [
            cell
            for cell in cells
            if str(cell.get("text") or "").strip()
            and int(cell.get("row") or 0) >= max(1, start_row - 6)
            and int(cell.get("row") or 0) <= row
            and column >= int(cell.get("column") or 0)
            and column
            <= int(cell.get("column") or 0) + max(1, int(cell.get("columnSpan") or 1)) - 1
        ],
        key=lambda cell: int(cell.get("row") or 0),
        reverse=True,
    )
    for header in headers:
        side = _disclosure_period_side(header.get("text"))
        if side != "UNKNOWN":
            return side
    return "UNKNOWN"


def _disclosure_item_target_cells(
    item: Dict[str, Any],
    cells: List[Dict[str, Any]],
    total_count: int,
) -> List[Dict[str, Any]]:
    """Chọn đúng ô tổng giống hệt bộ xuất B09, không cộng mò cả vùng chi tiết."""

    start_row = int(item.get("startRow") or 0)
    end_row = int(item.get("endRow") or start_row)
    item_cells = [
        cell
        for cell in cells
        if start_row <= int(cell.get("row") or 0) <= end_row
    ]
    references = sorted(
        [
            cell
            for cell in item_cells
            if str(cell.get("role") or "").strip() in {"REFERENCE_VALUE", "REFERENCE_FORMULA"}
            and str(cell.get("address") or "").strip()
        ],
        key=lambda cell: (int(cell.get("row") or 0), int(cell.get("column") or 0)),
    )
    if not references:
        return []

    total_rows = [
        int(cell.get("row") or 0)
        for cell in item_cells
        if _disclosure_normalized_text(cell.get("text")) in {"CONG", "TONG_CONG"}
        or _disclosure_normalized_text(cell.get("text")).startswith("CONG_")
    ]
    if total_rows:
        selected_row = max(total_rows)
        selected = [cell for cell in references if int(cell.get("row") or 0) == selected_row]
        if selected:
            return selected

    formula_rows = [
        int(cell.get("row") or 0)
        for cell in references
        if str(cell.get("role") or "").strip() == "REFERENCE_FORMULA"
    ]
    if formula_rows:
        selected_row = max(formula_rows)
        selected = [cell for cell in references if int(cell.get("row") or 0) == selected_row]
        if len(selected) >= min(1, total_count):
            return selected

    if len(references) <= max(1, total_count):
        return references
    return []


def _disclosure_import_definition(
    records: List[Dict[str, Any]],
    report_definition: Dict[str, Any],
) -> Dict[str, Any]:
    template = next(
        (
            record
            for record in records
            if record.get("recordType") == "DISCLOSURE_TEMPLATE"
            and _clean_key(
                (record.get("payload") or {}).get("templateKey") or record.get("entityKey"),
                "mã mẫu thuyết minh",
            )
            == DISCLOSURE_REPORT_KEY
        ),
        None,
    )
    if not template:
        raise HTTPException(
            status_code=404,
            detail="Phiên bản đã chọn chưa có cell-map của mẫu B09-DN.",
        )
    sections = sorted(
        [
            record
            for record in records
            if record.get("recordType") == "DISCLOSURE_SECTION"
            and _clean_key((record.get("payload") or {}).get("templateKey"), "mã mẫu thuyết minh")
            == DISCLOSURE_REPORT_KEY
        ],
        key=lambda record: float((record.get("payload") or {}).get("startRow") or 0),
    )
    items = sorted(
        [
            record
            for record in records
            if record.get("recordType") == "DISCLOSURE_ITEM"
            and _clean_key((record.get("payload") or {}).get("templateKey"), "mã mẫu thuyết minh")
            == DISCLOSURE_REPORT_KEY
        ],
        key=lambda record: float((record.get("payload") or {}).get("startRow") or 0),
    )
    cells = [
        cell
        for section in sections
        for cell in ((section.get("payload") or {}).get("cells") or [])
        if isinstance(cell, dict)
    ]
    if not cells or not items:
        raise HTTPException(
            status_code=409,
            detail="Cell-map B09-DN chưa đầy đủ; hãy nạp lại mẫu thuyết minh trước khi import kết quả.",
        )
    return {
        **report_definition,
        "template": template,
        "sections": sections,
        "items": items,
        "layoutCells": cells,
    }


def _disclosure_sheet_candidate(
    sheet: Any,
    definition: Dict[str, Any],
) -> Dict[str, Any]:
    title_text = _disclosure_normalized_text(
        " ".join(
            str(value or "")
            for row in sheet.iter_rows(
                min_row=1,
                max_row=min(35, int(sheet.max_row or 1)),
                max_col=min(80, int(sheet.max_column or 1)),
                values_only=True,
            )
            for value in row
        )
    )
    title_match = "BAN_THUYET_MINH_BAO_CAO_TAI_CHINH" in title_text
    template_payload = definition["template"].get("payload") or {}
    expected_sheet = _disclosure_normalized_text(
        template_payload.get("sourceSheet") or definition["template"].get("sourceSheet")
    )
    sheet_name_match = bool(expected_sheet) and expected_sheet == _disclosure_normalized_text(sheet.title)
    numeric_column_count = len(
        [
            record
            for record in definition["columns"]
            if str((record.get("payload") or {}).get("columnType") or "").upper()
            not in {"LABEL", "ROW_CODE", "NOTE_REFERENCE"}
        ]
    )
    target_count = 0
    populated_count = 0
    for item_record in definition["items"]:
        item = item_record.get("payload") or {}
        targets = _disclosure_item_target_cells(
            item,
            definition["layoutCells"],
            numeric_column_count,
        )
        if not targets:
            continue
        target_count += 1
        if any(sheet[str(target.get("address"))].value is not None for target in targets):
            populated_count += 1
    score = (200 if title_match else 0) + (40 if sheet_name_match else 0) + populated_count * 3
    return {
        "sheet": sheet,
        "definition": definition,
        "titleMatch": title_match,
        "sheetNameMatch": sheet_name_match,
        "targetableRows": target_count,
        "populatedRows": populated_count,
        "score": score,
    }


def _select_disclosure_target(
    available: List[Dict[str, Any]],
    expected_side: str,
) -> Dict[str, Any] | None:
    selected = next(
        (
            candidate
            for candidate in available
            if not candidate["used"]
            and expected_side != "UNKNOWN"
            and candidate["side"] == expected_side
        ),
        None,
    )
    if not selected:
        selected = next(
            (
                candidate
                for candidate in available
                if not candidate["used"] and candidate["side"] == "UNKNOWN"
            ),
            None,
        )
    if not selected:
        selected = next((candidate for candidate in available if not candidate["used"]), None)
    if selected:
        selected["used"] = True
    return selected


def _build_imported_disclosure_report_output(
    candidate: Dict[str, Any],
    period_from: date | None,
    period_to: date | None,
) -> Dict[str, Any]:
    definition = candidate["definition"]
    sheet = candidate["sheet"]
    columns: List[Dict[str, Any]] = []
    numeric_columns: List[Dict[str, Any]] = []
    for record in definition["columns"]:
        payload = record.get("payload") or {}
        column_type = str(payload.get("columnType") or "CURRENT_PERIOD").upper()
        column = {
            "columnKey": str(payload.get("columnKey") or ""),
            "columnLabel": payload.get("columnLabel") or record.get("displayName"),
            "columnType": column_type,
            "periodOffset": int(
                payload.get("periodOffset")
                or (-1 if column_type == "PREVIOUS_PERIOD" else 0)
            ),
            "width": float(payload.get("width") or 16),
            "numberFormat": payload.get("numberFormat") or "#,##0;(#,##0);-",
        }
        columns.append(column)
        if column_type not in {"LABEL", "ROW_CODE", "NOTE_REFERENCE"}:
            numeric_columns.append(column)

    items_by_key: Dict[str, Dict[str, Any]] = {}
    items_by_code: Dict[str, Dict[str, Any]] = {}
    for record in definition["items"]:
        payload = record.get("payload") or {}
        key = _clean_key(payload.get("itemKey") or record.get("entityKey"), "mã khoản mục thuyết minh")
        code = str(payload.get("noteCode") or "").strip().upper()
        items_by_key[key] = payload
        if code:
            items_by_code[code] = payload

    imported_row_count = 0
    non_zero = 0
    missing_target_rows: List[str] = []
    output_rows: List[Dict[str, Any]] = []
    for record in definition["rows"]:
        payload = record.get("payload") or {}
        row_code = str(payload.get("rowCode") or record.get("displayCode") or "")
        row_label = str(payload.get("rowLabel") or record.get("displayName") or "")
        item_key_value = payload.get("disclosureItemKey") or f"{DISCLOSURE_REPORT_KEY}:{row_code}"
        item = items_by_key.get(_clean_key(item_key_value, "mã khoản mục thuyết minh"))
        if not item:
            item = items_by_code.get(row_code.strip().upper())
        targets = (
            _disclosure_item_target_cells(
                item,
                definition["layoutCells"],
                len(numeric_columns),
            )
            if item
            else []
        )
        available = [
            {
                "target": target,
                "side": _disclosure_target_period_side(
                    target,
                    definition["layoutCells"],
                    int((item or {}).get("startRow") or 1),
                ),
                "used": False,
            }
            for target in targets
        ]
        imported_values: Dict[str, Dict[str, Any]] = {}
        row_has_value = False
        for column in numeric_columns:
            selected = _select_disclosure_target(
                available,
                _disclosure_period_side(column.get("columnType") or column.get("columnLabel")),
            )
            if not selected:
                continue
            address = str(selected["target"].get("address") or "").strip()
            raw_value = sheet[address].value if address else None
            value = float(_decimal(raw_value)) if raw_value is not None else None
            if value is not None:
                row_has_value = True
                if value != 0:
                    non_zero += 1
            imported_values[str(column.get("columnKey") or "")] = {
                "value": value,
                "address": address,
            }
        if targets and not row_has_value:
            missing_target_rows.append(row_code)
        if row_has_value:
            imported_row_count += 1

        cells: List[Dict[str, Any]] = []
        for column in columns:
            column_key = str(column.get("columnKey") or "")
            column_type = str(column.get("columnType") or "").upper()
            if column_type == "LABEL":
                cells.append({"columnKey": column_key, "kind": "TEXT", "text": row_label, "value": None, "formulaStatus": ""})
            elif column_type == "ROW_CODE":
                cells.append({"columnKey": column_key, "kind": "TEXT", "text": str(payload.get("displayCode") or record.get("displayCode") or row_code), "value": None, "formulaStatus": ""})
            elif column_type == "NOTE_REFERENCE":
                cells.append({"columnKey": column_key, "kind": "TEXT", "text": str(payload.get("noteReference") or ""), "value": None, "formulaStatus": ""})
            else:
                imported = imported_values.get(column_key)
                value = imported.get("value") if imported else None
                address = str((imported or {}).get("address") or "")
                cells.append({
                    "columnKey": column_key,
                    "kind": "VALUE",
                    "text": "",
                    "value": value,
                    "formulaStatus": "IMPORTED" if value is not None else "MISSING",
                    "evidence": {
                        "value": value,
                        "components": ([{
                            "label": f"File B09 import · ô {address}",
                            "sourceName": "Kết quả B09 đã import",
                            "signedValue": value,
                            "formulaSign": 1,
                            "tracePath": f"File B09 → ô {address} → {row_code}",
                        }] if value is not None and address else []),
                        "isComplete": value is not None,
                        "difference": 0 if value is not None else None,
                        "warning": "" if value is not None else "Khoản mục không có ô tổng tương ứng trong file import.",
                    },
                })
        output_rows.append({
            "rowCode": row_code,
            "rowLabel": row_label,
            "rowType": str(payload.get("rowType") or "DATA").upper(),
            "cells": cells,
        })

    report_payload = definition["report"].get("payload") or {}
    targetable = int(candidate.get("targetableRows") or 0)
    coverage = imported_row_count / max(1, targetable)
    warnings: List[str] = []
    if missing_target_rows:
        warnings.append(
            "Một số ô tổng B09 chưa có giá trị lưu sẵn trong Excel: "
            + ", ".join(missing_target_rows[:12])
            + ("…" if len(missing_target_rows) > 12 else "")
            + ". Các ô này giữ nguyên công thức hệ thống, không tự gán 0."
        )
    return {
        "ok": True,
        "schemaVersion": "accounting-imported-disclosure-output.v1",
        "report": {
            "reportKey": report_payload.get("reportKey") or definition["report"].get("entityKey"),
            "reportName": report_payload.get("reportName") or definition["report"].get("displayName"),
            "displayTitle": report_payload.get("displayTitle") or report_payload.get("reportName") or definition["report"].get("displayName"),
        },
        "columns": columns,
        "rows": output_rows,
        "periodFrom": period_from.isoformat() if period_from else "",
        "periodTo": period_to.isoformat() if period_to else "",
        "controlStatus": "READY" if imported_row_count and not missing_target_rows else "NEEDS_REVIEW",
        "warnings": warnings,
        "balanceRowCount": imported_row_count,
        "targetableRowCount": targetable,
        "nonZeroCellCount": non_zero,
        "importCoverage": coverage,
    }


def _accounting_disclosure_file_preview(
    workbook: Any,
    request: AccountingFilePreviewRequest,
    safe_name: str,
    records: List[Dict[str, Any]],
    period_from: date | None = None,
    period_to: date | None = None,
) -> Dict[str, Any]:
    definition = _disclosure_import_definition(
        records,
        _report_import_definition(records, DISCLOSURE_REPORT_KEY),
    )
    requested_sheet = str(request.sheetName or "").strip()
    sheets = [workbook[requested_sheet]] if requested_sheet else [workbook[name] for name in workbook.sheetnames]
    candidates = [_disclosure_sheet_candidate(sheet, definition) for sheet in sheets]
    candidate = max(candidates, key=lambda item: item["score"])
    if not candidate["titleMatch"] and not candidate["sheetNameMatch"]:
        raise HTTPException(
            status_code=400,
            detail="Không nhận ra đúng trang B09-DN trong file Excel.",
        )
    if int(candidate.get("targetableRows") or 0) <= 0:
        raise HTTPException(
            status_code=409,
            detail="Mẫu B09-DN chưa có địa chỉ ô tổng để đọc kết quả.",
        )
    if not period_from or not period_to:
        month, year = _infer_file_month_year(safe_name, candidate["sheet"])
        if month and year:
            period_from = date(year, month, 1)
            period_to = date(year, month, calendar.monthrange(year, month)[1])
    output = _build_imported_disclosure_report_output(candidate, period_from, period_to)
    report = output["report"]
    numeric_columns = [
        column
        for column in output["columns"]
        if str(column.get("columnType") or "").upper()
        not in {"LABEL", "ROW_CODE", "NOTE_REFERENCE"}
    ]
    mappings = [
        {
            "columnIndex": index + 1,
            "sourceHeader": "Ô tổng theo cell-map B09",
            "targetField": column.get("columnKey"),
            "targetLabel": column.get("columnLabel") or column.get("columnKey"),
        }
        for index, column in enumerate(numeric_columns)
    ]
    sample_rows: List[Dict[str, Any]] = []
    for row in output["rows"]:
        values: Dict[str, Any] = {"rowCode": row["rowCode"], "rowLabel": row["rowLabel"]}
        for cell in row["cells"]:
            if cell.get("value") is not None:
                values[str(cell.get("columnKey") or "value")] = cell.get("value")
        if any(key not in {"rowCode", "rowLabel"} for key in values):
            sample_rows.append(values)
        if len(sample_rows) >= 5:
            break
    return {
        "ok": True,
        "fileName": safe_name,
        "sheetName": candidate["sheet"].title,
        "sheetNames": list(workbook.sheetnames),
        "datasetType": "REPORT_RESULT",
        "datasetLabel": f"BCTC kỳ trước · {report.get('reportName') or report.get('reportKey')}",
        "reportKey": report.get("reportKey"),
        "reportName": report.get("reportName"),
        "headerRow": 0,
        "headerDepth": 0,
        "periodFrom": output.get("periodFrom") or "",
        "periodTo": output.get("periodTo") or "",
        "year": period_to.year if period_to else 0,
        "rowCount": int(output.get("balanceRowCount") or 0),
        "proposedDataSpaceName": _proposed_file_space_name(
            request.companyLabel,
            request.companyKey,
            period_to.year if period_to else 0,
        ),
        "mappings": mappings,
        "sampleRows": sample_rows,
        "reportOutput": output,
        "detectionScore": candidate["score"],
        "message": (
            f"Đã nhận {report.get('reportName')} với "
            f"{int(output.get('balanceRowCount') or 0):,}/"
            f"{int(output.get('targetableRowCount') or 0):,} khoản mục có ô tổng."
        ),
    }


def _accounting_report_file_preview(
    workbook: Any,
    request: AccountingFilePreviewRequest,
    safe_name: str,
    period_from: date | None = None,
    period_to: date | None = None,
) -> Dict[str, Any]:
    version_id = _clean_key(request.versionId, "phiên bản cấu hình")
    records = _load_config_records(version_id)
    requested_report = str(request.reportKey or "AUTO").strip().upper()
    if requested_report in {"AUTO", DISCLOSURE_REPORT_KEY}:
        try:
            disclosure_preview = _accounting_disclosure_file_preview(
                workbook,
                request,
                safe_name,
                records,
                period_from,
                period_to,
            )
            if requested_report == DISCLOSURE_REPORT_KEY or int(disclosure_preview.get("detectionScore") or 0) >= 200:
                disclosure_preview.pop("detectionScore", None)
                return disclosure_preview
        except HTTPException:
            if requested_report == DISCLOSURE_REPORT_KEY:
                raise
    report_keys = (
        [requested_report]
        if requested_report in REPORT_IMPORT_KEYS and requested_report != DISCLOSURE_REPORT_KEY
        else sorted(REPORT_IMPORT_KEYS - {DISCLOSURE_REPORT_KEY})
    )
    candidates: List[Dict[str, Any]] = []
    requested_sheet = str(request.sheetName or "").strip()
    sheets = [workbook[requested_sheet]] if requested_sheet else [workbook[name] for name in workbook.sheetnames]
    for report_key in report_keys:
        try:
            definition = _report_import_definition(records, report_key)
        except HTTPException:
            continue
        for sheet in sheets:
            row_indexes = [int(request.headerRow)] if int(request.headerRow or 0) else range(1, min(int(sheet.max_row or 1), 60) + 1)
            for row_index in row_indexes:
                for depth in (1, 2):
                    if row_index + depth - 1 <= sheet.max_row:
                        candidates.append(_report_file_candidate(sheet, definition, row_index, depth))
    if not candidates:
        raise HTTPException(status_code=400, detail="Không tìm thấy mẫu báo cáo phù hợp trong file Excel")
    candidate = max(candidates, key=lambda item: item["score"])
    if candidate["matchedRows"] < 2 or not candidate["numericKeys"]:
        raise HTTPException(
            status_code=400,
            detail="Chưa nhận đủ mã dòng và cột số của báo cáo. Hãy chọn đúng trang tính hoặc dòng tiêu đề.",
        )
    if not period_from or not period_to:
        month, year = _infer_file_month_year(safe_name, candidate["sheet"])
        if month and year:
            period_from = date(year, month, 1)
            period_to = date(year, month, calendar.monthrange(year, month)[1])
    output = _build_imported_standard_report_output(candidate, period_from, period_to)
    report = output["report"]
    mappings = []
    definition = candidate["definition"]
    columns_by_key = {
        str((record.get("payload") or {}).get("columnKey") or ""): record.get("payload") or {}
        for record in definition["columns"]
    }
    for key, index in candidate["columnMapping"].items():
        mappings.append({
            "columnIndex": index + 1,
            "sourceHeader": candidate["headers"][index],
            "targetField": key,
            "targetLabel": columns_by_key.get(key, {}).get("columnLabel") or key,
        })
    sample_rows = []
    for row in output["rows"]:
        values = {"rowCode": row["rowCode"], "rowLabel": row["rowLabel"]}
        for cell in row["cells"]:
            if cell.get("value") is not None:
                values[str(cell.get("columnKey") or "value")] = cell.get("value")
        if any(key not in {"rowCode", "rowLabel"} for key in values):
            sample_rows.append(values)
        if len(sample_rows) >= 5:
            break
    return {
        "ok": True,
        "fileName": safe_name,
        "sheetName": candidate["sheet"].title,
        "sheetNames": list(workbook.sheetnames),
        "datasetType": "REPORT_RESULT",
        "datasetLabel": f"BCTC kỳ trước · {report.get('reportName') or report.get('reportKey')}",
        "reportKey": report.get("reportKey"),
        "reportName": report.get("reportName"),
        "headerRow": candidate["headerRow"],
        "headerDepth": candidate["headerDepth"],
        "periodFrom": output.get("periodFrom") or "",
        "periodTo": output.get("periodTo") or "",
        "year": period_to.year if period_to else 0,
        "rowCount": int(output.get("balanceRowCount") or 0),
        "proposedDataSpaceName": _proposed_file_space_name(request.companyLabel, request.companyKey, period_to.year if period_to else 0),
        "mappings": mappings,
        "sampleRows": sample_rows,
        "reportOutput": output,
        "message": f"Đã nhận {report.get('reportName')} với {int(output.get('balanceRowCount') or 0):,} dòng khớp mẫu.",
    }


@app.post("/imports/files/preview")
def preview_accounting_file(
    request: AccountingFilePreviewRequest,
    _: None = Depends(_auth),
) -> Dict[str, Any]:
    company_key = _clean_key(request.companyKey, "mã công ty")
    content, safe_name = _decode_accounting_file(request.fileName, request.fileDataUrl)
    workbook = _open_accounting_workbook(content)
    try:
        preview = (
            _accounting_report_file_preview(workbook, request, safe_name)
            if _is_report_result_import(request)
            else _accounting_file_preview(workbook, request, safe_name)
        )
    finally:
        workbook.close()
    pool = _pool()
    with pool.connection() as conn:
        if not _schema_ready(conn):
            raise HTTPException(status_code=409, detail="Hãy khởi tạo cấu trúc PostgreSQL trước")
        preview["existingDataSpaces"] = _accounting_file_existing_spaces(conn, company_key)
    return preview


def _import_accounting_report_file(
    request: AccountingFileImportRequest,
    content: bytes,
    safe_name: str,
) -> Dict[str, Any]:
    if request.periodFrom > request.periodTo:
        raise HTTPException(status_code=400, detail="Từ ngày phải trước hoặc bằng đến ngày")
    company_key = _clean_key(request.companyKey, "mã công ty")
    workbook = _open_accounting_workbook(content)
    try:
        preview = _accounting_report_file_preview(
            workbook,
            request,
            safe_name,
            request.periodFrom,
            request.periodTo,
        )
    finally:
        workbook.close()
    report_key = _clean_key(preview.get("reportKey"), "mã báo cáo")
    output = preview.get("reportOutput") if isinstance(preview.get("reportOutput"), dict) else {}
    if not output:
        raise HTTPException(status_code=422, detail="Không dựng được kết quả báo cáo từ file import")
    file_checksum = hashlib.sha256(content).hexdigest()
    report_result_id = uuid.uuid4()
    pool = _pool()
    with pool.connection() as conn:
        if not _schema_ready(conn):
            raise HTTPException(status_code=409, detail="Hãy khởi tạo cấu trúc PostgreSQL trước")
        with conn.transaction():
            data_space_key, data_space_name = _file_import_data_space(
                conn,
                company_key,
                request.dataSpaceName,
                request.targetDataSpaceKey,
            )
            previous = conn.execute(
                f"""SELECT report_result_id
                      FROM {SCHEMA}.accounting_report_result_snapshots
                     WHERE version_id=%s AND report_key=%s AND company_key=%s
                       AND data_space_key=%s AND period_from=%s AND period_to=%s
                       AND status='ACTIVE'
                     ORDER BY created_at DESC LIMIT 1 FOR UPDATE""",
                (
                    request.versionId,
                    report_key,
                    company_key,
                    data_space_key,
                    request.periodFrom,
                    request.periodTo,
                ),
            ).fetchone()
            if previous:
                conn.execute(
                    f"""UPDATE {SCHEMA}.accounting_report_result_snapshots
                           SET status='SUPERSEDED'
                         WHERE report_result_id=%s""",
                    (previous["report_result_id"],),
                )
            conn.execute(
                f"""INSERT INTO {SCHEMA}.accounting_report_result_snapshots(
                       report_result_id,version_id,report_key,report_name,company_key,
                       data_space_key,data_space_name,period_from,period_to,
                       source_file_name,source_sheet_name,source_header_row,source_checksum,
                       row_count,output_data,status,note,created_by,supersedes_report_result_id
                     ) VALUES (
                       %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb,
                       'ACTIVE',%s,%s,%s
                     )""",
                (
                    report_result_id,
                    _clean_key(request.versionId, "phiên bản cấu hình"),
                    report_key,
                    str(preview.get("reportName") or report_key)[:300],
                    company_key,
                    data_space_key,
                    data_space_name,
                    request.periodFrom,
                    request.periodTo,
                    safe_name,
                    str(preview.get("sheetName") or "")[:200],
                    int(preview.get("headerRow") or 0),
                    file_checksum,
                    int(preview.get("rowCount") or 0),
                    json.dumps(_safe(output), ensure_ascii=False, default=str),
                    str(request.note or "").strip()[:1000],
                    str(request.requestedBy or "").strip()[:200],
                    previous["report_result_id"] if previous else None,
                ),
            )
            base_source_key = f"FILE_REPORT_{report_key}"
            source_key = _connection_source_key(base_source_key, company_key, data_space_key)
            data_space_identity = {
                "provider": "FILE_REPORT_RESULT",
                "companyKey": company_key,
                "dataSpaceKey": data_space_key,
                "reportKey": report_key,
            }
            conn.execute(
                f"""INSERT INTO {SCHEMA}.accounting_source_connections(
                       source_key,base_source_key,source_name,source_type,company_key,
                       data_space_key,data_space_name,data_space_identity,dataset_type,endpoint_url,
                       report_id,report_name,page_size,config,credentials_ciphertext,
                       credential_status,credential_last_checked_at,credential_last_success_at
                     ) VALUES (%s,%s,%s,'FILE_REPORT_RESULT',%s,%s,%s,%s::jsonb,%s,'file://report-result',
                               %s,%s,1,%s::jsonb,%s,'NOT_REQUIRED',now(),now())
                     ON CONFLICT(source_key) DO UPDATE SET
                       source_name=excluded.source_name,source_type='FILE_REPORT_RESULT',
                       data_space_name=excluded.data_space_name,data_space_identity=excluded.data_space_identity,
                       dataset_type=excluded.dataset_type,report_id=excluded.report_id,
                       report_name=excluded.report_name,config=excluded.config,
                       credential_status='NOT_REQUIRED',updated_at=now()""",
                (
                    source_key,
                    base_source_key,
                    f"BCTC import · {preview.get('reportName') or report_key}",
                    company_key,
                    data_space_key,
                    data_space_name,
                    json.dumps(data_space_identity, ensure_ascii=False),
                    f"REPORT_RESULT:{report_key}",
                    report_key,
                    str(preview.get("reportName") or report_key)[:300],
                    json.dumps({
                        "reportResultId": str(report_result_id),
                        "fileName": safe_name,
                        "fileChecksum": file_checksum,
                        "sheetName": preview.get("sheetName"),
                        "headerRow": preview.get("headerRow"),
                    }, ensure_ascii=False),
                    _encrypt({"type": "FILE_REPORT_RESULT"}),
                ),
            )
            conn.execute(f"DELETE FROM {SCHEMA}.accounting_report_cache")
    return {
        "ok": True,
        "reportResultId": str(report_result_id),
        "reportKey": report_key,
        "reportName": preview.get("reportName"),
        "companyKey": company_key,
        "dataSpaceKey": data_space_key,
        "dataSpaceName": data_space_name,
        "datasetType": "REPORT_RESULT",
        "datasetLabel": preview.get("datasetLabel"),
        "rowCount": int(preview.get("rowCount") or 0),
        "message": (
            f"Đã lưu {preview.get('reportName') or report_key} kỳ "
            f"{request.periodFrom.isoformat()} → {request.periodTo.isoformat()} như một kết quả báo cáo thật."
        ),
    }


@app.post("/imports/files")
def import_accounting_file(
    request: AccountingFileImportRequest,
    _: None = Depends(_auth),
) -> Dict[str, Any]:
    if request.periodFrom > request.periodTo:
        raise HTTPException(status_code=400, detail="Từ ngày phải trước hoặc bằng đến ngày")
    company_key = _clean_key(request.companyKey, "mã công ty")
    content, safe_name = _decode_accounting_file(request.fileName, request.fileDataUrl)
    if _is_report_result_import(request):
        return _import_accounting_report_file(request, content, safe_name)
    file_checksum = hashlib.sha256(content).hexdigest()
    workbook = _open_accounting_workbook(content)
    try:
        preview = _accounting_file_preview(workbook, request, safe_name)
        sheet = workbook[preview["sheetName"]]
        layout = _detect_file_layout(
            sheet,
            preview["datasetType"],
            int(preview["headerRow"]),
        )
        dataset_type = preview["datasetType"]
        base_source_key = (
            "FILE_TRIAL_BALANCE"
            if dataset_type == "TRIAL_BALANCE"
            else "FILE_GENERAL_LEDGER"
        )
        pool = _pool()
        run_id = uuid.uuid4()
        snapshot_id = uuid.uuid4()
        source_key = ""
        data_space_key = ""
        data_space_name = ""
        run: Dict[str, Any] = {}
        with pool.connection() as conn:
            if not _schema_ready(conn):
                raise HTTPException(status_code=409, detail="Hãy khởi tạo cấu trúc PostgreSQL trước")
            with conn.transaction():
                data_space_key, data_space_name = _file_import_data_space(
                    conn,
                    company_key,
                    request.dataSpaceName,
                    request.targetDataSpaceKey,
                )
                source_key = _connection_source_key(base_source_key, company_key, data_space_key)
                data_space_identity = {
                    "provider": "FILE_UPLOAD",
                    "companyKey": company_key,
                    "dataSpaceKey": data_space_key,
                }
                config = {
                    "fileName": safe_name,
                    "fileChecksum": file_checksum,
                    "sheetName": preview["sheetName"],
                    "headerRow": preview["headerRow"],
                    "headerDepth": preview["headerDepth"],
                    "mappings": preview["mappings"],
                    "workbookCompanyName": preview["workbookCompanyName"],
                }
                conn.execute(
                    f"""INSERT INTO {SCHEMA}.accounting_source_connections(
                          source_key,base_source_key,source_name,source_type,company_key,
                          data_space_key,data_space_name,data_space_identity,dataset_type,endpoint_url,
                          report_id,report_name,page_size,config,credentials_ciphertext,
                          credential_status,credential_last_checked_at,credential_last_success_at
                        ) VALUES (%s,%s,%s,'FILE_UPLOAD',%s,%s,%s,%s::jsonb,%s,'file://upload',
                                  '',%s,%s,%s::jsonb,%s,'NOT_REQUIRED',now(),now())
                        ON CONFLICT(source_key) DO UPDATE SET
                          source_name=excluded.source_name,source_type='FILE_UPLOAD',
                          company_key=excluded.company_key,data_space_key=excluded.data_space_key,
                          data_space_name=excluded.data_space_name,data_space_identity=excluded.data_space_identity,
                          dataset_type=excluded.dataset_type,endpoint_url='file://upload',
                          report_name=excluded.report_name,page_size=excluded.page_size,
                          config=excluded.config,credentials_ciphertext=excluded.credentials_ciphertext,
                          credential_expires_at=NULL,credential_status='NOT_REQUIRED',
                          credential_last_checked_at=now(),credential_last_success_at=now(),
                          credential_last_error='',last_session_at=now(),updated_at=now()""",
                    (
                        source_key,
                        base_source_key,
                        f"{preview['datasetLabel']} · {data_space_name}",
                        company_key,
                        data_space_key,
                        data_space_name,
                        json.dumps(data_space_identity, ensure_ascii=False),
                        dataset_type,
                        preview["datasetLabel"],
                        FILE_IMPORT_PAGE_SIZE,
                        json.dumps(config, ensure_ascii=False),
                        _encrypt({"type": "FILE_UPLOAD"}),
                    ),
                )
                version_row = conn.execute(
                    f"""SELECT COALESCE(MAX(version_no),0)+1 AS version_no
                          FROM {SCHEMA}.accounting_snapshots
                         WHERE source_key=%s AND company_key=%s AND period_from=%s AND period_to=%s""",
                    (source_key, company_key, request.periodFrom, request.periodTo),
                ).fetchone()
                version_no = int(version_row["version_no"])
                conn.execute(
                    f"""INSERT INTO {SCHEMA}.accounting_snapshots(
                          snapshot_id,source_key,company_key,data_space_key,data_space_name,
                          dataset_type,period_from,period_to,version_no,status
                        ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,'LOADING')""",
                    (
                        snapshot_id, source_key, company_key, data_space_key, data_space_name,
                        dataset_type, request.periodFrom, request.periodTo, version_no,
                    ),
                )
                conn.execute(
                    f"""INSERT INTO {SCHEMA}.accounting_sync_runs(
                          run_id,snapshot_id,source_key,company_key,data_space_key,data_space_name,
                          dataset_type,period_from,period_to,status,stage,page_size,requested_by,note,started_at
                        ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,'RUNNING','FILE_IMPORT',%s,%s,%s,now())""",
                    (
                        run_id, snapshot_id, source_key, company_key, data_space_key,
                        data_space_name, dataset_type, request.periodFrom, request.periodTo,
                        FILE_IMPORT_PAGE_SIZE, request.requestedBy.strip(), request.note.strip(),
                    ),
                )
                run = {
                    "run_id": run_id,
                    "snapshot_id": snapshot_id,
                    "source_key": source_key,
                    "company_key": company_key,
                    "data_space_key": data_space_key,
                    "data_space_name": data_space_name,
                    "dataset_type": dataset_type,
                    "period_from": request.periodFrom,
                    "period_to": request.periodTo,
                    "source_total_rows": 0,
                }
            try:
                row_count = 0
                page_index = 0
                batch: List[Dict[str, Any]] = []
                occurrences: Dict[str, int] = {}
                start_row = int(layout["headerRow"]) + int(layout["headerDepth"])
                with conn.transaction():
                    for excel_row_index, values in enumerate(
                        sheet.iter_rows(min_row=start_row, values_only=True),
                        start=start_row,
                    ):
                        raw = _mapped_file_row(values, layout["mapping"])
                        if not _file_row_is_data(raw, dataset_type):
                            continue
                        raw = _prepare_file_import_row(
                            raw, dataset_type, excel_row_index, occurrences,
                        )
                        if _is_journal_dataset(dataset_type):
                            posted_at = normalize_misa_journal_row(raw)["posted_at"]
                            if posted_at and not (request.periodFrom <= posted_at.date() <= request.periodTo):
                                continue
                        batch.append(raw)
                        row_count += 1
                        if len(batch) >= FILE_IMPORT_PAGE_SIZE:
                            page_index += 1
                            checksum = _insert_page(conn, run, batch, page_index)
                            conn.execute(
                                f"""INSERT INTO {SCHEMA}.accounting_sync_pages(
                                      run_id,page_index,status,row_count,checksum,finished_at
                                    ) VALUES (%s,%s,'COMPLETED',%s,%s,now())""",
                                (run_id, page_index, len(batch), checksum),
                            )
                            batch = []
                    if batch:
                        page_index += 1
                        checksum = _insert_page(conn, run, batch, page_index)
                        conn.execute(
                            f"""INSERT INTO {SCHEMA}.accounting_sync_pages(
                                  run_id,page_index,status,row_count,checksum,finished_at
                                ) VALUES (%s,%s,'COMPLETED',%s,%s,now())""",
                            (run_id, page_index, len(batch), checksum),
                        )
                    if row_count == 0:
                        raise WorkerError("Tệp không có dòng dữ liệu nào trong kỳ đã chọn")
                    run["source_total_rows"] = row_count
                    conn.execute(
                        f"""UPDATE {SCHEMA}.accounting_sync_runs
                               SET total_pages=%s,processed_pages=%s,next_page=%s,
                                   source_total_rows=%s,imported_rows=%s,updated_at=now()
                             WHERE run_id=%s""",
                        (page_index, page_index, page_index + 1, row_count, row_count, run_id),
                    )
                    counts = _finalize(conn, run)
            except Exception as exc:
                message = str(exc)[:700] or "Không nạp được dữ liệu từ Excel"
                with conn.transaction():
                    conn.execute(
                        f"UPDATE {SCHEMA}.accounting_snapshots SET status='FAILED' WHERE snapshot_id=%s",
                        (snapshot_id,),
                    )
                    conn.execute(
                        f"""UPDATE {SCHEMA}.accounting_sync_runs
                               SET status='FAILED',stage='FILE_IMPORT_FAILED',last_error=%s,
                                   finished_at=now(),updated_at=now()
                             WHERE run_id=%s""",
                        (message, run_id),
                    )
                if isinstance(exc, HTTPException):
                    raise
                raise HTTPException(
                    status_code=422,
                    detail=f"Chưa thể chốt dữ liệu Excel: {message}",
                ) from exc
        return {
            "ok": True,
            "runId": str(run_id),
            "snapshotId": str(snapshot_id),
            "sourceKey": source_key,
            "companyKey": company_key,
            "dataSpaceKey": data_space_key,
            "dataSpaceName": data_space_name,
            "datasetType": dataset_type,
            "datasetLabel": preview["datasetLabel"],
            "rowCount": row_count,
            "counts": counts,
            "message": (
                f"Đã nạp {row_count:,} dòng {preview['datasetLabel']} vào khối {data_space_name}."
            ),
        }
    finally:
        workbook.close()


def _continue_one() -> Dict[str, Any]:
    pool = _pool()
    with pool.connection() as conn:
        with conn.transaction():
            run = conn.execute(
                f"""SELECT * FROM {SCHEMA}.accounting_sync_runs
                    WHERE status='QUEUED'
                       OR (
                         status='RETRY' AND (
                           (stage='WAIT_MISA' AND updated_at<now()-interval '3 seconds')
                           OR (
                             COALESCE(stage,'')<>'WAIT_MISA'
                             AND updated_at < now() - (
                               LEAST(60, 2 * power(2, LEAST(attempt_count, 5)))::text || ' seconds'
                             )::interval
                           )
                         )
                       )
                       OR (status='RUNNING' AND updated_at<now()-interval '5 minutes')
                    ORDER BY requested_at ASC FOR UPDATE SKIP LOCKED LIMIT 1"""
            ).fetchone()
            if not run:
                pending = conn.execute(
                    f"SELECT count(*) AS total FROM {SCHEMA}.accounting_sync_runs WHERE status IN ('QUEUED','RETRY','RUNNING','NEEDS_LOGIN')"
                ).fetchone()["total"]
                return {"ok": True, "idle": True, "pendingCount": int(pending)}
            conn.execute(
                f"UPDATE {SCHEMA}.accounting_sync_runs SET status='RUNNING', started_at=COALESCE(started_at,now()), updated_at=now() WHERE run_id=%s",
                (run["run_id"],),
            )
            if _is_journal_dataset(run.get("dataset_type")) and int(run.get("page_size") or 0) != 100:
                conn.execute(
                    f"UPDATE {SCHEMA}.accounting_sync_runs SET page_size=100,total_pages=0,updated_at=now() WHERE run_id=%s",
                    (run["run_id"],),
                )
                run["page_size"] = 100
                run["total_pages"] = 0
        source = conn.execute(
            f"SELECT * FROM {SCHEMA}.accounting_source_connections WHERE source_key=%s", (run["source_key"],)
        ).fetchone()
        try:
            credentials = _decrypt(source["credentials_ciphertext"])
            if run["stage"] == "INIT" or not run["misa_session_id"]:
                init_body = _request_body(credentials["requestBody"], run, True)
                init_payload = _misa_call(source, credentials, init_body)
                session_id = _misa_report_session_id(init_payload)
                if not session_id:
                    raise WorkerError(
                        "MISA không trả mã phiên báo cáo "
                        f"({_misa_session_diagnostic(init_payload)})"
                    )
                with conn.transaction():
                    conn.execute(
                        f"UPDATE {SCHEMA}.accounting_sync_runs SET stage='FETCH', misa_session_id=%s, status='RUNNING', updated_at=now() WHERE run_id=%s",
                        (session_id, run["run_id"]),
                    )
                    _set_credential_health(conn, source, "VALID", successful=True)
                run["misa_session_id"] = session_id
                run["stage"] = "FETCH"
            deadline = time.monotonic() + SLICE_SECONDS
            processed_now = 0
            known_total_pages = int(run["total_pages"] or 0)
            completed = known_total_pages > 0 and int(run["next_page"]) > known_total_pages
            if completed:
                # Trang cuối đã được ghi ở lần chạy trước nhưng bước chốt gặp lỗi
                # tạm thời. Thử chốt lại ngay, không gọi thêm các trang rỗng từ MISA.
                with conn.transaction():
                    _finalize(conn, run)
            while not completed and processed_now < PAGE_BATCH and time.monotonic() < deadline:
                page_index = int(run["next_page"])
                page_body = _request_body(credentials["requestBody"], run, False, page_index)
                payload = _misa_call(source, credentials, page_body)
                rows = _data_rows(payload)
                data = payload.get("Data") or {}
                if page_index == 1 and _misa_report_pending(payload, rows):
                    pending_attempt = int(run.get("attempt_count") or 0) + 1
                    pending_limit = 300 if _is_journal_dataset(run.get("dataset_type")) else 120
                    if pending_attempt > pending_limit:
                        raise WorkerError(
                            "MISA đã cấp phiên nhưng chưa dựng xong báo cáo trong thời gian chờ cho phép. "
                            "Hãy thử cập nhật lại; phiên dữ liệu tốt hiện tại vẫn được giữ nguyên."
                        )
                    pending_message = (
                        f"MISA đang dựng {source.get('report_name') or source.get('source_name') or 'báo cáo'}; "
                        f"hệ thống sẽ tự kiểm tra lại ({pending_attempt}/{pending_limit}), chưa xem đây là 0 dòng."
                    )
                    with conn.transaction():
                        conn.execute(
                            f"""UPDATE {SCHEMA}.accounting_sync_runs
                                SET status='RETRY',stage='WAIT_MISA',attempt_count=%s,
                                    last_error=%s,updated_at=now()
                                WHERE run_id=%s""",
                            (pending_attempt, pending_message, run["run_id"]),
                        )
                    current = conn.execute(
                        f"SELECT * FROM {SCHEMA}.accounting_sync_runs WHERE run_id=%s",
                        (run["run_id"],),
                    ).fetchone()
                    return {
                        "ok": True,
                        "idle": False,
                        "waitingForMisa": True,
                        "run": _run_view(dict(current)),
                        "processedNow": 0,
                        "pendingCount": 1,
                    }
                total_rows = int(data.get("Total") or run["source_total_rows"] or 0)
                total_pages = int(math.ceil(total_rows / int(run["page_size"]))) if total_rows else int(run["total_pages"] or 0)
                if not total_pages and len(rows) < int(run["page_size"]):
                    total_pages = page_index
                _validate_misa_page_row_count(
                    rows,
                    total_rows,
                    int(run["page_size"]),
                    page_index,
                )
                with conn.transaction():
                    checksum = _insert_page(conn, run, rows, page_index)
                    conn.execute(
                        f"""INSERT INTO {SCHEMA}.accounting_sync_pages(run_id,page_index,status,row_count,checksum,finished_at)
                            VALUES (%s,%s,'COMPLETED',%s,%s,now())
                            ON CONFLICT(run_id,page_index) DO UPDATE SET status='COMPLETED',row_count=excluded.row_count,
                              checksum=excluded.checksum,attempt_count={SCHEMA}.accounting_sync_pages.attempt_count+1,
                              last_error='',finished_at=now()""",
                        (run["run_id"], page_index, len(rows), checksum),
                    )
                    next_page = page_index + 1
                    conn.execute(
                        f"""UPDATE {SCHEMA}.accounting_sync_runs SET next_page=%s,total_pages=%s,
                            processed_pages=(SELECT count(*) FROM {SCHEMA}.accounting_sync_pages WHERE run_id=%s AND status='COMPLETED'),
                            source_total_rows=%s,stage='FETCH',attempt_count=0,last_error='',updated_at=now()
                            WHERE run_id=%s""",
                        (next_page, total_pages, run["run_id"], total_rows, run["run_id"]),
                    )
                    if processed_now == 0:
                        _set_credential_health(conn, source, "VALID", successful=True)
                run["next_page"] = next_page
                run["total_pages"] = total_pages
                run["source_total_rows"] = total_rows
                processed_now += 1
                completed = (total_pages > 0 and page_index >= total_pages) or (not rows and page_index > 1)
                if completed:
                    with conn.transaction():
                        counts = _finalize(conn, run)
                    break
            if not completed:
                with conn.transaction():
                    conn.execute(
                        f"UPDATE {SCHEMA}.accounting_sync_runs SET status='QUEUED',updated_at=now() WHERE run_id=%s AND status='RUNNING'",
                        (run["run_id"],),
                    )
            current = conn.execute(
                f"SELECT * FROM {SCHEMA}.accounting_sync_runs WHERE run_id=%s", (run["run_id"],)
            ).fetchone()
            pending = conn.execute(
                f"SELECT count(*) AS total FROM {SCHEMA}.accounting_sync_runs WHERE status IN ('QUEUED','RETRY','RUNNING','NEEDS_LOGIN')"
            ).fetchone()["total"]
            return {"ok": True, "idle": False, "run": _run_view(current), "processedNow": processed_now, "pendingCount": int(pending)}
        except MisaAuthError as exc:
            with conn.transaction():
                _set_credential_health(conn, source, "NEEDS_LOGIN", str(exc))
                conn.execute(
                    f"UPDATE {SCHEMA}.accounting_sync_runs SET status='NEEDS_LOGIN',stage='INIT',misa_session_id='',last_error=%s,attempt_count=attempt_count+1,updated_at=now() WHERE run_id=%s",
                    (str(exc)[:500], run["run_id"]),
                )
            return {"ok": False, "needsLogin": True, "runId": str(run["run_id"]), "message": str(exc), "pendingCount": 1}
        except MisaTransientError as exc:
            with conn.transaction():
                attempts = int(run["attempt_count"] or 0) + 1
                status = "FAILED" if attempts >= 8 else "RETRY"
                if status == "FAILED":
                    message = (
                        f"{str(exc)[:700]}. MISA vẫn chưa phản hồi ổn định sau {attempts} lần thử; "
                        "phiên dữ liệu tốt gần nhất vẫn được giữ nguyên."
                    )
                else:
                    message = (
                        f"{str(exc)[:700]}. Hệ thống sẽ tự thử lại có giãn cách "
                        f"({attempts}/8); phiên dữ liệu tốt hiện tại vẫn được giữ nguyên."
                    )
                conn.execute(
                    f"""UPDATE {SCHEMA}.accounting_sync_runs
                        SET status=%s,stage=%s,last_error=%s,attempt_count=%s,
                            finished_at=CASE WHEN %s='FAILED' THEN now() ELSE finished_at END,
                            updated_at=now()
                        WHERE run_id=%s""",
                    (
                        status,
                        run["stage"] if status == "FAILED" else "RETRY_MISA",
                        message[:1000],
                        attempts,
                        status,
                        run["run_id"],
                    ),
                )
                if status == "FAILED":
                    conn.execute(
                        f"UPDATE {SCHEMA}.accounting_snapshots SET status='FAILED' WHERE snapshot_id=%s AND status='LOADING'",
                        (run["snapshot_id"],),
                    )
            return {
                "ok": False,
                "transient": status != "FAILED",
                "runId": str(run["run_id"]),
                "message": message[:500],
                "pendingCount": 0 if status == "FAILED" else 1,
            }
        except Exception as exc:
            with conn.transaction():
                attempts = int(run["attempt_count"] or 0) + 1
                status = "FAILED" if attempts >= 5 else "RETRY"
                conn.execute(
                    f"""UPDATE {SCHEMA}.accounting_sync_runs
                        SET status=%s,stage=%s,last_error=%s,attempt_count=%s,
                            finished_at=CASE WHEN %s='FAILED' THEN now() ELSE finished_at END,
                            updated_at=now()
                        WHERE run_id=%s""",
                    (
                        status,
                        run["stage"] if status == "FAILED" else "RETRY_ERROR",
                        str(exc)[:1000],
                        attempts,
                        status,
                        run["run_id"],
                    ),
                )
                if status == "FAILED":
                    conn.execute(
                        f"UPDATE {SCHEMA}.accounting_snapshots SET status='FAILED' WHERE snapshot_id=%s AND status='LOADING'",
                        (run["snapshot_id"],),
                    )
            return {"ok": False, "runId": str(run["run_id"]), "message": str(exc)[:500], "pendingCount": 0 if attempts >= 5 else 1}


def _autorun_loop() -> None:
    AUTORUN_STOP.wait(2)
    while not AUTORUN_STOP.is_set():
        try:
            result = _continue_one()
            AUTORUN_STOP.wait(5 if result.get("idle") else 1)
        except Exception:
            AUTORUN_STOP.wait(10)


@app.post("/jobs/continue")
def continue_jobs(_: None = Depends(_auth)) -> Dict[str, Any]:
    return _continue_one()


def _run_view(row: Dict[str, Any]) -> Dict[str, Any]:
    total_pages = int(row.get("total_pages") or 0)
    processed = int(row.get("processed_pages") or 0)
    return _safe({
        "runId": row.get("run_id"), "sourceKey": row.get("source_key"), "sourceName": row.get("source_name"),
        "reportName": row.get("report_name"), "companyKey": row.get("company_key"),
        "dataSpaceKey": row.get("data_space_key"), "dataSpaceName": row.get("data_space_name"),
        "datasetType": row.get("dataset_type"), "periodFrom": row.get("period_from"), "periodTo": row.get("period_to"),
        "status": row.get("status"), "stage": row.get("stage"), "pageSize": row.get("page_size"),
        "nextPage": row.get("next_page"), "totalPages": total_pages, "processedPages": processed,
        "progressPercent": round(processed / total_pages * 100, 1) if total_pages else 0,
        "sourceTotalRows": row.get("source_total_rows"), "importedRows": row.get("imported_rows"),
        "addedCount": row.get("added_count"), "updatedCount": row.get("updated_count"),
        "deletedCount": row.get("deleted_count"), "unchangedCount": row.get("unchanged_count"),
        "lastError": row.get("last_error"), "requestedBy": row.get("requested_by"),
        "requestedAt": row.get("requested_at"), "finishedAt": row.get("finished_at"), "updatedAt": row.get("updated_at"),
    })


def _change_filters(request: BootstrapRequest) -> tuple[str, List[Any]]:
    where = ["1=1"]
    params: List[Any] = []
    if request.sourceKey:
        where.append("source_key=%s")
        params.append(_clean_key(request.sourceKey))
    if request.companyKey:
        where.append("company_key=%s")
        params.append(_clean_key(request.companyKey))
    if request.dataSpaceKey:
        where.append("data_space_key=%s")
        params.append(_clean_key(request.dataSpaceKey, "mã khối dữ liệu"))
    if request.period:
        try:
            year, month = map(int, request.period.split("-"))
            start = date(year, month, 1)
            end = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)
            where.append("period_from < %s AND period_to >= %s")
            params.extend([end, start])
        except Exception as exc:
            raise HTTPException(status_code=400, detail="Kỳ lọc phải có dạng YYYY-MM") from exc
    if request.reviewStatus:
        where.append("review_status=%s")
        params.append(request.reviewStatus.strip().upper())
    if request.changeType:
        where.append("change_type=%s")
        params.append(request.changeType.strip().upper())
    return " AND ".join(where), params


def _change_view(row: Dict[str, Any]) -> Dict[str, Any]:
    return _safe({
        "changeId": row.get("change_id"), "runId": row.get("run_id"), "sourceKey": row.get("source_key"),
        "companyKey": row.get("company_key"), "periodFrom": row.get("period_from"), "periodTo": row.get("period_to"),
        "dataSpaceKey": row.get("data_space_key"), "dataSpaceName": row.get("data_space_name"),
        "accountNumber": row.get("account_number"), "accountName": row.get("account_name"),
        "changeType": row.get("change_type"), "changedFields": row.get("changed_fields") or [],
        "amountDeltas": row.get("amount_deltas") or {}, "beforeData": row.get("before_data"), "afterData": row.get("after_data"),
        "reviewStatus": row.get("review_status"), "reviewNote": row.get("review_note"),
        "reviewedBy": row.get("reviewed_by"), "reviewedAt": row.get("reviewed_at"), "detectedAt": row.get("detected_at"),
    })


@app.post("/control/bootstrap")
def bootstrap(request: BootstrapRequest, _: None = Depends(_auth)) -> Dict[str, Any]:
    pool = _pool()
    with pool.connection() as conn:
        if not _schema_ready(conn):
            return {
                "ok": True,
                "schemaReady": False,
                "sources": [],
                "runs": [],
                "changes": [],
                "activeSnapshots": [],
                "snapshotHistory": [],
                "dataControls": [],
                "reportResultSnapshots": [],
                "summary": {},
            }
        sources = conn.execute(
            f"""SELECT source_key,base_source_key,source_name,source_type,company_key,
                data_space_key,data_space_name,data_space_identity,dataset_type,endpoint_url,report_id,report_name,
                page_size,credential_expires_at,credential_status,credential_last_checked_at,
                credential_last_success_at,credential_last_error,last_session_at,updated_at
                FROM {SCHEMA}.accounting_source_connections ORDER BY source_name"""
        ).fetchall()
        runs = conn.execute(
            f"""SELECT r.*,c.source_name,c.report_name
                FROM {SCHEMA}.accounting_sync_runs r
                LEFT JOIN {SCHEMA}.accounting_source_connections c ON c.source_key=r.source_key
                ORDER BY r.requested_at DESC LIMIT 40"""
        ).fetchall()
        where, params = _change_filters(request)
        limit = max(1, min(500, int(request.limit or 80)))
        changes = conn.execute(
            f"SELECT * FROM {SCHEMA}.accounting_change_events WHERE {where} ORDER BY detected_at DESC,change_id DESC LIMIT %s",
            tuple(params + [limit]),
        ).fetchall()
        summary = conn.execute(
            f"""SELECT
                count(*) FILTER (WHERE review_status='UNREVIEWED') AS unreviewed,
                count(*) FILTER (WHERE change_type='ADDED') AS added,
                count(*) FILTER (WHERE change_type='UPDATED') AS updated,
                count(*) FILTER (WHERE change_type='DELETED') AS deleted
              FROM {SCHEMA}.accounting_change_events WHERE {where}""",
            tuple(params),
        ).fetchone()
        active = conn.execute(
            f"""SELECT s.snapshot_id,a.source_key,a.company_key,a.data_space_key,a.data_space_name,
                a.period_from,a.period_to,a.activated_at,s.version_no,s.row_count,s.is_published,
                s.dataset_type,s.created_at,
                (SELECT count(*) FROM {SCHEMA}.accounting_journal_entries j
                 WHERE j.snapshot_id=a.snapshot_id) AS journal_entry_count,
                (SELECT count(*) FROM {SCHEMA}.accounting_journal_monthly m
                 WHERE m.snapshot_id=a.snapshot_id) AS journal_monthly_group_count,
                CASE WHEN d.source_key IS NULL THEN false ELSE true END AS needs_refresh,
                COALESCE(d.reason,'') AS refresh_reason
                FROM {SCHEMA}.accounting_active_snapshots a
                JOIN {SCHEMA}.accounting_snapshots s ON s.snapshot_id=a.snapshot_id
                LEFT JOIN {SCHEMA}.accounting_dirty_periods d ON d.source_key=a.source_key AND d.company_key=a.company_key
                  AND d.period_from=a.period_from AND d.period_to=a.period_to AND d.status='PENDING'
                WHERE s.row_count>0
                ORDER BY a.activated_at DESC LIMIT 40"""
        ).fetchall()
        history = conn.execute(
            f"""SELECT s.snapshot_id,s.source_key,c.base_source_key,s.company_key,
                s.data_space_key,s.data_space_name,s.dataset_type,s.period_from,s.period_to,
                s.version_no,s.row_count,s.status,s.is_published,s.created_at,s.activated_at,
                s.supersedes_snapshot_id,
                CASE WHEN a.snapshot_id IS NULL THEN false ELSE true END AS is_active,
                CASE WHEN a.snapshot_id IS NOT NULL AND d.source_key IS NOT NULL THEN true ELSE false END AS needs_refresh,
                COALESCE(d.reason,'') AS refresh_reason
              FROM {SCHEMA}.accounting_snapshots s
              JOIN {SCHEMA}.accounting_source_connections c ON c.source_key=s.source_key
              LEFT JOIN {SCHEMA}.accounting_active_snapshots a ON a.snapshot_id=s.snapshot_id
              LEFT JOIN {SCHEMA}.accounting_dirty_periods d ON d.source_key=s.source_key AND d.company_key=s.company_key
                AND d.period_from=s.period_from AND d.period_to=s.period_to AND d.status='PENDING'
              WHERE s.status IN ('ACTIVE','SUPERSEDED') AND s.row_count>0
              ORDER BY COALESCE(s.activated_at,s.created_at) DESC LIMIT 120"""
        ).fetchall()
        controls = conn.execute(
            f"""SELECT dc.control_id,dc.run_id,dc.snapshot_id,dc.control_key,dc.status,
                dc.debit_total,dc.credit_total,dc.difference,dc.issue_count,dc.details,
                dc.checked_at,s.source_key,s.company_key,s.data_space_key,s.data_space_name,
                s.period_from,s.period_to
              FROM {SCHEMA}.accounting_data_controls dc
              JOIN {SCHEMA}.accounting_snapshots s ON s.snapshot_id=dc.snapshot_id
              ORDER BY dc.checked_at DESC,dc.control_id DESC LIMIT 80"""
        ).fetchall()
        report_results = conn.execute(
            f"""SELECT report_result_id,version_id,report_key,report_name,company_key,
                       data_space_key,data_space_name,period_from,period_to,source_file_name,
                       source_sheet_name,source_header_row,row_count,status,note,created_by,created_at
                  FROM {SCHEMA}.accounting_report_result_snapshots
                 WHERE status IN ('ACTIVE','SUPERSEDED')
                 ORDER BY created_at DESC LIMIT 200"""
        ).fetchall()
    return {
        "ok": True, "schemaReady": True,
        "sources": [_safe(dict(row)) for row in sources],
        "runs": [_run_view(dict(row)) for row in runs],
        "changes": [_change_view(dict(row)) for row in changes],
        "activeSnapshots": [_safe(dict(row)) for row in active],
        "snapshotHistory": [_safe(dict(row)) for row in history],
        "dataControls": [_safe(dict(row)) for row in controls],
        "reportResultSnapshots": [_safe(dict(row)) for row in report_results],
        "summary": _safe(dict(summary)),
    }


def _delete_test_data_space(
    conn: psycopg.Connection,
    space: Dict[str, Any],
) -> Dict[str, int]:
    company_key = space["companyKey"]
    data_space_key = space["dataSpaceKey"]
    params = (company_key, data_space_key)
    statements = (
        (
            "reportCaches",
            f"""DELETE FROM {SCHEMA}.accounting_report_cache c
                 WHERE EXISTS (
                   SELECT 1 FROM {SCHEMA}.accounting_snapshots s
                    WHERE s.company_key=%s AND s.data_space_key=%s
                      AND c.snapshot_refs::text LIKE ('%%' || s.snapshot_id::text || '%%'))""",
        ),
        ("activeSnapshots", f"DELETE FROM {SCHEMA}.accounting_active_snapshots WHERE company_key=%s AND data_space_key=%s"),
        ("dirtyPeriods", f"DELETE FROM {SCHEMA}.accounting_dirty_periods WHERE company_key=%s AND data_space_key=%s"),
        ("reportResults", f"DELETE FROM {SCHEMA}.accounting_report_result_snapshots WHERE company_key=%s AND data_space_key=%s"),
        ("changeEvents", f"DELETE FROM {SCHEMA}.accounting_change_events WHERE company_key=%s AND data_space_key=%s"),
        (
            "dataControls",
            f"""DELETE FROM {SCHEMA}.accounting_data_controls d
                 WHERE d.snapshot_id IN (
                   SELECT snapshot_id FROM {SCHEMA}.accounting_snapshots
                    WHERE company_key=%s AND data_space_key=%s)""",
        ),
        (
            "syncPages",
            f"""DELETE FROM {SCHEMA}.accounting_sync_pages p
                 WHERE p.run_id IN (
                   SELECT run_id FROM {SCHEMA}.accounting_sync_runs
                    WHERE company_key=%s AND data_space_key=%s)""",
        ),
        ("journalMonthly", f"DELETE FROM {SCHEMA}.accounting_journal_monthly WHERE company_key=%s AND data_space_key=%s"),
        ("journalEntries", f"DELETE FROM {SCHEMA}.accounting_journal_entries WHERE company_key=%s AND data_space_key=%s"),
        ("sourceRows", f"DELETE FROM {SCHEMA}.accounting_source_rows WHERE company_key=%s AND data_space_key=%s"),
        ("syncRuns", f"DELETE FROM {SCHEMA}.accounting_sync_runs WHERE company_key=%s AND data_space_key=%s"),
        ("snapshots", f"DELETE FROM {SCHEMA}.accounting_snapshots WHERE company_key=%s AND data_space_key=%s"),
        (
            "noteCatalogItems",
            f"""DELETE FROM {SCHEMA}.accounting_note_catalog_items n
                 WHERE n.source_key IN (
                   SELECT source_key FROM {SCHEMA}.accounting_source_connections
                    WHERE company_key=%s AND data_space_key=%s)""",
        ),
        (
            "noteCatalogMeta",
            f"""DELETE FROM {SCHEMA}.accounting_note_catalog_meta n
                 WHERE n.source_key IN (
                   SELECT source_key FROM {SCHEMA}.accounting_source_connections
                    WHERE company_key=%s AND data_space_key=%s)""",
        ),
        ("sourceConnections", f"DELETE FROM {SCHEMA}.accounting_source_connections WHERE company_key=%s AND data_space_key=%s"),
    )
    deleted = {key: 0 for key in _CLEANUP_COUNT_LABELS}
    for key, statement in statements:
        deleted[key] += int(conn.execute(statement, params).rowcount or 0)
    return deleted


@app.post("/data-spaces/test-cleanup/preview")
def preview_test_data_space_cleanup(
    request: TestDataSpaceCleanupPreviewRequest,
    _: None = Depends(_auth),
) -> Dict[str, Any]:
    pool = _pool()
    with pool.connection() as conn:
        if not _schema_ready(conn):
            raise HTTPException(status_code=409, detail="Hãy khởi tạo cấu trúc PostgreSQL trước")
        return _test_data_space_cleanup_preview(conn, request.targets)


@app.post("/data-spaces/test-cleanup/delete")
def delete_test_data_spaces(
    request: TestDataSpaceCleanupRequest,
    _: None = Depends(_auth),
) -> Dict[str, Any]:
    pool = _pool()
    with pool.connection() as conn, conn.transaction():
        if not _schema_ready(conn):
            raise HTTPException(status_code=409, detail="Hãy khởi tạo cấu trúc PostgreSQL trước")
        targets = _cleanup_targets(request.targets)
        for target in targets:
            conn.execute(
                f"""SELECT source_key FROM {SCHEMA}.accounting_source_connections
                     WHERE company_key=%s AND data_space_key=%s FOR UPDATE""",
                (target["companyKey"], target["dataSpaceKey"]),
            ).fetchall()
        preview = _test_data_space_cleanup_preview(conn, request.targets)
        if preview["runningRunCount"]:
            raise HTTPException(
                status_code=409,
                detail="Đang có lần cập nhật dữ liệu chạy trong khối đã chọn. Hãy đợi hoàn tất rồi xem trước lại.",
            )
        if not _secure_text_equal(request.previewToken.strip(), preview["previewToken"]):
            raise HTTPException(
                status_code=409,
                detail="Dữ liệu đã thay đổi sau lần xem trước. Hãy bấm Xem dữ liệu sẽ xóa lại.",
            )
        if not _secure_text_equal(request.confirmation.strip(), preview["confirmationPhrase"]):
            raise HTTPException(
                status_code=400,
                detail="Câu xác nhận chưa khớp chính xác với các khối dữ liệu đã chọn.",
            )
        deleted_totals = {key: 0 for key in _CLEANUP_COUNT_LABELS}
        deleted_spaces: List[Dict[str, Any]] = []
        for space in preview["spaces"]:
            deleted = _delete_test_data_space(conn, space)
            for key, value in deleted.items():
                deleted_totals[key] += value
            conn.execute(
                f"""INSERT INTO {SCHEMA}.accounting_cleanup_audit(
                      company_key,data_space_key,data_space_name,requested_by,deleted_counts,preview_token
                    ) VALUES (%s,%s,%s,%s,%s::jsonb,%s)""",
                (
                    space["companyKey"],
                    space["dataSpaceKey"],
                    space["dataSpaceName"],
                    request.requestedBy.strip()[:240],
                    json.dumps(deleted, ensure_ascii=False),
                    preview["previewToken"],
                ),
            )
            deleted_spaces.append({
                "companyKey": space["companyKey"],
                "dataSpaceKey": space["dataSpaceKey"],
                "dataSpaceName": space["dataSpaceName"],
                "deletedCounts": deleted,
            })
    return {
        "ok": True,
        "deletedSpaces": deleted_spaces,
        "deletedCounts": deleted_totals,
        "deletedRecordCount": sum(deleted_totals.values()),
        "countLabels": _CLEANUP_COUNT_LABELS,
        "message": (
            f"Đã xóa vĩnh viễn {len(deleted_spaces)} khối dữ liệu thử và "
            f"{sum(deleted_totals.values()):,} bản ghi liên quan khỏi PostgreSQL."
        ),
    }


@app.post("/changes/review")
def review_changes(request: ChangeReviewRequest, _: None = Depends(_auth)) -> Dict[str, Any]:
    status = request.reviewStatus.strip().upper()
    if status not in {"UNREVIEWED", "REVIEWED", "CONFIRMED"}:
        raise HTTPException(status_code=400, detail="Trạng thái xem xét không hợp lệ")
    ids = sorted({int(item) for item in request.changeIds if int(item) > 0})
    if not ids or len(ids) > 500:
        raise HTTPException(status_code=400, detail="Hãy chọn từ 1 đến 500 thay đổi")
    pool = _pool()
    with pool.connection() as conn, conn.transaction():
        result = conn.execute(
            f"""UPDATE {SCHEMA}.accounting_change_events SET review_status=%s,review_note=%s,reviewed_by=%s,
                reviewed_at=CASE WHEN %s='UNREVIEWED' THEN NULL ELSE now() END WHERE change_id=ANY(%s)""",
            (status, request.note.strip(), request.reviewedBy.strip(), status, ids),
        )
    return {"ok": True, "updatedCount": result.rowcount, "reviewStatus": status}


@app.post("/changes/export")
def export_changes(request: ChangeExportRequest, _: None = Depends(_auth)) -> Dict[str, Any]:
    where, params = _change_filters(request)
    limit = max(1, min(50000, int(request.limit or 10000)))
    pool = _pool()
    with pool.connection() as conn:
        if not _schema_ready(conn):
            raise HTTPException(status_code=409, detail="Hãy khởi tạo cấu trúc PostgreSQL trước")
        rows = conn.execute(
            f"SELECT * FROM {SCHEMA}.accounting_change_events WHERE {where} ORDER BY detected_at DESC,change_id DESC LIMIT %s",
            tuple(params + [limit]),
        ).fetchall()
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Mã thay đổi", "Công ty", "Khối dữ liệu", "Mã khối dữ liệu", "Từ ngày", "Đến ngày", "Tài khoản", "Tên tài khoản", "Loại thay đổi", "Cột thay đổi", "Chênh lệch", "Trạng thái", "Giải trình", "Phát hiện lúc", "Người xác nhận"])
    for row in rows:
        writer.writerow([
            row["change_id"], row["company_key"], row["data_space_name"], row["data_space_key"],
            row["period_from"], row["period_to"], row["account_number"],
            row["account_name"], row["change_type"], ", ".join(row["changed_fields"] or []),
            json.dumps(row["amount_deltas"] or {}, ensure_ascii=False), row["review_status"], row["review_note"],
            row["detected_at"].isoformat() if row["detected_at"] else "", row["reviewed_by"],
        ])
    csv_bytes = ("\ufeff" + output.getvalue()).encode("utf-8")
    return {
        "ok": True,
        "fileName": f"Lich_su_dieu_chinh_so_lieu_{datetime.now(LOCAL_TZ).strftime('%Y%m%d_%H%M%S')}.csv",
        "mimeType": "text/csv",
        "base64": base64.b64encode(csv_bytes).decode("ascii"),
        "rowCount": len(rows),
    }


@app.post("/journal/entries")
def query_journal_entries(
    request: JournalQueryRequest,
    _: None = Depends(_auth),
) -> Dict[str, Any]:
    if request.periodFrom > request.periodTo:
        raise HTTPException(status_code=400, detail="Từ ngày phải trước hoặc bằng đến ngày")
    where = ["(j.posted_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date BETWEEN %s AND %s"]
    params: List[Any] = [request.periodFrom, request.periodTo]
    if request.sourceKeys:
        where.append("(j.source_key=ANY(%s) OR c.base_source_key=ANY(%s))")
        sources = [_clean_key(item) for item in request.sourceKeys]
        params.extend([sources, sources])
    if request.companyKeys:
        where.append("j.company_key=ANY(%s)")
        params.append([_clean_key(item) for item in request.companyKeys])
    if request.dataSpaceKeys:
        where.append("j.data_space_key=ANY(%s)")
        params.append([_clean_key(item, "mã khối dữ liệu") for item in request.dataSpaceKeys])
    if request.accountNumber:
        where.append("j.debit_account=%s")
        params.append(request.accountNumber.strip())
    if request.correspondingAccountNumber:
        where.append("j.credit_account=%s")
        params.append(request.correspondingAccountNumber.strip())
    if request.referenceNo:
        where.append("j.reference_no ILIKE %s")
        params.append(f"%{request.referenceNo.strip()}%")
    if request.search:
        where.append("(j.reference_no ILIKE %s OR j.journal_memo ILIKE %s OR j.description ILIKE %s)")
        search = f"%{request.search.strip()}%"
        params.extend([search, search, search])
    page_size = max(1, min(500, int(request.pageSize or 100)))
    page = max(1, int(request.page or 1))
    params.extend([page_size, (page - 1) * page_size])
    pool = _pool()
    with pool.connection() as conn:
        if not _schema_ready(conn):
            raise HTTPException(status_code=409, detail="Hãy khởi tạo cấu trúc PostgreSQL trước")
        rows = conn.execute(
            f"""WITH selected_snapshots AS (
                SELECT snapshot_id FROM (
                  SELECT a.snapshot_id,
                    row_number() OVER (
                      PARTITION BY a.source_key,a.company_key,a.data_space_key,s.dataset_type
                      ORDER BY
                        CASE WHEN a.period_from=%s AND a.period_to=%s THEN 0 ELSE 1 END,
                        (a.period_to-a.period_from),a.activated_at DESC
                    ) AS selected_rank
                  FROM {SCHEMA}.accounting_active_snapshots a
                  JOIN {SCHEMA}.accounting_snapshots s ON s.snapshot_id=a.snapshot_id
                  WHERE s.dataset_type=ANY(%s)
                    AND a.period_from<=%s AND a.period_to>=%s
                ) candidates WHERE selected_rank=1
              )
              SELECT j.*,c.base_source_key,count(*) OVER() AS total_rows
              FROM {SCHEMA}.accounting_journal_entries j
              JOIN selected_snapshots selected ON selected.snapshot_id=j.snapshot_id
              JOIN {SCHEMA}.accounting_source_connections c ON c.source_key=j.source_key
              WHERE {' AND '.join(where)}
              ORDER BY j.posted_at,j.reference_no,j.source_row_key
              LIMIT %s OFFSET %s""",
            tuple(
                [
                    request.periodFrom,
                    request.periodTo,
                    sorted(JOURNAL_DATASET_TYPES),
                    request.periodFrom,
                    request.periodTo,
                ]
                + params
            ),
        ).fetchall()
    total = int(rows[0]["total_rows"] or 0) if rows else 0
    result_rows = []
    for row in rows:
        item = dict(row)
        item.pop("total_rows", None)
        item.pop("raw_data", None)
        result_rows.append(_safe(item))
    return {
        "ok": True,
        "rows": result_rows,
        "rowCount": len(result_rows),
        "totalRows": total,
        "page": page,
        "pageSize": page_size,
    }


def _is_complete_month_range(period_from: date, period_to: date) -> bool:
    next_month = (
        date(period_to.year + 1, 1, 1)
        if period_to.month == 12
        else date(period_to.year, period_to.month + 1, 1)
    )
    return period_from.day == 1 and period_to == next_month - date.resolution


_JOURNAL_DETAIL_FILTER_FIELDS = {
    "SEARCH_TEXT",
    "DOCUMENT_TEXT",
    "NOI_DUNG_CHUNG_TU",
    "DESCRIPTION",
    "JOURNAL_MEMO",
    "REFERENCE_NO",
    "REFERENCE_ID",
}


def _optional_config_key(value: Any) -> str:
    """Normalize a configuration key without turning an absent optional value into HTTP 400."""

    return re.sub(r"[^A-Za-z0-9_.-]+", "_", str(value or "").strip()).strip("_").upper()


def _report_dependency_keys(records: List[Dict[str, Any]], report_key: str) -> set[str]:
    """Return only the reports that can be reached from the requested report.

    A configuration version contains every financial statement.  Loading data
    for all of them made one text condition in the cash-flow statement force
    detailed journal loading even when the user opened another report.  Follow
    explicit cross-report links and B09 disclosure links instead.
    """

    root_key = _optional_config_key(report_key)
    if not root_key:
        return set()
    rule_by_key = {
        _optional_config_key(record.get("entityKey")): record
        for record in records
        if record.get("recordType") == "RULE" and record.get("entityKey")
    }
    dependencies: set[str] = set()
    pending_reports = [root_key]
    pending_rules: List[str] = []
    visited_rules: set[str] = set()

    def inspect_payload(value: Any) -> None:
        if isinstance(value, dict):
            for key, item in value.items():
                if key in ("targetReportKey", "sourceReportKey"):
                    target = _optional_config_key(item)
                    if target and target not in dependencies:
                        pending_reports.append(target)
                elif key == "ruleKey":
                    rule_key = _optional_config_key(item)
                    if rule_key and rule_key not in visited_rules:
                        pending_rules.append(rule_key)
                elif key == "ruleKeys" and isinstance(item, list):
                    for entry in item:
                        rule_key = _optional_config_key(entry)
                        if rule_key and rule_key not in visited_rules:
                            pending_rules.append(rule_key)
                inspect_payload(item)
        elif isinstance(value, list):
            for item in value:
                inspect_payload(item)

    while pending_reports or pending_rules:
        while pending_rules:
            rule_key = pending_rules.pop()
            if rule_key in visited_rules:
                continue
            visited_rules.add(rule_key)
            rule = rule_by_key.get(rule_key)
            if rule:
                inspect_payload(rule.get("payload") or {})

        if not pending_reports:
            continue
        current = pending_reports.pop()
        if not current or current in dependencies:
            continue
        dependencies.add(current)
        for record in records:
            record_type = str(record.get("recordType") or "")
            payload = record.get("payload") or {}
            payload_report = _optional_config_key(payload.get("reportKey"))
            belongs_to_report = (
                (record_type == "REPORT" and _optional_config_key(record.get("entityKey")) == current)
                or payload_report == current
            )
            belongs_to_disclosure = (
                current == DISCLOSURE_REPORT_KEY
                and record_type.startswith("DISCLOSURE_")
            )
            if not (belongs_to_report or belongs_to_disclosure):
                continue
            if belongs_to_disclosure and record_type == "DISCLOSURE_LINK":
                linked_report = _optional_config_key(payload.get("reportKey"))
                if linked_report and linked_report not in dependencies:
                    pending_reports.append(linked_report)
            inspect_payload(payload)

    return dependencies


def _report_records_require_journal_detail(
    records: List[Dict[str, Any]],
    report_key: str = "",
) -> bool:
    """Detect formula filters that cannot be evaluated from monthly aggregates.

    The monthly journal table intentionally keeps accounting dimensions but not
    voucher text/reference fields.  A configured term that uses those fields
    must therefore read canonical journal entries; otherwise a valid condition
    would silently see an empty value for a complete-month report.
    """

    def filters_require_detail(filters: Any) -> bool:
        if not isinstance(filters, dict):
            return False
        for condition in filters.get("conditions") or []:
            if not isinstance(condition, dict):
                continue
            if _clean_key(condition.get("field") or "") in _JOURNAL_DETAIL_FILTER_FIELDS:
                return True
        return any(
            _clean_key(field or "") in _JOURNAL_DETAIL_FILTER_FIELDS
            for field in filters
            if field not in ("conditions", "logic")
        )

    def payload_requires_detail(value: Any) -> bool:
        if isinstance(value, dict):
            if filters_require_detail(value.get("filters")):
                return True
            return any(payload_requires_detail(item) for item in value.values())
        if isinstance(value, list):
            return any(payload_requires_detail(item) for item in value)
        return False

    dependency_keys = _report_dependency_keys(records, report_key) if report_key else set()
    relevant_rule_keys: set[str] = set()

    def collect_rule_keys(value: Any) -> None:
        if isinstance(value, dict):
            for key, item in value.items():
                if key == "ruleKey":
                    normalized = _optional_config_key(item)
                    if normalized:
                        relevant_rule_keys.add(normalized)
                elif key == "ruleKeys" and isinstance(item, list):
                    relevant_rule_keys.update(
                        normalized
                        for normalized in (_optional_config_key(entry) for entry in item)
                        if normalized
                    )
                collect_rule_keys(item)
        elif isinstance(value, list):
            for item in value:
                collect_rule_keys(item)

    relevant_records: List[Dict[str, Any]] = []
    for record in records:
        payload = record.get("payload") or {}
        if not dependency_keys:
            relevant_records.append(record)
            continue
        record_type = str(record.get("recordType") or "")
        payload_report = _optional_config_key(payload.get("reportKey"))
        if (
            payload_report in dependency_keys
            or (
                record_type == "REPORT"
                and _optional_config_key(record.get("entityKey")) in dependency_keys
            )
            or (
                DISCLOSURE_REPORT_KEY in dependency_keys
                and record_type.startswith("DISCLOSURE_")
            )
        ):
            relevant_records.append(record)
            collect_rule_keys(payload)

    if relevant_rule_keys:
        relevant_records.extend(
            record
            for record in records
            if record.get("recordType") == "RULE"
            and _optional_config_key(record.get("entityKey")) in relevant_rule_keys
            and record not in relevant_records
        )
    return any(
        payload_requires_detail(record.get("payload") or {})
        for record in relevant_records
    )


def _reject_overlapping_snapshot_versions(selected: List[Any]) -> None:
    """A report may combine sources, but never two versions of one exact source slot."""
    slots: Dict[str, List[str]] = {}
    for row in selected:
        item = dict(row)
        slot = "::".join(
            str(item.get(field) or "")
            for field in (
                "source_key", "company_key", "data_space_key", "dataset_type", "period_from", "period_to"
            )
        )
        slots.setdefault(slot, []).append(str(item.get("snapshot_id") or ""))
    conflicts = [slot for slot, snapshot_ids in slots.items() if len(snapshot_ids) > 1]
    if conflicts:
        raise HTTPException(
            status_code=409,
            detail=(
                "Ban dang chon ca phien cu va phien moi cua cung mot nguon du lieu. "
                "Chi chon mot phien cho moi nguon, khoi du lieu, loai du lieu va ky bao cao."
            ),
        )


def _reject_mixed_data_spaces_per_company(selected: List[Any]) -> None:
    """One company-period must come from one MISA data space, even in consolidated reports."""
    company_period_spaces: Dict[str, set[str]] = {}
    for row in selected:
        item = dict(row)
        company_period = "::".join(
            str(item.get(field) or "")
            for field in ("company_key", "period_from", "period_to")
        )
        data_space_key = str(item.get("data_space_key") or "")
        if company_period.strip(":") and data_space_key:
            company_period_spaces.setdefault(company_period, set()).add(data_space_key)
    conflicts = [
        (company_period, sorted(data_spaces))
        for company_period, data_spaces in company_period_spaces.items()
        if len(data_spaces) > 1
    ]
    if conflicts:
        company_key = conflicts[0][0].split("::", 1)[0]
        raise HTTPException(
            status_code=409,
            detail=(
                f"Công ty {company_key} đang được chọn từ nhiều khối dữ liệu trong cùng kỳ. "
                "Hãy chỉ giữ một khối của công ty này để tránh cộng trùng số liệu."
            ),
        )


@app.post("/report/balances")
def query_balances(request: BalanceQueryRequest, _: None = Depends(_auth)) -> Dict[str, Any]:
    requested_snapshot_ids = list(
        dict.fromkeys(str(item or "").strip() for item in request.snapshotIds if str(item or "").strip())
    )
    if len(requested_snapshot_ids) > 100:
        raise HTTPException(status_code=400, detail="Chỉ được chọn tối đa 100 phiên dữ liệu cho một báo cáo")
    if any(not re.fullmatch(r"[0-9a-fA-F-]{36}", item) for item in requested_snapshot_ids):
        raise HTTPException(status_code=400, detail="Mã phiên dữ liệu không hợp lệ")
    if not requested_snapshot_ids and not request.sourceKeys and not request.dataSpaceKeys:
        raise HTTPException(
            status_code=400,
            detail="Phải chọn ít nhất một nguồn hoặc một khối dữ liệu; hệ thống không tự trộn các khối MISA",
        )
    if request.periodFrom > request.periodTo:
        raise HTTPException(status_code=400, detail="Từ ngày phải trước hoặc bằng đến ngày")
    where = [
        "((s.dataset_type=ANY(%s) AND s.period_from<=%s AND s.period_to>=%s) "
        "OR (NOT (s.dataset_type=ANY(%s)) AND s.period_from=%s AND s.period_to=%s))"
    ]
    journal_types = sorted(JOURNAL_DATASET_TYPES)
    params: List[Any] = [
        journal_types,
        request.periodFrom,
        request.periodTo,
        journal_types,
        request.periodFrom,
        request.periodTo,
    ]
    if requested_snapshot_ids:
        where.append("s.snapshot_id=ANY(%s)")
        params.append(requested_snapshot_ids)
    if request.sourceKeys:
        where.append("(s.source_key=ANY(%s) OR c.base_source_key=ANY(%s))")
        cleaned_sources = [_clean_key(item) for item in request.sourceKeys]
        params.append(cleaned_sources)
        params.append(cleaned_sources)
    if request.companyKeys:
        where.append("s.company_key=ANY(%s)")
        params.append([_clean_key(item) for item in request.companyKeys])
    if request.dataSpaceKeys:
        where.append("s.data_space_key=ANY(%s)")
        params.append([_clean_key(item, "mã khối dữ liệu") for item in request.dataSpaceKeys])
    limit = max(1, min(MAX_REPORT_ROWS, int(request.limit or 20000)))
    pool = _pool()
    with pool.connection() as conn:
        if not _schema_ready(conn):
            raise HTTPException(status_code=409, detail="Hãy khởi tạo cấu trúc PostgreSQL trước")
        if requested_snapshot_ids:
            selected = conn.execute(
                f"""SELECT s.snapshot_id,s.source_key,c.base_source_key,s.dataset_type,
                      s.company_key,s.data_space_key,s.data_space_name,s.period_from,s.period_to,
                      COALESCE(s.activated_at,s.created_at) AS activated_at
                    FROM {SCHEMA}.accounting_snapshots s
                    JOIN {SCHEMA}.accounting_source_connections c ON c.source_key=s.source_key
                    WHERE s.status IN ('ACTIVE','SUPERSEDED') AND s.row_count>0 AND {' AND '.join(where)}
                    ORDER BY s.company_key,s.data_space_name,s.dataset_type,s.created_at DESC""",
                tuple(params),
            ).fetchall()
            selected_ids = {str(row["snapshot_id"]) for row in selected}
            if any(item not in selected_ids for item in requested_snapshot_ids):
                raise HTTPException(
                    status_code=409,
                    detail="Có phiên dữ liệu không sẵn sàng cho kỳ, nguồn hoặc khối đang chọn. Hãy tải lại danh sách và chọn lại.",
            )
            _reject_overlapping_snapshot_versions(selected)
            _reject_mixed_data_spaces_per_company(selected)
        elif request.lockSnapshotSelection:
            # Báo cáo đã khóa lựa chọn cho kỳ này nhưng chưa có phiên phù hợp.
            # Trả rỗng để tầng dựng báo cáo cảnh báo rõ ràng thay vì âm thầm
            # dùng bản active của một kỳ khác.
            selected = []
        else:
            selected = conn.execute(
                f"""SELECT * FROM (
                      SELECT a.snapshot_id,a.source_key,c.base_source_key,s.dataset_type,
                        a.company_key,a.data_space_key,a.data_space_name,a.period_from,a.period_to,
                        a.activated_at,
                        row_number() OVER (
                          PARTITION BY a.source_key,a.company_key,a.data_space_key,s.dataset_type
                          ORDER BY
                            CASE WHEN a.period_from=%s AND a.period_to=%s THEN 0 ELSE 1 END,
                            (a.period_to-a.period_from),a.activated_at DESC
                        ) AS selected_rank
                      FROM {SCHEMA}.accounting_active_snapshots a
                      JOIN {SCHEMA}.accounting_snapshots s ON s.snapshot_id=a.snapshot_id
                      JOIN {SCHEMA}.accounting_source_connections c ON c.source_key=a.source_key
                      WHERE s.row_count>0 AND {' AND '.join(where)}
                    ) candidates WHERE selected_rank=1""",
                tuple([request.periodFrom, request.periodTo] + params),
            ).fetchall()
        balance_snapshot_ids = [
            row["snapshot_id"]
            for row in selected
            if not _is_journal_dataset(row["dataset_type"])
        ]
        journal_snapshot_ids = [
            row["snapshot_id"]
            for row in selected
            if _is_journal_dataset(row["dataset_type"])
        ]
        rows: List[Dict[str, Any]] = []
        if balance_snapshot_ids:
            balance_where = ["r.snapshot_id=ANY(%s)"]
            balance_params: List[Any] = [balance_snapshot_ids]
            if request.accountNumbers:
                balance_where.append("r.account_number=ANY(%s)")
                balance_params.append([str(item).strip() for item in request.accountNumbers])
            balance_params.append(limit + 1)
            rows.extend(
                dict(row)
                for row in conn.execute(
                    f"""SELECT s.source_key,c.base_source_key,s.dataset_type,
                        s.company_key,s.data_space_key,s.data_space_name,
                        %s::date AS period_from,%s::date AS period_to,s.created_at AS activated_at,
                        r.account_id,r.account_number,r.account_name,r.grade,r.is_leaf,
                        r.opening_debit,r.opening_credit,r.period_debit,r.period_credit,
                        r.ytd_debit,r.ytd_credit,r.closing_debit,r.closing_credit,
                        r.canonical_data
                      FROM {SCHEMA}.accounting_source_rows r
                      JOIN {SCHEMA}.accounting_snapshots s ON s.snapshot_id=r.snapshot_id
                      JOIN {SCHEMA}.accounting_source_connections c ON c.source_key=s.source_key
                      WHERE {' AND '.join(balance_where)}
                      ORDER BY s.company_key,s.data_space_name,r.account_number LIMIT %s""",
                    tuple([request.periodFrom, request.periodTo] + balance_params),
                ).fetchall()
            )
        if journal_snapshot_ids and len(rows) <= limit:
            use_monthly = _is_complete_month_range(request.periodFrom, request.periodTo)
            include_detail = request.journalDetailRequired or not use_monthly
            journal_account_filter = ""
            account_params: List[Any] = []
            if request.accountNumbers:
                journal_account_filter = " AND (j.debit_account=ANY(%s) OR j.credit_account=ANY(%s))"
                account_numbers = [str(item).strip() for item in request.accountNumbers]
                account_params.extend([account_numbers, account_numbers])
            journal_rows: List[Any] = []
            if use_monthly:
                journal_rows.extend(conn.execute(
                    f"""SELECT j.source_key,c.base_source_key,'GENERAL_LEDGER'::text AS dataset_type,
                        j.company_key,j.data_space_key,j.data_space_name,
                        %s::date AS period_from,%s::date AS period_to,s.created_at AS activated_at,
                        ''::text AS account_id,''::text AS account_number,''::text AS account_name,
                        NULL::integer AS grade,true AS is_leaf,
                        0::numeric AS opening_debit,0::numeric AS opening_credit,
                        0::numeric AS period_debit,0::numeric AS period_credit,
                        0::numeric AS ytd_debit,0::numeric AS ytd_credit,
                        0::numeric AS closing_debit,0::numeric AS closing_credit,
                        jsonb_build_object(
                          'debit_account',j.debit_account,'credit_account',j.credit_account,
                          'amount',j.amount,'amount_original',j.amount_original,
                          'entry_count',j.entry_count,'month_start',j.month_start,
                          'reference_type',j.reference_type,'entry_type',j.entry_type,
                          'is_closing_entry',j.is_closing_entry,'is_reversal',j.is_reversal,
                          'intercompany_partner',j.intercompany_partner,'branch_id',j.branch_id,
                          'organization_unit_code',j.organization_unit_code,
                          'account_object_code',j.account_object_code,
                          'expense_item_code',j.expense_item_code,
                          'transaction_class',j.transaction_class,
                          'cash_flow_code',j.cash_flow_code,'currency_id',j.currency_id,
                          'journal_granularity','MONTHLY'
                        ) AS canonical_data
                      FROM {SCHEMA}.accounting_journal_monthly j
                      JOIN {SCHEMA}.accounting_snapshots s ON s.snapshot_id=j.snapshot_id
                      JOIN {SCHEMA}.accounting_source_connections c ON c.source_key=s.source_key
                      WHERE j.snapshot_id=ANY(%s) AND j.month_start BETWEEN %s AND %s
                      {journal_account_filter}
                      ORDER BY j.company_key,j.data_space_name,j.month_start,j.debit_account,j.credit_account
                      LIMIT %s""",
                    tuple(
                        [
                            request.periodFrom,
                            request.periodTo,
                            journal_snapshot_ids,
                            request.periodFrom,
                            request.periodTo,
                        ]
                        + account_params
                        + [limit + 1 - len(rows)]
                    ),
                ).fetchall())
            if include_detail and len(rows) + len(journal_rows) <= limit:
                journal_rows.extend(conn.execute(
                    f"""SELECT j.source_key,c.base_source_key,'GENERAL_LEDGER'::text AS dataset_type,
                        j.company_key,j.data_space_key,j.data_space_name,
                        %s::date AS period_from,%s::date AS period_to,s.created_at AS activated_at,
                        ''::text AS account_id,''::text AS account_number,''::text AS account_name,
                        NULL::integer AS grade,true AS is_leaf,
                        0::numeric AS opening_debit,0::numeric AS opening_credit,
                        0::numeric AS period_debit,0::numeric AS period_credit,
                        0::numeric AS ytd_debit,0::numeric AS ytd_credit,
                        0::numeric AS closing_debit,0::numeric AS closing_credit,
                        jsonb_build_object(
                          'debit_account',j.debit_account,'credit_account',j.credit_account,
                          'amount',j.amount,'amount_original',j.amount_original,
                          'entry_count',1,'posted_date',j.posted_at,
                          'reference_id',j.reference_id,'reference_no',j.reference_no,
                          'journal_memo',j.journal_memo,'description',j.description,
                          'reference_type',j.reference_type,'entry_type',j.entry_type,
                          'is_closing_entry',j.is_closing_entry,'is_reversal',j.is_reversal,
                          'intercompany_partner',j.intercompany_partner,'branch_id',j.branch_id,
                          'organization_unit_code',j.organization_unit_code,
                          'account_object_code',j.account_object_code,
                          'expense_item_code',j.expense_item_code,
                          'transaction_class',j.transaction_class,'currency_id',j.currency_id,
                          'journal_granularity','DETAIL'
                        ) || j.dimensions AS canonical_data
                      FROM {SCHEMA}.accounting_journal_entries j
                      JOIN {SCHEMA}.accounting_snapshots s ON s.snapshot_id=j.snapshot_id
                      JOIN {SCHEMA}.accounting_source_connections c ON c.source_key=s.source_key
                      WHERE j.snapshot_id=ANY(%s)
                        AND (j.posted_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date BETWEEN %s AND %s
                      {journal_account_filter}
                      ORDER BY j.company_key,j.data_space_name,j.posted_at,j.reference_no
                      LIMIT %s""",
                    tuple(
                        [
                            request.periodFrom,
                            request.periodTo,
                            journal_snapshot_ids,
                            request.periodFrom,
                            request.periodTo,
                        ]
                        + account_params
                        + [limit + 1 - len(rows) - len(journal_rows)]
                    ),
                ).fetchall())
            rows.extend(dict(row) for row in journal_rows)
    selected_rows = rows[:limit]
    return {
        "ok": True,
        "rows": [_safe(row) for row in selected_rows],
        "rowCount": len(selected_rows),
        "truncated": len(rows) > limit,
    }


def _load_config_records(version_id: str) -> List[Dict[str, Any]]:
    normalized_version = str(version_id or "").strip()
    if not normalized_version or len(normalized_version) > 160:
        raise HTTPException(status_code=400, detail="Thiếu phiên bản cấu hình báo cáo")
    pool = _pool()
    with pool.connection() as conn:
        if not _config_schema_ready(conn):
            raise HTTPException(
                status_code=409,
                detail="Cấu trúc accounting_portal chưa sẵn sàng",
            )
        version = conn.execute(
            f"SELECT version_id FROM {CONFIG_SCHEMA}.config_versions WHERE version_id=%s",
            (normalized_version,),
        ).fetchone()
        if not version:
            raise HTTPException(status_code=404, detail="Phiên bản cấu hình báo cáo không tồn tại")
        rows = conn.execute(
            f"""SELECT record_id,version_id,record_type,entity_key,parent_key,company_key,
                display_code,display_name,status_label,valid_from,valid_to,sort_order,payload,
                created_at,created_by,updated_at,updated_by
              FROM {CONFIG_SCHEMA}.config_records
              WHERE version_id=%s AND deleted_at IS NULL
              ORDER BY sort_order,record_id""",
            (normalized_version,),
        ).fetchall()
    return [
        {
            "recordId": row["record_id"],
            "versionId": row["version_id"],
            "recordType": row["record_type"],
            "entityKey": row["entity_key"],
            "parentKey": row["parent_key"],
            "companyKey": row["company_key"],
            "displayCode": row["display_code"],
            "displayName": row["display_name"],
            "status": row["status_label"],
            "validFrom": _safe(row["valid_from"]),
            "validTo": _safe(row["valid_to"]),
            "sortOrder": row["sort_order"],
            "payload": row["payload"] or {},
            "createdAt": _safe(row["created_at"]),
            "createdBy": row["created_by"],
            "updatedAt": _safe(row["updated_at"]),
            "updatedBy": row["updated_by"],
        }
        for row in rows
    ]


def _report_selection(request: ReportOutputRequest) -> Dict[str, Any]:
    if request.periodFrom > request.periodTo:
        raise HTTPException(status_code=400, detail="Từ ngày phải trước hoặc bằng đến ngày")
    snapshot_ids = list(
        dict.fromkeys(str(item or "").strip() for item in request.snapshotIds if str(item or "").strip())
    )
    if len(snapshot_ids) > 100:
        raise HTTPException(status_code=400, detail="Chỉ được chọn tối đa 100 phiên dữ liệu cho một báo cáo")
    if any(not re.fullmatch(r"[0-9a-fA-F-]{36}", item) for item in snapshot_ids):
        raise HTTPException(status_code=400, detail="Mã phiên dữ liệu không hợp lệ")
    snapshot_ids_by_offset: Dict[str, List[str]] = {}
    for raw_offset, raw_snapshot_ids in (request.snapshotIdsByOffset or {}).items():
        try:
            offset = int(str(raw_offset).strip())
        except (TypeError, ValueError) as exc:
            raise HTTPException(status_code=400, detail="Mã kỳ so sánh không hợp lệ") from exc
        if offset < -10 or offset > 10:
            raise HTTPException(status_code=400, detail="Kỳ so sánh nằm ngoài giới hạn cho phép")
        normalized_ids = list(
            dict.fromkeys(str(item or "").strip() for item in (raw_snapshot_ids or []) if str(item or "").strip())
        )
        if len(normalized_ids) > 100:
            raise HTTPException(status_code=400, detail="Chỉ được chọn tối đa 100 phiên dữ liệu cho một kỳ")
        if any(not re.fullmatch(r"[0-9a-fA-F-]{36}", item) for item in normalized_ids):
            raise HTTPException(status_code=400, detail="Mã phiên dữ liệu không hợp lệ")
        snapshot_ids_by_offset[str(offset)] = normalized_ids
    # snapshotIds giữ tương thích với client cũ. Bản mới luôn coi offset 0
    # là lựa chọn cho kỳ đang xuất.
    if "0" not in snapshot_ids_by_offset:
        snapshot_ids_by_offset["0"] = snapshot_ids
    elif snapshot_ids and snapshot_ids_by_offset["0"] != snapshot_ids:
        raise HTTPException(status_code=400, detail="Phiên dữ liệu kỳ hiện tại không khớp")
    if not snapshot_ids_by_offset["0"] and not request.sourceKeys and not request.dataSpaceKeys:
        raise HTTPException(
            status_code=400,
            detail="Phải chọn ít nhất một nguồn hoặc một khối dữ liệu; hệ thống không tự trộn các khối MISA",
        )
    return {
        "snapshotIds": snapshot_ids,
        "snapshotIdsByOffset": snapshot_ids_by_offset,
        "sourceKeys": [_clean_key(item) for item in request.sourceKeys],
        "companyKeys": [_clean_key(item) for item in request.companyKeys],
        "dataSpaceKeys": [_clean_key(item, "mã khối dữ liệu") for item in request.dataSpaceKeys],
    }


def _load_note_catalog_items(source_keys: List[str]) -> List[Dict[str, Any]]:
    if not source_keys:
        return []
    pool = _pool()
    with pool.connection() as conn:
        rows = conn.execute(
            f"""SELECT DISTINCT ON (item_id)
                  item_id,item_code,item_name,part,part_in_tab,item_index,
                  formula_type,is_bold,is_italic,hidden,formula,source_key,synced_at
                FROM {SCHEMA}.accounting_note_catalog_items
                WHERE source_key=ANY(%s) AND sub_accounting_system=99
                ORDER BY item_id,synced_at DESC""",
            (source_keys,),
        ).fetchall()
    return [
        {
            "itemId": row["item_id"],
            "itemCode": row["item_code"],
            "itemName": row["item_name"],
            "part": row["part"],
            "partInTab": row["part_in_tab"],
            "itemIndex": _safe(row["item_index"]),
            "formulaType": row["formula_type"],
            "isBold": row["is_bold"],
            "isItalic": row["is_italic"],
            "hidden": row["hidden"],
            "formula": row["formula"] or [],
            "sourceKey": row["source_key"],
        }
        for row in rows
    ]


def _report_adjustment_source_row(row: Dict[str, Any]) -> Dict[str, Any]:
    canonical_data = {
        "adjustment_id": str(row["adjustment_id"]),
        "external_key": row["external_key"],
        "report_key": row["report_key"],
        "row_code": row["row_code"],
        "column_key": row["column_key"],
        "amount": row["amount"],
        "reason": row["reason"],
        "source_reference": row["source_reference"],
        "supporting_data": row.get("supporting_data") or {},
        "approval_status": row["status"],
        "approved_by": row["approved_by"],
        "approved_at": row["approved_at"],
    }
    return {
        "source_key": "BCTC_DIEU_CHINH",
        "base_source_key": "BCTC_DIEU_CHINH",
        "dataset_type": "MANUAL_ADJUSTMENT",
        "company_key": row["company_key"],
        "data_space_key": row["data_space_key"],
        "data_space_name": row["data_space_name"],
        "period_from": row["period_from"],
        "period_to": row["period_to"],
        "account_id": "",
        "account_number": "",
        "account_name": "Điều chỉnh báo cáo đã duyệt",
        "grade": None,
        "is_leaf": True,
        "opening_debit": 0,
        "opening_credit": 0,
        "period_debit": 0,
        "period_credit": 0,
        "ytd_debit": 0,
        "ytd_credit": 0,
        "closing_debit": 0,
        "closing_credit": 0,
        "canonical_data": canonical_data,
    }


def _load_selected_report_adjustments(
    *,
    version_id: str,
    report_keys: List[str],
    period_from: date,
    period_to: date,
    source_rows: List[Dict[str, Any]],
    adjustment_ids: List[str],
) -> List[Dict[str, Any]]:
    normalized_ids = list(
        dict.fromkeys(str(item or "").strip() for item in adjustment_ids if str(item or "").strip())
    )
    if not normalized_ids:
        return []
    if len(normalized_ids) > 200:
        raise HTTPException(status_code=400, detail="Chỉ được chọn tối đa 200 bút toán điều chỉnh")
    try:
        adjustment_uuids = [uuid.UUID(item) for item in normalized_ids]
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Mã bút toán điều chỉnh không hợp lệ") from exc
    scope_pairs = {
        (
            _clean_key(row.get("company_key") or row.get("companyKey"), "mã công ty"),
            _clean_key(row.get("data_space_key") or row.get("dataSpaceKey"), "mã khối dữ liệu"),
        )
        for row in source_rows
        if (row.get("company_key") or row.get("companyKey"))
        and (row.get("data_space_key") or row.get("dataSpaceKey"))
        and str(row.get("dataset_type") or row.get("datasetType") or "").upper() != "MANUAL_ADJUSTMENT"
    }
    normalized_reports = list(
        dict.fromkeys(_clean_key(item, "mã báo cáo") for item in report_keys if str(item or "").strip())
    )
    if not scope_pairs or not normalized_reports:
        return []
    company_keys = sorted({company_key for company_key, _ in scope_pairs})
    data_space_keys = sorted({data_space_key for _, data_space_key in scope_pairs})
    pool = _pool()
    with pool.connection() as conn:
        if not _schema_ready(conn):
            raise HTTPException(status_code=409, detail="Hãy khởi tạo cấu trúc PostgreSQL trước")
        rows = conn.execute(
            f"""SELECT adjustment_id,external_key,version_id,report_key,row_code,column_key,
                       company_key,data_space_key,data_space_name,period_from,period_to,amount,
                       reason,source_reference,supporting_data,status,approved_by,approved_at
                 FROM {SCHEMA}.accounting_report_adjustments
                 WHERE adjustment_id=ANY(%s) AND version_id=%s AND report_key=ANY(%s)
                   AND period_from=%s AND period_to=%s
                   AND company_key=ANY(%s) AND data_space_key=ANY(%s)
                   AND status='APPROVED' AND approved_at IS NOT NULL
                 ORDER BY report_key,row_code,column_key,created_at,adjustment_id""",
            (
                adjustment_uuids,
                version_id,
                normalized_reports,
                period_from,
                period_to,
                company_keys,
                data_space_keys,
            ),
        ).fetchall()
    selected_rows = [
        _report_adjustment_source_row(dict(row))
        for row in rows
        if (row["company_key"], row["data_space_key"]) in scope_pairs
    ]
    found_ids = {
        str((row.get("canonical_data") or {}).get("adjustment_id"))
        for row in selected_rows
    }
    missing = [item for item in normalized_ids if item not in found_ids]
    if missing:
        raise HTTPException(
            status_code=409,
            detail=(
                "Có bút toán điều chỉnh không còn hợp lệ cho đúng báo cáo, kỳ hoặc khối dữ liệu đã chọn. "
                "Hãy mở lại danh sách điều chỉnh rồi xuất lại."
            ),
        )
    return selected_rows


def _load_imported_report_results(
    *,
    version_id: str,
    report_key: str,
    period_from: date,
    period_to: date,
    company_keys: List[str],
    data_space_keys: List[str],
) -> List[Dict[str, Any]]:
    """Đọc các kết quả BCTC import đúng phạm vi; không tự lấy chéo công ty/khối."""
    companies = list(dict.fromkeys(str(item or "").strip() for item in company_keys if str(item or "").strip()))
    spaces = list(dict.fromkeys(str(item or "").strip() for item in data_space_keys if str(item or "").strip()))
    if not companies or not spaces:
        return []
    pool = _pool()
    with pool.connection() as conn:
        if not _schema_ready(conn):
            return []
        rows = conn.execute(
            f"""SELECT report_result_id,report_key,report_name,company_key,data_space_key,
                       data_space_name,period_from,period_to,source_file_name,source_sheet_name,
                       row_count,output_data,created_at
                  FROM {SCHEMA}.accounting_report_result_snapshots
                 WHERE version_id=%s AND report_key=%s AND period_from=%s AND period_to=%s
                   AND company_key=ANY(%s) AND data_space_key=ANY(%s) AND status='ACTIVE'
                 ORDER BY company_key,data_space_key,created_at DESC""",
            (
                version_id,
                _clean_key(report_key, "mã báo cáo"),
                period_from,
                period_to,
                companies,
                spaces,
            ),
        ).fetchall()
    # Mỗi cặp công ty/khối chỉ lấy bản ACTIVE mới nhất. Điều kiện này cũng
    # phòng dữ liệu cũ bị trùng trước khi có ràng buộc nghiệp vụ.
    unique: Dict[tuple[str, str], Dict[str, Any]] = {}
    for row in rows:
        item = dict(row)
        pair = (str(item.get("company_key") or ""), str(item.get("data_space_key") or ""))
        if pair not in unique:
            unique[pair] = item
    return list(unique.values())


def _apply_imported_report_results(
    output: Dict[str, Any],
    imported_results_by_offset: Dict[int, List[Dict[str, Any]]],
) -> Dict[str, Any]:
    """Phủ số từ file BCTC lên đúng cột kỳ, giữ công thức cho ô file không có."""
    if not imported_results_by_offset:
        return output
    target_columns = output.get("columns") or []
    target_rows = {
        str(row.get("rowCode") or ""): row
        for row in output.get("rows") or []
        if str(row.get("rowCode") or "")
    }
    used_results: List[Dict[str, Any]] = []
    for target_offset, result_rows in imported_results_by_offset.items():
        target_indexes = [
            index for index, column in enumerate(target_columns)
            if int(column.get("periodOffset") or 0) == target_offset
            and str(column.get("columnType") or "").upper()
            not in {"LABEL", "ROW_CODE", "NOTE_REFERENCE"}
        ]
        if not target_indexes:
            continue
        aggregated: Dict[tuple[str, int], Decimal] = {}
        evidence_by_cell: Dict[tuple[str, int], List[Dict[str, Any]]] = {}
        result_ids: List[str] = []
        for stored in result_rows:
            imported = stored.get("output_data") if isinstance(stored.get("output_data"), dict) else {}
            source_columns = imported.get("columns") or []
            source_indexes = [
                index for index, column in enumerate(source_columns)
                if int(column.get("periodOffset") or 0) == 0
                and str(column.get("columnType") or "").upper()
                not in {"LABEL", "ROW_CODE", "NOTE_REFERENCE"}
            ]
            if not source_indexes:
                continue
            result_id = str(stored.get("report_result_id") or "")
            result_ids.append(result_id)
            source_file = str(stored.get("source_file_name") or "File BCTC")
            source_sheet = str(stored.get("source_sheet_name") or "")
            for imported_row in imported.get("rows") or []:
                row_code = str(imported_row.get("rowCode") or "")
                if not row_code or row_code not in target_rows:
                    continue
                cells = imported_row.get("cells") or []
                for position, target_index in enumerate(target_indexes):
                    source_index = source_indexes[min(position, len(source_indexes) - 1)]
                    if source_index >= len(cells):
                        continue
                    raw_value = cells[source_index].get("value")
                    if raw_value is None:
                        continue
                    key = (row_code, target_index)
                    amount = _decimal(raw_value)
                    aggregated[key] = aggregated.get(key, Decimal("0")) + amount
                    evidence_by_cell.setdefault(key, []).append({
                        "label": f"BCTC import · {source_file}" + (f" · {source_sheet}" if source_sheet else ""),
                        "sourceName": "Kết quả báo cáo đã import",
                        "signedValue": float(amount),
                        "formulaSign": 1,
                        "tracePath": f"BCTC import → {row_code} → kỳ {target_offset:+d}",
                        "reportResultId": result_id,
                    })
        for (row_code, target_index), amount in aggregated.items():
            cells = target_rows[row_code].get("cells") or []
            if target_index >= len(cells):
                continue
            value = float(amount)
            cells[target_index] = {
                **cells[target_index],
                "kind": "VALUE",
                "text": "",
                "value": value,
                "formulaStatus": "IMPORTED_REPORT_RESULT",
                "evidence": {
                    "value": value,
                    "components": evidence_by_cell.get((row_code, target_index), []),
                    "isComplete": True,
                    "difference": 0,
                    "warning": "",
                },
            }
        if aggregated:
            for stored in result_rows:
                result_id = str(stored.get("report_result_id") or "")
                if result_id and result_id in result_ids:
                    used_results.append({
                        "reportResultId": result_id,
                        "reportKey": stored.get("report_key"),
                        "reportName": stored.get("report_name"),
                        "companyKey": stored.get("company_key"),
                        "dataSpaceKey": stored.get("data_space_key"),
                        "dataSpaceName": stored.get("data_space_name"),
                        "periodFrom": stored.get("period_from"),
                        "periodTo": stored.get("period_to"),
                        "sourceFileName": stored.get("source_file_name"),
                        "sourceSheetName": stored.get("source_sheet_name"),
                        "targetPeriodOffset": target_offset,
                    })
    if used_results:
        output["importedReportResults"] = [_safe(item) for item in used_results]
    return output


def _report_cache_key(request: ReportOutputRequest, selection: Dict[str, Any]) -> str:
    # Chỉ cache khi kỳ hiện tại đã khóa bằng snapshot bất biến. Nếu client chỉ
    # gửi sourceKey thì snapshot active có thể đổi và không được tái dùng kết quả cũ.
    if not (selection.get("snapshotIdsByOffset") or {}).get("0"):
        return ""
    material = {
        "schema": "report-output.v3.20",
        "versionId": request.versionId,
        "reportKey": request.reportKey,
        "snapshotIdsByOffset": selection.get("snapshotIdsByOffset") or {},
        "sourceKeys": selection.get("sourceKeys") or [],
        "companyKeys": selection.get("companyKeys") or [],
        "dataSpaceKeys": selection.get("dataSpaceKeys") or [],
        "noteItemIds": sorted(request.noteItemIds or []),
        "disclosureItemKeys": sorted(request.disclosureItemKeys or []),
        "adjustmentIds": sorted(request.adjustmentIds or []),
        "includeImportedReportResults": request.includeImportedReportResults,
        "includeEvidence": request.includeEvidence,
        "periodFrom": request.periodFrom.isoformat(),
        "periodTo": request.periodTo.isoformat(),
    }
    canonical = json.dumps(material, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return "REPORT_" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _read_report_cache(cache_key: str) -> Dict[str, Any] | None:
    if not cache_key:
        return None
    pool = _pool()
    with pool.connection() as conn:
        if not _schema_ready(conn):
            return None
        row = conn.execute(
            f"""SELECT result_data FROM {SCHEMA}.accounting_report_cache
                 WHERE cache_key=%s AND (expires_at IS NULL OR expires_at>now())""",
            (cache_key,),
        ).fetchone()
    if not row or not isinstance(row["result_data"], dict):
        return None
    result = dict(row["result_data"])
    result["cacheKey"] = cache_key
    result["cacheHit"] = True
    return result


def _write_report_cache(
    cache_key: str,
    report_key: str,
    version_id: str,
    snapshot_refs: Dict[str, Any],
    output: Dict[str, Any],
) -> None:
    if not cache_key:
        return
    stored = dict(output)
    stored.pop("cacheHit", None)
    pool = _pool()
    with pool.connection() as conn:
        with conn.transaction():
            conn.execute(
                f"""INSERT INTO {SCHEMA}.accounting_report_cache(
                       cache_key,report_key,config_version,snapshot_refs,result_data,created_at,expires_at
                     ) VALUES (%s,%s,%s,%s::jsonb,%s::jsonb,now(),now()+interval '2 hours')
                     ON CONFLICT(cache_key) DO UPDATE SET
                       report_key=excluded.report_key,config_version=excluded.config_version,
                       snapshot_refs=excluded.snapshot_refs,result_data=excluded.result_data,
                       created_at=now(),expires_at=excluded.expires_at""",
                (
                    cache_key,
                    report_key,
                    version_id,
                    json.dumps(snapshot_refs, ensure_ascii=False, default=str),
                    json.dumps(_safe(stored), ensure_ascii=False, default=str),
                ),
            )


def _build_report_output(request: ReportOutputRequest) -> Dict[str, Any]:
    selection = _report_selection(request)
    cache_key = _report_cache_key(request, selection)
    cached = _read_report_cache(cache_key)
    if cached is not None:
        return cached
    records = _load_config_records(request.versionId)
    report_key = _clean_key(request.reportKey or "DATA_CHECK", "mã báo cáo")
    dependency_reports = _report_dependency_keys(records, report_key)
    journal_detail_required = _report_records_require_journal_detail(records, report_key)
    auto_source_keys = [
        _clean_key(record.get("entityKey"))
        for record in records
        if record.get("recordType") == "DATA_SOURCE"
        and (record.get("payload") or {}).get("autoIncludeInReports") is True
        and record.get("entityKey")
    ]
    selection["autoSourceKeys"] = [
        source_key
        for source_key in auto_source_keys
        if source_key not in selection["sourceKeys"]
    ]
    selection["sourceKeys"] = list(
        dict.fromkeys(selection["sourceKeys"] + selection["autoSourceKeys"])
    )
    note_items = _load_note_catalog_items(selection["sourceKeys"])
    configured_reports = [
        key
        for key in sorted(dependency_reports)
        if key != DISCLOSURE_REPORT_KEY
    ]
    offset_reports = configured_reports + (
        [DISCLOSURE_REPORT_KEY]
        if report_key == DISCLOSURE_REPORT_KEY
        else []
    )
    offsets = sorted(
        set(
            offset
            for configured_report in offset_reports or [report_key]
            for offset in required_offsets(records, configured_report)
        )
        | set(
            note_required_offsets(
                records,
                report_key,
                note_items,
                request.noteItemIds,
            )
        )
    )
    rows_by_offset: Dict[int, List[Dict[str, Any]]] = {}
    selected_adjustments: List[Dict[str, Any]] = []
    requested_snapshot_ids_by_offset = selection["snapshotIdsByOffset"]
    selection["missingSnapshotOffsets"] = []
    for offset in offsets:
        # Một bộ checkbox hiện chỉ đại diện cho đúng kỳ người dùng đang xuất.
        # Cột so sánh kỳ trước vẫn lấy snapshot active của kỳ trước cho đến khi
        # UI có luồng chọn phiên riêng theo từng kỳ so sánh.
        offset_key = str(offset)
        # Kỳ nào client đã gửi thì đó là một lựa chọn đóng, kể cả danh sách
        # rỗng. Nhờ vậy thiếu tháng 01/2025 sẽ hiện cảnh báo, không tự thay
        # bằng bản active hoặc cả năm 2025.
        # Mọi kỳ ngoài kỳ đang xuất đều phải được chỉ định rõ. Client cũ không
        # gửi lựa chọn cùng kỳ sẽ nhận cảnh báo thay vì vô tình lấy bản active.
        has_locked_selection = offset_key in requested_snapshot_ids_by_offset or offset != 0
        snapshot_ids_for_offset = requested_snapshot_ids_by_offset.get(
            offset_key,
            selection["snapshotIds"] if offset == 0 else [],
        )
        selection["snapshotIdsByOffset"][offset_key] = snapshot_ids_for_offset
        if offset != 0 and not snapshot_ids_for_offset:
            selection["missingSnapshotOffsets"].append(offset)
        response = query_balances(
            BalanceQueryRequest(
                snapshotIds=snapshot_ids_for_offset,
                lockSnapshotSelection=has_locked_selection or offset == 0,
                sourceKeys=selection["sourceKeys"],
                companyKeys=selection["companyKeys"],
                dataSpaceKeys=selection["dataSpaceKeys"],
                periodFrom=shift_year(request.periodFrom, offset),
                periodTo=shift_year(request.periodTo, offset),
                journalDetailRequired=journal_detail_required,
                limit=MAX_REPORT_ROWS,
            ),
            None,
        )
        source_rows = response["rows"]
        if offset == 0 and request.adjustmentIds:
            selected_adjustments = _load_selected_report_adjustments(
                version_id=request.versionId,
                report_keys=list(dict.fromkeys(configured_reports + [report_key])),
                period_from=request.periodFrom,
                period_to=request.periodTo,
                source_rows=source_rows,
                adjustment_ids=request.adjustmentIds,
            )
        rows_by_offset[offset] = source_rows
        if int(response["rowCount"]) >= MAX_REPORT_ROWS:
            raise HTTPException(
                status_code=413,
                detail=(
                    f"Kỳ báo cáo có từ {MAX_REPORT_ROWS} dòng trở lên. "
                    "Hãy thu hẹp nguồn/khối dữ liệu hoặc tăng ACCOUNTING_MAX_REPORT_ROWS có kiểm soát."
                ),
            )
    output_cache: Dict[str, Dict[str, Any]] = {}
    resolving: set[str] = set()
    imported_result_cache: Dict[tuple[str, int], List[Dict[str, Any]]] = {}
    imported_usage: set[tuple[str, int]] = set()
    imported_company_keys = list(selection.get("companyKeys") or [])
    imported_data_space_keys = list(selection.get("dataSpaceKeys") or [])
    if not imported_company_keys:
        imported_company_keys = sorted({
            str(row.get("company_key") or row.get("companyKey") or "")
            for rows in rows_by_offset.values() for row in rows
            if row.get("company_key") or row.get("companyKey")
        })
    if not imported_data_space_keys:
        imported_data_space_keys = sorted({
            str(row.get("data_space_key") or row.get("dataSpaceKey") or "")
            for rows in rows_by_offset.values() for row in rows
            if row.get("data_space_key") or row.get("dataSpaceKey")
        })

    def resolve_report(current_report_key: str) -> Dict[str, Any]:
        normalized_key = _clean_key(current_report_key, "mã báo cáo")
        if normalized_key in output_cache:
            return output_cache[normalized_key]
        if normalized_key in resolving:
            raise ReportEngineError(f"Phát hiện vòng lặp giữa các báo cáo tại {normalized_key}.")
        resolving.add(normalized_key)

        def resolve_cross_report(
            target_report_key: str,
            target_row_code: str,
            source_column: Dict[str, Any],
            rule: Dict[str, Any],
        ) -> float | None:
            target = resolve_report(target_report_key)
            target_row = next(
                (
                    row
                    for row in target.get("rows") or []
                    if str(row.get("rowCode") or "") == str(target_row_code)
                ),
                None,
            )
            if not target_row:
                return None
            target_columns = target.get("columns") or []
            requested_column = _clean_key(rule.get("targetColumnKey"), "mã cột") if rule.get("targetColumnKey") else ""
            source_key = _clean_key(source_column.get("columnKey"), "mã cột") if source_column.get("columnKey") else ""
            source_type = _clean_key(source_column.get("columnType"), "loại cột") if source_column.get("columnType") else ""
            target_index = next(
                (
                    index
                    for index, column in enumerate(target_columns)
                    if requested_column
                    and _clean_key(column.get("columnKey"), "mã cột") == requested_column
                ),
                None,
            )
            if target_index is None:
                target_index = next(
                    (
                        index
                        for index, column in enumerate(target_columns)
                        if source_key
                        and _clean_key(column.get("columnKey"), "mã cột") == source_key
                    ),
                    None,
                )
            if target_index is None:
                target_index = next(
                    (
                        index
                        for index, column in enumerate(target_columns)
                        if source_type
                        and _clean_key(column.get("columnType"), "loại cột") == source_type
                    ),
                    None,
                )
            if target_index is None:
                target_index = next(
                    (
                        index
                        for index, column in enumerate(target_columns)
                        if _clean_key(column.get("columnType"), "loại cột")
                        not in ("LABEL", "ROW_CODE", "NOTE_REFERENCE")
                    ),
                    None,
                )
            cells = target_row.get("cells") or []
            if target_index is None or target_index >= len(cells):
                return None
            return cells[target_index].get("value")

        try:
            imported_by_offset: Dict[int, List[Dict[str, Any]]] = {}
            if request.includeImportedReportResults and normalized_key in REPORT_IMPORT_KEYS:
                for offset in required_offsets(records, normalized_key):
                    imported_key = (normalized_key, offset)
                    if imported_key not in imported_result_cache:
                        imported_result_cache[imported_key] = _load_imported_report_results(
                            version_id=request.versionId,
                            report_key=normalized_key,
                            period_from=shift_year(request.periodFrom, offset),
                            period_to=shift_year(request.periodTo, offset),
                            company_keys=imported_company_keys,
                            data_space_keys=imported_data_space_keys,
                        )
                    if imported_result_cache[imported_key]:
                        imported_by_offset[offset] = imported_result_cache[imported_key]
            result = build_output(
                records=records,
                report_key=normalized_key,
                period_from=request.periodFrom,
                period_to=request.periodTo,
                rows_by_offset=rows_by_offset,
                selection=selection,
                note_items=note_items if normalized_key == report_key else [],
                selected_note_item_ids=request.noteItemIds if normalized_key == report_key else [],
                cross_report_resolver=resolve_cross_report,
                include_evidence=request.includeEvidence,
                cell_adjustments=[
                    {
                        **(row.get("canonical_data") or {}),
                        "rowCode": (row.get("canonical_data") or {}).get("row_code"),
                        "columnKey": (row.get("canonical_data") or {}).get("column_key"),
                        "sourceReference": (row.get("canonical_data") or {}).get("source_reference"),
                    }
                    for row in selected_adjustments
                    if _clean_key((row.get("canonical_data") or {}).get("report_key"), "mã báo cáo")
                    == normalized_key
                ],
            )
            result = _apply_imported_report_results(result, imported_by_offset)
            for item in result.get("importedReportResults") or []:
                imported_usage.add((normalized_key, int(item.get("targetPeriodOffset") or 0)))
            output_cache[normalized_key] = result
            return result
        finally:
            resolving.discard(normalized_key)

    try:
        output = (
            build_disclosure_output(
                records=records,
                period_from=request.periodFrom,
                period_to=request.periodTo,
                selection=selection,
                resolve_report=resolve_report,
                selected_item_keys=request.disclosureItemKeys,
            )
            if report_key == DISCLOSURE_REPORT_KEY
            else resolve_report(report_key)
        )
    except ReportEngineError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    output["versionId"] = request.versionId
    output["generatedAt"] = _now().isoformat()
    unresolved_snapshot_offsets = []
    for missing_offset in selection["missingSnapshotOffsets"]:
        reports_needing_offset = [
            key for key in (configured_reports or [report_key])
            if missing_offset in required_offsets(records, key)
        ]
        if not reports_needing_offset or not all(
            (key, missing_offset) in imported_usage for key in reports_needing_offset
        ):
            unresolved_snapshot_offsets.append(missing_offset)
    if unresolved_snapshot_offsets:
        missing_labels = []
        for offset in unresolved_snapshot_offsets:
            if offset == -1:
                missing_labels.append("cùng kỳ năm trước")
            else:
                missing_labels.append(f"kỳ so sánh {offset:+d} năm")
        output["warnings"] = list(output.get("warnings") or []) + [
            "Chưa có phiên dữ liệu " + ", ".join(missing_labels)
            + ". Hệ thống không dùng số 0, không dùng báo cáo cả năm thay thế; hãy đồng bộ đúng kỳ rồi xuất lại."
        ]
        output["controlStatus"] = "NEEDS_REVIEW"
    if imported_usage:
        output["importedReportUsage"] = [
            {"reportKey": key, "periodOffset": offset}
            for key, offset in sorted(imported_usage)
        ]
    output["snapshotIdsByOffset"] = selection["snapshotIdsByOffset"]
    output["cacheKey"] = cache_key
    output["cacheHit"] = False
    _write_report_cache(
        cache_key,
        report_key,
        request.versionId,
        selection["snapshotIdsByOffset"],
        output,
    )
    return output


@app.post("/report/adjustments")
def create_report_adjustment(
    request: ReportAdjustmentCreateRequest,
    _: None = Depends(_auth),
) -> Dict[str, Any]:
    if request.periodFrom > request.periodTo:
        raise HTTPException(status_code=400, detail="Từ ngày phải trước hoặc bằng đến ngày")
    status = _clean_key(request.status or "DRAFT", "trạng thái điều chỉnh")
    if status not in {"DRAFT", "REVIEW", "APPROVED"}:
        raise HTTPException(status_code=400, detail="Trạng thái mới chỉ được là DRAFT, REVIEW hoặc APPROVED")
    actor = _clean_name(request.requestedBy, "người tạo điều chỉnh", 200)
    reason = _clean_name(request.reason, "lý do điều chỉnh", 2000)
    source_reference = _clean_name(request.sourceReference, "nguồn chứng minh", 2000)
    row_code = str(request.rowCode or "").strip()[:80]
    if not row_code or not re.fullmatch(r"[A-Za-z0-9_.-]+", row_code):
        raise HTTPException(status_code=400, detail="Mã dòng báo cáo không hợp lệ")
    supersedes_id: uuid.UUID | None = None
    if request.supersedesAdjustmentId:
        try:
            supersedes_id = uuid.UUID(request.supersedesAdjustmentId)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Mã điều chỉnh bị thay thế không hợp lệ") from exc
    adjustment_id = uuid.uuid4()
    approved_at = _now() if status == "APPROVED" else None
    approved_by = actor if approved_at else ""
    pool = _pool()
    with pool.connection() as conn:
        if not _schema_ready(conn):
            raise HTTPException(status_code=409, detail="Hãy khởi tạo cấu trúc PostgreSQL trước")
        try:
            with conn.transaction():
                if supersedes_id:
                    superseded = conn.execute(
                        f"SELECT status FROM {SCHEMA}.accounting_report_adjustments WHERE adjustment_id=%s FOR UPDATE",
                        (supersedes_id,),
                    ).fetchone()
                    if not superseded:
                        raise HTTPException(status_code=404, detail="Không tìm thấy điều chỉnh bị thay thế")
                row = conn.execute(
                    f"""INSERT INTO {SCHEMA}.accounting_report_adjustments(
                           adjustment_id,external_key,version_id,report_key,row_code,column_key,
                           company_key,data_space_key,data_space_name,period_from,period_to,amount,
                           reason,source_reference,supporting_data,status,supersedes_adjustment_id,
                           created_by,approved_by,approved_at
                         ) VALUES (
                           %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,
                           %s,%s,%s::jsonb,%s,%s,%s,%s,%s
                         ) RETURNING *""",
                    (
                        adjustment_id,
                        _clean_key(request.externalKey, "khóa điều chỉnh"),
                        _clean_key(request.versionId, "phiên bản cấu hình"),
                        _clean_key(request.reportKey, "mã báo cáo"),
                        row_code,
                        _clean_key(request.columnKey, "mã cột") if request.columnKey else "",
                        _clean_key(request.companyKey, "mã công ty"),
                        _clean_key(request.dataSpaceKey, "mã khối dữ liệu"),
                        str(request.dataSpaceName or "").strip()[:200],
                        request.periodFrom,
                        request.periodTo,
                        request.amount,
                        reason,
                        source_reference,
                        json.dumps(request.supportingData or {}, ensure_ascii=False),
                        status,
                        supersedes_id,
                        actor,
                        approved_by,
                        approved_at,
                    ),
                ).fetchone()
                conn.execute(
                    f"""INSERT INTO {SCHEMA}.accounting_report_adjustment_events(
                           adjustment_id,action,before_status,after_status,note,actor
                         ) VALUES (%s,'CREATE','',%s,%s,%s)""",
                    (adjustment_id, status, reason, actor),
                )
                if supersedes_id and status == "APPROVED":
                    conn.execute(
                        f"""UPDATE {SCHEMA}.accounting_report_adjustments
                               SET status='VOIDED',voided_by=%s,voided_at=now(),updated_at=now()
                             WHERE adjustment_id=%s AND status<>'VOIDED'""",
                        (actor, supersedes_id),
                    )
                    conn.execute(
                        f"""INSERT INTO {SCHEMA}.accounting_report_adjustment_events(
                               adjustment_id,action,before_status,after_status,note,actor
                             ) VALUES (%s,'SUPERSEDED',%s,'VOIDED',%s,%s)""",
                        (
                            supersedes_id,
                            superseded["status"],
                            f"Được thay thế bởi {adjustment_id}",
                            actor,
                        ),
                    )
                conn.execute(f"DELETE FROM {SCHEMA}.accounting_report_cache")
        except psycopg.errors.UniqueViolation as exc:
            raise HTTPException(status_code=409, detail="Khóa điều chỉnh đã tồn tại; hãy tạo bản thay thế để giữ lịch sử") from exc
    return {"ok": True, "adjustment": _safe(dict(row))}


@app.post("/report/adjustments/status")
def update_report_adjustment_status(
    request: ReportAdjustmentStatusRequest,
    _: None = Depends(_auth),
) -> Dict[str, Any]:
    try:
        adjustment_id = uuid.UUID(request.adjustmentId)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Mã điều chỉnh không hợp lệ") from exc
    after_status = _clean_key(request.status, "trạng thái điều chỉnh")
    if after_status not in {"REVIEW", "APPROVED", "VOIDED"}:
        raise HTTPException(status_code=400, detail="Trạng thái chỉ được là REVIEW, APPROVED hoặc VOIDED")
    actor = _clean_name(request.actor, "người thực hiện", 200)
    note = str(request.note or "").strip()[:2000]
    allowed = {
        "DRAFT": {"REVIEW", "APPROVED", "VOIDED"},
        "REVIEW": {"APPROVED", "VOIDED"},
        "APPROVED": {"VOIDED"},
        "VOIDED": set(),
    }
    pool = _pool()
    with pool.connection() as conn:
        if not _schema_ready(conn):
            raise HTTPException(status_code=409, detail="Hãy khởi tạo cấu trúc PostgreSQL trước")
        with conn.transaction():
            before = conn.execute(
                f"SELECT * FROM {SCHEMA}.accounting_report_adjustments WHERE adjustment_id=%s FOR UPDATE",
                (adjustment_id,),
            ).fetchone()
            if not before:
                raise HTTPException(status_code=404, detail="Không tìm thấy điều chỉnh")
            before_status = before["status"]
            if after_status not in allowed.get(before_status, set()):
                raise HTTPException(
                    status_code=409,
                    detail=f"Không thể chuyển điều chỉnh từ {before_status} sang {after_status}",
                )
            row = conn.execute(
                f"""UPDATE {SCHEMA}.accounting_report_adjustments
                       SET status=%s,
                           approved_by=CASE WHEN %s='APPROVED' THEN %s ELSE approved_by END,
                           approved_at=CASE WHEN %s='APPROVED' THEN now() ELSE approved_at END,
                           voided_by=CASE WHEN %s='VOIDED' THEN %s ELSE voided_by END,
                           voided_at=CASE WHEN %s='VOIDED' THEN now() ELSE voided_at END,
                           updated_at=now()
                     WHERE adjustment_id=%s RETURNING *""",
                (
                    after_status,
                    after_status,
                    actor,
                    after_status,
                    after_status,
                    actor,
                    after_status,
                    adjustment_id,
                ),
            ).fetchone()
            conn.execute(
                f"""INSERT INTO {SCHEMA}.accounting_report_adjustment_events(
                       adjustment_id,action,before_status,after_status,note,actor
                     ) VALUES (%s,'STATUS_CHANGE',%s,%s,%s,%s)""",
                (adjustment_id, before_status, after_status, note, actor),
            )
            conn.execute(f"DELETE FROM {SCHEMA}.accounting_report_cache")
    return {"ok": True, "adjustment": _safe(dict(row))}


def _query_report_adjustments(
    *,
    version_id: str,
    company_key: str = "",
    data_space_key: str = "",
    report_key: str = "",
    period_from: date | None = None,
    period_to: date | None = None,
    include_voided: bool = False,
) -> Dict[str, Any]:
    where = ["version_id=%s"]
    params: List[Any] = [_clean_key(version_id, "phiên bản cấu hình")]
    if company_key:
        where.append("company_key=%s")
        params.append(_clean_key(company_key, "mã công ty"))
    if data_space_key:
        where.append("data_space_key=%s")
        params.append(_clean_key(data_space_key, "mã khối dữ liệu"))
    if report_key:
        where.append("report_key=%s")
        params.append(_clean_key(report_key, "mã báo cáo"))
    if period_from:
        where.append("period_from=%s")
        params.append(period_from)
    if period_to:
        where.append("period_to=%s")
        params.append(period_to)
    if not include_voided:
        where.append("status<>'VOIDED'")
    pool = _pool()
    with pool.connection() as conn:
        if not _schema_ready(conn):
            raise HTTPException(status_code=409, detail="Hãy khởi tạo cấu trúc PostgreSQL trước")
        rows = conn.execute(
            f"""SELECT a.*,
                       COALESCE((SELECT jsonb_agg(jsonb_build_object(
                         'eventId',e.event_id,'action',e.action,'beforeStatus',e.before_status,
                         'afterStatus',e.after_status,'note',e.note,'actor',e.actor,'eventAt',e.event_at
                       ) ORDER BY e.event_at,e.event_id)
                       FROM {SCHEMA}.accounting_report_adjustment_events e
                       WHERE e.adjustment_id=a.adjustment_id),'[]'::jsonb) AS events
                  FROM {SCHEMA}.accounting_report_adjustments a
                 WHERE {' AND '.join(where)}
                 ORDER BY period_to DESC,report_key,row_code,created_at DESC
                 LIMIT 2000""",
            tuple(params),
        ).fetchall()
    return {"ok": True, "adjustments": [_safe(dict(row)) for row in rows], "count": len(rows)}


@app.get("/report/adjustments")
def list_report_adjustments(
    versionId: str,
    companyKey: str = "",
    dataSpaceKey: str = "",
    reportKey: str = "",
    _: None = Depends(_auth),
) -> Dict[str, Any]:
    return _query_report_adjustments(
        version_id=versionId,
        company_key=companyKey,
        data_space_key=dataSpaceKey,
        report_key=reportKey,
    )


@app.post("/report/adjustments/list")
def list_report_adjustments_post(
    request: ReportAdjustmentListRequest,
    _: None = Depends(_auth),
) -> Dict[str, Any]:
    return _query_report_adjustments(
        version_id=request.versionId,
        company_key=request.companyKey,
        data_space_key=request.dataSpaceKey,
        report_key=request.reportKey,
        period_from=request.periodFrom,
        period_to=request.periodTo,
        include_voided=request.includeVoided,
    )


@app.post("/report/output")
def generate_report_output(
    request: ReportOutputRequest,
    _: None = Depends(_auth),
) -> Dict[str, Any]:
    return _build_report_output(request)


@app.post("/disclosure/output")
def generate_disclosure_output(
    request: ReportOutputRequest,
    _: None = Depends(_auth),
) -> Dict[str, Any]:
    return _build_report_output(
        request.model_copy(update={"reportKey": DISCLOSURE_REPORT_KEY, "includeEvidence": True})
    )


@app.post("/disclosure/export")
def export_disclosure_output(
    request: ReportExportRequest,
    _: None = Depends(_auth),
) -> Dict[str, Any]:
    export_format = _clean_key(request.format or "XLSX", "định dạng xuất")
    if export_format != "XLSX":
        raise HTTPException(status_code=400, detail="B09 hiện xuất trực tiếp định dạng XLSX; PDF được tạo từ cùng đầu ra đã khóa.")
    output = _build_report_output(
        request.model_copy(update={"reportKey": DISCLOSURE_REPORT_KEY, "includeEvidence": True})
    )
    _assert_report_exportable(output)
    content = disclosure_output_to_xlsx(output)
    if len(content) > MAX_EXPORT_BYTES:
        raise HTTPException(status_code=413, detail="Tệp B09 vượt giới hạn xuất an toàn của worker.")
    file_name = f"B09-DN - Ban thuyet minh Bao cao tai chinh - {request.periodTo.isoformat()}.xlsx"
    return {
        "ok": True,
        "fileName": file_name,
        "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "base64": base64.b64encode(content).decode("ascii"),
        "byteSize": len(content),
        "sha256": hashlib.sha256(content).hexdigest(),
        "rowCount": len(output.get("items") or []),
        "warningCount": len(output.get("warnings") or []),
        "generatedAt": output["generatedAt"],
    }


def _assert_report_exportable(output: Dict[str, Any]) -> None:
    failures = list(
        dict.fromkeys(
            str(item or "").strip()
            for item in (output.get("blockingIssues") or [])
            if str(item or "").strip()
        )
    )
    for check in output.get("controlChecks") or []:
        if _clean_key(check.get("status") or "PASS") != "FAIL":
            continue
        label = str(check.get("label") or "Kiểm tra kế toán chưa đạt").strip()
        difference = check.get("difference")
        if difference is not None:
            try:
                difference_number = float(difference)
            except (TypeError, ValueError):
                difference_number = 0.0
            label += f" (chênh {difference_number:,.0f})"
        if label not in failures:
            failures.append(label)
    if _clean_key(output.get("controlStatus") or "PASS") == "NEEDS_REVIEW":
        review_message = (
            "Báo cáo còn thiếu kỳ so sánh hoặc dữ liệu bắt buộc và đang ở trạng thái cần rà soát."
        )
        if review_message not in failures:
            failures.append(review_message)
    if failures:
        preview = "; ".join(failures[:3])
        if len(failures) > 3:
            preview += f"; và {len(failures) - 3} kiểm tra khác"
        raise HTTPException(
            status_code=409,
            detail=(
                "Chưa thể xuất báo cáo chính thức vì kiểm tra kế toán chưa đạt: "
                + preview
                + ". Bản xem trước vẫn được giữ để kế toán đối chiếu và sửa cấu hình."
            ),
        )


@app.post("/report/export")
def export_report_output(
    request: ReportExportRequest,
    _: None = Depends(_auth),
) -> Dict[str, Any]:
    export_format = _clean_key(request.format or "XLSX", "định dạng xuất")
    if export_format != "XLSX":
        raise HTTPException(
            status_code=400,
            detail="Worker hiện xuất trực tiếp định dạng XLSX; PDF được tạo ở cổng web từ cùng đầu ra đã khóa.",
        )
    output = _build_report_output(request)
    _assert_report_exportable(output)
    try:
        content = output_to_xlsx(output)
    except ReportEngineError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if len(content) > MAX_EXPORT_BYTES:
        raise HTTPException(
            status_code=413,
            detail="Tệp báo cáo vượt giới hạn xuất an toàn của worker.",
        )
    requested_name = re.sub(r'[<>:"/\\|?*\x00-\x1f]+', "_", request.fileName).strip(" ._")
    report_name = _clean_name(
        requested_name or str(output.get("report", {}).get("reportName") or "Báo cáo kế toán"),
        "tên tệp",
        120,
    )
    if not report_name.lower().endswith(".xlsx"):
        report_name = f"{report_name} - {request.periodTo.isoformat()}.xlsx"
    return {
        "ok": True,
        "fileName": report_name,
        "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "base64": base64.b64encode(content).decode("ascii"),
        "byteSize": len(content),
        "sha256": hashlib.sha256(content).hexdigest(),
        "rowCount": len(output.get("rows") or []),
        "warningCount": len(output.get("warnings") or []),
        "generatedAt": output["generatedAt"],
    }
