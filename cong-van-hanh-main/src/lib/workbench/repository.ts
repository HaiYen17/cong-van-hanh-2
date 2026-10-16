import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import {
  canAccessAirControl,
  getAirControlSnapshot,
} from "@/lib/air-control/runtime";
import type { AppSession } from "@/lib/auth/session";
import {
  sessionEmployeeIds,
  sessionOwnsUserId,
  sessionUserIds,
} from "@/lib/auth/session-identity";
import { getDb } from "@/lib/db";
import { buildLegacyFeatureGroups } from "@/lib/legacy-portal-catalog";
import { listMyInboxTicketsForWorkbench } from "@/lib/requests/inbox-runtime";
import {
  canonicalTodoOutputStatus,
  isTodoOutputClosed,
  todoAssigneeEmployeeIds,
  todoAssigneeUserIds,
} from "@/lib/todo/output";

import {
  availableWorkbenchUserCatalog,
  canUseWorkbenchWidget,
  defaultWorkbenchLayout,
} from "./catalog";
import {
  availableWorkbenchRequestModules,
  canonicalWorkbenchRequestServiceCode,
  workbenchRequestHref,
  workbenchRequestModule,
  workbenchRequestStageOptions,
  workbenchStageFilterKey,
  workbenchStepFilterKey,
} from "./request-modules";
import { loadWorkbenchRegistry, WORKBENCH_SOURCE_DEFINITIONS } from "./registry";
import {
  WORKBENCH_COLUMNS,
  WORKBENCH_ROWS,
  WORKBENCH_WIDGET_KEYS,
  type SaveWorkbenchLayoutInput,
  type WorkbenchData,
  type WorkbenchActivityItem,
  type WorkbenchInitialState,
  type WorkbenchMeetingItem,
  type WorkbenchRequestItem,
  type WorkbenchShortcut,
  type WorkbenchTaskItem,
  type WorkbenchWidgetKey,
  type WorkbenchWidgetCatalogItem,
  type WorkbenchWidgetLayout,
  type WorkbenchWidgetSettings,
  type WorkbenchWidgetTone,
} from "./types";

const VALID_TONES = new Set<WorkbenchWidgetTone>([
  "teal",
  "amber",
  "coral",
  "blue",
  "violet",
  "slate",
]);
const VALID_WIDGET_KEYS = new Set<string>(WORKBENCH_WIDGET_KEYS);
const MAX_WIDGETS = 24;

