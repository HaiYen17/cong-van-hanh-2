import assert from "node:assert/strict";
import test from "node:test";

import {
  buildInboxExternalId,
  buildLegacyGcsObjectKey,
  decideIdempotentWrite,
  extractLegacyDriveFiles,
  inboxMigrationFingerprint,
  mapLegacyServiceCode,
  mapLegacyStatus,
  normalizeLegacyInboxRow,
  parseLegacyDate,
} from "./mapping";

test("ánh xạ mã dịch vụ 98_Inbox sang mã ổn định của V3", () => {
  assert.equal(
    mapLegacyServiceCode(
      "07DE_NGHI_DONG_DAU_VA_CAP_SO_VAN_BAN",
    ).code,
    "document-seal",
  );
  assert.equal(
    mapLegacyServiceCode("08TRICH_LUC_VA_LUU_TRU_HO_SO").code,
    "document-archive",
  );
  assert.equal(
    mapLegacyServiceCode("11_YEU_CAU_HO_TRO").code,
    "support-request",
  );
  assert.equal(
    mapLegacyServiceCode("13GUI_THU_VIETTEL_POST").code,
    "send-mail",
  );
});

test("ánh xạ đầy đủ trạng thái tiếng Việt cũ", () => {
  assert.equal(mapLegacyStatus("Chờ duyệt").status, "SUBMITTED");
  assert.equal(mapLegacyStatus("Tiếp nhận").status, "IN_PROGRESS");
  assert.equal(mapLegacyStatus("Xử lý").status, "IN_PROGRESS");
  assert.equal(mapLegacyStatus("Bổ sung hồ sơ").status, "NEEDS_INFO");
  assert.equal(mapLegacyStatus("Hoàn thành").status, "COMPLETED");
  assert.equal(mapLegacyStatus("Hủy đơn").status, "CANCELLED");
});

test("ngày serial của Google Sheets và ngày Việt Nam được giữ đúng", () => {
  assert.equal(parseLegacyDate(46122).slice(0, 10), "2026-04-10");
  assert.equal(parseLegacyDate("21/04/2026").slice(0, 10), "2026-04-21");
});

test("nhận diện file Drive, chống trùng và tuyệt đối bỏ qua folder", () => {
  const files = extractLegacyDriveFiles({
    files: [
      {
        fileId: "1Fo4X-CJKuxqHTnl_oQ48pqzvBaeuiSXs",
        mimeType: "application/pdf",
        name: "Hồ sơ.pdf",
        url: "https://drive.google.com/file/d/1Fo4X-CJKuxqHTnl_oQ48pqzvBaeuiSXs/view",
      },
    ],
    fileUrls: [
      "https://drive.google.com/file/d/1Fo4X-CJKuxqHTnl_oQ48pqzvBaeuiSXs/view",
    ],
    storageFolderId: "1yg4Nf_k66tax8TZJkxGkiqiZzCPD2ngs",
    storageFolderUrl:
      "https://drive.google.com/drive/folders/1yg4Nf_k66tax8TZJkxGkiqiZzCPD2ngs",
  });

  assert.equal(files.length, 1);
  assert.equal(
    files[0]?.driveFileId,
    "1Fo4X-CJKuxqHTnl_oQ48pqzvBaeuiSXs",
  );
  assert.equal(files[0]?.name, "Hồ sơ.pdf");
});

test("normalize một dòng thật giữ raw payload, items, dossier và file", () => {
  const payload = {
    createdAt: "2026-04-21T07:48:45.434Z",
    employee: {
      dept: "Phòng Kiến tạo nhân sự",
      id: "2509348",
      name: "Trần Thị Hải Yến",
    },
    payload: [
      {
        companyName: "Thuần Việt Global",
        companyShortName: "TVG",
        documentCondition: "HC giữ 01 bản chính",
        documentTypeName: "Giấy phép Kinh doanh",
        documentTypeRowIndex: 3,
        files: [
          {
            fileId: "1Fo4X-CJKuxqHTnl_oQ48pqzvBaeuiSXs",
            mimeType: "application/pdf",
            name: "Giấy phép.pdf",
            size: 332007,
            url: "https://drive.google.com/file/d/1Fo4X-CJKuxqHTnl_oQ48pqzvBaeuiSXs/view",
          },
        ],
        module: "Lưu trữ",
        storageCounterparty: "Địa điểm kinh doanh",
        storageGeneratedName: "[TVG] - Giấy phép Kinh doanh",
        storageIssuedDate: "2025-06-03",
        storageSummary: "Mở địa điểm kinh doanh",
      },
    ],
    requestId: "REQ-001",
    serviceCode: "08TRICH_LUC_VA_LUU_TRU_HO_SO",
    stage: "Hoàn thành",
    updatedAt: "2026-04-21T08:25:51.142Z",
  };
  const normalized = normalizeLegacyInboxRow({
    createdAt: "21/04/2026",
    creatorDepartment: "Phòng Kiến tạo nhân sự",
    creatorEmployeeCode: "2509348",
    creatorName: "Trần Thị Hải Yến",
    errorNote: "",
    payloadRaw: JSON.stringify(payload),
    requestId: "REQ-001",
    rowNumber: 56,
    serviceCode: "08TRICH_LUC_VA_LUU_TRU_HO_SO",
    status: "Hoàn thành",
  });

  assert.equal(normalized.externalId, "98_Inbox:REQ-001");
  assert.equal(normalized.serviceCode, "document-archive");
  assert.equal(normalized.status, "COMPLETED");
  assert.equal(normalized.requestItems.length, 1);
  assert.equal(normalized.legalDossiers.length, 1);
  assert.equal(normalized.files.length, 1);
  assert.equal(
    (
      normalized.payload._legacy98Inbox as {
        rawPayloadText?: string;
      }
    ).rawPayloadText,
    JSON.stringify(payload),
  );
});

