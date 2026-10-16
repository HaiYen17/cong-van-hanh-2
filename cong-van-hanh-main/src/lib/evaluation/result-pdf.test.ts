import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  buildEvaluationResultPdfDefinition,
  createEvaluationResultPdfBuffer,
  type EvaluationResultPdfInput,
} from "./result-pdf";

const fixture: EvaluationResultPdfInput = {
  instanceContent: {
    employeeCode: "QA-PDF-001",
    employeeName: "Nguyễn Thị Minh Anh",
    cycleName: "Đánh giá thử việc tháng 09/2026",
    cycleTypeName: "Đánh giá thử việc",
    jobTitleName: "Chuyên viên Hành chính Nhân sự",
    departmentName: "Hành chính Nhân sự",
    contractStartDate: "2026-07-01",
    contractEndDate: "2026-08-31",
    managerName: "Trần Văn Bình",
    indirectManagerName: "Lê Thị Hương",
    bodName: "Nguyễn Văn Giám đốc",
    status: "finalized",
    finalScore: 8.5,
    finalizedAt: "2026-09-03T03:00:00.000Z",
    finalizedBy: "Nhân sự CnB",
    decisionOptionLabel: "Đạt thử việc",
    employeeOverallComment:
      "Hoàn thành các đầu việc đúng hạn. Tiếp tục nâng cao kỹ năng phối hợp.",
    managerOverallComment:
      "Nhân sự đáp ứng yêu cầu công việc và chủ động cải tiến quy trình.",
    indirectManagerDecision: "accepted",
    indirectManagerFeedback: "Đồng ý với đề xuất của quản lý trực tiếp.",
    bodDecision: "accepted",
    hrComment: "Ký hợp đồng theo kết luận đã thống nhất.",
    decisionAnswers: {
      self: { GOALS: ["Phối hợp", "Nâng cao nghiệp vụ"] },
      manager: {
        PROPOSAL: "Ký hợp đồng",
        DETAILS:
          "1. Thời hạn hợp đồng: 06 tháng\n2. Thời gian bắt đầu hợp đồng: 01/06/2026",
        HIDDEN: "Không được xuất",
      },
    },
  },
  instanceName: "Nguyễn Thị Minh Anh",
  decisionFields: [
    {
      id: "field-goals",
      code: "GOALS",
      name: "Mục tiêu phát triển",
      content: { role: "self", fieldType: "multi_choice" },
    },
    {
      id: "field-proposal",
      code: "PROPOSAL",
      name: "Đề xuất của quản lý",
      content: { role: "manager", fieldType: "text", sortOrder: 10 },
    },
    {
      id: "field-details",
      code: "DETAILS",
      name: "Thông tin hợp đồng",
      content: {
        role: "manager",
        fieldType: "long_text",
        sortOrder: 20,
        labelHtml:
          '<span style="font-family:Carlito;font-size:11pt">Bạn vui lòng cung cấp thông tin chi tiết của hợp đồng bao gồm</span><div><b>1. Thời hạn hợp đồng</b></div><div><b>2. Thời gian bắt đầu hợp đồng</b></div>',
      },
    },
    {
      id: "field-hidden",
      code: "HIDDEN",
      name: "Trường ẩn",
      content: {
        role: "manager",
        sortOrder: 30,
        dependsOnFieldCode: "PROPOSAL",
        dependsOnValue: "Không đạt",
      },
    },
  ],
  scores: [
    ...Array.from({ length: 6 }, (_, index) => ({
      id: `technical-${index}`,
      name: `Tiêu chí chuyên môn ${index + 1}`,
      content: {
        sectionCode: "technical",
        sectionName: "Chuyên môn",
        sectionSortOrder: 10,
        sectionWeightPercent: 70,
        contentMode: "jd_dynamic",
        workGroupCode: "operations",
        workGroupName: "Vận hành hành chính",
        activityCode: `activity-${Math.floor(index / 2)}`,
        activityText: [
          "Theo dõi và tổng hợp hồ sơ nhân sự",
          "Điều phối yêu cầu hỗ trợ liên phòng ban",
          "Cải tiến quy trình và báo cáo kết quả thực hiện",
        ][Math.floor(index / 2)],
        expectedOutputText:
          "Hồ sơ chính xác, đầy đủ, đúng thời hạn; thông tin được kiểm tra trước khi bàn giao.",
        criteriaName: index % 2 ? "Chất lượng công việc" : "Tiến độ thực hiện",
        scoringMethod: "scale_5",
        employeeScore: 4.5,
        managerScore: 4,
        employeeComment: "Hoàn thành đúng hạn.",
        managerComment: "Có thể cải thiện bước rà soát để giảm sai sót.",
        evaluatorRoles: "self,manager",
        weightPercent: 10,
      },
    })),
    ...[
      "Làm chủ tương lai",
      "Thắng không kiêu, bại không nản",
      "Chân thành là gốc rễ của mối quan hệ tốt đẹp",
      "Thấu hiểu, chia sẻ cùng nhau phát triển",
      "Cầu thị học hỏi để phát triển",
    ].map((name, index) => ({
      id: `culture-${index}`,
      name,
      content: {
        sectionCode: "culture",
        sectionName: "Văn hóa",
        sectionSortOrder: 20,
        sectionWeightPercent: 30,
        contentMode: "criteria_set",
        criteriaName: name,
        employeeScore: 4,
        managerScore: 4.5,
        scoringMethod: "scale_5",
        evaluatorRoles: "self,manager",
        managerComment: "Thể hiện tốt trong quá trình làm việc.",
        weightPercent: 6,
      },
    })),
  ],
};

