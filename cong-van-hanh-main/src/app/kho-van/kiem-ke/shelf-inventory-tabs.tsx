"use client";

import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { AlertTriangle, Trash2, X } from "lucide-react";
import {
  compareShelfInventoryReportsAction,
  deleteShelfInventoryReportAction,
  deleteShelfInventorySessionAction,
  mergeShelfInventorySessions,
  readShelfResults,
  readShelfSavedReports,
  readShelfWarehouseReport,
} from "./shelf-actions";
import {
  openShelfReportComparisonPrint,
  openShelfWarehouseReportPrint,
  type ShelfReportComparison,
  type ShelfSavedReportSummary,
  type ShelfWarehouseReport,
} from "./shelf-report";
import {
  shelfEntityType,
  shelfPositions,
} from "@/lib/warehouse/shelf-report-domain";
import styles from "./shelf-inventory.module.css";

type Summary = {
  session_id: string;
  shelf_id: string;
  shelf_name: string;
  shelf_code: string;
  warehouse: string;
  operator_name: string;
  received_at: string;
  scanned_quantity: number;
  final_quantity: number;
  sku_count: number;
  entity_type: "SHELF" | "VEHICLE";
  floor_count: number;
};
type Line = { sku: string; name: string; quantity: number; floor: number };
type Detail = {
  sessionId: string;
  shelfName: string;
  shelfCode: string;
  warehouse: string;
  entityType: "SHELF" | "VEHICLE";
  floorCount: number;
  operatorName: string;
  deviceName: string;
  submittedAt: string;
  excludedReadCount: number;
  scanned: Omit<Line, "floor">[];
  lines: Line[];
};
type DeleteTarget = {
  id: string;
  itemCount: number;
  kind: "session" | "report";
  title: string;
};
const number = (value: number) => value.toLocaleString("vi-VN");
const date = (value: string) =>
  new Date(value).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
const delta = (value: number) => `${value > 0 ? "+" : ""}${number(value)}`;
const unitName = (entityType: "SHELF" | "VEHICLE") =>
  entityType === "VEHICLE" ? "Xe" : "Kệ";
const positionName = (floor: number) =>
  floor === 0 ? "Hàng hóa trên xe" : `Tầng ${floor}`;
const emptyPositionName = (floor: number) =>
  floor === 0 ? "Xe trống" : "Tầng trống";

export function ShelfInventoryTabs({ children }: { children: ReactNode }) {
  const [tab, setTab] = useState("product");
  return (
    <>
      <div className={styles.tabs} role="tablist" aria-label="Loại kiểm kê">
        <button
          id="product-tab"
          role="tab"
          aria-selected={tab === "product"}
          aria-controls="product-panel"
          onClick={() => setTab("product")}
        >
          Kiểm kê RFID
        </button>
        <button
          id="shelf-tab"
          role="tab"
          aria-selected={tab === "shelf"}
          aria-controls="shelf-panel"
          onClick={() => setTab("shelf")}
        >
          Kiểm kê Kệ/Xe
        </button>
      </div>
      <div
        id="product-panel"
        role="tabpanel"
        aria-labelledby="product-tab"
        hidden={tab !== "product"}
      >
        {children}
      </div>
      <div
        id="shelf-panel"
        role="tabpanel"
        aria-labelledby="shelf-tab"
        hidden={tab !== "shelf"}
      >
        {tab === "shelf" && <ShelfResults />}
      </div>
    </>
  );
}

