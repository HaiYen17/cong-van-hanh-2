import assert from "node:assert/strict";
import test from "node:test";

import {
  cleanSignatureSubmission,
  signatureSubmission,
  validatePlacementsAgainstPages,
} from "./digital-signature-policy";

const placement = {
  height: 0.12,
  id: "region-1",
  page: 1,
  pageHeight: 842,
  pageWidth: 595,
  width: 0.25,
  x: 0.6,
  y: 0.75,
};

function payload(overrides: Record<string, unknown> = {}) {
  return {
    items: [
      {
        companyId: "company-1",
        documentTypeName: "Hợp đồng",
        partner: "Công ty đối tác",
        quantity: 1,
        sealTypes: ["Ký số"],
        signatureClientFileName: "hop-dong.pdf",
        signaturePlacements: [placement],
        ...overrides,
      },
    ],
  };
}

test("digital signature requires one PDF item, one exclusive stamp and valid regions", () => {
  assert.deepEqual(signatureSubmission(payload()), {
    companyId: "company-1",
    placements: [placement],
  });
  assert.throws(
    () => signatureSubmission(payload({ sealTypes: ["Ký số", "Đóng chính"] })),
    /không được chọn chung/,
  );
  assert.throws(
    () => signatureSubmission(payload({ quantity: 2 })),
    /số lượng 01/,
  );
  assert.throws(
    () => signatureSubmission(payload({ signatureClientFileName: "hop-dong.docx" })),
    /file PDF/,
  );
  assert.throws(
    () => signatureSubmission({ items: [...payload().items, ...payload().items] }),
    /chỉ được nộp 01 hồ sơ/,
  );
});

test("client cannot inject approval, AI summary, provider state or signed outputs", () => {
  const cleaned = cleanSignatureSubmission(payload({
    aiSummary: { summary: "forged" },
    approvedSnapshotHash: "forged",
    bodApprovedAt: "2026-01-01",
    digitalProviderTransactionId: "forged",
    resultFiles: [{ fileId: "forged" }],
    signatureStatus: "SIGNED",
  })) as { items: Array<Record<string, unknown>> };
  assert.equal(cleaned.items.length, 1);
  assert.equal(cleaned.items[0].signatureStatus, "awaiting_upload");
  assert.equal(cleaned.items[0].approvedSnapshotHash, undefined);
  assert.equal(cleaned.items[0].aiSummary, undefined);
  assert.equal(cleaned.items[0].resultFiles, undefined);
  assert.deepEqual(cleaned.items[0].sealTypes, ["Ký số"]);
  assert.deepEqual(cleaned.items[0].signaturePlacements, [placement]);
});

test("signature regions must match the immutable PDF page geometry", () => {
  assert.doesNotThrow(() =>
    validatePlacementsAgainstPages([placement], [
      { height: 842, rotation: 0, width: 595 },
    ]),
  );
  assert.throws(
    () => validatePlacementsAgainstPages([placement], [
      { height: 842, rotation: 90, width: 595 },
    ]),
    /góc xoay/,
  );
  assert.throws(
    () => validatePlacementsAgainstPages([placement], [
      { height: 792, rotation: 0, width: 612 },
    ]),
    /không khớp kích thước/,
  );
});
