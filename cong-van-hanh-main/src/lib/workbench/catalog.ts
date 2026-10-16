import type { AppSession } from "@/lib/auth/session";

import {
  type WorkbenchWidgetCatalogItem,
  type WorkbenchWidgetKey,
  type WorkbenchWidgetLayout,
} from "./types";

import type { WorkbenchServiceOption } from "./types";

export const WORKBENCH_WIDGET_DEFINITIONS: Record<
  WorkbenchWidgetKey,
  WorkbenchWidgetCatalogItem
> = {
  activity: {
    allowMultiple: false,
    defaultColor: "slate",
    defaultHeight: 3,
    defaultVisible: true,
    defaultWidth: 7,
    defaultX: 6,
    defaultY: 4,
    description: "Một dòng ưu tiên chung từ đơn, giao việc và lịch họp của bạn.",
    icon: "activity",
    key: "activity",
    label: "Dòng công việc",
    maxHeight: 8,
    maxWidth: 14,
    minHeight: 3,
    minWidth: 5,
    sortOrder: 10,
  },
  requests: {
    allowMultiple: true,
    defaultColor: "teal",
    defaultHeight: 4,
    defaultVisible: true,
    defaultWidth: 5,
    defaultX: 4,
    defaultY: 0,
    description: "Khung hiển thị đơn được tách riêng cho từng module nghiệp vụ.",
    icon: "inbox",
    key: "requests",
    label: "Widget đơn từng module",
    maxHeight: 8,
    maxWidth: 12,
    minHeight: 3,
    minWidth: 4,
    sortOrder: 30,
  },
  tasks: {
    allowMultiple: false,
    defaultColor: "amber",
    defaultHeight: 4,
    defaultVisible: true,
    defaultWidth: 4,
    defaultX: 0,
    defaultY: 0,
    description: "Việc được giao, việc đang làm và các đầu ra sắp đến hạn.",
    icon: "list-todo",
    key: "tasks",
    label: "Việc của tôi",
    maxHeight: 8,
    maxWidth: 10,
    minHeight: 3,
    minWidth: 4,
    sortOrder: 20,
  },
  meetings: {
    allowMultiple: false,
    defaultColor: "blue",
    defaultHeight: 4,
    defaultVisible: true,
    defaultWidth: 4,
    defaultX: 9,
    defaultY: 0,
    description: "Các cuộc họp sắp tới mà bạn tổ chức hoặc tham dự.",
    icon: "calendar-days",
    key: "meetings",
    label: "Lịch họp",
    maxHeight: 8,
    maxWidth: 10,
    minHeight: 3,
    minWidth: 4,
    sortOrder: 40,
  },
  "air-control": {
    allowMultiple: true,
    defaultColor: "coral",
    defaultHeight: 4,
    defaultVisible: true,
    defaultWidth: 3,
    defaultX: 13,
    defaultY: 0,
    description: "Ghim máy lạnh thường dùng để bật, tắt và chỉnh nhiệt độ.",
    icon: "snowflake",
    key: "air-control",
    label: "Điều khiển máy lạnh",
    maxHeight: 6,
    maxWidth: 8,
    minHeight: 3,
    minWidth: 3,
    sortOrder: 50,
  },
  shortcuts: {
    allowMultiple: true,
    defaultColor: "violet",
    defaultHeight: 2,
    defaultVisible: true,
    defaultWidth: 6,
    defaultX: 0,
    defaultY: 4,
    description: "Ghim nhanh những module và công cụ bạn thường mở.",
    icon: "grid",
    key: "shortcuts",
    label: "Lối tắt yêu thích",
    maxHeight: 6,
    maxWidth: 12,
    minHeight: 2,
    minWidth: 4,
    sortOrder: 60,
  },
};

export function canUseWorkbenchWidget(
  session: AppSession,
  widgetKey: WorkbenchWidgetKey,
) {
  if (session.fullAccess) return true;
  if (
    widgetKey === "activity" ||
    widgetKey === "requests" ||
    widgetKey === "shortcuts"
  ) {
    return true;
  }
  if (widgetKey === "tasks") {
    return (
      session.moduleGroups.includes("tien-ich") ||
      session.modules.includes("todo")
    );
  }
  if (widgetKey === "meetings") {
    return (
      session.moduleGroups.includes("tien-ich") ||
      session.modules.includes("meetings") ||
      session.permissions.includes("meetings.read")
    );
  }
  return (
    session.moduleGroups.includes("tien-ich") ||
    session.modules.includes("air-conditioner-control")
  );
}

export function availableWorkbenchCatalog(
  session: AppSession,
  definitions: WorkbenchWidgetCatalogItem[] = Object.values(
    WORKBENCH_WIDGET_DEFINITIONS,
  ),
) {
  return definitions
    .filter((definition) => canUseWorkbenchWidget(session, definition.key))
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export function availableWorkbenchUserCatalog(
  session: AppSession,
  serviceOptions: WorkbenchServiceOption[],
  definitions: WorkbenchWidgetCatalogItem[] = Object.values(
    WORKBENCH_WIDGET_DEFINITIONS,
  ),
  requestDefinitions: WorkbenchWidgetCatalogItem[] = [],
) {
  const allowedServiceCodes = new Set(
    serviceOptions.map((service) => service.value),
  );
  return [
    ...availableWorkbenchCatalog(session, definitions).filter(
      (definition) => definition.key !== "requests",
    ),
    ...requestDefinitions.filter(
      (definition) =>
        canUseWorkbenchWidget(session, definition.key) &&
        Boolean(
          definition.presetSettings?.serviceCode &&
            allowedServiceCodes.has(definition.presetSettings.serviceCode),
        ),
    ),
  ].sort((a, b) => a.sortOrder - b.sortOrder);
}

export function defaultWorkbenchLayout(
  session: AppSession,
  definitions: WorkbenchWidgetCatalogItem[] = Object.values(
    WORKBENCH_WIDGET_DEFINITIONS,
  ),
) {
  return availableWorkbenchCatalog(session, definitions)
    .filter((definition) => definition.defaultVisible)
    .map(
      (definition): WorkbenchWidgetLayout => ({
        color: definition.defaultColor,
        height: definition.defaultHeight,
        id: `default-${definition.catalogKey || definition.key}`,
        settings:
          definition.presetSettings
            ? { ...definition.presetSettings }
            : definition.key === "shortcuts"
              ? { moduleKeys: [] }
              : {},
        title: definition.label,
        widgetKey: definition.key,
        width: definition.defaultWidth,
        x: definition.defaultX,
        y: definition.defaultY,
      }),
    );
}