function ShelfResults() {
  const [mode, setMode] = useState<"sessions" | "reports">("sessions");
  const [rows, setRows] = useState<Summary[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [selected, setSelected] = useState<Summary[]>([]);
  const [report, setReport] = useState<ShelfWarehouseReport | null>(null);
  const [savedRows, setSavedRows] = useState<ShelfSavedReportSummary[]>([]);
  const [savedOffset, setSavedOffset] = useState(0);
  const [savedHasMore, setSavedHasMore] = useState(false);
  const [savedLoaded, setSavedLoaded] = useState(false);
  const [comparisonIds, setComparisonIds] = useState<string[]>([]);
  const [comparison, setComparison] = useState<ShelfReportComparison | null>(
    null,
  );
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busy, startTransition] = useTransition();
  const request = useRef(0);

  function load(next: number) {
    const id = ++request.current;
    setError("");
    startTransition(async () => {
      try {
        const result = await readShelfResults(next);
        if (id !== request.current) return;
        if (!result.ok) {
          setError(result.message);
          return;
        }
        setRows(result.data.sessions);
        setOffset(next);
        setHasMore(result.data.hasMore);
        setLoaded(true);
      } catch {
        setError("Mất kết nối. Vui lòng tải lại kết quả kệ.");
      }
    });
  }

  function loadReports(next: number) {
    const id = ++request.current;
    setError("");
    startTransition(async () => {
      try {
        const result = await readShelfSavedReports(next);
        if (id !== request.current) return;
        if (!result.ok) {
          setError(result.message);
          return;
        }
        setSavedRows(result.data.reports);
        setSavedOffset(next);
        setSavedHasMore(result.data.hasMore);
        setSavedLoaded(true);
      } catch {
        setError("Mất kết nối. Vui lòng tải lại báo cáo đã ghép.");
      }
    });
  }

  useEffect(() => {
    let active = true;
    const id = ++request.current;
    void readShelfResults(0)
      .then((result) => {
        if (!active || id !== request.current) return;
        if (!result.ok) {
          setError(result.message);
          return;
        }
        setRows(result.data.sessions);
        setOffset(0);
        setHasMore(result.data.hasMore);
        setLoaded(true);
      })
      .catch(() => {
        if (active) setError("Mất kết nối. Vui lòng tải lại kết quả kệ.");
      });
    return () => {
      active = false;
    };
  }, []);

  function changeMode(next: "sessions" | "reports") {
    setMode(next);
    setError("");
    setNotice("");
    if (next === "reports" && !savedLoaded) loadReports(0);
  }

  function select(sessionId: string) {
    const id = ++request.current;
    setError("");
    setNotice("");
    startTransition(async () => {
      try {
        const result = await readShelfResults(0, sessionId);
        if (id !== request.current) return;
        if (!result.ok) {
          setError(result.message);
          return;
        }
        setDetail(result.data.session);
        setReport(null);
      } catch {
        setError("Mất kết nối. Vui lòng thử mở phiên lại.");
      }
    });
  }

  function selectSavedReport(reportId: string) {
    const id = ++request.current;
    setError("");
    setNotice("");
    startTransition(async () => {
      try {
        const result = await readShelfSavedReports(0, reportId);
        if (id !== request.current) return;
        if (!result.ok) {
          setError(result.message);
          return;
        }
        setReport(result.data);
        setComparison(null);
      } catch {
        setError("Mất kết nối. Vui lòng mở lại báo cáo.");
      }
    });
  }

  function toggleSelection(row: Summary) {
    setReport(null);
    setNotice("");
    setSelected((current) => {
      if (current.some((item) => item.session_id === row.session_id)) {
        setError("");
        return current.filter((item) => item.session_id !== row.session_id);
      }
      if (current.length >= 100) {
        setError("Mỗi báo cáo được chọn tối đa 100 Kệ/Xe.");
        return current;
      }
      if (current.length && current[0].warehouse !== row.warehouse) {
        setError(
          `Báo cáo đang chọn dữ liệu thuộc ${current[0].warehouse}. Hãy bỏ chọn trước khi chuyển khu vực.`,
        );
        return current;
      }
      if (current.some((item) => item.shelf_id === row.shelf_id)) {
        setError(
          `${unitName(row.entity_type)} ${row.shelf_name} đã có một phiên trong báo cáo.`,
        );
        return current;
      }
      setError("");
      return [...current, row];
    });
  }

  function selectVisible() {
    setReport(null);
    setNotice("");
    setSelected((current) => {
      const warehouse = current[0]?.warehouse || rows[0]?.warehouse;
      const next = [...current];
      for (const row of rows)
        if (
          row.warehouse === warehouse &&
          !next.some((item) => item.shelf_id === row.shelf_id) &&
          next.length < 100
        )
          next.push(row);
      setError("");
      return next;
    });
  }

  function createReport() {
    if (!selected.length) return;
    const id = ++request.current;
    setError("");
    setNotice("");
    startTransition(async () => {
      try {
        const result = await readShelfWarehouseReport(
          selected.map((row) => row.session_id),
        );
        if (id !== request.current) return;
        if (!result.ok) {
          setError(result.message);
          return;
        }
        setReport(result.data);
        setDetail(null);
      } catch {
        setError("Mất kết nối. Vui lòng tạo lại báo cáo toàn kho.");
      }
    });
  }

  function mergeSessions() {
    if (selected.length < 2) return;
    const id = ++request.current;
    setError("");
    setNotice("");
    startTransition(async () => {
      try {
        const result = await mergeShelfInventorySessions(
          selected.map((row) => row.session_id),
        );
        if (id !== request.current) return;
        if (!result.ok) {
          setError(result.message);
          return;
        }
        const list = await readShelfSavedReports(0);
        if (id !== request.current) return;
        if (list.ok) {
          setSavedRows(list.data.reports);
          setSavedHasMore(list.data.hasMore);
          setSavedOffset(0);
          setSavedLoaded(true);
        }
        setReport(result.data);
        setComparison(null);
        setComparisonIds([]);
        setSelected([]);
        setMode("reports");
        setNotice(result.message);
      } catch {
        setError("Mất kết nối. Vui lòng ghép lại các phiên kệ.");
      }
    });
  }

  function toggleComparison(item: ShelfSavedReportSummary) {
    setComparison(null);
    setNotice("");
    setComparisonIds((current) => {
      if (current.includes(item.reportId)) {
        setError("");
        return current.filter((id) => id !== item.reportId);
      }
      const first = savedRows.find((row) => row.reportId === current[0]);
      if (first && first.warehouse !== item.warehouse) {
        setError(
          `Đang chọn báo cáo thuộc ${first.warehouse}. Hai báo cáo so sánh phải cùng kho.`,
        );
        return current;
      }
      setError("");
      return current.length < 2
        ? [...current, item.reportId]
        : [current[0], item.reportId];
    });
  }

  function runComparison() {
    if (comparisonIds.length !== 2) return;
    const id = ++request.current;
    setError("");
    setNotice("");
    startTransition(async () => {
      try {
        const result = await compareShelfInventoryReportsAction({
          inputReportId: comparisonIds[0],
          outputReportId: comparisonIds[1],
        });
        if (id !== request.current) return;
        if (!result.ok) {
          setError(result.message);
          return;
        }
        setComparison(result.data);
        setReport(null);
        setNotice(result.message);
      } catch {
        setError("Mất kết nối. Vui lòng so sánh lại hai báo cáo.");
      }
    });
  }

  function deleteBlock(input: { password: string; reason: string }) {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteError("");
    setError("");
    setNotice("");
    startTransition(async () => {
      try {
        const result =
          target.kind === "session"
            ? await deleteShelfInventorySessionAction({
                ...input,
                sessionId: target.id,
              })
            : await deleteShelfInventoryReportAction({
                ...input,
                reportId: target.id,
              });
        if (!result.ok) {
          setDeleteError(result.message);
          return;
        }
        if (target.kind === "session") {
          setRows((current) =>
            current.filter((row) => row.session_id !== target.id),
          );
          setSelected((current) =>
            current.filter((row) => row.session_id !== target.id),
          );
          setDetail((current) =>
            current?.sessionId === target.id ? null : current,
          );
          setReport(null);
        } else {
          setSavedRows((current) =>
            current.filter((row) => row.reportId !== target.id),
          );
          setComparisonIds((current) =>
            current.filter((id) => id !== target.id),
          );
          setReport((current) =>
            current?.reportId === target.id ? null : current,
          );
          setComparison(null);
        }
        setDeleteTarget(null);
        setNotice(result.message);
      } catch {
        setDeleteError(
          `Mất kết nối. Không xóa được ${target.kind === "session" ? "phiên" : "báo cáo"} Kệ/Xe.`,
        );
      }
    });
  }

  const scanned =
    detail?.scanned.reduce((sum, row) => sum + row.quantity, 0) ?? 0;
  const final = detail?.lines.reduce((sum, row) => sum + row.quantity, 0) ?? 0;
  return (
    <section className={styles.workspace} aria-busy={busy}>
      <div className={styles.heading}>
        <div>
          <h1>Kiểm kê Kệ/Xe</h1>
          <p>
            Ghép các phiên Kệ/Xe thành báo cáo toàn khu vực và so sánh hai lần
            kiểm kê.
          </p>
        </div>
        <button
          disabled={busy}
          onClick={() =>
            mode === "sessions" ? load(offset) : loadReports(savedOffset)
          }
        >
          Tải lại
        </button>
      </div>
      <div
        className={styles.innerTabs}
        role="tablist"
        aria-label="Dữ liệu kiểm kê Kệ/Xe"
      >
        <button
          aria-selected={mode === "sessions"}
          onClick={() => changeMode("sessions")}
          role="tab"
        >
          Phiên Kệ/Xe
        </button>
        <button
          aria-selected={mode === "reports"}
          onClick={() => changeMode("reports")}
          role="tab"
        >
          Báo cáo đã ghép
        </button>
      </div>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}
      {busy && <p role="status">Đang xử lý…</p>}
      {mode === "sessions" ? (
        <>
          <div className={styles.selectionBar}>
            <div>
              <strong>Đã chọn {selected.length} phiên Kệ/Xe</strong>
              <span>
                {selected[0]?.warehouse ||
                  "Chọn các phiên cùng khu vực, mỗi Kệ/Xe một phiên"}
              </span>
            </div>
            <div>
              <button disabled={busy || !rows.length} onClick={selectVisible}>
                Chọn trên trang
              </button>
              <button
                disabled={busy || !selected.length}
                onClick={() => {
                  setSelected([]);
                  setReport(null);
                  setError("");
                }}
              >
                Bỏ chọn
              </button>
              <button
                disabled={busy || !selected.length}
                onClick={createReport}
              >
                Xem báo cáo
              </button>
              <button
                className={styles.reportButton}
                disabled={busy || selected.length < 2}
                onClick={mergeSessions}
              >
                Ghép phiên
              </button>
            </div>
          </div>
          <div className={styles.layout}>
            <aside
              className={styles.sessions}
              aria-label="Danh sách phiên Kệ/Xe"
            >
              {!rows.length && loaded && (
                <p>
                  Chưa có kết quả kiểm kê Kệ/Xe. Nộp kết quả từ thẻ Kệ/Xe trên
                  ứng dụng RFID để xem tại đây.
                </p>
              )}
              {rows.map((row) => (
                <div
                  key={row.session_id}
                  className={`${styles.sessionCard} ${selected.some((item) => item.session_id === row.session_id) ? styles.sessionCardSelected : ""}`}
                >
                  <label className={styles.sessionCheck}>
                    <input
                      type="checkbox"
                      disabled={busy}
                      checked={selected.some(
                        (item) => item.session_id === row.session_id,
                      )}
                      onChange={() => toggleSelection(row)}
                    />
                    <span>Chọn để ghép</span>
                  </label>
                  <button
                    aria-label={`Xóa phiên ${row.shelf_name}`}
                    className={styles.deleteCardButton}
                    disabled={busy}
                    onClick={() => {
                      setDeleteError("");
                      setDeleteTarget({
                        id: row.session_id,
                        itemCount: row.sku_count,
                        kind: "session",
                        title: `${unitName(row.entity_type)} · ${row.shelf_name}`,
                      });
                    }}
                    title="Xóa phiên kiểm kê"
                    type="button"
                  >
                    <Trash2 size={15} />
                  </button>
                  <button
                    className={styles.cardMainButton}
                    disabled={busy}
                    aria-pressed={detail?.sessionId === row.session_id}
                    onClick={() => select(row.session_id)}
                  >
                    <strong>
                      {unitName(row.entity_type)} · {row.shelf_name}
                    </strong>
                    <span>
                      {row.shelf_code} · {row.warehouse}
                      {row.entity_type === "SHELF"
                        ? ` · ${row.floor_count} tầng`
                        : ""}
                    </span>
                    <span>
                      {number(row.sku_count)} SKU · {number(row.final_quantity)}{" "}
                      sản phẩm
                    </span>
                    <small>
                      {row.operator_name} · {date(row.received_at)}
                    </small>
                  </button>
                </div>
              ))}
              <Pagination
                busy={busy}
                hasMore={hasMore}
                offset={offset}
                onLoad={load}
              />
            </aside>
            <div>
              {report ? (
                <ShelfReportPreview
                  report={report}
                  onPrintError={() =>
                    setError(
                      "Trình duyệt đang chặn cửa sổ in. Hãy cho phép pop-up rồi thử lại.",
                    )
                  }
                />
              ) : !detail ? (
                <div className={styles.empty}>
                  Chọn một phiên để xem hàng hóa theo Kệ/Xe, hoặc chọn nhiều
                  phiên để xem trước và ghép thành báo cáo khu vực.
                </div>
              ) : (
                <ShelfDetail detail={detail} scanned={scanned} final={final} />
              )}
            </div>
          </div>
        </>
      ) : (
        <>
          <ComparisonPicker
            ids={comparisonIds}
            pending={busy}
            reports={savedRows}
            onClear={() => {
              setComparisonIds([]);
              setComparison(null);
              setError("");
            }}
            onCompare={runComparison}
          />
          <div className={styles.layout}>
            <aside
              className={styles.sessions}
              aria-label="Danh sách báo cáo kệ đã ghép"
            >
              {!savedRows.length && savedLoaded && (
                <p>
                  Chưa có báo cáo đã ghép. Qua thẻ Phiên Kệ/Xe, chọn ít nhất hai
                  đơn vị rồi bấm Ghép phiên.
                </p>
              )}
              {savedRows.map((item) => {
                const comparisonIndex =
                  comparisonIds.indexOf(item.reportId) + 1;
                return (
                  <div
                    className={`${styles.sessionCard} ${report?.reportId === item.reportId ? styles.sessionCardSelected : ""}`}
                    key={item.reportId}
                  >
                    <button
                      className={`${styles.compareToggle} ${comparisonIndex ? styles.compareToggleSelected : ""}`}
                      aria-label={
                        comparisonIndex
                          ? `Bỏ ${item.name} khỏi so sánh`
                          : `Chọn ${item.name} để so sánh`
                      }
                      aria-pressed={Boolean(comparisonIndex)}
                      disabled={busy}
                      onClick={() => toggleComparison(item)}
                    >
                      {comparisonIndex || "⇄"}
                    </button>
                    <button
                      aria-label={`Xóa báo cáo ${item.name}`}
                      className={`${styles.deleteCardButton} ${styles.deleteCardButtonWithCompare}`}
                      disabled={busy}
                      onClick={() => {
                        setDeleteError("");
                        setDeleteTarget({
                          id: item.reportId,
                          itemCount: item.shelfCount,
                          kind: "report",
                          title: item.name,
                        });
                      }}
                      title="Xóa báo cáo đã ghép"
                      type="button"
                    >
                      <Trash2 size={15} />
                    </button>
                    <button
                      className={styles.cardMainButton}
                      disabled={busy}
                      aria-pressed={report?.reportId === item.reportId}
                      onClick={() => selectSavedReport(item.reportId)}
                    >
                      <strong>{item.name}</strong>
                      <span>{item.warehouse}</span>
                      <span>
                        {number(item.shelfCount)} Kệ/Xe ·{" "}
                        {number(item.skuCount)} SKU ·{" "}
                        {number(item.totalQuantity)} sản phẩm
                      </span>
                      <small>
                        {item.preparedBy} · {date(item.createdAt)}
                      </small>
                    </button>
                  </div>
                );
              })}
              <Pagination
                busy={busy}
                hasMore={savedHasMore}
                offset={savedOffset}
                onLoad={loadReports}
              />
            </aside>
            <div>
              {comparison ? (
                <ShelfComparisonPreview
                  comparison={comparison}
                  onPrintError={() =>
                    setError(
                      "Trình duyệt đang chặn cửa sổ in. Hãy cho phép pop-up rồi thử lại.",
                    )
                  }
                />
              ) : report ? (
                <ShelfReportPreview
                  report={report}
                  onPrintError={() =>
                    setError(
                      "Trình duyệt đang chặn cửa sổ in. Hãy cho phép pop-up rồi thử lại.",
                    )
                  }
                />
              ) : (
                <div className={styles.empty}>
                  Mở một báo cáo đã ghép để xem đầy đủ từng Kệ/Xe, hoặc chọn lần
                  lượt hai báo cáo để so sánh đầu vào và đầu ra.
                </div>
              )}
            </div>
          </div>
        </>
      )}
      {deleteTarget ? (
        <DeleteShelfBlockModal
          error={deleteError}
          item={deleteTarget}
          onClose={() => {
            setDeleteError("");
            setDeleteTarget(null);
          }}
          onConfirm={deleteBlock}
          pending={busy}
        />
      ) : null}
    </section>
  );
}

