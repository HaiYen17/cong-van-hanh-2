import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalEvaluationJdTitle,
  deriveEvaluationJdTitle,
  normalizePositionKey,
  restoreEvaluationJdTitle,
  selectEvaluationJdByIdentifier,
  selectSharedJdByPolicy,
  type JdRecordInput,
} from "./jd-policy";

function evaluationDocument(
  id: string,
  title: string,
  options: {
    date?: string;
    status?: string;
  } = {},
): JdRecordInput {
  return {
    content: {
      displayTitle: title,
      driveModifiedAt: options.date || "2026-01-01",
      jobTitleName: title.replace(/^\[BC\]\s*-\s*/i, ""),
    },
    id,
    name: title,
    status: options.status || "active",
  };
}

test("chuẩn hóa vị trí không phân biệt dấu, hoa thường và tiền tố [BC]", () => {
  assert.equal(
    normalizePositionKey("[BC] - Trưởng phòng Kiến tạo nhân sự"),
    normalizePositionKey("truong PHONG kien tao nhan su"),
  );
});

test("tách tên JD CamelCase nhưng giữ nguyên mã B2B", () => {
  assert.equal(
    deriveEvaluationJdTitle("06052026_JD_NhanVienKinhDoanhB2B.docx"),
    "Nhan Vien Kinh Doanh B2B",
  );
  assert.equal(
    restoreEvaluationJdTitle("06052026_JD_NhanVienKinhDoanhB2B.docx"),
    "Nhân viên kinh doanh B2B",
  );
  assert.equal(
    normalizePositionKey("Nhân viên kinh doanh b 2B"),
    normalizePositionKey("Nhân viên kinh doanh B2B"),
  );
});

test("khôi phục đúng cụm kế toán thanh toán, không đổi thành thành toán", () => {
  assert.equal(
    restoreEvaluationJdTitle("08052026_JD_ChuyenVienKeToanThanhToan.docx"),
    "Chuyên viên kế toán thanh toán",
  );
  assert.equal(
    canonicalEvaluationJdTitle({
      fileName: "08052026_JD_ChuyenVienKeToanThanhToan.docx",
      storedTitles: ["Chuyên viên kế toán thành toán"],
    }),
    "Chuyên viên kế toán thanh toán",
  );
});

test("khôi phục đúng cụm nệm cao su, không đổi su thành sư hoặc sự", () => {
  assert.equal(
    restoreEvaluationJdTitle("JD_NhanVienMayNemCaoSu.docx"),
    "Nhân viên may nệm cao su",
  );
  assert.equal(
    canonicalEvaluationJdTitle({
      fileName: "JD_NhanVienMayNemCaoSu.docx",
      storedTitles: ["Nhân viên may nệm cao sư"],
    }),
    "Nhân viên may nệm cao su",
  );
});

test("tự khớp chức danh từ filename kể cả dữ liệu cũ từng tách sai B2B", () => {
  const document: JdRecordInput = {
    content: {
      fileName: "06052026_JD_NhanVienKinhDoanhB2B.docx",
      mappedJobTitleName: "Nhân viên kinh doanh b 2B",
    },
    id: "jd-b2b",
    status: "active",
  };

  const selection = selectSharedJdByPolicy(
    "Nhân viên kinh doanh B2B",
    [document],
    [],
  );
  assert.equal(selection.evaluation?.record.id, "jd-b2b");
});

test("JD mới luôn thắng JD [BC] cùng vị trí dù bản [BC] mới sửa hơn", () => {
  const selection = selectSharedJdByPolicy(
    "Nhân viên content",
    [
      evaluationDocument("legacy", "[BC] - Nhân viên content", {
        date: "2026-07-24",
      }),
      evaluationDocument("current", "Nhân viên content", {
        date: "2026-05-27",
      }),
    ],
    [],
  );

  assert.equal(selection.source, "evaluation-new");
  assert.equal(selection.evaluation?.record.id, "current");
});

test("JD mới có tiền tố cấp nhân viên vẫn thắng bản [BC] ghi tên vị trí rút gọn", () => {
  const selection = selectSharedJdByPolicy(
    "Kế toán bán hàng",
    [
      evaluationDocument("legacy", "[BC] - Kế toán bán hàng"),
      evaluationDocument("current", "Nhân viên kế toán bán hàng"),
    ],
    [],
  );

  assert.equal(selection.source, "evaluation-new");
  assert.equal(selection.evaluation?.record.id, "current");
});

test("chỉ dùng JD [BC] khi vị trí không có JD mới", () => {
  const selection = selectSharedJdByPolicy(
    "Kế toán thanh toán",
    [evaluationDocument("legacy", "[BC] - Kế toán thanh toán")],
    [],
  );

  assert.equal(selection.source, "evaluation-legacy");
  assert.equal(selection.evaluation?.record.id, "legacy");
});

test("file tính điểm cũ chỉ được dùng khi kho Đánh giá không có JD", () => {
  const scoring: JdRecordInput = {
    content: {
      FileId: "drive-id",
      Position: "Nhân viên sales online",
      PositionKey: "NHAN_VIEN_SALES_ONLINE",
    },
    id: "scoring",
    name: "Nhân viên sales online",
  };

  const withEvaluation = selectSharedJdByPolicy(
    "Nhân viên sales online",
    [evaluationDocument("evaluation", "[BC] - Nhân viên sales online")],
    [scoring],
  );
  const withoutEvaluation = selectSharedJdByPolicy(
    "Nhân viên sales online",
    [],
    [scoring],
  );

  assert.equal(withEvaluation.source, "evaluation-legacy");
  assert.equal(withoutEvaluation.source, "scoring-legacy");
});

test("có thể chọn đích danh JD cho một nhân sự dù tên chức danh không khớp", () => {
  const documents = [
    evaluationDocument("jd-sales", "Nhân viên kinh doanh B2B"),
    evaluationDocument("jd-accounting", "Kế toán thanh toán"),
  ];

  assert.equal(
    selectEvaluationJdByIdentifier("jd-accounting", documents)?.id,
    "jd-accounting",
  );
});

test("không tự khớp JD đã ngưng hoặc bản trùng đã bị hạ", () => {
  const inactive = evaluationDocument("inactive", "Nhân viên kho", {
    status: "inactive",
  });
  const duplicate: JdRecordInput = {
    ...evaluationDocument("duplicate", "Nhân viên kho"),
    content: {
      displayTitle: "Nhân viên kho",
      duplicateOfDocumentId: "canonical",
      jobTitleName: "Nhân viên kho",
    },
  };

  const selection = selectSharedJdByPolicy(
    "Nhân viên kho",
    [inactive, duplicate],
    [],
  );
  assert.equal(selection.source, "none");
});
