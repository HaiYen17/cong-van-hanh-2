import type { Metadata } from "next";

import { AppShell } from "@/components/layout/app-shell";
import { Panel } from "@/components/ui";
import { requireCurrentSession } from "@/lib/auth/session";
import {
  getGlobalConfigSnapshot,
  isGlobalConfigSuperAdmin,
} from "@/lib/config/global-config";

import "./global-config.css";
import { GlobalConfigConsole } from "./integration-forms";

export const metadata: Metadata = {
  title: "Cấu hình Tổng | Cổng vận hành",
};

export default async function CauHinhTongPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await requireCurrentSession();

  if (!isGlobalConfigSuperAdmin(session)) {
    return (
      <AppShell moduleKey="global-config" session={session}>
        <Panel title="Không có quyền">
          <p className="text-sm leading-6 text-muted">
            Cấu hình Tổng chứa tài khoản và khóa tích hợp nhạy cảm nên chỉ Super
            Admin được truy cập.
          </p>
        </Panel>
      </AppShell>
    );
  }

  const snapshot = await getGlobalConfigSnapshot();
  const { tab } = await searchParams;
  const initialTab = snapshot.tabs.some((item) => item.key === tab)
    ? tab
    : "brand-theme";

  return (
    <AppShell moduleKey="global-config" session={session}>
      <div>
        <GlobalConfigConsole initial={snapshot} initialTab={initialTab} />
      </div>
    </AppShell>
  );
}
