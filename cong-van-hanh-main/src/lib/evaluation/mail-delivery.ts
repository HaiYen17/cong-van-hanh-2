import "server-only";

import { createHash } from "node:crypto";

import { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import {
  evaluationMailTemplateForRole,
  evaluationMailTemplateRecipientRoles,
  normalizeEvaluationMailRecipientRole,
  selectEvaluationMailTemplateForContext,
  type EvaluationMailFlowRecord,
} from "@/lib/evaluation/mail-flow";
import {
  evaluationRecordLegacyId,
  findEvaluationRecordByIdentifier,
} from "@/lib/evaluation/record-identity";
import { evaluationReviewAssignments } from "@/lib/evaluation/workflow";
import {
  resolveModuleMailRoute,
  sendModuleEmail,
  type ModuleMailAttachment,
} from "@/lib/mail/module-mail-router";
import {
  asRecord,
  numberValue,
  stringList,
  text,
  type JsonRecord,
} from "@/lib/operations/json";
import { formatEvaluationTemplateAnswer } from "@/lib/templates/evaluation-context";
import {
  generateEvaluationTemplatePdfAttachment,
  previewEvaluationTemplatePdfMerge,
} from "@/lib/templates/runtime";

export const EVALUATION_MAIL_EVENT_CODES = [
  "review_assigned",
  "review_reminder",
  "review_overdue",
  "review_returned",
  "bod_adjustment_requested",
  "bod_rejected",
  "cnb_finalization_required",
  "cnb_result_finalized",
  "evaluation_completed",
] as const;

export type EvaluationMailEventCode =
  (typeof EVALUATION_MAIL_EVENT_CODES)[number];

export type EvaluationMailRetryRecord = {
  content: unknown;
  createdAt: Date;
  id: string;
  parentId: string | null;
  status: string;
};

export function evaluationMailRetryKey(record: EvaluationMailRetryRecord) {
  const content = asRecord(record.content);
  const subject = text(content.subject)
    .replace(/^(?:\[G\u1EEDi l\u1EA1i\]\s*)+/giu, "")
    .trim()
    .toLowerCase();
  return [
    text(content.eventCode || content.event).toLowerCase(),
    text(record.parentId || content.instanceId),
    text(content.recipientRole).toLowerCase(),
    text(content.recipientEmail).toLowerCase(),
    subject,
  ].join("|");
}

export function planEvaluationMailRetries(
  records: EvaluationMailRetryRecord[],
) {
  const sentAtByKey = new Map<string, number>();
  for (const record of records) {
    if (text(record.status).toLowerCase() !== "sent") continue;
    const key = evaluationMailRetryKey(record);
    sentAtByKey.set(
      key,
      Math.max(sentAtByKey.get(key) || 0, record.createdAt.getTime()),
    );
  }
  const exhaustedIds: string[] = [];
  const retryIds: string[] = [];
  const supersededIds: string[] = [];
  for (const record of records) {
    if (text(record.status).toLowerCase() !== "failed") continue;
    const sentAt = sentAtByKey.get(evaluationMailRetryKey(record)) || 0;
    if (sentAt >= record.createdAt.getTime()) {
      supersededIds.push(record.id);
    } else if (numberValue(asRecord(record.content).attempts) >= 3) {
      exhaustedIds.push(record.id);
    } else {
      retryIds.push(record.id);
    }
  }
  return { exhaustedIds, retryIds, supersededIds };
}

type QueueOptions = {
  actorName?: string;
  assignmentIds?: string[];
  eventToken?: string;
  role?: string;
  roles?: string[];
  sendNow?: boolean;
  subjectPrefix?: string;
};

type EvaluationMailRecord = {
  code: string | null;
  content: unknown;
  id: string;
  name: string | null;
  parentId: string | null;
  recordType: string;
  status: string;
};

const INACTIVE_EVALUATION_STATUSES = new Set([
  "archived",
  "deleted",
  "inactive",
]);

const ROLE_LABELS: Record<string, string> = {
  bod: "CEO / Ban giám đốc",
  employee: "Nhân sự được đánh giá",
  hr: "Nhân sự CnB",
  manager: "Quản lý trực tiếp",
  indirect_manager: "Quản lý gián tiếp",
  peer: "Đồng nghiệp",
  self: "Nhân viên / Bản thân",
};

export const EVALUATION_MAIL_RESERVED_VARIABLE_KEYS = new Set([
  "diem_tong",
  "ghi_chu_tra_lai",
  "han_danh_gia",
  "ket_qua",
  "ket_luan",
  "link_danh_gia",
  "loai_danh_gia",
  "ma_nhan_su",
  "nhan_su",
  "nguoi_duyet_bod",
  "nguoi_nhan",
  "nguoi_quan_ly",
  "nguoi_quan_ly_gian_tiep",
  "nhan_xet_cnb",
  "phan_hoi_bod",
  "phan_hoi_quan_ly_gian_tiep",
  "quyet_dinh_bod",
  "quyet_dinh_quan_ly_gian_tiep",
  "ten_ky",
  "vai_tro",
]);

export type EvaluationMailCustomVariable = {
  fieldType: string;
  key: string;
  name: string;
  sourceLabel: string;
  sourcePath: string;
  token: string;
};

export function evaluationMailCustomVariableKey(value: unknown) {
  let key = text(value)
    .replace(/^\{\{|\}\}$/g, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, (match) => (match === "Đ" ? "D" : "d"))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  if (key && !/^[a-z]/.test(key)) key = `bien_${key}`;
  return key;
}

export function normalizeEvaluationMailCustomVariable(
  value: unknown,
): EvaluationMailCustomVariable | null {
  const source = asRecord(value);
  const key = evaluationMailCustomVariableKey(
    source.key || source.code || source.token,
  );
  const sourcePath = text(source.sourcePath).toLowerCase();
  if (
    !key ||
    EVALUATION_MAIL_RESERVED_VARIABLE_KEYS.has(key) ||
    !/^(?:cnb|ceo)\.(?:action|answer)\.[a-z0-9_-]+$/i.test(sourcePath)
  ) {
    return null;
  }
  return {
    fieldType: text(source.fieldType) || "text",
    key,
    name: text(source.name || source.label || key).slice(0, 120),
    sourceLabel: text(source.sourceLabel).slice(0, 240),
    sourcePath,
    token: `{{${key}}}`,
  };
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 40);
}

