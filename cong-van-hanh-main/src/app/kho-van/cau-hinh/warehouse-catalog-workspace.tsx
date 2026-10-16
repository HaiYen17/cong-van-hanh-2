"use client";

import {
  Barcode,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Database,
  Download,
  FileSpreadsheet,
  History,
  PackageCheck,
  Pencil,
  Plus,
  Printer,
  RefreshCw,
  Save,
  Search,
  Server,
  Tags,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";

import { useToast, WriteLoadingOverlay } from "@/components/ui/toast";
import type {
  WarehouseBarcodeMapping,
  WarehouseBarcodePrintHistoryItem,
  WarehouseCatalogActionResult,
  WarehouseCatalogImportResult,
  WarehouseCatalogManualRow,
  WarehouseCatalogProduct,
  WarehouseCatalogViewInput,
  WarehouseCatalogWorkspaceData,
  WarehouseProductionPlanData,
  WarehouseStockPrintAnalysis,
  WarehouseStockPrintItem,
  WarehouseStockPrintIssue,
} from "@/lib/warehouse/catalog-types";
import {
  buildWarehouseGroupedLabelPrintPages,
  isWarehouseLabelStartSlotValid,
} from "@/lib/warehouse/label-print-layout";
import {
  buildWarehouseProductionPlanDraftItems,
  toggleWarehouseProductionPlanDate,
  type WarehouseProductionPlanDraftItem,
} from "@/lib/warehouse/production-plan-selection";

import {
  analyzeWarehouseStockPrintAction,
  applyWarehouseBarcodeMappingsAction,
  deleteWarehouseLabelPrintHistoriesAction,
  deleteWarehouseLabelPrintHistoryAction,
  downloadWarehouseCatalogTemplateAction,
  getWarehouseProductionPlanAction,
  importWarehouseCatalogAction,
  importWarehouseCatalogManualAction,
  recordWarehouseLabelPrintAction,
  refreshWarehouseCatalogAction,
  regenerateWarehouseBarcodeAction,
  saveWarehouseBarcodeAction,
  searchWarehousePrintProductsAction,
  syncWarehouseCatalogLegacyAction,
} from "./actions";
import { Code128Barcode } from "./code128";
import styles from "./warehouse-catalog.module.css";

type BarcodeFilter = "ALL" | "MAPPED" | "MISSING" | "DUPLICATE";

const TOMY_PRINT_LAYOUTS = {
  TOMY_133_16: {
    columns: 2,
    description: "101 × 36 mm · 2 cột × 8 hàng · 16 tem/trang A4",
    displayName: "Tommy 133",
    horizontalGapMm: 2,
    labelPhysicalHeightMm: 36,
    labelPhysicalWidthMm: 101,
    labelsPerPage: 16,
    layoutVersion: "RFID-v4",
    pageHeightMm: 297,
    pageWidthMm: 210,
    rows: 8,
    sheetMarginLeftMm: 3,
    sheetMarginTopMm: 5,
    verticalGapMm: 0,
  },
  TOMY_148_33: {
    columns: 3,
    description: "66 × 25 mm · 3 cột × 11 hàng · 33 tem/trang A4",
    displayName: "Tommy 148",
    horizontalGapMm: 0,
    labelPhysicalHeightMm: 25,
    labelPhysicalWidthMm: 66,
    labelsPerPage: 33,
    layoutVersion: "RFID-v3",
    pageHeightMm: 297,
    pageWidthMm: 210,
    rows: 11,
    sheetMarginLeftMm: 6,
    sheetMarginTopMm: 11,
    verticalGapMm: 0,
  },
  TOMY_148_BARCODE_33: {
    columns: 3,
    description: "66 × 25 mm · tên + SKU + Barcode canh giữa · 33 tem/trang A4",
    displayName: "Tommy 148 · Tên + SKU + Barcode",
    horizontalGapMm: 0,
    labelPhysicalHeightMm: 25,
    labelPhysicalWidthMm: 66,
    labelsPerPage: 33,
    layoutVersion: "BARCODE-v2-SPLIT-1-2",
    pageHeightMm: 297,
    pageWidthMm: 210,
    rows: 11,
    sheetMarginLeftMm: 6,
    sheetMarginTopMm: 11,
    verticalGapMm: 0,
  },
} as const;

type TomyPrintFormat = keyof typeof TOMY_PRINT_LAYOUTS;

const DEFAULT_TOMY_PRINT_FORMAT: TomyPrintFormat = "TOMY_133_16";

function printFormatLabel(value: string) {
  return TOMY_PRINT_LAYOUTS[value as TomyPrintFormat]?.displayName || value;
}

function numberLabel(value: number) {
  return new Intl.NumberFormat("vi-VN").format(value);
}

function moneyLabel(value: number | null) {
  return value == null
    ? ""
    : new Intl.NumberFormat("vi-VN", {
        currency: "VND",
        maximumFractionDigits: 0,
        style: "currency",
      }).format(value);
}

function dateTimeLabel(value: string) {
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}

function isActiveStatus(value: string) {
  const key = value.toLocaleLowerCase("vi");
  return !["inactive", "archived", "ngưng dùng", "ngưng hoạt động"].some(
    (item) => key.includes(item),
  );
}

function csvCell(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function stockIssueLabel(reason: WarehouseStockPrintIssue["reason"]) {
  return reason === "MISSING_PRODUCT" ? "Chưa có trong Kho" : "Chưa có Barcode";
}

function stockPrintProduct(item: WarehouseStockPrintItem): WarehouseCatalogProduct {
  return {
    barcode: item.barcode,
    color: "",
    id: item.productId,
    name: item.name,
    purchasePrice: null,
    rfidCount: 0,
    salePrice: null,
    size: "",
    sku: item.sku,
    source: "Nạp từ file Excel",
    status: "ACTIVE",
    stockTvd: 0,
    stockTvg: 0,
    taxRate: null,
    unit: "",
    updatedAt: new Date().toISOString(),
  };
}

async function runWarehousePrint(mode: "labels" | "stock-report") {
  document.body.dataset.warehousePrintMode = mode;
  const cleanup = () => {
    delete document.body.dataset.warehousePrintMode;
  };
  window.addEventListener("afterprint", cleanup, { once: true });
  await document.fonts.ready;
  window.print();
  window.setTimeout(cleanup, 0);
}

function parseQuickMappings(value: string): WarehouseBarcodeMapping[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line, index) => {
      const cells = line.split(/\t|;|,/).map((cell) => cell.trim());
      if (index === 0 && cells.some((cell) => /^(mã\s*)?sku$/i.test(cell))) {
        return [];
      }
      return cells[0] && cells[1] ? [{ barcode: cells[1], sku: cells[0] }] : [];
    });
}

function ModalShell({
  children,
  kicker,
  onClose,
  printRoot = false,
  title,
  wide = false,
}: {
  children: React.ReactNode;
  kicker: string;
  onClose: () => void;
  printRoot?: boolean;
  title: string;
  wide?: boolean;
}) {
  const content = (
    <div
      className={styles.modalBackdrop}
      data-warehouse-print-root={printRoot ? "true" : undefined}
      role="presentation"
    >
      <section
        aria-modal="true"
        className={`${styles.modal} ${wide ? styles.modalWide : ""}`}
        role="dialog"
      >
        <div className={styles.modalHeader}>
          <div>
            <span>{kicker}</span>
            <h2>{title}</h2>
          </div>
          <button aria-label="Đóng" onClick={onClose} type="button">
            <X size={20} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );

  return printRoot ? createPortal(content, document.body) : content;
}

