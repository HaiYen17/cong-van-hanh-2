import "server-only";

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { getDb } from "@/lib/db";

async function main() {
  const db = getDb();
  const rows = await db.evaluationRecord.findMany({
    orderBy: { createdAt: "asc" },
  });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputDirectory = path.resolve(".codex_tmp", "backups");
  await mkdir(outputDirectory, { recursive: true });
  const body = JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      rowCount: rows.length,
      rows,
      table: "EvaluationRecord",
    },
    null,
    2,
  );
  const outputPath = path.join(
    outputDirectory,
    `evaluation-record-${stamp}.json`,
  );
  await writeFile(outputPath, body, "utf8");
  console.log(
    JSON.stringify({
      outputPath,
      rowCount: rows.length,
      sha256: createHash("sha256").update(body).digest("hex"),
    }),
  );
  await db.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
