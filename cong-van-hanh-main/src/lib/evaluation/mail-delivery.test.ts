import assert from "node:assert/strict";
import test from "node:test";

import {
  buildEvaluationCustomMailVariables,
  buildEvaluationMailVariables,
  evaluationAvailableFromValue,
  evaluationDeadlineValue,
  evaluationPdfAttachmentCacheKey,
  evaluationMailFormTemplateReferences,
  evaluationMailRecipientRoles,
  evaluationRecipientRoleCodes,
  isEvaluationMailRecordActive,
  planEvaluationMailRetries,
  renderEvaluationMailTemplate,
} from "@/lib/evaluation/mail-delivery";
import {
  evaluationMailTemplateForRole,
  evaluationNewlyActivatedRoles,
  selectEvaluationMailTemplateForContext,
} from "@/lib/evaluation/mail-flow";

test("100 nhân sự trong cùng kỳ có 100 khóa PDF riêng, không dùng lại hợp đồng người đầu", () => {
  const keys = Array.from({ length: 100 }, (_, index) =>
    ["template-contract", "template-appendix"].map((templateId) =>
      evaluationPdfAttachmentCacheKey({
        evaluationInstanceId: `instance-${index + 1}`,
        recipientEmployeeCode: "cnb-recipient",
        reviewerRole: "hr",
        templateId,
      }),
    ),
  ).flat();
  assert.equal(new Set(keys).size, 200);
  assert.notEqual(keys[0], keys[99]);
});

test("chọn đúng khối mail theo loại đánh giá và lấy nội dung riêng từng vai trò", () => {
  const templates = [
    {
      code: "MAIL_LEGACY",
      content: {
        eventCode: "review_assigned",
        isActive: true,
      },
      id: "legacy",
      status: "active",
      updatedAt: "2026-08-01T00:00:00.000Z",
    },
    {
      code: "MAIL_PROBATION",
      content: {
        cycleTypeTemplateId: "TYPE_PROBATION",
        eventCode: "review_assigned",
        isActive: true,
        roleTemplates: [
          {
            bodyTemplate: "Mail nhân viên",
            enabled: true,
            role: "self",
            subjectTemplate: "Nhân viên",
          },
          {
            bodyTemplate: "Mail quản lý",
            enabled: true,
            role: "manager",
            subjectTemplate: "Quản lý",
          },
        ],
      },
      id: "probation",
      status: "active",
      updatedAt: "2026-08-02T00:00:00.000Z",
    },
  ];

  const selection = selectEvaluationMailTemplateForContext(templates, {
    cycleTypeKeys: ["TYPE_PROBATION"],
    eventCode: "review_assigned",
  });
  assert.equal(selection.template?.id, "probation");
  assert.equal(selection.usedLegacyFallback, false);
  assert.equal(
    evaluationMailTemplateForRole(selection.template?.content, "self")
      ?.subjectTemplate,
    "Nhân viên",
  );
  assert.equal(
    evaluationMailTemplateForRole(selection.template?.content, "manager")
      ?.bodyTemplate,
    "Mail quản lý",
  );
  assert.equal(
    evaluationMailTemplateForRole(selection.template?.content, "peer"),
    null,
  );
});

test("mẫu cũ chưa phân loại chỉ làm dự phòng khi loại chưa có mẫu riêng", () => {
  const selection = selectEvaluationMailTemplateForContext(
    [
      {
        content: { eventCode: "review_assigned", isActive: true },
        id: "legacy",
        status: "active",
      },
    ],
    {
      cycleTypeKeys: ["TYPE_PERIODIC"],
      eventCode: "review_assigned",
    },
  );
  assert.equal(selection.template?.id, "legacy");
  assert.equal(selection.usedLegacyFallback, true);
});

test("vai trò bị tắt không nhận mail dù đang có lượt trong workflow", () => {
  const content = {
    recipientRoles: ["self"],
    roleTemplates: [
      {
        bodyTemplate: "Mail nhân viên",
        enabled: true,
        role: "self",
        subjectTemplate: "Nhân viên",
      },
      {
        bodyTemplate: "Mail quản lý",
        enabled: false,
        role: "manager",
        subjectTemplate: "Quản lý",
      },
    ],
  };
  assert.equal(
    evaluationMailTemplateForRole(content, "self")?.subjectTemplate,
    "Nhân viên",
  );
  assert.equal(evaluationMailTemplateForRole(content, "manager"), null);
});

