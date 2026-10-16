import assert from "node:assert/strict";
import test from "node:test";

import {
  findRecruitmentFormColumns,
  parseRecruitmentFormScoringConfig,
  scoreRecruitmentFormSubmission,
} from "@/lib/recruitment/form-scoring";
import { recruitmentGoogleSheetDate } from "@/lib/recruitment/form-sync";

function configRows() {
  const rows: unknown[][] = [];
  [
    ["H", 4, -2],
    ["S", 4, -4],
    ["X", 3, -2],
    ["A", 6, -3],
    ["C", 6, -3],
    ["O", 5, -3],
  ].forEach(([trait, high, low]) => {
    const row: unknown[] = [];
    row[5] = trait;
    row[7] = high;
    row[8] = low;
    rows.push(row);
  });
  for (let scenario = 1; scenario <= 6; scenario += 1) {
    const heading: unknown[] = [];
    heading[1] = `Tình huống ${scenario}`;
    rows.push(heading);
    for (let chip = 1; chip <= 12; chip += 1) {
      const row: unknown[] = [];
      row[2] = `Mình chọn cách ${chip}`;
      row[6] = chip === 1 ? 2 : -2;
      row[7] = chip === 2 ? 2 : 0;
      row[8] = 0;
      row[9] = 0;
      row[10] = 0;
      rows.push(row);
    }
  }
  return rows;
}

function formFixture() {
  const headers: string[] = ["Dấu thời gian", "Mã Phỏng vấn"];
  const row: unknown[] = [46239.5, "UV-TEST-001"];
  for (let question = 1; question <= 36; question += 1) {
    headers.push(`${question}) Câu hỏi [(1) Giống bạn nhất]`);
    row.push("A. Phương án giống nhất");
    headers.push(`${question}) Câu hỏi [(2) Không giống bạn]`);
    row.push("B. Phương án không giống");
  }
  for (let scenario = 1; scenario <= 6; scenario += 1) {
    headers.push(`Tình huống ${scenario}: Tình huống kiểm thử`);
    row.push("# 1. Mình chọn cách 1");
  }
  return { headers, row };
}

test("nhận đúng 36 cặp HEXACO và 6 tình huống văn hóa", () => {
  const fixture = formFixture();
  const columns = findRecruitmentFormColumns(fixture.headers);
  assert.equal(columns.most.length, 36);
  assert.equal(columns.least.length, 36);
  assert.equal(columns.culture.length, 6);
});

test("chấm bài Form theo đúng fallback và công thức GT của hệ thống cũ", () => {
  const fixture = formFixture();
  const config = parseRecruitmentFormScoringConfig(configRows());
  const scored = scoreRecruitmentFormSubmission({
    config,
    headers: fixture.headers,
    row: fixture.row,
  });
  assert.equal(config.usedFallbackHexacoMap, true);
  assert.equal(scored.code, "UV-TEST-001");
  assert.equal(scored.detailHex.length, 36);
  assert.equal(
    Object.values(scored.hex).reduce((sum, score) => sum + score, 0),
    0,
  );
  assert.equal(scored.gtAbsolute.GT1, 100);
  assert.equal(scored.gtAbsolute.GT2, 50);
  Object.values(scored.gtProfile).forEach((score) => {
    assert.ok(score >= 0 && score <= 100);
  });
});

test("JSON tóm tắt không mang toàn bộ câu trả lời và luôn dưới 50.000 ký tự", () => {
  const fixture = formFixture();
  const scored = scoreRecruitmentFormSubmission({
    config: parseRecruitmentFormScoringConfig(configRows()),
    headers: fixture.headers,
    row: fixture.row,
  });
  const compact = JSON.stringify({
    detailHex: scored.detailHex.map((item) => ({
      addTrait: item.addTrait,
      q: item.q,
      subTrait: item.subTrait,
    })),
    gtAbs: scored.gtAbsolute,
    gtProfile: scored.gtProfile,
    hex: scored.hex,
    interviewCode: scored.code,
    lvl: scored.levels,
  });
  assert.ok(compact.length < 50_000);
  assert.equal(compact.includes("Phương án giống nhất"), false);
});

test("đổi serial Google Sheet sang đúng ngày giờ Việt Nam", () => {
  const parsed = recruitmentGoogleSheetDate(46239.5);
  assert.equal(parsed?.toISOString(), "2026-08-05T05:00:00.000Z");
});