test("phiếu kết quả là A4 đứng và có đủ thông tin cùng 5 ô ký theo mẫu", () => {
  const definition = buildEvaluationResultPdfDefinition(fixture);
  assert.equal(definition.pageSize, "A4");
  assert.equal(definition.pageOrientation, "portrait");
  const serialized = JSON.stringify(definition);
  for (const label of [
    "I. THÔNG TIN CHUNG",
    "Phòng ban",
    "Thời hạn hợp đồng",
    "Ngày hoàn thành",
    "KÝ XÁC NHẬN",
    "Nhân viên",
    "Quản lý trực tiếp",
    "Trưởng bộ phận / phòng ban",
    "Giám đốc",
    "Bộ phận Nhân sự",
  ])
    assert.ok(serialized.includes(label), label);
  assert.equal((serialized.match(/Ký, ghi rõ họ tên/g) || []).length, 5);
  const signatureTable = definition.content.find(
    (item) =>
      "table" in item &&
      item.table?.body[0]?.some(
        (cell) =>
          typeof cell === "object" &&
          cell &&
          "text" in cell &&
          cell.text === "Ký xác nhận",
      ),
  );
  const signatureText = JSON.stringify(signatureTable);
  assert.ok(!signatureText.includes("Lê Thị Hương"));
  assert.ok(!signatureText.includes("Nguyễn Văn Giám đốc"));
  assert.ok(!signatureText.includes("Nhân sự CnB"));
  assert.ok(signatureText.includes("Nguyễn Thị Minh Anh"));
  assert.ok(signatureText.includes("Trần Văn Bình"));
  assert.ok(serialized.includes("KÝ XÁC NHẬN"));
  assert.ok(!serialized.includes("Ý KIẾN QUẢN LÝ GIÁN TIẾP"));
  assert.ok(!serialized.includes("Ý KIẾN BAN GIÁM ĐỐC"));
  assert.ok(!serialized.includes("QUYẾT ĐỊNH CnB"));
  assert.ok(!serialized.includes("Nội dung kết luận"));
  assert.ok(!serialized.includes("Tên Nhân viên và Quản lý trực tiếp"));
});

test("bảng công việc không dùng rowSpan làm giãn hàng khi sang trang", () => {
  const serialized = JSON.stringify(
    buildEvaluationResultPdfDefinition(fixture),
  );
  assert.ok(!serialized.includes('"rowSpan"'));
});

test("mọi tiêu chí nằm trong bảng riêng có tiêu đề công việc lặp khi qua trang", () => {
  const definition = buildEvaluationResultPdfDefinition(fixture);
  const tableNodes: Array<Record<string, unknown>> = [];
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const record = value as Record<string, unknown>;
    if (record.table && typeof record.table === "object") {
      tableNodes.push(record);
    }
    Object.values(record).forEach(visit);
  };
  visit(definition);
  const activityTables = tableNodes.filter((node) => {
    const table = node.table as Record<string, unknown>;
    const body = Array.isArray(table.body) ? table.body : [];
    return JSON.stringify(body[0] || []).includes(
      "Hồ sơ chính xác, đầy đủ, đúng thời hạn",
    );
  });
  assert.equal(activityTables.length, 3);
  for (const node of activityTables) {
    const table = node.table as Record<string, unknown>;
    const body = table.body as Array<Array<Record<string, unknown>>>;
    assert.equal(table.headerRows, 2);
    assert.equal(body.length, 4);
    assert.equal(body[0][0].colSpan, 4);
    assert.equal(body[1][1].text, "Tiêu chí thuộc công việc");
    assert.equal(body[2][0].text, "1/2");
    assert.equal(body[3][0].text, "2/2");
  }
});

