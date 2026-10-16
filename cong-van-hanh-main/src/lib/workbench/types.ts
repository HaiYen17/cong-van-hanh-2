export const WORKBENCH_COLUMNS = 16;
export const WORKBENCH_ROWS = 10;

export const WORKBENCH_WIDGET_KEYS = [
  "activity",
  "requests",
  "tasks",
  "meetings",
  "air-control",
  "shortcuts",
] as const;

export type WorkbenchWidgetKey = (typeof WORKBENCH_WIDGET_KEYS)[number];
export const WORKBENCH_SOURCE_KEYS = ["requests", "tasks", "meetings"] as const;
export type WorkbenchSourceKey = (typeof WORKBENCH_SOURCE_KEYS)[number];
export type WorkbenchWidgetTone =
  | "teal"
  | "amber"
  | "coral"
  | "blue"
  | "violet"
  | "slate";

export type WorkbenchWidgetSettings = {
  deviceId?: string;
  moduleKeys?: string[];
  serviceCode?: string;
  stageKeys?: string[];
};

export type WorkbenchWidgetLayout = {
  color: WorkbenchWidgetTone;
  height: number;
  id: string;
  settings: WorkbenchWidgetSettings;
  title: string;
  widgetKey: WorkbenchWidgetKey;
  width: number;
  x: number;
  y: number;
};

export type WorkbenchWidgetCatalogItem = {
  allowMultiple: boolean;
  catalogKey?: string;
  defaultColor: WorkbenchWidgetTone;
  defaultHeight: number;
  defaultWidth: number;
  description: string;
  defaultVisible: boolean;
  defaultX: number;
  defaultY: number;
  icon: string;
  key: WorkbenchWidgetKey;
  label: string;
  maxHeight: number;
  maxWidth: number;
  minHeight: number;
  minWidth: number;
  presetSettings?: WorkbenchWidgetSettings;
  sortOrder: number;
};

export type WorkbenchRequestItem = {
  code: string;
  createdAt: string;
  displayStage: string;
  filterKeys: string[];
  href: string;
  priority: string;
  serviceCode: string;
  serviceName: string;
  stage: string;
  title: string;
  updatedAt: string;
};

export type WorkbenchTaskItem = {
  code: string;
  createdByMe: boolean;
  description: string;
  dueAt: string;
  href: string;
  id: string;
  status: string;
  title: string;
  updatedAt: string;
};

export type WorkbenchMeetingItem = {
  endsAt: string;
  href: string;
  id: string;
  roomLabel: string;
  startsAt: string;
  status: string;
  title: string;
};

export type WorkbenchShortcut = {
  href: string;
  icon: string;
  key: string;
  label: string;
};

export type WorkbenchServiceOption = {
  href: string;
  icon: string;
  label: string;
  moduleKey: string;
  stageOptions: WorkbenchStageOption[];
  value: string;
};

export type WorkbenchStageOption = {
  kind: "stage" | "step";
  label: string;
  value: string;
};

export type WorkbenchData = {
  activity: WorkbenchActivityItem[];
  airSnapshot: import("@/lib/air-control/runtime").AirControlSnapshot | null;
  meetings: WorkbenchMeetingItem[];
  requests: WorkbenchRequestItem[];
  serviceOptions: WorkbenchServiceOption[];
  shortcuts: WorkbenchShortcut[];
  tasks: WorkbenchTaskItem[];
};

export type WorkbenchActivityItem = {
  dueAt: string;
  href: string;
  id: string;
  kind: string;
  moduleKey: string;
  occurredAt: string;
  priority: string;
  sourceKey: WorkbenchSourceKey;
  status: string;
  summary: string;
  title: string;
};

export type WorkbenchSourceConfigView = {
  description: string;
  isEnabled: boolean;
  itemCount: number;
  key: WorkbenchSourceKey;
  label: string;
  lastError: string;
  lastStatus: string;
  lastSyncedAt: string;
  moduleKey: string;
  sortOrder: number;
};

export type WorkbenchWidgetConfigView = WorkbenchWidgetCatalogItem & {
  isEnabled: boolean;
};

export type WorkbenchAdminSnapshot = {
  indexedItems: number;
  indexedUsers: number;
  savedLayouts: number;
  sources: WorkbenchSourceConfigView[];
  widgets: WorkbenchWidgetConfigView[];
};

export type SaveWorkbenchAdminConfigInput = {
  sources: Array<{
    isEnabled: boolean;
    key: WorkbenchSourceKey;
  }>;
  widgets: WorkbenchWidgetConfigView[];
};

export type WorkbenchAdminMutationResult =
  | { message: string; ok: false }
  | { data?: WorkbenchAdminSnapshot; message: string; ok: true };

export type WorkbenchActivityRefreshResult =
  | { message: string; ok: false }
  | {
      data: { activity: WorkbenchActivityItem[]; warnings: string[] };
      message: string;
      ok: true;
    };

export type WorkbenchInitialState = {
  catalog: WorkbenchWidgetCatalogItem[];
  data: WorkbenchData;
  hasSavedLayout: boolean;
  widgets: WorkbenchWidgetLayout[];
};

export type SaveWorkbenchLayoutInput = {
  widgets: WorkbenchWidgetLayout[];
};

export type WorkbenchMutationResult = {
  error?: string;
  success?: string;
  widgets?: WorkbenchWidgetLayout[];
};
