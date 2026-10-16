import "dotenv/config";

import { importAllWarehouseLegacyData } from "../src/lib/warehouse/legacy-sync";

async function main() {
  const result = await importAllWarehouseLegacyData();
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