function escapeHtml(value: unknown) {
  return text(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function formatEvaluationMailDate(value: unknown) {
  const raw = text(value);
  if (!raw) return "";
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:\D|$)/);
  if (match) return `${match[3]}/${match[2]}/${match[1]}`;
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) return raw;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "2-digit",
      timeZone: "Asia/Ho_Chi_Minh",
      year: "numeric",
    })
      .formatToParts(date)
      .filter((part) => ["day", "month", "year"].includes(part.type))
      .map((part) => [part.type, part.value]),
  );
  return `${parts.day}/${parts.month}/${parts.year}`;
}

export type EvaluationMailFormTemplateReference = {
  code: string;
  decisionOptionCode: string;
  decisionOptionId: string;
  id: string;
  name: string;
  url: string;
};

export function evaluationPdfAttachmentCacheKey(input: {
  evaluationInstanceId: unknown;
  recipientEmployeeCode?: unknown;
  reviewerRole?: unknown;
  templateId: unknown;
}) {
  return [
    text(input.templateId),
    text(input.evaluationInstanceId),
    text(input.reviewerRole).toLowerCase(),
    text(input.recipientEmployeeCode),
  ].join("|");
}

function textArray(value: unknown) {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

export function evaluationMailFormTemplateReferences(
  value: unknown,
  resultContext?: unknown,
) {
  const source = asRecord(value);
  const result = asRecord(resultContext);
  const hasResultContext = resultContext != null;
  const objectReferences = Array.isArray(source.formTemplates)
    ? source.formTemplates.map(asRecord)
    : [];
  const ids = textArray(source.formTemplateIds);
  const codes = textArray(source.formTemplateCodes);
  const names = textArray(source.formTemplateNames);
  const urls = textArray(source.formTemplateUrls);
  const candidates: EvaluationMailFormTemplateReference[] =
    objectReferences.length
      ? objectReferences.map((reference) => ({
          code: text(reference.code || reference.formTemplateCode),
          decisionOptionCode: text(reference.decisionOptionCode),
          decisionOptionId: text(reference.decisionOptionId),
          id: text(reference.id || reference.formTemplateId || reference.code),
          name: text(reference.name || reference.formTemplateName),
          url: text(reference.url || reference.formTemplateUrl),
        }))
      : ids.map((id, index) => ({
          code: codes[index] || "",
          decisionOptionCode: "",
          decisionOptionId: "",
          id,
          name: names[index] || "",
          url: urls[index] || "",
        }));
  if (!candidates.length) {
    const legacyId = text(source.formTemplateId || source.formTemplateCode);
    if (legacyId) {
      candidates.push({
        code: text(source.formTemplateCode),
        decisionOptionCode: "",
        decisionOptionId: "",
        id: legacyId,
        name: text(source.formTemplateName),
        url: text(source.formTemplateUrl),
      });
    }
  }
  const seen = new Set<string>();
  return candidates.filter((reference) => {
    const key = reference.id || reference.code;
    if (!key || seen.has(key)) return false;
    const requiredResult = text(
      reference.decisionOptionId || reference.decisionOptionCode,
    );
    if (
      hasResultContext &&
      requiredResult &&
      ![
        result.decisionOptionId,
        result.decisionOptionCode,
        result.decisionOptionLabel,
      ]
        .map(text)
        .includes(requiredResult)
    ) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function evaluationMailRequiresResultPdf(eventCode: unknown) {
  return ["cnb_result_finalized", "evaluation_completed"].includes(
    text(eventCode).toLowerCase(),
  );
}

export async function appendEvaluationResultPdf(
  eventCode: unknown,
  attachments: ModuleMailAttachment[],
  generate: () => Promise<ModuleMailAttachment>,
) {
  if (!evaluationMailRequiresResultPdf(eventCode)) return attachments;
  const result = await generate();
  if (
    result.content.length < 5 ||
    Buffer.from(result.content).subarray(0, 5).toString("ascii") !== "%PDF-"
  ) {
    throw new Error(
      "Chưa tạo được PDF kết quả đánh giá. Email chưa được gửi để tránh thiếu biểu mẫu đính kèm.",
    );
  }
  return [result, ...attachments];
}

function appendEvaluationFormAttachmentNotice(input: {
  formTemplates: EvaluationMailFormTemplateReference[];
  htmlBody: string;
  includeResultPdf?: boolean;
  textBody: string;
}) {
  if (!input.formTemplates.length && !input.includeResultPdf) {
    return { htmlBody: input.htmlBody, textBody: input.textBody };
  }
  const labels = [
    ...(input.includeResultPdf
      ? ["Phiếu kết quả đánh giá (A4, có phần ký xác nhận)"]
      : []),
    ...input.formTemplates.map(
      (template, index) => template.name || `Biểu mẫu ${index + 1}`,
    ),
  ];
  const htmlBody = `${input.htmlBody}<div style="margin-top:18px;padding:14px 16px;border:1px solid #dfe9e5;border-radius:8px;background-color:#f5f8f6;color:#36534c"><strong>PDF đính kèm (${labels.length}):</strong><br><span style="display:inline-block;margin-top:6px">${labels.map(escapeHtml).join(" · ")}</span><br><span style="display:inline-block;margin-top:6px">Hệ thống đã tự điền dữ liệu từ đúng phiếu đánh giá vào từng file PDF gửi cùng email này.</span></div>`;
  const textBody =
    `${input.textBody}\n\nPDF đính kèm (${labels.length}): ${labels.join(", ")}. Hệ thống đã tự điền dữ liệu từ đúng phiếu đánh giá.`.trim();
  return { htmlBody, textBody };
}

async function configuredEvaluationSenderName(moduleKey: string) {
  const route = resolveModuleMailRoute(moduleKey, { allowDefault: false });
  const profiles = await getDb().evaluationRecord.findMany({
    orderBy: { updatedAt: "desc" },
    take: 20,
    where: {
      recordType: "evaluation-mail-sender-profile",
      status: { notIn: ["archived", "deleted", "inactive"] },
    },
  });
  const configured = profiles.find((profile) => {
    const content = asRecord(profile.content);
    return (
      text(content.moduleKey).toLowerCase() === route.moduleKey ||
      text(content.senderEmail).toLowerCase() === route.senderEmail
    );
  });
  return text(asRecord(configured?.content).senderName) || route.senderName;
}

export function renderEvaluationMailTemplate(
  source: unknown,
  variables: Record<string, unknown>,
  html = false,
) {
  return text(source).replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_match, key) => {
    const value = variables[text(key)] ?? "";
    return html ? escapeHtml(value) : text(value);
  });
}

function instanceLegacyId(instance: {
  code: string | null;
  content: unknown;
  id: string;
  parentId: string | null;
  recordType: string;
}) {
  return evaluationRecordLegacyId(instance);
}

export function isEvaluationMailRecordActive(
  record: Pick<EvaluationMailRecord, "content" | "status"> | null | undefined,
) {
  return Boolean(
    record &&
    !INACTIVE_EVALUATION_STATUSES.has(text(record.status).toLowerCase()) &&
    asRecord(record.content).isActive !== false,
  );
}

export function evaluationDeadlineValue(
  instanceOrContent: EvaluationMailRecord | JsonRecord,
  cycleOrContent?: EvaluationMailRecord | JsonRecord | null,
  generatedAt?: unknown,
) {
  const instanceContent =
    "content" in instanceOrContent
      ? asRecord(instanceOrContent.content)
      : asRecord(instanceOrContent);
  const cycleContent = cycleOrContent
    ? "content" in cycleOrContent
      ? asRecord(cycleOrContent.content)
      : asRecord(cycleOrContent)
    : {};
  const explicit = text(
    instanceContent.deadline ||
      instanceContent.deadlineDate ||
      instanceContent.dueAt ||
      cycleContent.deadline ||
      cycleContent.deadlineDate ||
      cycleContent.dueAt,
  );
  if (explicit) return explicit;
  const manualLifetimeDays = Math.max(
    0,
    numberValue(cycleContent.manualLifetimeDays, 0),
  );
  if (
    (text(cycleContent.manualDeadlineMode) === "from_generation" ||
      cycleContent.manualLifetimeDays != null) &&
    generatedAt
  ) {
    return addDays(evaluationDateOnly(generatedAt), manualLifetimeDays);
  }
  const cycleEnd = text(cycleContent.endDate);
  const manualExpiryDays = Math.max(
    0,
    numberValue(
      cycleContent.manualExpiryDays ?? cycleContent.expiryDays,
      3,
    ),
  );
  if (cycleEnd) {
    return addDays(cycleEnd.slice(0, 10), manualExpiryDays);
  }
  return text(instanceContent.endDate || cycleEnd);
}

export function evaluationAvailableFromValue(
  instanceOrContent: EvaluationMailRecord | JsonRecord,
  cycleOrContent?: EvaluationMailRecord | JsonRecord | null,
  generatedAt?: unknown,
) {
  const instanceContent =
    "content" in instanceOrContent
      ? asRecord(instanceOrContent.content)
      : asRecord(instanceOrContent);
  const cycleContent = cycleOrContent
    ? "content" in cycleOrContent
      ? asRecord(cycleOrContent.content)
      : asRecord(cycleOrContent)
    : {};
  const explicit = text(
    instanceContent.availableFrom || cycleContent.availableFrom,
  );
  if (explicit) return explicit;
  if (
    (text(cycleContent.manualDeadlineMode) === "from_generation" ||
      cycleContent.manualLifetimeDays != null) &&
    generatedAt
  ) {
    return evaluationDateOnly(generatedAt);
  }
  const cycleEnd = text(cycleContent.endDate);
  const manualLeadDays = Math.max(
    0,
    numberValue(cycleContent.manualLeadDays ?? cycleContent.leadDays, 7),
  );
  if (cycleEnd) {
    return addDays(cycleEnd.slice(0, 10), -manualLeadDays);
  }
  return text(instanceContent.startDate || cycleContent.startDate);
}

async function activeEvaluationMailContext(instanceIdentifier: unknown) {
  const instance = await findEvaluationRecordByIdentifier(
    "evaluation-instance",
    instanceIdentifier,
  );
  if (!instance || !isEvaluationMailRecordActive(instance)) {
    return { instance: null, reason: "instance_not_active" as const };
  }
  const content = asRecord(instance.content);
  const cycleIdentifier = text(
    content.cycleId || content.evaluationCycleId || instance.parentId,
  );
  const cycle = cycleIdentifier
    ? await findEvaluationRecordByIdentifier(
        "evaluation-cycle",
        cycleIdentifier,
      )
    : null;
  if (!cycle || !isEvaluationMailRecordActive(cycle)) {
    return { instance: null, reason: "cycle_not_active" as const };
  }
  return { cycle, instance, reason: "" as const };
}

function currentReviewerRoles(content: JsonRecord) {
  return stringList(content.activeStepRoles).filter(Boolean);
}

export function evaluationRecipientRoleCodes(
  content: JsonRecord,
  configuredRoles: string[],
  requestedAssignmentIds: string[] = [],
) {
  const pairs: Array<{ assignmentId?: string; code: string; role: string }> = [];
  const assignments = evaluationReviewAssignments(content);
  const activeAssignmentIds = new Set(
    stringList(content.activeReviewAssignmentIds),
  );
  const requestedIds = new Set(requestedAssignmentIds.map(text).filter(Boolean));
  const appendAssignment = (assignment: (typeof assignments)[number]) => {
    if (
      !pairs.some(
        (item) =>
          item.code === assignment.employeeCode &&
          item.role === assignment.role &&
          item.assignmentId === assignment.id,
      )
    ) {
      pairs.push({
        assignmentId: assignment.id,
        code: assignment.employeeCode,
        role: assignment.role,
      });
    }
  };
  const append = (role: string) => {
    const normalized = normalizeEvaluationMailRecipientRole(role);
    const assignmentMatches = assignments.filter(
      (assignment) =>
        assignment.role === normalized &&
        (!requestedIds.size || requestedIds.has(assignment.id)),
    );
    if (assignmentMatches.length) {
      assignmentMatches.forEach(appendAssignment);
      return;
    }
    const key =
      normalized === "self"
        ? "employeeCode"
        : normalized === "indirect_manager"
          ? "indirectManagerEmployeeCode"
          : `${normalized}EmployeeCode`;
    const code = text(content[key]);
    if (
      code &&
      !pairs.some((item) => item.code === code && item.role === normalized)
    ) {
      pairs.push({ code, role: normalized });
    }
  };
  for (const role of configuredRoles) {
    if (role === "current_reviewer") {
      if (assignments.length) {
        assignments
          .filter(
            (assignment) =>
              activeAssignmentIds.has(assignment.id) &&
              (!requestedIds.size || requestedIds.has(assignment.id)),
          )
          .forEach(appendAssignment);
      } else {
        currentReviewerRoles(content).forEach(append);
      }
    } else {
      append(role);
    }
  }
  return pairs;
}

export function evaluationMailRecipientRoles(
  eventCode: EvaluationMailEventCode,
  configuredRoles: string[],
  requestedRole = "",
  requestedRoles: string[] = [],
) {
  const requested = Array.from(
    new Set([requestedRole, ...requestedRoles].map(text).filter(Boolean)),
  );
  if (requested.length) return requested;
  if (
    ["review_assigned", "review_reminder", "review_overdue"].includes(eventCode)
  ) {
    return ["current_reviewer"];
  }
  const eventDefaults: Partial<Record<EvaluationMailEventCode, string[]>> = {
    bod_adjustment_requested: ["manager", "hr"],
    bod_rejected: ["manager", "hr"],
    cnb_finalization_required: ["hr"],
    cnb_result_finalized: ["employee", "manager", "hr"],
    evaluation_completed: ["employee", "manager", "hr"],
  };
  const defaultRoles = configuredRoles.length
    ? configuredRoles
    : eventDefaults[eventCode] || ["current_reviewer"];
  return defaultRoles;
}

function evaluationMailCycleTypeKeys(
  instance: EvaluationMailRecord,
  cycle?: EvaluationMailRecord | null,
) {
  const instanceContent = asRecord(instance.content);
  const cycleContent = asRecord(cycle?.content);
  return Array.from(
    new Set(
      [
        instanceContent.cycleTypeTemplateId,
        instanceContent.cycleTypeId,
        instanceContent.cycleTypeCode,
        instanceContent.evaluationTypeId,
        instanceContent.evaluationTypeCode,
        cycleContent.cycleTypeTemplateId,
        cycleContent.cycleTypeId,
        cycleContent.cycleTypeCode,
        cycleContent.evaluationTypeId,
        cycleContent.evaluationTypeCode,
      ]
        .map(text)
        .filter(Boolean),
    ),
  );
}

async function activeTemplate(
  eventCode: EvaluationMailEventCode,
  instance: EvaluationMailRecord,
  cycle?: EvaluationMailRecord | null,
  providedTemplates?: EvaluationMailFlowRecord[],
) {
  const templates =
    providedTemplates ||
    (await getDb().evaluationRecord.findMany({
      orderBy: { updatedAt: "desc" },
      where: {
        recordType: "evaluation-mail-template",
        status: { notIn: ["inactive", "archived", "draft"] },
      },
    }));
  return selectEvaluationMailTemplateForContext(templates, {
    cycleTypeKeys: evaluationMailCycleTypeKeys(instance, cycle),
    eventCode,
  });
}

export async function previewEvaluationFinalizationTemplates(
  instanceIdentifier: unknown,
  evaluationContentOverrides: JsonRecord = {},
) {
  const context = await activeEvaluationMailContext(instanceIdentifier);
  if (!context.instance) {
    return { reason: context.reason, templates: [] };
  }
  const selection = await activeTemplate(
    "cnb_result_finalized",
    context.instance,
    context.cycle,
  );
  if (!selection.template) {
    return { reason: selection.reason, templates: [] };
  }
  const instanceContent = {
    ...asRecord(context.instance.content),
    ...evaluationContentOverrides,
  };
  const templateContent = asRecord(selection.template.content);
  const configuredRoles = evaluationMailTemplateRecipientRoles(templateContent);
  const recipients = evaluationRecipientRoleCodes(
    instanceContent,
    evaluationMailRecipientRoles(
      "cnb_result_finalized",
      configuredRoles,
    ),
  );
  const candidates = recipients.flatMap((recipient) => {
    const roleTemplate = evaluationMailTemplateForRole(
      templateContent,
      recipient.role,
    );
    return roleTemplate
      ? evaluationMailFormTemplateReferences(
          roleTemplate,
          instanceContent,
        ).map((formTemplate) => ({ formTemplate, recipient }))
      : [];
  });
  const seen = new Set<string>();
  const uniqueCandidates = candidates.filter(({ formTemplate }) => {
    const key = formTemplate.id || formTemplate.code;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return {
    reason: "",
    templates: await Promise.all(
      uniqueCandidates.map(({ formTemplate, recipient }) =>
        previewEvaluationTemplatePdfMerge({
          evaluationContentOverrides,
          evaluationInstanceId: evaluationRecordLegacyId(context.instance),
          numberingMode: "preview",
          recipientEmployeeCode: recipient.code,
          reviewerRole: recipient.role,
          templateId: formTemplate.id,
        }),
      ),
    ),
  };
}

export function buildEvaluationMailVariables(
  instance: EvaluationMailRecord,
  role: string,
  recipientName = "",
  cycle?: EvaluationMailRecord | null,
  assignmentId = "",
) {
  const content = asRecord(instance.content);
  const legacyId = instanceLegacyId(instance);
  const appUrl = text(process.env.APP_URL).replace(/\/$/, "");
  const normalizedRole = normalizeEvaluationMailRecipientRole(role);
  const rolePrefix =
    normalizedRole === "self"
      ? "employee"
      : normalizedRole === "indirect_manager"
        ? "indirectManager"
        : normalizedRole;
  return {
    diem_tong: text(content.finalScore),
    ghi_chu_tra_lai: text(content[`${rolePrefix}ReturnNote`]),
    han_danh_gia: formatEvaluationMailDate(
      evaluationDeadlineValue(instance, cycle),
    ),
    ket_qua: text(content.decisionOptionLabel || content.finalScore),
    ket_luan: text(content.decisionOptionLabel),
    link_danh_gia: `${
      appUrl ? `${appUrl}/danh-gia` : "/danh-gia"
    }?instanceId=${encodeURIComponent(legacyId)}${
      assignmentId
        ? `&assignmentId=${encodeURIComponent(assignmentId)}`
        : ""
    }`,
    loai_danh_gia: text(content.cycleTypeName || content.evaluationTypeName),
    ma_nhan_su: text(content.employeeCode),
    nhan_su: text(content.employeeName || instance.name),
    nguoi_nhan: text(recipientName),
    nguoi_quan_ly: text(content.managerName),
    nguoi_quan_ly_gian_tiep: text(content.indirectManagerName),
    nguoi_duyet_bod: text(content.bodReviewedBy || content.bodName),
    nhan_xet_cnb: text(content.hrComment),
    phan_hoi_bod: text(content.bodFeedback),
    phan_hoi_quan_ly_gian_tiep: text(content.indirectManagerFeedback),
    quyet_dinh_quan_ly_gian_tiep: evaluationBodDecisionLabel(
      content.indirectManagerDecision,
    ),
    quyet_dinh_bod:
      text(content.bodDecision).toLowerCase() === "adjustment"
        ? "Điều chỉnh"
        : text(content.bodDecision).toLowerCase() === "rejected"
          ? "Từ chối"
          : text(content.bodDecision),
    ten_ky: text(content.cycleName),
    vai_tro: ROLE_LABELS[role] || role,
  };
}

function evaluationRecordValue(source: JsonRecord, key: string) {
  const normalizedKey = key.toLowerCase();
  const entry = Object.entries(source).find(
    ([candidate]) => candidate.toLowerCase() === normalizedKey,
  );
  return entry?.[1];
}

function evaluationBodDecisionLabel(value: unknown) {
  const decision = text(value).toLowerCase();
  if (decision === "accepted") return "Đồng ý";
  if (decision === "adjustment") return "Điều chỉnh";
  if (decision === "rejected") return "Từ chối";
  return text(value);
}

export function buildEvaluationCustomMailVariables(
  instance: EvaluationMailRecord,
  definitions: unknown,
) {
  const content = asRecord(instance.content);
  const decisionAnswers = asRecord(content.decisionAnswers);
  const cnbAnswers = asRecord(content.cnbConclusionAnswers);
  const ceoAnswers = asRecord(
    evaluationRecordValue(decisionAnswers, "bod") ||
      evaluationRecordValue(decisionAnswers, "ceo"),
  );
  const variables: Record<string, string> = {};
  const items = Array.isArray(definitions) ? definitions : [];
  for (const rawDefinition of items) {
    const definition = normalizeEvaluationMailCustomVariable(rawDefinition);
    if (!definition) continue;
    const [owner, kind, ...sourceKeyParts] = definition.sourcePath.split(".");
    const sourceKey = sourceKeyParts.join(".");
    let rawValue: unknown = "";
    if (owner === "cnb" && kind === "answer") {
      rawValue = evaluationRecordValue(cnbAnswers, sourceKey);
    } else if (owner === "ceo" && kind === "answer") {
      rawValue = evaluationRecordValue(ceoAnswers, sourceKey);
    } else if (kind === "action") {
      rawValue = evaluationRecordValue(content, sourceKey);
    }
    variables[definition.key] =
      definition.sourcePath === "ceo.action.boddecision"
        ? evaluationBodDecisionLabel(rawValue)
        : formatEvaluationTemplateAnswer(rawValue, definition.fieldType);
  }
  return variables;
}

export async function queueEvaluationMailForInstance(
  eventCode: EvaluationMailEventCode,
  instanceIdentifier: unknown,
  options: QueueOptions = {},
) {
  const db = getDb();
  const context = await activeEvaluationMailContext(instanceIdentifier);
  if (!context.instance) {
    return { queued: 0, sent: 0, skipped: 1, reason: context.reason };
  }
  const instance = context.instance;
  const templateSelection = await activeTemplate(
    eventCode,
    instance,
    context.cycle,
  );
  const template = templateSelection.template;
  if (!template) {
    return {
      queued: 0,
      sent: 0,
      skipped: 1,
      reason: templateSelection.reason,
    };
  }
  const instanceContent = asRecord(instance.content);
  const templateContent = asRecord(template.content);
  const configuredRoles = evaluationMailTemplateRecipientRoles(templateContent);
  const requestedRole = text(options.role);
  const roleCodes = evaluationRecipientRoleCodes(
    instanceContent,
    evaluationMailRecipientRoles(
      eventCode,
      configuredRoles,
      requestedRole,
      options.roles || [],
    ),
    options.assignmentIds || [],
  );
  const employees = roleCodes.length
    ? await db.employee.findMany({
        select: { email: true, employeeCode: true, fullName: true },
        where: {
          archivedAt: null,
          employeeCode: { in: roleCodes.map((item) => item.code) },
          status: "ACTIVE",
        },
      })
    : [];
  const employeeByCode = new Map(
    employees.map((employee) => [employee.employeeCode, employee]),
  );
  const token =
    text(options.eventToken) ||
    text(instanceContent.updatedAt) ||
    instance.updatedAt.toISOString();
  const queuedIds: string[] = [];
  let skipped = 0;
  for (const recipient of roleCodes) {
    const roleTemplateContent = evaluationMailTemplateForRole(
      templateContent,
      recipient.role,
    );
    if (!roleTemplateContent) {
      skipped += 1;
      continue;
    }
    const employee = employeeByCode.get(recipient.code);
    const recipientEmail = text(employee?.email).toLowerCase();
    if (!recipientEmail) {
      skipped += 1;
      continue;
    }
    const eventKey = [
      eventCode,
      instance.id,
      recipient.role,
      recipientEmail,
      recipient.assignmentId || "",
      token,
    ].join("|");
    const code = `MAILDEL_${hash(eventKey)}`;
    const existing = await db.evaluationRecord.findFirst({
      select: { id: true, status: true },
      where: { code, recordType: "evaluation-mail-delivery" },
    });
    if (existing) {
      if (
        options.sendNow &&
        ["failed", "queued"].includes(text(existing.status).toLowerCase())
      ) {
        queuedIds.push(existing.id);
      }
      skipped += 1;
      continue;
    }
    const variables = {
      ...buildEvaluationMailVariables(
        instance,
        recipient.role,
        employee?.fullName || "",
        context.cycle,
        recipient.assignmentId || "",
      ),
      ...buildEvaluationCustomMailVariables(
        instance,
        roleTemplateContent.customVariables,
      ),
    };
    const senderModuleKey =
      text(roleTemplateContent.senderModuleKey) || "evaluation-config";
    const senderName = await configuredEvaluationSenderName(senderModuleKey);
    const formTemplates = evaluationMailFormTemplateReferences(
      roleTemplateContent,
      asRecord(instance.content),
    );
    const primaryFormTemplate = formTemplates[0];
    const formTemplateId = primaryFormTemplate?.id || "";
    const formTemplateCode = primaryFormTemplate?.code || "";
    const formTemplateName = primaryFormTemplate?.name || "";
    const subject = `${text(options.subjectPrefix)}${renderEvaluationMailTemplate(
      roleTemplateContent.subjectTemplate,
      variables,
    )}`;
    const renderedHtmlBody = renderEvaluationMailTemplate(
      roleTemplateContent.bodyHtmlTemplate,
      variables,
      true,
    );
    const renderedTextBody = renderEvaluationMailTemplate(
      roleTemplateContent.bodyTemplate,
      variables,
    );
    const { htmlBody, textBody } = appendEvaluationFormAttachmentNotice({
      formTemplates,
      htmlBody: renderedHtmlBody,
      includeResultPdf: evaluationMailRequiresResultPdf(eventCode),
      textBody: renderedTextBody,
    });
    const delivery = await db.evaluationRecord.create({
      data: {
        code,
        content: {
          actorName: text(options.actorName),
          attempts: 0,
          eventCode,
          eventKey,
          htmlBody,
          instanceId: instanceLegacyId(instance),
          cycleTypeKeys: evaluationMailCycleTypeKeys(instance, context.cycle),
          formTemplateCode,
          formTemplateId,
          formTemplateName,
          formTemplateCodes: formTemplates.map((template) => template.code),
          formTemplateIds: formTemplates.map((template) => template.id),
          formTemplateNames: formTemplates.map((template) => template.name),
          formTemplates,
          templateMergeOverrides: instanceContent.templateMergeOverrides || {},
          queuedAt: new Date().toISOString(),
          recipientCode: recipient.code,
          reviewAssignmentId: recipient.assignmentId || "",
          recipientEmail,
          recipientName: employee?.fullName || "",
          recipientRole: recipient.role,
          roleTemplateKey: text(
            roleTemplateContent.code ||
              roleTemplateContent.id ||
              roleTemplateContent.role ||
              recipient.role,
          ),
          senderModuleKey,
          senderName,
          status: "queued",
          subject,
          templateId: template.id,
          templateScope: templateSelection.usedLegacyFallback
            ? "legacy_fallback"
            : "evaluation_type",
          textBody,
        } as Prisma.InputJsonValue,
        createdByName: text(options.actorName) || "Hệ thống CnB",
        name: `${eventCode} - ${employee?.fullName || recipient.code}`,
        parentId: instance.id,
        recordType: "evaluation-mail-delivery",
        status: "queued",
        updatedByName: text(options.actorName) || "Hệ thống CnB",
      },
    });
    queuedIds.push(delivery.id);
  }
  const processed =
    options.sendNow && queuedIds.length
      ? await processEvaluationMailOutbox({ ids: queuedIds })
      : { failed: 0, sent: 0 };
  return {
    queued: queuedIds.length,
    sent: processed.sent,
    failed: processed.failed,
    skipped,
  };
}

export async function processEvaluationMailOutbox(
  options: {
    ids?: string[];
    limit?: number;
  } = {},
) {
  if (options.ids && !options.ids.length)
    return { cancelled: 0, failed: 0, processed: 0, sent: 0 };
  const db = getDb();
  const deliveries = await db.evaluationRecord.findMany({
    orderBy: { createdAt: "asc" },
    take: Math.min(Math.max(options.limit || 50, 1), 200),
    where: {
      ...(options.ids?.length ? { id: { in: options.ids } } : {}),
      recordType: "evaluation-mail-delivery",
      status: { in: ["queued", "failed"] },
    },
  });
  let failed = 0;
  let sent = 0;
  let cancelled = 0;
  const pdfAttachmentCache = new Map<
    string,
    ReturnType<typeof generateEvaluationTemplatePdfAttachment>
  >();
  const resultPdfCache = new Map<string, Promise<ModuleMailAttachment>>();
  for (const delivery of deliveries) {
    const content = asRecord(delivery.content);
    const context = await activeEvaluationMailContext(
      delivery.parentId || content.instanceId,
    );
    if (!context.instance) {
      await db.evaluationRecord.update({
        data: {
          content: {
            ...content,
            cancelledAt: new Date().toISOString(),
            cancellationReason: context.reason,
            status: "cancelled",
          } as Prisma.InputJsonValue,
          status: "cancelled",
          updatedByName: "Mail Router CnB",
        },
        where: { id: delivery.id },
      });
      cancelled += 1;
      continue;
    }
    const activeContent = asRecord(context.instance.content);
    const deliveryEventCode = text(
      content.eventCode || content.event,
    ).toLowerCase();
    const deliveryRole = text(content.recipientRole).toLowerCase();
    const deliveryAssignmentId = text(content.reviewAssignmentId);
    if (
      ["review_assigned", "review_reminder", "review_overdue"].includes(
        deliveryEventCode,
      ) &&
      deliveryRole &&
      (deliveryAssignmentId
        ? !stringList(activeContent.activeReviewAssignmentIds).includes(
            deliveryAssignmentId,
          )
        : !currentReviewerRoles(activeContent).includes(deliveryRole))
    ) {
      await db.evaluationRecord.update({
        data: {
          content: {
            ...content,
            cancelledAt: new Date().toISOString(),
            cancellationReason: "review_role_no_longer_active",
            status: "cancelled",
          } as Prisma.InputJsonValue,
          status: "cancelled",
          updatedByName: "Mail Router CnB",
        },
        where: { id: delivery.id },
      });
      cancelled += 1;
      continue;
    }
    const attempts = numberValue(content.attempts) + 1;
    if (attempts > 3) continue;
    try {
      const senderModuleKey =
        text(content.senderModuleKey) || "evaluation-config";
      const senderName =
        text(content.senderName) ||
        (await configuredEvaluationSenderName(senderModuleKey));
      const formTemplates = evaluationMailFormTemplateReferences(content);
      const templateMergeOverrides = asRecord(content.templateMergeOverrides);
      const formAttachments = await Promise.all(
        formTemplates.map(async (formTemplate) => {
          const attachmentKey = evaluationPdfAttachmentCacheKey({
            evaluationInstanceId: evaluationRecordLegacyId(context.instance),
            recipientEmployeeCode: content.recipientCode,
            reviewerRole: deliveryRole,
            templateId: formTemplate.id,
          });
          let attachmentPromise = pdfAttachmentCache.get(attachmentKey);
          if (!attachmentPromise) {
            attachmentPromise = generateEvaluationTemplatePdfAttachment({
              evaluationInstanceId: evaluationRecordLegacyId(context.instance),
              recipientEmployeeCode: text(content.recipientCode),
              reviewerRole: deliveryRole,
              mergeOverrides: asRecord(
                templateMergeOverrides[formTemplate.id] ||
                  templateMergeOverrides[formTemplate.code],
              ),
              templateId: formTemplate.id,
            });
            pdfAttachmentCache.set(attachmentKey, attachmentPromise);
          }
          return attachmentPromise;
        }),
      );
      const pdfAttachments = await appendEvaluationResultPdf(
        deliveryEventCode,
        formAttachments,
        () => {
          const key = context.instance!.id;
          let pending = resultPdfCache.get(key);
          if (!pending) {
            pending = import("@/lib/evaluation/result-pdf").then(
              async ({ buildEvaluationResultPdf }) => {
                const { buffer, fileName } =
                  await buildEvaluationResultPdf(key);
                return {
                  content: buffer,
                  contentType: "application/pdf",
                  fileName,
                };
              },
            );
            resultPdfCache.set(key, pending);
          }
          return pending;
        },
      );
      const primaryAttachment = pdfAttachments[0];
      const result = await sendModuleEmail(senderModuleKey, {
        attachments: pdfAttachments.length ? pdfAttachments : undefined,
        htmlBody: text(content.htmlBody),
        senderName,
        subject: text(content.subject),
        textBody: text(content.textBody),
        to: text(content.recipientEmail),
      });
      await db.evaluationRecord.update({
        data: {
          content: {
            ...content,
            attempts,
            attachmentBytes: pdfAttachments.reduce(
              (total, attachment) => total + attachment.content.length,
              0,
            ),
            attachmentContentType: primaryAttachment?.contentType || "",
            attachmentContentTypes: pdfAttachments.map(
              (attachment) => attachment.contentType,
            ),
            attachmentCount: pdfAttachments.length,
            resultPdfAttached:
              evaluationMailRequiresResultPdf(deliveryEventCode),
            attachmentFileName: primaryAttachment?.fileName || "",
            attachmentFileNames: pdfAttachments.map(
              (attachment) => attachment.fileName,
            ),
            attachmentSha256: primaryAttachment
              ? createHash("sha256")
                  .update(primaryAttachment.content)
                  .digest("hex")
              : "",
            attachmentSha256s: pdfAttachments.map((attachment) =>
              createHash("sha256").update(attachment.content).digest("hex"),
            ),
            deliveryState: "provider_accepted",
            error: "",
            failedAt: "",
            messageId: result.messageId,
            providerAcceptedAt: new Date().toISOString(),
            sentAt: new Date().toISOString(),
            status: "sent",
            threadId: result.threadId,
          } as Prisma.InputJsonValue,
          status: "sent",
          updatedByName: "Mail Router CnB",
        },
        where: { id: delivery.id },
      });
      sent += 1;
    } catch (error) {
      await db.evaluationRecord.update({
        data: {
          content: {
            ...content,
            attempts,
            error: error instanceof Error ? error.message : String(error),
            failedAt: new Date().toISOString(),
            status: "failed",
          } as Prisma.InputJsonValue,
          status: "failed",
          updatedByName: "Mail Router CnB",
        },
        where: { id: delivery.id },
      });
      failed += 1;
    }
  }
  return { cancelled, failed, processed: deliveries.length, sent };
}

function addDays(isoDate: string, days: number) {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime())) return "";
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function evaluationDateOnly(value: unknown) {
  const raw = text(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      day: "2-digit",
      month: "2-digit",
      timeZone: "Asia/Ho_Chi_Minh",
      year: "numeric",
    })
      .formatToParts(date)
      .filter((part) => ["day", "month", "year"].includes(part.type))
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export async function queueScheduledEvaluationMail(
  today = new Date().toISOString().slice(0, 10),
) {
  const db = getDb();
  const templates = await db.evaluationRecord.findMany({
    where: {
      recordType: "evaluation-mail-template",
      status: { notIn: ["inactive", "archived", "draft"] },
    },
  });
  const scheduledTemplates = templates.filter((template) => {
    const content = asRecord(template.content);
    return ["before_deadline", "after_deadline"].includes(text(content.timing));
  });
  const scheduledEventCodes = Array.from(
    new Set(
      scheduledTemplates
        .map((template) => text(asRecord(template.content).eventCode))
        .filter((eventCode): eventCode is EvaluationMailEventCode =>
          EVALUATION_MAIL_EVENT_CODES.includes(
            eventCode as EvaluationMailEventCode,
          ),
        ),
    ),
  );
  const [instances, cycles] = scheduledTemplates.length
    ? await Promise.all([
        db.evaluationRecord.findMany({
          where: {
            recordType: "evaluation-instance",
            status: { in: ["draft", "in_progress", "awaiting_finalization"] },
          },
        }),
        db.evaluationRecord.findMany({
          where: { recordType: "evaluation-cycle" },
        }),
      ])
    : [[], []];
  let queued = 0;
  let skipped = 0;
  for (const instance of orderEvaluationMailInstances(instances)) {
    const instanceContent = asRecord(instance.content);
    const cycle = cycles.find((candidate) => {
      const identifiers = new Set(
        evaluationRecordIdentifiersForMail(candidate),
      );
      return [
        instance.parentId,
        instanceContent.cycleId,
        instanceContent.evaluationCycleId,
      ]
        .map(text)
        .some((identifier) => identifiers.has(identifier));
    });
    for (const eventCode of scheduledEventCodes) {
      const templateSelection = await activeTemplate(
        eventCode,
        instance,
        cycle,
        templates,
      );
      const templateContent = asRecord(templateSelection.template?.content);
      if (!templateSelection.template) {
        skipped += 1;
        continue;
      }
      const timing = text(templateContent.timing);
      if (!["before_deadline", "after_deadline"].includes(timing)) continue;
      const direction = timing === "before_deadline" ? -1 : 1;
      const offset = Math.max(0, numberValue(templateContent.offsetDays));
      const deadline = evaluationDeadlineValue(instance, cycle).slice(0, 10);
      if (!deadline || addDays(deadline, direction * offset) !== today)
        continue;
      const result = await queueEvaluationMailForInstance(
        eventCode,
        instance.id,
        {
          actorName: "Tự động CnB",
          eventToken: today,
        },
      );
      queued += result.queued;
      skipped += result.skipped;
    }
  }
  const delivery = await processEvaluationMailOutbox();
  return { ...delivery, queued, skipped, today };
}

export async function queueEvaluationMailForCycle(
  cycleIdentifier: unknown,
  options: QueueOptions = {},
) {
  const db = getDb();
  const requestedCycle = text(cycleIdentifier);
  const sendAll = requestedCycle === "all";
  if (!requestedCycle) {
    return {
      failed: 0,
      instanceCount: 0,
      queued: 0,
      reason: "cycle_required",
      sent: 0,
      skipped: 0,
    };
  }
  const cycle = sendAll
    ? null
    : await findEvaluationRecordByIdentifier(
        "evaluation-cycle",
        requestedCycle,
      );
  if (!sendAll && (!cycle || !isEvaluationMailRecordActive(cycle))) {
    return {
      failed: 0,
      instanceCount: 0,
      queued: 0,
      reason: "cycle_not_active",
      sent: 0,
      skipped: 0,
    };
  }
  const cycleIdentifiers = cycle
    ? new Set([cycle.id, ...evaluationRecordIdentifiersForMail(cycle)])
    : null;
  const instances = await db.evaluationRecord.findMany({
    where: {
      recordType: "evaluation-instance",
      status: { in: ["draft", "in_progress", "awaiting_finalization"] },
    },
  });
  const matchingInstances = instances.filter((instance) => {
    if (!cycleIdentifiers) return true;
    const content = asRecord(instance.content);
    return [instance.parentId, content.cycleId, content.evaluationCycleId]
      .map(text)
      .some((identifier) => cycleIdentifiers.has(identifier));
  });
  let queued = 0;
  let sent = 0;
  let skipped = 0;
  let failed = 0;
  for (const instance of orderEvaluationMailInstances(matchingInstances)) {
    const result = await queueEvaluationMailForInstance(
      "review_reminder",
      instance.id,
      options,
    );
    queued += result.queued;
    sent += result.sent;
    skipped += result.skipped;
    failed += result.failed || 0;
  }
  return {
    failed,
    instanceCount: matchingInstances.length,
    queued,
    sent,
    skipped,
  };
}

function orderEvaluationMailInstances<
  T extends { content: unknown; id: string },
>(instances: T[]) {
  return instances.slice().sort((left, right) => {
    const leftContent = asRecord(left.content);
    const rightContent = asRecord(right.content);
    const leftSequence = numberValue(
      leftContent.generationSequence || leftContent.mailGenerationSequence,
    );
    const rightSequence = numberValue(
      rightContent.generationSequence || rightContent.mailGenerationSequence,
    );
    return (
      (leftSequence || Number.MAX_SAFE_INTEGER) -
        (rightSequence || Number.MAX_SAFE_INTEGER) ||
      text(leftContent.positionLevelCode).localeCompare(
        text(rightContent.positionLevelCode),
      ) ||
      text(leftContent.employeeCode).localeCompare(
        text(rightContent.employeeCode),
        "vi",
      ) ||
      left.id.localeCompare(right.id)
    );
  });
}

function evaluationRecordIdentifiersForMail(record: {
  code: string | null;
  content: unknown;
  id: string;
  parentId: string | null;
  recordType: string;
}) {
  const content = asRecord(record.content);
  return [
    record.code,
    evaluationRecordLegacyId(record),
    content.id,
    content.cycleId,
    content.evaluationCycleId,
  ]
    .map(text)
    .filter(Boolean);
}
