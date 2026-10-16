import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { warehouseApiContract } from "@/lib/warehouse/api-contract";

async function main() {
  const target = resolve("docs", "warehouse-openapi.json");
  await writeFile(target, `${JSON.stringify(warehouseApiContract, null, 2)}\n`, "utf8");
  console.log(`Exported ${target}`);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
