import assert from "node:assert/strict";
import test from "node:test";

import {
  applyEvaluationDecisionCalculations,
  calculateEvaluationDecisionEndDate,
  parseEvaluationDecisionDate,
} from "./decision-calculations";

test("calculates CnB dates from both display and database date formats", () => {
  const duration = { amount: 7, unit: "month" };
  assert.equal(
    calculateEvaluationDecisionEndDate("19/09/2026", duration),
    "2027-04-19",
  );
  assert.equal(
    calculateEvaluationDecisionEndDate("2026-09-19", duration),
    "2027-04-19",
  );
});

test("clamps month and year calculations at the end of the month", () => {
  assert.equal(
    calculateEvaluationDecisionEndDate("31/01/2027", {
      amount: 1,
      unit: "month",
    }),
    "2027-02-28",
  );
  assert.equal(
    calculateEvaluationDecisionEndDate("29/02/2024", {
      amount: 1,
      unit: "year",
    }),
    "2025-02-28",
  );
});

test("supports permanent duration and rejects incomplete dependencies", () => {
  assert.equal(
    calculateEvaluationDecisionEndDate("", {
      amount: "",
      unit: "forever",
    }),
    "Vĩnh viễn",
  );
  assert.equal(
    calculateEvaluationDecisionEndDate("19/09/2026", {
      amount: 0,
      unit: "month",
    }),
    "",
  );
  assert.equal(
    calculateEvaluationDecisionEndDate("31/02/2026", {
      amount: 1,
      unit: "day",
    }),
    "",
  );
  assert.equal(parseEvaluationDecisionDate("31/02/2026"), null);
});

test("resolves chained formulas and removes stale generated values", () => {
  const fields = [
    {
      code: "FIRST_END",
      content: {
        calculationDurationFieldCode: "DURATION",
        calculationStartFieldCode: "START",
        fieldType: "calculated_date",
      },
    },
    {
      code: "SECOND_END",
      content: {
        calculationDurationFieldCode: "DURATION",
        calculationStartFieldCode: "FIRST_END",
        fieldType: "calculated_date",
      },
    },
  ];
  const answers = applyEvaluationDecisionCalculations(fields, {
    DURATION: { amount: 1, unit: "month" },
    FIRST_END: "stale",
    SECOND_END: "stale",
    START: "31/01/2027",
  });
  assert.deepEqual(answers, {
    DURATION: { amount: 1, unit: "month" },
    FIRST_END: "2027-02-28",
    SECOND_END: "2027-03-28",
    START: "31/01/2027",
  });

  const cleared = applyEvaluationDecisionCalculations(fields, {
    DURATION: { amount: "", unit: "month" },
    FIRST_END: "2027-02-28",
    SECOND_END: "2027-03-28",
    START: "31/01/2027",
  });
  assert.equal(cleared.FIRST_END, "");
  assert.equal(cleared.SECOND_END, "");
});