test("điểm trung bình giữ đúng thang điểm gốc của tiêu chí", () => {
  const scaleFive = JSON.stringify(
    buildEvaluationResultPdfDefinition(fixture),
  );
  assert.ok(scaleFive.includes('"text":"Điểm TB /5"'));
  assert.ok(!scaleFive.includes('"text":"Điểm TB /10"'));
  assert.ok(scaleFive.includes("Điểm trung bình nhóm: 4.25/5"));
  assert.ok(scaleFive.includes("Tổng hợp 4.25/5"));
  assert.ok(scaleFive.includes('"text":"4.25/5"'));

  const scaleTen = JSON.stringify(
    buildEvaluationResultPdfDefinition({
      ...fixture,
      scores: [
        {
          ...fixture.scores[0],
          content: {
            ...fixture.scores[0].content,
            employeeScore: 8,
            managerScore: 9,
            scoringMethod: "scale_10",
          },
        },
      ],
    }),
  );
  assert.ok(scaleTen.includes("Điểm trung bình nhóm: 8.5/10"));
  assert.ok(scaleTen.includes("Tổng hợp 8.5/10"));
});

test("bảng ký không lặp các block câu trả lời hệ thống", () => {
  const serialized = JSON.stringify(
    buildEvaluationResultPdfDefinition(fixture),
  );
  assert.ok(!serialized.includes('"text":"Mục tiêu phát triển"'));
  assert.ok(!serialized.includes('"text":"Phối hợp, Nâng cao nghiệp vụ"'));
  assert.ok(!serialized.includes('"text":"Đề xuất của quản lý"'));
  assert.ok(!serialized.includes('"text":"Ký hợp đồng"'));
  assert.ok(!serialized.includes("Không được xuất"));
  assert.ok(!serialized.includes("[object Object]"));
});

test("thời hạn hợp đồng ưu tiên dữ liệu đã chốt của CnB", () => {
  const serialized = JSON.stringify(
    buildEvaluationResultPdfDefinition({
      ...fixture,
      instanceContent: {
        ...fixture.instanceContent,
        contractStartDate: "",
        contractEndDate: "",
        cnbConclusionAnswers: {
          CONTRACT_DURATION: { amount: 12, unit: "month" },
          CONTRACT_START_DATE: "2026-09-05",
        },
      },
    }),
  );
  assert.ok(serialized.includes("12 tháng"));
});

test("có điểm tạm tính chưa được coi là phiếu đã hoàn tất", () => {
  const serialized = JSON.stringify(
    buildEvaluationResultPdfDefinition({
      ...fixture,
      instanceContent: {
        ...fixture.instanceContent,
        status: "in_progress",
        finalizedAt: "",
      },
    }),
  );
  assert.ok(serialized.includes("BẢN NHÁP"));
  assert.ok(serialized.includes("Chưa hoàn thành"));
});

test("bảng ký không xuất lại câu hỏi riêng của kết luận CnB", () => {
  const serialized = JSON.stringify(
    buildEvaluationResultPdfDefinition({
      ...fixture,
      instanceContent: {
        ...fixture.instanceContent,
        decisionOptionId: "pass",
        cnbConclusionAnswers: {
          START: "2026-09-05",
          REJECT: "Câu trả lời cũ phải ẩn",
        },
      },
      resultContent: { cnbConclusionAnswers: {} },
      decisionFields: [
        {
          id: "start",
          code: "START",
          name: "Ngày bắt đầu",
          content: { role: "hr", decisionOptionId: "pass", fieldType: "date" },
        },
        {
          id: "reject",
          code: "REJECT",
          name: "Lý do từ chối",
          content: { role: "hr", decisionOptionId: "fail" },
        },
      ],
    }),
  );
  assert.ok(!serialized.includes('"text":"Ngày bắt đầu"'));
  assert.ok(!serialized.includes('"text":"05/09/2026"'));
  assert.ok(!serialized.includes("Câu trả lời cũ phải ẩn"));
});