function DeleteShelfBlockModal({
  error,
  item,
  onClose,
  onConfirm,
  pending,
}: {
  error: string;
  item: DeleteTarget;
  onClose: () => void;
  onConfirm: (input: { password: string; reason: string }) => void;
  pending: boolean;
}) {
  const [reason, setReason] = useState("");
  const [password, setPassword] = useState("");
  const isReport = item.kind === "report";
  return (
    <div className={styles.deleteBackdrop} role="presentation">
      <form
        aria-labelledby="delete-shelf-block-title"
        aria-modal="true"
        className={styles.deleteModal}
        onSubmit={(event) => {
          event.preventDefault();
          onConfirm({ password, reason });
        }}
        role="dialog"
      >
        <header>
          <div>
            <span>Xóa dữ liệu kiểm kê Kệ/Xe</span>
            <h2 id="delete-shelf-block-title">
              Xóa {isReport ? "báo cáo đã ghép" : "phiên kiểm kê"}?
            </h2>
          </div>
          <button
            aria-label="Đóng"
            disabled={pending}
            onClick={onClose}
            type="button"
          >
            <X size={19} />
          </button>
        </header>
        <div className={styles.deleteWarning}>
          <AlertTriangle size={21} />
          <div>
            <strong>{item.title}</strong>
            <span>
              {isReport
                ? `Báo cáo gồm ${number(item.itemCount)} Kệ/Xe sẽ bị xóa. Các phiên kiểm kê nguồn vẫn được giữ lại.`
                : `Phiên gồm ${number(item.itemCount)} SKU sẽ bị xóa. Báo cáo đã ghép trước đó vẫn giữ nguyên bản chụp dữ liệu.`}
            </span>
          </div>
        </div>
        {error ? (
          <p className={styles.deleteError} role="alert">
            {error}
          </p>
        ) : null}
        <label>
          <span>Lý do xóa</span>
          <textarea
            autoFocus
            maxLength={1200}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Ví dụ: Phiên quét thử, dữ liệu không còn sử dụng..."
            required
            value={reason}
          />
        </label>
        <label>
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
        <footer>
          <button disabled={pending} onClick={onClose} type="button">
            Giữ lại
          </button>
          <button
            className={styles.confirmDelete}
            disabled={pending || !reason.trim() || !password}
            type="submit"
          >
            <Trash2 size={16} /> Xóa khối
          </button>
        </footer>
      </form>
    </div>
  );
}

