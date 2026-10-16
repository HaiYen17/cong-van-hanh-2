"use client";

import {
  AlertTriangle,
  Barcode,
  Boxes,
  CalendarDays,
  Check,
  CheckCircle2,
  CircleOff,
  ClipboardCheck,
  Copy,
  Database,
  FileJson,
  GitCompareArrows,
  Minus,
  PackageCheck,
  Pencil,
  Printer,
  Plus,
  Radio,
  RefreshCw,
  ScanLine,
  Search,
  Server,
  Tags,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import { useToast, WriteLoadingOverlay } from "@/components/ui/toast";
import type {
  WarehouseInventoryActionResult,
  WarehouseInventoryDetail,
  WarehouseInventoryPairComparisonData,
  WarehouseInventoryProductOption,
  WarehouseInventorySessionItem,
  WarehouseInventoryWorkspaceData,
} from "@/lib/warehouse/types";

import {
  cancelWarehouseInventoryRfidsAction,
  compareWarehouseInventorySessionsAction,
  defineWarehouseInventoryRfidsAction,
  deleteWarehouseInventoryLinkedAfterRedefinitionAction,
  deleteWarehouseInventorySessionAction,
  deleteWarehouseInventorySessionsBulkAction,
  mergeWarehouseInventorySessionsAction,
  reassignWarehouseInventoryRfidsAction,
  refreshWarehouseInventoryAction,
  removeWarehouseInventorySessionRfidsAction,
  searchWarehouseInventoryProductsAction,
  submitWarehouseJsonAction,
  syncWarehouseMasterAction,
} from "./actions";
import {
  openWarehouseInventoryComparisonPrint,
  openWarehouseInventoryStatementPrint,
  type WarehouseInventoryPrintKind,
} from "./inventory-print";
import styles from "./warehouse-inventory.module.css";

type TabKey = "sku" | "rfid" | "define" | "redefine" | "json";
type SessionTimeFilter = "ALL" | "TODAY" | "WEEK" | "MONTH" | "CUSTOM";

const SESSION_TIME_FILTERS: Array<{
  key: SessionTimeFilter;
  label: string;
}> = [
  { key: "ALL", label: "Tất cả" },
  { key: "TODAY", label: "Hôm nay" },
  { key: "WEEK", label: "Tuần này" },
  { key: "MONTH", label: "Tháng này" },
  { key: "CUSTOM", label: "Chọn ngày" },
];

const STATUS_LABELS: Record<string, string> = {
  CONFIRMED: "Đã xác nhận",
  FAILED: "Lỗi xử lý",
  PARTIAL: "Còn RFID chưa nhận diện",
  PENDING: "Đang chờ",
  RECEIVED: "Đã nhận JSON",
  SUCCESS: "Đã nhận diện",
};

function statusLabel(value: string) {
  return STATUS_LABELS[value] || value || "Đã nhận";
}

function statusTone(value: string) {
  if (value === "CONFIRMED" || value === "SUCCESS") return styles.statusGood;
  if (value === "FAILED") return styles.statusBad;
  return styles.statusWarn;
}

function dateLabel(value: string) {
  const [year, month, day] = value.split("-");
  return day && month && year ? `${day}/${month}/${year}` : value;
}

function timeLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "—";
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function numberLabel(value: number) {
  return new Intl.NumberFormat("vi-VN").format(value);
}

function signedNumberLabel(value: number) {
  return value > 0 ? `+${numberLabel(value)}` : numberLabel(value);
}

function localDateValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function shiftedDateValue(date: Date, dayOffset: number) {
  const shifted = new Date(date);
  shifted.setDate(shifted.getDate() + dayOffset);
  return localDateValue(shifted);
}

function normalizedSessionDate(value: string) {
  const trimmed = value.trim();
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

  const vietnameseMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (vietnameseMatch) {
    return `${vietnameseMatch[3]}-${vietnameseMatch[2].padStart(2, "0")}-${vietnameseMatch[1].padStart(2, "0")}`;
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? "" : localDateValue(parsed);
}

function sessionSortValue(item: WarehouseInventorySessionItem) {
  const updatedAt = new Date(item.updatedAt).getTime();
  if (!Number.isNaN(updatedAt)) return updatedAt;
  const scanDate = new Date(`${item.scanDate}T00:00:00`).getTime();
  return Number.isNaN(scanDate) ? 0 : scanDate;
}

function SessionCard({
  active,
  bulkSelected,
  comparisonIndex,
  item,
  onDelete,
  onSelect,
  onToggleBulk,
  onToggleComparison,
}: {
  active: boolean;
  bulkSelected: boolean;
  comparisonIndex: 0 | 1 | 2;
  item: WarehouseInventorySessionItem;
  onDelete: () => void;
  onSelect: () => void;
  onToggleBulk: () => void;
  onToggleComparison: () => void;
}) {
  return (
    <div className={styles.sessionCardShell}>
      <button
        className={`${styles.sessionCard} ${active ? styles.sessionCardActive : ""} ${comparisonIndex ? styles.sessionCardCompared : ""}`}
        onClick={onSelect}
        type="button"
      >
        <div className={styles.sessionCardTop}>
          <span
            aria-label={statusLabel(item.processStatus)}
            className={`${styles.sessionStatusDot} ${statusTone(item.processStatus)}`}
            role="img"
            title={statusLabel(item.processStatus)}
          />
          <span className={styles.sessionDate}>{dateLabel(item.scanDate)}</span>
        </div>
        <strong>{item.sessionKey}</strong>
        <div className={styles.sessionMeta}>
          <span>{numberLabel(item.summary.uniqueRfidCount)} RFID</span>
          <span>·</span>
          <span>{numberLabel(item.summary.physicalSkuCount)} SKU</span>
          {item.linkedSessionCount ? (
            <>
              <span>·</span>
              <span>{numberLabel(item.linkedSessionCount)} liên kết</span>
            </>
          ) : null}
        </div>
        <div className={styles.sessionPlace}>
          {item.operatorName || item.deviceName || "Chưa ghi người kiểm kê"}
        </div>
      </button>
      <button
        aria-label={
          bulkSelected
            ? `Bỏ chọn hàng loạt phiên ${item.sessionKey}`
            : `Chọn hàng loạt phiên ${item.sessionKey}`
        }
        aria-pressed={bulkSelected}
        className={`${styles.sessionBulkCheckbox} ${
          bulkSelected ? styles.sessionBulkCheckboxSelected : ""
        }`}
        onClick={onToggleBulk}
        title="Chọn cho thao tác hàng loạt"
        type="button"
      >
        {bulkSelected ? <Check size={14} /> : null}
      </button>
      <button
        aria-label={
          comparisonIndex
            ? `Bỏ phiên ${item.sessionKey} khỏi so sánh`
            : `Chọn phiên ${item.sessionKey} để so sánh`
        }
        aria-pressed={Boolean(comparisonIndex)}
        className={`${styles.sessionCompareButton} ${
          comparisonIndex === 1
            ? styles.sessionCompareInput
            : comparisonIndex === 2
              ? styles.sessionCompareOutput
              : ""
        }`}
        onClick={onToggleComparison}
        title={
          comparisonIndex === 1
            ? "Phiên số 1 · Đầu vào"
            : comparisonIndex === 2
              ? "Phiên số 2 · Đầu ra"
              : "Chọn để so sánh"
        }
        type="button"
      >
        {comparisonIndex || <GitCompareArrows size={14} />}
      </button>
      <button
        aria-label={`Xóa phiên ${item.sessionKey}`}
        className={styles.sessionDeleteButton}
        onClick={onDelete}
        title="Xóa phiên kiểm kê"
        type="button"
      >
        <X size={15} />
      </button>
    </div>
  );
}

function InventoryBulkActions({
  allFilteredSelected,
  filteredCount,
  onDelete,
  onMerge,
  onToggleAll,
  pending,
  selectedCount,
}: {
  allFilteredSelected: boolean;
  filteredCount: number;
  onDelete: () => void;
  onMerge: () => void;
  onToggleAll: () => void;
  pending: boolean;
  selectedCount: number;
}) {
  return (
    <section className={styles.bulkActionsPanel}>
      <button
        aria-pressed={allFilteredSelected}
        className={styles.bulkSelectAllButton}
        disabled={!filteredCount || pending}
        onClick={onToggleAll}
        type="button"
      >
        <span
          className={`${styles.bulkSelectIndicator} ${
            allFilteredSelected ? styles.bulkSelectIndicatorActive : ""
          }`}
        >
          {allFilteredSelected ? <Check size={13} /> : null}
        </span>
        {allFilteredSelected ? "Bỏ chọn đang lọc" : "Chọn tất cả đang lọc"}
      </button>
      <div className={styles.bulkSelectionSummary}>
        <strong>{numberLabel(selectedCount)}</strong>
        <span>phiên đã chọn</span>
      </div>
      <div className={styles.bulkActionButtons}>
        <button
          className={styles.bulkMergeButton}
          disabled={selectedCount < 2 || pending}
          onClick={onMerge}
          type="button"
        >
          <Boxes size={15} />
          Ghép phiên
        </button>
        <button
          className={styles.bulkDeleteButton}
          disabled={!selectedCount || pending}
          onClick={onDelete}
          title="Chỉ Super Admin được thực hiện"
          type="button"
        >
          <Trash2 size={15} />
          Xóa hàng loạt
        </button>
      </div>
      <small>
        Xóa hàng loạt chỉ dành cho Super Admin và luôn yêu cầu mật khẩu.
      </small>
    </section>
  );
}

function InventoryComparisonPicker({
  onClear,
  onCompare,
  pending,
  sessions,
}: {
  onClear: () => void;
  onCompare: () => void;
  pending: boolean;
  sessions: WarehouseInventorySessionItem[];
}) {
  return (
    <section className={styles.comparisonPicker}>
      <div className={styles.comparisonPickerTitle}>
        <GitCompareArrows size={17} />
        <div>
          <strong>So sánh 2 kiểm kê</strong>
          <span>Chọn lần lượt đầu vào rồi đầu ra</span>
        </div>
      </div>
      <div className={styles.comparisonSlots}>
        {[0, 1].map((index) => {
          const item = sessions[index];
          return (
            <div
              className={`${styles.comparisonSlot} ${
                item ? styles.comparisonSlotSelected : ""
              }`}
              key={index}
            >
              <b>{index + 1}</b>
              <span>
                <strong>{index === 0 ? "Đầu vào" : "Đầu ra"}</strong>
                <small>
                  {item
                    ? `${item.sessionKey} · ${dateLabel(item.scanDate)}`
                    : "Chưa chọn phiên"}
                </small>
              </span>
            </div>
          );
        })}
      </div>
      <div className={styles.comparisonPickerActions}>
        <button
          className={styles.comparisonClearButton}
          disabled={!sessions.length || pending}
          onClick={onClear}
          type="button"
        >
          Bỏ chọn
        </button>
        <button
          className={styles.comparisonRunButton}
          disabled={sessions.length !== 2 || pending}
          onClick={onCompare}
          type="button"
        >
          <GitCompareArrows size={15} />
          So sánh
        </button>
      </div>
    </section>
  );
}

function SummaryCard({
  icon,
  label,
  tone,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  tone?: "good" | "warn" | "bad";
  value: number;
}) {
  return (
    <div
      className={`${styles.summaryCard} ${
        tone === "good"
          ? styles.summaryGood
          : tone === "bad"
            ? styles.summaryBad
            : tone === "warn"
              ? styles.summaryWarn
              : ""
      }`}
    >
      <div className={styles.summaryIcon}>{icon}</div>
      <div>
        <strong>{numberLabel(value)}</strong>
        <span>{label}</span>
      </div>
    </div>
  );
}

function EmptyDetail() {
  return (
    <div className={styles.emptyState}>
      <div className={styles.emptyIcon}>
        <ScanLine size={30} />
      </div>
      <h2>Chưa có phiên kiểm kê</h2>
      <p>
        Khi máy RFID gửi JSON thành công, hệ thống sẽ tự chuyển từng RFID thành
        SKU và hiển thị số lượng đã quét tại đây.
      </p>
    </div>
  );
}

function SkuTable({ detail }: { detail: WarehouseInventoryDetail }) {
  const lines = detail.comparison.filter((line) => line.physicalQuantity > 0);
  return (
    <>
      <div className={styles.tableHeading}>
        <div>
          <strong>Bảng số lượng SKU đã kiểm kê</strong>
          <span>Mỗi RFID chỉ được tính một lần trong cùng phiên quét.</span>
        </div>
        <span>{numberLabel(lines.length)} SKU</span>
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.indexColumn}>STT</th>
              <th>Mã SKU</th>
              <th>Tên SKU</th>
              <th className={styles.numeric}>Số lượng đã quét</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => (
              <tr key={line.sku}>
                <td className={styles.indexColumn}>{index + 1}</td>
                <td>
                  <strong>{line.sku}</strong>
                </td>
                <td>{line.name || "Chưa có tên SKU"}</td>
                <td className={`${styles.numeric} ${styles.quantityCell}`}>
                  {numberLabel(line.physicalQuantity)}
                </td>
              </tr>
            ))}
            {!lines.length ? (
              <tr>
                <td className={styles.tableEmpty} colSpan={4}>
                  Chưa có RFID nào nhận diện được SKU trong phiên này.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {detail.unknownRfids.length ? (
        <section className={styles.unknownPanel}>
          <div className={styles.unknownTitle}>
            <AlertTriangle size={18} />
            <div>
              <strong>RFID chưa nhận diện được SKU</strong>
              <span>Cần nạp các mã này trong Cấu hình Kho vận.</span>
            </div>
            <b>{detail.unknownRfids.length}</b>
          </div>
          <div className={styles.unknownList}>
            {detail.unknownRfids.map((item) => (
              <code key={item.rfid}>{item.rfid}</code>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}

function RfidTable({ detail }: { detail: WarehouseInventoryDetail }) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>RFID / EPC</th>
            <th>Mã SKU</th>
            <th>Tên SKU</th>
            <th className={styles.numeric}>Số lượt đọc</th>
            <th>Kết quả</th>
          </tr>
        </thead>
        <tbody>
          {detail.scanItems.map((item) => {
            const cancelled = item.issuanceStatus === "CANCELLED";
            const mapped = Boolean(item.sku) && !cancelled;
            return (
              <tr key={item.epc}>
                <td>
                  <code className={styles.epc}>{item.epc}</code>
                </td>
                <td>
                  <strong>{item.sku || "—"}</strong>
                </td>
                <td>{item.name || "Chưa nhận diện"}</td>
                <td className={styles.numeric}>
                  {numberLabel(item.readCount)}
                </td>
                <td>
                  <span
                    className={`${styles.resultPill} ${
                      cancelled
                        ? styles.resultCancelled
                        : mapped
                          ? styles.resultGood
                          : styles.resultReview
                    }`}
                  >
                    {cancelled
                      ? "Đã Hủy · bỏ qua"
                      : mapped
                        ? "Đã nhận diện"
                        : "Chưa gắn SKU"}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RfidDefinitionTab({
  detail,
  onAssign,
  onQueryChange,
  onSelectProduct,
  onToggleAll,
  onToggleEpc,
  pending,
  products,
  query,
  searchError,
  searching,
  selectedEpcs,
  selectedProduct,
}: {
  detail: WarehouseInventoryDetail;
  onAssign: () => void;
  onQueryChange: (value: string) => void;
  onSelectProduct: (product: WarehouseInventoryProductOption) => void;
  onToggleAll: () => void;
  onToggleEpc: (epc: string) => void;
  pending: boolean;
  products: WarehouseInventoryProductOption[];
  query: string;
  searchError: string;
  searching: boolean;
  selectedEpcs: string[];
  selectedProduct: WarehouseInventoryProductOption | null;
}) {
  const unknownEpcs = detail.unknownRfids.map((item) => item.rfid);
  const selectedSet = new Set(selectedEpcs);
  const allSelected =
    unknownEpcs.length > 0 && unknownEpcs.every((epc) => selectedSet.has(epc));
  const normalizedQuery = query.trim();

  if (!unknownEpcs.length) {
    return (
      <div className={styles.definitionComplete}>
        <span>
          <CheckCircle2 size={28} />
        </span>
        <div>
          <strong>Tất cả RFID đã được định nghĩa</strong>
          <p>
            Phiên kiểm kê này không còn mã RFID nào thiếu liên kết sản phẩm.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.definitionWorkspace}>
      <section className={styles.definitionPanel}>
        <header className={styles.definitionPanelHeader}>
          <div>
            <strong>RFID chưa định nghĩa</strong>
            <span>
              Đã chọn {numberLabel(selectedEpcs.length)}/
              {numberLabel(unknownEpcs.length)} mã
            </span>
          </div>
          <button
            className={styles.definitionSelectAll}
            onClick={onToggleAll}
            type="button"
          >
            {allSelected ? "Bỏ chọn" : "Chọn tất cả"}
          </button>
        </header>
        <div className={styles.definitionEpcList}>
          {detail.unknownRfids.map((item) => {
            const selected = selectedSet.has(item.rfid);
            return (
              <button
                aria-pressed={selected}
                className={`${styles.definitionEpcButton} ${
                  selected ? styles.definitionEpcButtonSelected : ""
                }`}
                key={item.rfid}
                onClick={() => onToggleEpc(item.rfid)}
                type="button"
              >
                <span className={styles.definitionCheck}>
                  {selected ? <Check size={15} /> : null}
                </span>
                <span>
                  <code>{item.rfid}</code>
                  <small>{item.reason || "Chưa liên kết SKU"}</small>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className={styles.definitionPanel}>
        <header className={styles.definitionPanelHeader}>
          <div>
            <strong>Tìm sản phẩm để gán</strong>
            <span>Tìm theo tên hàng, mã SKU hoặc mã vạch</span>
          </div>
        </header>
        <div className={styles.definitionMappingBody}>
          <label className={styles.definitionSearch}>
            <Search size={18} />
            <input
              autoComplete="off"
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Nhập tên, SKU hoặc mã vạch..."
              value={query}
            />
            {searching ? <RefreshCw className={styles.spin} size={17} /> : null}
          </label>

          {normalizedQuery.length < 2 ? (
            <p className={styles.definitionSearchHint}>
              Nhập ít nhất 2 ký tự để tìm trong danh mục Kho.
            </p>
          ) : null}
          {searchError ? (
            <p className={styles.definitionSearchError}>{searchError}</p>
          ) : null}

          <div className={styles.definitionProductList}>
            {products.map((product) => {
              const selected = selectedProduct?.sku === product.sku;
              return (
                <button
                  aria-pressed={selected}
                  className={`${styles.definitionProductButton} ${
                    selected ? styles.definitionProductButtonSelected : ""
                  }`}
                  key={product.sku}
                  onClick={() => onSelectProduct(product)}
                  type="button"
                >
                  <span className={styles.definitionProductCode}>
                    <strong>{product.sku}</strong>
                    {selected ? <CheckCircle2 size={18} /> : null}
                  </span>
                  <span className={styles.definitionProductName}>
                    {product.name || "Chưa có tên sản phẩm"}
                  </span>
                  <span className={styles.definitionProductMeta}>
                    {product.barcode ? (
                      <span>
                        <Barcode size={14} /> {product.barcode}
                      </span>
                    ) : (
                      <span>Chưa có mã vạch</span>
                    )}
                    <span>{numberLabel(product.rfidCount)} RFID đã gắn</span>
                  </span>
                </button>
              );
            })}
            {normalizedQuery.length >= 2 &&
            !searching &&
            !searchError &&
            !products.length ? (
              <div className={styles.definitionNoResults}>
                Không tìm thấy sản phẩm phù hợp.
              </div>
            ) : null}
          </div>

          <div className={styles.definitionSelectionSummary}>
            <span>Sản phẩm sẽ nhận RFID</span>
            {selectedProduct ? (
              <div>
                <strong>{selectedProduct.sku}</strong>
                <span>{selectedProduct.name}</span>
              </div>
            ) : (
              <p>Chưa chọn sản phẩm.</p>
            )}
          </div>
          <button
            className={`${styles.primaryButton} ${styles.definitionAssignButton}`}
            disabled={pending || !selectedEpcs.length || !selectedProduct}
            onClick={onAssign}
            type="button"
          >
            <Tags size={17} />
            Gán {numberLabel(selectedEpcs.length)} RFID vào sản phẩm
          </button>
        </div>
      </section>
    </div>
  );
}

function RfidRedefinitionTab({
  detail,
  onAssign,
  onCancel,
  onQueryChange,
  onRemove,
  onSelectProduct,
  onToggleAll,
  onToggleEpc,
  pending,
  products,
  query,
  searchError,
  searching,
  selectedEpcs,
  selectedProduct,
}: {
  detail: WarehouseInventoryDetail;
  onAssign: () => void;
  onCancel: () => void;
  onQueryChange: (value: string) => void;
  onRemove: () => void;
  onSelectProduct: (product: WarehouseInventoryProductOption) => void;
  onToggleAll: (epcs: string[]) => void;
  onToggleEpc: (epc: string) => void;
  pending: boolean;
  products: WarehouseInventoryProductOption[];
  query: string;
  searchError: string;
  searching: boolean;
  selectedEpcs: string[];
  selectedProduct: WarehouseInventoryProductOption | null;
}) {
  const [rfidQuery, setRfidQuery] = useState("");
  const [collapsedSkus, setCollapsedSkus] = useState<string[]>([]);
  useEffect(() => setCollapsedSkus([]), [detail.sessionKey]);
  const normalizedRfidQuery = rfidQuery.trim().toLocaleLowerCase("vi");
  const mappedItems = detail.scanItems.filter(
    (item) => item.sku && item.issuanceStatus !== "CANCELLED",
  );
  const visibleItems = mappedItems.filter((item) => {
    if (!normalizedRfidQuery) return true;
    return [item.epc, item.sku, item.name]
      .join(" ")
      .toLocaleLowerCase("vi")
      .includes(normalizedRfidQuery);
  });
  const visibleEpcs = visibleItems.map((item) => item.epc);
  const allMappedEpcs = mappedItems.map((item) => item.epc);
  const selectedSet = new Set(selectedEpcs);
  const allMappedSelected =
    allMappedEpcs.length > 0 &&
    allMappedEpcs.every((epc) => selectedSet.has(epc));
  const collapsedSet = new Set(collapsedSkus);
  const groupedItems = [
    ...visibleItems
      .reduce<
        Map<
          string,
          {
            items: WarehouseInventoryDetail["scanItems"];
            name: string;
            sku: string;
          }
        >
      >((groups, item) => {
        const current = groups.get(item.sku) ?? {
          items: [],
          name: item.name || item.sku,
          sku: item.sku,
        };
        current.items.push(item);
        groups.set(item.sku, current);
        return groups;
      }, new Map())
      .values(),
  ].sort((left, right) => left.sku.localeCompare(right.sku, "vi"));
  const normalizedQuery = query.trim();
  const locked = Boolean(detail.confirmedAt);

  if (!mappedItems.length) {
    return (
      <div className={styles.definitionComplete}>
        <span>
          <AlertTriangle size={28} />
        </span>
        <div>
          <strong>Phiên chưa có RFID đã gắn SKU</strong>
          <p>
            Hãy dùng tab Định nghĩa RFID cho các mã chưa có SKU trước khi định
            nghĩa lại.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.definitionWorkspace}>
      <section className={styles.definitionPanel}>
        <header className={styles.definitionPanelHeader}>
          <div>
            <strong>RFID đã dán trong phiên</strong>
            <span>
              Đã chọn {numberLabel(selectedEpcs.length)}/
              {numberLabel(mappedItems.length)} mã
            </span>
          </div>
          <button
            className={styles.definitionSelectAll}
            disabled={!allMappedEpcs.length}
            onClick={() => onToggleAll(allMappedEpcs)}
            type="button"
          >
            {allMappedSelected ? "Bỏ chọn tất cả" : "Chọn tất cả"}
          </button>
        </header>
        <div className={styles.redefinitionFilter}>
          <label className={styles.definitionSearch}>
            <Search size={17} />
            <input
              autoComplete="off"
              onChange={(event) => setRfidQuery(event.target.value)}
              placeholder="Lọc theo EPC, SKU hoặc tên hàng..."
              value={rfidQuery}
            />
          </label>
          <span>{numberLabel(visibleItems.length)} mã đang hiển thị</span>
        </div>
        <div className={styles.definitionEpcList}>
          {groupedItems.map((group) => {
            const groupEpcs = group.items.map((item) => item.epc);
            const groupSelected = groupEpcs.every((epc) =>
              selectedSet.has(epc),
            );
            const collapsed = collapsedSet.has(group.sku);
            return (
              <section className={styles.redefinitionSkuGroup} key={group.sku}>
                <header className={styles.redefinitionSkuHeader}>
                  <div>
                    <strong>{group.name || "Chưa có tên SKU"}</strong>
                    <span>
                      SKU: <b>{group.sku}</b> ·{" "}
                      {numberLabel(group.items.length)} RFID
                    </span>
                  </div>
                  <div className={styles.redefinitionSkuActions}>
                    <button
                      className={styles.redefinitionGroupSelect}
                      onClick={() => onToggleAll(groupEpcs)}
                      type="button"
                    >
                      {groupSelected ? "Bỏ chọn nhóm" : "Chọn nhóm"}
                    </button>
                    <button
                      aria-expanded={!collapsed}
                      aria-label={`${collapsed ? "Mở" : "Thu gọn"} nhóm ${group.sku}`}
                      className={styles.redefinitionCollapse}
                      onClick={() =>
                        setCollapsedSkus((current) =>
                          current.includes(group.sku)
                            ? current.filter((sku) => sku !== group.sku)
                            : [...current, group.sku],
                        )
                      }
                      type="button"
                    >
                      {collapsed ? <Plus size={16} /> : <Minus size={16} />}
                    </button>
                  </div>
                </header>
                {!collapsed ? (
                  <div className={styles.redefinitionSkuRfids}>
                    {group.items.map((item) => {
                      const selected = selectedSet.has(item.epc);
                      return (
                        <button
                          aria-pressed={selected}
                          className={`${styles.definitionEpcButton} ${
                            selected ? styles.definitionEpcButtonSelected : ""
                          }`}
                          key={item.epc}
                          onClick={() => onToggleEpc(item.epc)}
                          type="button"
                        >
                          <span className={styles.definitionCheck}>
                            {selected ? <Check size={15} /> : null}
                          </span>
                          <span>
                            <code>{item.epc}</code>
                            <small>
                              Lượt đọc: {numberLabel(item.readCount)}
                            </small>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </section>
            );
          })}
          {!visibleItems.length ? (
            <div className={styles.definitionNoResults}>
              Không có RFID phù hợp bộ lọc.
            </div>
          ) : null}
        </div>
        <div className={styles.redefinitionRemoveBar}>
          <span>
            “Loại khỏi phiên” chỉ sửa khối này. “Hủy mã” cập nhật dữ liệu Kho và
            các lần kiểm kê sau sẽ tự bỏ qua RFID đó.
          </span>
          <div className={styles.redefinitionRemoveActions}>
            <button
              className={styles.redefinitionCancelButton}
              disabled={locked || pending || !selectedEpcs.length}
              onClick={onCancel}
              type="button"
            >
              <CircleOff size={15} /> Hủy {numberLabel(selectedEpcs.length)} mã
            </button>
            <button
              disabled={locked || pending || !selectedEpcs.length}
              onClick={onRemove}
              type="button"
            >
              <Trash2 size={15} /> Loại khỏi phiên
            </button>
          </div>
        </div>
      </section>

      <section className={styles.definitionPanel}>
        <header className={styles.definitionPanelHeader}>
          <div>
            <strong>Chọn SKU mới để gán lại</strong>
            <span>Tìm theo tên hàng, mã SKU hoặc mã vạch</span>
          </div>
        </header>
        <div className={styles.definitionMappingBody}>
          {locked ? (
            <div className={styles.redefinitionLocked}>
              <AlertTriangle size={17} /> Phiên đã xác nhận nên chỉ được xem,
              không thể sửa mapping hoặc loại mã.
            </div>
          ) : null}
          <label className={styles.definitionSearch}>
            <Search size={18} />
            <input
              autoComplete="off"
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Nhập tên, SKU hoặc mã vạch mới..."
              value={query}
            />
            {searching ? <RefreshCw className={styles.spin} size={17} /> : null}
          </label>

          {normalizedQuery.length < 2 ? (
            <p className={styles.definitionSearchHint}>
              Nhập ít nhất 2 ký tự để tìm trong danh mục Kho.
            </p>
          ) : null}
          {searchError ? (
            <p className={styles.definitionSearchError}>{searchError}</p>
          ) : null}

          <div className={styles.definitionProductList}>
            {products.map((product) => {
              const selected = selectedProduct?.sku === product.sku;
              return (
                <button
                  aria-pressed={selected}
                  className={`${styles.definitionProductButton} ${
                    selected ? styles.definitionProductButtonSelected : ""
                  }`}
                  key={product.sku}
                  onClick={() => onSelectProduct(product)}
                  type="button"
                >
                  <span className={styles.definitionProductCode}>
                    <strong>{product.sku}</strong>
                    {selected ? <CheckCircle2 size={18} /> : null}
                  </span>
                  <span className={styles.definitionProductName}>
                    {product.name || "Chưa có tên sản phẩm"}
                  </span>
                  <span className={styles.definitionProductMeta}>
                    {product.barcode ? (
                      <span>
                        <Barcode size={14} /> {product.barcode}
                      </span>
                    ) : (
                      <span>Chưa có mã vạch</span>
                    )}
                    <span>{numberLabel(product.rfidCount)} RFID đã gắn</span>
                  </span>
                </button>
              );
            })}
            {normalizedQuery.length >= 2 &&
            !searching &&
            !searchError &&
            !products.length ? (
              <div className={styles.definitionNoResults}>
                Không tìm thấy sản phẩm phù hợp.
              </div>
            ) : null}
          </div>

          <div className={styles.definitionSelectionSummary}>
            <span>SKU mới sẽ nhận RFID</span>
            {selectedProduct ? (
              <div>
                <strong>{selectedProduct.sku}</strong>
                <span>{selectedProduct.name}</span>
              </div>
            ) : (
              <p>Chưa chọn SKU mới.</p>
            )}
          </div>
          <button
            className={`${styles.primaryButton} ${styles.definitionAssignButton}`}
            disabled={
              locked || pending || !selectedEpcs.length || !selectedProduct
            }
            onClick={onAssign}
            type="button"
          >
            <Pencil size={17} />
            Gán lại {numberLabel(selectedEpcs.length)} RFID sang SKU mới
          </button>
        </div>
      </section>
    </div>
  );
}

function JsonTab({ detail }: { detail: WarehouseInventoryDetail }) {
  return (
    <div className={styles.jsonPanel}>
      <div>
        <FileJson size={20} />
        <strong>JSON gốc đã nhận từ máy quét</strong>
      </div>
      <pre>{JSON.stringify(detail.rawPayload, null, 2)}</pre>
    </div>
  );
}

function JsonTestModal({
  onClose,
  onSubmit,
  pending,
}: {
  onClose: () => void;
  onSubmit: (value: string) => void;
  pending: boolean;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [value, setValue] = useState(
    JSON.stringify(
      {
        action: "warehouseInventoryScan",
        deviceName: "RFID-SCANNER-01",
        operator: "Nhân viên kiểm kê",
        rfids: ["E28069150000401FFE22D032"],
        sessionId: `kiem-ke-${today}-001`,
      },
      null,
      2,
    ),
  );
  return (
    <div className={styles.modalBackdrop} role="presentation">
      <section
        aria-labelledby="json-test-title"
        aria-modal="true"
        className={styles.modal}
        role="dialog"
      >
        <div className={styles.modalHeader}>
          <div>
            <span>Kiểm tra đầu nhận</span>
            <h2 id="json-test-title">Gửi một JSON RFID thử</h2>
          </div>
          <button aria-label="Đóng" onClick={onClose} type="button">
            <X size={20} />
          </button>
        </div>
        <p className={styles.modalHint}>
          Chỉ cần danh sách RFID. Mã phiên, người kiểm kê và tên máy là metadata
          tùy chọn để dễ tra cứu lịch sử.
        </p>
        <textarea
          aria-label="JSON kiểm kê thử"
          onChange={(event) => setValue(event.target.value)}
          spellCheck={false}
          value={value}
        />
        <div className={styles.modalActions}>
          <button
            className={styles.secondaryButton}
            disabled={pending}
            onClick={onClose}
            type="button"
          >
            Hủy
          </button>
          <button
            className={styles.primaryButton}
            disabled={pending}
            onClick={() => onSubmit(value)}
            type="button"
          >
            <ScanLine size={17} />
            Nhận JSON thử
          </button>
        </div>
      </section>
    </div>
  );
}

function PrintModal({
  detail,
  onClose,
  onPopupBlocked,
}: {
  detail: WarehouseInventoryDetail;
  onClose: () => void;
  onPopupBlocked: () => void;
}) {
  const [kind, setKind] = useState<WarehouseInventoryPrintKind | "">("");
  const [operatorName, setOperatorName] = useState(detail.operatorName);

  const print = () => {
    if (!kind) return;
    if (!openWarehouseInventoryStatementPrint(detail, kind, operatorName)) {
      onPopupBlocked();
      return;
    }
    onClose();
  };

  return (
    <div className={styles.modalBackdrop} role="presentation">
      <section
        aria-labelledby="print-inventory-title"
        aria-modal="true"
        className={`${styles.modal} ${styles.printModal}`}
        role="dialog"
      >
        <div className={styles.modalHeader}>
          <div>
            <span>In biên bản</span>
            <h2 id="print-inventory-title">Chọn loại kiểm kê</h2>
          </div>
          <button aria-label="Đóng" onClick={onClose} type="button">
            <X size={20} />
          </button>
        </div>
        <p className={styles.modalHint}>
          Bản in sẽ lấy đúng bảng số lượng SKU của phiên {detail.sessionKey}.
        </p>
        <label className={styles.printField}>
          <span>Tên người kiểm kê</span>
          <input
            onChange={(event) => setOperatorName(event.target.value)}
            placeholder="Nhập họ tên người kiểm kê"
            value={operatorName}
          />
        </label>
        <div className={styles.printChoices}>
          <button
            aria-pressed={kind === "START"}
            className={kind === "START" ? styles.printChoiceActive : ""}
            onClick={() => setKind("START")}
            type="button"
          >
            <PackageCheck size={23} />
            <strong>Kiểm kê đầu kỳ</strong>
            <span>In biên bản ghi nhận số lượng đầu kỳ.</span>
          </button>
          <button
            aria-pressed={kind === "END"}
            className={kind === "END" ? styles.printChoiceActive : ""}
            onClick={() => setKind("END")}
            type="button"
          >
            <ClipboardCheck size={23} />
            <strong>Kiểm kê cuối kỳ</strong>
            <span>In biên bản ghi nhận số lượng cuối kỳ.</span>
          </button>
        </div>
        <div className={styles.modalActions}>
          <button
            className={styles.secondaryButton}
            onClick={onClose}
            type="button"
          >
            Hủy
          </button>
          <button
            className={styles.primaryButton}
            disabled={!kind}
            onClick={print}
            type="button"
          >
            <Printer size={17} />
            In biên bản
          </button>
        </div>
      </section>
    </div>
  );
}

function InventoryComparisonModal({
  comparison,
  onClose,
  onPopupBlocked,
}: {
  comparison: WarehouseInventoryPairComparisonData;
  onClose: () => void;
  onPopupBlocked: () => void;
}) {
  const [operatorName, setOperatorName] = useState(
    comparison.outputSession.operatorName ||
      comparison.inputSession.operatorName ||
      "",
  );

  const print = () => {
    if (!openWarehouseInventoryComparisonPrint(comparison, operatorName)) {
      onPopupBlocked();
      return;
    }
    onClose();
  };

  return (
    <div className={styles.modalBackdrop} role="presentation">
      <section
        aria-labelledby="inventory-comparison-title"
        aria-modal="true"
        className={`${styles.modal} ${styles.comparisonModal}`}
        role="dialog"
      >
        <div className={styles.modalHeader}>
          <div>
            <span>So sánh kiểm kê</span>
            <h2 id="inventory-comparison-title">
              Chênh lệch đầu vào và đầu ra
            </h2>
          </div>
          <button aria-label="Đóng" onClick={onClose} type="button">
            <X size={20} />
          </button>
        </div>

        <div className={styles.comparisonSessionGrid}>
          <div>
            <b>1</b>
            <span>
              <strong>Đầu vào</strong>
              <code>{comparison.inputSession.sessionKey}</code>
              <small>{dateLabel(comparison.inputSession.scanDate)}</small>
            </span>
          </div>
          <div>
            <b>2</b>
            <span>
              <strong>Đầu ra</strong>
              <code>{comparison.outputSession.sessionKey}</code>
              <small>{dateLabel(comparison.outputSession.scanDate)}</small>
            </span>
          </div>
        </div>

        <div className={styles.comparisonSummary}>
          <span>
            <small>SKU so sánh</small>
            <strong>{numberLabel(comparison.summary.skuCount)}</strong>
          </span>
          <span>
            <small>Đầu vào</small>
            <strong>{numberLabel(comparison.summary.inputQuantity)}</strong>
          </span>
          <span>
            <small>Đầu ra</small>
            <strong>{numberLabel(comparison.summary.outputQuantity)}</strong>
          </span>
          <span>
            <small>Chênh lệch</small>
            <strong>
              {signedNumberLabel(comparison.summary.differenceQuantity)}
            </strong>
          </span>
        </div>

        <div className={styles.comparisonTableWrap}>
          <table className={`${styles.table} ${styles.comparisonTable}`}>
            <thead>
              <tr>
                <th>Mã SKU</th>
                <th>Tên hàng hóa</th>
                <th className={styles.numeric}>Đầu vào</th>
                <th className={styles.numeric}>Đầu ra</th>
                <th className={styles.numeric}>Chênh lệch</th>
              </tr>
            </thead>
            <tbody>
              {comparison.lines.map((line) => (
                <tr key={line.sku}>
                  <td>
                    <strong>{line.sku}</strong>
                  </td>
                  <td>{line.name}</td>
                  <td className={styles.numeric}>
                    {numberLabel(line.inputQuantity)}
                  </td>
                  <td className={styles.numeric}>
                    {numberLabel(line.outputQuantity)}
                  </td>
                  <td
                    className={`${styles.numeric} ${
                      line.difference > 0
                        ? styles.comparisonIncrease
                        : line.difference < 0
                          ? styles.comparisonDecrease
                          : styles.comparisonEqual
                    }`}
                  >
                    {signedNumberLabel(line.difference)}
                  </td>
                </tr>
              ))}
              {!comparison.lines.length ? (
                <tr>
                  <td className={styles.tableEmpty} colSpan={5}>
                    Không có SKU để so sánh.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <label className={styles.printField}>
          <span>Tên người kiểm kê / lập biên bản</span>
          <input
            onChange={(event) => setOperatorName(event.target.value)}
            placeholder="Nhập họ tên để đặt dưới khu vực ký tên"
            value={operatorName}
          />
        </label>
        <p className={styles.comparisonFormula}>
          Chênh lệch = Đầu ra − Đầu vào. Bản in giữ khu vực Người kiểm kê và Xác
          nhận kế toán như biên bản hiện tại.
        </p>
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
            onClick={print}
            type="button"
          >
            <Printer size={17} />
            In bảng so sánh
          </button>
        </div>
      </section>
    </div>
  );
}

function DeleteSessionModal({
  item,
  onClose,
  onConfirm,
  pending,
}: {
  item: WarehouseInventorySessionItem;
  onClose: () => void;
  onConfirm: (input: { password: string; reason: string }) => void;
  pending: boolean;
}) {
  const [reason, setReason] = useState("");
  const [password, setPassword] = useState("");

  return (
    <div className={styles.modalBackdrop} role="presentation">
      <form
        aria-labelledby="delete-inventory-session-title"
        aria-modal="true"
        className={`${styles.modal} ${styles.deleteModal}`}
        onSubmit={(event) => {
          event.preventDefault();
          onConfirm({ password, reason });
        }}
        role="dialog"
      >
        <div className={styles.modalHeader}>
          <div>
            <span>Xóa dữ liệu kiểm kê</span>
            <h2 id="delete-inventory-session-title">
              Xóa vĩnh viễn phiên này?
            </h2>
          </div>
          <button
            aria-label="Đóng"
            disabled={pending}
            onClick={onClose}
            type="button"
          >
            <X size={20} />
          </button>
        </div>
        <div className={styles.deleteWarning}>
          <AlertTriangle size={20} />
          <div>
            <strong>{item.sessionKey}</strong>
            <span>
              Toàn bộ {numberLabel(item.itemCount)} dòng RFID của phiên sẽ bị
              xóa khỏi PostgreSQL. Thao tác không thể hoàn tác.
            </span>
          </div>
        </div>
        <label className={styles.deleteField}>
          <span>Lý do xóa</span>
          <textarea
            autoFocus
            maxLength={1200}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Ví dụ: Phiên quét thử, dữ liệu không dùng..."
            required
            value={reason}
          />
        </label>
        <label className={styles.deleteField}>
          <span>Mật khẩu tài khoản đang đăng nhập</span>
          <input
            autoComplete="current-password"
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Nhập mật khẩu để xác nhận"
            required
            type="password"
            value={password}
          />
        </label>
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
            disabled={pending || !reason.trim() || !password}
            type="submit"
          >
            <X size={17} />
            Xóa khỏi PostgreSQL
          </button>
        </div>
      </form>
    </div>
  );
}

function BulkDeleteSessionsModal({
  itemCount,
  onClose,
  onConfirm,
  pending,
  sessionCount,
}: {
  itemCount: number;
  onClose: () => void;
  onConfirm: (input: { password: string; reason: string }) => void;
  pending: boolean;
  sessionCount: number;
}) {
  const [reason, setReason] = useState("");
  const [password, setPassword] = useState("");

  return (
    <div className={styles.modalBackdrop} role="presentation">
      <form
        aria-labelledby="bulk-delete-inventory-sessions-title"
        aria-modal="true"
        className={styles.modal + " " + styles.deleteModal}
        onSubmit={(event) => {
          event.preventDefault();
          onConfirm({ password, reason });
        }}
        role="dialog"
      >
        <div className={styles.modalHeader}>
          <div>
            <span>Quyền Super Admin</span>
            <h2 id="bulk-delete-inventory-sessions-title">
              Xóa vĩnh viễn {numberLabel(sessionCount)} phiên?
            </h2>
          </div>
          <button
            aria-label="Đóng"
            disabled={pending}
            onClick={onClose}
            type="button"
          >
            <X size={20} />
          </button>
        </div>
        <div className={styles.deleteWarning}>
          <AlertTriangle size={20} />
          <div>
            <strong>Thao tác không thể hoàn tác</strong>
            <span>
              {numberLabel(itemCount)} dòng RFID thuộc các phiên đã chọn sẽ bị
              xóa khỏi PostgreSQL. Hệ thống chỉ chấp nhận tài khoản Super Admin.
            </span>
          </div>
        </div>
        <label className={styles.deleteField}>
          <span>Lý do xóa hàng loạt</span>
          <textarea
            autoFocus
            maxLength={1200}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Nhập lý do cần xóa các khối kiểm kê này..."
            required
            value={reason}
          />
        </label>
        <label className={styles.deleteField}>
          <span>Mật khẩu Super Admin đang đăng nhập</span>
          <input
            autoComplete="current-password"
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Nhập mật khẩu để xác nhận"
            required
            type="password"
            value={password}
          />
        </label>
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
            disabled={pending || !reason.trim() || !password}
            type="submit"
          >
            <Trash2 size={17} />
            Xóa {numberLabel(sessionCount)} phiên
          </button>
        </div>
      </form>
    </div>
  );
}

function MergeSessionsModal({
  items,
  onClose,
  onConfirm,
  pending,
}: {
  items: WarehouseInventorySessionItem[];
  onClose: () => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  return (
    <div className={styles.modalBackdrop} role="presentation">
      <section
        aria-labelledby="merge-inventory-sessions-title"
        aria-modal="true"
        className={styles.modal + " " + styles.deleteModal}
        role="dialog"
      >
        <div className={styles.modalHeader}>
          <div>
            <span>Ghép dữ liệu kiểm kê</span>
            <h2 id="merge-inventory-sessions-title">
              Ghép {numberLabel(items.length)} phiên đã chọn?
            </h2>
          </div>
          <button
            aria-label="Đóng"
            disabled={pending}
            onClick={onClose}
            type="button"
          >
            <X size={20} />
          </button>
        </div>
        <div className={styles.mergeNotice}>
          <Boxes size={20} />
          <div>
            <strong>Tạo một khối kiểm kê tổng hợp mới</strong>
            <span>
              RFID trùng giữa các phiên chỉ được tính một lần. Các phiên nguồn
              vẫn được giữ lại và được liên kết với khối mới.
            </span>
          </div>
        </div>
        <div className={styles.mergeSessionList}>
          {items.slice(0, 6).map((item) => (
            <code key={item.sessionKey}>{item.sessionKey}</code>
          ))}
          {items.length > 6 ? (
            <span>và {numberLabel(items.length - 6)} phiên khác</span>
          ) : null}
        </div>
        <div className={styles.modalActions}>
          <button
            className={styles.secondaryButton}
            disabled={pending}
            onClick={onClose}
            type="button"
          >
            Hủy
          </button>
          <button
            className={styles.primaryButton}
            disabled={pending || items.length < 2}
            onClick={onConfirm}
            type="button"
          >
            <Boxes size={17} />
            Ghép thành khối mới
          </button>
        </div>
      </section>
    </div>
  );
}

function RedefinitionCleanupModal({
  affectedSessionCount,
  onClose,
  onConfirm,
  pending,
  sessionKey,
}: {
  affectedSessionCount: number;
  onClose: () => void;
  onConfirm: () => void;
  pending: boolean;
  sessionKey: string;
}) {
  return (
    <div className={styles.modalBackdrop} role="presentation">
      <section
        aria-labelledby="cleanup-redefined-inventory-title"
        aria-modal="true"
        className={styles.modal + " " + styles.deleteModal}
        role="dialog"
      >
        <div className={styles.modalHeader}>
          <div>
            <span>Định nghĩa lại hoàn tất</span>
            <h2 id="cleanup-redefined-inventory-title">
              Xóa khối kiểm kê vừa xử lý?
            </h2>
          </div>
          <button
            aria-label="Đóng"
            disabled={pending}
            onClick={onClose}
            type="button"
          >
            <X size={20} />
          </button>
        </div>
        <div className={styles.deleteWarning}>
          <AlertTriangle size={20} />
          <div>
            <strong>{sessionKey}</strong>
            <span>
              Nếu đồng ý, hệ thống sẽ xóa khối này và toàn bộ{" "}
              {numberLabel(Math.max(0, affectedSessionCount - 1))} khối liên kết
              khỏi PostgreSQL. Mapping RFID mới vẫn được giữ nguyên.
            </span>
          </div>
        </div>
        <div className={styles.modalActions}>
          <button
            className={styles.secondaryButton}
            disabled={pending}
            onClick={onClose}
            type="button"
          >
            Không, giữ các khối
          </button>
          <button
            className={styles.dangerButton}
            disabled={pending}
            onClick={onConfirm}
            type="button"
          >
            <Trash2 size={17} />
            Có, xóa {numberLabel(affectedSessionCount)} khối
          </button>
        </div>
      </section>
    </div>
  );
}

function RemoveSessionRfidsModal({
  count,
  onClose,
  onConfirm,
  pending,
  sessionKey,
}: {
  count: number;
  onClose: () => void;
  onConfirm: () => void;
  pending: boolean;
  sessionKey: string;
}) {
  return (
    <div className={styles.modalBackdrop} role="presentation">
      <section
        aria-labelledby="remove-inventory-rfids-title"
        aria-modal="true"
        className={`${styles.modal} ${styles.deleteModal}`}
        role="dialog"
      >
        <div className={styles.modalHeader}>
          <div>
            <span>Hiệu chỉnh khối kiểm kê</span>
            <h2 id="remove-inventory-rfids-title">
              Loại {numberLabel(count)} RFID khỏi phiên?
            </h2>
          </div>
          <button
            aria-label="Đóng"
            disabled={pending}
            onClick={onClose}
            type="button"
          >
            <X size={20} />
          </button>
        </div>
        <div className={styles.deleteWarning}>
          <AlertTriangle size={20} />
          <div>
            <strong>{sessionKey}</strong>
            <span>
              Các mã đã chọn sẽ không còn được tính trong phiên này. Hệ thống sẽ
              tính lại số lượng theo SKU và JSON của phiên; RFID cùng mapping
              trong dữ liệu Kho vẫn được giữ nguyên.
            </span>
          </div>
        </div>
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
            <Trash2 size={17} />
            Loại khỏi phiên
          </button>
        </div>
      </section>
    </div>
  );
}

function CancelInventoryRfidsModal({
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
    <div className={styles.modalBackdrop} role="presentation">
      <section
        aria-labelledby="cancel-inventory-rfids-title"
        aria-modal="true"
        className={`${styles.modal} ${styles.deleteModal}`}
        role="dialog"
      >
        <div className={styles.modalHeader}>
          <div>
            <span>Cập nhật dữ liệu Kho</span>
            <h2 id="cancel-inventory-rfids-title">
              Chuyển {numberLabel(count)} RFID sang trạng thái Hủy?
            </h2>
          </div>
          <button
            aria-label="Đóng"
            disabled={pending}
            onClick={onClose}
            type="button"
          >
            <X size={20} />
          </button>
        </div>
        <div className={styles.deleteWarning}>
          <AlertTriangle size={20} />
          <div>
            <strong>Khác với thao tác Loại khỏi phiên</strong>
            <span>
              Trạng thái Hủy được lưu vào PostgreSQL. Các mã này sẽ không được
              tính vào số lượng SKU và cũng không xuất hiện dưới dạng RFID chưa
              xác định trong những lần kiểm kê sau.
            </span>
          </div>
        </div>
        <div className={styles.modalActions}>
          <button
            className={styles.secondaryButton}
            disabled={pending}
            onClick={onClose}
            type="button"
          >
            Giữ trạng thái hiện tại
          </button>
          <button
            className={styles.dangerButton}
            disabled={pending || !count}
            onClick={onConfirm}
            type="button"
          >
            <CircleOff size={17} />
            Xác nhận Hủy mã
          </button>
        </div>
      </section>
    </div>
  );
}

export function WarehouseInventoryWorkspace({
  initialData,
}: {
  initialData: WarehouseInventoryWorkspaceData;
}) {
  const [data, setData] = useState(initialData);
  const [selectedKey, setSelectedKey] = useState(
    initialData.detail?.sessionKey || "",
  );
  const [search, setSearch] = useState("");
  const [timeFilter, setTimeFilter] = useState<SessionTimeFilter>("ALL");
  const [customDateFrom, setCustomDateFrom] = useState(() =>
    shiftedDateValue(new Date(), -6),
  );
  const [customDateTo, setCustomDateTo] = useState(() =>
    localDateValue(new Date()),
  );
  const [tab, setTab] = useState<TabKey>("sku");
  const [definitionQuery, setDefinitionQuery] = useState("");
  const [definitionProducts, setDefinitionProducts] = useState<
    WarehouseInventoryProductOption[]
  >([]);
  const [definitionSearchError, setDefinitionSearchError] = useState("");
  const [selectedDefinitionProduct, setSelectedDefinitionProduct] =
    useState<WarehouseInventoryProductOption | null>(null);
  const [selectedUnknownEpcs, setSelectedUnknownEpcs] = useState<string[]>([]);
  const [redefinitionQuery, setRedefinitionQuery] = useState("");
  const [redefinitionProducts, setRedefinitionProducts] = useState<
    WarehouseInventoryProductOption[]
  >([]);
  const [redefinitionSearchError, setRedefinitionSearchError] = useState("");
  const [selectedRedefinitionProduct, setSelectedRedefinitionProduct] =
    useState<WarehouseInventoryProductOption | null>(null);
  const [selectedRedefinitionEpcs, setSelectedRedefinitionEpcs] = useState<
    string[]
  >([]);
  const [showRemoveSessionRfids, setShowRemoveSessionRfids] = useState(false);
  const [showCancelInventoryRfids, setShowCancelInventoryRfids] =
    useState(false);
  const [showJsonTest, setShowJsonTest] = useState(false);
  const [showPrint, setShowPrint] = useState(false);
  const [comparisonKeys, setComparisonKeys] = useState<string[]>([]);
  const [bulkSelectedKeys, setBulkSelectedKeys] = useState<string[]>([]);
  const [showBulkDelete, setShowBulkDelete] = useState(false);
  const [showMergeSessions, setShowMergeSessions] = useState(false);
  const [redefinitionCleanup, setRedefinitionCleanup] = useState<{
    affectedSessionCount: number;
    redefinitionSessionKey: string;
    sessionKey: string;
  } | null>(null);
  const [comparisonData, setComparisonData] =
    useState<WarehouseInventoryPairComparisonData | null>(null);
  const [deleteTarget, setDeleteTarget] =
    useState<WarehouseInventorySessionItem | null>(null);
  const [pending, startTransition] = useTransition();
  const [comparisonPending, startComparisonTransition] = useTransition();
  const [catalogSearching, startCatalogSearch] = useTransition();
  const latestDefinitionQuery = useRef("");
  const latestRedefinitionQuery = useRef("");
  const { toast } = useToast();
  const endpoint = "/api/warehouse/rfid";
  const detail = data.detail;
  const selectedDefinitionEpcs = useMemo(() => {
    const available = new Set(
      detail?.unknownRfids.map((item) => item.rfid) || [],
    );
    return selectedUnknownEpcs.filter((epc) => available.has(epc));
  }, [detail, selectedUnknownEpcs]);
  const availableRedefinitionEpcs = useMemo(
    () =>
      new Set(
        detail?.scanItems.filter((item) => item.sku).map((item) => item.epc) ||
          [],
      ),
    [detail],
  );
  const validSelectedRedefinitionEpcs = useMemo(
    () =>
      selectedRedefinitionEpcs.filter((epc) =>
        availableRedefinitionEpcs.has(epc),
      ),
    [availableRedefinitionEpcs, selectedRedefinitionEpcs],
  );
  const comparisonSessions = useMemo(
    () =>
      comparisonKeys.flatMap((sessionKey) => {
        const item = data.sessions.find(
          (session) => session.sessionKey === sessionKey,
        );
        return item ? [item] : [];
      }),
    [comparisonKeys, data.sessions],
  );
  const bulkSelectedSessions = useMemo(
    () =>
      bulkSelectedKeys.flatMap((sessionKey) => {
        const item = data.sessions.find(
          (session) => session.sessionKey === sessionKey,
        );
        return item ? [item] : [];
      }),
    [bulkSelectedKeys, data.sessions],
  );

  useEffect(() => {
    const query = definitionQuery.trim();
    latestDefinitionQuery.current = query;
    if (tab !== "define" || query.length < 2) return;

    const timer = window.setTimeout(() => {
      startCatalogSearch(async () => {
        const result = await searchWarehouseInventoryProductsAction(query);
        if (latestDefinitionQuery.current !== query) return;
        setDefinitionProducts(result.products);
        setDefinitionSearchError(result.ok ? "" : result.message);
      });
    }, 320);
    return () => window.clearTimeout(timer);
  }, [definitionQuery, tab]);

  useEffect(() => {
    const query = redefinitionQuery.trim();
    latestRedefinitionQuery.current = query;
    if (tab !== "redefine" || query.length < 2) return;

    const timer = window.setTimeout(() => {
      startCatalogSearch(async () => {
        const result = await searchWarehouseInventoryProductsAction(query);
        if (latestRedefinitionQuery.current !== query) return;
        setRedefinitionProducts(result.products);
        setRedefinitionSearchError(result.ok ? "" : result.message);
      });
    }, 320);
    return () => window.clearTimeout(timer);
  }, [redefinitionQuery, tab]);

  const filteredSessions = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("vi");
    const now = new Date();
    const today = localDateValue(now);
    let dateFrom = "";
    let dateTo = "";

    if (timeFilter === "TODAY") {
      dateFrom = today;
      dateTo = today;
    } else if (timeFilter === "WEEK") {
      const dayOfWeek = now.getDay() || 7;
      dateFrom = shiftedDateValue(now, 1 - dayOfWeek);
      dateTo = shiftedDateValue(now, 7 - dayOfWeek);
    } else if (timeFilter === "MONTH") {
      dateFrom = localDateValue(new Date(now.getFullYear(), now.getMonth(), 1));
      dateTo = localDateValue(
        new Date(now.getFullYear(), now.getMonth() + 1, 0),
      );
    } else if (timeFilter === "CUSTOM") {
      dateFrom = customDateFrom <= customDateTo ? customDateFrom : customDateTo;
      dateTo = customDateFrom <= customDateTo ? customDateTo : customDateFrom;
    }

    return [...data.sessions]
      .filter((item) => {
        if (!query) return true;
        return [
          item.sessionKey,
          item.area,
          item.shelf,
          item.operatorName,
          item.deviceName,
        ]
          .join(" ")
          .toLocaleLowerCase("vi")
          .includes(query);
      })
      .filter((item) => {
        if (!dateFrom || !dateTo) return true;
        const scanDate = normalizedSessionDate(item.scanDate);
        if (!scanDate) return false;
        return scanDate >= dateFrom && scanDate <= dateTo;
      })
      .sort((left, right) => sessionSortValue(right) - sessionSortValue(left));
  }, [customDateFrom, customDateTo, data.sessions, search, timeFilter]);
  const allFilteredSessionsSelected = useMemo(
    () =>
      filteredSessions.length > 0 &&
      filteredSessions.every((item) =>
        bulkSelectedKeys.includes(item.sessionKey),
      ),
    [bulkSelectedKeys, filteredSessions],
  );

  const applyResult = (
    result: WarehouseInventoryActionResult,
    successTitle: string,
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
    setSelectedKey(result.data.detail?.sessionKey || result.sessionKey || "");
    toast({ message: result.message, title: successTitle, tone: "success" });
    return true;
  };

  const selectSession = (sessionKey: string) => {
    setSelectedKey(sessionKey);
    setTab("sku");
    setDefinitionQuery("");
    setDefinitionProducts([]);
    setDefinitionSearchError("");
    setSelectedDefinitionProduct(null);
    setSelectedUnknownEpcs([]);
    setRedefinitionQuery("");
    setRedefinitionProducts([]);
    setRedefinitionSearchError("");
    setSelectedRedefinitionProduct(null);
    setSelectedRedefinitionEpcs([]);
    setShowRemoveSessionRfids(false);
    startTransition(async () => {
      const result = await refreshWarehouseInventoryAction(sessionKey);
      if (!result.ok || !result.data) {
        toast({
          message: result.message,
          title: "Không mở được phiên kiểm kê",
          tone: "error",
        });
        return;
      }
      setData(result.data);
    });
  };

  const toggleComparisonSession = (sessionKey: string) => {
    setComparisonData(null);
    setComparisonKeys((current) => {
      if (current.includes(sessionKey)) {
        return current.filter((key) => key !== sessionKey);
      }
      if (current.length < 2) return [...current, sessionKey];
      return [current[0], sessionKey];
    });
  };

  const toggleBulkSession = (sessionKey: string) => {
    setBulkSelectedKeys((current) =>
      current.includes(sessionKey)
        ? current.filter((key) => key !== sessionKey)
        : [...current, sessionKey],
    );
  };

  const toggleAllFilteredSessions = () => {
    const filteredKeys = filteredSessions.map((item) => item.sessionKey);
    const filteredKeySet = new Set(filteredKeys);
    setBulkSelectedKeys((current) =>
      filteredKeys.length &&
      filteredKeys.every((sessionKey) => current.includes(sessionKey))
        ? current.filter((sessionKey) => !filteredKeySet.has(sessionKey))
        : [...new Set([...current, ...filteredKeys])],
    );
  };

  const mergeBulkSessions = () => {
    const sessionKeys = bulkSelectedSessions.map((item) => item.sessionKey);
    if (sessionKeys.length < 2) return;
    startTransition(async () => {
      const result = await mergeWarehouseInventorySessionsAction(sessionKeys);
      if (applyResult(result, "Đã ghép các phiên kiểm kê")) {
        setBulkSelectedKeys([]);
        setShowMergeSessions(false);
        setComparisonData(null);
        setComparisonKeys([]);
        setTab("sku");
      }
    });
  };

  const deleteBulkSessions = (input: { password: string; reason: string }) => {
    const sessionKeys = bulkSelectedSessions.map((item) => item.sessionKey);
    if (!sessionKeys.length) return;
    startTransition(async () => {
      const result = await deleteWarehouseInventorySessionsBulkAction({
        ...input,
        sessionKeys,
      });
      if (applyResult(result, "Đã xóa hàng loạt phiên kiểm kê")) {
        const deletedSet = new Set(sessionKeys);
        setBulkSelectedKeys([]);
        setShowBulkDelete(false);
        setComparisonData(null);
        setComparisonKeys((current) =>
          current.filter((sessionKey) => !deletedSet.has(sessionKey)),
        );
        setTab("sku");
      }
    });
  };

  const compareSelectedSessions = () => {
    if (comparisonSessions.length !== 2) {
      toast({
        message: "Hãy chọn phiên số 1 làm đầu vào và phiên số 2 làm đầu ra.",
        title: "Chưa chọn đủ hai phiên",
        tone: "warning",
      });
      return;
    }
    startComparisonTransition(async () => {
      const result = await compareWarehouseInventorySessionsAction({
        inputSessionKey: comparisonSessions[0].sessionKey,
        outputSessionKey: comparisonSessions[1].sessionKey,
      });
      if (!result.ok || !result.data) {
        toast({
          message: result.message,
          title: "Không so sánh được kiểm kê",
          tone: "error",
        });
        return;
      }
      setComparisonData(result.data);
      toast({
        message: result.message,
        title: "Đã lập bảng chênh lệch",
        tone: "success",
      });
    });
  };

  const refresh = () => {
    startTransition(async () => {
      applyResult(
        await refreshWarehouseInventoryAction(selectedKey),
        "Dữ liệu đã được làm mới",
      );
    });
  };

  const syncMaster = () => {
    startTransition(async () => {
      applyResult(
        await syncWarehouseMasterAction(selectedKey),
        "Đồng bộ danh mục thành công",
      );
    });
  };

  const submitJson = (value: string) => {
    startTransition(async () => {
      const result = await submitWarehouseJsonAction(value);
      if (applyResult(result, "Đã nhận JSON RFID")) setShowJsonTest(false);
    });
  };

  const toggleUnknownEpc = (epc: string) => {
    setSelectedUnknownEpcs((current) =>
      current.includes(epc)
        ? current.filter((item) => item !== epc)
        : [...current, epc],
    );
  };

  const updateDefinitionQuery = (value: string) => {
    latestDefinitionQuery.current = value.trim();
    setDefinitionQuery(value);
    setDefinitionProducts([]);
    setDefinitionSearchError("");
  };

  const toggleAllUnknownEpcs = () => {
    const unknownEpcs =
      data.detail?.unknownRfids.map((item) => item.rfid) || [];
    setSelectedUnknownEpcs((current) =>
      unknownEpcs.length && unknownEpcs.every((epc) => current.includes(epc))
        ? []
        : unknownEpcs,
    );
  };

  const defineSelectedRfids = () => {
    const detail = data.detail;
    if (
      !detail ||
      !selectedDefinitionProduct ||
      !selectedDefinitionEpcs.length
    ) {
      toast({
        message: "Hãy chọn RFID chưa định nghĩa và sản phẩm cần liên kết.",
        title: "Chưa đủ thông tin",
        tone: "warning",
      });
      return;
    }
    startTransition(async () => {
      const result = await defineWarehouseInventoryRfidsAction({
        epcs: selectedDefinitionEpcs,
        sessionKey: detail.sessionKey,
        sku: selectedDefinitionProduct.sku,
      });
      if (applyResult(result, "Đã định nghĩa RFID")) {
        setSelectedUnknownEpcs([]);
      }
    });
  };

  const toggleRedefinitionEpc = (epc: string) => {
    setSelectedRedefinitionEpcs((current) =>
      current.includes(epc)
        ? current.filter((item) => item !== epc)
        : [...current, epc],
    );
  };

  const toggleAllRedefinitionEpcs = (epcs: string[]) => {
    const visibleSet = new Set(epcs);
    setSelectedRedefinitionEpcs((current) => {
      const allSelected =
        epcs.length > 0 && epcs.every((epc) => current.includes(epc));
      return allSelected
        ? current.filter((epc) => !visibleSet.has(epc))
        : [...new Set([...current, ...epcs])];
    });
  };

  const updateRedefinitionQuery = (value: string) => {
    latestRedefinitionQuery.current = value.trim();
    setRedefinitionQuery(value);
    setRedefinitionProducts([]);
    setRedefinitionSearchError("");
  };

  const reassignSelectedRfids = () => {
    const currentDetail = data.detail;
    if (
      !currentDetail ||
      !selectedRedefinitionProduct ||
      !validSelectedRedefinitionEpcs.length
    ) {
      toast({
        message: "Hãy chọn RFID đã dán và SKU mới cần gán.",
        title: "Chưa đủ thông tin",
        tone: "warning",
      });
      return;
    }
    startTransition(async () => {
      const result = await reassignWarehouseInventoryRfidsAction({
        epcs: validSelectedRedefinitionEpcs,
        sessionKey: currentDetail.sessionKey,
        sku: selectedRedefinitionProduct.sku,
      });
      if (applyResult(result, "Đã định nghĩa lại RFID")) {
        if (result.redefinitionSessionKey) {
          setRedefinitionCleanup({
            affectedSessionCount: Math.max(1, result.affectedSessionCount || 1),
            redefinitionSessionKey: result.redefinitionSessionKey,
            sessionKey: result.sessionKey || currentDetail.sessionKey,
          });
        }
        setSelectedRedefinitionEpcs([]);
        setSelectedRedefinitionProduct(null);
        setRedefinitionQuery("");
        setRedefinitionProducts([]);
      }
    });
  };

  const cleanupRedefinedInventorySessions = () => {
    if (!redefinitionCleanup) return;
    const cleanupTarget = redefinitionCleanup;
    startTransition(async () => {
      const result =
        await deleteWarehouseInventoryLinkedAfterRedefinitionAction({
          redefinitionSessionKey: cleanupTarget.redefinitionSessionKey,
          sessionKey: cleanupTarget.sessionKey,
        });
      if (applyResult(result, "Đã dọn các khối kiểm kê liên kết")) {
        const deletedSessionKeys = new Set(
          result.deletedSessionKeys?.length
            ? result.deletedSessionKeys
            : [cleanupTarget.sessionKey],
        );
        // Server là nguồn dữ liệu chính. Lọc thêm ở client để một response UI
        // cũ hoặc selectedKey cũ không thể giữ lại khối vừa xóa trên màn hình.
        setData((current) => ({
          ...current,
          detail:
            current.detail && deletedSessionKeys.has(current.detail.sessionKey)
              ? null
              : current.detail,
          sessions: current.sessions.filter(
            (item) => !deletedSessionKeys.has(item.sessionKey),
          ),
        }));
        setSelectedKey((current) =>
          deletedSessionKeys.has(current) ? "" : current,
        );
        setRedefinitionCleanup(null);
        setBulkSelectedKeys([]);
        setComparisonData(null);
        setComparisonKeys([]);
        setSelectedRedefinitionEpcs([]);
        setTab("sku");
      }
    });
  };

  const removeSelectedRfidsFromSession = () => {
    const currentDetail = data.detail;
    if (!currentDetail || !validSelectedRedefinitionEpcs.length) return;
    startTransition(async () => {
      const result = await removeWarehouseInventorySessionRfidsAction({
        epcs: validSelectedRedefinitionEpcs,
        sessionKey: currentDetail.sessionKey,
      });
      if (applyResult(result, "Đã hiệu chỉnh phiên kiểm kê")) {
        setSelectedRedefinitionEpcs([]);
        setShowRemoveSessionRfids(false);
      }
    });
  };

  const cancelSelectedInventoryRfids = () => {
    const currentDetail = data.detail;
    if (!currentDetail || !validSelectedRedefinitionEpcs.length) return;
    startTransition(async () => {
      const result = await cancelWarehouseInventoryRfidsAction({
        epcs: validSelectedRedefinitionEpcs,
        sessionKey: currentDetail.sessionKey,
      });
      if (applyResult(result, "Đã Hủy RFID")) {
        setSelectedRedefinitionEpcs([]);
        setShowCancelInventoryRfids(false);
      }
    });
  };

  const deleteSession = (input: { password: string; reason: string }) => {
    if (!deleteTarget) return;
    startTransition(async () => {
      const result = await deleteWarehouseInventorySessionAction({
        ...input,
        sessionKey: deleteTarget.sessionKey,
      });
      if (applyResult(result, "Đã xóa phiên kiểm kê")) {
        const deletedSessionKey = deleteTarget.sessionKey;
        setDeleteTarget(null);
        setTab("sku");
        setComparisonData(null);
        setComparisonKeys((current) =>
          current.filter((sessionKey) => sessionKey !== deletedSessionKey),
        );
      }
    });
  };

  const copyEndpoint = async () => {
    try {
      const absoluteEndpoint = new URL(endpoint, window.location.origin).href;
      await navigator.clipboard.writeText(absoluteEndpoint);
      toast({
        message: absoluteEndpoint,
        title: "Đã copy endpoint RFID",
        tone: "success",
      });
    } catch {
      toast({
        message: "Trình duyệt không cho phép copy tự động.",
        title: "Không copy được endpoint",
        tone: "error",
      });
    }
  };

  return (
    <div className={styles.workspace}>
      <WriteLoadingOverlay
        message={
          comparisonPending
            ? "Hệ thống đang ghép hai phiên và tính chênh lệch theo SKU..."
            : tab === "redefine"
              ? "Hệ thống đang hiệu chỉnh RFID và tính lại phiên kiểm kê..."
              : "Hệ thống đang nhận diện RFID và thống kê theo SKU..."
        }
        show={pending || comparisonPending}
      />

      <section className={styles.receiverBar}>
        <div className={styles.receiverIdentity}>
          <span className={styles.receiverPulse}>
            <Radio size={19} />
          </span>
          <div>
            <strong>Đầu nhận JSON RFID đang hoạt động</strong>
            <span>POST · action: warehouseInventoryScan</span>
          </div>
        </div>
        <button
          className={styles.endpoint}
          onClick={copyEndpoint}
          title="Copy endpoint"
          type="button"
        >
          <code>{endpoint}</code>
          <Copy size={16} />
        </button>
        <div className={styles.receiverActions}>
          <button
            className={styles.secondaryButton}
            onClick={() => setShowJsonTest(true)}
            type="button"
          >
            <FileJson size={17} />
            JSON thử
          </button>
          <button
            aria-label="Tải lại"
            className={styles.iconButton}
            onClick={refresh}
            title="Tải lại"
            type="button"
          >
            <RefreshCw size={19} />
          </button>
        </div>
      </section>

      <section className={styles.sourceStats}>
        <div>
          <Database size={19} />
          <span>
            <strong>{numberLabel(data.sourceStats.productCount)}</strong> SKU
          </span>
        </div>
        <div>
          <Tags size={19} />
          <span>
            <strong>{numberLabel(data.sourceStats.tagCount)}</strong> RFID đã
            nạp
          </span>
        </div>
        <div>
          <CheckCircle2 size={19} />
          <span>
            <strong>{numberLabel(data.sourceStats.mappedTagCount)}</strong> RFID
            đã gắn SKU
          </span>
        </div>
        <button
          className={styles.syncButton}
          onClick={syncMaster}
          type="button"
        >
          <Server size={17} />
          Đồng bộ danh mục RFID/SKU
        </button>
      </section>

      <div className={styles.shell}>
        <aside className={styles.sidebar}>
          <div className={styles.sidebarHeader}>
            <div>
              <span>Phiên đã nhận</span>
              <strong>{filteredSessions.length}</strong>
            </div>
          </div>
          <div className={styles.sessionFilters}>
            <label className={styles.searchBox}>
              <Search size={17} />
              <input
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Tìm mã phiên, người kiểm kê, máy..."
                value={search}
              />
            </label>
            <div
              aria-label="Lọc phiên theo thời gian"
              className={styles.timeFilterChips}
              role="group"
            >
              {SESSION_TIME_FILTERS.map((filter) => (
                <button
                  aria-pressed={timeFilter === filter.key}
                  className={`${styles.timeFilterChip} ${
                    timeFilter === filter.key ? styles.timeFilterChipActive : ""
                  }`}
                  key={filter.key}
                  onClick={() => setTimeFilter(filter.key)}
                  type="button"
                >
                  {filter.label}
                </button>
              ))}
            </div>
            {timeFilter === "CUSTOM" ? (
              <div className={styles.customDateRange}>
                <label>
                  <span>Từ ngày</span>
                  <input
                    aria-label="Từ ngày"
                    onInput={(event) =>
                      setCustomDateFrom(event.currentTarget.value)
                    }
                    type="date"
                    value={customDateFrom}
                  />
                </label>
                <label>
                  <span>Đến ngày</span>
                  <input
                    aria-label="Đến ngày"
                    onInput={(event) =>
                      setCustomDateTo(event.currentTarget.value)
                    }
                    type="date"
                    value={customDateTo}
                  />
                </label>
              </div>
            ) : null}
            <div className={styles.sessionFilterSummary}>
              <CalendarDays size={13} />
              <span>
                {filteredSessions.length === data.sessions.length
                  ? `${numberLabel(data.sessions.length)} phiên · mới nhất trước`
                  : `${numberLabel(filteredSessions.length)}/${numberLabel(data.sessions.length)} phiên · mới nhất trước`}
              </span>
            </div>
          </div>
          <InventoryComparisonPicker
            onClear={() => {
              setComparisonKeys([]);
              setComparisonData(null);
            }}
            onCompare={compareSelectedSessions}
            pending={comparisonPending}
            sessions={comparisonSessions}
          />
          <InventoryBulkActions
            allFilteredSelected={allFilteredSessionsSelected}
            filteredCount={filteredSessions.length}
            onDelete={() => setShowBulkDelete(true)}
            onMerge={() => setShowMergeSessions(true)}
            onToggleAll={toggleAllFilteredSessions}
            pending={pending}
            selectedCount={bulkSelectedSessions.length}
          />
          <div className={styles.sessionList}>
            {filteredSessions.map((item) => {
              const comparisonIndex = comparisonKeys.indexOf(item.sessionKey);
              return (
                <SessionCard
                  active={selectedKey === item.sessionKey}
                  bulkSelected={bulkSelectedKeys.includes(item.sessionKey)}
                  comparisonIndex={
                    comparisonIndex >= 0 ? ((comparisonIndex + 1) as 1 | 2) : 0
                  }
                  item={item}
                  key={item.sessionKey}
                  onDelete={() => setDeleteTarget(item)}
                  onSelect={() => selectSession(item.sessionKey)}
                  onToggleBulk={() => toggleBulkSession(item.sessionKey)}
                  onToggleComparison={() =>
                    toggleComparisonSession(item.sessionKey)
                  }
                />
              );
            })}
            {!filteredSessions.length ? (
              <div className={styles.sidebarEmpty}>Chưa có phiên phù hợp.</div>
            ) : null}
          </div>
        </aside>

        <main className={styles.detailPanel}>
          {!detail ? (
            <EmptyDetail />
          ) : (
            <>
              <div className={styles.detailHeader}>
                <div>
                  <div className={styles.detailKicker}>
                    <span
                      className={`${styles.statusPill} ${statusTone(detail.processStatus)}`}
                    >
                      {statusLabel(detail.processStatus)}
                    </span>
                    <span>{dateLabel(detail.scanDate)}</span>
                  </div>
                  <h2>{detail.sessionKey}</h2>
                  <p>
                    {detail.area || "Không ghi khu vực"}
                    {detail.shelf ? ` · ${detail.shelf}` : ""}
                  </p>
                </div>
                <div className={styles.detailActions}>
                  <button
                    className={styles.primaryButton}
                    disabled={!detail.comparison.length}
                    onClick={() => setShowPrint(true)}
                    type="button"
                  >
                    <Printer size={17} />
                    In kiểm kê
                  </button>
                </div>
              </div>

              <div className={styles.scanContext}>
                <div>
                  <ScanLine size={17} />
                  <span>Máy quét</span>
                  <strong>{detail.deviceName || "Không ghi nhận"}</strong>
                </div>
                <div>
                  <span>Người kiểm kê</span>
                  <strong>{detail.operatorName || "Chưa ghi họ tên"}</strong>
                </div>
                <div>
                  <span>Tổng lượt đọc</span>
                  <strong>
                    {numberLabel(detail.summary.requestedReadCount)}
                  </strong>
                </div>
                <div>
                  <span>Cập nhật</span>
                  <strong>{timeLabel(detail.updatedAt)}</strong>
                </div>
              </div>

              <div className={styles.summaryGrid}>
                <SummaryCard
                  icon={<ScanLine size={22} />}
                  label="RFID unique đã nhận"
                  value={detail.summary.uniqueRfidCount}
                />
                <SummaryCard
                  icon={<CheckCircle2 size={22} />}
                  label="RFID đã nhận diện"
                  tone="good"
                  value={detail.summary.inStockRfidCount}
                />
                <SummaryCard
                  icon={<Boxes size={22} />}
                  label="SKU đã quét"
                  tone="good"
                  value={detail.summary.physicalSkuCount}
                />
                <SummaryCard
                  icon={<AlertTriangle size={22} />}
                  label="RFID chưa nhận diện"
                  tone={detail.summary.unknownRfidCount ? "bad" : "good"}
                  value={detail.summary.unknownRfidCount}
                />
              </div>

              {detail.summary.unknownRfidCount ? (
                <div className={styles.reviewNotice}>
                  <AlertTriangle size={19} />
                  <div>
                    <strong>Còn RFID chưa liên kết SKU</strong>
                    <span>
                      Các RFID đã nhận diện vẫn được thống kê bình thường. Mở
                      tab Định nghĩa RFID để gán các mã còn thiếu ngay tại phiên
                      này.
                    </span>
                  </div>
                </div>
              ) : null}

              <nav className={styles.tabs}>
                <button
                  className={tab === "sku" ? styles.tabActive : ""}
                  onClick={() => setTab("sku")}
                  type="button"
                >
                  Số lượng theo SKU
                </button>
                <button
                  className={tab === "rfid" ? styles.tabActive : ""}
                  onClick={() => setTab("rfid")}
                  type="button"
                >
                  Chi tiết RFID
                  <span>{detail.scanItems.length}</span>
                </button>
                <button
                  className={tab === "define" ? styles.tabActive : ""}
                  onClick={() => setTab("define")}
                  type="button"
                >
                  Định nghĩa RFID
                  <span>{detail.unknownRfids.length}</span>
                </button>
                <button
                  className={tab === "redefine" ? styles.tabActive : ""}
                  onClick={() => setTab("redefine")}
                  type="button"
                >
                  Định nghĩa lại
                  <span>
                    {
                      detail.scanItems.filter(
                        (item) =>
                          item.sku && item.issuanceStatus !== "CANCELLED",
                      ).length
                    }
                  </span>
                </button>
                <button
                  className={tab === "json" ? styles.tabActive : ""}
                  onClick={() => setTab("json")}
                  type="button"
                >
                  JSON đầu vào
                </button>
              </nav>

              <div className={styles.tabBody}>
                {tab === "sku" ? <SkuTable detail={detail} /> : null}
                {tab === "rfid" ? <RfidTable detail={detail} /> : null}
                {tab === "define" ? (
                  <RfidDefinitionTab
                    detail={detail}
                    onAssign={defineSelectedRfids}
                    onQueryChange={updateDefinitionQuery}
                    onSelectProduct={setSelectedDefinitionProduct}
                    onToggleAll={toggleAllUnknownEpcs}
                    onToggleEpc={toggleUnknownEpc}
                    pending={pending}
                    products={definitionProducts}
                    query={definitionQuery}
                    searchError={definitionSearchError}
                    searching={catalogSearching}
                    selectedEpcs={selectedDefinitionEpcs}
                    selectedProduct={selectedDefinitionProduct}
                  />
                ) : null}
                {tab === "redefine" ? (
                  <RfidRedefinitionTab
                    detail={detail}
                    onAssign={reassignSelectedRfids}
                    onCancel={() => setShowCancelInventoryRfids(true)}
                    onQueryChange={updateRedefinitionQuery}
                    onRemove={() => setShowRemoveSessionRfids(true)}
                    onSelectProduct={setSelectedRedefinitionProduct}
                    onToggleAll={toggleAllRedefinitionEpcs}
                    onToggleEpc={toggleRedefinitionEpc}
                    pending={pending}
                    products={redefinitionProducts}
                    query={redefinitionQuery}
                    searchError={redefinitionSearchError}
                    searching={catalogSearching}
                    selectedEpcs={validSelectedRedefinitionEpcs}
                    selectedProduct={selectedRedefinitionProduct}
                  />
                ) : null}
                {tab === "json" ? <JsonTab detail={detail} /> : null}
              </div>
            </>
          )}
        </main>
      </div>

      {showJsonTest ? (
        <JsonTestModal
          onClose={() => setShowJsonTest(false)}
          onSubmit={submitJson}
          pending={pending}
        />
      ) : null}
      {showPrint && detail ? (
        <PrintModal
          detail={detail}
          onClose={() => setShowPrint(false)}
          onPopupBlocked={() =>
            toast({
              message: "Hãy cho phép popup của trang rồi bấm in lại.",
              title: "Trình duyệt đang chặn cửa sổ in",
              tone: "error",
            })
          }
        />
      ) : null}
      {comparisonData ? (
        <InventoryComparisonModal
          comparison={comparisonData}
          onClose={() => setComparisonData(null)}
          onPopupBlocked={() =>
            toast({
              message: "Hãy cho phép popup của trang rồi bấm in lại.",
              title: "Trình duyệt đang chặn cửa sổ in",
              tone: "error",
            })
          }
        />
      ) : null}
      {deleteTarget ? (
        <DeleteSessionModal
          item={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onConfirm={deleteSession}
          pending={pending}
        />
      ) : null}
      {showBulkDelete && bulkSelectedSessions.length ? (
        <BulkDeleteSessionsModal
          itemCount={bulkSelectedSessions.reduce(
            (total, item) => total + item.itemCount,
            0,
          )}
          onClose={() => setShowBulkDelete(false)}
          onConfirm={deleteBulkSessions}
          pending={pending}
          sessionCount={bulkSelectedSessions.length}
        />
      ) : null}
      {showMergeSessions && bulkSelectedSessions.length >= 2 ? (
        <MergeSessionsModal
          items={bulkSelectedSessions}
          onClose={() => setShowMergeSessions(false)}
          onConfirm={mergeBulkSessions}
          pending={pending}
        />
      ) : null}
      {redefinitionCleanup ? (
        <RedefinitionCleanupModal
          affectedSessionCount={redefinitionCleanup.affectedSessionCount}
          onClose={() => setRedefinitionCleanup(null)}
          onConfirm={cleanupRedefinedInventorySessions}
          pending={pending}
          sessionKey={redefinitionCleanup.sessionKey}
        />
      ) : null}
      {showRemoveSessionRfids && detail ? (
        <RemoveSessionRfidsModal
          count={validSelectedRedefinitionEpcs.length}
          onClose={() => setShowRemoveSessionRfids(false)}
          onConfirm={removeSelectedRfidsFromSession}
          pending={pending}
          sessionKey={detail.sessionKey}
        />
      ) : null}
      {showCancelInventoryRfids && detail ? (
        <CancelInventoryRfidsModal
          count={validSelectedRedefinitionEpcs.length}
          onClose={() => setShowCancelInventoryRfids(false)}
          onConfirm={cancelSelectedInventoryRfids}
          pending={pending}
        />
      ) : null}
    </div>
  );
}
