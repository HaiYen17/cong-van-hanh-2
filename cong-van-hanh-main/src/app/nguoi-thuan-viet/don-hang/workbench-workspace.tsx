"use client";

import Link from "next/link";
import {
  Check,
  Clock3,
  ExternalLink,
  Grip,
  LayoutGrid,
  Minus,
  Paintbrush,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  RotateCcw,
  Save,
  Settings2,
  Snowflake,
  Trash2,
  X,
} from "lucide-react";
import {
  useMemo,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { Button } from "@/components/ui";
import { useToast, WriteLoadingOverlay } from "@/components/ui/toast";
import type {
  AirConditionerDeviceView,
  AirControlSnapshot,
} from "@/lib/air-control/runtime";
import { ModuleIcon } from "@/lib/module-icons";
import {
  WORKBENCH_COLUMNS,
  WORKBENCH_ROWS,
  type WorkbenchInitialState,
  type WorkbenchActivityItem,
  type WorkbenchWidgetCatalogItem,
  type WorkbenchWidgetLayout,
  type WorkbenchWidgetSettings,
  type WorkbenchWidgetTone,
} from "@/lib/workbench/types";

import {
  refreshWorkbenchActivityAction,
  resetWorkbenchLayoutAction,
  saveWorkbenchLayoutAction,
} from "./actions";
import styles from "./workbench.module.css";

const TONES: Array<{ label: string; value: WorkbenchWidgetTone }> = [
  { label: "Xanh đậm", value: "teal" },
  { label: "Cam nhạt", value: "amber" },
  { label: "Cam đỏ", value: "coral" },
  { label: "Xanh trời", value: "blue" },
  { label: "Tím", value: "violet" },
  { label: "Xám", value: "slate" },
];

type AirCommand =
  | { command: "power_off" | "power_on" }
  | { command: "set_temperature"; temperature: number };

type Interaction = {
  id: string;
  mode: "move" | "resize";
  origin: WorkbenchWidgetLayout;
  startX: number;
  startY: number;
  widgets: WorkbenchWidgetLayout[];
};

function cloneWidgets(
  widgets: WorkbenchWidgetLayout[],
): WorkbenchWidgetLayout[] {
  return widgets.map((widget) => {
    const settings: WorkbenchWidgetSettings = {
      ...widget.settings,
      ...(widget.settings.moduleKeys
        ? { moduleKeys: [...widget.settings.moduleKeys] }
        : {}),
      ...(widget.settings.stageKeys
        ? { stageKeys: [...widget.settings.stageKeys] }
        : {}),
    };
    return { ...widget, settings };
  });
}

function overlaps(a: WorkbenchWidgetLayout, b: WorkbenchWidgetLayout) {
  return !(
    a.x + a.width <= b.x ||
    b.x + b.width <= a.x ||
    a.y + a.height <= b.y ||
    b.y + b.height <= a.y
  );
}

function canPlace(
  candidate: WorkbenchWidgetLayout,
  widgets: WorkbenchWidgetLayout[],
) {
  return (
    candidate.x >= 0 &&
    candidate.y >= 0 &&
    candidate.x + candidate.width <= WORKBENCH_COLUMNS &&
    candidate.y + candidate.height <= WORKBENCH_ROWS &&
    !widgets.some(
      (widget) => widget.id !== candidate.id && overlaps(widget, candidate),
    )
  );
}

function findFreePosition(
  width: number,
  height: number,
  widgets: WorkbenchWidgetLayout[],
) {
  for (let y = 0; y <= WORKBENCH_ROWS - height; y += 1) {
    for (let x = 0; x <= WORKBENCH_COLUMNS - width; x += 1) {
      const candidate = {
        height,
        id: "candidate",
        width,
        x,
        y,
      } as WorkbenchWidgetLayout;
      if (!widgets.some((widget) => overlaps(widget, candidate))) {
        return { x, y };
      }
    }
  }
  return null;
}

function dateTime(value: string) {
  if (!value) return "Chưa đặt hạn";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(date);
}

function meetingTime(value: string) {
  const date = new Date(value);
  return {
    day: new Intl.DateTimeFormat("vi-VN", {
      day: "2-digit",
      month: "2-digit",
      timeZone: "Asia/Ho_Chi_Minh",
      weekday: "short",
    }).format(date),
    time: new Intl.DateTimeFormat("vi-VN", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Ho_Chi_Minh",
    }).format(date),
  };
}

function isClosedStage(stage: string) {
  const normalized = stage
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase();
  return normalized.includes("hoan thanh") || normalized.includes("huy don");
}

function catalogItemKey(definition: WorkbenchWidgetCatalogItem) {
  return definition.catalogKey || definition.key;
}

function widgetCatalogKey(widget: WorkbenchWidgetLayout) {
  if (widget.widgetKey === "requests" && widget.settings.serviceCode) {
    return `requests:${widget.settings.serviceCode}`;
  }
  return widget.widgetKey;
}

function WidgetEmpty({ children }: { children: string }) {
  return (
    <div className={styles.emptyState}>
      <LayoutGrid aria-hidden="true" size={26} />
      <span>{children}</span>
    </div>
  );
}

const ACTIVITY_SOURCE_LABELS: Record<WorkbenchActivityItem["sourceKey"], string> = {
  meetings: "Lịch họp",
  requests: "Đơn",
  tasks: "Giao việc",
};

