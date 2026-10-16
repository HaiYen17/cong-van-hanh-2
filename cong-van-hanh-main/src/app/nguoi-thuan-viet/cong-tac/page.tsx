import type { Metadata } from "next";
import { Route } from "lucide-react";

import { AppShell } from "@/components/layout/app-shell";
import { LinkButton, Panel } from "@/components/ui";
import { requireCurrentSession } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Đăng ký công tác | Cổng vận hành",
};

export default async function BusinessTripPage() {
  const session = await requireCurrentSession();
  const canOpen =
    session.fullAccess ||
    session.moduleGroups.includes("hanh-chinh-nv") ||
    session.modules.includes("business-trip");

  return (
    <AppShell activePath="/" moduleKey="business-trip" session={session}>
      {canOpen ? (
        <Panel title="Đăng ký công tác">
          <div className="grid min-h-[360px] place-items-center text-center">
            <div>
              <div className="mx-auto grid size-16 place-items-center rounded-lg bg-accent-soft text-accent">
                <Route size={30} />
              </div>
              <h2 className="mt-4 text-xl font-extrabold text-primary">
                Đăng ký công tác đang được dựng lại theo khung mới
              </h2>
              <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted">
                Đây là đúng trạng thái của module trong bản GAS nguồn hiện tại.
                Khi nghiệp vụ được chốt, form mới sẽ nối chung Request và
                PostgreSQL.
              </p>
              <LinkButton className="mt-5" href="/" variant="secondary">
                Quay lại dashboard dịch vụ
              </LinkButton>
            </div>
          </div>
        </Panel>
      ) : (
        <Panel title="Không có quyền truy cập">
          <p className="text-sm text-muted">
            Tài khoản hiện tại chưa được cấp quyền mở module này.
          </p>
        </Panel>
      )}
    </AppShell>
  );
}
