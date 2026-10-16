import { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { asRecord, text } from "@/lib/operations/json";

const APPLY = process.argv.includes("--apply");
const RECORD_TYPE = "evaluation-work-group-definition";

const defaults = [
  {
    code: "WG_EXECUTION",
    name: "Thực thi",
    legacyActivityType: "execution",
    sortOrder: 10,
  },
  {
    code: "WG_MANAGEMENT",
    name: "Quản lý",
    legacyActivityType: "management",
    sortOrder: 20,
  },
];

async function main() {
  const db = getDb();
  const current = await db.evaluationRecord.findMany({
    where: { recordType: RECORD_TYPE },
  });
  const report: Array<Record<string, unknown>> = [];
  for (const item of defaults) {
    const existing = current.find((record) => {
      const content = asRecord(record.content);
      return [record.code, content.code, content.workGroupCode]
        .map(text)
        .includes(item.code);
    });
    report.push({ action: existing ? "update" : "create", ...item });
    if (!APPLY) continue;
    const content = {
      ...asRecord(existing?.content),
      code: item.code,
      isActive: true,
      legacyActivityType: item.legacyActivityType,
      name: item.name,
      sortOrder: item.sortOrder,
      status: "active",
      workGroupCode: item.code,
      workGroupName: item.name,
    } as Prisma.InputJsonValue;
    if (existing) {
      await db.evaluationRecord.update({
        data: {
          code: item.code,
          content,
          name: item.name,
          status: "active",
          updatedByName: "Codex migration",
        },
        where: { id: existing.id },
      });
    } else {
      await db.evaluationRecord.create({
        data: {
          code: item.code,
          content,
          createdByName: "Codex migration",
          name: item.name,
          recordType: RECORD_TYPE,
          status: "active",
          updatedByName: "Codex migration",
        },
      });
    }
  }
  console.table(report);
  console.log(
    APPLY
      ? "Đã bảo đảm hai Nhóm công việc tương thích Thực thi/Quản lý."
      : "Chỉ kiểm tra. Thêm --apply để ghi PostgreSQL.",
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await getDb().$disconnect();
  });