test("mail hỗ trợ nhiều biểu mẫu PDF và vẫn đọc cấu hình một biểu mẫu cũ", () => {
  assert.deepEqual(
    evaluationMailFormTemplateReferences({
      formTemplates: [
        { code: "HDLD", id: "template-contract", name: "Hợp đồng lao động" },
        { code: "PL", id: "template-appendix", name: "Phụ lục lương" },
        { code: "HDLD", id: "template-contract", name: "Bản trùng" },
      ],
    }),
    [
      {
        code: "HDLD",
        decisionOptionCode: "",
        decisionOptionId: "",
        id: "template-contract",
        name: "Hợp đồng lao động",
        url: "",
      },
      {
        code: "PL",
        decisionOptionCode: "",
        decisionOptionId: "",
        id: "template-appendix",
        name: "Phụ lục lương",
        url: "",
      },
    ],
  );
  assert.deepEqual(
    evaluationMailFormTemplateReferences({
      formTemplateCode: "HDLD",
      formTemplateId: "template-contract",
      formTemplateName: "Hợp đồng lao động",
    }),
    [
      {
        code: "HDLD",
        decisionOptionCode: "",
        decisionOptionId: "",
        id: "template-contract",
        name: "Hợp đồng lao động",
        url: "",
      },
    ],
  );
});

test("lọc biểu mẫu đính kèm theo đúng kết quả CnB đã chọn", () => {
  const configured = {
    formTemplates: [
      {
        code: "HDLD",
        decisionOptionCode: "PASS",
        id: "template-contract",
        name: "Hợp đồng lao động",
      },
      {
        code: "NOTICE",
        decisionOptionId: "decision-fail",
        id: "template-fail-notice",
        name: "Thông báo chưa đạt",
      },
      {
        code: "SUMMARY",
        id: "template-summary",
        name: "Biên bản tổng hợp",
      },
    ],
  };
  assert.deepEqual(
    evaluationMailFormTemplateReferences(configured, {
      decisionOptionCode: "PASS",
      decisionOptionId: "decision-pass",
    }).map((item) => item.id),
    ["template-contract", "template-summary"],
  );
  assert.deepEqual(
    evaluationMailFormTemplateReferences(configured, {
      decisionOptionCode: "FAIL",
      decisionOptionId: "decision-fail",
    }).map((item) => item.id),
    ["template-fail-notice", "template-summary"],
  );
});

test("kỳ cũ vẫn giữ cửa sổ tính theo ngày kết thúc", () => {
  const cycle = {
    endDate: "2026-09-30",
    manualExpiryDays: 3,
    manualLeadDays: 7,
  };
  assert.equal(evaluationAvailableFromValue({}, cycle), "2026-09-23");
  assert.equal(evaluationDeadlineValue({}, cycle), "2026-10-03");
  assert.equal(
    evaluationDeadlineValue({ deadline: "2026-10-05" }, cycle),
    "2026-10-05",
  );
  assert.equal(
    evaluationAvailableFromValue({}, { endDate: "2026-09-30" }),
    "2026-09-23",
  );
  assert.equal(
    evaluationDeadlineValue({}, { endDate: "2026-09-30" }),
    "2026-10-03",
  );
});

test("kỳ tạo tay tính hạn phiếu từ ngày sinh phiếu", () => {
  const cycle = {
    endDate: "2026-08-31",
    manualDeadlineMode: "from_generation",
    manualLifetimeDays: 3,
  };
  const generatedAt = "2026-09-21T10:30:00.000Z";
  assert.equal(
    evaluationAvailableFromValue({}, cycle, generatedAt),
    "2026-09-21",
  );
  assert.equal(evaluationDeadlineValue({}, cycle, generatedAt), "2026-09-24");
});

test("chỉ vai trò vừa mở ở stage kế tiếp mới nhận mail giao lượt", () => {
  assert.deepEqual(
    evaluationNewlyActivatedRoles(["self"], ["manager", "peer"]),
    ["manager", "peer"],
  );
  assert.deepEqual(
    evaluationNewlyActivatedRoles(
      ["self", "manager", "peer"],
      ["manager", "peer"],
    ),
    [],
  );
});

