"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";

import type { MotivationItem, MotivationOption, MotivationStage } from "@/lib/motivation";

import { reactToEventAction } from "@/app/motivation-actions";

function renderFormatted(text: string): ReactNode {
  const tokens = text.split(
    /(\[hong\]|\[\/hong\]|\[do\]|\[\/do\]|\[xanhduong\]|\[\/xanhduong\]|\*\*|__|\*)/g,
  );
  let color = "";
  let bold = false;
  let italic = false;
  let underline = false;
  const nodes: ReactNode[] = [];
  let key = 0;
  for (const tok of tokens) {
    if (tok === "[hong]") { color = "text-[#d91f59]"; continue; }
    if (tok === "[do]") { color = "text-[#c9352b]"; continue; }
    if (tok === "[xanhduong]") { color = "text-[#1769aa]"; continue; }
    if (tok.startsWith("[/")) { color = ""; continue; }
    if (tok === "**") { bold = !bold; continue; }
    if (tok === "*") { italic = !italic; continue; }
    if (tok === "__") { underline = !underline; continue; }
    if (!tok) continue;
    nodes.push(
      <span
        className={`${color} ${bold ? "font-bold" : ""} ${italic ? "italic" : ""} ${
          underline ? "underline" : ""
        }`.trim()}
        key={key++}
      >
        {tok}
      </span>,
    );
  }
  return nodes;
}

function CircleButton({ children, label, onClick }: { children: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      aria-label={label}
      className="flex size-9 items-center justify-center rounded-full border border-white/25 bg-black/30 text-white backdrop-blur transition hover:bg-black/45"
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  );
}

function Reactions({
  active,
  onReact,
  options,
  variant = "overlay",
}: {
  active: string | null;
  onReact: (option: MotivationOption) => void;
  options: MotivationOption[];
  variant?: "overlay" | "panel";
}) {
  if (options.length === 0) return null;
  const panel = variant === "panel";
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      {options.map((option) => {
        const on = active === option.value;
        const base = panel
          ? "size-14 text-2xl shadow-[0_8px_20px_rgba(17,45,39,0.12)]"
          : "size-10 text-lg backdrop-blur";
        const tone = on
          ? "border-accent bg-accent text-white scale-105"
          : panel
            ? "border-border bg-surface hover:border-accent/50 hover:bg-accent-soft"
            : "border-white/25 bg-white/15 text-white hover:bg-white/30";
        // Thẻ tag không có emoji → hiện dạng pill chữ thay vì nút tròn.
        const isTag = !option.symbol;
        return (
          <button
            aria-label={option.label}
            className={
              isTag
                ? `flex items-center justify-center rounded-full border px-3 transition active:scale-90 ${panel ? "h-11 text-sm font-semibold shadow-[0_8px_20px_rgba(17,45,39,0.12)]" : "h-9 text-xs font-semibold backdrop-blur"} ${tone}`
                : `flex items-center justify-center rounded-full border transition active:scale-90 ${base} ${tone}`
            }
            key={option.value}
            onClick={() => onReact(option)}
            title={option.label}
            type="button"
          >
            {option.symbol || option.label}
          </button>
        );
      })}
    </div>
  );
}

