import assert from "node:assert/strict";
import test from "node:test";

import { selectRfidScannerVersion } from "./rfid-mobile-release";

test("chọn APK đầu tiên làm bản máy quét mới nhất", () => {
  const release = selectRfidScannerVersion({
    versions: [
      { downloadType: "download", fileId: "apk-17", fileName: "rfid-1.7.apk", versionName: "1.7" },
      { downloadType: "download", fileId: "apk-16", fileName: "rfid-1.6.apk", versionName: "1.6" },
    ],
  });
  assert.equal(release?.fileId, "apk-17");
});

test("bỏ file không phải APK hoặc phiên bản không hợp lệ", () => {
  assert.equal(selectRfidScannerVersion({
    versions: [
      { downloadType: "download", fileId: "zip", fileName: "rfid.zip", versionName: "1.7" },
      { downloadType: "copy", fileId: "apk", fileName: "rfid.apk", versionName: "1.7" },
    ],
  }), null);
});

test("đọc được dữ liệu phiên bản cũ lưu dưới dạng JSON text", () => {
  const release = selectRfidScannerVersion({
    "Phiên bản JSON": JSON.stringify([
      { downloadType: "download", fileId: "apk", fileName: "rfid.apk", versionName: "2.0.1" },
    ]),
  });
  assert.equal(release?.versionName, "2.0.1");
});
