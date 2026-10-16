import {
  asRecord,
  booleanValue,
  stringList,
  text,
  type JsonRecord,
} from "@/lib/operations/json";

export type EvaluationMailFlowRecord = {
  code?: string | null;
  content: unknown;
  id?: string;
  status?: string | null;
  updatedAt?: Date | string;
};

export type EvaluationMailTemplateContext = {
  cycleTypeKeys: string[];
  eventCode: string;
};

const INACTIVE_TEMPLATE_STATUSES = new Set([
  "archived",
  "deleted",
  "draft",
  "inactive",
]);

function normalized(value: unknown) {
  return text(value).toLowerCase();
}

export function normalizeEvaluationMailRecipientRole(value: unknown) {
  const role = normalized(value).replace(/[\s-]+/g, "_");
  if (["employee", "nhan_vien", "staff"].includes(role)) return "self";
  if (["leader", "m1", "manager_1", "quan_ly_truc_tiep"].includes(role)) {
    return "manager";
  }
  if (["m2", "manager_2", "quan_ly_gian_tiep"].includes(role)) {
    return "indirect_manager";
  }
  if (["colleague", "coworker", "dong_nghiep"].includes(role)) return "peer";
  if (["board", "ceo", "m3", "manager_3", "ban_giam_doc"].includes(role)) return "bod";
  if (["cnb", "human_resources"].includes(role)) return "hr";
  return role;
}

function templateUpdatedAt(record: EvaluationMailFlowRecord) {
  const value = record.updatedAt;
  const parsed = value instanceof Date ? value.getTime() : Date.parse(text(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function evaluationMailTemplateCycleTypeKeys(content: unknown) {
  const source = asRecord(content);
  return Array.from(
    new Set(
      [
        source.cycleTypeTemplateId,
        source.cycleTypeId,
        source.cycleTypeCode,
        source.evaluationTypeId,
        source.evaluationTypeCode,
      ]
        .map(normalized)
        .filter(Boolean),
    ),
  );
}

export function isActiveEvaluationMailTemplate(
  record: EvaluationMailFlowRecord,
) {
  const content = asRecord(record.content);
  return (
    !INACTIVE_TEMPLATE_STATUSES.has(
      normalized(record.status || content.status),
    ) && booleanValue(content.isActive, true)
  );
}

function rawRoleTemplates(content: unknown): JsonRecord[] {
  const source = asRecord(content);
  const raw =
    source.roleTemplates ||
    source.templatesByRole ||
    source.recipientTemplates;
  if (Array.isArray(raw)) return raw.map(asRecord);
  const keyed = asRecord(raw);
  return Object.entries(keyed).map(([role, value]): JsonRecord => ({
    ...asRecord(value),
    role,
  }));
}

export function hasEvaluationMailRoleTemplates(content: unknown) {
  const source = asRecord(content);
  return (
    Object.prototype.hasOwnProperty.call(source, "roleTemplates") ||
    Object.prototype.hasOwnProperty.call(source, "templatesByRole") ||
    Object.prototype.hasOwnProperty.call(source, "recipientTemplates")
  );
}

export function evaluationMailRoleTemplates(
  content: unknown,
  options: { activeOnly?: boolean } = {},
) {
  const activeOnly = options.activeOnly !== false;
  return rawRoleTemplates(content)
    .map((template): JsonRecord => ({
      ...template,
      role: normalizeEvaluationMailRecipientRole(
        template.role || template.recipientRole,
      ),
    }))
    .filter((template) => {
      if (!text(template.role)) return false;
      if (!activeOnly) return true;
      return (
        !INACTIVE_TEMPLATE_STATUSES.has(normalized(template.status)) &&
        booleanValue(template.enabled ?? template.isActive, true)
      );
    });
}

export function evaluationMailTemplateRecipientRoles(content: unknown) {
  if (hasEvaluationMailRoleTemplates(content)) {
    return Array.from(
      new Set(
        evaluationMailRoleTemplates(content).map((template) =>
          text(template.role),
        ),
      ),
    );
  }
  const source = asRecord(content);
  return Array.from(
    new Set(
      stringList(source.recipientRoles)
        .map(normalizeEvaluationMailRecipientRole)
        .filter(Boolean),
    ),
  );
}

export function evaluationMailTemplateForRole(
  content: unknown,
  recipientRole: unknown,
): JsonRecord | null {
  const source = asRecord(content);
  const role = normalizeEvaluationMailRecipientRole(recipientRole);
  if (!role) return null;

  if (hasEvaluationMailRoleTemplates(source)) {
    const roleTemplates = evaluationMailRoleTemplates(source);
    const roleTemplate = roleTemplates.find(
      (template) => text(template.role) === role,
    );
    const fallbackTemplate =
      role === "indirect_manager"
        ? roleTemplates.find((template) => text(template.role) === "manager")
        : null;
    const selectedTemplate = roleTemplate || fallbackTemplate;
    return selectedTemplate
      ? { ...source, ...selectedTemplate, recipientRole: role, role }
      : null;
  }

  const topLevelRole = normalizeEvaluationMailRecipientRole(
    source.recipientRole || source.role,
  );
  if (topLevelRole && topLevelRole !== role) return null;
  const configuredRoles = stringList(source.recipientRoles).map(
    normalizeEvaluationMailRecipientRole,
  );
  const acceptsCurrentReviewer = configuredRoles.includes("current_reviewer");
  if (
    configuredRoles.length &&
    !acceptsCurrentReviewer &&
    !configuredRoles.includes(role)
  ) {
    return null;
  }
  return { ...source, recipientRole: role };
}

function activeEventTemplates(
  templates: EvaluationMailFlowRecord[],
  eventCode: string,
) {
  const event = normalized(eventCode);
  return templates
    .filter((template) => {
      const content = asRecord(template.content);
      return (
        isActiveEvaluationMailTemplate(template) &&
        normalized(content.eventCode || template.code) === event
      );
    })
    .sort(
      (left, right) =>
        templateUpdatedAt(right) - templateUpdatedAt(left) ||
        text(left.id).localeCompare(text(right.id)),
    );
}

export function selectEvaluationMailTemplateForContext(
  templates: EvaluationMailFlowRecord[],
  context: EvaluationMailTemplateContext,
) {
  const active = activeEventTemplates(templates, context.eventCode);
  const cycleTypeKeys = new Set(
    context.cycleTypeKeys.map(normalized).filter(Boolean),
  );
  const scoped = active.find((template) => {
    const templateKeys = evaluationMailTemplateCycleTypeKeys(template.content);
    return (
      templateKeys.length > 0 &&
      templateKeys.some((key) => cycleTypeKeys.has(key))
    );
  });
  if (scoped) {
    return { reason: "", template: scoped, usedLegacyFallback: false };
  }

  const legacyFallback = active.find(
    (template) =>
      evaluationMailTemplateCycleTypeKeys(template.content).length === 0,
  );
  if (legacyFallback) {
    return {
      reason: "",
      template: legacyFallback,
      usedLegacyFallback: true,
    };
  }
  return {
    reason: active.length ? "template_scope_not_configured" : "template_not_active",
    template: null,
    usedLegacyFallback: false,
  };
}

export function evaluationNewlyActivatedRoles(
  previousRoles: unknown[],
  nextRoles: unknown[],
) {
  const previous = new Set(
    previousRoles.map(normalizeEvaluationMailRecipientRole).filter(Boolean),
  );
  return Array.from(
    new Set(
      nextRoles
        .map(normalizeEvaluationMailRecipientRole)
        .filter((role) => role && !previous.has(role)),
    ),
  );
}
