import assert from "node:assert/strict";
import test from "node:test";

import {
  buildEvaluationTemplateValues,
  formatEvaluationTemplateAnswer,
} from "./evaluation-context";

test("đưa câu trả lời CnB vào trường Biểu mẫu theo mã câu hỏi", () => {
  const values = buildEvaluationTemplateValues(
    {
      cnbConclusionAnswers: {
        CONTRACT_DURATION: { amount: 12, unit: "month" },
        CONTRACT_TYPE: "Xác định thời hạn",
      },
      decisionOptionLabel: "Gia hạn",
      employeeCode: "2411301",
      finalScore: 88.5,
    },
    [
      {
        code: "CONTRACT_TYPE",
        fieldType: "single_choice",
        label: "Loại hợp đồng",
      },
      {
        code: "CONTRACT_DURATION",
        fieldType: "duration",
        label: "Thời hạn gia hạn",
      },
    ],
  );

  assert.equal(values.evaluationConclusion, "Gia hạn");
  assert.equal(values.evaluationFinalScore, "88.5");
  assert.equal(
    values["evaluationCnb.CONTRACT_TYPE"],
    "Xác định thời hạn",
  );
  assert.equal(values["evaluationCnb.CONTRACT_DURATION"], "12 tháng");
});

test("định dạng ngày, tiền và thời hạn vĩnh viễn dễ đọc", () => {
  assert.equal(formatEvaluationTemplateAnswer("2026-08-12", "date"), "12/08/2026");
  assert.equal(formatEvaluationTemplateAnswer("01/09/2026", "date"), "01/09/2026");
  assert.equal(formatEvaluationTemplateAnswer(12500000, "currency"), "12,500,000");
  assert.equal(formatEvaluationTemplateAnswer(12500000, "number"), "12,500,000");
  assert.equal(
    formatEvaluationTemplateAnswer("12.500.000 VNĐ", "currency"),
    "12,500,000",
  );
  assert.equal(
    formatEvaluationTemplateAnswer({ permanent: true, unit: "forever" }, "duration"),
    "Vĩnh viễn",
  );
});

test("tách đúng ngày tháng năm từ ngày CnB để merge vào câu hợp đồng", () => {
  const values = buildEvaluationTemplateValues(
    { cnbConclusionAnswers: { CONTRACT_START_DATE: "01/09/2026" } },
    [
      {
        code: "CONTRACT_START_DATE",
        fieldType: "date",
        label: "Ngày bắt đầu hợp đồng",
      },
    ],
  );

  assert.equal(values["evaluationCnb.CONTRACT_START_DATE"], "01/09/2026");
  assert.equal(values["evaluationCnb.CONTRACT_START_DATE.day"], "01");
  assert.equal(values["evaluationCnb.CONTRACT_START_DATE.month"], "09");
  assert.equal(values["evaluationCnb.CONTRACT_START_DATE.year"], "2026");
});