test("quản lý gián tiếp dùng nội dung mail quản lý làm dự phòng", () => {
  const content = {
    roleTemplates: [
      {
        bodyTemplate: "Mail cấp quản lý",
        enabled: true,
        role: "manager",
        subjectTemplate: "Đến lượt duyệt",
      },
    ],
  };
  const template = evaluationMailTemplateForRole(content, "indirect_manager");
  assert.equal(template?.recipientRole, "indirect_manager");
  assert.equal(template?.subjectTemplate, "Đến lượt duyệt");
});

test("chỉ gửi lại mail lỗi chưa có bản gửi thành công tương ứng", () => {
  const base = {
    content: {
      attempts: 1,
      eventCode: "review_assigned",
      recipientEmail: "manager@example.com",
      recipientRole: "manager",
      subject: "[Thuần Việt - CnB] Thông báo đánh giá",
    },
    parentId: "instance-1",
  };
  const plan = planEvaluationMailRetries([
    {
      ...base,
      createdAt: new Date("2026-08-12T08:00:00.000Z"),
      id: "failed-with-success",
      status: "failed",
    },
    {
      ...base,
      content: {
        ...base.content,
        subject: "[Gửi lại] [Thuần Việt - CnB] Thông báo đánh giá",
      },
      createdAt: new Date("2026-08-12T08:01:00.000Z"),
      id: "sent-newer",
      status: "sent",
    },
    {
      ...base,
      content: { ...base.content, recipientEmail: "employee@example.com" },
      createdAt: new Date("2026-08-12T08:02:00.000Z"),
      id: "failed-needs-retry",
      status: "failed",
    },
    {
      ...base,
      content: { ...base.content, attempts: 3, recipientRole: "hr" },
      createdAt: new Date("2026-08-12T08:03:00.000Z"),
      id: "failed-exhausted",
      status: "failed",
    },
  ]);

  assert.deepEqual(plan.retryIds, ["failed-needs-retry"]);
  assert.deepEqual(plan.supersededIds, ["failed-with-success"]);
  assert.deepEqual(plan.exhaustedIds, ["failed-exhausted"]);
});

test("có thể giới hạn mail gửi bù chỉ cho quản lý", () => {
  const content = {
    activeStepRoles: ["self", "manager"],
    employeeCode: "NV001",
    managerEmployeeCode: "QL001",
  };
  assert.deepEqual(evaluationRecipientRoleCodes(content, ["manager"]), [
    { code: "QL001", role: "manager" },
  ]);
  assert.deepEqual(
    evaluationRecipientRoleCodes(content, ["current_reviewer", "employee"]),
    [
      { code: "NV001", role: "self" },
      { code: "QL001", role: "manager" },
    ],
  );
});

test("mail giao lượt M2 lấy đúng mã quản lý gián tiếp", () => {
  const content = {
    activeStepRoles: ["indirect_manager"],
    employeeCode: "NV001",
    indirectManagerEmployeeCode: "M2001",
    managerEmployeeCode: "M1001",
  };
  assert.deepEqual(
    evaluationRecipientRoleCodes(content, ["current_reviewer"]),
    [{ code: "M2001", role: "indirect_manager" }],
  );
});

test("mail giao lượt gửi riêng cho mọi assignment đang hoạt động", () => {
  const content = {
    activeReviewAssignmentIds: ["review-m2-a", "review-m2-b"],
    activeStepRoles: ["indirect_manager"],
    reviewAssignments: [
      {
        approvalPolicy: "all",
        employeeCode: "M2001",
        id: "review-m2-a",
        role: "indirect_manager",
        stageIndex: 0,
        status: "assigned",
        stepIndex: 0,
        stepKey: "m2",
      },
      {
        approvalPolicy: "all",
        employeeCode: "M2002",
        id: "review-m2-b",
        role: "indirect_manager",
        stageIndex: 0,
        status: "assigned",
        stepIndex: 0,
        stepKey: "m2",
      },
    ],
  };
  assert.deepEqual(
    evaluationRecipientRoleCodes(content, ["current_reviewer"]),
    [
      {
        assignmentId: "review-m2-a",
        code: "M2001",
        role: "indirect_manager",
      },
      {
        assignmentId: "review-m2-b",
        code: "M2002",
        role: "indirect_manager",
      },
    ],
  );
  assert.deepEqual(
    evaluationRecipientRoleCodes(
      content,
      ["indirect_manager"],
      ["review-m2-b"],
    ),
    [
      {
        assignmentId: "review-m2-b",
        code: "M2002",
        role: "indirect_manager",
      },
    ],
  );
});

