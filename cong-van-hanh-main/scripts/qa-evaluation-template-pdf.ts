import "server-only";

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { getDb } from "@/lib/db";
import { generateEvaluationTemplatePdfAttachment } from "@/lib/templates/runtime";

async function main() {
  const [evaluationInstanceId, templateId, outputPath] = process.argv.slice(2);
  if (!evaluationInstanceId || !templateId || !outputPath) {
    throw new Error(
      "Cách dùng: qa-evaluation-template-pdf <evaluationInstanceId> <templateId> <outputPath>",
    );
  }
  const attachment = await generateEvaluationTemplatePdfAttachment({
    evaluationInstanceId,
    numberingMode: "preview",
    reviewerRole: "self",
    templateId,
  });
  const resolvedOutput = path.resolve(outputPath);
  await mkdir(path.dirname(resolvedOutput), { recursive: true });
  await writeFile(resolvedOutput, attachment.content);
  console.log(
    JSON.stringify({
      bytes: attachment.content.length,
      fileName: attachment.fileName,
      outputPath: resolvedOutput,
    }),
  );
  await getDb().$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await getDb().$disconnect().catch(() => undefined);
  process.exitCode = 1;
});
