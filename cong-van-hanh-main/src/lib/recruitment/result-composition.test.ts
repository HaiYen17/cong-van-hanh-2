import assert from "node:assert/strict";
import test from "node:test";

import {
  assessmentScopesForRole,
  resultRoundBundle,
} from "@/lib/recruitment/runtime";

function item(sectionKey: "jd" | "culture", score: number) {
  return {
    itemKey: `${sectionKey}-${score}`,
    itemName: sectionKey,
    score,
    sectionKey,
    weight: 1,
  };
}

function card(input: {
  id: string;
  reviewerName: string;
  roleKey: string;
  scores: Array<{ section: "jd" | "culture"; score: number }>;
  version?: number;
}) {
  return {
    finalScore: 0,
    id: input.id,
    items: input.scores.map((entry) => item(entry.section, entry.score)),
    reviewerName: input.reviewerName,
    roleKey: input.roleKey,
    roleLabel: input.roleKey,
    roundKey: "round_1",
    status: "submitted",
    updatedAt: `2026-08-0${input.version || 1}T08:00:00.000Z`,
    version: input.version || 1,
  };
}

test("phạm vi chấm hỗ trợ Chuyên môn, Văn hóa và một người chấm cả hai", () => {
  assert.deepEqual(assessmentScopesForRole("technical"), ["technical"]);
  assert.deepEqual(assessmentScopesForRole("culture"), ["culture"]);
  assert.deepEqual(assessmentScopesForRole("combined"), [
    "technical",
    "culture",
  ]);
  assert.deepEqual(assessmentScopesForRole("balance"), [
    "technical",
    "culture",
  ]);
});

test("kết quả ghép Chuyên môn và Văn hóa từ hai người, không lấy điểm 0 ngoài phạm vi", () => {
  const rounds = resultRoundBundle(
    [
      card({
        id: "technical-v2",
        reviewerName: "Người A",
        roleKey: "technical",
        scores: [
          { section: "jd", score: 8 },
          { section: "culture", score: 0 },
        ],
        version: 2,
      }),
      card({
        id: "culture-v1",
        reviewerName: "Người B",
        roleKey: "culture",
        scores: [
          { section: "jd", score: 0 },
          { section: "culture", score: 9 },
        ],
      }),
    ],
    [],
    {
      round_1: {
        culture: "culture-v1",
        technical: "technical-v2",
      },
    },
  );
  const roundOne = rounds.find((round) => round.key === "round_1");
  assert.ok(roundOne);
  assert.equal(roundOne.score, 8.5);
  assert.equal(roundOne.completed, 2);
  assert.equal(roundOne.isComplete, true);
  assert.deepEqual(roundOne.selectedSources, {
    culture: "culture-v1",
    technical: "technical-v2",
  });
});

test("một phiếu kết hợp có thể làm nguồn cho cả Chuyên môn và Văn hóa", () => {
  const combined = card({
    id: "combined-v1",
    reviewerName: "Người C",
    roleKey: "combined",
    scores: [
      { section: "jd", score: 7 },
      { section: "culture", score: 9 },
    ],
  });
  const roundOne = resultRoundBundle([combined], [], {})
    .find((round) => round.key === "round_1");
  assert.ok(roundOne);
  assert.equal(roundOne.score, 8);
  assert.deepEqual(roundOne.selectedSources, {
    culture: "combined-v1",
    technical: "combined-v1",
  });
  assert.deepEqual(
    roundOne.scorecards[0].selectedSections,
    ["technical", "culture"],
  );
});
