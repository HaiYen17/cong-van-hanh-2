import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/layout/app-shell";
import { Panel } from "@/components/ui";
import { buildAllocationCatalog } from "@/lib/assets/allocation-catalog";
import { getAssetSetupSnapshot } from "@/lib/assets/setup-runtime";
import { requireCurrentSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";

import { ServiceCartWorkspace } from "./service-cart-workspace";

type ServiceKind = "asset-allocation" | "repair-request" | "support-request";

const SERVICE_BY_SLUG: Record<
  string,
  { description: string; groupKey: string; key: ServiceKind; title: string }
> = {
  "cap-phat": {
    description:
      "Lập nhiều dòng hàng hóa/CCDC trong một lần, chọn người được gán và theo dõi tại Đơn hàng của tôi.",
    groupKey: "asset-repair",
    key: "asset-allocation",
    title: "Đề xuất Cấp phát",
  },
  "sua-chua": {
    description:
      "Ghi nhận CCDC hư hỏng, ảnh đính kèm và mức khẩn cấp trước khi nộp đề xuất.",
    groupKey: "asset-repair",
    key: "repair-request",
    title: "Yêu cầu sửa chữa",
  },
  "ho-tro": {
    description:
      "Chọn loại hỗ trợ, ước lượng thời gian và gom nhiều nội dung vào một yêu cầu.",
    groupKey: "hanh-chinh-nv",
    key: "support-request",
    title: "Yêu cầu hỗ trợ",
  },
};

export const metadata: Metadata = {
  title: "Người Thuần Việt | Cổng vận hành",
};

export default async function EmployeeRequestPage({
  params,
}: {
  params: Promise<{ service: string }>;
}) {
  const session = await requireCurrentSession();
  const { service } = await params;
  const definition = SERVICE_BY_SLUG[service];
  if (!definition) notFound();

  const allowed =
    session.fullAccess ||
    session.moduleGroups.includes(definition.groupKey) ||
    session.modules.includes(definition.key);
  const db = getDb();
  const [employees, assetSetup] = allowed
    ? await Promise.all([
        db.employee.findMany({
          include: { company: true },
          orderBy: [{ fullName: "asc" }],
          where: { status: "ACTIVE" },
        }),
        getAssetSetupSnapshot(),
      ])
    : [[], null];

  const catalog = assetSetup ? buildAllocationCatalog(assetSetup) : [];

  return (
    <AppShell activePath="/" moduleKey={definition.key} session={session}>
      {allowed ? (
        <ServiceCartWorkspace
          catalog={catalog}
          employees={employees.map((employee) => ({
            employeeCode: employee.employeeCode,
            fullName: employee.fullName,
            id: employee.id,
            label: [
              employee.fullName,
              employee.employeeCode,
              employee.department,
              employee.company?.shortName || employee.company?.legalName,
            ]
              .filter(Boolean)
              .join(" · "),
          }))}
          kind={definition.key}
        />
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
