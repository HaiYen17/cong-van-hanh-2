import { getDb } from "@/lib/db";
import { dispatchWorkshopRpc } from "@/lib/workshop/runtime";

type WriteResult = {
  allocation?: { plans?: unknown[] };
  planId?: unknown;
};

async function main() {
  const db = getDb();
  const user = await db.user.findFirst({
    orderBy: { createdAt: "asc" },
    where: { status: "ACTIVE" },
  });
  if (!user) throw new Error("Không có tài khoản ACTIVE để chạy write smoke test.");

  const session = {
    displayName: user.displayName,
    fullAccess: true,
    moduleGroups: ["workshop"],
    modules: [],
    permissions: [],
    roles: ["super-admin"],
    userId: user.id,
  };
  const qaKey = `QA-WORKSHOP-${Date.now()}`;
  const week = {
    endDate: "2099-12-31",
    label: `Tuần QA ${qaKey}`,
    startDate: "2099-12-25",
    weekKey: qaKey,
  };

  try {
    const submitted = (await dispatchWorkshopRpc(session, "submitWorkshopOrderPlan", {
      productionRows: [
        {
          dayPlans: [0, 0, 0, 0, 0, 0, 0],
          orderQty: 2,
          productName: "Hàng QA Phân Xưởng",
          size: "100x200cm",
          sku: "QA-WORKSHOP-SKU",
          thickness: "10cm",
        },
      ],
      week,
      weekEnd: week.endDate,
      weekKey: week.weekKey,
      weekLabel: week.label,
      weekStart: week.startDate,
      workshopName: "Xưởng QA",
    })) as WriteResult;
    const orderCode = String(submitted.planId ?? "");
    if (!orderCode) throw new Error("Không nhận được Plan ID đơn QA.");
    const order = await db.workshopPlan.findUnique({
      include: { lines: true },
      where: { planCode: orderCode },
    });
    if (!order || order.lines.length !== 1 || !order.requestId) {
      throw new Error("Đơn QA chưa ghi đủ plan/line/request PostgreSQL.");
    }

    await dispatchWorkshopRpc(session, "updateWorkshopOrderPlan", {
      planId: orderCode,
      productionRows: [
        {
          editReason: "QA kiểm tra lưu lý do chỉnh sửa",
          lineId: order.lines[0].lineCode,
          orderQty: 3,
          productName: "Hàng QA Phân Xưởng",
          size: "100x200cm",
          sku: "QA-WORKSHOP-SKU",
          thickness: "10cm",
        },
      ],
    });

    await dispatchWorkshopRpc(session, "acceptWorkshopOrder", {
      planId: orderCode,
      weekKey: qaKey,
    });
    const allocation = (await dispatchWorkshopRpc(session, "submitWorkshopAllocationPlan", {
      orderPlanId: orderCode,
      pillowRows: [],
      sewingRows: [],
      sourceRows: [
        {
          dayPlans: [3, 0, 0, 0, 0, 0, 0],
          orderQty: 3,
          productName: "Hàng QA Phân Xưởng",
          size: "100x200cm",
          sku: "QA-WORKSHOP-SKU",
          teamKey: "mut",
          teamName: "Tổ Mút",
          thickness: "10cm",
        },
      ],
      weekEnd: week.endDate,
      weekKey: week.weekKey,
      weekLabel: week.label,
      weekStart: week.startDate,
    })) as WriteResult;
    if (!allocation.allocation || !Array.isArray(allocation.allocation.plans) || allocation.allocation.plans.length !== 1) {
      throw new Error("Phân bổ QA chưa sinh đúng một kế hoạch tổ.");
    }

    const manual = (await dispatchWorkshopRpc(session, "submitWorkshopPlan", {
      productionRows: [
        {
          dayPlans: [1, 0, 0, 0, 0, 0, 0],
          orderQty: 1,
          productName: "Kế hoạch QA thủ công",
          size: "100x200cm",
          sku: "QA-MANUAL-SKU",
          thickness: "10cm",
        },
      ],
      teamKey: "cao-su",
      teamName: "Tổ Cao su",
      warrantyRows: [],
      weekEnd: week.endDate,
      weekKey: week.weekKey,
      weekLabel: week.label,
      weekStart: week.startDate,
    })) as WriteResult;
    const manualCode = String(manual.planId ?? "");
    await dispatchWorkshopRpc(session, "reviewWorkshopPlan", {
      action: "approve",
      planId: manualCode,
      weekKey: qaKey,
    });
    const reviewed = await db.workshopPlan.findUnique({ where: { planCode: manualCode } });
    if (!reviewed || reviewed.approvalStatus !== "Đã duyệt" || !reviewed.requestId) {
      throw new Error("Duyệt kế hoạch QA chưa đồng bộ trạng thái/request.");
    }

    console.log("Workshop write smoke test passed.");
  } finally {
    const plans = await db.workshopPlan.findMany({
      select: { id: true, requestId: true },
      where: { weekKey: qaKey },
    });
    const requestIds = plans.map((item) => item.requestId).filter((item): item is string => !!item);
    await db.workshopPlan.deleteMany({ where: { weekKey: qaKey } });
    if (requestIds.length) {
      await db.request.deleteMany({ where: { id: { in: requestIds } } });
    }
    const leftovers = await db.workshopPlan.count({ where: { weekKey: qaKey } });
    if (leftovers) throw new Error(`Còn ${leftovers} kế hoạch QA chưa được dọn.`);
    const requestLeftovers = requestIds.length
      ? await db.request.count({ where: { id: { in: requestIds } } })
      : 0;
    if (requestLeftovers) {
      throw new Error(`Còn ${requestLeftovers} đơn QA chưa được dọn.`);
    }
    console.log("Workshop QA data cleaned.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
