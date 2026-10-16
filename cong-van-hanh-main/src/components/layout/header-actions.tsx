"use client";

import { useActionState, useState } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import { Download, KeyRound, LogOut, Volume2, VolumeX } from "lucide-react";

import { changePasswordAction, type AccountActionState } from "@/app/account-actions";
import { logoutAction } from "@/lib/auth/actions";
import { Button, Input } from "@/components/ui";
import { useToast } from "@/components/ui/toast";

const iconBtn =
  "header-action-button flex size-10 items-center justify-center rounded-full border transition hover:-translate-y-0.5";

function IconButton({
  children,
  label,
  onClick,
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button aria-label={label} className={iconBtn} onClick={onClick} title={label} type="button">
      {children}
    </button>
  );
}

const initialPw: AccountActionState = {};

export function HeaderActions({
  displayName,
  greeting,
  roles,
}: {
  displayName: string;
  greeting: string;
  roles: string[];
}) {
  const { toast } = useToast();
  const [soundOn, setSoundOn] = useState(() =>
    typeof window === "undefined" ? true : localStorage.getItem("cvh-sound") !== "off",
  );
  const [pwOpen, setPwOpen] = useState(false);
  const [pwState, pwAction, pwPending] = useActionState(changePasswordAction, initialPw);

  const toggleSound = () => {
    const next = !soundOn;
    setSoundOn(next);
    if (typeof window !== "undefined") {
      localStorage.setItem("cvh-sound", next ? "on" : "off");
    }
    toast({ title: next ? "Đã bật âm báo" : "Đã tắt âm báo", tone: "info" });
  };

  const pwModal =
    pwOpen && typeof document !== "undefined"
      ? createPortal(
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
            <button
              aria-label="Đóng"
              className="fixed inset-0 bg-[rgba(7,24,21,0.55)] backdrop-blur-sm"
              onClick={() => setPwOpen(false)}
              type="button"
            />
            <div className="relative z-10 w-full max-w-sm space-y-4 rounded-3xl bg-surface p-6 shadow-[0_30px_80px_rgba(8,20,18,0.4)]">
              <div>
                <h2 className="text-lg font-extrabold text-primary">Đổi mật khẩu</h2>
                <p className="mt-1 text-sm text-muted">
                  Đặt mật khẩu mới cho tài khoản của bạn.
                </p>
              </div>
              <form action={pwAction} className="space-y-3">
                <Input
                  autoComplete="new-password"
                  minLength={8}
                  name="password"
                  placeholder="Mật khẩu mới"
                  required
                  type="password"
                />
                <Input
                  autoComplete="new-password"
                  minLength={8}
                  name="confirm"
                  placeholder="Nhập lại mật khẩu"
                  required
                  type="password"
                />
                {pwState.error ? (
                  <div className="rounded-lg border border-[#eebfbf] bg-[#fdeeee] px-3 py-2 text-sm font-semibold text-danger">
                    {pwState.error}
                  </div>
                ) : null}
                {pwState.success ? (
                  <div className="rounded-lg border border-[#b6e2d1] bg-[#e4f7ef] px-3 py-2 text-sm font-semibold text-success">
                    {pwState.success}
                  </div>
                ) : null}
                <div className="flex justify-end gap-2 pt-1">
                  <Button onClick={() => setPwOpen(false)} size="sm" type="button" variant="secondary">
                    Đóng
                  </Button>
                  <Button disabled={pwPending} size="sm" type="submit">
                    {pwPending ? "Đang lưu..." : "Đổi mật khẩu"}
                  </Button>
                </div>
              </form>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <div className="flex items-center gap-3">
      <div className="hidden text-right md:block">
        <div className="text-sm font-bold text-[var(--header-title-color)]">{displayName}</div>
        <div className="text-xs text-[var(--header-subtitle-color)]">{greeting}</div>
      </div>
      <div className="flex items-center gap-1.5">
        <IconButton label="Tải ứng dụng Notifier (sắp ra mắt)" onClick={() => toast({ message: "Ứng dụng Thuần Việt Notifier sắp ra mắt.", title: "Notifier", tone: "info" })}>
          <Download className="size-5" strokeWidth={1.7} />
        </IconButton>
        <IconButton label={soundOn ? "Tắt âm báo" : "Bật âm báo"} onClick={toggleSound}>
          {soundOn ? <Volume2 className="size-5" strokeWidth={1.7} /> : <VolumeX className="size-5" strokeWidth={1.7} />}
        </IconButton>
        <IconButton label="Đổi mật khẩu" onClick={() => setPwOpen(true)}>
          <KeyRound className="size-5" strokeWidth={1.7} />
        </IconButton>
        <form action={logoutAction}>
          <button aria-label="Đăng xuất" className={iconBtn} title="Đăng xuất" type="submit">
            <LogOut className="size-5" strokeWidth={1.7} />
          </button>
        </form>
      </div>
      {roles.length > 0 ? <span className="sr-only">{roles.join(", ")}</span> : null}
      {pwModal}
    </div>
  );
}
