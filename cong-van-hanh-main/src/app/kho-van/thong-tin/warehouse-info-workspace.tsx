"use client";

import {
  Ban,
  Boxes,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Database,
  Pencil,
  Radio,
  RefreshCw,
  ScanLine,
  Search,
  Smartphone,
  Tags,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { useEffect, useState, useTransition } from "react";

import { useToast, WriteLoadingOverlay } from "@/components/ui/toast";
import type {
  WarehouseInfoWorkspaceData,
  WarehouseInventoryProductOption,
  WarehouseRfidDefinitionSessionItem,
  WarehouseRfidIssuanceStatus,
  WarehouseShelfDefinition,
} from "@/lib/warehouse/types";

import {
  deleteWarehouseRfidTagsAction,
  refreshWarehouseInfoAction,
  reassignWarehouseInfoRfidsAction,
  searchWarehouseInfoProductsAction,
} from "./actions";
import { WarehouseUnitRegistry } from "./warehouse-unit-registry";
import styles from "./warehouse-info.module.css";

type StatusFilter = "ALL" | WarehouseRfidIssuanceStatus;
type RegistryView = "PRODUCT" | "UNIT";

function numberLabel(value: number) {
  return new Intl.NumberFormat("vi-VN").format(value);
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

function issuanceLabel(status: string) {
  return status === "CANCELLED" ? "Hủy" : "Kích hoạt";
}

function sessionStatusLabel(status: string) {
  if (status === "SUCCESS") return "Hoàn tất";
  if (status === "PARTIAL") return "Cần kiểm tra";
  if (status === "FAILED") return "Lỗi";
  return "Đang nhận";
}

function RfidStatusIcon({
  eventType,
  status,
}: {
  eventType?: string;
  status: string;
}) {
  const isError = eventType === "ERROR";
  const isCancelled = status === "CANCELLED";
  const label = isError
    ? "Lỗi cập nhật"
    : eventType === "SKIPPED"
      ? "RFID không thay đổi"
      : issuanceLabel(status);
  return (
    <span
      aria-label={label}
      className={`${styles.statusIcon} ${
        isError || isCancelled ? styles.statusIconBad : styles.statusIconGood
      }`}
      role="img"
      title={label}
    >
      {isError ? (
        <CircleAlert size={17} />
      ) : isCancelled ? (
        <Ban size={17} />
      ) : (
        <CheckCircle2 size={17} />
      )}
    </span>
  );
}

function DeleteRfidsModal({
  count,
  onClose,
  onConfirm,
  pending,
}: {
  count: number;
  onClose: () => void;
  onConfirm: (input: { password: string; reason: string }) => void;
  pending: boolean;
}) {
  const [reason, setReason] = useState("");
  const [password, setPassword] = useState("");
  return (
    <div className={styles.modalBackdrop} role="presentation">
      <form
        aria-labelledby="delete-rfid-title"
        aria-modal="true"
        className={styles.deleteModal}
        onSubmit={(event) => {
          event.preventDefault();
          onConfirm({ password, reason });
        }}
        role="dialog"
      >
        <div className={styles.modalHeader}>
          <div>
            <span>Xóa dữ liệu RFID</span>
            <h2 id="delete-rfid-title">
              Xóa vĩnh viễn {numberLabel(count)} RFID?
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
          <CircleAlert size={20} />
          <span>
            RFID và lịch sử phát hành tương ứng sẽ bị xóa khỏi PostgreSQL. SKU
            và các phiên kiểm kê khác vẫn được giữ nguyên.
          </span>
        </div>
        <label className={styles.deleteField}>
          <span>Lý do xóa</span>
          <textarea
            autoFocus
            maxLength={1200}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Ví dụ: RFID phát hành thử, mã lỗi, dữ liệu không sử dụng..."
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
            <Trash2 size={17} />
            Xóa khỏi PostgreSQL
          </button>
        </div>
      </form>
    </div>
  );
}

function RedefineRfidsModal({
  count,
  onClose,
  onConfirm,
  onQueryChange,
  pending,
  products,
  query,
  searching,
  selectedProduct,
  setSelectedProduct,
}: {
  count: number;
  onClose: () => void;
  onConfirm: () => void;
  onQueryChange: (value: string) => void;
  pending: boolean;
  products: WarehouseInventoryProductOption[];
  query: string;
  searching: boolean;
  selectedProduct: WarehouseInventoryProductOption | null;
  setSelectedProduct: (product: WarehouseInventoryProductOption) => void;
}) {
  return (
    <div className={styles.modalBackdrop} role="presentation">
      <section
        aria-labelledby="redefine-rfid-title"
        aria-modal="true"
        className={styles.redefineModal}
        role="dialog"
      >
        <div className={styles.modalHeader}>
          <div>
            <span>Định nghĩa lại RFID</span>
            <h2 id="redefine-rfid-title">
              Gán {numberLabel(count)} RFID sang SKU khác
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
        <p className={styles.redefineHint}>
          Tìm theo tên hàng, mã SKU hoặc Barcode. Mapping mới sẽ thay thế SKU
          hiện tại trong dữ liệu Kho.
        </p>
        <label className={styles.redefineSearch}>
          <Search size={18} />
          <input
            autoFocus
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Nhập ít nhất 2 ký tự..."
            value={query}
          />
        </label>
        <div className={styles.redefineProducts}>
          {searching ? (
            <span className={styles.redefineEmpty}>Đang tìm SKU...</span>
          ) : null}
          {!searching && query.trim().length >= 2 && !products.length ? (
            <span className={styles.redefineEmpty}>
              Không tìm thấy SKU phù hợp.
            </span>
          ) : null}
          {products.map((product) => (
            <button
              aria-pressed={selectedProduct?.sku === product.sku}
              className={
                selectedProduct?.sku === product.sku
                  ? styles.redefineProductActive
                  : ""
              }
              key={product.sku}
              onClick={() => setSelectedProduct(product)}
              type="button"
            >
              <strong>{product.sku}</strong>
              <span>{product.name}</span>
              <small>
                Barcode: {product.barcode || "—"} ·{" "}
                {numberLabel(product.rfidCount)} RFID
              </small>
            </button>
          ))}
        </div>
        {selectedProduct ? (
          <div className={styles.redefineTarget}>
            <CheckCircle2 size={18} />
            <span>
              SKU đích: <strong>{selectedProduct.sku}</strong> —{" "}
              {selectedProduct.name}
            </span>
          </div>
        ) : null}
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
            disabled={pending || !selectedProduct || !count}
            onClick={onConfirm}
            type="button"
          >
            <Pencil size={17} />
            Gán lại RFID
          </button>
        </div>
      </section>
    </div>
  );
}

function SessionCard({
  active,
  item,
  onSelect,
}: {
  active: boolean;
  item: WarehouseRfidDefinitionSessionItem;
  onSelect: () => void;
}) {
  return (
    <button
      className={`${styles.sessionCard} ${active ? styles.sessionCardActive : ""}`}
      onClick={onSelect}
      type="button"
    >
      <div className={styles.sessionTop}>
        <span
          className={`${styles.sessionStatus} ${
            item.processStatus === "SUCCESS"
              ? styles.sessionGood
              : styles.sessionWarn
          }`}
        >
          {sessionStatusLabel(item.processStatus)}
        </span>
        <span>{timeLabel(item.occurredAt)}</span>
      </div>
      <strong>{item.sku || item.barcode || "Phiên cập nhật trạng thái"}</strong>
      <span className={styles.productName}>
        {item.productName || "Chưa có tên SKU"}
      </span>
      <div className={styles.sessionCounts}>
        <b>{numberLabel(item.createdCount)}</b> cập nhật
        <span>·</span>
        <b>{numberLabel(item.skippedCount)}</b> bỏ qua
        {item.errorCount ? (
          <>
            <span>·</span>
            <b className={styles.errorText}>{item.errorCount}</b> lỗi
          </>
        ) : null}
      </div>
      <div className={styles.sessionPerson}>
        <UserRound size={14} />
        <span>{item.operatorName || "Chưa ghi người phát hành"}</span>
      </div>
      <code>{item.sessionKey}</code>
    </button>
  );
}

export function WarehouseInfoWorkspace({
  initialData,
  initialShelves,
}: {
  initialData: WarehouseInfoWorkspaceData;
  initialShelves: WarehouseShelfDefinition[];
}) {
  const [registryView, setRegistryView] = useState<RegistryView>("PRODUCT");
  const [data, setData] = useState(initialData);
  const [query, setQuery] = useState(initialData.query);
  const [status, setStatus] = useState<StatusFilter>(initialData.status);
  const [selectedEpcs, setSelectedEpcs] = useState<Set<string>>(new Set());
  const [showDelete, setShowDelete] = useState(false);
  const [showRedefine, setShowRedefine] = useState(false);
  const [redefinitionQuery, setRedefinitionQuery] = useState("");
  const [redefinitionProducts, setRedefinitionProducts] = useState<
    WarehouseInventoryProductOption[]
  >([]);
  const [selectedRedefinitionProduct, setSelectedRedefinitionProduct] =
    useState<WarehouseInventoryProductOption | null>(null);
  const [isPending, startTransition] = useTransition();
  const [catalogSearching, startCatalogSearch] = useTransition();
  const { toast } = useToast();

  useEffect(() => {
    const searchQuery = redefinitionQuery.trim();
    if (!showRedefine || searchQuery.length < 2) return;
    const timer = window.setTimeout(() => {
      startCatalogSearch(async () => {
        const result = await searchWarehouseInfoProductsAction(searchQuery);
        if (!result.ok) {
          toast({
            title: "Không tìm được SKU",
            message: result.message,
            tone: "error",
          });
          return;
        }
        setRedefinitionProducts(result.products);
      });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [redefinitionQuery, showRedefine, toast]);

  function load(next: {
    query?: string;
    sessionKey?: string;
    status?: StatusFilter;
  }) {
    startTransition(async () => {
      const result = await refreshWarehouseInfoAction({
        query: next.query ?? query,
        sessionKey: next.sessionKey ?? data.selectedSession?.sessionKey ?? "",
        status: next.status ?? status,
      });
      if (!result.ok || !result.data) {
        toast({
          title: "Không tải được dữ liệu",
          message: result.message,
          tone: "error",
        });
        return;
      }
      setData(result.data);
      setSelectedEpcs(new Set());
      toast({
        title: "Thông tin kho đã cập nhật",
        message: result.message,
        tone: "success",
      });
    });
  }

  function changeStatus(next: StatusFilter) {
    setStatus(next);
    load({ status: next, sessionKey: "" });
  }

  const detail = data.selectedSession;
  const allRegistrySelected =
    data.registry.length > 0 &&
    data.registry.every((row) => selectedEpcs.has(row.epc));

  function toggleRfid(epc: string) {
    setSelectedEpcs((current) => {
      const next = new Set(current);
      if (next.has(epc)) next.delete(epc);
      else next.add(epc);
      return next;
    });
  }

  function toggleAllRfids() {
    setSelectedEpcs(
      allRegistrySelected
        ? new Set()
        : new Set(data.registry.map((row) => row.epc)),
    );
  }

  function deleteSelected(input: { password: string; reason: string }) {
    const epcs = [...selectedEpcs];
    if (!epcs.length) return;
    startTransition(async () => {
      const result = await deleteWarehouseRfidTagsAction({
        epcs,
        password: input.password,
        query,
        reason: input.reason,
        status,
      });
      if (!result.ok || !result.data) {
        toast({
          title: "Không xóa được RFID",
          message: result.message,
          tone: "error",
        });
        return;
      }
      setData(result.data);
      setSelectedEpcs(new Set());
      setShowDelete(false);
      toast({
        title: "Đã xóa RFID",
        message: result.message,
        tone: "success",
      });
    });
  }

  function redefineSelected() {
    if (!selectedRedefinitionProduct || !selectedEpcs.size) return;
    const target = selectedRedefinitionProduct;
    startTransition(async () => {
      const result = await reassignWarehouseInfoRfidsAction({
        epcs: [...selectedEpcs],
        query,
        sku: target.sku,
        status,
      });
      if (!result.ok || !result.data) {
        toast({
          title: "Không định nghĩa lại được RFID",
          message: result.message,
          tone: "error",
        });
        return;
      }
      setData(result.data);
      setSelectedEpcs(new Set());
      setShowRedefine(false);
      setRedefinitionQuery("");
      setRedefinitionProducts([]);
      setSelectedRedefinitionProduct(null);
      toast({
        title: "Đã định nghĩa lại RFID",
        message: result.message,
        tone: "success",
      });
    });
  }

  return (
    <>
      <WriteLoadingOverlay
        message="Đang tải lịch sử Định nghĩa RFID từ PostgreSQL..."
        show={isPending}
      />

      <nav
        aria-label="Nhóm định nghĩa RFID"
        className={styles.registryTabs}
        role="tablist"
      >
        <button
          aria-controls="warehouse-product-registry"
          aria-selected={registryView === "PRODUCT"}
          className={registryView === "PRODUCT" ? styles.registryTabActive : ""}
          onClick={() => setRegistryView("PRODUCT")}
          role="tab"
          type="button"
        >
          <Tags size={17} /> RFID hàng hóa
        </button>
        <button
          aria-controls="warehouse-unit-registry"
          aria-selected={registryView === "UNIT"}
          className={registryView === "UNIT" ? styles.registryTabActive : ""}
          onClick={() => setRegistryView("UNIT")}
          role="tab"
          type="button"
        >
          <Boxes size={17} /> Xe / Kệ
        </button>
      </nav>

      <div
        hidden={registryView !== "PRODUCT"}
        id="warehouse-product-registry"
        role="tabpanel"
      >

      <section className={styles.summaryGrid}>
        <article className={styles.summaryCard}>
          <span className={styles.summaryIcon}>
            <Tags size={22} />
          </span>
          <div>
            <strong>{numberLabel(data.stats.totalCount)}</strong>
            <span>RFID đã phát hành</span>
          </div>
        </article>
        <article className={`${styles.summaryCard} ${styles.summaryActive}`}>
          <span className={styles.summaryIcon}>
            <CheckCircle2 size={22} />
          </span>
          <div>
            <strong>{numberLabel(data.stats.activeCount)}</strong>
            <span>Đang Kích hoạt</span>
          </div>
        </article>
        <article className={`${styles.summaryCard} ${styles.summaryCancelled}`}>
          <span className={styles.summaryIcon}>
            <Ban size={22} />
          </span>
          <div>
            <strong>{numberLabel(data.stats.cancelledCount)}</strong>
            <span>Đã Hủy</span>
          </div>
        </article>
        <article className={styles.summaryCard}>
          <span className={styles.summaryIcon}>
            <Boxes size={22} />
          </span>
          <div>
            <strong>{numberLabel(data.stats.issuedSkuCount)}</strong>
            <span>SKU đã được gán</span>
          </div>
        </article>
      </section>

      <section className={styles.toolbar}>
        <form
          className={styles.searchForm}
          onSubmit={(event) => {
            event.preventDefault();
            load({ query, sessionKey: "" });
          }}
        >
          <label htmlFor="warehouse-rfid-search">Tìm kiếm RFID</label>
          <div>
            <Search size={19} />
            <input
              id="warehouse-rfid-search"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Nhập EPC, SKU, tên hàng, người phát hành hoặc mã phiên..."
              value={query}
            />
            <button disabled={isPending} type="submit">
              Tìm
            </button>
          </div>
        </form>
        <div className={styles.statusFilter}>
          <span>Tình trạng sử dụng</span>
          <div>
            {(
              [
                ["ALL", "Tất cả"],
                ["ACTIVE", "Kích hoạt"],
                ["CANCELLED", "Hủy"],
              ] as const
            ).map(([key, label]) => (
              <button
                className={status === key ? styles.filterActive : ""}
                key={key}
                onClick={() => changeStatus(key)}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <button
          aria-label="Tải lại Thông tin kho"
          className={styles.refreshButton}
          disabled={isPending}
          onClick={() => load({})}
          title="Tải lại"
          type="button"
        >
          <RefreshCw size={21} />
        </button>
      </section>

      <section className={styles.workspace}>
        <aside className={styles.sessionsPanel}>
          <div className={styles.panelHeading}>
            <div>
              <Radio size={19} />
              <strong>Phiên phát hành</strong>
            </div>
            <span>{data.sessions.length} phiên gần nhất</span>
          </div>
          <button
            className={`${styles.allRegistryButton} ${!detail ? styles.allRegistryActive : ""}`}
            onClick={() => load({ sessionKey: "" })}
            type="button"
          >
            <Database size={18} />
            <span>
              <strong>Toàn bộ sổ RFID</strong>
              <small>Tra cứu theo hiện trạng mới nhất</small>
            </span>
          </button>
          <div className={styles.sessionList}>
            {data.sessions.map((item) => (
              <SessionCard
                active={detail?.sessionKey === item.sessionKey}
                item={item}
                key={item.sessionKey}
                onSelect={() => load({ sessionKey: item.sessionKey })}
              />
            ))}
            {!data.sessions.length ? (
              <div className={styles.sessionEmpty}>
                Chưa nhận phiên Định nghĩa RFID nào từ máy quét mới.
              </div>
            ) : null}
          </div>
        </aside>

        <div className={styles.registryPanel}>
          <div className={styles.registryHeader}>
            <div>
              <span>
                {detail ? "Chi tiết phiên Định nghĩa RFID" : "Sổ đăng ký RFID"}
              </span>
              <h2>{detail ? detail.sessionKey : "RFID đã phát hành"}</h2>
              <p>
                {detail
                  ? `${detail.operatorName || "Chưa ghi người phát hành"} · ${timeLabel(detail.occurredAt)}`
                  : `Cập nhật lúc ${timeLabel(data.generatedAt)} · hiển thị tối đa 1.000 kết quả gần nhất`}
              </p>
            </div>
            {detail ? (
              <span
                className={`${styles.issuanceBadge} ${detail.issuanceStatus === "CANCELLED" ? styles.cancelledBadge : styles.activeBadge}`}
              >
                {issuanceLabel(detail.issuanceStatus)}
              </span>
            ) : selectedEpcs.size ? (
              <div className={styles.selectionActions}>
                <span>Đã chọn {numberLabel(selectedEpcs.size)}</span>
                <button
                  aria-label={`Định nghĩa lại ${selectedEpcs.size} RFID đã chọn`}
                  className={styles.redefineSelectionButton}
                  onClick={() => setShowRedefine(true)}
                  title="Định nghĩa lại RFID đã chọn"
                  type="button"
                >
                  <Pencil size={18} />
                </button>
                <button
                  aria-label={`Xóa ${selectedEpcs.size} RFID đã chọn`}
                  onClick={() => setShowDelete(true)}
                  title="Xóa RFID đã chọn"
                  type="button"
                >
                  <Trash2 size={19} />
                </button>
              </div>
            ) : null}
          </div>

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  {!detail ? (
                    <th className={styles.selectCell}>
                      <input
                        aria-label="Chọn tất cả RFID đang hiển thị"
                        checked={allRegistrySelected}
                        onChange={toggleAllRfids}
                        type="checkbox"
                      />
                    </th>
                  ) : null}
                  <th>RFID / EPC</th>
                  <th>SKU / Tên hàng</th>
                  <th>Người phát hành</th>
                  <th>Thời điểm</th>
                  <th className={styles.statusColumn}>Tình trạng</th>
                  <th>Thiết bị / Phiên</th>
                </tr>
              </thead>
              <tbody>
                {detail
                  ? detail.events.map((row) => (
                      <tr key={row.epc}>
                        <td>
                          <code className={styles.epc}>{row.epc}</code>
                        </td>
                        <td>
                          <strong>{row.sku || "—"}</strong>
                          <span>{row.productName || "Chưa có tên SKU"}</span>
                        </td>
                        <td>
                          <strong>{row.operatorName || "—"}</strong>
                        </td>
                        <td>{timeLabel(row.occurredAt)}</td>
                        <td className={styles.statusColumn}>
                          <RfidStatusIcon
                            eventType={row.eventType}
                            status={row.issuanceStatus}
                          />
                          {row.message ? (
                            <small className={styles.rowMessage}>
                              {row.message}
                            </small>
                          ) : null}
                        </td>
                        <td>
                          <span className={styles.device}>
                            <Smartphone size={14} />
                            {row.deviceName || "—"}
                          </span>
                        </td>
                      </tr>
                    ))
                  : data.registry.map((row) => (
                      <tr key={row.epc}>
                        <td className={styles.selectCell}>
                          <input
                            aria-label={`Chọn RFID ${row.epc}`}
                            checked={selectedEpcs.has(row.epc)}
                            onChange={() => toggleRfid(row.epc)}
                            type="checkbox"
                          />
                        </td>
                        <td>
                          <code className={styles.epc}>{row.epc}</code>
                        </td>
                        <td>
                          <strong>{row.sku || "—"}</strong>
                          <span>{row.productName || "Chưa có tên SKU"}</span>
                        </td>
                        <td>
                          <strong>{row.issuedByName || "—"}</strong>
                          {row.cancelledByName ? (
                            <span>Hủy bởi: {row.cancelledByName}</span>
                          ) : null}
                        </td>
                        <td>
                          <span className={styles.time}>
                            <Clock3 size={14} />
                            {timeLabel(row.issuedAt)}
                          </span>
                          {row.cancelledAt ? (
                            <small>Hủy: {timeLabel(row.cancelledAt)}</small>
                          ) : null}
                        </td>
                        <td className={styles.statusColumn}>
                          <RfidStatusIcon status={row.issuanceStatus} />
                          <small className={styles.stockStatus}>
                            Kho: {row.stockStatus || "—"}
                          </small>
                        </td>
                        <td>
                          <span className={styles.device}>
                            <Smartphone size={14} />
                            {row.issuedDeviceName || "—"}
                          </span>
                          <code className={styles.sessionCode}>
                            {row.issuanceSessionKey || "—"}
                          </code>
                        </td>
                      </tr>
                    ))}
                {!detail && !data.registry.length ? (
                  <tr>
                    <td className={styles.emptyTable} colSpan={7}>
                      <ScanLine size={28} />
                      <strong>Không có RFID phù hợp</strong>
                      <span>
                        Thử đổi từ khóa hoặc bộ lọc tình trạng sử dụng.
                      </span>
                    </td>
                  </tr>
                ) : null}
                {detail && !detail.events.length ? (
                  <tr>
                    <td className={styles.emptyTable} colSpan={6}>
                      Phiên này chưa có dòng RFID.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </section>
      </div>

      <div
        hidden={registryView !== "UNIT"}
        id="warehouse-unit-registry"
        role="tabpanel"
      >
        <WarehouseUnitRegistry initialItems={initialShelves} />
      </div>
      {showDelete && selectedEpcs.size ? (
        <DeleteRfidsModal
          count={selectedEpcs.size}
          onClose={() => setShowDelete(false)}
          onConfirm={deleteSelected}
          pending={isPending}
        />
      ) : null}
      {showRedefine && selectedEpcs.size ? (
        <RedefineRfidsModal
          count={selectedEpcs.size}
          onClose={() => {
            setShowRedefine(false);
            setRedefinitionQuery("");
            setRedefinitionProducts([]);
            setSelectedRedefinitionProduct(null);
          }}
          onConfirm={redefineSelected}
          onQueryChange={(value) => {
            setRedefinitionQuery(value);
            if (value.trim().length < 2) setRedefinitionProducts([]);
            setSelectedRedefinitionProduct(null);
          }}
          pending={isPending}
          products={redefinitionProducts}
          query={redefinitionQuery}
          searching={catalogSearching}
          selectedProduct={selectedRedefinitionProduct}
          setSelectedProduct={setSelectedRedefinitionProduct}
        />
      ) : null}
    </>
  );
}
