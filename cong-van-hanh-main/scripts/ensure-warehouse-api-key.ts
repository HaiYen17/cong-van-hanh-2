import "dotenv/config";

import { randomBytes } from "node:crypto";

import { getDb } from "../src/lib/db";

async function main() {
  const db = getDb();
  const key = "warehouseKts.androidApiKey";
  const current = await db.systemSetting.findUnique({ where: { key } });
  if (current?.value) {
    console.log("Android RFID API key đã được cấu hình; giữ nguyên giá trị cũ.");
    return;
  }
  // Lưu plain text để tương thích cơ chế import V3 cũ. Lần kế tiếp Super Admin
  // bấm Lưu trong Cấu hình Tổng, giá trị sẽ tự chuyển sang AES-GCM.
  const value = `rfid_${randomBytes(32).toString("base64url")}`;
  await db.systemSetting.upsert({
    create: {
      key,
      value,
    },
    update: { value },
    where: { key },
  });
  console.log(
    "Đã tạo Android RFID API key. Super Admin có thể copy tại Cấu hình Tổng → Kho KTS / RFID.",
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