function ActivityWidget({
  activity,
  refreshing,
  onRefresh,
}: {
  activity: WorkbenchActivityItem[];
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const rows = activity.slice(0, 16);
  return (
    <div className={styles.list}>
      <div className={styles.summaryLine}>
        <strong>{activity.length}</strong>
        <span>đầu việc đang cần chú ý</span>
        <button disabled={refreshing} onClick={onRefresh} type="button">
          <RefreshCw className={refreshing ? "animate-spin" : ""} size={13} />
          Làm mới
        </button>
      </div>
      {rows.map((item) => (
        <Link
          className={styles.listItem}
          href={item.href || "/nguoi-thuan-viet/don-hang"}
          key={item.id}
        >
          <span className={styles.sourcePill} data-source={item.sourceKey}>
            {ACTIVITY_SOURCE_LABELS[item.sourceKey]}
          </span>
          <span className={styles.itemMain}>
            <span className={styles.itemTitle}>{item.title}</span>
            <span className={styles.itemMeta}>{item.summary || item.status}</span>
          </span>
          <span className={item.dueAt ? styles.duePill : styles.statusPill}>
            {item.dueAt ? (
              <>
                <Clock3 size={12} /> {dateTime(item.dueAt)}
              </>
            ) : (
              item.status
            )}
          </span>
        </Link>
      ))}
      {!refreshing && !rows.length ? (
        <WidgetEmpty>Chưa có công việc mở trong chỉ mục của bạn.</WidgetEmpty>
      ) : null}
      {refreshing && !rows.length ? (
        <div className={styles.indexingLine}>
          <RefreshCw className="animate-spin" size={16} /> Đang gom công việc từ các module…
        </div>
      ) : null}
    </div>
  );
}

function RequestsWidget({
  initialState,
  widget,
}: {
  initialState: WorkbenchInitialState;
  widget: WorkbenchWidgetLayout;
}) {
  const serviceCode = widget.settings.serviceCode || "all";
  const selectedStageKeys = widget.settings.stageKeys || [];
  const filtered = initialState.data.requests.filter(
    (request) =>
      request.serviceCode === serviceCode &&
      (!selectedStageKeys.length ||
        request.filterKeys.some((key) => selectedStageKeys.includes(key))),
  );
  const active = filtered.filter((request) => !isClosedStage(request.stage));
  const rows = (active.length ? active : filtered).slice(0, 12);
  const service = initialState.data.serviceOptions.find(
    (option) => option.value === serviceCode,
  );
  return (
    <div className={styles.list}>
      <div className={styles.summaryLine}>
        <strong>{active.length}</strong>
        <span>đơn còn theo dõi</span>
        <Link href={service?.href || "/nguoi-thuan-viet/don-hang/danh-sach"}>
          Mở module <ExternalLink size={13} />
        </Link>
      </div>
      {rows.length ? (
        rows.map((request) => (
          <Link
            className={styles.listItem}
            href={request.href}
            key={request.code}
          >
            <span className={styles.itemMain}>
              <span className={styles.itemTitle}>{request.title}</span>
              <span className={styles.itemMeta}>
                {request.serviceName} · {request.code}
              </span>
            </span>
            <span className={styles.statusPill}>{request.displayStage}</span>
          </Link>
        ))
      ) : (
        <WidgetEmpty>Module này chưa có đơn cần theo dõi.</WidgetEmpty>
      )}
    </div>
  );
}

function TasksWidget({ initialState }: { initialState: WorkbenchInitialState }) {
  const rows = initialState.data.tasks.slice(0, 12);
  if (!rows.length) {
    return <WidgetEmpty>Không có việc mở đang chờ bạn.</WidgetEmpty>;
  }
  return (
    <div className={styles.list}>
      <div className={styles.summaryLine}>
        <strong>{initialState.data.tasks.length}</strong>
        <span>việc đang mở</span>
        <Link href="/nguoi-thuan-viet/giao-viec">
          Mở Giao việc <ExternalLink size={13} />
        </Link>
      </div>
      {rows.map((task) => (
        <Link className={styles.listItem} href={task.href} key={task.id}>
          <span className={styles.itemMain}>
            <span className={styles.itemTitle}>{task.description}</span>
            <span className={styles.itemMeta}>
              {task.title} · {task.code}
            </span>
          </span>
          <span className={styles.duePill}>
            <Clock3 size={12} /> {dateTime(task.dueAt)}
          </span>
        </Link>
      ))}
    </div>
  );
}

function MeetingsWidget({ initialState }: { initialState: WorkbenchInitialState }) {
  const rows = initialState.data.meetings.slice(0, 10);
  if (!rows.length) {
    return <WidgetEmpty>Chưa có cuộc họp nào sắp tới.</WidgetEmpty>;
  }
  return (
    <div className={styles.list}>
      <div className={styles.summaryLine}>
        <strong>{initialState.data.meetings.length}</strong>
        <span>lịch sắp tới</span>
        <Link href="/nguoi-thuan-viet/lich-hop">
          Mở lịch <ExternalLink size={13} />
        </Link>
      </div>
      {rows.map((meeting) => {
        const startsAt = meetingTime(meeting.startsAt);
        return (
          <Link className={styles.meetingItem} href={meeting.href} key={meeting.id}>
            <span className={styles.meetingDate}>
              <strong>{startsAt.time}</strong>
              <small>{startsAt.day}</small>
            </span>
            <span className={styles.itemMain}>
              <span className={styles.itemTitle}>{meeting.title}</span>
              <span className={styles.itemMeta}>
                {meeting.roomLabel || "Chưa có địa điểm"}
              </span>
            </span>
          </Link>
        );
      })}
    </div>
  );
}

function AirControlWidget({
  busy,
  onCommand,
  onRefresh,
  snapshot,
  widget,
}: {
  busy: boolean;
  onCommand: (device: AirConditionerDeviceView, input: AirCommand) => void;
  onRefresh: () => void;
  snapshot: AirControlSnapshot | null;
  widget: WorkbenchWidgetLayout;
}) {
  if (!snapshot) {
    return <WidgetEmpty>Máy lạnh chưa sẵn sàng hoặc bạn chưa có quyền.</WidgetEmpty>;
  }
  const device =
    snapshot.devices.find((item) => item.id === widget.settings.deviceId) ||
    snapshot.devices[0];
  if (!device) {
    return <WidgetEmpty>Chưa có máy lạnh nào được cấu hình.</WidgetEmpty>;
  }
  const canControl = snapshot.mode === "live" && device.online && !busy;
  const canChangeTemperature =
    canControl &&
    device.capabilities.temperature &&
    device.temperature !== null &&
    device.minTemperature !== null &&
    device.maxTemperature !== null;
  return (
    <div className={styles.airControl}>
      <div className={styles.airHeading}>
        <span className={styles.airIcon}>
          <Snowflake size={22} />
        </span>
        <span>
          <strong>{device.name}</strong>
          <small>{device.location || "Chưa gán vị trí"}</small>
        </span>
        <button
          aria-label="Làm mới trạng thái máy lạnh"
          className={styles.miniIconButton}
          disabled={busy}
          onClick={onRefresh}
          type="button"
        >
          <RefreshCw className={busy ? "animate-spin" : ""} size={15} />
        </button>
      </div>
      <div className={styles.airStatus}>
        <span className={device.online ? styles.onlineDot : styles.offlineDot} />
        {device.online ? (device.powerOn ? "Đang bật" : "Đang tắt") : "Ngoại tuyến"}
      </div>
      <div className={styles.temperatureControl}>
        <button
          aria-label="Giảm nhiệt độ"
          disabled={
            !canChangeTemperature ||
            device.temperature === device.minTemperature
          }
          onClick={() =>
            onCommand(device, {
              command: "set_temperature",
              temperature: (device.temperature || 24) - 1,
            })
          }
          type="button"
        >
          <Minus size={18} />
        </button>
        <span>
          <strong>{device.temperature ?? "--"}</strong>
          <small>°C</small>
        </span>
        <button
          aria-label="Tăng nhiệt độ"
          disabled={
            !canChangeTemperature ||
            device.temperature === device.maxTemperature
          }
          onClick={() =>
            onCommand(device, {
              command: "set_temperature",
              temperature: (device.temperature || 24) + 1,
            })
          }
          type="button"
        >
          <Plus size={18} />
        </button>
      </div>
      <button
        className={device.powerOn ? styles.powerOff : styles.powerOn}
        disabled={!canControl}
        onClick={() =>
          onCommand(device, {
            command: device.powerOn ? "power_off" : "power_on",
          })
        }
        type="button"
      >
        <Power size={16} /> {device.powerOn ? "Tắt máy" : "Bật máy"}
      </button>
      {snapshot.mode !== "live" ? (
        <p className={styles.airWarning}>Đang hiển thị dữ liệu mẫu, chưa gửi lệnh thật.</p>
      ) : null}
    </div>
  );
}

function ShortcutsWidget({
  initialState,
  widget,
}: {
  initialState: WorkbenchInitialState;
  widget: WorkbenchWidgetLayout;
}) {
  const selectedKeys = widget.settings.moduleKeys || [];
  const selected = selectedKeys.length
    ? initialState.data.shortcuts.filter((item) => selectedKeys.includes(item.key))
    : initialState.data.shortcuts.slice(0, 6);
  if (!selected.length) {
    return <WidgetEmpty>Chọn module muốn ghim trong chế độ chỉnh sửa.</WidgetEmpty>;
  }
  return (
    <div className={styles.shortcutGrid}>
      {selected.map((item) => (
        <Link href={item.href} key={item.key}>
          <span>
            <ModuleIcon name={item.icon} />
          </span>
          <strong>{item.label}</strong>
        </Link>
      ))}
    </div>
  );
}

function WidgetBody({
  activity,
  activityBusy,
  airBusy,
  airSnapshot,
  initialState,
  onAirCommand,
  onAirRefresh,
  onActivityRefresh,
  widget,
}: {
  activity: WorkbenchActivityItem[];
  activityBusy: boolean;
  airBusy: boolean;
  airSnapshot: AirControlSnapshot | null;
  initialState: WorkbenchInitialState;
  onAirCommand: (device: AirConditionerDeviceView, input: AirCommand) => void;
  onAirRefresh: () => void;
  onActivityRefresh: () => void;
  widget: WorkbenchWidgetLayout;
}) {
  if (widget.widgetKey === "activity") {
    return (
      <ActivityWidget
        activity={activity}
        onRefresh={onActivityRefresh}
        refreshing={activityBusy}
      />
    );
  }
  if (widget.widgetKey === "requests") {
    return <RequestsWidget initialState={initialState} widget={widget} />;
  }
  if (widget.widgetKey === "tasks") {
    return <TasksWidget initialState={initialState} />;
  }
  if (widget.widgetKey === "meetings") {
    return <MeetingsWidget initialState={initialState} />;
  }
  if (widget.widgetKey === "air-control") {
    return (
      <AirControlWidget
        busy={airBusy}
        onCommand={onAirCommand}
        onRefresh={onAirRefresh}
        snapshot={airSnapshot}
        widget={widget}
      />
    );
  }
  return <ShortcutsWidget initialState={initialState} widget={widget} />;
}

export function WorkbenchWorkspace({
  initialState,
}: {
  initialState: WorkbenchInitialState;
}) {
  const { toast } = useToast();
  const gridRef = useRef<HTMLDivElement>(null);
  const savedWidgetsRef = useRef(cloneWidgets(initialState.widgets));
  const interactionRef = useRef<Interaction | null>(null);
  const [widgets, setWidgets] = useState(() => cloneWidgets(initialState.widgets));
  const [selectedId, setSelectedId] = useState(initialState.widgets[0]?.id || "");
  const [isEditing, setIsEditing] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [busyMessage, setBusyMessage] = useState("");
  const [hasSavedLayout, setHasSavedLayout] = useState(initialState.hasSavedLayout);
  const [airSnapshot, setAirSnapshot] = useState(initialState.data.airSnapshot);
  const [airBusy, setAirBusy] = useState(false);
  const [activity, setActivity] = useState(initialState.data.activity);
  const [activityBusy, setActivityBusy] = useState(true);
  const selectedWidget = widgets.find((widget) => widget.id === selectedId) || null;
  const catalogMap = useMemo(
    () =>
      new Map(
        initialState.catalog.map((item) => [catalogItemKey(item), item]),
      ),
    [initialState.catalog],
  );
  const rendererMap = useMemo(
    () =>
      new Map(
        initialState.catalog.map((item) => [item.key, item] as const),
      ),
    [initialState.catalog],
  );

  function definitionForWidget(widget: WorkbenchWidgetLayout) {
    return (
      catalogMap.get(widgetCatalogKey(widget)) || rendererMap.get(widget.widgetKey)
    );
  }

  async function refreshActivity({ quiet = false }: { quiet?: boolean } = {}) {
    setActivityBusy(true);
    const result = await refreshWorkbenchActivityAction();
    setActivityBusy(false);
    if (!result.ok) {
      if (!quiet) {
        toast({ message: result.message, title: "Không làm mới được", tone: "error" });
      }
      return;
    }
    setActivity(result.data.activity);
    if (result.data.warnings.length) {
      toast({
        message: result.data.warnings.join(" · "),
        title: "Một số nguồn cần kiểm tra",
        tone: "warning",
      });
    } else if (!quiet) {
      toast({ title: result.message, tone: "success" });
    }
  }

  useEffect(() => {
    let cancelled = false;
    void refreshWorkbenchActivityAction().then((result) => {
      if (cancelled) return;
      setActivityBusy(false);
      if (!result.ok) return;
      setActivity(result.data.activity);
      if (result.data.warnings.length) {
        toast({
          message: result.data.warnings.join(" · "),
          title: "Một số nguồn cần kiểm tra",
          tone: "warning",
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [toast]);

  function updateWidget(
    id: string,
    update: Partial<WorkbenchWidgetLayout> & {
      settings?: WorkbenchWidgetSettings;
    },
  ) {
    setWidgets((current) =>
      current.map((widget) =>
        widget.id === id ? { ...widget, ...update } : widget,
      ),
    );
  }

  function removeWidget(id: string) {
    setWidgets((current) => current.filter((widget) => widget.id !== id));
    if (selectedId === id) setSelectedId("");
  }

  function addWidget(definition: WorkbenchWidgetCatalogItem) {
    const definitionCatalogKey = catalogItemKey(definition);
    if (
      (definition.key === "requests" || !definition.allowMultiple) &&
      widgets.some((widget) =>
        definition.key === "requests"
          ? widgetCatalogKey(widget) === definitionCatalogKey
          : widget.widgetKey === definition.key,
      )
    ) {
      toast({
        title: `${definition.label} đã có trên bàn`,
        tone: "warning",
      });
      return;
    }
    const position = findFreePosition(
      definition.defaultWidth,
      definition.defaultHeight,
      widgets,
    );
    if (!position) {
      toast({
        message: "Hãy thu nhỏ hoặc xóa bớt widget rồi thử lại.",
        title: "Không còn vùng trống phù hợp",
        tone: "warning",
      });
      return;
    }
    const settings: WorkbenchWidgetSettings = {
      ...(definition.presetSettings || {}),
      ...(definition.presetSettings?.stageKeys
        ? { stageKeys: [...definition.presetSettings.stageKeys] }
        : {}),
    };
    if (definition.key === "air-control") {
      settings.deviceId = airSnapshot?.devices[0]?.id;
    }
    if (definition.key === "shortcuts") {
      settings.moduleKeys = initialState.data.shortcuts
        .slice(0, 4)
        .map((item) => item.key);
    }
    const widget: WorkbenchWidgetLayout = {
      color: definition.defaultColor,
      height: definition.defaultHeight,
      id: `widget-${crypto.randomUUID()}`,
      settings,
      title: definition.label,
      widgetKey: definition.key,
      width: definition.defaultWidth,
      ...position,
    };
    setWidgets((current) => [...current, widget]);
    setSelectedId(widget.id);
    toast({ title: `Đã thêm ${definition.label}`, tone: "success" });
  }

  function beginInteraction(
    event: ReactPointerEvent<HTMLElement>,
    widget: WorkbenchWidgetLayout,
    mode: "move" | "resize",
  ) {
    if (!isEditing || !gridRef.current) return;
    const target = event.target as HTMLElement;
    if (
      mode === "move" &&
      target.closest("button, a, input, select, [data-no-drag]")
    ) {
      return;
    }
    event.preventDefault();
    setSelectedId(widget.id);
    const startWidgets = cloneWidgets(widgets);
    interactionRef.current = {
      id: widget.id,
      mode,
      origin: { ...widget, settings: { ...widget.settings } },
      startX: event.clientX,
      startY: event.clientY,
      widgets: startWidgets,
    };

    const onMove = (pointerEvent: PointerEvent) => {
      const interaction = interactionRef.current;
      const grid = gridRef.current;
      if (!interaction || !grid) return;
      const rect = grid.getBoundingClientRect();
      const style = window.getComputedStyle(grid);
      const gap = Number.parseFloat(style.columnGap || "0") || 0;
      const rowGap = Number.parseFloat(style.rowGap || "0") || gap;
      const columnWidth =
        Number.parseFloat(style.gridTemplateColumns.split(" ")[0] || "0") ||
        (rect.width - gap * (WORKBENCH_COLUMNS - 1)) / WORKBENCH_COLUMNS;
      const rowHeight =
        Number.parseFloat(style.gridTemplateRows.split(" ")[0] || "0") || 72;
      const stepX = columnWidth + gap;
      const stepY = rowHeight + rowGap;
      const deltaX = Math.round((pointerEvent.clientX - interaction.startX) / stepX);
      const deltaY = Math.round((pointerEvent.clientY - interaction.startY) / stepY);
      const definition = definitionForWidget(interaction.origin);
      if (!definition) return;
      const candidate = { ...interaction.origin };
      if (interaction.mode === "move") {
        candidate.x = Math.max(
          0,
          Math.min(
            WORKBENCH_COLUMNS - candidate.width,
            interaction.origin.x + deltaX,
          ),
        );
        candidate.y = Math.max(
          0,
          Math.min(
            WORKBENCH_ROWS - candidate.height,
            interaction.origin.y + deltaY,
          ),
        );
      } else {
        candidate.width = Math.max(
          definition.minWidth,
          Math.min(
            definition.maxWidth,
            WORKBENCH_COLUMNS - candidate.x,
            interaction.origin.width + deltaX,
          ),
        );
        candidate.height = Math.max(
          definition.minHeight,
          Math.min(
            definition.maxHeight,
            WORKBENCH_ROWS - candidate.y,
            interaction.origin.height + deltaY,
          ),
        );
      }
      if (!canPlace(candidate, interaction.widgets)) return;
      setWidgets(
        interaction.widgets.map((item) =>
          item.id === candidate.id ? candidate : item,
        ),
      );
    };
    const onUp = () => {
      interactionRef.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }

  function resizeSelected(widthDelta: number, heightDelta: number) {
    if (!selectedWidget) return;
    const definition = definitionForWidget(selectedWidget);
    if (!definition) return;
    const candidate = {
      ...selectedWidget,
      height: Math.max(
        definition.minHeight,
        Math.min(
          definition.maxHeight,
          WORKBENCH_ROWS - selectedWidget.y,
          selectedWidget.height + heightDelta,
        ),
      ),
      width: Math.max(
        definition.minWidth,
        Math.min(
          definition.maxWidth,
          WORKBENCH_COLUMNS - selectedWidget.x,
          selectedWidget.width + widthDelta,
        ),
      ),
    };
    if (!canPlace(candidate, widgets)) {
      toast({ title: "Kích thước này đang chạm widget khác", tone: "warning" });
      return;
    }
    updateWidget(candidate.id, candidate);
  }

  async function saveLayout() {
    setBusyMessage("Đang lưu bố cục Bàn làm việc của bạn...");
    const result = await saveWorkbenchLayoutAction({ widgets });
    setBusyMessage("");
    if (result.error) {
      toast({ message: result.error, title: "Không lưu được bố cục", tone: "error" });
      return;
    }
    const saved = result.widgets || widgets;
    setWidgets(cloneWidgets(saved));
    savedWidgetsRef.current = cloneWidgets(saved);
    setHasSavedLayout(true);
    setIsEditing(false);
    setDrawerOpen(false);
    toast({ title: result.success || "Đã lưu bố cục", tone: "success" });
  }

  function cancelEditing() {
    setWidgets(cloneWidgets(savedWidgetsRef.current));
    setIsEditing(false);
    setDrawerOpen(false);
  }

  async function resetLayout() {
    if (!window.confirm("Khôi phục bố cục mặc định và bỏ bố cục đã lưu?")) return;
    setBusyMessage("Đang khôi phục bố cục mặc định...");
    const result = await resetWorkbenchLayoutAction();
    setBusyMessage("");
    if (result.error) {
      toast({ message: result.error, title: "Không thể khôi phục", tone: "error" });
      return;
    }
    const restored = result.widgets || [];
    setWidgets(cloneWidgets(restored));
    savedWidgetsRef.current = cloneWidgets(restored);
    setSelectedId(restored[0]?.id || "");
    setHasSavedLayout(false);
    toast({ title: result.success || "Đã khôi phục bố cục", tone: "success" });
  }

  async function refreshAir() {
    setAirBusy(true);
    try {
      const response = await fetch("/api/air-conditioners", { cache: "no-store" });
      const payload = (await response.json()) as {
        message?: string;
        ok: boolean;
        result?: AirControlSnapshot;
      };
      if (!response.ok || !payload.ok || !payload.result) {
        throw new Error(payload.message || "Không tải được trạng thái máy lạnh.");
      }
      setAirSnapshot(payload.result);
      toast({ title: "Đã làm mới máy lạnh", tone: "success" });
    } catch (error) {
      toast({
        message: error instanceof Error ? error.message : undefined,
        title: "Không tải được máy lạnh",
        tone: "error",
      });
    } finally {
      setAirBusy(false);
    }
  }

  async function sendAirCommand(
    device: AirConditionerDeviceView,
    input: AirCommand,
  ) {
    setAirBusy(true);
    setBusyMessage(
      input.command === "set_temperature"
        ? `Đang đặt ${device.name} ở ${input.temperature}°C...`
        : `Đang ${input.command === "power_on" ? "bật" : "tắt"} ${device.name}...`,
    );
    try {
      const response = await fetch("/api/air-conditioners", {
        body: JSON.stringify({
          ...input,
          deviceId: device.id,
          requestId: `air-${crypto.randomUUID()}`,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const payload = (await response.json()) as {
        message?: string;
        ok: boolean;
        result?: { device?: AirConditionerDeviceView; message?: string };
      };
      if (!response.ok || !payload.ok || !payload.result?.device) {
        throw new Error(payload.message || "Không điều khiển được máy lạnh.");
      }
      setAirSnapshot((current) =>
        current
          ? {
              ...current,
              devices: current.devices.map((item) =>
                item.id === payload.result?.device?.id
                  ? payload.result.device
                  : item,
              ) as AirConditionerDeviceView[],
              generatedAt: new Date().toISOString(),
            }
          : current,
      );
      toast({
        message: payload.result.message,
        title: "Điều khiển máy lạnh",
        tone: "success",
      });
    } catch (error) {
      toast({
        message: error instanceof Error ? error.message : undefined,
        title: "Không điều khiển được",
        tone: "error",
      });
    } finally {
      setBusyMessage("");
      setAirBusy(false);
    }
  }

  function toggleShortcut(moduleKey: string) {
    if (!selectedWidget) return;
    const current = selectedWidget.settings.moduleKeys || [];
    const moduleKeys = current.includes(moduleKey)
      ? current.filter((key) => key !== moduleKey)
      : [...current, moduleKey].slice(0, 12);
    updateWidget(selectedWidget.id, {
      settings: { ...selectedWidget.settings, moduleKeys },
    });
  }

  function toggleRequestStage(stageKey: string) {
    if (!selectedWidget || selectedWidget.widgetKey !== "requests") return;
    const current = selectedWidget.settings.stageKeys || [];
    const stageKeys = current.includes(stageKey)
      ? current.filter((key) => key !== stageKey)
      : [...current, stageKey];
    updateWidget(selectedWidget.id, {
      settings: { ...selectedWidget.settings, stageKeys },
    });
  }

  return (
    <>
      <WriteLoadingOverlay message={busyMessage} show={Boolean(busyMessage)} />

      <div className={styles.moduleActions}>
        <div className={styles.heroActions}>
          {isEditing ? (
            <>
              <Button onClick={() => setDrawerOpen(true)} size="sm" variant="secondary">
                <Plus size={16} /> Kho widget
              </Button>
              <Button onClick={() => void resetLayout()} size="sm" variant="ghost">
                <RotateCcw size={16} /> Mặc định
              </Button>
              <Button onClick={cancelEditing} size="sm" variant="secondary">
                <X size={16} /> Hủy
              </Button>
              <Button onClick={() => void saveLayout()} size="sm">
                <Save size={16} /> Lưu bàn làm việc
              </Button>
            </>
          ) : (
            <>
              <Link
                className={styles.fullListLink}
                href="/nguoi-thuan-viet/don-hang/danh-sach"
              >
                Danh sách đơn đầy đủ <ExternalLink size={15} />
              </Link>
              <button
                aria-label="Chỉnh sửa Bàn làm việc"
                className={styles.editButton}
                onClick={() => {
                  setIsEditing(true);
                  setDrawerOpen(false);
                }}
                title="Chỉnh sửa Bàn làm việc"
                type="button"
              >
                <Pencil size={20} />
              </button>
            </>
          )}
        </div>
      </div>

      <section className={styles.workbenchToolbar}>
        <span className={isEditing ? styles.editingStatus : styles.viewStatus}>
          {isEditing ? <Paintbrush size={15} /> : <Check size={15} />}
          {isEditing
            ? "Đang chỉnh sửa · Kéo tiêu đề để di chuyển, kéo góc để đổi kích thước"
            : hasSavedLayout
              ? "Bố cục cá nhân đã được lưu"
              : "Đang dùng bố cục gợi ý"}
        </span>
        <span className={styles.gridLabel}>Lưới {WORKBENCH_COLUMNS} × {WORKBENCH_ROWS}</span>
      </section>

      <div
        className={`${styles.grid} ${isEditing ? styles.gridEditing : ""}`}
        ref={gridRef}
      >
        {isEditing ? (
          <div aria-hidden="true" className={styles.gridGuide}>
            {Array.from({ length: WORKBENCH_COLUMNS * WORKBENCH_ROWS }).map(
              (_, index) => (
                <span key={index} />
              ),
            )}
          </div>
        ) : null}
        {widgets.map((widget) => {
          const definition = definitionForWidget(widget);
          if (!definition) return null;
          return (
            <article
              className={`${styles.widget} ${styles[`tone_${widget.color}`]} ${
                selectedId === widget.id && isEditing ? styles.widgetSelected : ""
              }`}
              key={widget.id}
              onClick={() => isEditing && setSelectedId(widget.id)}
              style={{
                gridColumn: `${widget.x + 1} / span ${widget.width}`,
                gridRow: `${widget.y + 1} / span ${widget.height}`,
              }}
            >
              <header
                className={styles.widgetHeader}
                onPointerDown={(event) => beginInteraction(event, widget, "move")}
              >
                <span className={styles.widgetIcon}>
                  <ModuleIcon name={definition.icon} />
                </span>
                <span className={styles.widgetTitle}>
                  <strong>{widget.title}</strong>
                  {isEditing ? (
                    <small>
                      {widget.width} × {widget.height} ô
                    </small>
                  ) : null}
                </span>
                {isEditing ? (
                  <span className={styles.widgetEditActions} data-no-drag>
                    <button
                      aria-label={`Cấu hình ${widget.title}`}
                      onClick={() => {
                        setSelectedId(widget.id);
                        setDrawerOpen(true);
                      }}
                      type="button"
                    >
                      <Settings2 size={15} />
                    </button>
                    <button
                      aria-label={`Xóa ${widget.title}`}
                      onClick={() => removeWidget(widget.id)}
                      type="button"
                    >
                      <Trash2 size={15} />
                    </button>
                    <Grip className={styles.grip} size={17} />
                  </span>
                ) : null}
              </header>
              <div className={styles.widgetBody}>
                <WidgetBody
                  activity={activity}
                  activityBusy={activityBusy}
                  airBusy={airBusy}
                  airSnapshot={airSnapshot}
                  initialState={initialState}
                  onAirCommand={(device, input) =>
                    void sendAirCommand(device, input)
                  }
                  onAirRefresh={() => void refreshAir()}
                  onActivityRefresh={() => void refreshActivity()}
                  widget={widget}
                />
              </div>
              {isEditing ? (
                <button
                  aria-label={`Đổi kích thước ${widget.title}`}
                  className={styles.resizeHandle}
                  onPointerDown={(event) => beginInteraction(event, widget, "resize")}
                  type="button"
                />
              ) : null}
            </article>
          );
        })}
        {!widgets.length ? (
          <div className={styles.emptyWorkbench}>
            <LayoutGrid size={38} />
            <strong>Bàn làm việc đang trống</strong>
            <span>Mở Kho widget để thêm công việc và tiện ích.</span>
            {isEditing ? (
              <Button onClick={() => setDrawerOpen(true)} size="sm">
                <Plus size={16} /> Mở Kho widget
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {isEditing && drawerOpen ? (
        <>
          <button
            aria-label="Đóng Kho widget"
            className={styles.drawerBackdrop}
            onClick={() => setDrawerOpen(false)}
            type="button"
          />
          <aside className={styles.drawer}>
            <header className={styles.drawerHeader}>
              <span>
                <strong>Kho widget</strong>
                <small>Chọn và tùy chỉnh khối công việc</small>
              </span>
              <button
                aria-label="Đóng Kho widget"
                onClick={() => setDrawerOpen(false)}
                type="button"
              >
                <X size={18} />
              </button>
            </header>

            <div className={styles.drawerScroll}>
              <section className={styles.catalogSection}>
                <h2>Thêm vào bàn</h2>
                <div className={styles.catalogList}>
                  {initialState.catalog.map((definition) => {
                    const alreadyAdded =
                      (definition.key === "requests" || !definition.allowMultiple) &&
                      widgets.some((item) =>
                        definition.key === "requests"
                          ? widgetCatalogKey(item) === catalogItemKey(definition)
                          : item.widgetKey === definition.key,
                      );
                    return (
                      <button
                        disabled={alreadyAdded}
                        key={catalogItemKey(definition)}
                        onClick={() => addWidget(definition)}
                        type="button"
                      >
                        <span>
                          <ModuleIcon name={definition.icon} />
                        </span>
                        <span>
                          <strong>{definition.label}</strong>
                          <small>{definition.description}</small>
                        </span>
                        {alreadyAdded ? <Check size={17} /> : <Plus size={17} />}
                      </button>
                    );
                  })}
                </div>
              </section>

              {selectedWidget ? (
                <section className={styles.settingsSection}>
                  <div className={styles.settingsHeading}>
                    <span>
                      <Settings2 size={16} />
                    </span>
                    <div>
                      <h2>Tùy chỉnh widget</h2>
                      <p>{definitionForWidget(selectedWidget)?.label}</p>
                    </div>
                  </div>

                  <label className={styles.field}>
                    <span>Tên hiển thị</span>
                    <input
                      maxLength={80}
                      onChange={(event) =>
                        updateWidget(selectedWidget.id, { title: event.target.value })
                      }
                      value={selectedWidget.title}
                    />
                  </label>

                  <div className={styles.field}>
                    <span>Màu nhận diện</span>
                    <div className={styles.tonePicker}>
                      {TONES.map((tone) => (
                        <button
                          aria-label={tone.label}
                          className={`${styles.toneSwatch} ${styles[`swatch_${tone.value}`]} ${
                            selectedWidget.color === tone.value ? styles.toneSelected : ""
                          }`}
                          key={tone.value}
                          onClick={() =>
                            updateWidget(selectedWidget.id, { color: tone.value })
                          }
                          title={tone.label}
                          type="button"
                        >
                          {selectedWidget.color === tone.value ? <Check size={14} /> : null}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className={styles.field}>
                    <span>Kích thước</span>
                    <div className={styles.sizeControls}>
                      <button onClick={() => resizeSelected(-1, 0)} type="button">
                        <Minus size={14} /> Rộng
                      </button>
                      <strong>
                        {selectedWidget.width} × {selectedWidget.height}
                      </strong>
                      <button onClick={() => resizeSelected(1, 0)} type="button">
                        <Plus size={14} /> Rộng
                      </button>
                      <button onClick={() => resizeSelected(0, -1)} type="button">
                        <Minus size={14} /> Cao
                      </button>
                      <button onClick={() => resizeSelected(0, 1)} type="button">
                        <Plus size={14} /> Cao
                      </button>
                    </div>
                  </div>

                  {selectedWidget.widgetKey === "requests" ? (
                    <>
                      <label className={styles.field}>
                        <span>Module nguồn cố định</span>
                        <input
                          readOnly
                          value={definitionForWidget(selectedWidget)?.label || "Đơn hàng"}
                        />
                      </label>
                      <div className={styles.field}>
                        <span>Bước / trạng thái cần hiển thị</span>
                        <small className={styles.fieldHint}>
                          Không chọn bước nào nghĩa là hiển thị tất cả.
                        </small>
                        <div className={styles.stagePicker}>
                          {(initialState.data.serviceOptions.find(
                            (option) =>
                              option.value === selectedWidget.settings.serviceCode,
                          )?.stageOptions || []).map((option) => {
                            const active = (
                              selectedWidget.settings.stageKeys || []
                            ).includes(option.value);
                            return (
                              <button
                                className={active ? styles.stageActive : ""}
                                key={option.value}
                                onClick={() => toggleRequestStage(option.value)}
                                type="button"
                              >
                                <Clock3 size={14} />
                                <span>{option.label}</span>
                                {active ? <Check size={14} /> : null}
                              </button>
                            );
                          })}
                        </div>
                        {(selectedWidget.settings.stageKeys || []).length ? (
                          <button
                            className={styles.clearStageFilter}
                            onClick={() =>
                              updateWidget(selectedWidget.id, {
                                settings: {
                                  ...selectedWidget.settings,
                                  stageKeys: [],
                                },
                              })
                            }
                            type="button"
                          >
                            Hiển thị lại tất cả bước
                          </button>
                        ) : null}
                      </div>
                    </>
                  ) : null}

                  {selectedWidget.widgetKey === "air-control" ? (
                    <label className={styles.field}>
                      <span>Máy lạnh được ghim</span>
                      <select
                        onChange={(event) =>
                          updateWidget(selectedWidget.id, {
                            settings: {
                              ...selectedWidget.settings,
                              deviceId: event.target.value,
                            },
                          })
                        }
                        value={
                          selectedWidget.settings.deviceId ||
                          airSnapshot?.devices[0]?.id ||
                          ""
                        }
                      >
                        {(airSnapshot?.devices || []).map((device) => (
                          <option key={device.id} value={device.id}>
                            {device.name} · {device.location || "Chưa gán vị trí"}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}

                  {selectedWidget.widgetKey === "shortcuts" ? (
                    <div className={styles.field}>
                      <span>Module được ghim</span>
                      <div className={styles.modulePicker}>
                        {initialState.data.shortcuts.map((item) => {
                          const active = (
                            selectedWidget.settings.moduleKeys || []
                          ).includes(item.key);
                          return (
                            <button
                              className={active ? styles.moduleActive : ""}
                              key={item.key}
                              onClick={() => toggleShortcut(item.key)}
                              type="button"
                            >
                              <ModuleIcon name={item.icon} />
                              <span>{item.label}</span>
                              {active ? <Check size={14} /> : null}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}

                  <button
                    className={styles.deleteWidgetButton}
                    onClick={() => removeWidget(selectedWidget.id)}
                    type="button"
                  >
                    <Trash2 size={16} /> Xóa widget khỏi bàn
                  </button>
                </section>
              ) : (
                <p className={styles.selectHint}>Chọn một widget trên bàn để tùy chỉnh.</p>
              )}
            </div>
          </aside>
        </>
      ) : null}
    </>
  );
}
