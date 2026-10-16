import "server-only";

import { getDb } from "@/lib/db";

import { WORKBENCH_WIDGET_DEFINITIONS } from "./catalog";
import { WORKBENCH_REQUEST_MODULES } from "./request-modules";
import {
  WORKBENCH_SOURCE_KEYS,
  type WorkbenchSourceConfigView,
  type WorkbenchSourceKey,
  type WorkbenchWidgetCatalogItem,
  type WorkbenchWidgetConfigView,
} from "./types";

export const WORKBENCH_SOURCE_DEFINITIONS: Record<
  WorkbenchSourceKey,
  Omit<WorkbenchSourceConfigView, "itemCount" | "lastError" | "lastStatus" | "lastSyncedAt">
> = {
  requests: {
    description: "Nguồn đơn được chia thành widget riêng cho từng module nghiệp vụ.",
    isEnabled: true,
    key: "requests",
    label: "Đơn theo từng module",
    moduleKey: "my-orders",
    sortOrder: 10,
  },
  tasks: {
    description: "Đầu việc mở được giao hoặc do người dùng tạo.",
    isEnabled: true,
    key: "tasks",
    label: "Giao việc",
    moduleKey: "todo",
    sortOrder: 20,
  },
  meetings: {
    description: "Cuộc họp sắp tới mà người dùng tổ chức hoặc tham dự.",
    isEnabled: true,
    key: "meetings",
    label: "Lịch họp",
    moduleKey: "meetings",
    sortOrder: 30,
  },
};

function boundedInteger(value: number, fallback: number, min: number, max: number) {
  return Number.isInteger(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function mergeWidgetConfig(
  definition: WorkbenchWidgetCatalogItem,
  row:
    | {
        allowMultiple: boolean;
        defaultColor: string;
        defaultHeight: number;
        defaultVisible: boolean;
        defaultWidth: number;
        defaultX: number;
        defaultY: number;
        isEnabled: boolean;
        maxHeight: number;
        maxWidth: number;
        minHeight: number;
        minWidth: number;
        sortOrder: number;
      }
    | undefined,
): WorkbenchWidgetConfigView {
  if (!row) return { ...definition, isEnabled: true };
  const minWidth = boundedInteger(row.minWidth, definition.minWidth, 1, 16);
  const minHeight = boundedInteger(row.minHeight, definition.minHeight, 1, 10);
  const maxWidth = boundedInteger(row.maxWidth, definition.maxWidth, minWidth, 16);
  const maxHeight = boundedInteger(row.maxHeight, definition.maxHeight, minHeight, 10);
  const defaultWidth = boundedInteger(
    row.defaultWidth,
    definition.defaultWidth,
    minWidth,
    maxWidth,
  );
  const defaultHeight = boundedInteger(
    row.defaultHeight,
    definition.defaultHeight,
    minHeight,
    maxHeight,
  );
  return {
    ...definition,
    allowMultiple: row.allowMultiple,
    defaultColor: ["teal", "amber", "coral", "blue", "violet", "slate"].includes(
      row.defaultColor,
    )
      ? (row.defaultColor as WorkbenchWidgetConfigView["defaultColor"])
      : definition.defaultColor,
    defaultHeight,
    defaultVisible: row.defaultVisible,
    defaultWidth,
    defaultX: boundedInteger(row.defaultX, definition.defaultX, 0, 16 - defaultWidth),
    defaultY: boundedInteger(row.defaultY, definition.defaultY, 0, 10 - defaultHeight),
    isEnabled: row.isEnabled,
    maxHeight,
    maxWidth,
    minHeight,
    minWidth,
    sortOrder: boundedInteger(row.sortOrder, definition.sortOrder, 0, 9999),
  };
}

function requestWidgetDefinition(
  module: (typeof WORKBENCH_REQUEST_MODULES)[number],
  base: WorkbenchWidgetConfigView,
  index: number,
): WorkbenchWidgetCatalogItem {
  const tones: WorkbenchWidgetCatalogItem["defaultColor"][] = [
    "teal",
    "amber",
    "coral",
    "blue",
    "violet",
    "slate",
  ];
  return {
    ...base,
    allowMultiple: false,
    catalogKey: `requests:${module.serviceCode}`,
    defaultColor: tones[index % tones.length],
    defaultVisible: index === 0 && base.defaultVisible,
    description: `Theo dõi riêng các đơn thuộc module ${module.label}.`,
    icon: module.icon,
    label: module.label,
    presetSettings: { serviceCode: module.serviceCode },
    sortOrder: 300 + module.sortOrder,
  };
}

export async function loadWorkbenchRegistry() {
  const db = getDb();
  const [widgetRows, sourceRows] = await Promise.all([
    db.workbenchWidgetConfig.findMany(),
    db.workbenchSourceConfig.findMany(),
  ]);
  const widgetMap = new Map(widgetRows.map((row) => [row.widgetKey, row]));
  const sourceMap = new Map(sourceRows.map((row) => [row.key, row]));
  const widgets = Object.values(WORKBENCH_WIDGET_DEFINITIONS)
    .map((definition) => mergeWidgetConfig(definition, widgetMap.get(definition.key)))
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const requestBase =
    widgets.find((widget) => widget.key === "requests") ||
    mergeWidgetConfig(WORKBENCH_WIDGET_DEFINITIONS.requests, undefined);
  const requestWidgets = WORKBENCH_REQUEST_MODULES.filter(
    (module) => module.moduleKey !== "expense-advance",
  )
    .map((module, index) => {
      const definition = requestWidgetDefinition(module, requestBase, index);
      return mergeWidgetConfig(
        definition,
        widgetMap.get(definition.catalogKey || definition.key),
      );
    })
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const sources = WORKBENCH_SOURCE_KEYS.map((key): WorkbenchSourceConfigView => {
    const definition = WORKBENCH_SOURCE_DEFINITIONS[key];
    const row = sourceMap.get(key);
    return {
      ...definition,
      isEnabled: row?.isEnabled ?? definition.isEnabled,
      itemCount: row?.itemCount ?? 0,
      lastError: row?.lastError || "",
      lastStatus: row?.lastStatus || "PENDING",
      lastSyncedAt: row?.lastSyncedAt?.toISOString() || "",
      sortOrder: row?.sortOrder ?? definition.sortOrder,
    };
  }).sort((a, b) => a.sortOrder - b.sortOrder);
  return { requestWidgets, sources, widgets };
}
