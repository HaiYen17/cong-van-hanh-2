import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluationDecisionAnswerIsPresent,
  evaluationDecisionFieldIsVisible,
  evaluationDecisionQuestionHtml,
} from "./decision-fields";

test("supports AND for multiple selected values", () => {
    assert.equal(
      evaluationDecisionFieldIsVisible(
        {
          conditionMatchMode: "all",
          conditionValues: ["A", "B"],
          dependsOnFieldCode: "SOURCE",
        },
        { SOURCE: ["A", "B", "C"] },
      ), true,
    );
    assert.equal(
      evaluationDecisionFieldIsVisible(
        {
          conditionMatchMode: "all",
          conditionValues: ["A", "B"],
          dependsOnFieldCode: "SOURCE",
        },
        { SOURCE: ["A"] },
      ), false,
    );
});

test("supports OR and NOT together", () => {
    const field = {
      conditionExcludedValues: ["B"],
      conditionMatchMode: "any",
      conditionValues: ["A", "D"],
      dependsOnFieldCode: "SOURCE",
    };
    assert.equal(evaluationDecisionFieldIsVisible(field, { SOURCE: ["D"] }), true);
    assert.equal(evaluationDecisionFieldIsVisible(field, { SOURCE: ["A", "B"] }), false);
});

test("recognizes non-empty multi answers and sanitizes rich questions", () => {
    assert.equal(evaluationDecisionAnswerIsPresent('["A"]', "multi_choice"), true);
    assert.equal(evaluationDecisionAnswerIsPresent("[]", "multi_choice"), false);
    assert.equal(
      evaluationDecisionAnswerIsPresent({ amount: 3, unit: "month" }, "duration"),
      true,
    );
    assert.equal(
      evaluationDecisionAnswerIsPresent({ amount: "", unit: "forever" }, "duration"),
      true,
    );
    assert.equal(
      evaluationDecisionAnswerIsPresent({ amount: 0, unit: "month" }, "duration"),
      false,
    );
    assert.equal(
      evaluationDecisionQuestionHtml({
        labelHtml: '<strong style="color:#c00">Câu hỏi</strong><script>x</script>',
      }), '<strong style="color:#c00">Câu hỏi</strong>',
    );
});