function Pagination({
  busy,
  hasMore,
  offset,
  onLoad,
}: {
  busy: boolean;
  hasMore: boolean;
  offset: number;
  onLoad: (offset: number) => void;
}) {
  return (
    <div className={styles.pagination}>
      <button
        disabled={busy || offset === 0}
        onClick={() => onLoad(Math.max(0, offset - 30))}
      >
        Trang trước
      </button>
      <span>{offset / 30 + 1}</span>
      <button disabled={busy || !hasMore} onClick={() => onLoad(offset + 30)}>
        Trang sau
      </button>
    </div>
  );
}

function ComparisonPicker({
  ids,
  onClear,
  onCompare,
  pending,
  reports,
}: {
  ids: string[];
  onClear: () => void;
  onCompare: () => void;
  pending: boolean;
  reports: ShelfSavedReportSummary[];
}) {
  return (
    <section className={styles.comparisonPicker}>
      <div className={styles.comparisonTitle}>
        <b>⇄</b>
        <div>
          <strong>So sánh 2 kiểm kê Kệ/Xe</strong>
          <span>Chọn lần lượt báo cáo đầu vào rồi đầu ra</span>
        </div>
      </div>
      <div className={styles.comparisonSlots}>
        {[0, 1].map((index) => {
          const item = reports.find((report) => report.reportId === ids[index]);
          return (
            <div
              className={`${styles.comparisonSlot} ${item ? styles.comparisonSlotSelected : ""}`}
              key={index}
            >
              <b>{index + 1}</b>
              <span>
                <strong>{index === 0 ? "Đầu vào" : "Đầu ra"}</strong>
                <small>
                  {item
                    ? `${item.name} · ${date(item.createdAt)}`
                    : "Chưa chọn báo cáo"}
                </small>
              </span>
            </div>
          );
        })}
      </div>
      <div className={styles.comparisonActions}>
        <button disabled={!ids.length || pending} onClick={onClear}>
          Bỏ chọn
        </button>
        <button
          className={styles.reportButton}
          disabled={ids.length !== 2 || pending}
          onClick={onCompare}
        >
          ⇄ So sánh
        </button>
      </div>
    </section>
  );
}

