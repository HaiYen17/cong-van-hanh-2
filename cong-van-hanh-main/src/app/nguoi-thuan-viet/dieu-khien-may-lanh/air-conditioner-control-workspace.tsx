"use client";

import {
  Building2,
  ChevronRight,
  DoorOpen,
  Droplets,
  Fan,
  Gauge,
  History,
  Lightbulb,
  Minus,
  MapPin,
  Plus,
  Power,
  RefreshCw,
  Search,
  Snowflake,
  Thermometer,
  Wifi,
  WifiOff,
  Wind,
  X,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Badge, Button } from "@/components/ui";
import { useToast, WriteLoadingOverlay } from "@/components/ui/toast";
import type {
  AirConditionerClimateMode,
  AirConditionerFanLevel,
  AirControlActivityPage,
  AirControlActivityView,
  AirControlSnapshot,
  ElectricalDeviceView,
} from "@/lib/air-control/runtime";
import {
  compareElectricalFloors,
  resolvePreferredElectricalOffice,
} from "@/lib/air-control/office-preference";

type ApiEnvelope<T> = {
  message?: string;
  ok: boolean;
  result?: T;
};

type AirControlCommand =
  | { command: "power_off" | "power_on" }
  | { command: "set_fan"; fanLevel: AirConditionerFanLevel }
  | { command: "set_mode"; climateMode: AirConditionerClimateMode }
  | { command: "set_temperature"; temperature: number };

const FAN_LEVEL_LABELS: Record<AirConditionerFanLevel, string> = {
  auto: "Tự động",
  low: "Thấp",
  medium: "Vừa",
  high: "Cao",
};

const FAN_LEVEL_STRENGTH: Record<AirConditionerFanLevel, number> = {
  auto: 0,
  low: 1,
  medium: 2,
  high: 3,
};

const MODE_LABELS: Record<AirConditionerClimateMode, string> = {
  auto: "Tự động",
  cool: "Làm lạnh",
  dry: "Hút ẩm",
  fan: "Chỉ quạt",
};

const MODE_ICONS = {
  auto: Gauge,
  cool: Snowflake,
  dry: Droplets,
  fan: Wind,
} satisfies Record<AirConditionerClimateMode, typeof Gauge>;

function nextFanLevel(
  levels: AirConditionerFanLevel[],
  current: AirConditionerFanLevel | "",
) {
  if (!levels.length) return null;
  const index = levels.indexOf(current as AirConditionerFanLevel);
  return levels[(index + 1 + levels.length) % levels.length];
}

function FanLevelIndicator({ level }: { level: AirConditionerFanLevel }) {
  if (level === "auto") {
    return (
      <span
        aria-hidden="true"
        className="absolute -bottom-1.5 -right-2 grid size-4 place-items-center rounded bg-white text-[9px] font-black leading-none text-brand-strong shadow-sm"
      >
        A
      </span>
    );
  }

  const strength = FAN_LEVEL_STRENGTH[level];
  return (
    <span
      aria-hidden="true"
      className="absolute -bottom-1.5 -right-2 flex h-4 items-end gap-0.5 rounded bg-surface px-1 py-0.5 shadow-sm"
    >
      {[1, 2, 3].map((bar) => (
        <span
          className={`${bar <= strength ? "bg-brand" : "bg-[#ead7df]"} w-0.5 rounded-full`}
          key={bar}
          style={{ height: `${bar * 3}px` }}
        />
      ))}
    </span>
  );
}

function time(value: string) {
  return new Date(value).toLocaleTimeString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Ho_Chi_Minh",
  });
}

function dateTime(value: string) {
  return new Date(value).toLocaleString("vi-VN", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: "Asia/Ho_Chi_Minh",
  });
}

async function readJson<T>(response: Response): Promise<ApiEnvelope<T>> {
  const payload = (await response.json().catch(() => ({}))) as ApiEnvelope<T>;
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.message || "Không xử lý được yêu cầu.");
  }
  return payload;
}

const UNASSIGNED_LOCATION = "__unassigned__";
const ROOM_KEY_SEPARATOR = "\u001f";

function deviceLocationLabel(device: ElectricalDeviceView) {
  if (!device.placement) return "Chưa phân khu";
  return [
    device.placement.floor,
    device.placement.room,
    device.placement.area,
  ].join(" · ");
}

function uniqueSorted(values: string[]) {
  return [...new Set(values)].sort((left, right) =>
    left.localeCompare(right, "vi", { numeric: true }),
  );
}

function roomKey(floor: string, room: string) {
  return `${floor}${ROOM_KEY_SEPARATOR}${room}`;
}

function roomFromKey(value: string) {
  const [floor = "", room = ""] = value.split(ROOM_KEY_SEPARATOR);
  return { floor, room };
}

