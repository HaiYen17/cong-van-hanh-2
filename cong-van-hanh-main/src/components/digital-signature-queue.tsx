"use client";

import { Check, ExternalLink, FileSignature, FileText, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui";
import { useToast, WriteLoadingOverlay } from "@/components/ui/toast";

import styles from "./digital-signature-queue.module.css";

type SignatureSummary = {
  documentType: string;
  counterparty: string;
  value: string | number | null;
  summary: string;
};

export type DigitalSignatureQueueItem = {
  requestId: string;
  code: string;
  title: string;
  companyName: string;
  createdByName: string;
  createdAt: string;
  status: string;
  statusLabel?: string;
  error?: string | null;
  summary: SignatureSummary | null;
  pdfUrl: string | null;
  signatureCount: number;
  canApprove: boolean;
  canSign: boolean;
  canRetrySummary: boolean;
};

type QueueAction = "approve" | "reject" | "retry-summary" | "sign" | "poll";

const STATUS_LABELS: Record<string, string> = {
  AWAITING_UPLOAD: "Chờ tải PDF",
  AI_QUEUED: "Chờ tóm tắt",
  AI_RUNNING: "Đang tóm tắt",
  AI_FAILED: "Tóm tắt chưa thành công",
  BOD_PENDING: "Chờ BOD duyệt",
  ADMIN_PENDING: "Chờ Admin duyệt ký",
  SIGN_QUEUED: "Chờ xử lý ký",
  SIGN_PENDING: "Chờ xác nhận chữ ký",
  SIGN_FAILED: "Ký chưa thành công",
  SIGN_UNKNOWN: "Cần kiểm tra kết quả ký",
  SIGNED: "Đã ký số",
  REJECTED: "Đã từ chối",
  waiting_input: "Chờ tải PDF",
  waiting_ai_summary: "Chờ tóm tắt",
  summarizing: "Đang tóm tắt",
  summary_processing: "Đang tóm tắt",
  summary_failed: "Tóm tắt chưa thành công",
  waiting_bod_approval: "Chờ BOD duyệt",
  waiting_admin_signature: "Chờ Admin duyệt ký",
  signing: "Đang ký",
  waiting_signature_confirmation: "Chờ xác nhận chữ ký",
  signature_pending: "Chờ kết quả ký",
  signature_failed: "Ký chưa thành công",
  signed: "Đã ký số",
  admin_signed: "Đã ký số",
  rejected: "Đã từ chối",
};

const SIGNING_STATUSES = new Set([
  "SIGN_QUEUED",
  "SIGN_PENDING",
  "SIGN_UNKNOWN",
  "signing",
  "waiting_signature_confirmation",
  "signature_pending",
]);

const BACKGROUND_STATUSES = new Set([
  ...SIGNING_STATUSES,
  "AI_QUEUED",
  "AI_RUNNING",
  "waiting_ai_summary",
  "summarizing",
  "summary_processing",
]);

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : new Intl.DateTimeFormat("vi-VN", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(date);
}

function SummaryDetails({ item }: { item: DigitalSignatureQueueItem }) {
  if (!item.summary) {
    return <p className={styles.muted}>Bản tóm tắt sẽ xuất hiện khi hồ sơ được xử lý xong.</p>;
  }

  return (
    <>
      <dl className={styles.facts}>
        <div><dt>Loại hồ sơ ký</dt><dd>{item.summary.documentType || "Chưa xác định"}</dd></div>
        <div><dt>Ký với ai</dt><dd>{item.summary.counterparty || "Chưa xác định"}</dd></div>
        <div><dt>Giá trị hồ sơ</dt><dd>{item.summary.value ?? "Không nêu trong hồ sơ"}</dd></div>
      </dl>
      <div className={styles.summaryText}>
        <h4>Nội dung tóm tắt</h4>
        <p>{item.summary.summary || "Chưa có nội dung tóm tắt."}</p>
      </div>
    </>
  );
}

export function DigitalSignatureQueue({ mode }: { mode: "bod" | "admin" }) {
  const { toast } = useToast();
  const [items, setItems] = useState<DigitalSignatureQueueItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [focusedId, setFocusedId] = useState("");
  const [showAllSummaries, setShowAllSummaries] = useState(false);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<QueueAction | null>(null);
  const [rejectionNote, setRejectionNote] = useState("");
  const [rejectIds, setRejectIds] = useState<string[]>([]);
  const requestSequence = useRef(0);
  const mounted = useRef(true);
  const rejectDialog = useRef<HTMLDialogElement>(null);
  const selectAll = useRef<HTMLInputElement>(null);
  const pdfPanel = useRef<HTMLElement>(null);

  const load = useCallback(async (silent = false) => {
    const sequence = ++requestSequence.current;
    try {
      const response = await fetch(`/api/requests/digital-signature?mode=${mode}`, {
        cache: "no-store",
      });
      const result = await response.json() as {
        ok?: boolean;
        items?: DigitalSignatureQueueItem[];
        error?: string;
        message?: string;
      };
      if (!response.ok || !result.ok || !Array.isArray(result.items)) {
        throw new Error(result.error || result.message || "Không tải được hàng chờ ký số.");
      }
      if (!mounted.current || sequence !== requestSequence.current) return;
      const nextItems = result.items;
      setItems(nextItems);
      setError("");
      setFocusedId((current) => nextItems.some((item) => item.requestId === current)
        ? current
        : (nextItems[0]?.requestId ?? ""));
      setSelectedIds((current) => new Set(
        nextItems.filter((item) => item.canApprove && current.has(item.requestId))
          .map((item) => item.requestId),
      ));
    } catch (loadError) {
      if (!mounted.current || sequence !== requestSequence.current) return;
      const message = loadError instanceof Error ? loadError.message : "Không tải được hàng chờ ký số.";
      setError(message);
      if (!silent) toast({ title: "Không tải được hồ sơ", message, tone: "error" });
    } finally {
      if (mounted.current && sequence === requestSequence.current) setLoading(false);
    }
  }, [mode, toast]);

  function refresh() {
    setLoading(true);
    void load();
  }

  useEffect(() => {
    let cancelled = false;
    mounted.current = true;
    queueMicrotask(() => {
      if (!cancelled) void load();
    });
    return () => {
      cancelled = true;
      mounted.current = false;
      requestSequence.current += 1;
    };
  }, [load]);

  const hasBackgroundWork = items.some((item) => BACKGROUND_STATUSES.has(item.status));
  useEffect(() => {
    if (!hasBackgroundWork || busy) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(true);
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [busy, hasBackgroundWork, load]);

  const visibleItems = useMemo(() => {
    const term = query.trim().toLocaleLowerCase("vi");
    return term ? items.filter((item) =>
      `${item.title} ${item.code} ${item.companyName} ${item.createdByName}`
        .toLocaleLowerCase("vi").includes(term)) : items;
  }, [items, query]);
  const eligibleIds = visibleItems.filter((item) => item.canApprove).map((item) => item.requestId);
  // Only visible, loaded, still-eligible rows enter an approval operation.
  const selectedVisibleIds = eligibleIds.filter((id) => selectedIds.has(id));
  const allSelected = eligibleIds.length > 0 && selectedVisibleIds.length === eligibleIds.length;
  const someSelected = selectedVisibleIds.length > 0 && !allSelected;
  const focused = visibleItems.find((item) => item.requestId === focusedId) ?? visibleItems[0];

  useEffect(() => {
    if (selectAll.current) selectAll.current.indeterminate = someSelected;
  }, [someSelected]);

  function toggleSelection(id: string, checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function performAction(action: QueueAction, requestIds: string[], note?: string) {
    if (busy || !requestIds.length) return;
    setBusy(action);
    try {
      const response = await fetch("/api/requests/digital-signature", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, requestIds, note }),
      });
      const result = await response.json() as { ok?: boolean; error?: string; message?: string };
      if (!response.ok || !result.ok) {
        throw new Error(result.error || result.message || "Không thực hiện được thao tác.");
      }
      if (!mounted.current) return;
      toast({ title: "Ký số", message: result.message || "Đã xử lý yêu cầu.", tone: "success" });
      if (action === "approve" || action === "reject") {
        setSelectedIds((current) => new Set([...current].filter((id) => !requestIds.includes(id))));
      }
      await load(true);
    } catch (actionError) {
      if (!mounted.current) return;
      toast({
        title: "Chưa thực hiện được",
        message: actionError instanceof Error ? actionError.message : "Vui lòng thử lại.",
        tone: "error",
      });
      // A batch can have progressed before an error; reload authoritative states.
      await load(true);
    } finally {
      if (mounted.current) setBusy(null);
    }
  }

  function openRejection(ids: string[]) {
    if (!ids.length || busy) return;
    setRejectIds(ids);
    setRejectionNote("");
    rejectDialog.current?.showModal();
  }

  function openPdf(item: DigitalSignatureQueueItem) {
    setFocusedId(item.requestId);
    if (window.matchMedia("(max-width: 900px)").matches) {
      pdfPanel.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function renderActions(item: DigitalSignatureQueueItem) {
    return (
      <div className={styles.itemActions}>
        {mode === "bod" && item.canApprove ? <>
          <Button disabled={!!busy} onClick={() => void performAction("approve", [item.requestId])} size="sm">
            <Check aria-hidden="true" size={16} /> Duyệt hồ sơ
          </Button>
          <Button disabled={!!busy} onClick={() => openRejection([item.requestId])} size="sm" variant="secondary">
            Từ chối
          </Button>
        </> : null}
        {mode === "admin" && item.canSign ? (
          <Button disabled={!!busy} onClick={() => void performAction("sign", [item.requestId])} size="sm">
            <FileSignature aria-hidden="true" size={16} /> Duyệt ký
          </Button>
        ) : null}
        {mode === "admin" && SIGNING_STATUSES.has(item.status) ? (
          <Button disabled={!!busy} onClick={() => void performAction("poll", [item.requestId])} size="sm" variant="secondary">
            <RefreshCw aria-hidden="true" size={16} /> Cập nhật kết quả ký
          </Button>
        ) : null}
        {item.canRetrySummary ? (
          <Button disabled={!!busy} onClick={() => void performAction("retry-summary", [item.requestId])} size="sm" variant="secondary">
            <RefreshCw aria-hidden="true" size={16} /> Tóm tắt lại
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <section aria-label={mode === "bod" ? "Duyệt hồ sơ ký số" : "Hàng chờ ký số"} className={styles.queue}>
      <WriteLoadingOverlay message={busy === "sign" ? "Đang gửi yêu cầu ký số..." : busy === "poll" ? "Đang kiểm tra kết quả ký..." : "Đang cập nhật hồ sơ..."} show={!!busy} />
      <div className={styles.heading}>
        <div>
          <h1>{mode === "bod" ? "Duyệt hồ sơ ký số" : "Hàng chờ ký số"}</h1>
          <p>{mode === "bod" ? "Xem tóm tắt và đối chiếu PDF trước khi duyệt hồ sơ của pháp nhân phụ trách." : "Các hồ sơ đã được BOD duyệt sẽ sẵn sàng để Admin duyệt ký."}</p>
        </div>
        <Button aria-label="Làm mới hàng chờ ký số" disabled={loading || !!busy} onClick={refresh} size="icon" variant="secondary">
          <RefreshCw aria-hidden="true" className={loading ? styles.spinning : ""} size={19} />
        </Button>
      </div>

      <div className={styles.toolbar}>
        <label className={styles.search}>
          <span>Tìm hồ sơ</span>
          <input onChange={(event) => setQuery(event.target.value)} placeholder="Tên hồ sơ, mã đơn, pháp nhân..." type="search" value={query} />
        </label>
        <Button aria-pressed={showAllSummaries} onClick={() => setShowAllSummaries((current) => !current)} size="sm" variant={showAllSummaries ? "primary" : "secondary"}>
          <FileText aria-hidden="true" size={16} /> {showAllSummaries ? "Xem từng hồ sơ" : "Tất cả tóm tắt"}
        </Button>
        <span aria-live="polite" className={styles.resultCount}>{visibleItems.length} hồ sơ</span>
      </div>

      {mode === "bod" ? (
        <div className={styles.batchBar}>
          <label className={styles.checkboxLabel}>
            <input checked={allSelected} disabled={!!busy || !eligibleIds.length} onChange={(event) => {
              const checked = event.target.checked;
              setSelectedIds((current) => {
                const next = new Set(current);
                for (const id of eligibleIds) {
                  if (checked) next.add(id);
                  else next.delete(id);
                }
                return next;
              });
            }} ref={selectAll} type="checkbox" />
            Chọn tất cả ({eligibleIds.length} hồ sơ có thể duyệt)
          </label>
          <div className={styles.batchActions}>
            <span>Đã chọn {selectedVisibleIds.length}</span>
            <Button disabled={!!busy || !selectedVisibleIds.length} onClick={() => void performAction("approve", selectedVisibleIds)} size="sm">
              <Check aria-hidden="true" size={16} /> Duyệt đã chọn
            </Button>
            <Button disabled={!!busy || !selectedVisibleIds.length} onClick={() => openRejection(selectedVisibleIds)} size="sm" variant="secondary">Từ chối</Button>
          </div>
        </div>
      ) : null}

      {error ? <div className={styles.error} role="alert">{error} <button onClick={refresh} type="button">Tải lại</button></div> : null}
      {loading && !items.length ? <div aria-live="polite" className={styles.empty} role="status">Đang tải hồ sơ ký số...</div> : null}
      {!loading && !visibleItems.length ? (
        <div className={styles.empty}>
          <FileSignature aria-hidden="true" size={36} />
          <h2>{query ? "Không tìm thấy hồ sơ phù hợp" : "Chưa có hồ sơ ký số"}</h2>
          <p>{query ? "Thử tìm bằng tên hồ sơ hoặc pháp nhân khác." : mode === "bod" ? "Hồ sơ sẽ xuất hiện sau khi được tóm tắt xong." : "Hồ sơ ký số mới sẽ được cập nhật tại đây."}</p>
        </div>
      ) : null}

      {visibleItems.length ? <div className={styles.workspace}>
        <div className={styles.reviewColumn}>
          <div aria-label="Danh sách hồ sơ ký số" className={`${styles.list} ${showAllSummaries ? "" : styles.compactList}`}>
            {visibleItems.map((item) => (
              <article className={`${styles.item} ${focused?.requestId === item.requestId ? styles.activeItem : ""}`} key={item.requestId}>
                <div className={styles.itemHeading}>
                  {mode === "bod" ? <input aria-label={`Chọn hồ sơ ${item.title}`} checked={selectedIds.has(item.requestId) && item.canApprove} className={styles.itemCheckbox} disabled={!!busy || !item.canApprove} onChange={(event) => toggleSelection(item.requestId, event.target.checked)} type="checkbox" /> : null}
                  <button aria-pressed={focused?.requestId === item.requestId} className={styles.itemTitle} onClick={() => setFocusedId(item.requestId)} type="button">
                    <strong>{item.title}</strong>
                    <span>{item.code} · {item.companyName}</span>
                  </button>
                  <span className={`${styles.status} ${item.error ? styles.errorStatus : ""}`}>{item.statusLabel || STATUS_LABELS[item.status] || item.status}</span>
                </div>
                <p className={styles.itemMeta}>{item.createdByName} · {formatDate(item.createdAt)} · {item.signatureCount} vùng ký</p>
                {item.error ? <p className={styles.errorText}>{item.error}</p> : null}
                {showAllSummaries ? <div className={styles.inlineSummary}>
                  <SummaryDetails item={item} />
                  <div className={styles.summaryActions}>
                    <Button onClick={() => openPdf(item)} size="sm" variant="secondary"><FileText aria-hidden="true" size={16} /> Xem PDF</Button>
                    {renderActions(item)}
                  </div>
                </div> : null}
              </article>
            ))}
          </div>
          {!showAllSummaries && focused ? <article aria-label={`Tóm tắt ${focused.title}`} className={styles.detail}>
            <div className={styles.detailHeading}><FileText aria-hidden="true" size={19} /><h2>Tóm tắt hồ sơ đang xem</h2></div>
            <h3>{focused.title}</h3>
            <SummaryDetails item={focused} />
            {renderActions(focused)}
          </article> : null}
        </div>
        <section aria-label="Xem tài liệu PDF" className={styles.pdfPanel} ref={pdfPanel}>
          <div className={styles.pdfHeading}>
            <div><h2>PDF hồ sơ</h2><p>{focused?.title}</p></div>
            {focused?.pdfUrl ? <a className={styles.externalLink} href={focused.pdfUrl} rel="noopener noreferrer" target="_blank"><ExternalLink aria-hidden="true" size={16} /> Mở riêng</a> : null}
          </div>
          {focused?.pdfUrl ? <iframe className={styles.pdf} key={focused.pdfUrl} src={focused.pdfUrl} title={`PDF: ${focused.title}`} /> : <div className={styles.pdfEmpty}>Chưa có PDF để xem.</div>}
        </section>
      </div> : null}

      <dialog aria-labelledby="digital-signature-rejection-title" className={styles.dialog} ref={rejectDialog}>
        <form onSubmit={(event) => {
          event.preventDefault();
          const note = rejectionNote.trim();
          if (!note) return;
          rejectDialog.current?.close();
          void performAction("reject", rejectIds, note);
        }}>
          <div className={styles.dialogHeading}>
            <h2 id="digital-signature-rejection-title">Từ chối {rejectIds.length} hồ sơ</h2>
            <Button aria-label="Đóng" onClick={() => rejectDialog.current?.close()} size="icon" variant="ghost"><X aria-hidden="true" size={20} /></Button>
          </div>
          <label className={styles.noteLabel}>Lý do từ chối<textarea autoFocus maxLength={2000} onChange={(event) => setRejectionNote(event.target.value)} required rows={4} value={rejectionNote} /></label>
          <div className={styles.dialogActions}><Button onClick={() => rejectDialog.current?.close()} variant="secondary">Hủy</Button><Button disabled={!rejectionNote.trim() || !!busy} type="submit" variant="danger">Từ chối hồ sơ</Button></div>
        </form>
      </dialog>
    </section>
  );
}
