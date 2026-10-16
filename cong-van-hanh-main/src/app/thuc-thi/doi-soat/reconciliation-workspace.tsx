"use client";

import { useEffect, useMemo, useState } from "react";

import {
  Badge,
  Button,
  FilePicker,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import type {
  ReconciliationHistoryItem,
  ReconciliationWorkspaceData,
} from "@/lib/reconciliation/types";

import {
  refreshReconciliationAction,
  runReconciliationAction,
} from "./actions";

function fileKey(file: File) {
  return `${file.name}::${file.size}::${file.lastModified}`;
}

function formatFileSize(bytes: number) {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function formatFileTime(value: number) {
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}

function periodPreview(month: number, year: number) {
  const from = new Date(year, month - 2, 26);
  const to = new Date(year, month - 1, 25);
  const format = (date: Date) =>
    new Intl.DateTimeFormat("vi-VN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(date);
  return `${format(from)} - ${format(to)} | Tab dự kiến: T${String(
    month,
  ).padStart(2, "0")}.${year}`;
}

function HistoryTable({
  emptyText,
  items,
  linkLabel,
}: {
  emptyText: string;
  items: ReconciliationHistoryItem[];
  linkLabel: string;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-primary/10 bg-white">
      <Table className="table-fixed" style={{ minWidth: 0 }}>
        <TableHead>
          <TableRow>
            <TableHeaderCell>Kỳ</TableHeaderCell>
            <TableHeaderCell>Liên kết</TableHeaderCell>
            <TableHeaderCell>Cập nhật</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {items.length ? (
            items.map((item) => (
              <TableRow key={`${item.kind}-${item.periodCode}`}>
                <TableCell className="font-extrabold text-primary">
                  {item.periodCode}
                </TableCell>
                <TableCell>
                  <a
                    className="font-extrabold text-[#0f4c81] hover:underline"
                    href={item.link}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    {linkLabel}
                  </a>
                </TableCell>
                <TableCell className="text-muted">
                  {item.updatedLabel}
                </TableCell>
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell className="text-muted" colSpan={3}>
                {emptyText}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

export function ReconciliationWorkspace({
  initialData,
}: {
  initialData: ReconciliationWorkspaceData;
}) {
  const now = useMemo(() => new Date(), []);
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [files, setFiles] = useState<File[]>([]);
  const [pickerVersion, setPickerVersion] = useState(0);
  const [workspace, setWorkspace] = useState(initialData);
  const [busy, setBusy] = useState(false);
  const [busySeconds, setBusySeconds] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [status, setStatus] = useState("");
  const { toast } = useToast();

  useEffect(() => {
    if (!busy) return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setBusySeconds(Math.max(1, Math.floor((Date.now() - startedAt) / 1000)));
    }, 700);
    return () => window.clearInterval(timer);
  }, [busy]);

  const addFiles = (selected: File[]) => {
    const skipped: string[] = [];
    const invalid: string[] = [];
    setFiles((current) => {
      const next = [...current];
      const keys = new Set(next.map(fileKey));
      for (const file of selected) {
        if (!/\.(xlsx|xls)$/i.test(file.name)) {
          invalid.push(file.name);
          continue;
        }
        const key = fileKey(file);
        if (keys.has(key)) continue;
        if (next.length >= 2) {
          skipped.push(file.name);
          continue;
        }
        next.push(file);
        keys.add(key);
      }
      return next;
    });
    setPickerVersion((value) => value + 1);
    if (invalid.length) {
      toast({
        message: `Không nhận: ${invalid.join(", ")}`,
        title: "Chỉ nhận file XLS/XLSX",
        tone: "warning",
      });
    } else if (skipped.length) {
      toast({
        message: "Bỏ bớt file nếu muốn chọn lại.",
        title: "Đang giữ tối đa 2 file",
        tone: "warning",
      });
    }
  };

  const removeFile = (index: number) => {
    setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index));
    setPickerVersion((value) => value + 1);
    setStatus("");
  };

  const clearFiles = () => {
    setFiles([]);
    setPickerVersion((value) => value + 1);
    setStatus("");
  };

  const refreshHistory = async () => {
    setRefreshing(true);
    const response = await refreshReconciliationAction();
    setRefreshing(false);
    if (response.error || !response.data) {
      toast({
        message: response.error || "Không tải được lịch sử.",
        title: "Tải lịch sử thất bại",
        tone: "error",
      });
      return;
    }
    setWorkspace(response.data);
    toast({ title: "Đã tải lại lịch sử", tone: "success" });
  };

  const run = async () => {
    if (files.length !== 2) {
      toast({
        message: "Chọn đủ một file Urbox và một file BaseReward.",
        title: "Cần đúng 2 file Excel",
        tone: "warning",
      });
      return;
    }
    setBusySeconds(0);
    setBusy(true);
    setStatus("");
    const formData = new FormData();
    formData.set("month", String(month));
    formData.set("year", String(year));
    files.forEach((file) => formData.append("files", file, file.name));
    const result = await runReconciliationAction(formData);
    setBusy(false);
    setBusySeconds(0);
    if (!result.ok) {
      setStatus(result.message);
      toast({
        message: result.message,
        title: "Không tạo được đối soát",
        tone: "error",
        duration: 8000,
      });
      return;
    }
    if (result.workspace) setWorkspace(result.workspace);
    const counts = result.summary?.voucherRowCounts ?? {};
    const summaryText = [
      result.message,
      `Dòng Urbox trong kỳ: ${Number(
        result.summary?.rowsInPeriod ?? 0,
      ).toLocaleString("vi-VN")}`,
      `Match nhân sự: ${Number(
        result.summary?.matchedTransactions ?? 0,
      ).toLocaleString("vi-VN")}`,
      `Bảng kê Global/Digital/Thành Công: ${counts.Global ?? 0} / ${
        counts.Digital ?? 0
      } / ${counts["Thành Công"] ?? 0}`,
    ].join("\n");
    setStatus(summaryText);
    toast({
      message: result.message,
      title: result.summary?.missingConfig.length
        ? "Đã lưu dữ liệu, còn thiếu cấu hình output"
        : "Đã tạo đối soát",
      tone: result.summary?.missingConfig.length ? "warning" : "success",
      duration: 8000,
    });
  };

  const years = Array.from({ length: 5 }, (_, index) => now.getFullYear() - 2 + index);
  const primaryItems = workspace.primary ? [workspace.primary] : [];

  return (
    <>
      <div className="mt-6 grid items-start gap-[18px] lg:grid-cols-[minmax(0,0.82fr)_minmax(420px,1.18fr)]">
        <section className="grid gap-4 rounded-2xl border border-primary/10 bg-[radial-gradient(circle_at_top_right,var(--brand-shadow-soft),transparent_34%),linear-gradient(145deg,rgba(255,255,255,0.98),rgba(242,247,244,0.95))] p-5 shadow-[0_18px_52px_rgba(17,45,39,0.10)] sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="mb-1 text-xs font-black uppercase text-brand-strong">
                Thực thi
              </p>
              <h2 className="text-xl font-extrabold text-primary">
                Tạo bảng đối soát
              </h2>
              <p className="mt-1 max-w-xl text-sm leading-6 text-muted">
                Chọn kỳ, nạp đúng 2 file Excel gồm Urbox và BaseReward. Hệ
                thống tự nhận diện, kiểm tra rồi tạo bảng trong một lần bấm.
              </p>
            </div>
            <Badge tone={files.length === 2 ? "success" : "warning"}>
              {files.length}/2 file
            </Badge>
          </div>

          {workspace.config.missing.length ? (
            <div className="rounded-xl border border-[#f3d4a0] bg-accent-soft px-4 py-3 text-sm leading-6 text-[#8f5015]">
              <strong>Còn thiếu cấu hình:</strong>{" "}
              {workspace.config.missing.join(", ")}. Hệ thống vẫn lưu run,
              file nguồn và kết quả chuẩn hóa khi kho GCS đã sẵn sàng.
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-2 text-sm font-extrabold text-primary">
              <span>Tháng</span>
              <Select
                disabled={busy}
                onChange={(event) => setMonth(Number(event.target.value))}
                value={month}
              >
                {Array.from({ length: 12 }, (_, index) => index + 1).map(
                  (value) => (
                    <option key={value} value={value}>
                      Tháng {value}
                    </option>
                  ),
                )}
              </Select>
            </label>
            <label className="grid gap-2 text-sm font-extrabold text-primary">
              <span>Năm</span>
              <Select
                disabled={busy}
                onChange={(event) => setYear(Number(event.target.value))}
                value={year}
              >
                {years.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </Select>
            </label>
          </div>

          <div className="rounded-xl bg-primary/7 px-4 py-3 text-sm font-extrabold leading-6 text-primary">
            {periodPreview(month, year)}
          </div>

          <div className="grid gap-2">
            <span className="text-sm font-extrabold text-primary">
              File Excel
            </span>
            <FilePicker
              accept=".xlsx,.xls"
              disabled={busy}
              emptyText="Có thể nạp từng file một."
              key={pickerVersion}
              maxFileSizeBytes={14 * 1024 * 1024}
              maxFiles={2}
              multiple
              onFilesChange={addFiles}
              triggerLabel="Chọn file Urbox / BaseReward"
            />
          </div>

          <div className="grid gap-2.5">
            {files.length ? (
              files.map((file, index) => (
                <article
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-primary/15 bg-white/90 p-3.5"
                  key={fileKey(file)}
                >
                  <div className="min-w-0">
                    <div className="break-words text-sm font-extrabold text-primary">
                      {file.name}
                    </div>
                    <div className="mt-1 text-xs text-muted">
                      {formatFileSize(file.size)} ·{" "}
                      {formatFileTime(file.lastModified)}
                    </div>
                  </div>
                  <Button
                    disabled={busy}
                    onClick={() => removeFile(index)}
                    size="sm"
                    variant="ghost"
                  >
                    Bỏ
                  </Button>
                </article>
              ))
            ) : (
              <div className="rounded-xl border border-dashed border-primary/20 p-5 text-center text-sm leading-6 text-muted">
                Chưa chọn file nào. Có thể nạp từng file một.
              </div>
            )}
          </div>

          <div
            className={`rounded-xl border px-4 py-3 text-sm leading-6 whitespace-pre-line ${
              status
                ? "border-[#b6e2d1] bg-[#e8f8f1] text-[#0c6e4c]"
                : files.length === 2
                  ? "border-[#b6e2d1] bg-[#e8f8f1] text-[#0c6e4c]"
                  : "border-primary/10 bg-surface-muted text-muted"
            }`}
          >
            {status ||
              (files.length === 0
                ? "Chưa chọn file nào."
                : files.length === 1
                  ? "Đã giữ file thứ 1. Chọn tiếp file thứ 2 rồi bấm Tạo đối soát."
                  : "Đã đủ 2 file. Bấm Tạo đối soát để hệ thống tự đọc và sinh bảng.")}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button
              disabled={busy || !files.length}
              onClick={clearFiles}
              variant="ghost"
            >
              Bỏ file
            </Button>
            <Button
              className="min-h-14 min-w-56"
              disabled={busy}
              onClick={run}
            >
              Tạo đối soát
            </Button>
          </div>
        </section>

        <section className="grid gap-4 rounded-2xl border border-primary/10 bg-white/95 p-5 shadow-[0_18px_52px_rgba(17,45,39,0.10)] sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="mb-1 text-xs font-black uppercase text-brand-strong">
                Lịch sử
              </p>
              <h2 className="text-xl font-extrabold text-primary">
                Các kỳ đã tạo
              </h2>
              <p className="mt-1 text-sm leading-6 text-muted">
                Mở lại bảng tổng hợp hoặc bảng kê chi tiết đã sinh trước đó.
              </p>
            </div>
            <Button
              aria-label="Tải lại lịch sử"
              disabled={refreshing || busy}
              onClick={refreshHistory}
              size="icon"
              title="Tải lại lịch sử"
              variant="ghost"
            >
              {refreshing ? "…" : "↻"}
            </Button>
          </div>
          <div className="grid gap-3">
            <HistoryTable
              emptyText={
                workspace.primaryError ||
                "Chưa tìm thấy kỳ nào trong bảng tổng hợp."
              }
              items={primaryItems}
              linkLabel="Mở bảng tổng hợp"
            />
            <HistoryTable
              emptyText={
                workspace.secondaryError ||
                "Chưa thấy file bảng kê nào trong lịch sử."
              }
              items={workspace.secondary}
              linkLabel="Mở file chi tiết"
            />
          </div>
        </section>
      </div>

      {busy ? (
        <div className="fixed inset-0 z-[180] grid place-items-center bg-[rgba(13,32,28,0.32)] px-4 backdrop-blur-[6px]">
          <div className="w-full max-w-md rounded-2xl border border-primary/15 bg-white p-6 shadow-[0_24px_70px_rgba(17,45,39,0.22)]">
            <h3 className="text-lg font-extrabold text-primary">
              Đang tạo đối soát
            </h3>
            <div className="mt-4 flex items-start gap-3 text-sm leading-6 text-muted">
              <span className="mt-0.5 size-6 shrink-0 animate-spin rounded-full border-[3px] border-primary/15 border-t-accent" />
              <span>
                Hệ thống đang đọc file, lưu nguồn và sinh bảng. Đã chờ{" "}
                <strong className="text-primary">{Math.max(1, busySeconds)}s</strong>.
              </span>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
