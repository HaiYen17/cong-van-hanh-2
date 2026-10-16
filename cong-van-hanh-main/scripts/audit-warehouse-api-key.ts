import "dotenv/config";

import { createHash, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { getModuleConfigSecret } from "../src/lib/config/global-config";

const androidProject = resolve("C:/Android/rfid-android-kotlin");
const localPropertiesPath = resolve(androidProject, "local.properties");

function readAndroidApiKey() {
  const contents = readFileSync(localPropertiesPath, "utf8");
  const line = contents
    .split(/\r?\n/u)
    .find((item) => /^\s*androidRfidApiKey\s*=/u.test(item));
  if (!line) return "";
  return line.slice(line.indexOf("=") + 1).trim();
}

function fingerprint(value: string) {
  return value
    ? createHash("sha256").update(value, "utf8").digest("hex").slice(0, 12)
    : "missing";
}

function sameSecret(left: string, right: string) {
  if (!left || !right) return false;
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

async function main() {
  const androidApiKey = readAndroidApiKey();
  const backendApiKey = await getModuleConfigSecret(
    "warehouseKts.androidApiKey",
  );

  console.log(
    JSON.stringify(
      {
        android: {
          configured: Boolean(androidApiKey),
          fingerprint: fingerprint(androidApiKey),
          length: androidApiKey.length,
          property: "androidRfidApiKey",
        },
        backend: {
          configured: Boolean(backendApiKey),
          configKey: "warehouseKts.androidApiKey",
          fingerprint: fingerprint(backendApiKey),
          length: backendApiKey.length,
        },
        match: sameSecret(androidApiKey, backendApiKey),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