export function ElectricalSystemWorkspace({
  canViewHistory,
  initialSnapshot,
  preferredOffice,
}: {
  canViewHistory: boolean;
  initialSnapshot: AirControlSnapshot;
  preferredOffice: string;
}) {
  const { toast } = useToast();
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [refreshing, setRefreshing] = useState(false);
  const [busyDeviceId, setBusyDeviceId] = useState("");
  const [busyMessage, setBusyMessage] = useState("");
  const [activityBubbles, setActivityBubbles] = useState<
    AirControlActivityView[]
  >([]);
  const activityCursorRef = useRef(initialSnapshot.generatedAt);
  const seenActivityIdsRef = useRef(new Set<string>());
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyItems, setHistoryItems] = useState<AirControlActivityView[]>([]);
  const [historyNextBefore, setHistoryNextBefore] = useState("");
  const [historyQuery, setHistoryQuery] = useState("");
  const [historyStatus, setHistoryStatus] = useState("");
  const allDevices = useMemo(
    () => [...snapshot.lights, ...snapshot.devices],
    [snapshot.devices, snapshot.lights],
  );
  const onlineCount = useMemo(
    () =>
      [...snapshot.devices, ...snapshot.lights].filter(
        (device) => device.online,
      ).length,
    [snapshot.devices, snapshot.lights],
  );
  const buildings = useMemo(
    () =>
      uniqueSorted(
        allDevices.flatMap((device) =>
          device.placement ? [device.placement.building] : [],
        ),
      ),
    [allDevices],
  );
  const [requestedBuilding, setSelectedBuilding] = useState(() =>
    resolvePreferredElectricalOffice(buildings, preferredOffice),
  );
  const selectedBuilding = buildings.includes(requestedBuilding)
    ? requestedBuilding
    : resolvePreferredElectricalOffice(buildings, preferredOffice);
  const [requestedRoomKey, setSelectedRoomKey] = useState("");
  const unassignedCount = useMemo(
    () => allDevices.filter((device) => !device.placement).length,
    [allDevices],
  );
  const floorGroups = useMemo(() => {
    const buildingDevices = allDevices.filter(
      (device) => device.placement?.building === selectedBuilding,
    );
    return uniqueSorted(
      buildingDevices.flatMap((device) =>
        device.placement ? [device.placement.floor] : [],
      ),
    )
      .sort(compareElectricalFloors)
      .map((floor) => ({
        floor,
        rooms: uniqueSorted(
          buildingDevices.flatMap((device) =>
            device.placement?.floor === floor ? [device.placement.room] : [],
          ),
        ).map((room) => {
          const devices = buildingDevices.filter(
            (device) =>
              device.placement?.floor === floor &&
              device.placement.room === room,
          );
          return {
            devices,
            key: roomKey(floor, room),
            name: room,
            onlineCount: devices.filter((device) => device.online).length,
          };
        }),
      }));
  }, [allDevices, selectedBuilding]);
  const selectedRoomKey =
    requestedRoomKey === UNASSIGNED_LOCATION
      ? unassignedCount
        ? requestedRoomKey
        : ""
      : floorGroups.some((group) =>
            group.rooms.some((room) => room.key === requestedRoomKey),
          )
        ? requestedRoomKey
        : "";
  const selectedRoom = useMemo(
    () => roomFromKey(selectedRoomKey),
    [selectedRoomKey],
  );
  const visibleDevices = useMemo(() => {
    if (selectedRoomKey === UNASSIGNED_LOCATION) {
      return allDevices.filter((device) => !device.placement);
    }
    if (!selectedRoomKey) return [];
    return allDevices.filter(
      (device) =>
        device.placement?.building === selectedBuilding &&
        device.placement.floor === selectedRoom.floor &&
        device.placement.room === selectedRoom.room,
    );
  }, [
    allDevices,
    selectedBuilding,
    selectedRoom,
    selectedRoomKey,
  ]);
  const visibleLights = useMemo(
    () => visibleDevices.filter((device) => device.kind === "light"),
    [visibleDevices],
  );
  const visibleAirConditioners = useMemo(
    () => visibleDevices.filter((device) => device.kind === "air-conditioner"),
    [visibleDevices],
  );
  const locationReady = Boolean(selectedRoomKey);
  const filteredHistoryItems = useMemo(() => {
    const query = historyQuery.trim().toLocaleLowerCase("vi");
    if (!query) return historyItems;
    return historyItems.filter((item) =>
      [
        item.actorName,
        item.actionText,
        item.deviceName,
        item.location,
        item.error,
      ]
        .join(" ")
        .toLocaleLowerCase("vi")
        .includes(query),
    );
  }, [historyItems, historyQuery]);

  const pushActivityBubble = useCallback((activity: AirControlActivityView) => {
    if (seenActivityIdsRef.current.has(activity.id)) return;
    seenActivityIdsRef.current.add(activity.id);
    setActivityBubbles((current) => [...current.slice(-2), activity]);
    window.setTimeout(() => {
      setActivityBubbles((current) =>
        current.filter((item) => item.id !== activity.id),
      );
    }, 5_600);
  }, []);

  const loadHistory = useCallback(
    async (append = false, before = "") => {
      if (!canViewHistory) return;
      setHistoryLoading(true);
      try {
        const params = new URLSearchParams({ limit: "50", view: "history" });
        if (before) params.set("before", before);
        if (historyStatus) params.set("status", historyStatus);
        const response = await fetch(`/api/air-conditioners?${params}`, {
          cache: "no-store",
        });
        const payload = await readJson<AirControlActivityPage>(response);
        if (!payload.result) return;
        setHistoryNextBefore(payload.result.nextBefore);
        setHistoryItems((current) =>
          append
            ? [
                ...current,
                ...payload.result!.items.filter(
                  (item) => !current.some((existing) => existing.id === item.id),
                ),
              ]
            : payload.result!.items,
        );
      } catch (error) {
        toast({
          message: error instanceof Error ? error.message : undefined,
          title: "Không tải được lịch sử điều khiển",
          tone: "error",
        });
      } finally {
        setHistoryLoading(false);
      }
    },
    [canViewHistory, historyStatus, toast],
  );

  const refresh = useCallback(
    async (notify = false) => {
      setRefreshing(true);
      try {
        const response = await fetch("/api/air-conditioners", {
          cache: "no-store",
        });
        const payload = await readJson<AirControlSnapshot>(response);
        if (payload.result) setSnapshot(payload.result);
        if (notify) {
          toast({ title: "Đã làm mới trạng thái", tone: "success" });
        }
      } catch (error) {
        if (notify) {
          toast({
            message: error instanceof Error ? error.message : undefined,
            title: "Không tải được hệ thống điện",
            tone: "error",
          });
        }
      } finally {
        setRefreshing(false);
      }
    },
    [toast],
  );

  useEffect(() => {
    // Next.js có thể đã prefetch trang từ dashboard. Luôn đối chiếu lại
    // trạng thái lệnh mới nhất từ Hunonic ngay khi người dùng thật sự mở module.
    const initialRefresh = window.setTimeout(() => void refresh(false), 0);
    const timer = window.setInterval(() => void refresh(false), 20_000);
    return () => {
      window.clearTimeout(initialRefresh);
      window.clearInterval(timer);
    };
  }, [refresh]);

  useEffect(() => {
    let stopped = false;
    let polling = false;
    const pollActivities = async () => {
      if (stopped || polling || document.visibilityState === "hidden") return;
      polling = true;
      try {
        const params = new URLSearchParams({
          after: activityCursorRef.current,
          view: "activity",
        });
        const response = await fetch(`/api/air-conditioners?${params}`, {
          cache: "no-store",
        });
        const payload = await readJson<AirControlActivityPage>(response);
        if (!stopped && payload.result) {
          activityCursorRef.current = payload.result.serverTime;
          payload.result.items.forEach(pushActivityBubble);
        }
      } catch {
        // Bong bóng hoạt động là lớp thông tin phụ; không làm gián đoạn điều khiển.
      } finally {
        polling = false;
      }
    };
    const initial = window.setTimeout(() => void pollActivities(), 1_200);
    const timer = window.setInterval(() => void pollActivities(), 2_500);
    return () => {
      stopped = true;
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [pushActivityBubble]);

  useEffect(() => {
    if (!historyOpen) return;
    void loadHistory(false);
  }, [historyOpen, historyStatus, loadHistory]);

  useEffect(() => {
    if (!historyOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setHistoryOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [historyOpen]);

  useEffect(() => {
    if (!selectedRoomKey) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedRoomKey("");
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [selectedRoomKey]);

  async function sendCommand(
    device: ElectricalDeviceView,
    input: AirControlCommand,
  ) {
    setBusyDeviceId(device.id);
    setBusyMessage(
      input.command === "set_temperature"
        ? `Đang đặt ${device.name} ở ${input.temperature}°C...`
        : input.command === "set_fan"
          ? `Đang đặt mức gió ${FAN_LEVEL_LABELS[input.fanLevel]} cho ${device.name}...`
          : input.command === "set_mode"
            ? `Đang chuyển ${device.name} sang ${MODE_LABELS[input.climateMode]}...`
            : `Đang ${input.command === "power_on" ? "bật" : "tắt"} ${device.name}...`,
    );
    try {
      const requestId = `electric-${crypto.randomUUID()}`;
      const response = await fetch("/api/air-conditioners", {
        body: JSON.stringify({ ...input, deviceId: device.id, requestId }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const payload = await readJson<{
        activity: AirControlActivityView;
        device: ElectricalDeviceView;
        message: string;
      }>(response);
      const updatedDevice = payload.result?.device;
      if (updatedDevice) {
        setSnapshot((current) => ({
          ...current,
          devices:
            updatedDevice.kind === "air-conditioner"
              ? current.devices.map((item) =>
                  item.id === updatedDevice.id ? updatedDevice : item,
                )
              : current.devices,
          lights:
            updatedDevice.kind === "light"
              ? current.lights.map((item) =>
                  item.id === updatedDevice.id ? updatedDevice : item,
                )
              : current.lights,
          generatedAt: new Date().toISOString(),
        }));
      }
      if (payload.result?.activity) {
        pushActivityBubble(payload.result.activity);
      }
      toast({
        message: payload.result?.message,
        title: "Quản lý hệ thống điện",
        tone: "success",
      });
    } catch (error) {
      toast({
        message: error instanceof Error ? error.message : undefined,
        title: "Không điều khiển được",
        tone: "error",
      });
    } finally {
      setBusyDeviceId("");
      setBusyMessage("");
    }
  }

  return (
    <>
      <WriteLoadingOverlay
        message={busyMessage || "Đang gửi lệnh đến thiết bị điện..."}
        show={Boolean(busyDeviceId)}
      />

      <section className="ui-module-toolbar flex flex-wrap items-center justify-between gap-3 p-3">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <Badge tone={snapshot.mode === "live" ? "success" : "warning"}>
            {snapshot.mode === "live" ? "Đã kết nối" : "Dữ liệu mẫu"}
          </Badge>
          <p className="text-sm font-semibold text-muted">
            <strong className="text-primary">{snapshot.devices.length}</strong>{" "}
            máy lạnh ·{" "}
            <strong className="text-primary">{snapshot.lights.length}</strong>{" "}
            đèn · <strong className="text-primary">{onlineCount}</strong> thiết
            bị trực tuyến · cập nhật {time(snapshot.generatedAt)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canViewHistory ? (
            <Button
              onClick={() => setHistoryOpen(true)}
              size="sm"
              variant="secondary"
            >
              <History size={16} />
              Lịch sử điều khiển
            </Button>
          ) : null}
          <Button
            disabled={refreshing}
            onClick={() => void refresh(true)}
            size="sm"
            variant="secondary"
          >
            <RefreshCw className={refreshing ? "animate-spin" : ""} size={16} />
            Làm mới
          </Button>
        </div>
      </section>

      {snapshot.warning ? (
        <div
          className="mt-4 rounded-lg border border-[#f3d4a0] bg-[#fff4e5] px-4 py-3 text-sm font-semibold leading-6 text-[#8d431f]"
          role="status"
        >
          {snapshot.warning}
        </div>
      ) : null}

      <section
        className="ui-module-panel mt-5 overflow-hidden p-0"
        aria-labelledby="building-navigator-heading"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-gradient-to-r from-brand/[0.09] via-brand/[0.035] to-transparent p-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-brand-strong">
              Chọn nhanh nơi làm việc
            </p>
            <h2
              className="mt-1 text-xl font-extrabold text-primary"
              id="building-navigator-heading"
            >
              Văn phòng, tầng và phòng
            </h2>
          </div>
          <div className="flex items-center gap-2 text-xs font-semibold text-muted">
            <Building2 size={16} />
            {selectedRoomKey === UNASSIGNED_LOCATION
              ? "Chưa phân khu"
              : [
                  selectedBuilding,
                  selectedRoomKey ? selectedRoom.floor : "",
                  selectedRoomKey ? selectedRoom.room : "",
                ]
                  .filter(Boolean)
                  .join(" · ")}
          </div>
        </div>

        <div className="space-y-4 p-4">
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">
                Văn phòng
              </p>
              <Badge tone="neutral">Tự chọn theo hồ sơ nhân viên</Badge>
            </div>
            <div className="flex flex-wrap gap-2" role="tablist">
              {buildings.map((building) => {
                const count = allDevices.filter(
                  (device) => device.placement?.building === building,
                ).length;
                const active = selectedBuilding === building;
                return (
                  <Button
                    aria-pressed={active}
                    key={building}
                    onClick={() => {
                      setSelectedBuilding(building);
                      setSelectedRoomKey("");
                    }}
                    size="sm"
                    variant={active ? "brand" : "secondary"}
                  >
                    <Building2 size={16} /> {building}
                    <span className="rounded-full bg-current/10 px-1.5 py-0.5 text-[10px]">
                      {count}
                    </span>
                  </Button>
                );
              })}
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-border bg-white">
            {floorGroups.map((group, index) => {
              const floorDeviceCount = group.rooms.reduce(
                (sum, room) => sum + room.devices.length,
                0,
              );
              return (
                <section
                  className={`grid gap-3 p-3 md:grid-cols-[140px_minmax(0,1fr)] md:items-stretch ${
                    index ? "border-t border-border" : ""
                  }`}
                  key={group.floor}
                >
                  <div className="flex items-center justify-between gap-3 rounded-lg bg-brand/[0.055] px-3 py-2 md:block">
                    <strong className="block text-sm text-primary">
                      {group.floor}
                    </strong>
                    <span className="mt-1 block text-xs font-semibold text-muted">
                      {floorDeviceCount} thiết bị
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    {group.rooms.map((room) => {
                      const active = selectedRoomKey === room.key;
                      return (
                        <button
                          aria-pressed={active}
                          className={`group min-w-[190px] flex-1 basis-[220px] rounded-xl border p-3 text-left transition ${
                            active
                              ? "border-brand bg-brand/[0.09] shadow-[0_10px_28px_rgba(17,76,65,0.12)]"
                              : "border-border bg-white hover:border-brand/30 hover:bg-brand/[0.025]"
                          }`}
                          key={room.key}
                          onClick={() => setSelectedRoomKey(room.key)}
                          type="button"
                        >
                          <div className="flex items-center gap-3">
                            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand/[0.08] text-brand-strong">
                              <DoorOpen size={18} />
                            </span>
                            <div className="min-w-0 flex-1">
                              <strong className="block truncate text-sm text-primary">
                                {room.name}
                              </strong>
                              <span className="mt-0.5 block text-xs text-muted">
                                {room.devices.length} thiết bị · {room.onlineCount} trực tuyến
                              </span>
                            </div>
                            <ChevronRight
                              className="shrink-0 text-muted transition group-hover:translate-x-0.5"
                              size={17}
                            />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </section>
              );
            })}

            {unassignedCount ? (
              <section
                className={`grid gap-3 border-border p-3 md:grid-cols-[140px_minmax(0,1fr)] md:items-stretch ${
                  floorGroups.length ? "border-t" : ""
                }`}
              >
                <div className="flex items-center justify-between gap-3 rounded-lg bg-warning/5 px-3 py-2 md:block">
                  <strong className="block text-sm text-primary">
                    Chưa phân khu
                  </strong>
                  <span className="mt-1 block text-xs font-semibold text-muted">
                    {unassignedCount} thiết bị
                  </span>
                </div>
                <button
                  aria-pressed={selectedRoomKey === UNASSIGNED_LOCATION}
                  className={`group rounded-xl border p-3 text-left transition ${
                    selectedRoomKey === UNASSIGNED_LOCATION
                      ? "border-brand bg-brand/[0.09] shadow-[0_10px_28px_rgba(17,76,65,0.12)]"
                      : "border-border bg-white hover:border-brand/30 hover:bg-brand/[0.025]"
                  }`}
                  onClick={() => setSelectedRoomKey(UNASSIGNED_LOCATION)}
                  type="button"
                >
                  <div className="flex items-center gap-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-warning/10 text-warning">
                      <MapPin size={18} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <strong className="block text-sm text-primary">
                        Thiết bị chưa gán phòng
                      </strong>
                      <span className="mt-0.5 block text-xs text-muted">
                        {unassignedCount} thiết bị · cần Admin hoàn tất cấu hình
                      </span>
                    </div>
                    <ChevronRight
                      className="shrink-0 text-muted transition group-hover:translate-x-0.5"
                      size={17}
                    />
                  </div>
                </button>
              </section>
            ) : null}
          </div>

          {!selectedRoomKey ? (
            <p className="rounded-xl border border-dashed border-border p-4 text-center text-sm leading-6 text-muted">
              Chọn trực tiếp một phòng ở bất kỳ tầng nào để xem và điều khiển thiết bị.
            </p>
          ) : null}
        </div>
      </section>

      {selectedRoomKey && typeof document !== "undefined"
        ? createPortal(
            <div className="fixed inset-0 z-[170] grid place-items-center p-2 sm:p-4">
              <button
                aria-label="Đóng bảng điều khiển điện"
                className="absolute inset-0 bg-[rgba(7,24,21,0.54)] backdrop-blur-[3px]"
                onClick={() => setSelectedRoomKey("")}
                type="button"
              />
              <section
                aria-labelledby="electrical-control-dialog-title"
                aria-modal="true"
                className="relative z-10 max-h-[94dvh] w-full max-w-[1500px] overflow-hidden rounded-xl border border-border bg-surface shadow-[0_32px_90px_rgba(7,24,21,0.34)]"
                role="dialog"
              >
                <header className="flex items-center justify-between gap-3 border-b border-border bg-gradient-to-r from-brand/[0.1] via-white to-white px-4 py-3 sm:px-5 sm:py-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="info">Điều khiển điện</Badge>
                      <Badge tone="neutral">
                        {visibleDevices.length} thiết bị
                      </Badge>
                    </div>
                    <h2
                      className="mt-2 truncate text-xl font-extrabold text-primary"
                      id="electrical-control-dialog-title"
                    >
                      {selectedRoomKey === UNASSIGNED_LOCATION
                        ? "Thiết bị chưa phân khu"
                        : selectedRoom.room}
                    </h2>
                    <p className="mt-1 truncate text-xs font-semibold text-muted sm:text-sm">
                      {selectedRoomKey === UNASSIGNED_LOCATION
                        ? "Các thiết bị đang chờ Admin gán vị trí"
                        : [selectedBuilding, selectedRoom.floor]
                            .filter(Boolean)
                            .join(" · ")}
                    </p>
                  </div>
                  <button
                    aria-label="Đóng bảng điều khiển"
                    className="ui-close-button shrink-0"
                    onClick={() => setSelectedRoomKey("")}
                    title="Đóng"
                    type="button"
                  >
                    <X size={21} />
                  </button>
                </header>

                <div className="max-h-[calc(94dvh-108px)] overflow-y-auto p-4 sm:p-5">
      <div className="grid gap-5 lg:grid-cols-[minmax(280px,0.72fr)_minmax(0,1.28fr)] lg:items-start">
      <section
        aria-labelledby="lighting-heading"
        className="min-w-0 rounded-xl border border-border bg-surface-muted/30 p-3 sm:p-4"
      >
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-brand-strong">
              Hệ thống chiếu sáng
            </p>
            <h2
              className="mt-1 text-xl font-extrabold text-primary"
              id="lighting-heading"
            >
              Đèn và công tắc
            </h2>
          </div>
          <span className="text-sm font-semibold text-muted">
            {visibleLights.filter((light) => light.online).length}/
            {visibleLights.length} trực tuyến
          </span>
        </div>

        {visibleLights.length ? (
          <div
            aria-live="polite"
            className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1 2xl:grid-cols-2"
          >
            {visibleLights.map((light) => {
              const busy = busyDeviceId === light.id;
              const canControl =
                snapshot.mode === "live" && light.online && !busy;
              const actionLabel = `${light.powerOn ? "Tắt" : "Bật"} ${light.name}`;
              return (
                <button
                  aria-label={actionLabel}
                  aria-pressed={light.powerOn}
                  className={`flex min-h-14 min-w-0 items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition ${
                    light.powerOn
                      ? "border-brand/25 bg-brand/[0.09] text-brand-strong shadow-[0_8px_20px_rgba(17,76,65,0.1)]"
                      : "border-border bg-white text-primary hover:border-brand/25 hover:bg-brand/[0.03]"
                  } ${light.online ? "" : "cursor-not-allowed bg-surface-muted/70 opacity-55 shadow-none"}`}
                  disabled={!canControl}
                  key={light.id}
                  onClick={() =>
                    void sendCommand(light, {
                      command: light.powerOn ? "power_off" : "power_on",
                    })
                  }
                  title={actionLabel}
                  type="button"
                >
                  <span
                    className={`grid size-9 shrink-0 place-items-center rounded-lg ${
                      light.powerOn
                        ? "bg-brand text-white"
                        : "bg-primary/[0.055] text-primary"
                    }`}
                  >
                    <Lightbulb
                      fill={light.powerOn ? "currentColor" : "none"}
                      size={20}
                    />
                  </span>
                  <strong className="min-w-0 flex-1 truncate text-sm font-extrabold">
                    {light.name}
                  </strong>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="ui-module-panel grid min-h-32 place-items-center border-dashed p-6 text-center text-sm leading-6 text-muted">
            {locationReady
              ? "Phòng này chưa có đèn hoặc công tắc được gán."
              : "Chọn một phòng phía trên để xem đèn."}
          </div>
        )}
      </section>

      <section className="min-w-0">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-brand-strong">
            Điều hòa không khí
          </p>
          <h2 className="mt-1 text-xl font-extrabold text-primary">Máy lạnh</h2>
        </div>
        <span className="text-sm font-semibold text-muted">
          {visibleAirConditioners.filter((device) => device.online).length}/
          {visibleAirConditioners.length} trực tuyến
        </span>
      </div>

      <section
        aria-live="polite"
        className="mt-4 grid gap-3 sm:grid-cols-2"
      >
        {visibleAirConditioners.length ? (
          visibleAirConditioners.map((device, deviceIndex) => {
            const busy = busyDeviceId === device.id;
            const canControl =
              snapshot.mode === "live" && device.online && !busy;
            const temperatureReady =
              device.capabilities.temperature &&
              device.temperature !== null &&
              device.minTemperature !== null &&
              device.maxTemperature !== null;
            const isWideOddCard =
              visibleAirConditioners.length % 2 === 1 &&
              deviceIndex === visibleAirConditioners.length - 1;
            return (
              <article
                className={`ui-module-panel relative grid min-w-0 gap-3 overflow-hidden border border-brand/10 bg-white p-4 shadow-[0_18px_48px_rgba(17,76,65,0.09)] transition-shadow duration-200 hover:shadow-[0_22px_56px_rgba(17,76,65,0.13)] ${isWideOddCard ? "sm:col-span-2" : ""} ${device.online ? "" : "bg-surface-muted/70 shadow-none"}`}
                key={device.id}
              >
                <span
                  aria-hidden="true"
                  className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-brand-light via-brand to-brand-strong"
                />
                <div className="flex items-start justify-between gap-3 pt-1">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="break-words text-lg font-extrabold text-primary">
                        {device.name}
                      </h2>
                      {snapshot.mode === "demo" ? (
                        <Badge className="h-6 px-2" tone="warning">
                          Mẫu
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-1 text-sm font-semibold text-muted">
                      {deviceLocationLabel(device)}
                    </p>
                  </div>
                  <span
                    className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold ${device.online ? "border-success/15 bg-success/5 text-success" : "border-danger/15 bg-danger/5 text-danger"}`}
                  >
                    {device.online ? <Wifi size={15} /> : <WifiOff size={15} />}
                    {device.online ? "Trực tuyến" : "Ngoại tuyến"}
                  </span>
                </div>

                <div
                  className={`grid min-w-0 gap-3 ${isWideOddCard ? "md:grid-cols-2 md:items-start" : ""}`}
                >
                  <div className="grid min-w-0 content-start gap-3">
                <div
                  className={`grid grid-cols-[52px_minmax(0,1fr)] items-center gap-3 rounded-xl border p-3 ${device.powerOn ? "border-brand/10 bg-gradient-to-r from-brand/[0.08] to-brand/[0.025]" : "border-primary/10 bg-primary/[0.035]"}`}
                >
                  <Button
                    aria-label={`${device.powerOn ? "Tắt" : "Bật"} máy ${device.name}`}
                    aria-pressed={device.powerOn}
                    className="size-13 rounded-xl"
                    disabled={!canControl || !device.capabilities.power}
                    onClick={() =>
                      void sendCommand(device, {
                        command: device.powerOn ? "power_off" : "power_on",
                      })
                    }
                    size="icon"
                    title={`${device.powerOn ? "Tắt" : "Bật"} ${device.name}`}
                    variant={device.powerOn ? "brand" : "secondary"}
                  >
                    <Power size={23} />
                  </Button>
                  <div>
                    <span className="text-xs font-bold uppercase tracking-wide text-muted">
                      Trạng thái trên Hunonic
                    </span>
                    <strong
                      className={`mt-1 block text-lg font-extrabold ${device.powerOn ? "text-brand-strong" : "text-primary"}`}
                    >
                      {device.powerOn ? "Đang bật" : "Đang tắt"}
                    </strong>
                  </div>
                </div>

                {temperatureReady ? (
                  <div className="rounded-xl border border-primary/10 bg-[#f7faf9] p-3.5">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-muted">
                        <Thermometer size={16} />
                        Nhiệt độ
                      </span>
                      <span className="text-xs font-semibold text-muted">
                        {device.minTemperature}–{device.maxTemperature}°C
                      </span>
                    </div>
                    <div className="grid grid-cols-[44px_minmax(0,1fr)_44px] items-center gap-2">
                      <Button
                        aria-label={`Giảm nhiệt độ ${device.name}`}
                        className="rounded-xl border-brand/15 text-brand-strong hover:bg-brand/[0.06]"
                        disabled={
                          !canControl ||
                          device.temperature! <= device.minTemperature!
                        }
                        onClick={() =>
                          void sendCommand(device, {
                            command: "set_temperature",
                            temperature: device.temperature! - 1,
                          })
                        }
                        size="icon"
                        variant="secondary"
                      >
                        <Minus size={18} />
                      </Button>
                      <strong className="text-center text-3xl font-black text-primary">
                        {device.temperature}°C
                      </strong>
                      <Button
                        aria-label={`Tăng nhiệt độ ${device.name}`}
                        className="rounded-xl border-brand/15 text-brand-strong hover:bg-brand/[0.06]"
                        disabled={
                          !canControl ||
                          device.temperature! >= device.maxTemperature!
                        }
                        onClick={() =>
                          void sendCommand(device, {
                            command: "set_temperature",
                            temperature: device.temperature! + 1,
                          })
                        }
                        size="icon"
                        variant="secondary"
                      >
                        <Plus size={18} />
                      </Button>
                    </div>
                  </div>
                ) : null}
                  </div>

                  <div className="grid min-w-0 content-start gap-3">

                {device.capabilities.mode && device.availableModes.length ? (
                  <div>
                    <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-muted">
                      Chế độ vận hành
                    </p>
                    <div className="grid grid-cols-4 gap-2">
                      {device.availableModes.map((mode) => {
                        const ModeIcon = MODE_ICONS[mode];
                        const modeRunning =
                          device.powerOn && device.climateMode === mode;
                        const modeActionLabel = modeRunning
                          ? `${device.name} đang ở chế độ ${MODE_LABELS[mode]}`
                          : device.powerOn
                            ? `Chuyển sang chế độ ${MODE_LABELS[mode]} cho ${device.name}`
                            : `Bật chế độ ${MODE_LABELS[mode]} cho ${device.name}`;
                        return (
                          <Button
                            aria-label={modeActionLabel}
                            aria-pressed={modeRunning}
                            className={`h-12 w-full rounded-xl ${modeRunning ? "" : "border-brand/10 hover:border-brand/25 hover:bg-brand/[0.04]"}`}
                            disabled={!canControl}
                            key={mode}
                            onClick={() => {
                              if (modeRunning) return;
                              void sendCommand(device, {
                                climateMode: mode,
                                command: "set_mode",
                              });
                            }}
                            size="icon"
                            title={modeActionLabel}
                            variant={modeRunning ? "brand" : "secondary"}
                          >
                            <ModeIcon size={19} />
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                {device.availableFanLevels.length
                  ? (() => {
                      const nextFan = nextFanLevel(
                        device.availableFanLevels,
                        device.fanLevel,
                      );
                      const currentFanLabel = device.fanLevel
                        ? FAN_LEVEL_LABELS[device.fanLevel]
                        : "chưa xác định";
                      const fanActionLabel = !device.powerOn
                        ? `Bật ${device.name} trước khi chỉnh mức gió`
                        : nextFan
                          ? `Mức gió hiện tại ${currentFanLabel}; bấm để chuyển sang ${FAN_LEVEL_LABELS[nextFan]} cho ${device.name}`
                          : `${device.name} không có mức gió khác để chuyển`;
                      return (
                        <div className="flex items-center justify-between gap-3 rounded-xl border border-brand/10 bg-brand/[0.035] p-3">
                          <div className="min-w-0">
                            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">
                              Mức gió
                            </p>
                            <strong
                              className={`mt-0.5 block text-sm font-extrabold ${device.powerOn ? "text-brand-strong" : "text-muted"}`}
                            >
                              {currentFanLabel}
                            </strong>
                          </div>
                          <Button
                            aria-label={fanActionLabel}
                            className="h-12 w-20 shrink-0 rounded-xl"
                            disabled={
                              !canControl || !device.powerOn || !nextFan
                            }
                            onClick={() => {
                              if (!nextFan) return;
                              void sendCommand(device, {
                                command: "set_fan",
                                fanLevel: nextFan,
                              });
                            }}
                            size="icon"
                            title={fanActionLabel}
                            variant={device.powerOn ? "brand" : "secondary"}
                          >
                            <span className="relative inline-flex items-center justify-center">
                              <Fan size={19} />
                              {device.fanLevel ? (
                                <FanLevelIndicator level={device.fanLevel} />
                              ) : null}
                            </span>
                          </Button>
                        </div>
                      );
                    })()
                  : null}

                {!temperatureReady &&
                (!device.capabilities.mode || !device.availableModes.length) ? (
                  <p className="text-xs font-medium leading-5 text-muted">
                    Remote này chưa trả cấu hình nhiệt độ hoặc chế độ tương
                    thích.
                  </p>
                ) : null}
                  </div>
                </div>
              </article>
            );
          })
        ) : (
          <div className="ui-module-panel col-span-full grid min-h-52 place-items-center border-dashed p-8 text-center text-sm leading-6 text-muted">
            {locationReady
              ? "Phòng này chưa có máy lạnh được gán."
              : "Chọn một phòng phía trên để xem máy lạnh."}
          </div>
        )}
      </section>
      </section>
      </div>

                </div>
              </section>
            </div>,
            document.body,
          )
        : null}

      {activityBubbles.length && typeof document !== "undefined"
        ? createPortal(
            <div
              aria-live="polite"
              className="pointer-events-none fixed inset-x-3 bottom-4 z-[190] flex flex-col items-center gap-2 sm:inset-x-auto sm:bottom-6 sm:left-6 sm:items-start"
            >
              {activityBubbles.map((activity) => (
                <article
                  className="electrical-activity-bubble pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-xl border border-brand/15 bg-surface px-4 py-3 text-primary shadow-[0_20px_55px_rgba(7,24,21,0.24)] sm:min-w-96"
                  key={activity.id}
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand text-white shadow-[0_8px_20px_rgba(17,76,65,0.22)]">
                    <Zap size={18} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-5">
                      <strong>{activity.actorName}</strong> vừa {activity.actionText}.
                    </p>
                    <p className="mt-1 truncate text-xs font-semibold text-muted">
                      {activity.location} · {dateTime(activity.completedAt || activity.createdAt)}
                    </p>
                  </div>
                </article>
              ))}
            </div>,
            document.body,
          )
        : null}

      {canViewHistory && historyOpen && typeof document !== "undefined"
        ? createPortal(
            <div className="fixed inset-0 z-[185] grid place-items-center p-2 sm:p-4">
              <button
                aria-label="Đóng lịch sử điều khiển"
                className="absolute inset-0 bg-[rgba(7,24,21,0.58)] backdrop-blur-[3px]"
                onClick={() => setHistoryOpen(false)}
                type="button"
              />
              <section
                aria-labelledby="air-control-history-title"
                aria-modal="true"
                className="relative z-10 flex max-h-[92dvh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-[0_32px_90px_rgba(7,24,21,0.34)]"
                role="dialog"
              >
                <header className="flex items-start justify-between gap-3 border-b border-border bg-gradient-to-r from-brand/[0.1] via-white to-white px-4 py-4 sm:px-5">
                  <div>
                    <Badge tone="info">Chỉ Super Admin</Badge>
                    <h2
                      className="mt-2 text-xl font-extrabold text-primary"
                      id="air-control-history-title"
                    >
                      Lịch sử điều khiển hệ thống điện
                    </h2>
                    <p className="mt-1 text-sm font-semibold text-muted">
                      Truy xuất người thao tác, thiết bị, thời điểm và kết quả lệnh.
                    </p>
                  </div>
                  <button
                    aria-label="Đóng lịch sử điều khiển"
                    className="ui-close-button shrink-0"
                    onClick={() => setHistoryOpen(false)}
                    title="Đóng"
                    type="button"
                  >
                    <X size={21} />
                  </button>
                </header>

                <div className="grid gap-3 border-b border-border bg-surface-muted/45 p-4 sm:grid-cols-[minmax(0,1fr)_190px_auto] sm:items-center">
                  <label className="relative block">
                    <span className="sr-only">Tìm trong lịch sử</span>
                    <Search
                      className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
                      size={17}
                    />
                    <input
                      className="ui-module-input w-full pl-10"
                      onChange={(event) => setHistoryQuery(event.target.value)}
                      placeholder="Tìm người, thiết bị hoặc vị trí..."
                      value={historyQuery}
                    />
                  </label>
                  <label>
                    <span className="sr-only">Lọc trạng thái lệnh</span>
                    <select
                      className="ui-module-select w-full"
                      onChange={(event) => setHistoryStatus(event.target.value)}
                      value={historyStatus}
                    >
                      <option value="">Tất cả trạng thái</option>
                      <option value="COMPLETED">Thành công</option>
                      <option value="FAILED">Thất bại</option>
                      <option value="PENDING">Đang xử lý</option>
                    </select>
                  </label>
                  <Button
                    disabled={historyLoading}
                    onClick={() => void loadHistory(false)}
                    size="sm"
                    variant="secondary"
                  >
                    <RefreshCw
                      className={historyLoading ? "animate-spin" : ""}
                      size={16}
                    />
                    Làm mới
                  </Button>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
                  {historyLoading && !historyItems.length ? (
                    <div className="grid min-h-52 place-items-center text-sm font-semibold text-muted">
                      Đang tải lịch sử điều khiển...
                    </div>
                  ) : filteredHistoryItems.length ? (
                    <div className="space-y-2">
                      {filteredHistoryItems.map((activity) => (
                        <article
                          className="grid gap-3 rounded-xl border border-border bg-white p-3 sm:grid-cols-[155px_minmax(0,1fr)_minmax(180px,0.55fr)] sm:items-start"
                          key={activity.id}
                        >
                          <div>
                            <Badge
                              tone={
                                activity.status === "COMPLETED"
                                  ? "success"
                                  : activity.status === "FAILED"
                                    ? "danger"
                                    : "warning"
                              }
                            >
                              {activity.status === "COMPLETED"
                                ? "Thành công"
                                : activity.status === "FAILED"
                                  ? "Thất bại"
                                  : "Đang xử lý"}
                            </Badge>
                            <p className="mt-2 text-xs font-semibold text-muted">
                              {dateTime(activity.createdAt)}
                            </p>
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm leading-6 text-primary">
                              <strong>{activity.actorName}</strong> đã {activity.actionText}.
                            </p>
                            {activity.error ? (
                              <p className="mt-1 text-xs font-semibold leading-5 text-danger">
                                {activity.error}
                              </p>
                            ) : null}
                          </div>
                          <div className="min-w-0 text-xs font-semibold leading-5 text-muted">
                            <strong className="block truncate text-sm text-primary">
                              {activity.deviceName}
                            </strong>
                            <span className="block">{activity.location}</span>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <div className="grid min-h-52 place-items-center rounded-xl border border-dashed border-border p-6 text-center text-sm leading-6 text-muted">
                      Không có lệnh điều khiển phù hợp bộ lọc.
                    </div>
                  )}
                </div>

                {historyNextBefore ? (
                  <footer className="border-t border-border bg-surface-muted/35 p-3 text-center">
                    <Button
                      disabled={historyLoading}
                      onClick={() =>
                        void loadHistory(true, historyNextBefore)
                      }
                      size="sm"
                      variant="secondary"
                    >
                      Xem thêm lịch sử cũ
                    </Button>
                  </footer>
                ) : null}
              </section>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