function DeletePrintHistoryModal({
  item,
  onClose,
  onConfirm,
  pending,
}: {
  item: WarehouseBarcodePrintHistoryItem;
  onClose: () => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  return (
    <ModalShell
      kicker="Dọn lịch sử in"
      onClose={onClose}
      title="Xóa lần in này?"
    >
      <div className={styles.deleteHistoryNotice}>
        <History size={20} />
        <div>
          <strong>
            {numberLabel(item.labelCount)} tem ·{" "}
            {numberLabel(item.productCount)} SKU
          </strong>
          <span>
            {item.actorName} · {dateTimeLabel(item.createdAt)}
          </span>
        </div>
      </div>
      <p className={styles.modalHint}>
        Chỉ bản ghi lịch sử in này bị xóa khỏi PostgreSQL; Barcode, SKU và lô
        tem đã in không bị thay đổi.
      </p>
      <div className={styles.modalActions}>
        <button
          className={styles.secondaryButton}
          disabled={pending}
          onClick={onClose}
          type="button"
        >
          Giữ lại
        </button>
        <button
          className={styles.dangerButton}
          disabled={pending}
          onClick={onConfirm}
          type="button"
        >
          <X size={17} /> Xóa lịch sử
        </button>
      </div>
    </ModalShell>
  );
}

function BulkDeletePrintHistoryModal({
  count,
  onClose,
  onConfirm,
  pending,
}: {
  count: number;
  onClose: () => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  return (
    <ModalShell
      kicker="Dọn lịch sử in"
      onClose={onClose}
      title={`Xóa ${numberLabel(count)} lịch sử đã chọn?`}
    >
      <p className={styles.modalHint}>
        Chỉ các bản ghi theo dõi lệnh in bị xóa khỏi PostgreSQL. SKU, Barcode và
        dữ liệu tem đã in không bị thay đổi.
      </p>
      <div className={styles.modalActions}>
        <button
          className={styles.secondaryButton}
          disabled={pending}
          onClick={onClose}
          type="button"
        >
          Giữ lại
        </button>
        <button
          className={styles.dangerButton}
          disabled={pending || !count}
          onClick={onConfirm}
          type="button"
        >
          <X size={17} /> Xóa lịch sử đã chọn
        </button>
      </div>
    </ModalShell>
  );
}

function ImportResultBlock({
  result,
}: {
  result: WarehouseCatalogImportResult;
}) {
  return (
    <section className={styles.importResult}>
      <div className={styles.importResultStats}>
        <span>
          <strong>{numberLabel(result.createdCount)}</strong> thêm mới
        </span>
        {result.generatedBarcodeCount ? (
          <span>
            <strong>{numberLabel(result.generatedBarcodeCount)}</strong> mã tự
            sinh
          </span>
        ) : null}
        <span>
          <strong>{numberLabel(result.updatedCount)}</strong> cập nhật
        </span>
        <span>
          <strong>{numberLabel(result.skippedCount)}</strong> không đổi
        </span>
        <span className={result.errorCount ? styles.resultError : ""}>
          <strong>{numberLabel(result.errorCount)}</strong> cần kiểm tra
        </span>
      </div>
      {result.errors.length ? (
        <div className={styles.importErrors}>
          {result.errors.map((error, index) => (
            <div key={`${error.rowNumber}-${index}`}>
              <strong>Dòng {error.rowNumber}</strong>
              <span>{error.message}</span>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function ImportModal({
  onClose,
  onSubmit,
  pending,
  result,
}: {
  onClose: () => void;
  onSubmit: (file: File) => void;
  pending: boolean;
  result: WarehouseCatalogImportResult | null;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!pending) return;

    const startTimer = window.setTimeout(() => setProgress(8), 0);
    const timer = window.setInterval(() => {
      setProgress((current) => {
        if (current >= 92) return 92;
        if (current < 32) return Math.min(32, current + 8);
        if (current < 64) return Math.min(64, current + 5);
        return Math.min(92, current + 2);
      });
    }, 650);

    return () => {
      window.clearTimeout(startTimer);
      window.clearInterval(timer);
    };
  }, [pending]);

  const progressMessage =
    progress < 28
      ? "Đang tải file và kiểm tra định dạng..."
      : progress < 48
        ? "Đang đọc sheet và nhận diện dòng tiêu đề..."
        : progress < 70
          ? "Đang đối chiếu SKU, Barcode và dữ liệu hiện có..."
          : progress < 93
            ? "Đang cập nhật PostgreSQL và ghi lịch sử..."
            : "Đã xử lý xong dữ liệu trong file.";

  return (
    <ModalShell
      kicker="Cấu hình Kho"
      onClose={onClose}
      title="Nạp hàng hóa từ file"
    >
      <p className={styles.modalHint}>
        Hệ thống tự dò sheet và dòng tiêu đề. Cột <strong>Mã</strong> hoặc
        <strong> Mã SKU</strong> được dùng làm khóa. File không có Barcode sẽ tự
        sinh mã cho SKU mới; SKU đã có được bỏ qua và giữ nguyên Barcode.
      </p>
      <label className={styles.filePicker}>
        <input
          accept=".csv,.xls,.xlsx"
          disabled={pending}
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setProgress(0);
          }}
          type="file"
        />
        <span className={styles.fileIcon}>
          <FileSpreadsheet size={25} />
        </span>
        <span>
          <strong>{file?.name || "Chọn file CSV / XLS / XLSX"}</strong>
          <small>
            {file
              ? `${(file.size / 1024 / 1024).toFixed(2)} MB · sẵn sàng nạp`
              : "Tối đa 14 MB · giữ nguyên mã có số 0 ở đầu"}
          </small>
        </span>
        <Upload size={19} />
      </label>
      {pending ? (
        <section
          aria-live="polite"
          className={styles.importProgress}
          role="status"
        >
          <div className={styles.importProgressHeader}>
            <span>
              <Clock3 size={17} /> Đang nạp và đối soát dữ liệu
            </span>
            <strong>{progress}%</strong>
          </div>
          <div
            aria-label="Tiến độ nạp danh mục Kho"
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={progress}
            className={styles.importProgressTrack}
            role="progressbar"
          >
            <span style={{ width: `${progress}%` }} />
          </div>
          <p>{progressMessage}</p>
          <small>
            Vui lòng giữ cửa sổ này mở; hệ thống sẽ báo ngay khi hoàn tất.
          </small>
        </section>
      ) : null}
      {result ? <ImportResultBlock result={result} /> : null}
      <div className={styles.modalActions}>
        <button
          className={styles.secondaryButton}
          disabled={pending}
          onClick={onClose}
          type="button"
        >
          Đóng
        </button>
        <button
          className={styles.primaryButton}
          disabled={!file || pending}
          onClick={() => file && onSubmit(file)}
          type="button"
        >
          <Upload size={17} />
          {pending ? `Đang xử lý ${progress}%` : "Nạp và đối soát"}
        </button>
      </div>
    </ModalShell>
  );
}

type ManualCatalogDraftRow = WarehouseCatalogManualRow & { id: number };

function emptyManualCatalogRow(id: number): ManualCatalogDraftRow {
  return {
    color: "",
    id,
    name: "",
    purchasePrice: "",
    salePrice: "",
    size: "",
    sku: "",
    taxRate: "",
    unit: "",
  };
}

function ManualCatalogImportModal({
  onClose,
  onSubmit,
  pending,
  result,
}: {
  onClose: () => void;
  onSubmit: (rows: WarehouseCatalogManualRow[]) => void;
  pending: boolean;
  result: WarehouseCatalogImportResult | null;
}) {
  const [rows, setRows] = useState<ManualCatalogDraftRow[]>([
    emptyManualCatalogRow(1),
  ]);
  const nextRowId = useRef(2);
  const changeRow = (
    id: number,
    field: keyof WarehouseCatalogManualRow,
    value: string,
  ) => {
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, [field]: value } : row)),
    );
  };
  const populatedRows = rows.filter((row) =>
    Object.entries(row).some(
      ([key, value]) => key !== "id" && String(value).trim(),
    ),
  );
  const invalidRows = populatedRows.filter(
    (row) => !row.sku.trim() || !row.name.trim(),
  );
  const addRow = () => {
    if (rows.length >= 50) return;
    const id = nextRowId.current++;
    setRows((current) => [...current, emptyManualCatalogRow(id)]);
  };
  const submitRows = () => {
    onSubmit(
      populatedRows.map((row) => ({
        color: row.color,
        name: row.name.trim(),
        purchasePrice: row.purchasePrice,
        salePrice: row.salePrice,
        size: row.size,
        sku: row.sku.trim(),
        taxRate: row.taxRate,
        unit: row.unit,
      })),
    );
  };

  return (
    <ModalShell
      kicker="Cấu hình Kho"
      onClose={onClose}
      title="Nạp lẻ hàng hóa"
      wide
    >
      <p className={styles.modalHint}>
        Nhập <strong>Mã SKU</strong> và <strong>Tên hàng hóa</strong>; các ô còn
        lại có thể để trống. Hệ thống không yêu cầu nhập Barcode và sẽ tự cấp mã
        mới không trùng cho từng SKU mới. SKU đã tồn tại được giữ nguyên.
      </p>
      <div className={styles.manualCatalogRows}>
        {rows.map((row, index) => (
          <section className={styles.manualCatalogRow} key={row.id}>
            <header>
              <strong>Dòng {index + 1}</strong>
              <button
                aria-label={`Xóa dòng ${index + 1}`}
                disabled={pending || rows.length === 1}
                onClick={() =>
                  setRows((current) =>
                    current.filter((item) => item.id !== row.id),
                  )
                }
                title="Xóa dòng"
                type="button"
              >
                <Trash2 size={15} />
              </button>
            </header>
            <div className={styles.manualCatalogGrid}>
              <label>
                <span>Mã SKU *</span>
                <input
                  autoComplete="off"
                  disabled={pending}
                  onChange={(event) =>
                    changeRow(row.id, "sku", event.target.value)
                  }
                  placeholder="VD: SORA20-8"
                  value={row.sku}
                />
              </label>
              <label className={styles.manualCatalogName}>
                <span>Tên hàng hóa *</span>
                <input
                  autoComplete="off"
                  disabled={pending}
                  onChange={(event) =>
                    changeRow(row.id, "name", event.target.value)
                  }
                  placeholder="Tên đầy đủ của hàng hóa"
                  value={row.name}
                />
              </label>
              <label>
                <span>ĐVT</span>
                <input
                  disabled={pending}
                  onChange={(event) =>
                    changeRow(row.id, "unit", event.target.value)
                  }
                  placeholder="Tấm, cái..."
                  value={row.unit}
                />
              </label>
              <label>
                <span>Màu</span>
                <input
                  disabled={pending}
                  onChange={(event) =>
                    changeRow(row.id, "color", event.target.value)
                  }
                  value={row.color}
                />
              </label>
              <label>
                <span>Kích thước</span>
                <input
                  disabled={pending}
                  onChange={(event) =>
                    changeRow(row.id, "size", event.target.value)
                  }
                  value={row.size}
                />
              </label>
              <label>
                <span>Giá mua</span>
                <input
                  disabled={pending}
                  inputMode="decimal"
                  onChange={(event) =>
                    changeRow(row.id, "purchasePrice", event.target.value)
                  }
                  value={row.purchasePrice}
                />
              </label>
              <label>
                <span>Giá bán</span>
                <input
                  disabled={pending}
                  inputMode="decimal"
                  onChange={(event) =>
                    changeRow(row.id, "salePrice", event.target.value)
                  }
                  value={row.salePrice}
                />
              </label>
              <label>
                <span>Thuế suất (%)</span>
                <input
                  disabled={pending}
                  inputMode="decimal"
                  onChange={(event) =>
                    changeRow(row.id, "taxRate", event.target.value)
                  }
                  value={row.taxRate}
                />
              </label>
            </div>
          </section>
        ))}
      </div>
      <button
        className={styles.manualCatalogAddRow}
        disabled={pending || rows.length >= 50}
        onClick={addRow}
        type="button"
      >
        <Plus size={17} /> Thêm dòng
      </button>
      {invalidRows.length ? (
        <p className={styles.manualCatalogValidation}>
          Có {numberLabel(invalidRows.length)} dòng đang thiếu Mã SKU hoặc Tên
          hàng hóa.
        </p>
      ) : null}
      {result ? <ImportResultBlock result={result} /> : null}
      <div className={styles.modalActions}>
        <button
          className={styles.secondaryButton}
          disabled={pending}
          onClick={onClose}
          type="button"
        >
          Đóng
        </button>
        <button
          className={styles.primaryButton}
          disabled={!populatedRows.length || invalidRows.length > 0 || pending}
          onClick={submitRows}
          type="button"
        >
          <Plus size={17} />
          {pending ? "Đang nạp..." : `Nạp ${populatedRows.length} SKU`}
        </button>
      </div>
    </ModalShell>
  );
}

function StockIssuePrintReport({
  analysis,
}: {
  analysis: WarehouseStockPrintAnalysis;
}) {
  if (!analysis.issueItems.length) return null;
  return createPortal(
    <main
      className={styles.stockIssuePrintRoot}
      data-warehouse-stock-report-root="true"
    >
      <header>
        <span>BÁO CÁO ĐỐI CHIẾU TỒN KHO</span>
        <h1>Danh sách mã chưa in được</h1>
        <p>
          File: {analysis.fileName} · Sheet: {analysis.sheetName}
        </p>
        <p>
          Ngày in:{" "}
          {new Intl.DateTimeFormat("vi-VN", {
            dateStyle: "short",
            timeStyle: "short",
          }).format(new Date())}
        </p>
      </header>
      <section className={styles.stockIssuePrintSummary}>
        <span>
          <strong>{numberLabel(analysis.positiveSkuCount)}</strong> mã tồn dương
        </span>
        <span>
          <strong>{numberLabel(analysis.issueItems.length)}</strong> mã chưa in
          được
        </span>
        <span>
          <strong>{numberLabel(analysis.issueLabelCount)}</strong> tem đang
          thiếu
        </span>
      </section>
      <table className={styles.stockIssuePrintTable}>
        <thead>
          <tr>
            <th>STT</th>
            <th>Mã hàng</th>
            <th>Tên hàng</th>
            <th>Số lượng</th>
            <th>Lý do</th>
          </tr>
        </thead>
        <tbody>
          {analysis.issueItems.map((item, index) => (
            <tr key={`${item.reason}-${item.sku}`}>
              <td>{index + 1}</td>
              <td>{item.sku}</td>
              <td>{item.name || "—"}</td>
              <td>{numberLabel(item.quantity)}</td>
              <td>{stockIssueLabel(item.reason)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>,
    document.body,
  );
}

function StockPrintModal({
  analysis,
  onAnalyze,
  onApply,
  onClose,
  onDownload,
  onPrintIssues,
  onReset,
  pending,
}: {
  analysis: WarehouseStockPrintAnalysis | null;
  onAnalyze: (file: File) => void;
  onApply: () => void;
  onClose: () => void;
  onDownload: () => void;
  onPrintIssues: () => void;
  onReset: () => void;
  pending: boolean;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!pending) return;
    const startTimer = window.setTimeout(() => setProgress(10), 0);
    const timer = window.setInterval(() => {
      setProgress((current) => Math.min(92, current + (current < 55 ? 9 : 3)));
    }, 550);
    return () => {
      window.clearTimeout(startTimer);
      window.clearInterval(timer);
    };
  }, [pending]);

  return (
    <ModalShell
      kicker="In nhãn nhanh"
      onClose={onClose}
      title="In nhanh từ file"
      wide
    >
      <p className={styles.modalHint}>
        Chọn file tồn kho. Hệ thống chỉ lấy mã có{" "}
        <strong>số lượng lớn hơn 0</strong>, đối chiếu với Cấu hình Kho rồi tạo
        đúng số tem cần in.
      </p>
      <label className={styles.filePicker}>
        <input
          accept=".csv,.xls,.xlsx"
          disabled={pending}
          onChange={(event) => {
            const nextFile = event.target.files?.[0] ?? null;
            setFile(nextFile);
            setProgress(0);
            onReset();
          }}
          type="file"
        />
        <span className={styles.fileIcon}>
          <FileSpreadsheet size={25} />
        </span>
        <span>
          <strong>{file?.name || "Chọn file tồn kho"}</strong>
          <small>
            {file
              ? `${(file.size / 1024 / 1024).toFixed(2)} MB · sẵn sàng đọc`
              : "Nhận CSV, XLS hoặc XLSX · tối đa 14 MB"}
          </small>
        </span>
        <Upload size={19} />
      </label>

      {pending ? (
        <section
          aria-live="polite"
          className={styles.importProgress}
          role="status"
        >
          <div className={styles.importProgressHeader}>
            <span>
              <Clock3 size={17} /> Đang đọc và đối chiếu
            </span>
            <strong>{progress}%</strong>
          </div>
          <div
            aria-label="Tiến độ đọc file tồn kho"
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={progress}
            className={styles.importProgressTrack}
            role="progressbar"
          >
            <span style={{ width: `${progress}%` }} />
          </div>
          <p>Đang tìm mã tồn dương và so với danh mục Kho...</p>
        </section>
      ) : null}

      {analysis ? (
        <section className={styles.stockAnalysis}>
          <div className={styles.stockAnalysisStats}>
            <span>
              <small>Mã tồn dương</small>
              <strong>{numberLabel(analysis.positiveSkuCount)}</strong>
            </span>
            <span>
              <small>In được</small>
              <strong>{numberLabel(analysis.printableItems.length)}</strong>
            </span>
            <span
              className={
                analysis.issueItems.length ? styles.stockIssueStat : ""
              }
            >
              <small>Chưa in được</small>
              <strong>{numberLabel(analysis.issueItems.length)}</strong>
            </span>
            <span>
              <small>Số tem sẽ in</small>
              <strong>{numberLabel(analysis.printableLabelCount)}</strong>
            </span>
          </div>
          {analysis.issueItems.length ? (
            <div className={styles.stockIssueList}>
              <div className={styles.stockIssueHeader}>
                <div>
                  <Tags size={18} />
                  <strong>Mã chưa in được</strong>
                </div>
                <span>{numberLabel(analysis.issueLabelCount)} tem</span>
              </div>
              <div className={styles.stockIssueRows}>
                {analysis.issueItems.map((item) => (
                  <div key={`${item.reason}-${item.sku}`}>
                    <code>{item.sku}</code>
                    <span>{item.name || "Chưa có tên hàng"}</span>
                    <b>×{numberLabel(item.quantity)}</b>
                    <small>{stockIssueLabel(item.reason)}</small>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className={styles.stockReadyNotice}>
              <CheckCircle2 size={19} /> Đã khớp đủ mã và Barcode để in.
            </div>
          )}
        </section>
      ) : null}

      <div className={`${styles.modalActions} ${styles.stockModalActions}`}>
        <button
          className={styles.secondaryButton}
          disabled={pending}
          onClick={onClose}
          type="button"
        >
          Đóng
        </button>
        {analysis?.issueItems.length ? (
          <>
            <button
              className={styles.ghostButton}
              disabled={pending}
              onClick={onDownload}
              type="button"
            >
              <Download size={17} /> Tải mã thiếu
            </button>
            <button
              className={styles.secondaryButton}
              disabled={pending}
              onClick={onPrintIssues}
              type="button"
            >
              <Printer size={17} /> In mã thiếu
            </button>
          </>
        ) : null}
        {!analysis ? (
          <button
            className={styles.primaryButton}
            disabled={!file || pending}
            onClick={() => file && onAnalyze(file)}
            type="button"
          >
            <Upload size={17} />
            {pending ? `Đang đọc ${progress}%` : "Nạp file"}
          </button>
        ) : (
          <button
            className={styles.primaryButton}
            disabled={!analysis.printableItems.length || pending}
            onClick={onApply}
            type="button"
          >
            <Printer size={17} />
            {analysis.issueItems.length ? "Bỏ qua & in" : "Tạo bản in"}
          </button>
        )}
      </div>
      {analysis ? <StockIssuePrintReport analysis={analysis} /> : null}
    </ModalShell>
  );
}

function QuickMappingModal({
  onClose,
  onSubmit,
  pending,
  result,
}: {
  onClose: () => void;
  onSubmit: (mappings: WarehouseBarcodeMapping[]) => void;
  pending: boolean;
  result: WarehouseCatalogImportResult | null;
}) {
  const [value, setValue] = useState("Mã SKU\tMã vạch\n");
  const mappings = useMemo(() => parseQuickMappings(value), [value]);
  return (
    <ModalShell
      kicker="Nạp Barcode theo SKU"
      onClose={onClose}
      title="Dán danh sách từ Excel"
    >
      <p className={styles.modalHint}>
        Copy hai cột <strong>Mã SKU</strong> và <strong>Mã vạch</strong> từ
        Excel rồi dán vào đây. Hệ thống không cho một Barcode thuộc hai SKU.
      </p>
      <textarea
        className={styles.mappingInput}
        onChange={(event) => setValue(event.target.value)}
        placeholder={"Mã SKU\tMã vạch\nSKU-001\t893..."}
        spellCheck={false}
        value={value}
      />
      <div className={styles.mappingCount}>
        <CheckCircle2 size={16} /> Đã nhận diện {numberLabel(mappings.length)}{" "}
        dòng
      </div>
      {result ? <ImportResultBlock result={result} /> : null}
      <div className={styles.modalActions}>
        <button
          className={styles.secondaryButton}
          onClick={onClose}
          type="button"
        >
          Đóng
        </button>
        <button
          className={styles.primaryButton}
          disabled={!mappings.length || pending}
          onClick={() => onSubmit(mappings)}
          type="button"
        >
          <Save size={17} />
          Cập nhật Barcode
        </button>
      </div>
    </ModalShell>
  );
}

function ProductionPlanModal({
  data,
  onApply,
  onClose,
}: {
  data: WarehouseProductionPlanData;
  onApply: (
    items: Array<{ product: WarehouseCatalogProduct; quantity: number }>,
    usedProductionPlan: boolean,
  ) => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState<"DATE" | "ITEMS">("DATE");
  const [selectedDateKey, setSelectedDateKey] = useState(data.defaultDateKey);
  const [draftItems, setDraftItems] = useState<
    WarehouseProductionPlanDraftItem[]
  >([]);
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [productQuery, setProductQuery] = useState("");
  const [productResults, setProductResults] = useState<
    WarehouseCatalogProduct[]
  >([]);
  const [searching, startSearch] = useTransition();
  const [importingExcel, startExcelImport] = useTransition();
  const latestProductSearch = useRef("");
  const { toast } = useToast();
  const selectedDate = data.dates.find(
    (date) => date.dateKey === selectedDateKey,
  );

  useEffect(() => {
    const query = productQuery.trim();
    latestProductSearch.current = query;
    if (!showAddProduct || !query) {
      setProductResults([]);
      return;
    }
    const timer = window.setTimeout(() => {
      startSearch(async () => {
        const result = await searchWarehousePrintProductsAction(query);
        if (latestProductSearch.current !== query) return;
        if (!result.ok) {
          setProductResults([]);
          toast({
            message: result.message,
            title: "Không tìm được SKU",
            tone: "error",
          });
          return;
        }
        setProductResults(result.products);
      });
    }, 260);
    return () => window.clearTimeout(timer);
  }, [productQuery, showAddProduct, toast]);

  const startReview = () => {
    setDraftItems(buildWarehouseProductionPlanDraftItems(selectedDate?.items));
    setShowAddProduct(!selectedDate);
    setStep("ITEMS");
  };

  const changeQuantity = (sku: string, nextValue: number) => {
    const quantity = Math.max(0, Math.min(9999, Math.floor(nextValue || 0)));
    setDraftItems((current) =>
      current.map((item) => (item.sku === sku ? { ...item, quantity } : item)),
    );
  };

  const removeDraftItem = (sku: string) => {
    setDraftItems((current) => current.filter((item) => item.sku !== sku));
  };

  const addProduct = (product: WarehouseCatalogProduct) => {
    setDraftItems((current) => {
      const existing = current.find((item) => item.product?.id === product.id);
      if (existing) {
        return current.map((item) =>
          item.product?.id === product.id
            ? { ...item, quantity: Math.min(9999, item.quantity + 1) }
            : item,
        );
      }
      return [
        ...current,
        {
          name: product.name,
          plannedQuantity: 0,
          product,
          quantity: 1,
          rowNumbers: [],
          sku: product.sku,
        },
      ];
    });
    setProductQuery("");
    setProductResults([]);
  };

  const importExcelFile = (file: File) => {
    toast({
      message: `Đang tìm dòng tiêu đề và đối chiếu SKU trong ${file.name}.`,
      title: "Đang đọc file Excel",
      tone: "info",
    });
    startExcelImport(async () => {
      const formData = new FormData();
      formData.set("file", file);
      const result = await analyzeWarehouseStockPrintAction(formData);
      if (!result.ok || !result.analysis) {
        toast({
          message: result.message,
          title: "Không nạp được file Excel",
          tone: "error",
        });
        return;
      }

      const importedItems: WarehouseProductionPlanDraftItem[] = [
        ...result.analysis.printableItems.map((item) => ({
          name: item.name,
          plannedQuantity: 0,
          product: stockPrintProduct(item),
          quantity: item.quantity,
          rowNumbers: item.rowNumbers,
          sku: item.sku,
        })),
        ...result.analysis.issueItems.map((item) => ({
          issueReason: item.reason,
          name: item.name,
          plannedQuantity: 0,
          product: null,
          quantity: item.quantity,
          rowNumbers: item.rowNumbers,
          sku: item.sku,
        })),
      ];

      setDraftItems((current) => {
        const merged = [...current];
        const indexBySku = new Map(
          merged.map((item, index) => [item.sku.trim().toUpperCase(), index]),
        );
        importedItems.forEach((item) => {
          const key = item.sku.trim().toUpperCase();
          const existingIndex = indexBySku.get(key);
          if (existingIndex == null) {
            indexBySku.set(key, merged.length);
            merged.push(item);
            return;
          }
          const existing = merged[existingIndex];
          const product = existing.product || item.product;
          merged[existingIndex] = {
            ...existing,
            issueReason: product
              ? undefined
              : existing.issueReason || item.issueReason,
            name: product?.name || existing.name || item.name,
            product,
            quantity: Math.min(9999, existing.quantity + item.quantity),
            rowNumbers: [...existing.rowNumbers, ...item.rowNumbers],
          };
        });
        return merged;
      });

      toast({
        message: `${numberLabel(result.analysis.positiveSkuCount)} SKU · ${numberLabel(result.analysis.totalLabelCount)} tem${
          result.analysis.issueItems.length
            ? ` · ${numberLabel(result.analysis.issueItems.length)} SKU cần kiểm tra`
            : ""
        }.`,
        title: result.analysis.issueItems.length
          ? "Đã nạp file, còn mã cần xử lý"
          : "Đã nạp file Excel",
        tone: result.analysis.issueItems.length ? "warning" : "success",
      });
    });
  };

  const selectedItems = draftItems.filter((item) => item.quantity > 0);
  const invalidItems = selectedItems.filter(
    (item) => !item.product || !item.product.barcode.trim(),
  );
  const printableItems = selectedItems.flatMap((item) =>
    item.product?.barcode.trim()
      ? [{ product: item.product, quantity: item.quantity }]
      : [],
  );
  const totalLabels = printableItems.reduce(
    (total, item) => total + item.quantity,
    0,
  );

  return (
    <ModalShell
      kicker={`Kế hoạch in tem · ${data.sheetName}`}
      onClose={onClose}
      title={step === "DATE" ? "Chọn ngày kế hoạch" : "Kiểm tra số lượng tem"}
      wide
    >
      {step === "DATE" ? (
        <>
          <p className={styles.modalHint}>
            Mặc định chọn ngày hôm nay. Bấm lại ngày đang chọn để bỏ chọn và chỉ
            nạp Excel hoặc thêm SKU thủ công. Các SKU trùng dòng trong Sheet đã
            được cộng dồn trước khi hiển thị.
          </p>
          <div className={styles.planDateGrid}>
            {data.dates.map((date) => {
              const selected = date.dateKey === selectedDateKey;
              const today = date.dateKey === data.todayKey;
              return (
                <button
                  aria-label={
                    selected
                      ? `Bỏ chọn kế hoạch ngày ${date.dateLabel}`
                      : `Chọn kế hoạch ngày ${date.dateLabel}`
                  }
                  aria-pressed={selected}
                  className={`${styles.planDateCard} ${
                    selected ? styles.planDateCardSelected : ""
                  } ${today ? styles.planDateCardToday : ""}`}
                  key={date.dateKey}
                  onClick={() =>
                    setSelectedDateKey((current) =>
                      toggleWarehouseProductionPlanDate(current, date.dateKey),
                    )
                  }
                  type="button"
                >
                  <span>
                    <CalendarDays size={17} /> {date.weekday}
                  </span>
                  <strong>{date.dateLabel}</strong>
                  <small>
                    {numberLabel(date.skuCount)} SKU ·{" "}
                    {numberLabel(date.totalQuantity)} tem
                  </small>
                  {today ? <b>Hôm nay</b> : null}
                </button>
              );
            })}
          </div>
          <div className={styles.planSelectionSummary}>
            <span>Nguồn kế hoạch</span>
            <strong>{selectedDate?.dateLabel || "Không chọn ngày"}</strong>
            <b>
              {selectedDate
                ? `${numberLabel(selectedDate.skuCount)} SKU · ${numberLabel(selectedDate.totalQuantity)} tem`
                : "Chỉ nạp Excel / SKU"}
            </b>
          </div>
          <div className={styles.modalActions}>
            <button
              className={styles.secondaryButton}
              onClick={onClose}
              type="button"
            >
              Đóng
            </button>
            <button
              className={styles.primaryButton}
              onClick={startReview}
              type="button"
            >
              {selectedDate ? "Kiểm tra số lượng" : "Tiếp tục không lấy kế hoạch"}
              <ChevronRight size={17} />
            </button>
          </div>
        </>
      ) : (
        <>
          <div className={styles.planReviewHeader}>
            <div>
              <CalendarDays size={18} />
              <span>
                <strong>
                  {selectedDate?.dateLabel || "Không lấy kế hoạch theo ngày"}
                </strong>
                <small>
                  {selectedDate?.weekday || "Nạp Excel hoặc thêm SKU thủ công"}
                </small>
              </span>
            </div>
            <b>{numberLabel(totalLabels)} tem in được</b>
          </div>
          {draftItems.length ? (
            <div className={styles.planItemList}>
              {draftItems.map((item) => {
                const issue = item.issueReason
                  ? stockIssueLabel(item.issueReason)
                  : !item.product
                    ? "Chưa có trong Cấu hình Kho"
                    : !item.product.barcode.trim()
                      ? "SKU chưa có Barcode"
                      : "";
                return (
                  <div className={styles.planItemRow} key={item.sku}>
                    <div className={styles.planItemInfo}>
                      <strong>
                        {item.product?.name || item.name || item.sku}
                      </strong>
                      <span>
                        SKU: {item.product?.sku || item.sku}
                        {item.plannedQuantity > 0
                          ? ` · Kế hoạch ${numberLabel(item.plannedQuantity)}`
                          : " · Thêm ngoài kế hoạch"}
                      </span>
                      {issue ? <small>{issue}</small> : null}
                    </div>
                    <div className={styles.planQuantityControl}>
                      <button
                        aria-label={`Giảm số tem ${item.sku}`}
                        onClick={() =>
                          changeQuantity(item.sku, item.quantity - 1)
                        }
                        type="button"
                      >
                        −
                      </button>
                      <input
                        aria-label={`Số tem ${item.sku}`}
                        max={9999}
                        min={0}
                        onChange={(event) =>
                          changeQuantity(item.sku, Number(event.target.value))
                        }
                        type="number"
                        value={item.quantity}
                      />
                      <button
                        aria-label={`Tăng số tem ${item.sku}`}
                        onClick={() =>
                          changeQuantity(item.sku, item.quantity + 1)
                        }
                        type="button"
                      >
                        +
                      </button>
                    </div>
                    <button
                      aria-label={`Bỏ SKU ${item.sku}`}
                      className={styles.planRemoveButton}
                      onClick={() => removeDraftItem(item.sku)}
                      title="Bỏ khỏi lô in"
                      type="button"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className={styles.planItemEmpty} role="status">
              <FileSpreadsheet size={20} />
              <span>
                <strong>Chưa có SKU trong lô</strong>
                <small>Nạp file Excel hoặc tìm SKU để thêm bên dưới.</small>
              </span>
            </div>
          )}

          <section className={styles.planAddSection}>
            <button
              className={styles.planAddToggle}
              onClick={() => setShowAddProduct((current) => !current)}
              type="button"
            >
              <Plus size={17} />
              {selectedDate
                ? "Thêm mã ngoài kế hoạch"
                : "Nạp Excel hoặc thêm SKU"}
            </button>
            {showAddProduct ? (
              <div className={styles.planExternalPanel}>
                <div className={styles.planExternalActions}>
                  <label className={styles.planFilePicker}>
                    <input
                      accept=".xlsx,.xls,.csv"
                      disabled={importingExcel}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        if (file) importExcelFile(file);
                      }}
                      type="file"
                    />
                    {importingExcel ? (
                      <RefreshCw className={styles.spin} size={17} />
                    ) : (
                      <FileSpreadsheet size={17} />
                    )}
                    {importingExcel ? "Đang nạp Excel..." : "Nạp file Excel"}
                  </label>
                  <small>
                    Tự tìm dòng tiêu đề; nhận Mã hàng/Mã SKU và Số lượng/Số
                    lượng thực tế.
                  </small>
                </div>
                <div className={styles.planProductSearch}>
                  <label>
                    <Search size={17} />
                    <input
                      autoComplete="off"
                      onChange={(event) => setProductQuery(event.target.value)}
                      placeholder="Tìm theo tên, SKU hoặc Barcode..."
                      value={productQuery}
                    />
                    {searching ? (
                      <RefreshCw className={styles.spin} size={15} />
                    ) : null}
                  </label>
                  {productQuery.trim() ? (
                    <div className={styles.planSearchResults}>
                      {productResults.map((product) => (
                        <button
                          key={product.id}
                          onClick={() => addProduct(product)}
                          type="button"
                        >
                          <span>
                            <strong>{product.name || product.sku}</strong>
                            <small>
                              {product.sku} · {product.barcode || "Chưa có Barcode"}
                            </small>
                          </span>
                          <Plus size={16} />
                        </button>
                      ))}
                      {!searching && !productResults.length ? (
                        <p>Không tìm thấy SKU phù hợp.</p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </section>

          {invalidItems.length ? (
            <div className={styles.planIssueNotice}>
              <Tags size={18} />
              <span>
                <strong>{numberLabel(invalidItems.length)} SKU chưa thể in</strong>
                <small>
                  Gán Barcode trong Cấu hình Kho hoặc bỏ các dòng này khỏi lô.
                </small>
              </span>
            </div>
          ) : null}
          <div className={styles.modalActions}>
            <button
              className={styles.secondaryButton}
              onClick={() => setStep("DATE")}
              type="button"
            >
              ← Chọn lại ngày
            </button>
            <button
              className={styles.primaryButton}
              disabled={!printableItems.length || invalidItems.length > 0}
              onClick={() => onApply(printableItems, Boolean(selectedDate))}
              type="button"
            >
              <Printer size={17} /> Mở bản in · {numberLabel(totalLabels)} tem
            </button>
          </div>
        </>
      )}
    </ModalShell>
  );
}

function ProductLabel({
  format,
  product,
}: {
  format: TomyPrintFormat;
  product: WarehouseCatalogProduct;
}) {
  const barcodeValue = product.barcode.trim() || product.sku;
  if (format === "TOMY_148_BARCODE_33") {
    return (
      <article className={styles.productLabel} data-print-format={format}>
        <div className={styles.tomyCenteredContent}>
          <div className={styles.tomyCenteredBarcodeBox}>
            <Code128Barcode value={barcodeValue} />
            <span className={styles.tomyCenteredBarcodeText}>
              {barcodeValue}
            </span>
          </div>
          <div className={styles.tomyCenteredNameBox}>
            <strong className={styles.tomyCenteredProductName}>
              {product.name || product.sku || barcodeValue}
            </strong>
            <span className={styles.tomyCenteredSku}>{product.sku}</span>
          </div>
        </div>
      </article>
    );
  }
  return (
    <article className={styles.productLabel} data-print-format={format}>
      <div aria-hidden="true" className={styles.tomyRfidBox} />
      <strong className={styles.tomyProductName}>
        {product.name || product.sku || barcodeValue}
      </strong>
      <div className={styles.tomyBarcodeBox}>
        <Code128Barcode value={barcodeValue} />
        <span className={styles.tomyBarcodeText}>{barcodeValue}</span>
      </div>
    </article>
  );
}

function PrintModal({
  format,
  items,
  onClose,
  onFormatChange,
  onPrint,
  pending,
}: {
  format: TomyPrintFormat;
  items: Array<{ product: WarehouseCatalogProduct; quantity: number }>;
  onClose: () => void;
  onFormatChange: (format: TomyPrintFormat) => void;
  onPrint: (
    labelCount: number,
    startSlot: number,
    pageCount: number,
    alignSkuRows: boolean,
  ) => void;
  pending: boolean;
}) {
  const layout = TOMY_PRINT_LAYOUTS[format];
  const [startSlotDraft, setStartSlotDraft] = useState("1");
  const [alignSkuRows, setAlignSkuRows] = useState(true);
  useEffect(() => {
    setStartSlotDraft((current) => {
      const value = Number(current);
      if (!Number.isInteger(value) || value < 1) return "1";
      return String(Math.min(value, layout.labelsPerPage));
    });
  }, [layout.labelsPerPage]);
  const labelGroups = items.map(({ product, quantity }) =>
    Array.from(
      { length: Math.max(1, Math.min(quantity, 9999)) },
      (_, index) => ({
        key: `${product.id}-${index}`,
        product,
      }),
    ),
  );
  const startSlotValid = isWarehouseLabelStartSlotValid(format, startSlotDraft);
  const startSlot = startSlotValid ? Number(startSlotDraft) : 1;
  const labels = labelGroups.flat();
  const pages = buildWarehouseGroupedLabelPrintPages(
    labelGroups,
    layout.labelsPerPage,
    layout.columns,
    startSlot,
    alignSkuRows,
  );
  return (
    <ModalShell
      kicker={`Decal ${layout.displayName}`}
      onClose={onClose}
      printRoot
      title={`In ${numberLabel(labels.length)} tem Barcode`}
      wide
    >
      <div className={styles.printOptions}>
        <div>
          <div className={styles.printModalFields}>
            <label className={styles.printModalFormat}>
              <span>Mẫu decal</span>
              <select
                aria-label="Mẫu decal cần in"
                onChange={(event) =>
                  onFormatChange(event.target.value as TomyPrintFormat)
                }
                value={format}
              >
                <option value="TOMY_133_16">Tommy 133 · mặc định</option>
                <option value="TOMY_148_33">Tommy 148</option>
                <option value="TOMY_148_BARCODE_33">
                  Tommy 148 · Tên + SKU + Barcode
                </option>
              </select>
            </label>
            <label className={styles.printStartSlot}>
              <span>Bắt đầu từ ô số</span>
              <input
                aria-describedby="warehouse-print-start-slot-hint"
                aria-invalid={!startSlotValid}
                max={layout.labelsPerPage}
                min={1}
                onChange={(event) => setStartSlotDraft(event.target.value)}
                step={1}
                type="number"
                value={startSlotDraft}
              />
            </label>
            <label className={styles.printRowSortToggle}>
              <input
                checked={alignSkuRows}
                onChange={(event) => setAlignSkuRows(event.target.checked)}
                type="checkbox"
              />
              <span aria-hidden="true" />
              <div>
                <strong>Sắp xếp</strong>
                <small>SKU nhiều tem trước, mã một tem gom cuối</small>
              </div>
            </label>
          </div>
          <strong>
            {layout.displayName} · Layout {layout.layoutVersion}
          </strong>
          <span id="warehouse-print-start-slot-hint">
            {layout.description} · vị trí hợp lệ từ 1 đến {layout.labelsPerPage}
          </span>
        </div>
        <b>{numberLabel(pages.length)} trang</b>
      </div>
      <p className={styles.printHint}>
        {startSlot > 1
          ? `Trang đầu để trống ${numberLabel(startSlot - 1)} ô; tem đầu bắt đầu tại ô ${numberLabel(startSlot)}. `
          : "Tem đầu bắt đầu tại ô 1. "}
        {alignSkuRows
          ? `SKU từ 2 tem được xếp trước theo hàng ${layout.columns} cột; các SKU một tem được gom cuối và in liên tục. `
          : "Đang in liên tục, không chừa ô giữa các SKU. "}
        {format === "TOMY_133_16"
          ? "Lề trên/dưới 5 mm · lề trái/phải 3 mm · khe ngang 2 mm · khe dọc 0 mm."
          : "Lề trái/phải 6 mm · lề trên/dưới 11 mm."}{" "}
        Trong Cài đặt khác chọn A4, Lề: Không, Tỷ lệ: 100% và tắt co giãn theo
        trang.
      </p>
      <div className={styles.printPreviewViewport}>
        <div
          className={styles.printDocument}
          id="warehouse-barcode-print-sheet"
        >
          {pages.map((page, pageIndex) => (
            <section className={styles.printSheet} key={`page-${pageIndex}`}>
              {page.map(({ item: { key, product }, slotIndex }) => {
                const column = slotIndex % layout.columns;
                const row = Math.floor(slotIndex / layout.columns);
                return (
                  <div
                    className={styles.printLabelSlot}
                    key={key}
                    style={{
                      height: `${layout.labelPhysicalHeightMm}mm`,
                      left: `${layout.sheetMarginLeftMm + column * (layout.labelPhysicalWidthMm + layout.horizontalGapMm)}mm`,
                      top: `${layout.sheetMarginTopMm + row * (layout.labelPhysicalHeightMm + layout.verticalGapMm)}mm`,
                      width: `${layout.labelPhysicalWidthMm}mm`,
                    }}
                  >
                    <ProductLabel format={format} product={product} />
                  </div>
                );
              })}
              <span className={styles.pageBadge}>
                Trang {pageIndex + 1}/{pages.length}
              </span>
            </section>
          ))}
        </div>
      </div>
      <div className={`${styles.modalActions} ${styles.printControls}`}>
        <button
          className={styles.secondaryButton}
          onClick={onClose}
          type="button"
        >
          Đóng
        </button>
        <button
          className={styles.primaryButton}
          disabled={!labels.length || pending || !startSlotValid}
          onClick={() =>
            onPrint(labels.length, startSlot, pages.length, alignSkuRows)
          }
          type="button"
        >
          <Printer size={17} />
          Ghi nhận và in
        </button>
      </div>
    </ModalShell>
  );
}

export function WarehouseCatalogWorkspace({
  initialData,
}: {
  initialData: WarehouseCatalogWorkspaceData;
}) {
  const [data, setData] = useState(initialData);
  const [selectedId, setSelectedId] = useState(
    initialData.products[0]?.id || "",
  );
  const [barcodeDraft, setBarcodeDraft] = useState(
    initialData.products[0]?.barcode || "",
  );
  const [quantityDraft, setQuantityDraft] = useState(0);
  const [query, setQuery] = useState(initialData.query);
  const [barcodeFilter, setBarcodeFilter] = useState<BarcodeFilter>(
    initialData.barcodeFilter,
  );
  const [statusFilter, setStatusFilter] = useState(initialData.statusFilter);
  const [printFormat, setPrintFormat] = useState<TomyPrintFormat>(
    DEFAULT_TOMY_PRINT_FORMAT,
  );
  const [printQuantities, setPrintQuantities] = useState<
    Record<string, number>
  >({});
  const [printProductCache, setPrintProductCache] = useState<
    Record<string, WarehouseCatalogProduct>
  >({});
  const [printOrder, setPrintOrder] = useState<string[]>([]);
  const [showImport, setShowImport] = useState(false);
  const [showManualImport, setShowManualImport] = useState(false);
  const [showQuick, setShowQuick] = useState(false);
  const [showStockPrint, setShowStockPrint] = useState(false);
  const [showPrint, setShowPrint] = useState(false);
  const [showProductionPlan, setShowProductionPlan] = useState(false);
  const [productionPlan, setProductionPlan] =
    useState<WarehouseProductionPlanData | null>(null);
  const [deleteHistoryTarget, setDeleteHistoryTarget] =
    useState<WarehouseBarcodePrintHistoryItem | null>(null);
  const [selectedHistoryIds, setSelectedHistoryIds] = useState<Set<string>>(
    new Set(),
  );
  const [showBulkDeleteHistory, setShowBulkDeleteHistory] = useState(false);
  const [lastImport, setLastImport] =
    useState<WarehouseCatalogImportResult | null>(null);
  const [stockPrintAnalysis, setStockPrintAnalysis] =
    useState<WarehouseStockPrintAnalysis | null>(null);
  const [pending, startTransition] = useTransition();
  const [planPending, startPlanTransition] = useTransition();
  const [catalogSearching, startCatalogSearch] = useTransition();
  const skippedInitialCatalogSearch = useRef(false);
  const latestCatalogRequest = useRef("");
  const { toast } = useToast();
  const catalogView: WarehouseCatalogViewInput = {
    barcodeFilter,
    query,
    statusFilter,
  };

  useEffect(() => {
    if (!skippedInitialCatalogSearch.current) {
      skippedInitialCatalogSearch.current = true;
      return;
    }
    const requestKey = `${query.trim()}|${barcodeFilter}|${statusFilter}`;
    latestCatalogRequest.current = requestKey;
    const timer = window.setTimeout(() => {
      startCatalogSearch(async () => {
        const result = await refreshWarehouseCatalogAction({
          barcodeFilter,
          query,
          statusFilter,
        });
        if (latestCatalogRequest.current !== requestKey) return;
        if (!result.ok || !result.data) {
          toast({
            message: result.message,
            title: "Không tải được danh mục Kho",
            tone: "error",
          });
          return;
        }
        const freshData = result.data;
        setData(freshData);
        setSelectedId((current) =>
          freshData.products.some((product) => product.id === current)
            ? current
            : freshData.products[0]?.id || "",
        );
      });
    }, 280);
    return () => window.clearTimeout(timer);
  }, [barcodeFilter, query, statusFilter, toast]);

  const barcodeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    data.products.forEach((product) => {
      if (product.barcode)
        counts.set(product.barcode, (counts.get(product.barcode) ?? 0) + 1);
    });
    return counts;
  }, [data.products]);

  const filteredProducts = data.products;

  const selectedProduct =
    data.products.find((product) => product.id === selectedId) ??
    filteredProducts[0] ??
    null;

  useEffect(() => {
    setBarcodeDraft(selectedProduct?.barcode || "");
    setQuantityDraft(0);
  }, [selectedProduct?.barcode, selectedProduct?.id]);

  const printItems = printOrder.flatMap((productId) => {
    const product =
      printProductCache[productId] ||
      data.products.find((item) => item.id === productId);
    const quantity = printQuantities[productId] ?? 0;
    return product?.barcode && quantity > 0 ? [{ product, quantity }] : [];
  });
  const labelCount = printItems.reduce(
    (total, item) => total + item.quantity,
    0,
  );
  const printLayout = TOMY_PRINT_LAYOUTS[printFormat];
  const printPageCount = Math.ceil(labelCount / printLayout.labelsPerPage);
  const visibleBarcodeProducts = filteredProducts.filter(
    (product) => product.barcode,
  );

  const applyResult = (
    result: WarehouseCatalogActionResult,
    title: string,
    successMessage?: string,
  ) => {
    if (!result.ok || !result.data) {
      toast({
        message: result.message,
        title: "Không hoàn tất được thao tác",
        tone: "error",
      });
      return false;
    }
    setData(result.data);
    const availableHistoryIds = new Set(
      result.data.printHistory.map((item) => item.id),
    );
    setSelectedHistoryIds(
      (current) =>
        new Set([...current].filter((id) => availableHistoryIds.has(id))),
    );
    const refreshedSelection = result.data.products.find(
      (product) => product.id === selectedId,
    );
    if (refreshedSelection) setBarcodeDraft(refreshedSelection.barcode);
    if (result.importResult) setLastImport(result.importResult);
    toast({
      message: successMessage || result.message,
      title,
      tone: result.importResult?.errorCount ? "warning" : "success",
    });
    return true;
  };

  const refresh = () => {
    startTransition(async () => {
      applyResult(
        await refreshWarehouseCatalogAction(catalogView),
        "Dữ liệu đã được làm mới",
      );
    });
  };

  const syncLegacy = () => {
    startTransition(async () => {
      applyResult(
        await syncWarehouseCatalogLegacyAction(catalogView),
        "Đồng bộ Kho thành công",
      );
    });
  };

  const saveBarcode = (addToPrintQueue = false) => {
    if (!selectedProduct) return;
    const productId = selectedProduct.id;
    const productSku = selectedProduct.sku;
    const quantity = Math.max(0, Math.min(999, Math.floor(quantityDraft || 0)));
    if (addToPrintQueue && quantity < 1) {
      toast({
        message: "Nhập số lượng tem lớn hơn 0 trước khi thêm vào lô in.",
        title: "Số lượng tem đang là 0",
        tone: "warning",
      });
      return;
    }
    startTransition(async () => {
      const result = await saveWarehouseBarcodeAction(
        productId,
        barcodeDraft,
        catalogView,
      );
      if (
        applyResult(
          result,
          addToPrintQueue ? "Đã thêm vào lô in" : "Đã lưu mã vạch",
          addToPrintQueue
            ? `Đã lưu Barcode và thêm ${numberLabel(quantity)} tem của SKU ${productSku} vào lô in ${printLayout.displayName}.`
            : undefined,
        ) &&
        addToPrintQueue
      ) {
        setPrintProductCache((current) => ({
          ...current,
          [productId]: { ...selectedProduct, barcode: barcodeDraft.trim() },
        }));
        setPrintQuantities((current) => ({
          ...current,
          [productId]: Math.min(9999, (current[productId] || 0) + quantity),
        }));
        setPrintOrder((current) =>
          current.includes(productId) ? current : [...current, productId],
        );
      }
    });
  };

  const regenerateBarcode = () => {
    if (!selectedProduct) return;
    const productId = selectedProduct.id;
    startTransition(async () => {
      applyResult(
        await regenerateWarehouseBarcodeAction(productId, catalogView),
        "Đã cấp Barcode mới",
      );
    });
  };

  const submitImport = (file: File) => {
    startTransition(async () => {
      const formData = new FormData();
      formData.set("file", file);
      const result = await importWarehouseCatalogAction(formData, catalogView);
      if (
        applyResult(result, "Nạp danh mục hoàn tất") &&
        !result.importResult?.errorCount
      ) {
        setShowImport(false);
      }
    });
  };

  const submitManualImport = (rows: WarehouseCatalogManualRow[]) => {
    startTransition(async () => {
      const result = await importWarehouseCatalogManualAction(rows, catalogView);
      if (
        applyResult(result, "Nạp lẻ hàng hóa hoàn tất") &&
        !result.importResult?.errorCount
      ) {
        setShowManualImport(false);
      }
    });
  };

  const submitQuick = (mappings: WarehouseBarcodeMapping[]) => {
    startTransition(async () => {
      const result = await applyWarehouseBarcodeMappingsAction(
        mappings,
        catalogView,
      );
      if (
        applyResult(result, "Đã nạp Barcode theo SKU") &&
        !result.importResult?.errorCount
      ) {
        setShowQuick(false);
      }
    });
  };

  const submitStockPrint = (file: File) => {
    startTransition(async () => {
      const formData = new FormData();
      formData.set("file", file);
      const result = await analyzeWarehouseStockPrintAction(formData);
      if (!result.ok || !result.analysis) {
        toast({
          message: result.message,
          title: "Không đọc được file",
          tone: "error",
        });
        return;
      }
      setStockPrintAnalysis(result.analysis);
      toast({
        message: result.message,
        title: result.analysis.issueItems.length
          ? "Có mã cần kiểm tra"
          : "File đã sẵn sàng",
        tone: result.analysis.issueItems.length ? "warning" : "success",
      });
    });
  };

  const downloadStockIssues = () => {
    if (!stockPrintAnalysis?.issueItems.length) return;
    const rows = [
      ["Mã hàng", "Tên hàng", "Số lượng", "Lý do", "Dòng trong file"],
      ...stockPrintAnalysis.issueItems.map((item) => [
        item.sku,
        item.name,
        String(item.quantity),
        stockIssueLabel(item.reason),
        item.rowNumbers.join(", "),
      ]),
    ];
    const content = `\uFEFF${rows
      .map((row) => row.map((cell) => csvCell(String(cell ?? ""))).join(","))
      .join("\r\n")}`;
    const url = URL.createObjectURL(
      new Blob([content], { type: "text/csv;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `ma-chua-in-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    toast({
      message: `Đã tải ${numberLabel(stockPrintAnalysis.issueItems.length)} mã chưa in được.`,
      title: "Đã tải mã thiếu",
      tone: "success",
    });
  };

  const printStockIssues = () => {
    if (!stockPrintAnalysis?.issueItems.length) return;
    void runWarehousePrint("stock-report");
  };

  const applyStockPrint = () => {
    if (!stockPrintAnalysis?.printableItems.length) return;
    if (stockPrintAnalysis.printableLabelCount > 5000) {
      toast({
        message:
          "File có hơn 5.000 tem in được. Hãy chia file thành nhiều lượt để trình duyệt không bị treo.",
        title: "Lô in quá lớn",
        tone: "warning",
      });
      return;
    }
    setPrintProductCache((current) => ({
      ...current,
      ...Object.fromEntries(
        stockPrintAnalysis.printableItems.map((item) => [
          item.productId,
          {
            barcode: item.barcode,
            color: "",
            id: item.productId,
            name: item.name,
            purchasePrice: null,
            rfidCount: 0,
            salePrice: null,
            size: "",
            sku: item.sku,
            source: "In nhanh từ file",
            status: "ACTIVE",
            stockTvd: 0,
            stockTvg: 0,
            taxRate: null,
            unit: "",
            updatedAt: new Date().toISOString(),
          } satisfies WarehouseCatalogProduct,
        ]),
      ),
    }));
    setPrintQuantities(
      Object.fromEntries(
        stockPrintAnalysis.printableItems.map((item) => [
          item.productId,
          item.quantity,
        ]),
      ),
    );
    setPrintOrder(
      stockPrintAnalysis.printableItems.map((item) => item.productId),
    );
    setShowStockPrint(false);
    setShowPrint(true);
    toast({
      message: `${numberLabel(stockPrintAnalysis.printableItems.length)} SKU · ${numberLabel(stockPrintAnalysis.printableLabelCount)} tem.`,
      title: "Đã tạo lô in theo tồn",
      tone: "success",
    });
  };

  const openProductionPlan = () => {
    startPlanTransition(async () => {
      const result = await getWarehouseProductionPlanAction();
      if (!result.ok || !result.data) {
        toast({
          message: result.message,
          title: "Không đọc được kế hoạch in tem",
          tone: "error",
        });
        return;
      }
      setProductionPlan(result.data);
      setShowProductionPlan(true);
      toast({
        message: result.message,
        title: "Đã đồng bộ kế hoạch sản xuất",
        tone: "success",
      });
    });
  };

  const applyProductionPlan = (
    items: Array<{ product: WarehouseCatalogProduct; quantity: number }>,
    usedProductionPlan: boolean,
  ) => {
    const total = items.reduce((sum, item) => sum + item.quantity, 0);
    if (!items.length) {
      toast({
        message: "Kế hoạch chưa có SKU đủ Barcode để in.",
        title: "Chưa có tem cần in",
        tone: "warning",
      });
      return;
    }
    if (total > 5000) {
      toast({
        message:
          "Mỗi lệnh in tối đa 5.000 tem. Hãy giảm số lượng hoặc chia thành nhiều lượt.",
        title: "Số tem quá lớn",
        tone: "warning",
      });
      return;
    }
    setPrintProductCache(
      Object.fromEntries(items.map((item) => [item.product.id, item.product])),
    );
    setPrintQuantities(
      Object.fromEntries(items.map((item) => [item.product.id, item.quantity])),
    );
    setPrintOrder(items.map((item) => item.product.id));
    setShowProductionPlan(false);
    setShowPrint(true);
    toast({
      message: `${numberLabel(items.length)} SKU · ${numberLabel(total)} tem.`,
      title: usedProductionPlan
        ? "Đã tạo lô in theo kế hoạch"
        : "Đã tạo lô in từ Excel / SKU",
      tone: "success",
    });
  };

  const togglePrint = (product: WarehouseCatalogProduct) => {
    if (!product.barcode) {
      toast({
        message: `SKU ${product.sku} chưa có mã vạch. Hãy gán Barcode trước khi chọn in.`,
        title: "Chưa thể chọn tem",
        tone: "warning",
      });
      return;
    }
    setPrintProductCache((current) => ({
      ...current,
      [product.id]: product,
    }));
    setPrintQuantities((current) => {
      const next = { ...current };
      if (next[product.id]) delete next[product.id];
      else next[product.id] = 1;
      return next;
    });
    setPrintOrder((current) =>
      current.includes(product.id)
        ? current.filter((productId) => productId !== product.id)
        : [...current, product.id],
    );
  };

  const removePrintItem = (productId: string) => {
    setPrintProductCache((current) => {
      const next = { ...current };
      delete next[productId];
      return next;
    });
    setPrintQuantities((current) => {
      const next = { ...current };
      delete next[productId];
      return next;
    });
    setPrintOrder((current) => current.filter((item) => item !== productId));
  };

  const openPrint = () => {
    if (!printItems.length) {
      toast({
        message: "Chọn ít nhất một SKU đã có Barcode trong danh sách.",
        title: "Chưa có tem cần in",
        tone: "warning",
      });
      return;
    }
    if (labelCount > 5000) {
      toast({
        message:
          "Mỗi lệnh in tối đa 5.000 tem. Hãy giảm số lượng hoặc chia thành nhiều lượt.",
        title: "Số tem quá lớn",
        tone: "warning",
      });
      return;
    }
    setShowPrint(true);
  };

  const printLabels = (
    totalLabels: number,
    startSlot: number,
    pageCount: number,
    alignSkuRows: boolean,
  ) => {
    startTransition(async () => {
      const result = await recordWarehouseLabelPrintAction(
        {
          format: printFormat,
          labelCount: totalLabels,
          productCount: printItems.length,
          productIds: printItems.map((item) => item.product.id),
          startSlot,
          pageCount,
          alignSkuRows,
        },
        catalogView,
      );
      if (applyResult(result, "Phiếu dán đã sẵn sàng")) {
        window.setTimeout(() => {
          void runWarehousePrint("labels");
        }, 180);
      }
    });
  };

  const deletePrintHistory = () => {
    if (!deleteHistoryTarget) return;
    startTransition(async () => {
      const result = await deleteWarehouseLabelPrintHistoryAction(
        deleteHistoryTarget.id,
        catalogView,
      );
      if (applyResult(result, "Đã xóa lịch sử in")) {
        setDeleteHistoryTarget(null);
      }
    });
  };

  const allHistorySelected =
    data.printHistory.length > 0 &&
    data.printHistory.every((item) => selectedHistoryIds.has(item.id));

  const toggleAllPrintHistory = () => {
    setSelectedHistoryIds(
      allHistorySelected
        ? new Set()
        : new Set(data.printHistory.map((item) => item.id)),
    );
  };

  const togglePrintHistory = (historyId: string) => {
    setSelectedHistoryIds((current) => {
      const next = new Set(current);
      if (next.has(historyId)) next.delete(historyId);
      else next.add(historyId);
      return next;
    });
  };

  const deleteSelectedPrintHistory = () => {
    const historyIds = [...selectedHistoryIds];
    if (!historyIds.length) return;
    startTransition(async () => {
      const result = await deleteWarehouseLabelPrintHistoriesAction(
        historyIds,
        catalogView,
      );
      if (applyResult(result, "Đã dọn lịch sử in")) {
        setSelectedHistoryIds(new Set());
        setShowBulkDeleteHistory(false);
      }
    });
  };

  const downloadTemplate = () => {
    startTransition(async () => {
      const result = await downloadWarehouseCatalogTemplateAction();
      if (!result.ok) {
        toast({
          title: "Không tải được file mẫu",
          message: result.message,
          tone: "error",
        });
        return;
      }
      const rows = [
        [
          "Mã SKU",
          "Mã vạch",
          "Tên hàng hóa",
          "ĐVT",
          "Màu",
          "Kích thước",
          "Giá mua",
          "Giá bán",
          "Thuế suất (%)",
        ],
        ...result.rows.map((product) => [
          product.sku,
          product.barcode || "",
          product.name,
          "",
          "",
          "",
          "",
          "",
          "",
        ]),
      ];
      const content = `\uFEFFsep=,\r\n${rows
        .map((row) => row.map(csvCell).join(","))
        .join("\r\n")}`;
      const url = URL.createObjectURL(
        new Blob([content], { type: "text/csv;charset=utf-8" }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "mau-nap-barcode-theo-sku.csv";
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
      toast({
        title: "Đã tải file mẫu",
        message: result.message,
        tone: "success",
      });
    });
  };

  const allVisibleSelected =
    visibleBarcodeProducts.length > 0 &&
    visibleBarcodeProducts.every((product) => printQuantities[product.id]);

  return (
    <div className={styles.workspace}>
      <WriteLoadingOverlay
        message="Dữ liệu Kho đang được ghi vào hệ thống..."
        show={pending && !showImport && !showManualImport && !showStockPrint}
      />
      <WriteLoadingOverlay
        message="Đang đọc kế hoạch sản xuất từ Google Sheet..."
        show={planPending}
      />

      <section className={styles.summaryBar}>
        <div>
          <Database size={20} />
          <span>
            <strong>{numberLabel(data.summary.totalProducts)}</strong> SKU
          </span>
        </div>
        <div>
          <Barcode size={20} />
          <span>
            <strong>{numberLabel(data.summary.mappedBarcodes)}</strong> đã có
            Barcode
          </span>
        </div>
        <div
          className={data.summary.missingBarcodes ? styles.summaryWarning : ""}
        >
          <Tags size={20} />
          <span>
            <strong>{numberLabel(data.summary.missingBarcodes)}</strong> còn
            thiếu mã
          </span>
        </div>
        <div>
          <PackageCheck size={20} />
          <span>
            <strong>{numberLabel(data.summary.activeProducts)}</strong> đang
            dùng
          </span>
        </div>
        <button
          className={styles.syncButton}
          onClick={syncLegacy}
          type="button"
        >
          <Server size={17} /> Đồng bộ Sheet cũ
        </button>
      </section>

      <section className={styles.toolbar}>
        <label className={styles.searchBox}>
          <Search size={18} />
          <input
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Tìm SKU, Barcode, tên hàng hóa, màu, size..."
            value={query}
          />
        </label>
        <select
          aria-label="Lọc mã vạch"
          onChange={(event) =>
            setBarcodeFilter(event.target.value as BarcodeFilter)
          }
          value={barcodeFilter}
        >
          <option value="ALL">Tất cả Barcode</option>
          <option value="MAPPED">Đã có Barcode</option>
          <option value="MISSING">Chưa có Barcode</option>
          <option value="DUPLICATE">Barcode bị trùng</option>
        </select>
        <select
          aria-label="Lọc trạng thái"
          onChange={(event) =>
            setStatusFilter(
              event.target
                .value as WarehouseCatalogWorkspaceData["statusFilter"],
            )
          }
          value={statusFilter}
        >
          <option value="ALL">Mọi trạng thái</option>
          <option value="ACTIVE">Đang dùng</option>
          <option value="INACTIVE">Ngưng dùng</option>
        </select>
        <button
          className={styles.iconButton}
          onClick={refresh}
          title="Tải lại"
          type="button"
        >
          <RefreshCw size={19} />
        </button>
      </section>

      <section className={styles.actionBar}>
        <div>
          <button
            className={styles.secondaryButton}
            onClick={() => {
              setLastImport(null);
              setShowQuick(true);
            }}
            type="button"
          >
            <Barcode size={17} /> Nạp nhanh SKU–Barcode
          </button>
          <button
            className={styles.secondaryButton}
            onClick={() => {
              setLastImport(null);
              setShowImport(true);
            }}
            type="button"
          >
            <Upload size={17} /> Nạp hàng hóa
          </button>
          <button
            className={styles.secondaryButton}
            onClick={() => {
              setLastImport(null);
              setShowManualImport(true);
            }}
            title="Nạp lẻ một vài SKU và tự sinh Barcode"
            type="button"
          >
            <Plus size={17} /> Nạp lẻ SKU
          </button>
          <button
            className={styles.secondaryButton}
            onClick={() => {
              setStockPrintAnalysis(null);
              setShowStockPrint(true);
            }}
            type="button"
          >
            <FileSpreadsheet size={17} /> In nhanh từ file
          </button>
          <button
            className={styles.ghostButton}
            onClick={downloadTemplate}
            type="button"
          >
            <Download size={17} /> Tải file mẫu
          </button>
        </div>
        <div className={styles.printBatchSummary}>
          <span>Lô in {printLayout.displayName}</span>
          <strong>
            {numberLabel(printItems.length)} SKU · {numberLabel(labelCount)} tem
            · {numberLabel(printPageCount)} trang
          </strong>
        </div>
      </section>

      {lastImport ? (
        <div className={styles.lastResult}>
          <div>
            <CheckCircle2 size={19} />
            <span>
              Kết quả gần nhất: {lastImport.updatedCount} cập nhật,{" "}
              {lastImport.createdCount} thêm mới
              {lastImport.generatedBarcodeCount
                ? `, ${lastImport.generatedBarcodeCount} Barcode tự sinh`
                : ""}
              {lastImport.errorCount
                ? `, ${lastImport.errorCount} dòng cần kiểm tra`
                : ""}
              .
            </span>
          </div>
          <button
            aria-label="Ẩn kết quả"
            onClick={() => setLastImport(null)}
            type="button"
          >
            <X size={17} />
          </button>
        </div>
      ) : null}

      <div className={styles.shell}>
        <section className={styles.catalogPanel}>
          <div className={styles.catalogHeader}>
            <div>
              <strong>Danh mục hàng hóa</strong>
              <span
                title={
                  data.hasMoreProducts
                    ? `Đang hiển thị ${numberLabel(data.products.length)} kết quả đầu tiên. Dùng ô tìm kiếm để tra toàn bộ danh mục.`
                    : undefined
                }
              >
                {catalogSearching
                  ? "Đang tìm..."
                  : `${numberLabel(data.resultCount)} kết quả`}
              </span>
            </div>
            <label>
              <input
                checked={allVisibleSelected}
                onChange={() => {
                  const printableIds = filteredProducts
                    .filter((product) => product.barcode)
                    .map((product) => product.id);
                  setPrintProductCache((current) => {
                    const next = { ...current };
                    filteredProducts
                      .filter((product) => product.barcode)
                      .forEach((product) => {
                        if (allVisibleSelected) delete next[product.id];
                        else next[product.id] = product;
                      });
                    return next;
                  });
                  setPrintQuantities((current) => {
                    const next = { ...current };
                    printableIds.forEach((productId) => {
                      if (allVisibleSelected) delete next[productId];
                      else next[productId] = Math.max(1, next[productId] || 1);
                    });
                    return next;
                  });
                  setPrintOrder((current) =>
                    allVisibleSelected
                      ? current.filter(
                          (productId) => !printableIds.includes(productId),
                        )
                      : [
                          ...current,
                          ...printableIds.filter(
                            (productId) => !current.includes(productId),
                          ),
                        ],
                  );
                }}
                type="checkbox"
              />
              Chọn các SKU đang lọc
            </label>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th aria-label="Chọn in" />
                  <th>SKU / Hàng hóa</th>
                  <th>Barcode</th>
                  <th>Tồn kho</th>
                  <th>RFID</th>
                  <th aria-label="Mở chi tiết" />
                </tr>
              </thead>
              <tbody>
                {filteredProducts.map((product) => {
                  const active = selectedProduct?.id === product.id;
                  const duplicate =
                    product.barcode &&
                    (barcodeCounts.get(product.barcode) ?? 0) > 1;
                  return (
                    <tr
                      className={active ? styles.rowActive : ""}
                      key={product.id}
                      onClick={() => {
                        setSelectedId(product.id);
                        setBarcodeDraft(product.barcode);
                        setQuantityDraft(printQuantities[product.id] || 1);
                      }}
                    >
                      <td>
                        <input
                          aria-label={`Chọn in ${product.sku}`}
                          checked={Boolean(printQuantities[product.id])}
                          disabled={!product.barcode}
                          onChange={() => togglePrint(product)}
                          onClick={(event) => event.stopPropagation()}
                          type="checkbox"
                        />
                      </td>
                      <td>
                        <strong>{product.sku}</strong>
                        <span>{product.name}</span>
                        <small>
                          {[product.color, product.size, product.unit]
                            .filter(Boolean)
                            .join(" · ")}
                        </small>
                      </td>
                      <td>
                        {product.barcode ? (
                          <code
                            className={duplicate ? styles.duplicateBarcode : ""}
                          >
                            {product.barcode}
                          </code>
                        ) : (
                          <span className={styles.missingBarcode}>
                            Chưa nạp
                          </span>
                        )}
                      </td>
                      <td>
                        <strong>
                          {numberLabel(product.stockTvg + product.stockTvd)}
                        </strong>
                        <small>
                          TVG {product.stockTvg} · TVD {product.stockTvd}
                        </small>
                      </td>
                      <td>{numberLabel(product.rfidCount)}</td>
                      <td>
                        <ChevronRight size={17} />
                      </td>
                    </tr>
                  );
                })}
                {!filteredProducts.length ? (
                  <tr>
                    <td className={styles.emptyTable} colSpan={6}>
                      Không có SKU phù hợp bộ lọc hiện tại.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <aside className={styles.detailPanel}>
          {selectedProduct ? (
            <>
              <div className={styles.detailTitle}>
                <span
                  className={
                    isActiveStatus(selectedProduct.status)
                      ? styles.activeDot
                      : styles.inactiveDot
                  }
                />
                <div>
                  <strong>{selectedProduct.sku}</strong>
                  <span>{selectedProduct.status}</span>
                </div>
                <button
                  aria-label="Lấy lô tem theo ngày kế hoạch sản xuất"
                  className={styles.productionPlanButton}
                  disabled={planPending}
                  onClick={openProductionPlan}
                  title="Lấy mã hàng loạt từ Sheet KeHoach_Xuong"
                  type="button"
                >
                  {planPending ? (
                    <RefreshCw className={styles.spin} size={18} />
                  ) : (
                    <Plus size={19} />
                  )}
                </button>
              </div>
              <h2>{selectedProduct.name}</h2>
              <div className={styles.productMeta}>
                <span>
                  ĐVT <strong>{selectedProduct.unit || "—"}</strong>
                </span>
                <span>
                  Màu <strong>{selectedProduct.color || "—"}</strong>
                </span>
                <span>
                  Size <strong>{selectedProduct.size || "—"}</strong>
                </span>
                <span>
                  Giá bán{" "}
                  <strong>
                    {moneyLabel(selectedProduct.salePrice) || "—"}
                  </strong>
                </span>
              </div>
              <label className={styles.barcodeField}>
                <span>Mã Barcode theo SKU</span>
                <div>
                  <Barcode size={19} />
                  <input
                    autoComplete="off"
                    onChange={(event) => setBarcodeDraft(event.target.value)}
                    placeholder="Quét hoặc nhập mã Barcode"
                    value={barcodeDraft}
                  />
                  <button
                    aria-label={`Tự cấp Barcode mới cho SKU ${selectedProduct.sku}`}
                    className={styles.regenerateBarcodeButton}
                    disabled={pending}
                    onClick={regenerateBarcode}
                    title="Tự tìm Barcode không trùng và lưu đè"
                    type="button"
                  >
                    <Pencil size={16} />
                  </button>
                </div>
                <small>
                  Chấp nhận số hoặc chữ; bấm biểu tượng bút để tự cấp một mã mới
                  không trùng và lưu ngay.
                </small>
              </label>
              {barcodeDraft.trim() ? (
                <div className={styles.singlePreview}>
                  <Code128Barcode value={barcodeDraft.trim()} />
                  <code>{barcodeDraft.trim()}</code>
                </div>
              ) : (
                <div className={styles.previewEmpty}>
                  <Barcode size={24} /> Chưa có Barcode để xem trước.
                </div>
              )}
              <div className={styles.quantityBox}>
                <div>
                  <Printer size={17} />
                  <strong>Số lượng tem</strong>
                </div>
                <div>
                  <button
                    onClick={() =>
                      setQuantityDraft((current) => Math.max(0, current - 1))
                    }
                    type="button"
                  >
                    −
                  </button>
                  <input
                    aria-label="Số lượng tem"
                    min={0}
                    max={999}
                    onChange={(event) =>
                      setQuantityDraft(
                        Math.max(
                          0,
                          Math.min(
                            999,
                            Math.floor(Number(event.target.value) || 0),
                          ),
                        ),
                      )
                    }
                    type="number"
                    value={quantityDraft}
                  />
                  <button
                    onClick={() =>
                      setQuantityDraft((current) => Math.min(999, current + 1))
                    }
                    type="button"
                  >
                    +
                  </button>
                </div>
              </div>
              <div className={styles.saveActions}>
                <button
                  className={styles.saveButton}
                  disabled={pending}
                  onClick={() => saveBarcode(false)}
                  type="button"
                >
                  <Save size={17} /> Chỉ lưu mã vạch
                </button>
                <button
                  className={styles.addPrintButton}
                  disabled={
                    pending || !barcodeDraft.trim() || quantityDraft < 1
                  }
                  onClick={() => saveBarcode(true)}
                  type="button"
                >
                  <Printer size={17} /> Lưu và thêm vào lô in
                </button>
              </div>

              <section className={styles.printQueuePanel}>
                <div className={styles.printQueueHeader}>
                  <div>
                    <span>Bước 2</span>
                    <strong>Lô in decal {printLayout.displayName}</strong>
                  </div>
                  <b>{numberLabel(labelCount)} tem</b>
                </div>
                {printItems.length ? (
                  <div className={styles.printQueue}>
                    {printItems.map(({ product, quantity }) => (
                      <div className={styles.printQueueRow} key={product.id}>
                        <div>
                          <strong>{product.name || product.sku}</strong>
                          <span>
                            SKU: {product.sku} · Mã in: {product.barcode}
                          </span>
                        </div>
                        <span className={styles.printQueueQuantity}>
                          ×{numberLabel(quantity)}
                        </span>
                        <button
                          aria-label={`Bỏ ${product.sku} khỏi lô in`}
                          onClick={() => removePrintItem(product.id)}
                          title="Bỏ khỏi lô in"
                          type="button"
                        >
                          <X size={15} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className={styles.printQueueEmpty}>
                    Chọn SKU, nhập số lượng rồi bấm “Lưu và thêm vào lô in”.
                  </div>
                )}
                <button
                  className={styles.queuePrintButton}
                  disabled={!printItems.length}
                  onClick={openPrint}
                  type="button"
                >
                  <Printer size={17} /> Tạo bản in ·{" "}
                  {numberLabel(printPageCount)} trang A4
                </button>
              </section>
            </>
          ) : (
            <div className={styles.detailEmpty}>
              Chọn một SKU để xem và hiệu đính Barcode.
            </div>
          )}

          <section className={styles.historyBlock}>
            <div className={styles.historyTitle}>
              <div>
                <History size={17} />
                <strong>Lịch sử in gần đây</strong>
              </div>
              {data.printHistory.length ? (
                <div className={styles.historyBulkActions}>
                  <label>
                    <input
                      checked={allHistorySelected}
                      onChange={toggleAllPrintHistory}
                      type="checkbox"
                    />
                    Chọn toàn bộ
                  </label>
                  <button
                    disabled={!selectedHistoryIds.size || pending}
                    onClick={() => setShowBulkDeleteHistory(true)}
                    type="button"
                  >
                    <Trash2 size={14} />
                    Xóa {selectedHistoryIds.size || ""}
                  </button>
                </div>
              ) : null}
            </div>
            {data.printHistory.length ? (
              <div className={styles.historyList}>
                {data.printHistory.map((item) => (
                  <div className={styles.historyRow} key={item.id}>
                    <input
                      aria-label={`Chọn lịch sử in ${numberLabel(item.labelCount)} tem`}
                      checked={selectedHistoryIds.has(item.id)}
                      className={styles.historyCheckbox}
                      onChange={() => togglePrintHistory(item.id)}
                      type="checkbox"
                    />
                    <span className={styles.historyIcon}>
                      <Printer size={15} />
                    </span>
                    <div>
                      <strong>
                        {numberLabel(item.labelCount)} tem ·{" "}
                        {numberLabel(item.productCount)} SKU
                      </strong>
                      <span>
                        {printFormatLabel(item.format)} · {item.actorName} · bắt
                        đầu ô {numberLabel(item.startSlot)} ·{" "}
                        {dateTimeLabel(item.createdAt)}
                      </span>
                    </div>
                    <button
                      aria-label={`Xóa lịch sử in ${numberLabel(item.labelCount)} tem`}
                      onClick={() => setDeleteHistoryTarget(item)}
                      title="Xóa lịch sử in"
                      type="button"
                    >
                      <X size={15} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className={styles.historyEmpty}>
                <Clock3 size={16} /> Chưa có lịch sử in tem.
              </div>
            )}
          </section>
        </aside>
      </div>

      {showImport ? (
        <ImportModal
          onClose={() => setShowImport(false)}
          onSubmit={submitImport}
          pending={pending}
          result={lastImport}
        />
      ) : null}
      {showManualImport ? (
        <ManualCatalogImportModal
          onClose={() => setShowManualImport(false)}
          onSubmit={submitManualImport}
          pending={pending}
          result={lastImport}
        />
      ) : null}
      {showQuick ? (
        <QuickMappingModal
          onClose={() => setShowQuick(false)}
          onSubmit={submitQuick}
          pending={pending}
          result={lastImport}
        />
      ) : null}
      {showStockPrint ? (
        <StockPrintModal
          analysis={stockPrintAnalysis}
          onAnalyze={submitStockPrint}
          onApply={applyStockPrint}
          onClose={() => setShowStockPrint(false)}
          onDownload={downloadStockIssues}
          onPrintIssues={printStockIssues}
          onReset={() => setStockPrintAnalysis(null)}
          pending={pending}
        />
      ) : null}
      {showProductionPlan && productionPlan ? (
        <ProductionPlanModal
          data={productionPlan}
          onApply={applyProductionPlan}
          onClose={() => setShowProductionPlan(false)}
        />
      ) : null}
      {showPrint ? (
        <PrintModal
          format={printFormat}
          items={printItems}
          onClose={() => setShowPrint(false)}
          onFormatChange={setPrintFormat}
          onPrint={printLabels}
          pending={pending}
        />
      ) : null}
      {deleteHistoryTarget ? (
        <DeletePrintHistoryModal
          item={deleteHistoryTarget}
          onClose={() => setDeleteHistoryTarget(null)}
          onConfirm={deletePrintHistory}
          pending={pending}
        />
      ) : null}
      {showBulkDeleteHistory && selectedHistoryIds.size ? (
        <BulkDeletePrintHistoryModal
          count={selectedHistoryIds.size}
          onClose={() => setShowBulkDeleteHistory(false)}
          onConfirm={deleteSelectedPrintHistory}
          pending={pending}
        />
      ) : null}
    </div>
  );
}
