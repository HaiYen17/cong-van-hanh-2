import "server-only";

import { getDb } from "@/lib/db";
import { asRecord, text } from "@/lib/operations/json";

export const EVALUATION_CONTEXT_MODULE_KEY = "evaluation";
export const EVALUATION_CONTEXT_PERMISSION = "context.evaluation.assigned";

type SessionAccess = {
  fullAccess: boolean;
  moduleGroups: string[];
  modules: string[];
  permissions: string[];
  roleKeys: string[];
};

export function grantEvaluationContext(
  access: SessionAccess,
): SessionAccess {
  return {
    ...access,
    modules: [
      ...new Set([...access.modules, EVALUATION_CONTEXT_MODULE_KEY]),
    ].sort(),
    permissions: [
      ...new Set([...access.permissions, EVALUATION_CONTEXT_PERMISSION]),
    ].sort(),
  };
}

export function evaluationContentAssignsEmployee(
  contentValue: unknown,
  employeeCode: string,
) {
  const normalizedCode = employeeCode.trim().toLowerCase();
  if (!normalizedCode) return false;
  const content = asRecord(contentValue);
  return [
    content.employeeCode,
    content.employeeId,
    content.managerEmployeeCode,
    content.indirectManagerEmployeeCode,
    content.peerEmployeeCode,
    content.hrEmployeeCode,
    content.bodEmployeeCode,
  ]
    .map((value) => text(value).toLowerCase())
    .includes(normalizedCode);
}

export async function hasEvaluationAssignment(
  employeeCode?: string | string[] | null,
) {
  const employeeCodes = [
    ...new Set(
      (Array.isArray(employeeCode) ? employeeCode : [employeeCode])
        .map((value) => value?.trim())
        .filter(Boolean),
    ),
  ] as string[];
  if (!employeeCodes.length) return false;
  const assignment = await getDb().evaluationRecord.findFirst({
    select: { id: true },
    where: {
      recordType: "evaluation-instance",
      status: { notIn: ["archived", "deleted", "inactive"] },
      OR: employeeCodes.flatMap((code) => [
        { content: { path: ["employeeCode"], equals: code } },
        { content: { path: ["employeeId"], equals: code } },
        { content: { path: ["managerEmployeeCode"], equals: code } },
        { content: { path: ["indirectManagerEmployeeCode"], equals: code } },
        { content: { path: ["peerEmployeeCode"], equals: code } },
        { content: { path: ["hrEmployeeCode"], equals: code } },
        { content: { path: ["bodEmployeeCode"], equals: code } },
      ]),
    },
  });
  return Boolean(assignment);
}
