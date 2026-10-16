"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";

import { useToast } from "@/components/ui/toast";
import type { DigitalSignaturePlacement } from "@/lib/requests/electronic-signature-payload";
import styles from "./pdf-signature-editor.module.css";

type Point = { x: number; y: number };
type Drag = { start: Point; end: Point };

function rectangle(drag: Drag) {
  return {
    x: Math.min(drag.start.x, drag.end.x),
    y: Math.min(drag.start.y, drag.end.y),
    width: Math.abs(drag.end.x - drag.start.x),
    height: Math.abs(drag.end.y - drag.start.y),
  };
}

export function PdfSignatureEditor({
  companyName,
  file,
  onChange,
  placements,
}: {
  companyName: string;
  file: File;
  onChange: (placements: DigitalSignaturePlacement[]) => void;
  placements: DigitalSignaturePlacement[];
}) {
  const { toast } = useToast();
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 });
  const [containerWidth, setContainerWidth] = useState(0);
  const [rendering, setRendering] = useState(true);
  const [error, setError] = useState("");
  const [drag, setDrag] = useState<Drag | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const reportError = useRef(toast);

  useEffect(() => {
    reportError.current = toast;
  }, [toast]);

  useEffect(() => {
    let cancelled = false;
    let loadingTask: ReturnType<typeof import("pdfjs-dist").getDocument> | undefined;
    void (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/api/pdf-worker";
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (cancelled) return;
        const documentOptions = { data: bytes, useSystemFonts: true };
        loadingTask = pdfjs.getDocument(documentOptions);
        const loaded = await loadingTask.promise;
        if (cancelled) return;
        setDocument(loaded);
      } catch {
        if (cancelled) return;
        const message = "Không mở được PDF. Vui lòng chọn PDF hợp lệ và không có mật khẩu.";
        setError(message);
        setRendering(false);
        reportError.current({ title: "Không đọc được tài liệu", message, tone: "error" });
      }
    })();
    return () => {
      cancelled = true;
      void loadingTask?.destroy();
    };
  }, [file]);

  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(([entry]) => {
      setContainerWidth(Math.floor(entry.contentRect.width));
    });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!document || !containerWidth || !canvas.current) return;
    let cancelled = false;
    let renderTask: ReturnType<Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["render"]> | undefined;
    const targetCanvas = canvas.current;
    void (async () => {
      try {
        setRendering(true);
        const pdfPage = await document.getPage(page);
        if (cancelled) return;
        if (pdfPage.rotate % 360 !== 0 || pdfPage.view[0] !== 0 || pdfPage.view[1] !== 0) {
          throw new Error("unsupported-page-geometry");
        }
        const original = pdfPage.getViewport({ scale: 1 });
        const displayScale = containerWidth / original.width;
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = pdfPage.getViewport({ scale: displayScale * pixelRatio });
        targetCanvas.width = Math.ceil(viewport.width);
        targetCanvas.height = Math.ceil(viewport.height);
        setPageSize({ width: original.width, height: original.height });
        renderTask = pdfPage.render({ canvas: targetCanvas, viewport });
        await renderTask.promise;
        if (!cancelled) {
          setError("");
          setRendering(false);
        }
      } catch (issue) {
        if (cancelled || (issue instanceof Error && issue.name === "RenderingCancelledException")) return;
        const message = "Không hiển thị được trang PDF này. Vui lòng chọn lại tài liệu.";
        setError(message);
        setRendering(false);
        reportError.current({ title: "Không đọc được trang", message, tone: "error" });
      }
    })();
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [containerWidth, document, page]);

  function pointerPoint(event: PointerEvent<HTMLDivElement>): Point {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)),
      y: Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height)),
    };
  }

  function finishDrawing(event: PointerEvent<HTMLDivElement>) {
    const current = dragRef.current;
    if (!current) return;
    const next = rectangle({ start: current.start, end: pointerPoint(event) });
    dragRef.current = null;
    setDrag(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    // Ignore accidental clicks; a visible signature needs a meaningful area.
    if (next.width * pageSize.width < 20 || next.height * pageSize.height < 12) {
      toast({ title: "Vùng ký quá nhỏ", message: "Kéo một khung lớn hơn để hiển thị chữ ký rõ ràng.", tone: "warning" });
      return;
    }
    if (placements.length >= 30) {
      toast({ title: "Đã đủ vùng ký", message: "Mỗi hồ sơ được vẽ tối đa 30 vùng ký.", tone: "warning" });
      return;
    }
    onChange([...placements, {
      ...next,
      id: crypto.randomUUID(),
      page,
      pageWidth: pageSize.width,
      pageHeight: pageSize.height,
    }]);
  }

  const pagePlacements = placements.filter((item) => item.page === page);
  const draft = drag ? rectangle(drag) : null;
  const changePage = (next: number) => {
    setRendering(true);
    setDrag(null);
    dragRef.current = null;
    setPage(next);
  };

  return (
    <section aria-label="Vẽ vùng ký trên PDF" className={styles.editor}>
      <div className={styles.heading}>
        <div>
          <strong>Vùng ký số</strong>
          <p>Kéo trên PDF để vẽ khung ký. Có thể vẽ nhiều khung ở nhiều trang.</p>
          <p>Pháp nhân: <strong>{companyName || "Chưa chọn"}</strong></p>
        </div>
        <span className={styles.count}>{placements.length} vùng ký</span>
      </div>
      <div className={styles.toolbar}>
        <button aria-label="Trang trước" disabled={!document || page <= 1} onClick={() => changePage(page - 1)} type="button"><ChevronLeft size={17} /></button>
        <label>Trang <select aria-label="Chọn trang PDF" disabled={!document} onChange={(event) => changePage(Number(event.target.value))} value={page}>
          {Array.from({ length: document?.numPages || 1 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}
        </select> / {document?.numPages || "…"}</label>
        <button aria-label="Trang sau" disabled={!document || page >= document.numPages} onClick={() => changePage(page + 1)} type="button"><ChevronRight size={17} /></button>
        <span>{pagePlacements.length} vùng trên trang này</span>
      </div>
      <div className={styles.viewport} ref={container}>
        <div className={styles.page} style={pageSize.width ? { aspectRatio: `${pageSize.width}/${pageSize.height}` } : undefined}>
          <canvas aria-label={`Nội dung PDF trang ${page}`} className={styles.canvas} ref={canvas} />
          <div
            aria-label={`Kéo để vẽ vùng ký trên trang ${page}`}
            className={styles.drawLayer}
            onPointerCancel={() => { dragRef.current = null; setDrag(null); }}
            onPointerDown={(event) => {
              if (rendering || error || !pageSize.width || event.button !== 0) return;
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              const point = pointerPoint(event);
              dragRef.current = { start: point, end: point };
              setDrag(dragRef.current);
            }}
            onPointerMove={(event) => {
              if (!dragRef.current) return;
              dragRef.current = { start: dragRef.current.start, end: pointerPoint(event) };
              setDrag(dragRef.current);
            }}
            onPointerUp={finishDrawing}
          >
            {pagePlacements.map((placement) => <div className={styles.region} key={placement.id} style={{ left: `${placement.x * 100}%`, top: `${placement.y * 100}%`, width: `${placement.width * 100}%`, height: `${placement.height * 100}%` }}>
              <span>Ký số {placements.indexOf(placement) + 1}</span>
            </div>)}
            {draft ? <div className={`${styles.region} ${styles.draft}`} style={{ left: `${draft.x * 100}%`, top: `${draft.y * 100}%`, width: `${draft.width * 100}%`, height: `${draft.height * 100}%` }} /> : null}
          </div>
          {rendering ? <div className={styles.loading} role="status">Đang mở PDF…</div> : null}
        </div>
      </div>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {placements.length ? <div className={styles.regions}>
        {placements.map((placement, index) => <div className={styles.regionRow} key={placement.id}>
          <button onClick={() => changePage(placement.page)} type="button">Vùng {index + 1} · Trang {placement.page}</button>
          <button aria-label={`Xóa vùng ký ${index + 1}`} onClick={() => onChange(placements.filter((item) => item.id !== placement.id))} type="button"><Trash2 size={14} /></button>
        </div>)}
      </div> : <p className={styles.empty}>Vẽ ít nhất một vùng ký trước khi thêm hồ sơ.</p>}
    </section>
  );
}
