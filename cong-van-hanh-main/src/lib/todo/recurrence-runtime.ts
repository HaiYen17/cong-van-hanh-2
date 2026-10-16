import { randomUUID } from "node:crypto";

import { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { todoAssigneeUserIds } from "@/lib/todo/output";

import {
  addTodoDays,
  bangkokDateKey,
  isTodoRepeatDueOnDate,
  normalizeTodoRepeatSchedule,
  todoDaysBetween,
  todoRecurringOccurrenceTitle,
} from "./recurrence";

type TodoOutputRecord = {
  assignee?: string;
  assigneeEmployeeId?: string;
  assigneeEmployeeIds?: string[];
  assigneeUserId?: string;
  assigneeUserIds?: string[];
  assignees?: string[];
  description?: string;
  dueAt?: string;
  feedbacks?: unknown[];
  id?: string;
  status?: string;
  [key: string]: unknown;
};

function recordOf(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function requestCode() {
  const stamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).slice(2, 5).toUpperCase();
  return `GV-${stamp}-${random}`;
}

function bangkokTimeKey(value: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    timeZone: "Asia/Bangkok",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value || "00";
  return `${part("hour")}:${part("minute")}`;
}

function outputRecords(value: unknown): TodoOutputRecord[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is TodoOutputRecord =>
      Boolean(item && typeof item === "object" && !Array.isArray(item)),
  );
}

export type TodoRecurrenceMaterializeResult = {
  created: number;
  date: string;
  skippedBeforeTime: number;
};

/**
 * Sinh tối đa một Request mới cho mỗi mẫu lặp trong một ngày theo lịch Việt Nam.
 * Advisory lock và occurrenceKey giữ thao tác idempotent khi cron/page chạy đồng thời.
 */
export async function materializeTodoRecurrences(
  now = new Date(),
): Promise<TodoRecurrenceMaterializeResult> {
  const db = getDb();
  const occurrenceDate = bangkokDateKey(now);
  const currentTime = bangkokTimeKey(now);

  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('todo-recurrence-materializer'))`;

      const templates = await tx.request.findMany({
        orderBy: [{ createdAt: "asc" }],
        take: 1_000,
        where: {
          archivedAt: null,
          payload: { equals: "recurring", path: ["assignmentKind"] },
          serviceCode: "todo-assignment",
          status: { notIn: ["CANCELLED", "REJECTED"] },
        },
      });

      const existingKeys = new Set<string>();
      for (const row of templates) {
        const payload = recordOf(row.payload);
        const recurrence = recordOf(payload.recurrence);
        const occurrenceKey = text(recurrence.occurrenceKey);
        if (occurrenceKey) existingKeys.add(occurrenceKey);
      }

      let created = 0;
      let skippedBeforeTime = 0;
      for (const template of templates) {
        const payload = recordOf(template.payload);
        const recurrence = recordOf(payload.recurrence);
        const isLegacyRecurring =
          text(payload.assignmentKind) === "recurring" &&
          !Object.prototype.hasOwnProperty.call(recurrence, "isTemplate");
        const isTemplate = recurrence.isTemplate === true || isLegacyRecurring;
        if (!isTemplate) continue;

        const inferredAnchor =
          text(recurrence.anchorDate).slice(0, 10) ||
          text(recurrence.occurrenceDate).slice(0, 10) ||
          bangkokDateKey(template.createdAt);
        const schedule = normalizeTodoRepeatSchedule(payload.repeat, inferredAnchor);
        if (!schedule || !isTodoRepeatDueOnDate(schedule, occurrenceDate)) continue;
        if (currentTime < (schedule.times[0] || "00:00")) {
          skippedBeforeTime += 1;
          continue;
        }

        const templateId = text(recurrence.templateId) || template.id;
        const occurrenceKey = `${templateId}:${occurrenceDate}`;
        const initialOccurrenceDate =
          text(recurrence.occurrenceDate).slice(0, 10) ||
          (isLegacyRecurring ? bangkokDateKey(template.createdAt) : schedule.startDate);
        if (occurrenceDate === initialOccurrenceDate || existingKeys.has(occurrenceKey)) {
          existingKeys.add(occurrenceKey);
          continue;
        }

        const outputs = outputRecords(payload.outputs);
        if (!outputs.length) continue;
        const anchorDate = text(recurrence.anchorDate).slice(0, 10) || schedule.startDate;
        const nextOutputs = outputs.map((output) => {
          const originalDueDate = text(output.dueAt).slice(0, 10);
          const dueAt = originalDueDate
            ? addTodoDays(
                occurrenceDate,
                todoDaysBetween(anchorDate, originalDueDate),
              )
            : occurrenceDate;
          return {
            ...output,
            dueAt,
            feedbacks: [],
            id: randomUUID(),
            status: "OPEN",
          };
        });
        const assignedUserIds = [
          ...new Set(
            nextOutputs.flatMap((output) => todoAssigneeUserIds(output)),
          ),
        ];
        const nextPayload = {
          ...payload,
          outputs: nextOutputs,
          recurrence: {
            anchorDate,
            isTemplate: false,
            occurrenceDate,
            occurrenceKey,
            sourceRequestId: template.id,
            templateId,
          },
          repeat: schedule,
        };
        const occurrence = await tx.request.create({
          data: {
            assignedToId:
              assignedUserIds.length === 1 ? assignedUserIds[0] : undefined,
            code: requestCode(),
            companyId: template.companyId || undefined,
            createdById: template.createdById,
            note: template.note || undefined,
            payload: nextPayload as Prisma.InputJsonValue,
            priority: template.priority || undefined,
            serviceCode: "todo-assignment",
            status: "SUBMITTED",
            title: todoRecurringOccurrenceTitle(
              template.title,
              schedule,
              occurrenceDate,
            ),
          },
        });
        await tx.requestEvent.create({
          data: {
            actorId: template.createdById,
            note: `Tự động tạo kỳ lặp ngày ${occurrenceDate}.`,
            requestId: occurrence.id,
            toStatus: "SUBMITTED",
            type: "SUBMITTED",
          },
        });
        await tx.auditLog.create({
          data: {
            action: "CREATE",
            actorId: template.createdById,
            metadata: {
              occurrenceDate,
              occurrenceKey,
              serviceCode: "todo-assignment",
              templateId,
            },
            summary: `Materialized recurring todo ${occurrence.code}.`,
            targetId: occurrence.id,
            targetType: "Request",
          },
        });
        existingKeys.add(occurrenceKey);
        created += 1;
      }

      return { created, date: occurrenceDate, skippedBeforeTime };
    },
    { timeout: 30_000 },
  );
}
