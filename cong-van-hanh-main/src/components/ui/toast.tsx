"use client";

import Image from "next/image";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";

import { cx } from "@/lib/cx";

export type ToastTone = "success" | "error" | "info" | "warning";

type ToastItem = {
  id: number;
  message?: string;
  title: string;
  tone: ToastTone;
};

type ToastInput = {
  duration?: number;
  message?: string;
  title: string;
  tone?: ToastTone;
};

type ToastContextValue = {
  toast: (input: ToastInput) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

let toastCounter = 0;

const toneStyles: Record<ToastTone, string> = {
  success: "border-[#b6e2d1] bg-[#e8f8f1] text-[#0c6e4c]",
  error: "border-[#eebfbf] bg-[#fdeeee] text-danger",
  info: "border-[#bfe0d8] bg-[#e9f4f0] text-primary",
  warning: "border-[#f3d4a0] bg-[#fff4e5] text-[#9a5712]",
};

const toneMark: Record<ToastTone, string> = {
  success: "✓",
  error: "!",
  info: "i",
  warning: "!",
};

function ToastCard({
  item,
  onClose,
}: {
  item: ToastItem;
  onClose: () => void;
}) {
  return (
    <div
      className={cx(
        "pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-xl border px-4 py-3 shadow-[0_18px_44px_rgba(17,45,39,0.16)]",
        toneStyles[item.tone],
      )}
      role="status"
    >
      <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border border-current/30 text-xs font-bold">
        {toneMark[item.tone]}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-bold">{item.title}</div>
        {item.message ? (
          <div className="mt-0.5 text-sm leading-5 opacity-90">{item.message}</div>
        ) : null}
      </div>
      <button
        aria-label="Đóng thông báo"
        className="shrink-0 text-lg leading-none opacity-60 transition hover:opacity-100"
        onClick={onClose}
        type="button"
      >
        ×
      </button>
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const remove = useCallback((id: number) => {
    setItems((list) => list.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback(
    (input: ToastInput) => {
      toastCounter += 1;
      const id = toastCounter;
      const item: ToastItem = {
        id,
        message: input.message,
        title: input.title,
        tone: input.tone ?? "info",
      };
      setItems((list) => [...list, item]);
      setTimeout(() => remove(id), input.duration ?? 4500);
    },
    [remove],
  );

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-4 z-[200] flex flex-col items-center gap-2 px-4">
        {items.map((item) => (
          <ToastCard item={item} key={item.id} onClose={() => remove(item.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);

  if (!ctx) {
    throw new Error("useToast phải nằm trong ToastProvider");
  }

  return ctx;
}

/** Lớp phủ loading toàn màn hình khi đang ghi dữ liệu. */
export function WriteLoadingOverlay({
  message = "Dữ liệu đang được ghi vào hệ thống...",
  show,
}: {
  message?: string;
  show: boolean;
}) {
  if (!show) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[180] grid place-items-center bg-[rgba(7,24,21,0.45)] px-4 backdrop-blur-[3px]">
      <div className="flex flex-col items-center gap-5 rounded-3xl border border-border bg-surface px-12 py-10 shadow-[0_30px_80px_rgba(17,45,39,0.28)]">
        <Image
          alt="Thuần Việt"
          className="h-auto w-28 animate-pulse"
          height={112}
          src="/login-logo.png"
          width={112}
        />
        <span className="size-7 animate-spin rounded-full border-[3px] border-accent border-t-transparent" />
        <span className="max-w-xs text-center text-sm font-semibold text-primary">{message}</span>
      </div>
    </div>
  );
}
