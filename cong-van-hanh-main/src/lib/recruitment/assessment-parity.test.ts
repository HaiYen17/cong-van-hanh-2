import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_RECRUITMENT_CULTURE_VALUES,
  buildLegacyAssessmentVersions,
  calculateRecruitmentScore,
  normalizeHexacoPersonality,
  normalizeRecruitmentCultureValues,
} from "@/lib/recruitment/assessment-parity";

test("danh mục Văn hóa mặc định giữ đủ 5 giá trị và 14 thẻ hành vi", () => {
  const values = normalizeRecruitmentCultureValues([]);
  assert.equal(values.length, 5);
  assert.equal(
    values.reduce((sum, value) => sum + value.chips.length, 0),
    14,
  );
  assert.ok(
    values
      .find((value) => value.gtKey === "GT4")
      ?.chips.some((chip) => chip.code === "GT4_HAILONG"),
  );
  assert.deepEqual(values, DEFAULT_RECRUITMENT_CULTURE_VALUES);
});

test("HEXACO dùng ngưỡng và bảng nhóm tính cách đã nhập từ code cũ", () => {
  const personality = normalizeHexacoPersonality(
    {
      A: 0,
      C: 1,
      H: 4,
      O: 5,
      S: 0,
      X: 3,
      O_lvl: "Cao",
      X_lvl: "Cao",
    },
    [
      { content: { column_6: "H", column_8: 4, column_9: -2 } },
      { content: { column_6: "S", column_8: 4, column_9: -4 } },
      { content: { column_6: "X", column_8: 3, column_9: -2 } },
      { content: { column_6: "A", column_8: 6, column_9: -3 } },
      { content: { column_6: "C", column_8: 6, column_9: -3 } },
      { content: { column_6: "O", column_8: 5, column_9: -3 } },
    ],
    [
      {
        code: "Đỉnh H | X Cao | O Cao",
        content: {
          "Code dò": "Đỉnh H | X Cao | O Cao",
          "Phân tích": "Phân tích thật",
          "Tên nhóm": "Đại sứ liêm chính cởi mở",
        },
      },
    ],
  );
  assert.ok(personality);
  assert.equal(personality.peak.code, "Đỉnh H | X Cao | O Cao");
  assert.equal(personality.peak.groupName, "Đại sứ liêm chính cởi mở");
  assert.equal(personality.peak.analysis, "Phân tích thật");
  assert.equal(personality.percentages.length, 6);
});

test("lịch sử chấm cũ ghép JD và Văn hóa vào đúng phiên bản, đúng vòng", () => {
  const versions = buildLegacyAssessmentVersions(
    [
      {
        id: "snapshot-1",
        kind: "hexaco",
        payload: {
          "Detail(JSON)": JSON.stringify({
            gtEval: [
              {
                chips: [{ code: "GT1_KIENTAO", label: "Tập trung vào giải pháp", state: 3 }],
                gtKey: "GT1",
                gtName: "Làm chủ tương lai",
                score: 8,
              },
            ],
            gtUpdatedBy: "Người chấm Văn hóa",
            gtUpdatedRound: "Vòng 1",
            gtLastUpdated: "2026-02-21T03:19:15.933Z",
            techEval: [{ groupName: "Tài chính", note: "Tốt", score: 9 }],
            updatedBy: "Người chấm Chuyên môn",
            updatedRound: "Vòng 1",
            lastUpdated: "2026-02-21T03:19:13.988Z",
          }),
        },
      },
    ],
    "application-1",
    "UV-001",
  );
  assert.equal(versions.length, 1);
  assert.equal(versions[0].roundKey, "round_1");
  assert.equal(versions[0].legacyScoring.tech.length, 1);
  assert.equal(versions[0].legacyScoring.culture.length, 1);
  assert.equal(versions[0].finalScore, 8.5);
  const sectionMeta = versions[0].legacySectionMeta as {
    culture: { reviewerName: string };
    technical: { reviewerName: string };
  };
  assert.equal(
    sectionMeta.technical.reviewerName,
    "Người chấm Chuyên môn",
  );
  assert.equal(
    sectionMeta.culture.reviewerName,
    "Người chấm Văn hóa",
  );
});

test("SoVan_Logs được phục hồi thành kết quả sơ khảo đầy đủ", () => {
  const versions = buildLegacyAssessmentVersions(
    [
      {
        id: "so-van-row-2",
        kind: "so-van",
        payload: {
          "SV_Detail(JSON)": JSON.stringify({
            gtEval: [
              {
                gtKey: "GT1",
                gtName: "Làm chủ tương lai",
                score: 8,
              },
            ],
            svLastUpdated: "2026-03-12T03:22:20.992Z",
            svUpdatedBy: "Nguyễn Thị Mộng Kiều",
            techEval: [
              {
                groupName: "Hạch toán và ghi sổ kế toán",
                note: "Đã có kinh nghiệm",
                score: 6,
              },
            ],
          }),
        },
        sourceUpdatedAt: "2026-03-12T10:22:20.992Z",
      },
    ],
    "application-so-van",
    "UV-SO-VAN",
  );
  assert.equal(versions.length, 1);
  assert.equal(versions[0].roundKey, "preliminary");
  assert.equal(versions[0].roundLabel, "Sơ vấn");
  assert.equal(versions[0].reviewerName, "Nguyễn Thị Mộng Kiều");
  assert.equal(versions[0].legacyScoring.tech.length, 1);
  assert.equal(versions[0].legacyScoring.culture.length, 1);
  assert.equal(versions[0].finalScore, 7);
});

test("điểm tổng là trung bình trọng số chung như ứng dụng cũ", () => {
  assert.equal(
    calculateRecruitmentScore([
      { score: 10, sectionKey: "jd", weight: 1 },
      { score: 0, sectionKey: "culture", weight: 1 },
    ]),
    5,
  );
  assert.equal(
    calculateRecruitmentScore([
      {
        bonusLearning: true,
        bonusTechnical: true,
        level: 4,
        sectionKey: "preliminary",
        weight: 1,
      },
    ]),
    10,
  );
});
