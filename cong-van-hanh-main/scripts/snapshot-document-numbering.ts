import "server-only";

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { getDb } from "@/lib/db";

async function main() {
const db = getDb();
const [companies, documentTypes, registries, templates] = await Promise.all([
  db.company.findMany({ orderBy: { id: "asc" } }),
  db.documentType.findMany({ orderBy: { id: "asc" } }),
  db.documentRegistry.findMany({ orderBy: { id: "asc" } }),
  db.configurationRecord.findMany({
    orderBy: { id: "asc" },
    where: { recordType: { in: ["template", "template-history"] } },
  }),
]);
const payload = JSON.stringify(
  {
    companies,
    documentTypes,
    registries,
    snapshotAt: new Date().toISOString(),
    templates,
  },
  null,
  2,
);
const backupDirectory = path.join(process.cwd(), ".codex_tmp", "backups");
await mkdir(backupDirectory, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outputPath = path.join(
  backupDirectory,
  `document-numbering-${stamp}.json`,
);
await writeFile(outputPath, payload, "utf8");
console.log(
  JSON.stringify(
    {
      companies: companies.length,
      documentTypes: documentTypes.length,
      outputPath,
      registries: registries.length,
      sha256: createHash("sha256").update(payload).digest("hex"),
      templates: templates.length,
    },
    null,
    2,
  ),
);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