test("mail giao lượt chỉ lấy người đang đến lượt của workflow", () => {
  assert.deepEqual(
    evaluationMailRecipientRoles("review_assigned", ["employee"]),
    ["current_reviewer"],
  );
  assert.deepEqual(
    evaluationMailRecipientRoles("review_assigned", ["employee"], "manager"),
    ["manager"],
  );
  assert.deepEqual(
    evaluationMailRecipientRoles(
      "review_assigned",
      ["self", "manager", "peer"],
      "",
      ["manager", "peer"],
    ),
    ["manager", "peer"],
  );
});

test("sự kiện BOD và CnB có người nhận mặc định đúng nghiệp vụ", () => {
  assert.deepEqual(
    evaluationMailRecipientRoles("bod_adjustment_requested", []),
    ["manager", "hr"],
  );
  assert.deepEqual(evaluationMailRecipientRoles("bod_rejected", []), [
    "manager",
    "hr",
  ]);
  assert.deepEqual(evaluationMailRecipientRoles("cnb_result_finalized", []), [
    "employee",
    "manager",
    "hr",
  ]);
  assert.deepEqual(
    evaluationMailRecipientRoles("cnb_finalization_required", []),
    ["hr"],
  );
});

test("renderEvaluationMailTemplate thay biến và giữ biến thiếu ở dạng rỗng", () => {
  assert.equal(
    renderEvaluationMailTemplate(
      "Đánh giá {{ nhan_su }} - {{ten_ky}} - {{khong_co}}",
      { nhan_su: "Nguyễn Văn A", ten_ky: "Thử việc" },
    ),
    "Đánh giá Nguyễn Văn A - Thử việc - ",
  );
});

test("renderEvaluationMailTemplate escape dữ liệu khi chèn vào HTML", () => {
  assert.equal(
    renderEvaluationMailTemplate(
      "<p>{{nhan_su}}</p>",
      { nhan_su: "A <B> & C" },
      true,
    ),
    "<p>A &lt;B&gt; &amp; C</p>",
  );
});

test("mail CnB cá nhân hóa theo từng phiếu và từng người nhận", () => {
  const instance = {
    code: "INST_001",
    content: {
      cycleId: "CYCLE_2026_08",
      cycleName: "Đánh giá thử việc tháng 08/2026",
      deadline: "2026-08-31",
      employeeCode: "NV001",
      employeeName: "Nguyễn Văn A",
      id: "LEGACY_INST_001",
      managerName: "Trần Thị B",
    },
    id: "db-instance-001",
    name: "Nguyễn Văn A",
    parentId: "CYCLE_2026_08",
    recordType: "evaluation-instance",
    status: "in_progress",
  };
  const variables = buildEvaluationMailVariables(
    instance,
    "manager",
    "Trần Thị B",
  );
  assert.equal(variables.nhan_su, "Nguyễn Văn A");
  assert.equal(variables.nguoi_nhan, "Trần Thị B");
  assert.equal(variables.nguoi_quan_ly, "Trần Thị B");
  assert.equal(variables.han_danh_gia, "31/08/2026");
  assert.equal(
    renderEvaluationMailTemplate(
      "Chào {{nguoi_nhan}}, bạn đánh giá {{nhan_su}} trong {{ten_ky}}.",
      variables,
    ),
    "Chào Trần Thị B, bạn đánh giá Nguyễn Văn A trong Đánh giá thử việc tháng 08/2026.",
  );
});