export function MotivationBanner({ messages, notifications }: MotivationStage) {
  const [msgIndex, setMsgIndex] = useState(0);
  const [stageIndex, setStageIndex] = useState(0);
  const [open, setOpen] = useState(false);
  const [reacted, setReacted] = useState<Record<string, string>>({});
  const [burst, setBurst] = useState<{ key: number; symbol: string } | null>(null);
  const burstId = useRef(0);
  const [, startReact] = useTransition();

  const stage = useMemo<MotivationItem[]>(() => {
    const selected = messages[msgIndex];
    return [selected, ...notifications].filter(Boolean) as MotivationItem[];
  }, [messages, msgIndex, notifications]);

  if (stage.length === 0) return null;

  const safeIndex = Math.min(stageIndex, stage.length - 1);
  const current = stage[safeIndex];
  const isNotification = current.kind === "notification";
  const showArrows = stage.length > 1;
  const showReload = !isNotification && messages.length > 1;
  const myReaction = reacted[current.eventId] ?? current.myReaction;
  const badgeLabel = isNotification ? "Thông báo" : "Thông điệp gửi bạn";

  const go = (delta: number) => {
    const n = stage.length;
    setStageIndex((((safeIndex + delta) % n) + n) % n);
    setOpen(false);
  };
  const reload = () => {
    if (messages.length <= 1) return;
    let n = msgIndex;
    while (n === msgIndex) n = Math.floor(Math.random() * messages.length);
    setMsgIndex(n);
    setStageIndex(0);
  };
  const react = (option: MotivationOption) => {
    setReacted((prev) => ({ ...prev, [current.eventId]: option.value }));
    burstId.current += 1;
    setBurst({ key: burstId.current, symbol: option.symbol });
    setTimeout(() => setBurst(null), 800);
    // Ghi nhận ngầm, không hiện loading cho người dùng.
    startReact(() => {
      void reactToEventAction(current.eventId, option.value, option.label);
    });
  };

  const burstOverlay = burst ? (
    <div className="pointer-events-none absolute inset-0 z-30 grid place-items-center">
      <span className="animate-bubble-pop text-7xl drop-shadow-[0_8px_24px_rgba(0,0,0,0.4)]" key={burst.key}>
        {burst.symbol}
      </span>
    </div>
  ) : null;

  const popup =
    open && typeof document !== "undefined"
      ? createPortal(
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
            <button
              aria-label="Đóng"
              className="fixed inset-0 bg-[rgba(7,24,21,0.62)] backdrop-blur-sm"
              onClick={() => setOpen(false)}
              type="button"
            />
            <div className="relative z-10 flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl bg-surface shadow-[0_30px_80px_rgba(8,20,18,0.42)] md:grid md:grid-cols-2">
              {/* Ảnh bên trái — hiện đầy đủ (object-contain), không cắt */}
              {current.imageUrl ? (
                <div className="relative flex items-center justify-center bg-[#0c2722] md:h-full">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    alt={current.title}
                    className="max-h-60 w-full object-contain md:h-full md:max-h-[90vh]"
                    referrerPolicy="no-referrer"
                    src={current.imageUrl}
                  />
                  {burstOverlay}
                </div>
              ) : null}

              {/* Chi tiết bên phải */}
              <div className="flex max-h-[90vh] min-h-0 flex-col">
                <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
                  <span className="inline-flex h-7 items-center rounded-full bg-primary/5 px-3 text-[11px] font-bold uppercase tracking-wide text-primary">
                    {badgeLabel}
                  </span>
                  <button
                    aria-label="Đóng"
                    className="flex size-9 items-center justify-center rounded-full border border-border text-muted transition hover:bg-surface-muted"
                    onClick={() => setOpen(false)}
                    type="button"
                  >
                    ✕
                  </button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto p-5">
                  <h2 className="text-xl font-extrabold leading-snug text-primary">{current.title}</h2>
                  {current.body ? (
                    <div className="mt-3 whitespace-pre-line text-sm leading-7 text-foreground">
                      {renderFormatted(current.body)}
                    </div>
                  ) : null}
                </div>
                {current.options.length > 0 ? (
                  <div className="flex flex-col gap-2 border-t border-border px-5 py-4">
                    <span className="text-xs font-bold uppercase tracking-wide text-muted">
                      Cảm nhận của bạn
                    </span>
                    <Reactions active={myReaction} onReact={react} options={current.options} variant="panel" />
                  </div>
                ) : null}
              </div>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <section className="relative h-[60vh] overflow-hidden rounded-3xl border border-border bg-primary shadow-[0_20px_50px_rgba(17,45,39,0.18)] lg:h-full">
        {current.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            alt={current.title}
            className="absolute inset-0 h-full w-full object-cover"
            referrerPolicy="no-referrer"
            src={current.imageUrl}
          />
        ) : null}
        <div className="absolute inset-0 bg-gradient-to-t from-[rgba(7,24,21,0.92)] via-[rgba(7,24,21,0.28)] to-[rgba(7,24,21,0.12)]" />

        <div className="absolute right-4 top-4 flex items-center gap-2">
          {showArrows ? (
            <>
              <CircleButton label="Mục trước" onClick={() => go(-1)}>‹</CircleButton>
              <CircleButton label="Mục sau" onClick={() => go(1)}>›</CircleButton>
            </>
          ) : null}
          {showReload ? <CircleButton label="Đổi thông điệp khác" onClick={reload}>↻</CircleButton> : null}
        </div>

        {showArrows ? (
          <div className="absolute left-4 top-4 inline-flex h-7 items-center rounded-full bg-black/35 px-3 text-[11px] font-bold text-white backdrop-blur">
            {safeIndex + 1}/{stage.length}
          </div>
        ) : null}

        <div className="absolute inset-x-0 bottom-0 space-y-2.5 p-5 text-white">
          <span className="inline-flex h-7 items-center rounded-full bg-white/15 px-3 text-[11px] font-bold uppercase tracking-wide backdrop-blur">
            {badgeLabel}
          </span>
          <h2 className="text-lg font-extrabold leading-snug drop-shadow">{current.title}</h2>
          <div className="flex items-center justify-between gap-2 pt-1">
            <Reactions active={myReaction} onReact={react} options={current.options} />
            <button
              aria-label="Xem chi tiết"
              className="flex size-10 shrink-0 items-center justify-center rounded-full border border-white/25 bg-white/15 text-white backdrop-blur transition hover:bg-white/30"
              onClick={() => setOpen(true)}
              title="Xem chi tiết"
              type="button"
            >
              ⌃
            </button>
          </div>
        </div>

        {burstOverlay}
      </section>

      {popup}
    </>
  );
}