function ShelfDetail({
  detail,
  final,
  scanned,
}: {
  detail: Detail;
  final: number;
  scanned: number;
}) {
  const positions = shelfPositions(detail);
  return (
    <>
      <header className={styles.shelfTitle}>
        <span>Đã nộp kết quả · {unitName(detail.entityType)}</span>
        <h2>{detail.shelfName}</h2>
        <p>
          {detail.shelfCode} · Khu vực kiểm kê: {detail.warehouse}
          {detail.entityType === "SHELF" ? ` · ${detail.floorCount} tầng` : ""}
        </p>
        <p>
          {detail.operatorName} · {date(detail.submittedAt)}
        </p>
      </header>
      <div className={styles.metrics}>
        <div>
          Đã quét<strong>{number(scanned)}</strong>
        </div>
        <div>
          Sau điều chỉnh<strong>{number(final)}</strong>
        </div>
        <div>
          Chênh lệch<strong>{delta(final - scanned)}</strong>
        </div>
      </div>
      {positions.map((floor) => (
        <section key={floor} className={styles.floor}>
          <h3>
            {positionName(floor)}
            <small>
              {number(
                detail.lines
                  .filter((row) => row.floor === floor)
                  .reduce((sum, row) => sum + row.quantity, 0),
              )}{" "}
              sản phẩm
            </small>
          </h3>
          <div className={styles.products}>
            {detail.lines
              .filter((row) => row.floor === floor)
              .map((row) => (
                <article key={row.sku}>
                  <strong>{row.sku}</strong>
                  <p>{row.name}</p>
                  <b>× {number(row.quantity)}</b>
                </article>
              ))}
            {!detail.lines.some((row) => row.floor === floor) && (
              <p className={styles.emptyFloor}>{emptyPositionName(floor)}</p>
            )}
          </div>
        </section>
      ))}
      <details className={styles.baseline}>
        <summary>Đối chiếu số lượng theo SKU</summary>
        <div className={styles.tableScroll}>
          <table>
            <thead>
              <tr>
                <th>SKU</th>
                <th>Hàng hóa</th>
                <th>Đã quét</th>
                <th>Sau sửa</th>
                <th>Chênh lệch</th>
              </tr>
            </thead>
            <tbody>
              {detail.scanned.map((row) => {
                const quantity = detail.lines
                  .filter((line) => line.sku === row.sku)
                  .reduce((sum, line) => sum + line.quantity, 0);
                return (
                  <tr key={row.sku}>
                    <td>{row.sku}</td>
                    <td>{row.name}</td>
                    <td>{number(row.quantity)}</td>
                    <td>{number(quantity)}</td>
                    <td>{delta(quantity - row.quantity)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </details>
      <p className={styles.footnote}>
        Thiết bị: {detail.deviceName} · RFID đã loại khỏi lượt quét:{" "}
        {number(detail.excludedReadCount)}
        <br />
        Mã phiên: {detail.sessionId}
      </p>
    </>
  );
}

function ShelfReportPreview({
  report,
  onPrintError,
}: {
  report: ShelfWarehouseReport;
  onPrintError: () => void;
}) {
  const total = report.shelves.reduce(
    (sum, shelf) =>
      sum + shelf.lines.reduce((lineSum, line) => lineSum + line.quantity, 0),
    0,
  );
  const uniqueSkus = new Set(
    report.shelves.flatMap((shelf) => shelf.lines.map((line) => line.sku)),
  ).size;
  const print = () => {
    if (!openShelfWarehouseReportPrint(report)) onPrintError();
  };
  return (
    <div className={styles.reportPreview}>
      <header className={styles.reportTitle}>
        <div>
          <span>
            {report.reportId ? "Báo cáo đã ghép" : "Bản xem trước báo cáo"}
          </span>
          <h2>{report.name || report.warehouse}</h2>
          <p>
            Khu vực kiểm kê: {report.warehouse} · Lập bởi {report.preparedBy} ·{" "}
            {date(report.createdAt || report.generatedAt)}
          </p>
        </div>
        <div className={styles.reportActions}>
          <button onClick={print}>Sinh phiếu</button>
        </div>
      </header>
      <div className={styles.metrics}>
        <div>
          Số Kệ/Xe<strong>{number(report.shelves.length)}</strong>
        </div>
        <div>
          SKU khác nhau<strong>{number(uniqueSkus)}</strong>
        </div>
        <div>
          Tổng hàng hóa<strong>{number(total)}</strong>
        </div>
      </div>
      {report.shelves.map((shelf, index) => {
        const entityType = shelfEntityType(shelf);
        return (
          <section className={styles.reportShelf} key={shelf.sessionId}>
            <header>
              <div>
                <small>
                  {unitName(entityType)} {index + 1}/{report.shelves.length}
                </small>
                <h3>{shelf.shelfName}</h3>
                <p>
                  {shelf.shelfCode}
                  {entityType === "SHELF"
                    ? ` · ${shelf.floorCount || 3} tầng`
                    : ""}
                </p>
              </div>
              <strong>
                {number(
                  shelf.lines.reduce((sum, line) => sum + line.quantity, 0),
                )}
                <span>sản phẩm</span>
              </strong>
            </header>
            <p className={styles.reportSession}>
              Người kiểm kê: {shelf.operatorName} · {date(shelf.submittedAt)}
            </p>
            {shelfPositions(shelf).map((floor) => (
              <div className={styles.reportFloor} key={floor}>
                <h4>
                  {positionName(floor)}
                  <span>
                    {number(
                      shelf.lines
                        .filter((line) => line.floor === floor)
                        .reduce((sum, line) => sum + line.quantity, 0),
                    )}{" "}
                    sản phẩm
                  </span>
                </h4>
                <div>
                  {shelf.lines
                    .filter((line) => line.floor === floor)
                    .map((line) => (
                      <article key={line.sku}>
                        <strong>{line.sku}</strong>
                        <p>{line.name}</p>
                        <b>× {number(line.quantity)}</b>
                      </article>
                    ))}
                  {!shelf.lines.some((line) => line.floor === floor) && (
                    <p className={styles.emptyFloor}>
                      {emptyPositionName(floor)}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </section>
        );
      })}
      {report.reportId && (
        <p className={styles.footnote}>
          Mã báo cáo: {report.reportId} · Lưu từ{" "}
          {report.sourceSessionIds?.length || report.shelves.length} phiên Kệ/Xe
          nguồn.
        </p>
      )}
    </div>
  );
}

function ShelfComparisonPreview({
  comparison,
  onPrintError,
}: {
  comparison: ShelfReportComparison;
  onPrintError: () => void;
}) {
  return (
    <div className={styles.reportPreview}>
      <header className={styles.reportTitle}>
        <div>
          <span>So sánh kiểm kê Kệ/Xe</span>
          <h2>{comparison.warehouse}</h2>
          <p>Khu vực kiểm kê · Chênh lệch = Đầu ra − Đầu vào</p>
        </div>
        <div className={styles.reportActions}>
          <button
            onClick={() => {
              if (!openShelfReportComparisonPrint(comparison)) onPrintError();
            }}
          >
            In so sánh
          </button>
        </div>
      </header>
      <div className={styles.compareMeta}>
        <div>
          <small>1 · Đầu vào</small>
          <strong>{comparison.inputReport.name}</strong>
          <span>{date(comparison.inputReport.createdAt)}</span>
        </div>
        <div>
          <small>2 · Đầu ra</small>
          <strong>{comparison.outputReport.name}</strong>
          <span>{date(comparison.outputReport.createdAt)}</span>
        </div>
      </div>
      {comparison.summary.inputShelfCount !==
        comparison.summary.outputShelfCount && (
        <p className={styles.coverageWarning}>
          Phạm vi hai lần kiểm kê khác nhau: đầu vào có{" "}
          {number(comparison.summary.inputShelfCount)} Kệ/Xe, đầu ra có{" "}
          {number(comparison.summary.outputShelfCount)} Kệ/Xe. Đơn vị thiếu ở
          một phía được tính là 0 ở phía đó.
        </p>
      )}
      <div className={styles.metrics}>
        <div>
          Đầu vào → đầu ra
          <strong>
            {number(comparison.summary.inputQuantity)} →{" "}
            {number(comparison.summary.outputQuantity)}
          </strong>
        </div>
        <div>
          Kệ/Xe thay đổi
          <strong>
            {number(comparison.summary.changedShelfCount)}/
            {number(comparison.summary.shelfCount)}
          </strong>
        </div>
        <div>
          Chênh lệch
          <strong
            className={
              comparison.summary.differenceQuantity < 0
                ? styles.negative
                : styles.positive
            }
          >
            {delta(comparison.summary.differenceQuantity)}
          </strong>
        </div>
      </div>
      {comparison.shelves.map((shelf) => (
        <section className={styles.reportShelf} key={shelf.shelfId}>
          <header>
            <div>
              <small>
                Đối chiếu {unitName(shelf.entityType)} ·{" "}
                {shelf.inputPresent && shelf.outputPresent
                  ? "Có ở cả hai lần"
                  : shelf.inputPresent
                    ? "Chỉ có ở đầu vào"
                    : "Chỉ có ở đầu ra"}
                {shelf.configurationChanged ? " · Đã đổi cấu hình" : ""}
              </small>
              <h3>{shelf.shelfName}</h3>
              <p>{shelf.shelfCode}</p>
            </div>
            <strong>
              {number(shelf.inputQuantity)} → {number(shelf.outputQuantity)}
              <span>{delta(shelf.difference)} sản phẩm</span>
            </strong>
          </header>
          {shelf.floors.map((floor) => (
            <div className={styles.comparisonFloor} key={floor.floor}>
              <h4>
                {positionName(floor.floor)}
                <span>
                  {number(floor.inputQuantity)} → {number(floor.outputQuantity)}{" "}
                  ({delta(floor.difference)})
                </span>
              </h4>
              <div className={styles.tableScroll}>
                <table>
                  <thead>
                    <tr>
                      <th>SKU</th>
                      <th>Hàng hóa</th>
                      <th>Đầu vào</th>
                      <th>Đầu ra</th>
                      <th>Chênh lệch</th>
                    </tr>
                  </thead>
                  <tbody>
                    {floor.lines.map((line) => (
                      <tr key={line.sku}>
                        <td>
                          <strong>{line.sku}</strong>
                        </td>
                        <td>{line.name}</td>
                        <td>{number(line.inputQuantity)}</td>
                        <td>{number(line.outputQuantity)}</td>
                        <td
                          className={
                            line.difference < 0
                              ? styles.negative
                              : styles.positive
                          }
                        >
                          {delta(line.difference)}
                        </td>
                      </tr>
                    ))}
                    {!floor.lines.length && (
                      <tr>
                        <td colSpan={5}>
                          {emptyPositionName(floor.floor)} ở cả hai báo cáo
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
