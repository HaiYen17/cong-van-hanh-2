"use client";

import {
  useId,
  useState,
  type ChangeEvent,
  type InputHTMLAttributes,
} from "react";

import { cx } from "@/lib/cx";

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function describeFiles(files: File[]) {
  if (!files.length) return "Chưa chọn tệp nào.";
  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (files.length === 1) return `${files[0].name} · ${formatBytes(total)}`;
  if (files.length === 2) {
    return `${files[0].name} | ${files[1].name} · ${formatBytes(total)}`;
  }
  return `${files[0].name} và ${files.length - 1} tệp khác · ${formatBytes(total)}`;
}

type FilePickerProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "className" | "onChange" | "type"
> & {
  emptyText?: string;
  maxFileSizeBytes?: number;
  maxFiles?: number;
  maxTotalSizeBytes?: number;
  onFilesChange?: (files: File[]) => void;
  triggerLabel?: string;
  triggerStyle?: "dashed" | "solid";
};

export function FilePicker({
  disabled,
  emptyText = "Chưa chọn tệp nào.",
  id,
  maxFileSizeBytes,
  maxFiles,
  maxTotalSizeBytes,
  multiple,
  onFilesChange,
  triggerLabel = "Chọn tệp",
  triggerStyle = "solid",
  ...inputProps
}: FilePickerProps) {
  const generatedId = useId();
  const inputId = id ?? `file-picker-${generatedId}`;
  const summaryId = `${inputId}-summary`;
  const [summary, setSummary] = useState(emptyText);
  const [error, setError] = useState("");

  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    const totalSize = files.reduce((sum, file) => sum + file.size, 0);
    let issue = "";

    if (maxFiles && files.length > maxFiles) {
      issue = `Chỉ được chọn tối đa ${maxFiles} tệp.`;
    } else if (
      maxFileSizeBytes &&
      files.some((file) => file.size > maxFileSizeBytes)
    ) {
      issue = `Mỗi tệp không được vượt quá ${formatBytes(maxFileSizeBytes)}.`;
    } else if (maxTotalSizeBytes && totalSize > maxTotalSizeBytes) {
      issue = `Tổng dung lượng không được vượt quá ${formatBytes(maxTotalSizeBytes)}.`;
    }

    if (issue) {
      event.currentTarget.value = "";
      setError(issue);
      setSummary(emptyText);
      onFilesChange?.([]);
      return;
    }

    setError("");
    setSummary(files.length ? describeFiles(files) : emptyText);
    onFilesChange?.(files);
  };

  return (
    <div className="grid gap-2.5 rounded-[20px] border border-primary/10 bg-surface-muted/80 p-3.5">
      <div className="grid items-center gap-2.5 sm:grid-cols-[max-content_minmax(0,1fr)]">
        <input
          aria-describedby={summaryId}
          className="absolute size-px overflow-hidden border-0 p-0 [clip:rect(0,0,0,0)]"
          disabled={disabled}
          id={inputId}
          multiple={multiple}
          onChange={onChange}
          type="file"
          {...inputProps}
        />
        <label
          aria-disabled={disabled}
          className={cx(
            "inline-flex min-h-12 cursor-pointer items-center justify-center rounded-full bg-surface px-[18px] text-center text-sm font-extrabold leading-[1.3] text-primary transition hover:-translate-y-px hover:border-accent/35 hover:shadow-[0_8px_18px_rgba(17,45,39,0.08)]",
            triggerStyle === "dashed"
              ? "border border-dashed border-primary/25"
              : "border border-primary/15",
            disabled && "pointer-events-none cursor-not-allowed opacity-55",
          )}
          htmlFor={inputId}
        >
          {triggerLabel}
        </label>
        <div
          className={cx(
            "flex min-h-12 min-w-0 items-center overflow-hidden rounded-2xl border bg-surface px-3.5 py-2.5 text-sm leading-[1.45] sm:whitespace-nowrap",
            error
              ? "border-danger/30 text-danger"
              : "border-primary/10 text-muted",
          )}
          id={summaryId}
          role={error ? "alert" : "status"}
          title={summary}
        >
          <span className="min-w-0 sm:truncate">{error || summary}</span>
        </div>
      </div>
    </div>
  );
}
