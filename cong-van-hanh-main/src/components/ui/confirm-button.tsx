"use client";

import { useRef, useState } from "react";

import {
  buttonStyles,
  type ButtonSize,
  type ButtonVariant,
} from "@/components/ui/button";

/**
 * Nút submit có hộp xác nhận. Dùng trong các <form> server action cho thao tác
 * nhạy cảm (hủy, từ chối). Khi xác nhận sẽ submit form cha.
 */
export function ConfirmButton({
  children,
  confirmLabel = "Xác nhận",
  message = "Bạn chắc chắn muốn thực hiện thao tác này?",
  size = "sm",
  title = "Xác nhận thao tác",
  variant = "ghost",
}: {
  children: React.ReactNode;
  confirmLabel?: string;
  message?: string;
  size?: ButtonSize;
  title?: string;
  variant?: ButtonVariant;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <button
        className={buttonStyles({ size, variant })}
        onClick={() => setOpen(true)}
        ref={triggerRef}
        type="button"
      >
        {children}
      </button>
      {open ? (
        <div
          aria-modal="true"
          className="fixed inset-0 z-[210] flex items-center justify-center bg-[rgba(9,25,23,0.45)] p-4"
          role="dialog"
        >
          <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-5 shadow-[0_24px_60px_rgba(17,45,39,0.24)]">
            <h3 className="text-base font-bold text-primary">{title}</h3>
            <p className="mt-2 text-sm leading-6 text-muted">{message}</p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                className={buttonStyles({ size: "sm", variant: "secondary" })}
                onClick={() => setOpen(false)}
                type="button"
              >
                Đóng
              </button>
              <button
                className={buttonStyles({ size: "sm", variant: "danger" })}
                onClick={() => {
                  setOpen(false);
                  triggerRef.current?.form?.requestSubmit();
                }}
                type="button"
              >
                {confirmLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
