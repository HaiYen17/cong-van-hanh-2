import assert from "node:assert/strict";
import test from "node:test";

import {
  canViewRecruitmentAssessmentHistory,
  hasRecordedRecruitmentAssessment,
  isCompletedRecruitmentAssessmentStatus,
} from "./assessment-history-access";

const interviewer = {
  employeeCode: "NV001",
  employeeId: "employee-1",
  isAdmin: false,
  userId: "user-1",
};

test("hội đồng Vòng 2 xem được phiếu Vòng 1 đã hoàn tất của người khác", () => {
  assert.equal(
    canViewRecruitmentAssessmentHistory(
      interviewer,
      {
        reviewerEmployeeId: "employee-2",
        roundKey: "round_1",
        status: "submitted",
      },
      "round2",
    ),
    true,
  );
});

test("hội đồng không xem bản nháp vòng trước của người khác", () => {
  assert.equal(
    canViewRecruitmentAssessmentHistory(
      interviewer,
      {
        reviewerEmployeeId: "employee-2",
        roundKey: "round_1",
        status: "draft",
      },
      "round2",
    ),
    false,
  );
});

test("hội đồng xem được phiếu chuyển đổi có điểm dù trạng thái cũ còn là draft", () => {
  assert.equal(
    canViewRecruitmentAssessmentHistory(
      interviewer,
      {
        finalScore: 7.2,
        items: [{ sectionKey: "culture", score: 8 }],
        reviewerEmployeeId: "employee-2",
        roundKey: "round_1",
        status: "draft",
      },
      "round2",
    ),
    true,
  );
});

test("hội đồng không xem phiếu cùng vòng của người khác", () => {
  assert.equal(
    canViewRecruitmentAssessmentHistory(
      interviewer,
      {
        reviewerEmployeeId: "employee-2",
        roundKey: "round_2",
        status: "submitted",
      },
      "round2",
    ),
    false,
  );
});

test("người chấm vẫn xem được toàn bộ phiên bản do chính mình tạo", () => {
  assert.equal(
    canViewRecruitmentAssessmentHistory(
      interviewer,
      {
        reviewerEmployeeId: "employee-1",
        roundKey: "round_1",
        status: "draft",
      },
      "round2",
    ),
    true,
  );
});

test("quản trị hệ thống vẫn xem được toàn bộ lịch sử", () => {
  assert.equal(
    canViewRecruitmentAssessmentHistory(
      { ...interviewer, isAdmin: true },
      {
        reviewerEmployeeId: "employee-2",
        roundKey: "round_2",
        status: "draft",
      },
      "round2",
    ),
    true,
  );
});

test("Admin Tuyển dụng xem được toàn bộ lịch sử kể cả phiếu cùng vòng", () => {
  assert.equal(
    canViewRecruitmentAssessmentHistory(
      { ...interviewer, roles: ["admin-tuyen-dung"] },
      {
        reviewerEmployeeId: "employee-2",
        roundKey: "round_2",
        status: "draft",
      },
      "round2",
    ),
    true,
  );
});

test("chuẩn hóa đúng các trạng thái phiếu hoàn tất", () => {
  assert.equal(isCompletedRecruitmentAssessmentStatus("SUBMITTED"), true);
  assert.equal(isCompletedRecruitmentAssessmentStatus("completed"), true);
  assert.equal(isCompletedRecruitmentAssessmentStatus("published"), true);
  assert.equal(isCompletedRecruitmentAssessmentStatus("draft"), false);
  assert.equal(
    hasRecordedRecruitmentAssessment({
      finalScore: 0,
      items: [{ score: 0 }],
      roundKey: "round_1",
      status: "draft",
    }),
    true,
  );
  assert.equal(
    hasRecordedRecruitmentAssessment({
      finalScore: null,
      items: [],
      roundKey: "round_1",
      status: "draft",
    }),
    false,
  );
});
