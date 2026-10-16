"use client";

import {
  Building2,
  Layers3,
  Lightbulb,
  MapPin,
  Pencil,
  Plus,
  Save,
  Search,
  Snowflake,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Badge, Button, Input, Select } from "@/components/ui";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { useToast, WriteLoadingOverlay } from "@/components/ui/toast";
import type {
  ElectricalLayoutConfigSnapshot,
  ElectricalLocationView,
} from "@/lib/air-control/electrical-layout";

import {
  bulkAssignElectricalDevicesAction,
  createElectricalLocationAction,
  deleteElectricalLocationAction,
  saveElectricalDevicePlacementAction,
  updateElectricalLocationAction,
  type ElectricalLayoutActionResult,
} from "./actions";

function locationLabel(location: ElectricalLocationView) {
  return [location.building, location.floor, location.room, location.area].join(
    " · ",
  );
}

function normalize(value: string) {
  return value.trim().toLocaleLowerCase("vi-VN");
}

export function ElectricalLayoutConfig({
  initial,
}: {
  initial: ElectricalLayoutConfigSnapshot;
}) {
  const { toast } = useToast();
  const [snapshot, setSnapshot] = useState(initial);
  const [busy, setBusy] = useState("");
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("all");
  const [placement, setPlacement] = useState("all");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkLocationId, setBulkLocationId] = useState("");
  const [editingLocationId, setEditingLocationId] = useState("");

  useEffect(() => {
    setSnapshot(initial);
    setSelectedIds((current) =>
      current.filter((id) =>
        initial.devices.some((device) => device.id === id),
      ),
    );
  }, [initial]);

  const locationsById = useMemo(
    () => new Map(snapshot.locations.map((location) => [location.id, location])),
    [snapshot.locations],
  );

  const visibleDevices = useMemo(() => {
    const term = normalize(query);
    return snapshot.devices.filter((device) => {
      if (kind !== "all" && device.kind !== kind) return false;
      if (placement === "assigned" && !device.locationId) return false;
      if (placement === "unassigned" && device.locationId) return false;
      if (!term) return true;
      const location = locationsById.get(device.locationId);
      return normalize(
        [
          device.displayName,
          device.sourceName,
          device.sourceLocation,
          device.rootType,
          location ? locationLabel(location) : "chưa phân khu",
        ].join(" "),
      ).includes(term);
    });
  }, [kind, locationsById, placement, query, snapshot.devices]);

  const configuredCount = snapshot.devices.filter(
    (device) => device.locationId,
  ).length;

  async function applyResult(
    promise: Promise<ElectricalLayoutActionResult>,
    successTitle: string,
  ) {
    try {
      const result = await promise;
      if (!result.ok) throw new Error(result.message);
      setSnapshot(result.data);
      setSelectedIds((current) =>
        current.filter((id) => result.data.devices.some((device) => device.id === id)),
      );
      toast({ message: result.message, title: successTitle, tone: "success" });
      return true;
    } catch (error) {
      toast({
        message: error instanceof Error ? error.message : undefined,
        title: "Chưa lưu được sơ đồ điện",
        tone: "error",
      });
      return false;
    }
  }

  async function createLocation(formData: FormData) {
    setBusy("Đang thêm vị trí vào sơ đồ tòa nhà...");
    try {
      const ok = await applyResult(
        createElectricalLocationAction({
          area: String(formData.get("area") || ""),
          building: String(formData.get("building") || ""),
          floor: String(formData.get("floor") || ""),
          room: String(formData.get("room") || ""),
        }),
        "Đã thêm vị trí",
      );
      if (ok) {
        const form = document.getElementById(
          "electrical-location-create",
        ) as HTMLFormElement | null;
        form?.reset();
      }
    } finally {
      setBusy("");
    }
  }

  async function updateLocation(formData: FormData) {
    const id = String(formData.get("id") || "");
    setBusy("Đang cập nhật tầng, phòng và khu vực...");
    try {
      const ok = await applyResult(
        updateElectricalLocationAction({
          area: String(formData.get("area") || ""),
          building: String(formData.get("building") || ""),
          floor: String(formData.get("floor") || ""),
          id,
          room: String(formData.get("room") || ""),
        }),
        "Đã cập nhật vị trí",
      );
      if (ok) setEditingLocationId("");
    } finally {
      setBusy("");
    }
  }

  async function removeLocation(id: string) {
    setBusy("Đang xóa khu vực khỏi sơ đồ...");
    try {
      await applyResult(deleteElectricalLocationAction(id), "Đã xóa khu vực");
    } finally {
      setBusy("");
    }
  }

  async function saveDevice(formData: FormData) {
    const deviceId = String(formData.get("deviceId") || "");
    setBusy("Đang lưu tên và vị trí thiết bị...");
    try {
      await applyResult(
        saveElectricalDevicePlacementAction({
          customName: String(formData.get("customName") || ""),
          deviceId,
          locationId: String(formData.get("locationId") || ""),
        }),
        "Đã cập nhật thiết bị",
      );
    } finally {
      setBusy("");
    }
  }

  async function bulkAssign() {
    if (!selectedIds.length) {
      toast({
        message:
          'Đánh dấu “Chọn thiết bị” trên ít nhất một thẻ bên dưới. Nếu chỉ sửa một máy, ông dùng nút Lưu ngay trên thẻ máy đó.',
        title: "Chưa chọn thiết bị",
        tone: "warning",
      });
      return;
    }

    setBusy(`Đang gán vị trí cho ${selectedIds.length} thiết bị...`);
    try {
      const ok = await applyResult(
        bulkAssignElectricalDevicesAction({
          deviceIds: selectedIds,
          locationId: bulkLocationId,
        }),
        "Đã gán vị trí hàng loạt",
      );
      if (ok) setSelectedIds([]);
    } finally {
      setBusy("");
    }
  }

  function toggleDevice(id: string) {
    setSelectedIds((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  }

  function toggleVisible() {
    const visibleIds = visibleDevices.map((device) => device.id);
    const allSelected = visibleIds.every((id) => selectedIds.includes(id));
    setSelectedIds((current) =>
      allSelected
        ? current.filter((id) => !visibleIds.includes(id))
        : [...new Set([...current, ...visibleIds])],
    );
  }

  return (
    <section className="space-y-5" aria-labelledby="electrical-layout-heading">
      <WriteLoadingOverlay message={busy} show={Boolean(busy)} />

      <div className="ui-module-panel overflow-hidden p-0">
        <div className="grid gap-4 border-b border-border bg-gradient-to-r from-brand/[0.08] to-transparent p-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div>
            <Badge tone="info">Sơ đồ vận hành</Badge>
            <h2
              className="mt-2 text-xl font-extrabold text-primary"
              id="electrical-layout-heading"
            >
              Tòa nhà, tầng, phòng và khu vực
            </h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-muted">
              Tạo vị trí chuẩn trước, sau đó đổi tên và gán từng thiết bị. Module
              Quản lý hệ thống điện sẽ tự dựng giao diện điều hướng từ cấu hình này.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl border border-brand/10 bg-white px-4 py-3">
              <strong className="block text-xl text-primary">{snapshot.devices.length}</strong>
              <span className="text-xs font-semibold text-muted">Thiết bị</span>
            </div>
            <div className="rounded-xl border border-brand/10 bg-white px-4 py-3">
              <strong className="block text-xl text-success">{configuredCount}</strong>
              <span className="text-xs font-semibold text-muted">Đã gán</span>
            </div>
            <div className="rounded-xl border border-brand/10 bg-white px-4 py-3">
              <strong className="block text-xl text-warning">
                {snapshot.devices.length - configuredCount}
              </strong>
              <span className="text-xs font-semibold text-muted">Chưa gán</span>
            </div>
          </div>
        </div>

        <div className="grid gap-5 p-5 xl:grid-cols-[360px_minmax(0,1fr)]">
          <div className="space-y-4">
            <form
              action={createLocation}
              className="rounded-xl border border-border bg-surface-muted/35 p-4"
              id="electrical-location-create"
            >
              <div className="flex items-center gap-2 text-sm font-extrabold text-primary">
                <Plus size={17} /> Thêm vị trí
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                <Input name="building" placeholder="Tòa nhà · ví dụ Trụ sở chính" />
                <Input name="floor" placeholder="Tầng · ví dụ Tầng 2" required />
                <Input name="room" placeholder="Phòng · ví dụ Phòng Sáng tạo" required />
                <Input name="area" placeholder="Khu vực · ví dụ Khu bàn họp" required />
              </div>
              <Button className="mt-3 w-full" disabled={Boolean(busy)} type="submit">
                <MapPin size={17} /> Thêm vào sơ đồ
              </Button>
            </form>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <strong className="text-sm text-primary">Danh sách vị trí</strong>
                <Badge tone="neutral">{snapshot.locations.length}</Badge>
              </div>
              {snapshot.locations.length ? (
                snapshot.locations.map((location) =>
                  editingLocationId === location.id ? (
                    <form
                      action={updateLocation}
                      className="space-y-2 rounded-xl border border-brand/20 bg-brand/[0.035] p-3"
                      key={location.id}
                    >
                      <input name="id" type="hidden" value={location.id} />
                      <Input defaultValue={location.building} name="building" required />
                      <Input defaultValue={location.floor} name="floor" required />
                      <Input defaultValue={location.room} name="room" required />
                      <Input defaultValue={location.area} name="area" required />
                      <div className="flex gap-2">
                        <Button className="flex-1" size="sm" type="submit">
                          <Save size={15} /> Lưu
                        </Button>
                        <Button
                          className="flex-1"
                          onClick={() => setEditingLocationId("")}
                          size="sm"
                          variant="secondary"
                        >
                          Hủy
                        </Button>
                      </div>
                    </form>
                  ) : (
                    <article
                      className="rounded-xl border border-border bg-white p-3"
                      key={location.id}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <strong className="block truncate text-sm text-primary">
                            {location.room} · {location.area}
                          </strong>
                          <span className="mt-1 block text-xs leading-5 text-muted">
                            {location.building} · {location.floor}
                          </span>
                        </div>
                        <Badge tone={location.deviceCount ? "info" : "neutral"}>
                          {location.deviceCount}
                        </Badge>
                      </div>
                      <div className="mt-2 flex gap-2">
                        <Button
                          aria-label={`Sửa ${locationLabel(location)}`}
                          className="flex-1"
                          onClick={() => setEditingLocationId(location.id)}
                          size="sm"
                          variant="secondary"
                        >
                          <Pencil size={14} /> Sửa
                        </Button>
                        <form action={() => removeLocation(location.id)} className="flex-1">
                          <ConfirmButton
                            message={`Xóa ${locationLabel(location)}? Chỉ xóa được khi không còn thiết bị bên trong.`}
                            size="sm"
                            title="Xóa vị trí"
                            variant="ghost"
                          >
                            <Trash2 size={14} /> Xóa
                          </ConfirmButton>
                        </form>
                      </div>
                    </article>
                  ),
                )
              ) : (
                <div className="rounded-xl border border-dashed border-border p-4 text-center text-sm leading-6 text-muted">
                  Chưa có vị trí. Hãy tạo tầng, phòng và khu vực đầu tiên.
                </div>
              )}
            </div>
          </div>

          <div className="min-w-0 space-y-4">
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px_180px]">
              <label className="relative block">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
                  size={17}
                />
                <Input
                  className="pl-10"
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Tìm theo tên thiết bị, phòng hoặc khu vực"
                  value={query}
                />
              </label>
              <Select onChange={(event) => setKind(event.target.value)} value={kind}>
                <option value="all">Tất cả thiết bị</option>
                <option value="light">Đèn / công tắc</option>
                <option value="air-conditioner">Máy lạnh</option>
              </Select>
              <Select
                onChange={(event) => setPlacement(event.target.value)}
                value={placement}
              >
                <option value="all">Tất cả vị trí</option>
                <option value="assigned">Đã phân khu</option>
                <option value="unassigned">Chưa phân khu</option>
              </Select>
            </div>

            <div className="space-y-3 rounded-xl border border-brand/15 bg-brand/[0.035] p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="text-sm text-primary">
                      Gán nhanh nhiều thiết bị
                    </strong>
                    <Badge tone="neutral">Không bắt buộc</Badge>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-muted">
                    Đánh dấu “Chọn thiết bị” ở các thẻ bên dưới. Nếu chỉ sửa một
                    máy, chọn khu vực rồi bấm nút Lưu ngay trên thẻ đó.
                  </p>
                </div>
                <Badge tone={selectedIds.length ? "info" : "neutral"}>
                  Đã chọn {selectedIds.length} thiết bị
                </Badge>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <label className="flex cursor-pointer items-center gap-2 text-sm font-bold text-primary">
                  <input
                    checked={
                      visibleDevices.length > 0 &&
                      visibleDevices.every((device) => selectedIds.includes(device.id))
                    }
                    className="size-4 accent-[var(--brand)]"
                    disabled={!visibleDevices.length}
                    onChange={toggleVisible}
                    type="checkbox"
                  />
                  Chọn tất cả kết quả đang lọc
                </label>
                <Select
                  className="min-w-56 flex-1"
                  disabled={!selectedIds.length}
                  onChange={(event) => setBulkLocationId(event.target.value)}
                  value={bulkLocationId}
                >
                  <option value="">Chuyển về Chưa phân khu</option>
                  {snapshot.locations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {locationLabel(location)}
                    </option>
                  ))}
                </Select>
                <Button
                  aria-label={`Gán khu vực cho ${selectedIds.length} thiết bị`}
                  disabled={!selectedIds.length || Boolean(busy)}
                  onClick={bulkAssign}
                  size="sm"
                  title={
                    selectedIds.length
                      ? `Gán khu vực cho ${selectedIds.length} thiết bị đã chọn`
                      : "Hãy chọn ít nhất một thiết bị bên dưới"
                  }
                  variant={selectedIds.length ? "brand" : "secondary"}
                >
                  <Layers3 size={16} /> Gán {selectedIds.length} thiết bị
                </Button>
              </div>
            </div>

            <div className="grid gap-3 2xl:grid-cols-2">
              {visibleDevices.map((device) => {
                const location = locationsById.get(device.locationId);
                const selected = selectedIds.includes(device.id);
                const DeviceIcon =
                  device.kind === "light" ? Lightbulb : Snowflake;
                return (
                  <form
                    action={saveDevice}
                    className={`rounded-xl border bg-white p-4 shadow-[0_10px_28px_rgba(17,76,65,0.06)] transition ${
                      selected
                        ? "border-brand/45 ring-2 ring-brand/10"
                        : "border-border"
                    }`}
                    key={`${device.id}:${device.customName}:${device.locationId}`}
                  >
                    <input name="deviceId" type="hidden" value={device.id} />
                    <div className="flex items-start gap-3">
                      <span className="mt-2 grid size-8 shrink-0 place-items-center rounded-lg bg-brand/[0.08] text-brand-strong">
                        <DeviceIcon size={17} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <strong className="truncate text-sm text-primary">
                            {device.displayName}
                          </strong>
                          <div className="flex flex-wrap items-center gap-2">
                            <label
                              className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs font-bold transition ${
                                selected
                                  ? "border-brand/35 bg-brand/[0.1] text-brand-strong"
                                  : "border-border bg-surface text-primary"
                              }`}
                            >
                              <input
                                checked={selected}
                                className="size-4 accent-[var(--brand)]"
                                onChange={() => toggleDevice(device.id)}
                                type="checkbox"
                              />
                              {selected ? "Đã chọn" : "Chọn thiết bị"}
                            </label>
                            <Badge tone={device.online ? "success" : "neutral"}>
                              {device.online ? "Online" : "Offline"}
                            </Badge>
                          </div>
                        </div>
                        <p className="mt-1 truncate text-xs text-muted">
                          Gốc: {device.sourceName} · {device.sourceLocation || "Hunonic chưa gán phòng"}
                        </p>
                      </div>
                    </div>

                    <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_auto]">
                      <Input
                        defaultValue={device.customName}
                        name="customName"
                        placeholder={device.sourceName || "Tên hiển thị trên Cổng"}
                      />
                      <Select defaultValue={device.locationId} name="locationId">
                        <option value="">Chưa phân khu</option>
                        {snapshot.locations.map((item) => (
                          <option key={item.id} value={item.id}>
                            {locationLabel(item)}
                          </option>
                        ))}
                      </Select>
                      <Button
                        aria-label={`Lưu riêng ${device.displayName}`}
                        disabled={Boolean(busy)}
                        size="icon"
                        title="Lưu riêng tên và khu vực của thiết bị này"
                        type="submit"
                      >
                        <Save size={17} />
                      </Button>
                    </div>
                    <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-muted">
                      {location ? <Building2 size={14} /> : <MapPin size={14} />}
                      {location ? locationLabel(location) : "Thiết bị sẽ nằm trong mục Chưa phân khu"}
                    </p>
                  </form>
                );
              })}
            </div>

            {!visibleDevices.length ? (
              <div className="grid min-h-40 place-items-center rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted">
                Không có thiết bị phù hợp bộ lọc hiện tại.
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