test("ký xác nhận QLGT không chứa block quyết định của hệ thống", () => {
  const definition = buildEvaluationResultPdfDefinition({
    ...fixture,
    instanceContent: {
      ...fixture.instanceContent,
      indirectManagerDecision: "",
      indirectManagerFeedback: "",
      decisionAnswers: {
        indirect_manager: {
          INDIRECT_MANAGER_DECISION: "adjustment",
          INDIRECT_MANAGER_FEEDBACK: "Cần làm rõ mục tiêu mới.",
        },
      },
    },
  });
  const signatureTable = definition.content.find(
    (item) =>
      "table" in item &&
      item.table?.body[0]?.some(
        (cell) =>
          typeof cell === "object" &&
          cell &&
          "text" in cell &&
          cell.text === "Ký xác nhận",
      ),
  );
  assert.ok(!JSON.stringify(signatureTable).includes("Yêu cầu điều chỉnh"));
  assert.ok(!JSON.stringify(signatureTable).includes("Cần làm rõ mục tiêu mới."));
});

test("PDF chỉ có một dòng ký Trưởng BP/PB khi có nhiều cấp QLGT", () => {
  const definition = buildEvaluationResultPdfDefinition({
    ...fixture,
    instanceContent: {
      ...fixture.instanceContent,
      departmentHeadEmployeeCode: "M201",
      assignmentDecisionAnswers: {
        "m2-a": {
          INDIRECT_MANAGER_DECISION: "accepted",
          INDIRECT_MANAGER_FEEDBACK: "Đồng ý cấp một.",
        },
        "m2-b": {
          INDIRECT_MANAGER_DECISION: "adjustment",
          INDIRECT_MANAGER_FEEDBACK: "Bổ sung chỉ tiêu cấp hai.",
        },
      },
      reviewAssignments: [
        {
          approvalPolicy: "all",
          employeeCode: "NV001",
          employeeName: "Nguyễn Thị Minh Anh",
          id: "self-a",
          role: "self",
          stageIndex: 0,
          status: "submitted",
          stepIndex: 0,
          stepKey: "self",
          stepLabel: "Tự đánh giá",
        },
        {
          approvalPolicy: "all",
          employeeCode: "M201",
          employeeName: "Duyệt Một",
          id: "m2-a",
          role: "indirect_manager",
          stageIndex: 1,
          status: "submitted",
          stepIndex: 1,
          stepKey: "m2-level-1",
          stepLabel: "QLGT cấp 1",
        },
        {
          approvalPolicy: "all",
          employeeCode: "M202",
          employeeName: "Duyệt Hai",
          id: "m2-b",
          role: "indirect_manager",
          stageIndex: 2,
          status: "submitted",
          stepIndex: 2,
          stepKey: "m2-level-2",
          stepLabel: "QLGT cấp 2",
        },
      ],
    },
  });
  const signatureTable = definition.content.find(
    (item) =>
      "table" in item &&
      item.table?.body[0]?.some(
        (cell) =>
          typeof cell === "object" &&
          cell &&
          "text" in cell &&
          cell.text === "Ký xác nhận",
      ),
  );
  const serialized = JSON.stringify(signatureTable);
  assert.equal(
    (serialized.match(/Trưởng bộ phận \/ phòng ban/g) || []).length,
    1,
  );
  assert.ok(!serialized.includes("QLGT cấp 1"));
  assert.ok(!serialized.includes("QLGT cấp 2"));
  assert.ok(!serialized.includes("Đồng ý cấp một."));
  assert.ok(!serialized.includes("Bổ sung chỉ tiêu cấp hai."));
  assert.ok(!serialized.includes("Duyệt Một"));
  assert.ok(!serialized.includes("Duyệt Hai"));
});

test("render PDF thực, giữ dấu tiếng Việt và tên file an toàn", async () => {
  const result = await createEvaluationResultPdfBuffer(fixture);
  assert.equal(result.buffer.subarray(0, 5).toString("ascii"), "%PDF-");
  assert.ok(result.buffer.length > 10000);
  assert.equal(result.fileName, "Ket-qua-danh-gia-QA-PDF-001.pdf");
  if (process.env.EVALUATION_PDF_QA === "1") {
    const directory = path.join(
      process.cwd(),
      "tmp",
      "pdfs",
      "evaluation-feedback-44",
    );
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, result.fileName), result.buffer);
  }
});
