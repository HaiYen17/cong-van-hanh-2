import "dotenv/config";

import { getModuleConfigSecret } from "../src/lib/config/global-config";
import { getDb } from "../src/lib/db";

async function main() {
  const baseUrl =
    process.env.WAREHOUSE_QA_BASE_URL ||
    "https://thuanvietgroup.biz.vn";
  const sessionId = `qa-rfid-${new Date().toISOString().replace(/\D/g, "")}`;
  const apiKey = await getModuleConfigSecret("warehouseKts.androidApiKey");
  if (!apiKey) throw new Error("Chưa có Android RFID API key.");
  const response = await fetch(`${baseUrl}/api/warehouse/rfid`, {
    body: JSON.stringify({
      action: "warehouseInventoryScan",
      apiKey,
      area: "Kho tổng",
      companyKey: "TVD",
      date: new Date().toISOString().slice(0, 10),
      deviceName: "CODEX_QA",
      inventoryType: "START",
      operator: "QA tự động",
      rfids: ["E28069150000401FFE22D032"],
      sessionId,
      shelf: "QA",
      totalReadCount: 1,
    }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  const payload = await response.json();
  console.log(
    JSON.stringify({
      accepted: payload.accepted,
      httpStatus: response.status,
      ok: payload.ok,
      processStatus: payload.processStatus,
      sessionId: payload.sessionId,
      summary: payload.summary,
    }),
  );
  await getDb().warehouseInventorySession.deleteMany({
    where: { sessionKey: sessionId },
  });
  if (!response.ok || !payload.ok) {
    throw new Error(payload.message || "RFID API QA thất bại.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
