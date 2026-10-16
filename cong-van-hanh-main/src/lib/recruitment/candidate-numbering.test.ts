import assert from "node:assert/strict";
import test from "node:test";

import { compactCandidateNumbers } from "./candidate-numbering";

test("dồn số hồ sơ sớm nhưng giữ nguyên hồ sơ đã phỏng vấn", () => {
  const result = compactCandidateNumbers([
    { id: "early-1", requisitionCode: "REQ-00001", candidateCode: "REQ-00001-001", status: "CV Nộp", order: 1 },
    { id: "deleted-gap", requisitionCode: "REQ-00001", candidateCode: "REQ-00001-003", status: "Loại CV", order: 3 },
    { id: "interviewed", requisitionCode: "REQ-00001", candidateCode: "REQ-00001-004", status: "PV V1", order: 4 },
    { id: "early-2", requisitionCode: "REQ-00001", candidateCode: "REQ-00001-006", status: "Liên hệ UV", order: 6 },
  ]);

  assert.deepEqual(
    result.updates.map((item) => [item.id, item.to]),
    [
      ["deleted-gap", "REQ-00001-002"],
      ["early-2", "REQ-00001-003"],
    ],
  );
  assert.equal(result.updates.some((item) => item.id === "interviewed"), false);
  assert.match(result.availableOrder, /^\[5,999\]/);
});

test("phiếu đã có đánh giá luôn được khóa dù trạng thái còn sớm", () => {
  const result = compactCandidateNumbers([
    { id: "evaluated", requisitionCode: "REQ-2", candidateCode: "REQ-2-008", status: "Liên hệ UV", hasEvaluation: true, order: 1 },
    { id: "new", requisitionCode: "REQ-2", candidateCode: "REQ-2-010", status: "CV Nộp", order: 2 },
  ]);
  assert.deepEqual(result.updates.map((item) => item.to), ["REQ-2-001"]);
  assert.equal(result.updates.some((item) => item.id === "evaluated"), false);
});
