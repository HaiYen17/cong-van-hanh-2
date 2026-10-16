import "server-only";

import assert from "node:assert/strict";

import { getDb } from "@/lib/db";
import { dispatchEvaluationRpc } from "@/lib/evaluation/runtime";

async function main() {
  const db = getDb();
  const admin = await db.user.findFirst({
    orderBy: { createdAt: "asc" },
    where: {
      status: "ACTIVE",
      userRoles: {
        some: { role: { key: { in: ["admin", "super-admin"] } } },
      },
    },
  });
  assert(admin, "Không tìm thấy tài khoản Admin để ghi nhật ký chuẩn hóa JD.");
  const result = await dispatchEvaluationRpc(
    {
      displayName: admin.displayName,
      fullAccess: true,
      moduleGroups: [],
      modules: [],
      permissions: [],
      roles: ["admin"],
      userId: admin.id,
    },
    "normalizeEvaluationArchivedJdData",
    {},
  );
  console.log(JSON.stringify(result, null, 2));
  await db.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
