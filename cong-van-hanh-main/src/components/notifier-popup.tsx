"use client";

import { createPortal } from "react-dom";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { renderMotivationRichText } from "@/components/motivation-rich-text";
import type { MotivationItem } from "@/lib/motivation";

const SEEN_KEY = "cvh-notifier-seen";
const POPUP_MODES = [
  "center_popup",
  "sticky_warning",
  "image_portrait",
  "image_landscape",
  "image_only",
];

function readSeen(): string[] {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

function markSeen(id: string) {
  try {
    const set = new Set(readSeen());
    set.add(id);
    localStorage.setItem(SEEN_KEY, JSON.stringify([...set]));
  } catch {
    // Trình duyệt chặn localStorage không được làm hỏng popup.
  }
}

const LEVEL: Record<string, { bar: string; chip: string; label: string }> = {
  normal: {
    bar: "#114c41",
    chip: "bg-primary/10 text-primary",
    label: "Thông báo",
  },
  success: {
    bar: "#0f8a5f",
    chip: "bg-emerald-100 text-emerald-700",
    label: "Hoàn thành",
  },
  warning: {
    bar: "#c97716",
    chip: "bg-amber-100 text-amber-700",
    label: "Cảnh báo",
  },
  urgent: {
    bar: "#ba2f2f",
    chip: "bg-rose-100 text-rose-700",
    label: "Khẩn",
  },
};

export function NotifierPopup({ notifications }: { notifications: MotivationItem[] }) {
  const [seen] = useState(() => new Set(readSeen()));
  const queue = useMemo(
    () =>
      notifications.filter(
        (notification) =>
          ["notifier", "both"].includes(notification.displayChannel) &&
          POPUP_MODES.includes(notification.displayMode) &&
          !seen.has(notification.eventId),
      ),
    [notifications, seen],
  );
  const [index, setIndex] = useState(0);
  const current = queue[index] ?? null;

  useEffect(() => {
    if (!current || current.closePolicy !== "auto") return;
    const milliseconds =
      current.autoDismissMs && current.autoDismissMs > 0
        ? current.autoDismissMs
        : 8_000;
    const timer = window.setTimeout(() => {
      markSeen(current.eventId);
      setIndex((value) => value + 1);
    }, milliseconds);
    return () => window.clearTimeout(timer);
  }, [current]);

  if (!current) return null;

  const level = LEVEL[current.level] ?? LEVEL.normal;
  const dismiss = () => {
    markSeen(current.eventId);
    setIndex((value) => value + 1);
  };
  const requireAck = current.requireAck || current.closePolicy === "require_ack";
  const imageUrl = current.imageUrls[0] ?? current.imageUrl;
  const imageOnly =
    current.popupContentMode === "image_only" ||
    current.displayMode === "image_only";
  const showTitle =
    !imageOnly && current.popupContentMode !== "hide_title";
  const showBody =
    !imageOnly && current.popupContentMode !== "hide_message";
  const imageClass =
    current.displayMode === "image_portrait"
      ? "max-h-[72vh] w-full object-contain bg-surface-muted"
      : current.displayMode === "image_landscape"
        ? "max-h-[62vh] w-full object-contain bg-surface-muted"
        : "max-h-64 w-full object-cover";

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-[rgba(7,24,21,0.52)] p-4 backdrop-blur-[3px]">
      <div
        className={`flex max-h-[calc(100dvh-2rem)] w-full flex-col overflow-hidden rounded-3xl border border-white/70 bg-surface shadow-[0_24px_60px_rgba(8,20,18,0.34)] ${
          current.displayMode === "image_landscape"
            ? "max-w-4xl"
            : current.displayMode === "image_portrait"
              ? "max-w-xl"
              : "max-w-lg"
        }`}
      >
        <div className="h-1.5 w-full" style={{ backgroundColor: level.bar }} />
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            alt={current.title}
            className={`shrink-0 ${imageClass}`}
            referrerPolicy="no-referrer"
            src={imageUrl}
          />
        ) : null}
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-6 [scrollbar-gutter:stable]">
          {!imageOnly ? (
            <span
              className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${level.chip}`}
            >
              {level.label}
            </span>
          ) : null}
          {showTitle ? (
            <h3 className="text-xl font-extrabold text-primary">{current.title}</h3>
          ) : null}
          {showBody && current.body ? (
            <p className="whitespace-pre-line text-sm leading-6 text-foreground">
              {renderMotivationRichText(current.body)}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {current.targetUrl ? (
              <Link
                className="inline-flex h-10 items-center rounded-full bg-gradient-to-br from-accent to-accent-strong px-4 text-sm font-bold text-white"
                href={current.targetUrl}
                onClick={dismiss}
                target={current.targetUrl.startsWith("http") ? "_blank" : undefined}
              >
                Mở liên kết
              </Link>
            ) : null}
            <button
              className="inline-flex h-10 items-center rounded-full border border-border bg-surface px-4 text-sm font-bold text-primary hover:bg-surface-muted"
              onClick={dismiss}
              type="button"
            >
              {requireAck ? "Đã xem" : "Đóng"}
            </button>
            {queue.length > 1 ? (
              <span className="ml-auto text-xs text-muted">
                {index + 1}/{queue.length}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
