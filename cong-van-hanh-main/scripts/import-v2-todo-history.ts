import "dotenv/config";

import { Prisma, type RequestStatus } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";

const SOURCE_KEY = "google-sheet-15-todo-history";
const DEFAULT_SPREADSHEET_ID =
  "1_aDstrpRuxLuaEKHTuuWuL3ybyBvCPVcyFMouQxVjyg";
const SHEET_NAME = "15_Nhac viec";

type SourceTask = {
  assigneeCodes: string[];
  collaboratorCodes: string[];
  companyName: string;
  completedAt: Date | null;
  content: string;
  createdAt: Date;
  creatorCode: string;
  creatorName: string;
  department: string;
  dueAt: Date | null;
  legacyNote: Record<string, unknown>;
  priority: string;
  repeat: Record<string, unknown>;
  rowNumber: number;
  statusLabel: string;
  taskId: string;
  title: string;
  updatedAt: Date;
};

type LegacyOutput = Record<string, unknown> & {
  feedback?: Record<string, unknown>;
  feedbacks?: Record<string, unknown>[];
};

function options() {
  return new Map(
    process.argv.slice(2).map((argument) => {
      const value = argument.replace(/^--/, "");
      const separator = value.indexOf("=");
      return separator < 0
        ? [value, "true"]
        : [value.slice(0, separator), value.slice(separator + 1)];
    }),
  );
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function normalize(value: unknown) {
  return text(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function integer(value: unknown, fallback = 0) {
  const parsed = Number.parseInt(text(value).replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function date(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(Date.UTC(1899, 11, 30) + value * 86_400_000);
  }
  const normalized = text(value);
  if (!normalized) return null;
  const dayFirst = normalized.match(
    /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/,
  );
  if (dayFirst) {
    const year = Number(dayFirst[3]) < 100 ? 2000 + Number(dayFirst[3]) : Number(dayFirst[3]);
    return new Date(
      year,
      Number(dayFirst[2]) - 1,
      Number(dayFirst[1]),
      Number(dayFirst[4] || 0),
      Number(dayFirst[5] || 0),
      Number(dayFirst[6] || 0),
    );
  }
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function json(value: unknown) {
  const normalized = text(value);
  if (!normalized) return {};
  try {
    const parsed = JSON.parse(normalized);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function list(value: unknown) {
  return text(value).split(/[,;\n]+/).map((item) => item.trim()).filter(Boolean);
}

function asJson(value: unknown) {
  return JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
}

function status(value: unknown): RequestStatus {
  const normalized = normalize(value);
  if (normalized.includes("xong") || normalized.includes("hoan thanh")) return "COMPLETED";
  if (normalized.includes("huy")) return "CANCELLED";
  if (normalized.includes("dang lam") || normalized.includes("dang xu ly")) return "IN_PROGRESS";
  return "SUBMITTED";
}

function headerIndex(headers: string[], name: string) {
  return headers.findIndex((header) => normalize(header) === normalize(name));
}

async function fetchSource(spreadsheetId: string) {
  const token = text(process.env.GOOGLE_ACCESS_TOKEN);
  if (!token) throw new Error("Thiếu GOOGLE_ACCESS_TOKEN chỉ đọc Google Sheets.");
  const range = encodeURIComponent(`'${SHEET_NAME}'!A:R`);
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${range}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!response.ok) throw new Error(`Không đọc được ${SHEET_NAME}: HTTP ${response.status}.`);
  const payload = await response.json() as { values?: unknown[][] };
  const values = Array.isArray(payload.values) ? payload.values : [];
  if (values.length < 2) return [];
  const headers = values[0].map(text);
  const index = (name: string) => headerIndex(headers, name);
  const columns = {
    assignees: index("MNV phụ trách"),
    collaborators: index("MNV phối hợp"),
    company: index("Công ty"),
    completedAt: index("Hoàn thành lúc"),
    content: index("Nội dung"),
    createdAt: index("Ngày tạo"),
    creatorCode: index("Người tạo MNV"),
    creatorName: index("Người tạo"),
    department: index("Phòng ban"),
    dueAt: index("Hạn xử lý"),
    note: index("Ghi chú"),
    priority: index("Mức độ"),
    repeat: index("Lặp lại"),
    status: index("Trạng thái"),
    taskId: index("Task ID"),
    title: index("Tiêu đề"),
    updatedAt: index("Cập nhật lúc"),
  };
  return values.slice(1).flatMap((row, offset) => {
    const at = (column: number) => column >= 0 ? row[column] : "";
    const taskId = text(at(columns.taskId));
    const title = text(at(columns.title));
    if (!taskId || !title) return [];
    const createdAt = date(at(columns.createdAt)) || new Date();
    return [{
      assigneeCodes: list(at(columns.assignees)),
      collaboratorCodes: list(at(columns.collaborators)),
      companyName: text(at(columns.company)),
      completedAt: date(at(columns.completedAt)),
      content: text(at(columns.content)),
      createdAt,
      creatorCode: text(at(columns.creatorCode)),
      creatorName: text(at(columns.creatorName)),
      department: text(at(columns.department)),
      dueAt: date(at(columns.dueAt)),
      legacyNote: json(at(columns.note)),
      priority: text(at(columns.priority)),
      repeat: json(at(columns.repeat)),
      rowNumber: offset + 2,
      statusLabel: text(at(columns.status)),
      taskId,
      title,
      updatedAt: date(at(columns.updatedAt)) || createdAt,
    } satisfies SourceTask];
  });
}

function driveId(value: unknown) {
  const raw = text(value);
  if (!raw) return "";
  const match = raw.match(/(?:\/d\/|[?&]id=)([-\w]{15,})/);
  return match?.[1] || (/^[-\w]{15,}$/.test(raw) ? raw : "");
}

function legacyOutputs(task: SourceTask) {
  return Array.isArray(task.legacyNote.outputs)
    ? task.legacyNote.outputs.filter((item): item is LegacyOutput => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

function legacyFeedbacks(output: LegacyOutput) {
  const values = Array.isArray(output.feedbacks) ? [...output.feedbacks] : [];
  if (output.feedback && typeof output.feedback === "object" && !Array.isArray(output.feedback)) {
    const id = text(output.feedback.responseId);
    if (!values.some((item) => text(item.responseId) === id)) values.push(output.feedback);
  }
  return values;
}

async function main() {
  const args = options();
  const mode = text(args.get("mode") || "preview").toLowerCase();
  if (!new Set(["preview", "apply"]).has(mode)) throw new Error("--mode chỉ nhận preview hoặc apply.");
  if (mode === "apply" && args.get("confirm-apply") !== "15_Nhac_viec") {
    throw new Error("Lệnh ghi cần --confirm-apply=15_Nhac_viec sau khi preview.");
  }
  const spreadsheetId = text(args.get("spreadsheet-id")) || DEFAULT_SPREADSHEET_ID;
  const tasks = await fetchSource(spreadsheetId);
  const db = getDb();
  try {
    const employees = await db.employee.findMany({ include: { company: true, user: true } });
    const employeeByCode = new Map(employees.map((employee) => [employee.employeeCode, employee]));
    const employeeTokens = employees.map((employee) => ({
      employee,
      tokens: [employee.employeeCode, employee.fullName, employee.email, employee.phone].map(normalize).filter(Boolean),
    }));
    const resolveEmployee = (value: unknown) => {
      const needle = normalize(value);
      if (!needle) return null;
      return employeeTokens.find(({ tokens }) => tokens.some((token) => needle.includes(token) || token.includes(needle)))?.employee || null;
    };
    const codes = tasks.map((task) => `TODO-V2-${task.taskId}`);
    const existing = await db.request.findMany({ select: { code: true }, where: { code: { in: codes } } });
    const existingCodes = new Set(existing.map((row) => row.code));
    const unresolvedCreators = tasks.filter((task) => !employeeByCode.get(task.creatorCode)?.user).map((task) => ({
      creatorCode: task.creatorCode,
      rowNumber: task.rowNumber,
      taskId: task.taskId,
    }));
    const attachmentIds = new Set<string>();
    for (const task of tasks) {
      for (const output of legacyOutputs(task)) {
        for (const feedback of legacyFeedbacks(output)) {
          const attachment = feedback.attachment && typeof feedback.attachment === "object"
            ? feedback.attachment as Record<string, unknown>
            : {};
          const id = driveId(attachment.fileId || feedback.attachmentFileId || attachment.url || feedback.attachmentUrl);
          if (id) attachmentIds.add(id);
        }
      }
    }
    const preview = {
      alreadyInV3: tasks.filter((task) => existingCodes.has(`TODO-V2-${task.taskId}`)).length,
      linkedDriveFiles: attachmentIds.size,
      missingToCreate: tasks.filter((task) => !existingCodes.has(`TODO-V2-${task.taskId}`)).length,
      rowsRead: tasks.length,
      unresolvedCreators,
    };
    if (mode === "preview") return { mode, ...preview };
    if (unresolvedCreators.length) throw new Error(`Còn ${unresolvedCreators.length} công việc không ánh xạ được người tạo.`);

    const source = await db.migrationSource.upsert({
      create: {
        config: { sheetName: SHEET_NAME, spreadsheetId },
        key: SOURCE_KEY,
        kind: "GOOGLE_SHEET",
        name: "V2 15_Nhac viec",
      },
      update: {
        config: { sheetName: SHEET_NAME, spreadsheetId },
        lastRunAt: new Date(),
        status: "ACTIVE",
      },
      where: { key: SOURCE_KEY },
    });
    const run = await db.migrationRun.create({
      data: {
        mode: "APPLY",
        phase: "IMPORT_TODO_HISTORY",
        rowsRead: tasks.length,
        rowsValid: tasks.length,
        sourceConfigSnapshot: { sheetName: SHEET_NAME, spreadsheetId },
        sourceId: source.id,
        status: "RUNNING",
      },
    });
    const counters = { attachmentsCreated: 0, created: 0, failed: 0, skipped: 0 };
    for (const task of tasks) {
      const externalId = task.taskId;
      const code = `TODO-V2-${task.taskId}`;
      let internalId: string | undefined;
      let recordStatus = "IMPORTED";
      let errorMessage = "";
      try {
        const creator = employeeByCode.get(task.creatorCode)!;
        const company = employees.find((employee) =>
          employee.company && [employee.company.code, employee.company.shortName, employee.company.legalName].some((value) => normalize(value) === normalize(task.companyName)),
        )?.company || null;
        const sourceOutputs = legacyOutputs(task);
        const outputs = sourceOutputs.length
          ? sourceOutputs.map((output, index) => {
            const assignee = resolveEmployee(output.people) || employeeByCode.get(task.assigneeCodes[index] || task.assigneeCodes[0]);
            const feedbacks = legacyFeedbacks(output).map((feedback) => ({
              actorName: text(feedback.actorName || feedback.responderName),
              createdAt: text(feedback.respondedAt || feedback.updatedAt),
              fileId: text(feedback.attachmentFileId),
              fileName: text(feedback.fileName),
              fileUrl: text(feedback.attachmentUrl || feedback.link),
              id: text(feedback.responseId) || `${task.taskId}-${index}-feedback`,
              report: text(feedback.report),
              status: normalize(feedback.reviewStatus).includes("approved")
                ? "APPROVED"
                : normalize(feedback.reviewStatus).includes("returned")
                  ? "RETURNED"
                  : "SUBMITTED",
            }));
            const latest = feedbacks.at(-1);
            return {
              assignee: text(output.people),
              assigneeEmployeeId: assignee?.id || "",
              assigneeUserId: assignee?.user?.id || "",
              description: text(output.title) || `Đầu ra ${index + 1}`,
              dueAt: text(output.dueAt) || task.dueAt?.toISOString() || "",
              feedbacks,
              id: `${task.taskId}-output-${index + 1}`,
              status: latest?.status || (status(task.statusLabel) === "COMPLETED" ? "APPROVED" : "OPEN"),
            };
          })
          : [{
            assignee: task.assigneeCodes.join(", "),
            assigneeEmployeeId: employeeByCode.get(task.assigneeCodes[0])?.id || "",
            assigneeUserId: employeeByCode.get(task.assigneeCodes[0])?.user?.id || "",
            description: task.content || task.title,
            dueAt: task.dueAt?.toISOString() || "",
            feedbacks: [],
            id: `${task.taskId}-output-1`,
            status: status(task.statusLabel) === "COMPLETED" ? "APPROVED" : "OPEN",
          }];
        const taskStatus = status(task.statusLabel);
        let request = await db.request.findUnique({ where: { code } });
        if (request) {
          internalId = request.id;
          recordStatus = "SKIPPED";
          counters.skipped += 1;
        } else {
          request = await db.request.create({
            data: {
              assignedToId: outputs.find((output) => output.assigneeUserId)?.assigneeUserId || null,
              code,
              companyId: company?.id || creator.companyId || null,
              completedAt: taskStatus === "COMPLETED" ? task.completedAt || task.updatedAt : null,
              createdAt: task.createdAt,
              createdById: creator.user!.id,
              note: text(task.legacyNote.context) || task.content || null,
              payload: asJson({
                assignmentKind: text(task.legacyNote.taskKind) || (Object.keys(task.repeat).length ? "recurring" : "planned"),
                collaboratorCodes: task.collaboratorCodes,
                context: text(task.legacyNote.context) || task.content,
                legacySource: { rowNumber: task.rowNumber, sheetName: SHEET_NAME, taskId: task.taskId },
                outputs,
                repeat: task.repeat,
              }),
              priority: task.priority || null,
              serviceCode: "todo-assignment",
              status: taskStatus,
              title: task.title,
              updatedAt: task.updatedAt,
            },
          });
          internalId = request.id;
          counters.created += 1;
          await db.requestEvent.create({
            data: {
              actorId: creator.user!.id,
              createdAt: task.createdAt,
              note: "Nhập từ lịch sử Giao việc V2.",
              requestId: request.id,
              toStatus: "SUBMITTED",
              type: "SUBMITTED",
            },
          });
          if (taskStatus !== "SUBMITTED") {
            await db.requestEvent.create({
              data: {
                actorId: creator.user!.id,
                createdAt: task.completedAt || task.updatedAt,
                fromStatus: "SUBMITTED",
                note: `Trạng thái cuối từ V2: ${task.statusLabel}.`,
                requestId: request.id,
                toStatus: taskStatus,
                type: taskStatus === "COMPLETED" ? "COMPLETED" : taskStatus === "CANCELLED" ? "CANCELLED" : "PROCESSING",
              },
            });
          }
        }

        for (const output of sourceOutputs) {
          for (const feedback of legacyFeedbacks(output)) {
            const attachment = feedback.attachment && typeof feedback.attachment === "object"
              ? feedback.attachment as Record<string, unknown>
              : {};
            const fileId = driveId(attachment.fileId || feedback.attachmentFileId || attachment.url || feedback.attachmentUrl);
            if (!fileId) continue;
            const attachmentExternalId = `${task.taskId}:${fileId}`;
            const mapped = await db.externalIdMap.findUnique({
              where: {
                sourceId_entityType_externalId: {
                  entityType: "RequestAttachment",
                  externalId: attachmentExternalId,
                  sourceId: source.id,
                },
              },
            });
            if (mapped) continue;
            const fileName = text(attachment.name || attachment.fileName || feedback.fileName) || fileId;
            const fileUrl = text(attachment.url || feedback.attachmentUrl || feedback.link) || `https://drive.google.com/file/d/${fileId}/view`;
            const uploader = resolveEmployee(feedback.actorId || feedback.responderEmployeeId || feedback.actorName);
            const fileObject = await db.fileObject.upsert({
              create: {
                metadata: asJson({ importedFrom: SHEET_NAME, taskId: task.taskId }),
                migrationState: "LINKED_DRIVE",
                mimeType: text(attachment.mimeType) || null,
                objectKey: fileId,
                originalName: fileName,
                ownerId: uploader?.user?.id || creator.user!.id,
                provider: "GOOGLE_DRIVE",
                sizeBytes: integer(attachment.size) ? BigInt(integer(attachment.size)) : null,
                sourceDriveId: fileId,
              },
              update: {},
              where: { sourceDriveId: fileId },
            });
            const requestAttachment = await db.requestAttachment.create({
              data: {
                createdAt: date(attachment.uploadedAt || feedback.respondedAt) || task.updatedAt,
                fileName,
                fileObjectId: fileObject.id,
                fileUrl,
                mimeType: text(attachment.mimeType) || null,
                requestId: request!.id,
                sizeBytes: integer(attachment.size) || null,
                uploadedById: uploader?.user?.id || null,
              },
            });
            await db.externalIdMap.create({
              data: {
                entityType: "RequestAttachment",
                externalId: attachmentExternalId,
                internalId: requestAttachment.id,
                metadata: { fileId, rowNumber: task.rowNumber },
                sourceId: source.id,
              },
            });
            counters.attachmentsCreated += 1;
          }
        }
        await db.externalIdMap.upsert({
          create: {
            entityType: "Request",
            externalId,
            internalId: internalId!,
            metadata: { rowNumber: task.rowNumber },
            sourceId: source.id,
          },
          update: {
            internalId: internalId!,
            lastSeenAt: new Date(),
            metadata: { rowNumber: task.rowNumber },
          },
          where: {
            sourceId_entityType_externalId: { entityType: "Request", externalId, sourceId: source.id },
          },
        });
      } catch (error) {
        counters.failed += 1;
        recordStatus = "FAILED";
        errorMessage = error instanceof Error ? error.message : String(error);
      }
      await db.migrationRecord.create({
        data: {
          entityType: "Request",
          externalId,
          internalId,
          issueCount: errorMessage ? 1 : 0,
          processedAt: new Date(),
          rawData: asJson(task),
          rowNumber: task.rowNumber,
          runId: run.id,
          status: recordStatus,
        },
      });
      if (errorMessage) {
        await db.migrationIssue.create({
          data: {
            code: "TODO_HISTORY_IMPORT_FAILED",
            externalId,
            message: errorMessage,
            rawData: asJson(task),
            rowNumber: task.rowNumber,
            runId: run.id,
            severity: "ERROR",
          },
        });
      }
    }
    const runStatus = counters.failed ? "PARTIAL" : "COMPLETED";
    await db.migrationRun.update({
      data: {
        completedAt: new Date(),
        phase: "IMPORT_TODO_HISTORY_COMPLETED",
        rowsCreated: counters.created,
        rowsFailed: counters.failed,
        rowsSkipped: counters.skipped,
        status: runStatus,
        summary: `15_Nhac viec: ${counters.created} công việc, ${counters.attachmentsCreated} file liên kết, ${counters.skipped} giữ nguyên, ${counters.failed} lỗi.`,
      },
      where: { id: run.id },
    });
    return { mode, runId: run.id, status: runStatus, ...counters };
  } finally {
    await db.$disconnect();
  }
}

main()
  .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exitCode = 1;
  });
