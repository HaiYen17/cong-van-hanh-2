from __future__ import annotations

import hashlib
import json
from datetime import datetime
from decimal import Decimal
from typing import Any, Dict, Optional


def decimal_value(value: Any) -> Decimal:
    try:
        return Decimal(str(value if value not in (None, "") else 0))
    except Exception:
        return Decimal(0)


def datetime_value(value: Any) -> Optional[datetime]:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None


def truthy(value: Any) -> bool:
    if value is True:
        return True
    return str(value or "").strip().lower() in {
        "1",
        "true",
        "yes",
        "y",
        "co",
        "có",
    }


def normalize_misa_journal_row(raw: Dict[str, Any]) -> Dict[str, Any]:
    """Chuẩn hóa một dòng Sổ Nhật ký chung MISA.

    Báo cáo MISA trả hai dòng đối xứng cho cùng một cặp định khoản. Dòng Nợ được
    chọn làm dòng định khoản chuẩn; dòng Có vẫn được giữ trong dữ liệu nguồn để
    kiểm toán và dùng kiểm tra độ phủ cặp đối xứng.
    """

    account_number = str(raw.get("account_number") or "").strip()
    corresponding_account = str(
        raw.get("corresponding_account_number") or ""
    ).strip()
    debit_amount = decimal_value(raw.get("debit_amount"))
    credit_amount = decimal_value(raw.get("credit_amount"))
    debit_amount_oc = decimal_value(raw.get("debit_amount_oc"))
    credit_amount_oc = decimal_value(raw.get("credit_amount_oc"))

    if debit_amount != 0 and credit_amount == 0:
        posting_side = "DEBIT"
        debit_account = account_number
        credit_account = corresponding_account
        # MISA dùng số âm cho bút toán điều chỉnh/đảo. Giữ nguyên dấu để
        # tổng dòng chuẩn luôn khớp với phát sinh Nợ/Có của sổ nguồn.
        amount = debit_amount
        amount_original = debit_amount_oc
    elif credit_amount != 0 and debit_amount == 0:
        posting_side = "CREDIT"
        debit_account = corresponding_account
        credit_account = account_number
        amount = credit_amount
        amount_original = credit_amount_oc
    elif debit_amount == 0 and credit_amount == 0:
        posting_side = "ZERO"
        debit_account = account_number
        credit_account = corresponding_account
        amount = Decimal(0)
        amount_original = Decimal(0)
    else:
        posting_side = "MIXED"
        debit_account = account_number
        credit_account = corresponding_account
        amount = debit_amount if abs(debit_amount) >= abs(credit_amount) else credit_amount
        amount_original = (
            debit_amount_oc
            if abs(debit_amount_oc) >= abs(credit_amount_oc)
            else credit_amount_oc
        )

    reference_id = str(
        raw.get("refid") or raw.get("ref_id") or raw.get("voucher_id") or ""
    ).strip()
    reference_no = str(raw.get("refno") or raw.get("ref_no") or "").strip()
    posted_at = datetime_value(raw.get("posted_date") or raw.get("posting_date"))
    document_at = datetime_value(raw.get("refdate") or raw.get("document_date"))
    invoice_at = datetime_value(raw.get("inv_date") or raw.get("invoice_date"))
    currency_id = str(raw.get("currency_id") or "VND").strip() or "VND"
    exchange_rate = decimal_value(raw.get("exchange_rate") or 1)

    dimensions = {
        key: raw.get(key)
        for key in (
            "account_object_code",
            "account_object_name",
            "employee_code",
            "employee_name",
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
            "branch_id",
            "branch_name",
            "loan_agreement_refno",
            "lending_agreement_refno",
            "un_resonable_cost",
            "transaction_class",
        )
        if raw.get(key) not in (None, "")
    }
    cash_flow_code = str(
        raw.get("cash_flow_code")
        or raw.get("cashflow_code")
        or raw.get("cash_flow_item_code")
        or raw.get("cash_flow_type")
        or ""
    ).strip()
    if cash_flow_code:
        dimensions["cash_flow_code"] = cash_flow_code
    for index in range(1, 11):
        for prefix in ("master_custom_field", "custom_field"):
            key = f"{prefix}{index}"
            if raw.get(key) not in (None, ""):
                dimensions[key] = raw.get(key)

    explicit_closing = (
        raw.get("is_closing_entry")
        if raw.get("is_closing_entry") is not None
        else raw.get("is_closing")
    )
    entry_type = str(raw.get("entry_type") or "").strip()
    is_closing_entry = truthy(explicit_closing) or (
        debit_account.startswith("911") or credit_account.startswith("911")
    )
    is_reversal = truthy(raw.get("is_reversal")) or truthy(
        raw.get("is_reverse")
    )
    intercompany_partner = str(
        raw.get("intercompany_partner")
        or raw.get("intercompany_company_key")
        or ""
    ).strip()

    identity = {
        "reference_id": reference_id,
        "reference_no": reference_no,
        "posted_at": posted_at.isoformat() if posted_at else "",
        "debit_account": debit_account,
        "credit_account": credit_account,
        "amount": str(amount),
        "amount_original": str(amount_original),
        "currency_id": currency_id,
        "exchange_rate": str(exchange_rate),
        # Các chiều phân tích có thể thuộc riêng vế Nợ hoặc vế Có (đặc biệt
        # khi chuyển công nợ giữa hai đối tượng), nên không phải căn cứ ghép
        # hai dòng đối xứng. Chúng vẫn được giữ đầy đủ trên dòng nguồn.
        "reference_type": str(raw.get("reftype") or ""),
    }
    posting_hash = hashlib.sha256(
        json.dumps(
            identity,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()

    raw_data = {key: value for key, value in raw.items() if key != "session_id"}
    return {
        "posting_side": posting_side,
        "is_canonical_posting": posting_side == "DEBIT" and amount != 0,
        "posting_hash": posting_hash,
        "reference_id": reference_id,
        "reference_no": reference_no,
        "posted_at": posted_at,
        "document_at": document_at,
        "invoice_at": invoice_at,
        "invoice_no": str(raw.get("inv_no") or raw.get("invoice_no") or "").strip(),
        "journal_memo": str(raw.get("journal_memo") or "").strip(),
        "description": str(raw.get("description") or "").strip(),
        "debit_account": debit_account,
        "credit_account": credit_account,
        "amount": amount,
        "amount_original": amount_original,
        "currency_id": currency_id,
        "exchange_rate": exchange_rate,
        "reference_type": str(raw.get("reftype") or "").strip(),
        "reference_type_name": str(raw.get("reftype_name") or "").strip(),
        "entry_type": entry_type,
        "is_closing_entry": is_closing_entry,
        "is_reversal": is_reversal,
        "intercompany_partner": intercompany_partner,
        "branch_id": str(dimensions.get("branch_id") or "").strip(),
        "organization_unit_code": str(
            dimensions.get("organization_unit_code") or ""
        ).strip(),
        "account_object_code": str(
            dimensions.get("account_object_code") or ""
        ).strip(),
        "expense_item_code": str(
            dimensions.get("expense_item_code") or ""
        ).strip(),
        "transaction_class": str(
            dimensions.get("transaction_class") or ""
        ).strip(),
        "cash_flow_code": cash_flow_code,
        "dimensions": dimensions,
        "raw_data": raw_data,
        "raw_debit": debit_amount,
        "raw_credit": credit_amount,
    }


def journal_canonical_data(
    raw: Dict[str, Any], normalized: Dict[str, Any]
) -> Dict[str, Any]:
    canonical = {
        key: value
        for key, value in raw.items()
        if key not in {"session_id", "detail_id", "row_index", "sort_index"}
    }
    canonical.update(
        {
            "debit_account": normalized["debit_account"],
            "credit_account": normalized["credit_account"],
            "amount": str(normalized["amount"]),
            "amount_original": str(normalized["amount_original"]),
            "posting_side": normalized["posting_side"],
            "posting_hash": normalized["posting_hash"],
            "is_canonical_posting": normalized["is_canonical_posting"],
            "posted_date": normalized["posted_at"].isoformat()
            if normalized["posted_at"]
            else "",
            "reference_id": normalized["reference_id"],
            "reference_no": normalized["reference_no"],
            "entry_type": normalized["entry_type"],
            "is_closing_entry": normalized["is_closing_entry"],
            "is_reversal": normalized["is_reversal"],
            "intercompany_partner": normalized["intercompany_partner"],
            "transaction_class": normalized["transaction_class"],
            "cash_flow_code": normalized["cash_flow_code"],
        }
    )
    canonical.update(normalized["dimensions"])
    return canonical
