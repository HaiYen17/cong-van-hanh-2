import type { Metadata } from "next";

import { AppShell } from "@/components/layout/app-shell";
import { Panel } from "@/components/ui";
import { requireCurrentSession } from "@/lib/auth/session";
import { getTemplateWorkspaceSnapshot } from "@/lib/templates/runtime";

import { TemplateWorkspace } from "./template-workspace";

export const metadata: Metadata = {
  title: "Biểu mẫu | Cổng vận hành",
};

export default async function TemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{
    evaluationInstanceId?: string;
    templateId?: string;
  }>;
}) {
  const session = await requireCurrentSession();
  const query = await searchParams;
  let snapshot: Awaited<ReturnType<typeof getTemplateWorkspaceSnapshot>> | null =
    null;
  try {
    snapshot = await getTemplateWorkspaceSnapshot(session);
  } catch {}

  return (
    <AppShell activePath="/" moduleKey="templates" session={session}>
      {snapshot ? (
        <TemplateWorkspace
          initial={snapshot}
          initialEvaluationInstanceId={query.evaluationInstanceId || ""}
          initialTemplateId={query.templateId || ""}
        />
      ) : (
        <Panel title="Không có quyền truy cập">
          <p className="text-sm text-muted">
            Tài khoản hiện tại chưa được cấp quyền mở Biểu mẫu.
          </p>
        </Panel>
      )}
    </AppShell>
  );
}
