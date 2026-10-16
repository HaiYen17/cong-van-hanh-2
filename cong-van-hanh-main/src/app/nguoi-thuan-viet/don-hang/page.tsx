import type { Metadata } from "next";

import { AppShell } from "@/components/layout/app-shell";
import { requireCurrentSession } from "@/lib/auth/session";
import { getWorkbenchInitialState } from "@/lib/workbench/repository";

import { WorkbenchWorkspace } from "./workbench-workspace";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Bàn làm việc của tôi | Cổng vận hành",
};

export default async function MyWorkbenchPage() {
  const session = await requireCurrentSession();
  const initialState = await getWorkbenchInitialState(session);
  return (
    <AppShell activePath="/nguoi-thuan-viet/don-hang" moduleKey="my-orders" session={session}>
      <WorkbenchWorkspace initialState={initialState} />
    </AppShell>
  );
}