function text(value: unknown) {
  return String(value ?? "").trim();
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asSettings(value: unknown): WorkbenchWidgetSettings {
  const source = asRecord(value);
  const moduleKeys = Array.isArray(source.moduleKeys)
    ? source.moduleKeys
        .map(text)
        .filter(Boolean)
        .slice(0, 12)
        .map((item) => item.slice(0, 80))
    : undefined;
  const stageKeys = Array.isArray(source.stageKeys)
    ? source.stageKeys
        .map(text)
        .filter(Boolean)
        .slice(0, 24)
        .map((item) => item.slice(0, 120))
    : undefined;
  return {
    deviceId: text(source.deviceId).slice(0, 120) || undefined,
    moduleKeys,
    serviceCode: text(source.serviceCode).slice(0, 120) || undefined,
    stageKeys,
  };
}

function integer(value: unknown) {
  const result = Number(value);
  return Number.isInteger(result) ? result : Number.NaN;
}

function overlaps(a: WorkbenchWidgetLayout, b: WorkbenchWidgetLayout) {
  return !(
    a.x + a.width <= b.x ||
    b.x + b.width <= a.x ||
    a.y + a.height <= b.y ||
    b.y + b.height <= a.y
  );
}

function normalizeStoredWidgets(
  session: AppSession,
  rows: Array<{
    color: string;
    height: number;
    id: string;
    settings: unknown;
    title: string | null;
    widgetKey: string;
    width: number;
    x: number;
    y: number;
  }>,
  definitions: Map<WorkbenchWidgetKey, WorkbenchWidgetCatalogItem>,
  requestDefinitions: Map<string, WorkbenchWidgetCatalogItem>,
) {
  const widgets: WorkbenchWidgetLayout[] = [];
  for (const row of rows) {
    if (!VALID_WIDGET_KEYS.has(row.widgetKey)) continue;
    const widgetKey = row.widgetKey as WorkbenchWidgetKey;
    if (!canUseWorkbenchWidget(session, widgetKey)) continue;
    const settings = asSettings(row.settings);
    const serviceCode = canonicalWorkbenchRequestServiceCode(
      text(settings.serviceCode),
    );
    const definition =
      widgetKey === "requests" && serviceCode && serviceCode !== "all"
        ? requestDefinitions.get(`requests:${serviceCode}`)
        : definitions.get(widgetKey);
    if (!definition) continue;
    const width = Math.min(
      definition.maxWidth,
      Math.max(definition.minWidth, row.width),
    );
    const height = Math.min(
      definition.maxHeight,
      Math.max(definition.minHeight, row.height),
    );
    const candidate: WorkbenchWidgetLayout = {
      color: VALID_TONES.has(row.color as WorkbenchWidgetTone)
        ? (row.color as WorkbenchWidgetTone)
        : definition.defaultColor,
      height,
      id: row.id,
      settings,
      title: text(row.title).slice(0, 80) || definition.label,
      widgetKey,
      width,
      x: Math.max(0, Math.min(WORKBENCH_COLUMNS - width, row.x)),
      y: Math.max(0, Math.min(WORKBENCH_ROWS - height, row.y)),
    };
    if (!widgets.some((item) => overlaps(item, candidate))) {
      widgets.push(candidate);
    }
  }
  return widgets;
}

function specializeRequestWidgets(
  widgets: WorkbenchWidgetLayout[],
  serviceOptions: WorkbenchData["serviceOptions"],
  requestDefinitions: Map<string, WorkbenchWidgetCatalogItem>,
) {
  const fallback = serviceOptions.find((option) =>
    requestDefinitions.has(`requests:${option.value}`),
  );
  return widgets.flatMap((widget) => {
    if (widget.widgetKey !== "requests") return [widget];
    const currentCode = text(widget.settings.serviceCode);
    if ((!currentCode || currentCode === "all") && !fallback) return [];
    const serviceCode =
      !currentCode || currentCode === "all"
        ? fallback?.value || ""
        : canonicalWorkbenchRequestServiceCode(currentCode);
    if (!requestDefinitions.has(`requests:${serviceCode}`)) return [];
    const service =
      serviceOptions.find((option) => option.value === serviceCode) || fallback;
    return [
      {
        ...widget,
        settings: { ...widget.settings, serviceCode },
        title:
          !widget.title ||
          ["Đơn theo module", "Widget đơn từng module"].includes(widget.title)
            ? service?.label || widget.title
            : widget.title,
      },
    ];
  });
}

function validateLayoutInput(
  session: AppSession,
  input: SaveWorkbenchLayoutInput,
  definitions: Map<WorkbenchWidgetKey, WorkbenchWidgetCatalogItem>,
  requestDefinitions: Map<string, WorkbenchWidgetCatalogItem>,
) {
  if (!input || !Array.isArray(input.widgets)) {
    throw new Error("Bố cục gửi lên không hợp lệ.");
  }
  if (input.widgets.length > MAX_WIDGETS) {
    throw new Error(`Bàn làm việc chỉ nhận tối đa ${MAX_WIDGETS} widget.`);
  }

  const widgets: WorkbenchWidgetLayout[] = [];
  const singletonKeys = new Set<WorkbenchWidgetKey>();
  const requestServiceCodes = new Set<string>();
  for (const [index, raw] of input.widgets.entries()) {
    if (!raw || !VALID_WIDGET_KEYS.has(raw.widgetKey)) {
      throw new Error(`Widget thứ ${index + 1} không được hỗ trợ.`);
    }
    const widgetKey = raw.widgetKey as WorkbenchWidgetKey;
    if (!canUseWorkbenchWidget(session, widgetKey)) {
      throw new Error("Tài khoản không có quyền sử dụng một widget trong bố cục.");
    }
    const settings = asSettings(raw.settings);
    const serviceCode = canonicalWorkbenchRequestServiceCode(
      text(settings.serviceCode),
    );
    const definition =
      widgetKey === "requests" && serviceCode && serviceCode !== "all"
        ? requestDefinitions.get(`requests:${serviceCode}`)
        : definitions.get(widgetKey);
    if (!definition) {
      throw new Error("Widget này đang bị Admin tắt hoặc chưa được cấu hình.");
    }
    if (!definition.allowMultiple && widgetKey !== "requests") {
      if (singletonKeys.has(widgetKey)) {
        throw new Error(`${definition.label} chỉ được thêm một lần.`);
      }
      singletonKeys.add(widgetKey);
    }
    const x = integer(raw.x);
    const y = integer(raw.y);
    const width = integer(raw.width);
    const height = integer(raw.height);
    if (
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      x < 0 ||
      y < 0 ||
      width < definition.minWidth ||
      width > definition.maxWidth ||
      height < definition.minHeight ||
      height > definition.maxHeight ||
      x + width > WORKBENCH_COLUMNS ||
      y + height > WORKBENCH_ROWS
    ) {
      throw new Error(`Vị trí hoặc kích thước của ${definition.label} không hợp lệ.`);
    }
    if (widgetKey === "requests") {
      if (!serviceCode || serviceCode === "all") {
        throw new Error("Mỗi widget đơn phải gắn với một module cụ thể.");
      }
      const canonicalCode = canonicalWorkbenchRequestServiceCode(serviceCode);
      if (requestServiceCodes.has(canonicalCode)) {
        throw new Error("Mỗi module đơn chỉ được thêm một widget trên bàn.");
      }
      requestServiceCodes.add(canonicalCode);
      settings.serviceCode = canonicalCode;
    }
    const candidate: WorkbenchWidgetLayout = {
      color: VALID_TONES.has(raw.color) ? raw.color : definition.defaultColor,
      height,
      id: text(raw.id).slice(0, 120) || `widget-${index}`,
      settings,
      title: text(raw.title).slice(0, 80) || definition.label,
      widgetKey,
      width,
      x,
      y,
    };
    if (widgets.some((item) => overlaps(item, candidate))) {
      throw new Error("Có hai widget đang chồng lên nhau.");
    }
    widgets.push(candidate);
  }
  return widgets;
}

function normalize(value: unknown) {
  return text(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLocaleLowerCase("vi");
}

function isClosedWorkbenchStatus(value: unknown) {
  const normalized = normalize(value);
  return ["hoan thanh", "huy don", "completed", "cancelled", "canceled"].some(
    (status) => normalized.includes(status),
  );
}

async function loadTasks(session: AppSession): Promise<WorkbenchTaskItem[]> {
  const db = getDb();
  const identityEmployeeIds = sessionEmployeeIds(session);
  const identityUserIds = sessionUserIds(session);
  const [actors, rows] = await Promise.all([
    db.user.findMany({
      include: { employee: true },
      where: { id: { in: identityUserIds } },
    }),
    db.request.findMany({
      orderBy: [{ updatedAt: "desc" }],
      where: {
        archivedAt: null,
        serviceCode: "todo-assignment",
      },
    }),
  ]);
  const actorTokens = [
    session.displayName,
    ...actors.flatMap((actor) => [
      actor.email,
      actor.username,
      actor.employee?.employeeCode,
      actor.employee?.fullName,
      actor.employee?.email,
      actor.employee?.phone,
    ]),
  ]
    .map(normalize)
    .filter(Boolean);

  const tasks: WorkbenchTaskItem[] = [];
  for (const row of rows) {
    const payload = asRecord(row.payload);
    const outputs = Array.isArray(payload.outputs)
      ? payload.outputs.map(asRecord)
      : [];
    const createdByMe = sessionOwnsUserId(session, row.createdById);
    for (const [index, output] of outputs.entries()) {
      const assignee = normalize(output.assignee);
      const assigneeUserIds = todoAssigneeUserIds(output);
      const assigneeEmployeeIds = todoAssigneeEmployeeIds(output);
      const hasStableAssignee = Boolean(
        assigneeUserIds.length || assigneeEmployeeIds.length,
      );
      const targetsActor = hasStableAssignee
        ? assigneeUserIds.some((userId) => identityUserIds.includes(userId)) ||
          assigneeEmployeeIds.some((employeeId) =>
            identityEmployeeIds.includes(employeeId),
          )
        : Boolean(
            assignee &&
              actorTokens.some(
                (token) =>
                  assignee.includes(token) || token.includes(assignee),
              ),
          );
      if (!targetsActor) continue;
      const status = canonicalTodoOutputStatus(output.status, row.status);
      if (isTodoOutputClosed(status)) continue;
      tasks.push({
        code: row.code,
        createdByMe,
        description: text(output.description) || `Đầu ra ${index + 1}`,
        dueAt: text(output.dueAt),
        href: "/nguoi-thuan-viet/giao-viec",
        id: text(output.id) || `${row.id}-${index}`,
        status,
        title: row.title,
        updatedAt: row.updatedAt.toISOString(),
      });
    }
  }
  return tasks
    .sort((a, b) => {
      if (!a.dueAt && !b.dueAt) return 0;
      if (!a.dueAt) return 1;
      if (!b.dueAt) return -1;
      return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
    })
    .slice(0, 30);
}

async function loadMeetings(
  session: AppSession,
): Promise<WorkbenchMeetingItem[]> {
  const db = getDb();
  const identityEmployeeIds = sessionEmployeeIds(session);
  const identityUserIds = sessionUserIds(session);
  const actors = await db.user.findMany({
    select: { email: true, employeeId: true },
    where: { id: { in: identityUserIds } },
  });
  const participantFilters: Prisma.MeetingAttendeeWhereInput[] = [
    { userId: { in: identityUserIds } },
  ];
  if (identityEmployeeIds.length) {
    participantFilters.push({ employeeId: { in: identityEmployeeIds } });
  }
  for (const actor of actors) {
    if (actor.email) {
      participantFilters.push({ email: { equals: actor.email, mode: "insensitive" } });
    }
  }
  const rows = await db.meeting.findMany({
    include: { room: true },
    orderBy: { startsAt: "asc" },
    take: 30,
    where: {
      endsAt: { gte: new Date(Date.now() - 60 * 60_000) },
      OR: [
        { organizerId: { in: identityUserIds } },
        { attendees: { some: { OR: participantFilters } } },
      ],
      status: { in: ["SCHEDULED", "IN_PROGRESS"] },
    },
  });
  return rows.map((meeting) => ({
    endsAt: meeting.endsAt.toISOString(),
    href: `/nguoi-thuan-viet/lich-hop/${meeting.id}`,
    id: meeting.id,
    roomLabel:
      meeting.room?.name ||
      meeting.locationText ||
      (meeting.mode === "ONLINE" ? "Google Meet" : ""),
    startsAt: meeting.startsAt.toISOString(),
    status: meeting.status,
    title: meeting.title,
  }));
}

async function loadRequests(session: AppSession) {
  const tickets = await listMyInboxTicketsForWorkbench(session);
  const rows: WorkbenchRequestItem[] = tickets.map((ticket) => {
    const rawServiceCode = text(ticket.serviceCode) || "other";
    const definition = workbenchRequestModule(rawServiceCode);
    const serviceCode = canonicalWorkbenchRequestServiceCode(rawServiceCode);
    const code = text(ticket.requestId);
    const payload = asRecord(ticket.json);
    const stage = text(ticket.trangThai) || "Đang xử lý";
    const stepCode = text(payload.stepCode);
    const stepLabel = text(payload.stepLabel);
    return {
      code,
      createdAt: text(ticket.createdAt),
      displayStage: stepLabel || stage,
      filterKeys: [
        workbenchStageFilterKey(stage),
        ...(stepCode ? [workbenchStepFilterKey(stepCode)] : []),
      ],
      href: workbenchRequestHref(serviceCode, code),
      priority: text(ticket.priority),
      serviceCode,
      serviceName:
        definition?.label || text(ticket.serviceName) || "Đơn hàng",
      stage,
      title:
        text(ticket.title) || text(ticket.documentName) || text(ticket.requestId),
      updatedAt: text(ticket.updatedAt),
    };
  });
  const optionMap = new Map<string, WorkbenchData["serviceOptions"][number]>();
  for (const definition of availableWorkbenchRequestModules(session)) {
    optionMap.set(definition.serviceCode, {
      href: workbenchRequestHref(definition.serviceCode),
      icon: definition.icon,
      label: definition.label,
      moduleKey: definition.moduleKey,
      stageOptions: workbenchRequestStageOptions(definition.serviceCode),
      value: definition.serviceCode,
    });
  }
  for (const request of rows) {
    if (optionMap.has(request.serviceCode)) continue;
    const definition = workbenchRequestModule(request.serviceCode);
    optionMap.set(request.serviceCode, {
      href: workbenchRequestHref(request.serviceCode),
      icon: definition?.icon || "inbox",
      label: definition?.label || request.serviceName,
      moduleKey: definition?.moduleKey || request.serviceCode,
      stageOptions: workbenchRequestStageOptions(request.serviceCode),
      value: request.serviceCode,
    });
  }
  const serviceOptions = [...optionMap.values()];
  return { requests: rows.slice(0, 80), serviceOptions };
}

async function loadShortcuts(session: AppSession): Promise<WorkbenchShortcut[]> {
  const databaseModules = await getDb().appModule.findMany({
    include: { group: true },
    where: { isActive: true, group: { isActive: true } },
  });
  return buildLegacyFeatureGroups({
    badgeCounts: {},
    databaseModules,
    session,
  }).flatMap((group) =>
    group.items.flatMap((item) =>
      item.href && item.key !== "my-orders" && !item.availability
        ? [
            {
              href: item.href,
              icon: item.icon,
              key: item.key,
              label: item.label,
            },
          ]
        : [],
    ),
  );
}

function activityItem(row: {
  dueAt: Date | null;
  href: string | null;
  id: string;
  kind: string;
  moduleKey: string | null;
  occurredAt: Date;
  priority: string | null;
  sourceKey: string;
  status: string;
  summary: string | null;
  title: string;
}): WorkbenchActivityItem {
  return {
    dueAt: row.dueAt?.toISOString() || "",
    href: row.href || "",
    id: row.id,
    kind: row.kind,
    moduleKey: row.moduleKey || "",
    occurredAt: row.occurredAt.toISOString(),
    priority: row.priority || "",
    sourceKey: row.sourceKey as WorkbenchActivityItem["sourceKey"],
    status: row.status,
    summary: row.summary || "",
    title: row.title,
  };
}

async function loadIndexedActivity(session: AppSession) {
  const rows = await getDb().workbenchItem.findMany({
    orderBy: [{ dueAt: "asc" }, { occurredAt: "desc" }],
    take: 60,
    where: { isActive: true, ownerUserId: session.userId },
  });
  return rows.map(activityItem);
}

async function loadWorkbenchData(
  session: AppSession,
  enabledSourceKeys: Set<string>,
): Promise<WorkbenchData> {
  const canLoadAir = canAccessAirControl(session);
  const airSnapshotPromise = canLoadAir
    ? getAirControlSnapshot(session).catch(() => null)
    : Promise.resolve(null);
  const [requestData, tasks, meetings, shortcuts, airSnapshot, activity] =
    await Promise.all([
      enabledSourceKeys.has("requests")
        ? loadRequests(session)
        : { requests: [], serviceOptions: [] },
      enabledSourceKeys.has("tasks") && canUseWorkbenchWidget(session, "tasks")
        ? loadTasks(session)
        : [],
      enabledSourceKeys.has("meetings") && canUseWorkbenchWidget(session, "meetings")
        ? loadMeetings(session)
        : [],
      loadShortcuts(session),
      airSnapshotPromise,
      loadIndexedActivity(session),
    ]);
  return {
    activity,
    airSnapshot,
    meetings,
    requests: requestData.requests,
    serviceOptions: requestData.serviceOptions,
    shortcuts,
    tasks,
  };
}

export async function getWorkbenchInitialState(
  session: AppSession,
): Promise<WorkbenchInitialState> {
  const registry = await loadWorkbenchRegistry();
  const definitions = registry.widgets.filter((widget) => widget.isEnabled);
  const requestDefinitions = registry.requestWidgets.filter(
    (widget) => widget.isEnabled,
  );
  const definitionMap = new Map(
    definitions.map((definition) => [definition.key, definition]),
  );
  const requestDefinitionMap = new Map(
    requestDefinitions.map((definition) => [
      definition.catalogKey || definition.key,
      definition,
    ]),
  );
  const enabledSourceKeys = new Set(
    registry.sources.filter((source) => source.isEnabled).map((source) => source.key),
  );
  const [layout, data] = await Promise.all([
    getDb().workbenchLayout.findUnique({
      include: { widgets: { orderBy: { sortOrder: "asc" } } },
      where: { userId: session.userId },
    }),
    loadWorkbenchData(session, enabledSourceKeys),
  ]);
  const catalog = availableWorkbenchUserCatalog(
    session,
    data.serviceOptions,
    definitions,
    requestDefinitions,
  );
  const baseWidgets = layout
    ? normalizeStoredWidgets(
        session,
        layout.widgets,
        definitionMap,
        requestDefinitionMap,
      )
    : defaultWorkbenchLayout(session, catalog);
  const widgets = specializeRequestWidgets(
    baseWidgets,
    data.serviceOptions,
    requestDefinitionMap,
  );
  return {
    catalog,
    data,
    hasSavedLayout: Boolean(layout),
    widgets,
  };
}

type WorkbenchProjectionItem = {
  dueAt: Date | null;
  href: string;
  kind: string;
  metadata: Prisma.InputJsonValue;
  moduleKey: string;
  occurredAt: Date;
  priority: string;
  sourceRecordId: string;
  status: string;
  summary: string;
  title: string;
};

function validDate(value: string, fallback = new Date()) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function optionalDate(value: string) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function syncProjectionSource(
  session: AppSession,
  sourceKey: "requests" | "tasks" | "meetings",
  items: WorkbenchProjectionItem[],
) {
  const db = getDb();
  const now = new Date();
  const definition = WORKBENCH_SOURCE_DEFINITIONS[sourceKey];
  await db.$transaction([
    db.workbenchItem.updateMany({
      data: { isActive: false, lastSyncedAt: now },
      where: { isActive: true, ownerUserId: session.userId, sourceKey },
    }),
    ...items.map((item) =>
      db.workbenchItem.upsert({
        create: {
          ...item,
          isActive: true,
          lastSyncedAt: now,
          ownerUserId: session.userId,
          sourceKey,
        },
        update: { ...item, isActive: true, lastSyncedAt: now },
        where: {
          ownerUserId_sourceKey_sourceRecordId: {
            ownerUserId: session.userId,
            sourceKey,
            sourceRecordId: item.sourceRecordId,
          },
        },
      }),
    ),
    db.workbenchSourceConfig.upsert({
      create: {
        description: definition.description,
        isEnabled: true,
        itemCount: items.length,
        key: sourceKey,
        label: definition.label,
        lastStatus: "SUCCESS",
        lastSyncedAt: now,
        moduleKey: definition.moduleKey,
        sortOrder: definition.sortOrder,
      },
      update: {
        lastError: null,
        lastStatus: "SUCCESS",
        lastSyncedAt: now,
      },
      where: { key: sourceKey },
    }),
  ]);
  const itemCount = await db.workbenchItem.count({
    where: { isActive: true, sourceKey },
  });
  await db.workbenchSourceConfig.update({
    data: { itemCount },
    where: { key: sourceKey },
  });
}

async function markProjectionError(
  session: AppSession,
  sourceKey: "requests" | "tasks" | "meetings",
  error: unknown,
) {
  const definition = WORKBENCH_SOURCE_DEFINITIONS[sourceKey];
  const message =
    error instanceof Error ? error.message.slice(0, 500) : "Không đồng bộ được nguồn.";
  await getDb().workbenchSourceConfig.upsert({
    create: {
      description: definition.description,
      isEnabled: true,
      key: sourceKey,
      label: definition.label,
      lastError: message,
      lastStatus: "ERROR",
      moduleKey: definition.moduleKey,
      sortOrder: definition.sortOrder,
      updatedById: session.userId,
    },
    update: {
      lastError: message,
      lastStatus: "ERROR",
      updatedById: session.userId,
    },
    where: { key: sourceKey },
  });
  return `${definition.label}: ${message}`;
}

export async function refreshWorkbenchActivity(session: AppSession) {
  const registry = await loadWorkbenchRegistry();
  const warnings: string[] = [];
  for (const source of registry.sources) {
    if (!source.isEnabled) {
      await getDb().workbenchItem.updateMany({
        data: { isActive: false },
        where: { isActive: true, ownerUserId: session.userId, sourceKey: source.key },
      });
      continue;
    }
    try {
      if (source.key === "requests") {
        const { requests } = await loadRequests(session);
        await syncProjectionSource(
          session,
          source.key,
          requests.filter((item) => !isClosedWorkbenchStatus(item.stage)).map((item) => ({
            dueAt: null,
            href: item.href,
            kind: "REQUEST",
            metadata: {
              code: item.code,
              createdAt: item.createdAt,
              serviceCode: item.serviceCode,
              serviceName: item.serviceName,
            },
            moduleKey: item.serviceCode,
            occurredAt: validDate(item.updatedAt || item.createdAt),
            priority: item.priority,
            sourceRecordId:
              item.code || `${item.serviceCode}:${item.createdAt}:${item.title}`,
            status: item.stage,
            summary: `${item.serviceName} · ${item.code}`,
            title: item.title,
          })),
        );
      } else if (source.key === "tasks") {
        const tasks = canUseWorkbenchWidget(session, "tasks")
          ? await loadTasks(session)
          : [];
        await syncProjectionSource(
          session,
          source.key,
          tasks.map((item) => ({
            dueAt: optionalDate(item.dueAt),
            href: item.href,
            kind: "TASK",
            metadata: { code: item.code, createdByMe: item.createdByMe },
            moduleKey: "todo",
            occurredAt: validDate(item.updatedAt),
            priority: "",
            sourceRecordId: item.id,
            status: item.status,
            summary: `${item.title} · ${item.code}`,
            title: item.description,
          })),
        );
      } else {
        const meetings = canUseWorkbenchWidget(session, "meetings")
          ? await loadMeetings(session)
          : [];
        await syncProjectionSource(
          session,
          source.key,
          meetings.map((item) => ({
            dueAt: optionalDate(item.startsAt),
            href: item.href,
            kind: "MEETING",
            metadata: { endsAt: item.endsAt, roomLabel: item.roomLabel },
            moduleKey: "meetings",
            occurredAt: validDate(item.startsAt),
            priority: "",
            sourceRecordId: item.id,
            status: item.status,
            summary: item.roomLabel,
            title: item.title,
          })),
        );
      }
    } catch (error) {
      warnings.push(await markProjectionError(session, source.key, error));
    }
  }
  return { activity: await loadIndexedActivity(session), warnings };
}

function inputJson(value: WorkbenchWidgetSettings): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export async function saveWorkbenchLayout(
  session: AppSession,
  input: SaveWorkbenchLayoutInput,
) {
  const registry = await loadWorkbenchRegistry();
  const definitions = registry.widgets.filter((widget) => widget.isEnabled);
  const requestDefinitions = registry.requestWidgets.filter(
    (widget) => widget.isEnabled,
  );
  const definitionMap = new Map(
    definitions.map((definition) => [definition.key, definition]),
  );
  const requestDefinitionMap = new Map(
    requestDefinitions.map((definition) => [
      definition.catalogKey || definition.key,
      definition,
    ]),
  );
  const widgets = validateLayoutInput(
    session,
    input,
    definitionMap,
    requestDefinitionMap,
  );
  const db = getDb();
  const layout = await db.$transaction(async (tx) => {
    const savedLayout = await tx.workbenchLayout.upsert({
      create: {
        columns: WORKBENCH_COLUMNS,
        name: "Bàn làm việc của tôi",
        rows: WORKBENCH_ROWS,
        userId: session.userId,
      },
      update: {
        columns: WORKBENCH_COLUMNS,
        rows: WORKBENCH_ROWS,
      },
      where: { userId: session.userId },
    });
    await tx.workbenchWidget.deleteMany({
      where: { layoutId: savedLayout.id },
    });
    if (widgets.length) {
      await tx.workbenchWidget.createMany({
        data: widgets.map((widget, index) => ({
          color: widget.color,
          height: widget.height,
          layoutId: savedLayout.id,
          settings: inputJson(widget.settings),
          sortOrder: index,
          title: widget.title,
          widgetKey: widget.widgetKey,
          width: widget.width,
          x: widget.x,
          y: widget.y,
        })),
      });
    }
    await tx.auditLog.create({
      data: {
        action: "UPDATE",
        actorId: session.userId,
        metadata: { widgetCount: widgets.length },
        summary: "Cập nhật bố cục Bàn làm việc của tôi",
        targetId: savedLayout.id,
        targetType: "WorkbenchLayout",
      },
    });
    return tx.workbenchLayout.findUniqueOrThrow({
      include: { widgets: { orderBy: { sortOrder: "asc" } } },
      where: { id: savedLayout.id },
    });
  });
  return normalizeStoredWidgets(
    session,
    layout.widgets,
    definitionMap,
    requestDefinitionMap,
  );
}

export async function resetWorkbenchLayout(session: AppSession) {
  const db = getDb();
  const existing = await db.workbenchLayout.findUnique({
    select: { id: true },
    where: { userId: session.userId },
  });
  if (existing) {
    await db.$transaction([
      db.workbenchLayout.delete({ where: { id: existing.id } }),
      db.auditLog.create({
        data: {
          action: "UPDATE",
          actorId: session.userId,
          metadata: { restoredDefault: true },
          summary: "Khôi phục bố cục mặc định của Bàn làm việc",
          targetId: existing.id,
          targetType: "WorkbenchLayout",
        },
      }),
    ]);
  }
  const registry = await loadWorkbenchRegistry();
  const requestData = await loadRequests(session);
  const catalog = availableWorkbenchUserCatalog(
    session,
    requestData.serviceOptions,
    registry.widgets.filter((widget) => widget.isEnabled),
    registry.requestWidgets.filter((widget) => widget.isEnabled),
  );
  return defaultWorkbenchLayout(session, catalog);
}
