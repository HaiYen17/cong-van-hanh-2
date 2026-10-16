import "server-only";

import { getDb } from "@/lib/db";
import { asRecord, text } from "@/lib/operations/json";

async function main() {
  const db = getDb();
  const instance = await db.evaluationRecord.findFirst({
    orderBy: { createdAt: "desc" },
    where: {
      recordType: "evaluation-instance",
      status: "in_progress",
      content: { path: ["employeeCode"], equals: "2411301" },
    },
  });
  if (!instance) throw new Error("Không tìm thấy phiếu test Nguyễn Minh Thông.");
  const [scores, groups] = await Promise.all([
    db.evaluationRecord.findMany({
      orderBy: { createdAt: "asc" },
      where: { parentId: instance.id, recordType: "evaluation-criteria-score" },
    }),
    db.evaluationRecord.findMany({
      where: { recordType: "evaluation-score-group", status: "active" },
    }),
  ]);
  const sections = Array.from(
    scores.reduce((map, score) => {
      const content = asRecord(score.content);
      const name = text(content.sectionName);
      const current = map.get(name) || {
        detailCount: 0,
        name,
        rowCount: 0,
        sortOrder: Number(content.sectionSortOrder || 0),
      };
      current.rowCount += 1;
      if (
        content.scoreLevelDescriptionsEnabled === true ||
        Object.keys(asRecord(content.scoreLevelDescriptions)).length
      ) {
        current.detailCount += 1;
      }
      map.set(name, current);
      return map;
    }, new Map<string, { detailCount: number; name: string; rowCount: number; sortOrder: number }>()).values(),
  ).sort((left, right) => left.sortOrder - right.sortOrder);
  console.log(
    JSON.stringify(
      {
        employeeCode: text(asRecord(instance.content).employeeCode),
        employeeName: text(asRecord(instance.content).employeeName),
        groups: groups
          .map((group) => ({
            name: group.name,
            sortOrder: Number(asRecord(group.content).sortOrder || 0),
          }))
          .sort((left, right) => left.sortOrder - right.sortOrder),
        instanceId: instance.id,
        sectionCount: sections.length,
        sections,
        totalScoreRows: scores.length,
      },
      null,
      2,
    ),
  );
  await db.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