test("chuẩn hóa mã sổ bị trùng theo từng mục nhưng vẫn giữ raw payload", () => {
  const payload = {
    createdAt: "2026-04-21T07:48:45.434Z",
    documentRegistryIssuedItems: [
      { registryId: "REQ-DUP-R05" },
      { registryId: "REQ-DUP-R05" },
    ],
    employee: { id: "2509348", name: "Người tạo" },
    payload: [
      { documentTypeName: "Văn bản 1", registryId: "REQ-DUP-R05" },
      { documentTypeName: "Văn bản 2", registryId: "REQ-DUP-R05" },
    ],
    requestId: "REQ-DUP",
    serviceCode: "07DE_NGHI_DONG_DAU_VA_CAP_SO_VAN_BAN",
    stage: "Hoàn thành",
    updatedAt: "2026-04-21T08:25:51.142Z",
  };
  const normalized = normalizeLegacyInboxRow({
    createdAt: "21/04/2026",
    creatorDepartment: "",
    creatorEmployeeCode: "2509348",
    creatorName: "Người tạo",
    errorNote: "",
    payloadRaw: JSON.stringify(payload),
    requestId: "REQ-DUP",
    rowNumber: 57,
    serviceCode: "07DE_NGHI_DONG_DAU_VA_CAP_SO_VAN_BAN",
    status: "Hoàn thành",
  });

  assert.deepEqual(
    normalized.legalDossiers.map((dossier) => dossier.legacyRegistryId),
    ["REQ-DUP-R05", "REQ-DUP-R02"],
  );
  assert.equal(
    normalized.issues.some(
      (issue) =>
        issue.code === "DUPLICATE_LEGACY_REGISTRY_ID_NORMALIZED" &&
        issue.severity === "WARNING",
    ),
    true,
  );
  assert.equal(
    (
      (
        normalized.payload._legacy98Inbox as {
          rawPayload?: { payload?: Array<{ registryId?: string }> };
        }
      ).rawPayload?.payload
    )?.[1]?.registryId,
    "REQ-DUP-R05",
  );
});

test("fingerprint ổn định dù thứ tự key JSON khác nhau", () => {
  assert.equal(
    inboxMigrationFingerprint({ a: 1, b: { c: 2, d: 3 } }),
    inboxMigrationFingerprint({ b: { d: 3, c: 2 }, a: 1 }),
  );
});

test("quyết định idempotency không tạo trùng khi fingerprint không đổi", () => {
  const fingerprint = inboxMigrationFingerprint({ requestId: "REQ-001" });
  assert.equal(
    decideIdempotentWrite({
      entityExists: false,
      hasExternalMap: false,
      nextFingerprint: fingerprint,
    }),
    "CREATE",
  );
  assert.equal(
    decideIdempotentWrite({
      entityExists: true,
      existingFingerprint: fingerprint,
      hasExternalMap: true,
      nextFingerprint: fingerprint,
    }),
    "SKIP",
  );
  assert.equal(
    decideIdempotentWrite({
      entityExists: true,
      existingFingerprint: "old",
      hasExternalMap: true,
      nextFingerprint: fingerprint,
    }),
    "UPDATE",
  );
});

test("khóa ngoài và object GCS đều bất biến", () => {
  assert.equal(buildInboxExternalId("REQ-001"), "98_Inbox:REQ-001");
  assert.equal(
    buildLegacyGcsObjectKey(
      "google-sheet-98-inbox",
      "1Fo4X-CJKuxqHTnl_oQ48pqzvBaeuiSXs",
      "Hồ sơ: bản chính.pdf",
    ),
    "legacy/google-sheet-98-inbox/1Fo4X-CJKuxqHTnl_oQ48pqzvBaeuiSXs/v1/Hồ sơ_ bản chính.pdf",
  );
});