test("mail CnB dùng mặc định sau 3 ngày khi phiếu cũ chưa lưu deadline", () => {
  const instance = {
    code: "INST_NO_DEADLINE",
    content: {
      cycleId: "CYCLE_CURRENT",
      employeeCode: "NV001",
      employeeName: "Nguyễn Văn A",
      id: "INST_NO_DEADLINE",
    },
    id: "db-instance-no-deadline",
    name: "Nguyễn Văn A",
    parentId: "CYCLE_CURRENT",
    recordType: "evaluation-instance",
    status: "in_progress",
  };
  const cycle = {
    code: "CYCLE_CURRENT",
    content: { endDate: "2026-08-10", id: "CYCLE_CURRENT" },
    id: "db-cycle-current",
    name: "Kỳ hiện tại",
    parentId: null,
    recordType: "evaluation-cycle",
    status: "active",
  };
  const variables = buildEvaluationMailVariables(
    instance,
    "self",
    "Nguyễn Văn A",
    cycle,
  );
  assert.equal(variables.han_danh_gia, "13/08/2026");
});

test("biến email tùy chỉnh lấy đúng hành động và câu trả lời CnB/CEO", () => {
  const instance = {
    code: "INST_CUSTOM_VARIABLES",
    content: {
      bodDecision: "adjustment",
      cnbConclusionAnswers: {
        EFFECTIVE_DATE: "2026-09-01",
        NEW_BASE_SALARY: "12500000",
      },
      decisionAnswers: {
        bod: { CEO_NOTE: "Bổ sung phụ lục hợp đồng." },
      },
    },
    id: "db-instance-custom-variables",
    name: "Nguyễn Văn A",
    parentId: "CYCLE_CUSTOM",
    recordType: "evaluation-instance",
    status: "finalized",
  };
  const variables = buildEvaluationCustomMailVariables(instance, [
    {
      fieldType: "currency",
      key: "muc_luong_moi",
      name: "Mức lương mới",
      sourcePath: "cnb.answer.NEW_BASE_SALARY",
    },
    {
      fieldType: "date",
      key: "ngay_ap_dung",
      name: "Ngày áp dụng",
      sourcePath: "cnb.answer.EFFECTIVE_DATE",
    },
    {
      fieldType: "text",
      key: "ghi_chu_ceo",
      name: "Ghi chú CEO",
      sourcePath: "ceo.answer.CEO_NOTE",
    },
    {
      fieldType: "text",
      key: "hanh_dong_ceo",
      name: "Hành động CEO",
      sourcePath: "ceo.action.bodDecision",
    },
  ]);
  assert.deepEqual(variables, {
    ghi_chu_ceo: "Bổ sung phụ lục hợp đồng.",
    hanh_dong_ceo: "Điều chỉnh",
    muc_luong_moi: "12,500,000",
    ngay_ap_dung: "01/09/2026",
  });
});

test("mail BOD và mail trả kết quả lấy đúng quyết định, phản hồi và kết luận", () => {
  const instance = {
    code: "INST_BOD",
    content: {
      bodDecision: "adjustment",
      bodFeedback: "Điều chỉnh thời hạn gia hạn.",
      bodReviewedBy: "Nguyễn Văn BOD",
      decisionOptionLabel: "Gia hạn hợp đồng",
      employeeCode: "NV001",
      employeeName: "Nguyễn Văn A",
      finalScore: 86.5,
      hrComment: "Đã đối chiếu hồ sơ.",
      id: "INST_BOD",
    },
    id: "db-instance-bod",
    name: "Nguyễn Văn A",
    parentId: "CYCLE_CURRENT",
    recordType: "evaluation-instance",
    status: "finalized",
  };
  const variables = buildEvaluationMailVariables(instance, "manager");
  assert.equal(variables.quyet_dinh_bod, "Điều chỉnh");
  assert.equal(variables.phan_hoi_bod, "Điều chỉnh thời hạn gia hạn.");
  assert.equal(variables.nguoi_duyet_bod, "Nguyễn Văn BOD");
  assert.equal(variables.ket_luan, "Gia hạn hợp đồng");
  assert.equal(variables.nhan_xet_cnb, "Đã đối chiếu hồ sơ.");
  assert.equal(variables.diem_tong, "86.5");
});

test("mail CnB không coi phiếu hoặc kỳ đã xóa là active", () => {
  assert.equal(
    isEvaluationMailRecordActive({
      content: { isActive: true },
      status: "active",
    }),
    true,
  );
  assert.equal(
    isEvaluationMailRecordActive({
      content: { isActive: false },
      status: "active",
    }),
    false,
  );
  assert.equal(
    isEvaluationMailRecordActive({
      content: { isActive: true },
      status: "inactive",
    }),
    false,
  );
});
