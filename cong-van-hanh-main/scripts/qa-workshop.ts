import { dispatchWorkshopRpc } from "@/lib/workshop/runtime";
import { getDb } from "@/lib/db";
import { buildLegacyFeatureGroups } from "@/lib/legacy-portal-catalog";

const session = {
  displayName: "Workshop QA",
  fullAccess: true,
  moduleGroups: ["workshop"],
  modules: [],
  permissions: [],
  roles: ["super-admin"],
  userId: "qa-read-only",
};

const reads = [
  ["getWorkshopConfigData", { includeMaterials: false }],
  ["getWorkshopOrderPlanData", { metadataOnly: true }],
  ["getWorkshopAllocationData", { includeLines: true }],
  ["getWorkshopPlanData", { metadataOnly: true }],
  ["getWorkshopPlanApprovalData", { deferSewingDependency: true }],
  ["getWorkshopProposalData", { metadataOnly: true }],
  ["getWorkshopReportData", { metadataOnly: true }],
] as const;

async function main() {
  for (const [method, payload] of reads) {
    const result = await dispatchWorkshopRpc(session, method, payload);
    if (!result || result.ok !== true || !("data" in result)) {
      throw new Error(`${method}: hợp đồng RPC không hợp lệ.`);
    }
    console.log(`${method}: OK`);
  }

  const databaseModules = await getDb().appModule.findMany({
    include: { group: true },
    where: { group: { key: "workshop" }, isActive: true },
  });
  const catalog = buildLegacyFeatureGroups({
    badgeCounts: {},
    databaseModules,
    session,
  });
  const workshopGroup = catalog.find((group) => group.key === "workshop");
  if (!workshopGroup || workshopGroup.items.length !== 8) {
    throw new Error("Catalog Admin Xưởng chưa có đủ 8 card.");
  }
  if (workshopGroup.items.some((item) => !item.href)) {
    throw new Error("Catalog Admin Xưởng còn card chưa có route.");
  }
  console.log("Workshop portal catalog: 8/8 routes OK");

  console.log("Workshop PostgreSQL read smoke test passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
