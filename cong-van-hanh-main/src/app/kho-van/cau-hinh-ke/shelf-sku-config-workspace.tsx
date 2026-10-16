"use client";

import {
  Barcode,
  CheckCircle2,
  Layers3,
  MapPin,
  Pencil,
  Plus,
  Printer,
  RefreshCw,
  Save,
  Search,
  Tags,
  Truck,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useToast, WriteLoadingOverlay } from "@/components/ui/toast";
import type {
  ShelfSkuConfigWorkspace as WorkspaceData,
  ShelfSkuGroupCandidate,
} from "@/lib/warehouse/shelf-config-types";
import {
  MAX_SHELF_SKU_GROUPS,
  shelfSkuFamily,
} from "@/lib/warehouse/shelf-sku";
import type {
  WarehouseShelfDefinition,
  WarehouseShelfEntityType,
} from "@/lib/warehouse/types";
import { Code128Barcode } from "../cau-hinh/code128";
import {
  refreshShelfSkuConfigAction,
  saveWarehouseStorageUnitAction,
  searchShelfSkuGroupsAction,
  updateShelfSkuConfigAction,
} from "./actions";
import styles from "./shelf-sku-config.module.css";

type UnitDraft = {
  code: string;
  entityType: WarehouseShelfEntityType;
  floorCount: number;
  name: string;
  shelfId?: string;
  version?: number;
  warehouse: string;
};

const EMPTY_UNIT: UnitDraft = {
  code: "",
  entityType: "SHELF",
  floorCount: 3,
  name: "",
  warehouse: "",
};
const unitLabel = (item: WarehouseShelfDefinition) =>
  item.entityType === "VEHICLE" ? "Xe" : "Kệ";
const numberLabel = (value: number) =>
  new Intl.NumberFormat("vi-VN").format(value);
const timeLabel = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("vi-VN", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(value))
    : "Chưa cấu hình";
const floorsFor = (item: WarehouseShelfDefinition) =>
  Object.fromEntries(
    item.skuGroups.map((group) => [
      group,
      item.skuFloors[group] ?? item.floorCount,
    ]),
  );

export function ShelfSkuConfigWorkspace({
  initialData,
}: {
  initialData: WorkspaceData;
}) {
  const initialShelf = initialData.shelves[0];
  const [data, setData] = useState(initialData);
  const [query, setQuery] = useState("");
  const [warehouse, setWarehouse] = useState("ALL");
  const [selectedId, setSelectedId] = useState(initialShelf?.shelfId ?? "");
  const [draftGroups, setDraftGroups] = useState(initialShelf?.skuGroups ?? []);
  const [draftFloors, setDraftFloors] = useState<Record<string, number>>(
    initialShelf ? floorsFor(initialShelf) : {},
  );
  const [draftGroupNames, setDraftGroupNames] = useState<
    Record<string, string>
  >(initialData.skuGroupNames);
  const [skuQuery, setSkuQuery] = useState("");
  const [candidates, setCandidates] = useState<ShelfSkuGroupCandidate[]>([]);
  const [unitDraft, setUnitDraft] = useState<UnitDraft | null>(null);
  const [printIds, setPrintIds] = useState<Set<string>>(new Set());
  const [printOpen, setPrintOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const warehouses = useMemo(
    () =>
      [...new Set(data.shelves.map((item) => item.warehouse))].sort((a, b) =>
        a.localeCompare(b, "vi"),
      ),
    [data.shelves],
  );
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("vi");
    return data.shelves.filter((item) => {
      if (warehouse !== "ALL" && item.warehouse !== warehouse) return false;
      return (
        !normalized ||
        [
          item.barcode,
          item.code,
          item.name,
          item.warehouse,
          unitLabel(item),
          ...item.skuGroups,
        ].some((value) => value.toLocaleLowerCase("vi").includes(normalized))
      );
    });
  }, [data.shelves, query, warehouse]);
  const selected =
    data.shelves.find((item) => item.shelfId === selectedId) ?? null;
  const selectedForPrint = data.shelves.filter((item) =>
    printIds.has(item.shelfId),
  );
  const shelfCount = data.shelves.filter(
    (item) => item.entityType === "SHELF",
  ).length;
  const vehicleCount = data.shelves.length - shelfCount;
  const configuredCount = data.shelves.filter(
    (item) => item.entityType === "SHELF" && item.skuGroups.length > 0,
  ).length;
  const dirty =
    Boolean(selected?.entityType === "SHELF") &&
    (JSON.stringify(draftGroups) !== JSON.stringify(selected?.skuGroups) ||
      JSON.stringify(draftFloors) !==
        JSON.stringify(selected ? floorsFor(selected) : {}));
  const allFilteredSelected =
    filtered.length > 0 && filtered.every((item) => printIds.has(item.shelfId));
  const floorRows =
    selected?.entityType === "SHELF"
      ? Array.from(
          { length: selected.floorCount },
          (_, index) => selected.floorCount - index,
        ).map((floor) => ({
          floor,
          groups: draftGroups.filter((group) => draftFloors[group] === floor),
        }))
      : [];

  useEffect(() => {
    if (!selected) return;
    setDraftGroups(selected.skuGroups);
    setDraftFloors(floorsFor(selected));
    setDraftGroupNames(data.skuGroupNames);
    setCandidates([]);
    setSkuQuery("");
  }, [data.skuGroupNames, selected]);

  function selectUnit(shelfId: string) {
    if (dirty && !window.confirm("Bỏ các thay đổi nhóm SKU và tầng chưa lưu?"))
      return;
    setSelectedId(shelfId);
  }

  function addGroup(value: string, displayName = "") {
    const group = shelfSkuFamily(value);
    if (!group)
      return void toast({
        message: "SKU phải bắt đầu bằng chữ, ví dụ CSTN10-5.",
        title: "Chưa lấy được nhóm SKU",
        tone: "error",
      });
    if (draftGroups.includes(group)) return;
    if (draftGroups.length >= MAX_SHELF_SKU_GROUPS)
      return void toast({
        message:
          "Xóa một nhóm cũ trước khi thêm nhóm mới. Mỗi kệ tối đa 6 nhóm.",
        title: "Đã đủ nhóm SKU",
        tone: "error",
      });
    setDraftGroups((current) => [...current, group]);
    setDraftFloors((current) => ({
      ...current,
      [group]: selected?.floorCount ?? 1,
    }));
    if (displayName) {
      setDraftGroupNames((current) => ({ ...current, [group]: displayName }));
    }
  }

  function removeGroup(group: string) {
    setDraftGroups((current) => current.filter((item) => item !== group));
    setDraftFloors((current) => {
      const next = { ...current };
      delete next[group];
      return next;
    });
  }

  function resetConfiguration() {
    if (!selected) return;
    setDraftGroups(selected.skuGroups);
    setDraftFloors(floorsFor(selected));
    setDraftGroupNames(data.skuGroupNames);
  }

  function searchGroups() {
    if (!skuQuery.trim()) return;
    startTransition(async () => {
      const result = await searchShelfSkuGroupsAction(skuQuery);
      if (!result.ok)
        return void toast({
          message: result.message,
          title: "Không tìm được SKU",
          tone: "error",
        });
      setCandidates(result.candidates ?? []);
      setDraftGroupNames((current) => ({
        ...current,
        ...Object.fromEntries(
          (result.candidates ?? []).map((candidate) => [
            candidate.group,
            candidate.displayName,
          ]),
        ),
      }));
      if (!result.candidates?.length)
        toast({
          message: result.message,
          title: "Không có kết quả",
          tone: "info",
        });
    });
  }

  function refresh() {
    startTransition(async () => {
      const result = await refreshShelfSkuConfigAction();
      if (!result.ok || !result.data)
        return void toast({
          message: result.message,
          title: "Không tải được cấu hình",
          tone: "error",
        });
      setData(result.data);
      setSelectedId((current) =>
        result.data?.shelves.some((item) => item.shelfId === current)
          ? current
          : (result.data?.shelves[0]?.shelfId ?? ""),
      );
      setPrintIds(
        (current) =>
          new Set(
            [...current].filter((id) =>
              result.data?.shelves.some((item) => item.shelfId === id),
            ),
          ),
      );
      toast({ message: result.message, title: "Đã làm mới", tone: "success" });
    });
  }

  function saveGroups() {
    if (!selected || selected.entityType !== "SHELF" || !dirty) return;
    if (
      !draftGroups.length &&
      !window.confirm(
        "Lưu kệ không có nhóm SKU? Máy quét sẽ chưa cho chốt kiểm kê kệ này.",
      )
    )
      return;
    startTransition(async () => {
      const result = await updateShelfSkuConfigAction({
        shelfId: selected.shelfId,
        skuGroups: draftGroups,
        skuFloors: draftFloors,
        version: selected.skuConfigurationVersion,
      });
      if (!result.ok || !result.data)
        return void toast({
          message: result.message,
          title: "Không lưu được cấu hình",
          tone: "error",
        });
      setData(result.data);
      toast({
        message: result.message,
        title: `Đã cập nhật ${selected.name}`,
        tone: "success",
      });
    });
  }

  function openEdit(item?: WarehouseShelfDefinition) {
    setUnitDraft(
      item
        ? {
            code: item.code,
            entityType: item.entityType,
            floorCount: item.floorCount,
            name: item.name,
            shelfId: item.shelfId,
            version: item.version,
            warehouse: item.warehouse,
          }
        : { ...EMPTY_UNIT, warehouse: warehouses[0] ?? "" },
    );
  }

  function saveUnit() {
    if (!unitDraft) return;
    if (
      !unitDraft.code.trim() ||
      !unitDraft.name.trim() ||
      !unitDraft.warehouse.trim()
    )
      return void toast({
        message: "Nhập đủ mã, tên và Khu vực kiểm kê.",
        title: "Thiếu thông tin",
        tone: "error",
      });
    if (
      unitDraft.entityType === "SHELF" &&
      (unitDraft.floorCount < 1 || unitDraft.floorCount > 20)
    )
      return void toast({
        message: "Số tầng của Kệ phải từ 1 đến 20.",
        title: "Số tầng không hợp lệ",
        tone: "error",
      });
    startTransition(async () => {
      const result = await saveWarehouseStorageUnitAction(unitDraft);
      if (!result.ok || !result.shelves || !result.shelf)
        return void toast({
          message: result.message,
          title: "Không lưu được Kệ/Xe",
          tone: "error",
        });
      setData({
        generatedAt: new Date().toISOString(),
        shelves: result.shelves,
        skuGroupNames: data.skuGroupNames,
      });
      setSelectedId(result.shelf.shelfId);
      setUnitDraft(null);
      toast({
        message: result.message,
        title: "Đã lưu Kệ/Xe",
        tone: "success",
      });
    });
  }

  function togglePrint(id: string) {
    setPrintIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllFiltered() {
    setPrintIds((current) => {
      const next = new Set(current);
      filtered.forEach((item) =>
        allFilteredSelected
          ? next.delete(item.shelfId)
          : next.add(item.shelfId),
      );
      return next;
    });
  }

  function printLabels() {
    document.body.dataset.shelfLabelPrint = "true";
    const cleanup = () => {
      delete document.body.dataset.shelfLabelPrint;
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);
    window.print();
    window.setTimeout(cleanup, 1500);
  }

  return (
    <div className={styles.workspace}>
      <WriteLoadingOverlay
        message="Đang cập nhật danh mục Kệ/Xe..."
        show={pending}
      />
      <header className={styles.hero}>
        <div>
          <span className={styles.eyebrow}>
            Kho vận · Danh mục và tem Barcode
          </span>
          <h1>Cấu hình Kệ/Xe</h1>
          <p>
            Tạo Kệ hoặc Xe tại đây. Cổng tự sinh Barcode để in tem Tommy 133.
            Mỗi Kệ được cấu hình tối đa 6 nhóm SKU và tầng mặc định để máy quét
            tự sắp trước khi người kiểm kê xác nhận.
          </p>
        </div>
        <div className={styles.heroActions}>
          <button
            className={styles.createButton}
            disabled={pending}
            onClick={() => openEdit()}
            type="button"
          >
            <Plus size={18} /> Tạo Kệ/Xe
          </button>
          <button
            aria-label="Tải lại cấu hình"
            className={styles.iconButton}
            disabled={pending}
            onClick={refresh}
            type="button"
          >
            <RefreshCw size={20} />
          </button>
        </div>
      </header>
      <section className={styles.summaryGrid}>
        <article>
          <Layers3 size={22} />
          <div>
            <strong>{numberLabel(shelfCount)}</strong>
            <span>Kệ đã định nghĩa</span>
          </div>
        </article>
        <article>
          <Truck size={22} />
          <div>
            <strong>{numberLabel(vehicleCount)}</strong>
            <span>Xe đã định nghĩa</span>
          </div>
        </article>
        <article>
          <CheckCircle2 size={22} />
          <div>
            <strong>{numberLabel(configuredCount)}</strong>
            <span>Kệ đã cấu hình SKU–tầng</span>
          </div>
        </article>
      </section>
      <section className={styles.printToolbar}>
        <label>
          <input
            checked={allFilteredSelected}
            onChange={toggleAllFiltered}
            type="checkbox"
          />{" "}
          Chọn tất cả đang lọc
        </label>
        <span>{printIds.size} Kệ/Xe đã chọn</span>
        <button
          disabled={!printIds.size}
          onClick={() => setPrintOpen(true)}
          type="button"
        >
          <Printer size={17} /> In tem Tommy 133
        </button>
      </section>
      <section className={styles.layout}>
        <div className={styles.listPanel}>
          <div className={styles.panelTitle}>
            <div>
              <span>Danh mục Kệ/Xe</span>
              <h2>Chọn đơn vị cần cấu hình</h2>
            </div>
          </div>
          <div className={styles.filters}>
            <label>
              <Search size={18} />
              <input
                aria-label="Tìm Kệ/Xe"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Tên, mã, Barcode, khu vực..."
                value={query}
              />
            </label>
            <select
              aria-label="Lọc khu vực"
              onChange={(event) => setWarehouse(event.target.value)}
              value={warehouse}
            >
              <option value="ALL">Tất cả khu vực</option>
              {warehouses.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.shelfList}>
            {filtered.map((item) => (
              <div
                className={
                  item.shelfId === selectedId ? styles.shelfActive : ""
                }
                key={item.shelfId}
              >
                <input
                  aria-label={`Chọn in ${item.name}`}
                  checked={printIds.has(item.shelfId)}
                  onChange={() => togglePrint(item.shelfId)}
                  type="checkbox"
                />
                <button onClick={() => selectUnit(item.shelfId)} type="button">
                  <span>
                    <strong>{item.name}</strong>
                    <small>
                      {unitLabel(item)} · {item.code} · {item.barcode}
                    </small>
                  </span>
                  <span
                    className={
                      item.entityType === "VEHICLE" || item.skuGroups.length
                        ? styles.configured
                        : styles.unconfigured
                    }
                  >
                    {item.entityType === "VEHICLE"
                      ? "Lấy tất cả SKU"
                      : `${item.floorCount} tầng · ${item.skuGroups.length}/6`}
                  </span>
                </button>
              </div>
            ))}
            {!filtered.length ? (
              <p className={styles.empty}>Không có Kệ/Xe phù hợp bộ lọc.</p>
            ) : null}
          </div>
        </div>
        <div className={styles.editorPanel}>
          {selected ? (
            <>
              <div className={styles.panelTitle}>
                <div>
                  <span>{unitLabel(selected)} đang chọn</span>
                  <h2>{selected.name}</h2>
                  <p>
                    <MapPin size={14} /> {selected.warehouse} · {selected.code}{" "}
                    ·{" "}
                    {selected.entityType === "SHELF"
                      ? `${selected.floorCount} tầng`
                      : "không tầng"}
                  </p>
                </div>
                <button
                  className={styles.editButton}
                  onClick={() => openEdit(selected)}
                  type="button"
                >
                  <Pencil size={16} /> Sửa
                </button>
              </div>
              <div className={styles.barcodeCard}>
                <div>
                  <Barcode size={20} />
                  <span>Barcode nhận diện</span>
                  <strong>{selected.barcode}</strong>
                </div>
                <Code128Barcode value={selected.barcode} />
              </div>
              {selected.entityType === "SHELF" ? (
                <>
                  <div className={styles.groupSection}>
                    <div className={styles.sectionHeading}>
                      <div>
                        <h3>Nhóm SKU và tầng mặc định</h3>
                        <p>
                          {draftGroups.length}/{MAX_SHELF_SKU_GROUPS} nhóm · bấm
                          số tầng để chuyển nhanh từng nhóm
                        </p>
                      </div>
                      <span className={styles.version}>
                        Phiên bản {selected.skuConfigurationVersion}
                        <small>{timeLabel(selected.skuConfiguredAt)}</small>
                      </span>
                    </div>
                    <div className={styles.floorLayout}>
                      {floorRows.map(({ floor, groups }) => (
                        <section className={styles.floorRow} key={floor}>
                          <div className={styles.floorLabel}>
                            <strong>Tầng {floor}</strong>
                            <span>{groups.length} nhóm SKU</span>
                          </div>
                          <div className={styles.floorSkuList}>
                            {groups.map((group) => (
                              <article className={styles.skuCard} key={group}>
                                <div className={styles.groupName}>
                                  <Tags size={15} />
                                  <div>
                                    <strong>{group}</strong>
                                    <span title={draftGroupNames[group]}>
                                      {draftGroupNames[group] ||
                                        "Chưa có tên dòng sản phẩm"}
                                    </span>
                                  </div>
                                  <button
                                    aria-label={`Xóa nhóm ${group}`}
                                    onClick={() => removeGroup(group)}
                                    type="button"
                                  >
                                    <X size={15} />
                                  </button>
                                </div>
                                <div className={styles.floorControls}>
                                  <small>Chuyển tầng</small>
                                  <div
                                    aria-label={`Tầng mặc định của ${group}`}
                                    className={styles.floorBubbles}
                                  >
                                    {Array.from(
                                      { length: selected.floorCount },
                                      (_, index) => selected.floorCount - index,
                                    ).map((targetFloor) => (
                                      <button
                                        aria-label={`Chuyển ${group} sang tầng ${targetFloor}`}
                                        aria-pressed={floor === targetFloor}
                                        className={
                                          floor === targetFloor
                                            ? styles.floorActive
                                            : ""
                                        }
                                        key={targetFloor}
                                        onClick={() =>
                                          setDraftFloors((current) => ({
                                            ...current,
                                            [group]: targetFloor,
                                          }))
                                        }
                                        type="button"
                                      >
                                        {targetFloor}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              </article>
                            ))}
                            {!groups.length ? (
                              <span className={styles.emptyFloor}>
                                Chưa xếp nhóm SKU vào tầng này
                              </span>
                            ) : null}
                          </div>
                        </section>
                      ))}
                      {!draftGroups.length ? (
                        <p className={styles.warning}>
                          Kệ chưa có nhóm SKU. Máy quét sẽ yêu cầu cấu hình
                          trước khi thống kê.
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <form
                    className={styles.productSearch}
                    onSubmit={(event) => {
                      event.preventDefault();
                      searchGroups();
                    }}
                  >
                    <label htmlFor="shelf-sku-search">
                      Tìm trong danh mục hàng hóa
                    </label>
                    <div>
                      <Search size={19} />
                      <input
                        id="shelf-sku-search"
                        onChange={(event) => setSkuQuery(event.target.value)}
                        placeholder="Nhập SKU hoặc tên hàng, ví dụ CSTN10-5..."
                        value={skuQuery}
                      />
                      <button
                        disabled={pending || !skuQuery.trim()}
                        type="submit"
                      >
                        Tìm
                      </button>
                    </div>
                    {skuQuery.trim() ? (
                      <button
                        className={styles.quickAdd}
                        disabled={draftGroups.length >= MAX_SHELF_SKU_GROUPS}
                        onClick={() => addGroup(skuQuery)}
                        type="button"
                      >
                        <Plus size={16} /> Thêm nhóm{" "}
                        {shelfSkuFamily(skuQuery) || "từ mã đã nhập"}
                      </button>
                    ) : null}
                  </form>
                  {candidates.length ? (
                    <div className={styles.results}>
                      {candidates.map((candidate) => (
                        <article key={candidate.group}>
                          <div>
                            <strong>{candidate.group}</strong>
                            <b>{candidate.displayName}</b>
                            <span>{candidate.productCount} mã mẫu</span>
                          </div>
                          <p>
                            {candidate.examples
                              .map((item) => `${item.sku} · ${item.name}`)
                              .join(" | ")}
                          </p>
                          <button
                            disabled={
                              draftGroups.includes(candidate.group) ||
                              draftGroups.length >= MAX_SHELF_SKU_GROUPS
                            }
                            onClick={() =>
                              addGroup(candidate.group, candidate.displayName)
                            }
                            type="button"
                          >
                            {draftGroups.includes(candidate.group)
                              ? "Đã thêm"
                              : "Thêm nhóm"}
                          </button>
                        </article>
                      ))}
                    </div>
                  ) : null}
                  <div className={styles.actions}>
                    <button
                      disabled={!dirty || pending}
                      onClick={resetConfiguration}
                      type="button"
                    >
                      Hoàn tác
                    </button>
                    <button
                      className={styles.saveButton}
                      disabled={!dirty || pending}
                      onClick={saveGroups}
                      type="button"
                    >
                      <Save size={17} /> Lưu SKU và tầng
                    </button>
                  </div>
                </>
              ) : (
                <div className={styles.vehicleNote}>
                  <Truck size={24} />
                  <div>
                    <strong>Xe không cần cấu hình SKU</strong>
                    <span>
                      Mỗi lần kiểm kê, máy quét lấy toàn bộ hàng hóa RFID quét
                      được trên Xe; không lọc theo nhóm SKU và không chia tầng.
                    </span>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className={styles.emptyEditor}>
              <Layers3 size={34} />
              <strong>Chưa có Kệ/Xe</strong>
              <span>Bấm Tạo Kệ/Xe để khai báo và sinh Barcode đầu tiên.</span>
            </div>
          )}
        </div>
      </section>
      {unitDraft ? (
        <div className={styles.modalBackdrop} role="presentation">
          <section aria-modal="true" className={styles.unitModal} role="dialog">
            <header>
              <div>
                <span>
                  {unitDraft.shelfId
                    ? "Cập nhật danh mục"
                    : "Tạo mới trên Cổng vận hành"}
                </span>
                <h2>{unitDraft.shelfId ? "Sửa Kệ/Xe" : "Tạo Kệ/Xe"}</h2>
              </div>
              <button
                aria-label="Đóng"
                onClick={() => setUnitDraft(null)}
                type="button"
              >
                <X />
              </button>
            </header>
            <div className={styles.unitForm}>
              <label>
                Loại
                <select
                  onChange={(event) =>
                    setUnitDraft(
                      (current) =>
                        current && {
                          ...current,
                          entityType: event.target
                            .value as WarehouseShelfEntityType,
                          floorCount:
                            event.target.value === "VEHICLE"
                              ? 0
                              : Math.max(current.floorCount, 3),
                        },
                    )
                  }
                  value={unitDraft.entityType}
                >
                  <option value="SHELF">Kệ</option>
                  <option value="VEHICLE">Xe</option>
                </select>
              </label>
              <label>
                Mã Kệ/Xe
                <input
                  maxLength={80}
                  onChange={(event) =>
                    setUnitDraft(
                      (current) =>
                        current && { ...current, code: event.target.value },
                    )
                  }
                  placeholder="Ví dụ A1"
                  value={unitDraft.code}
                />
              </label>
              <label>
                Tên hiển thị
                <input
                  maxLength={160}
                  onChange={(event) =>
                    setUnitDraft(
                      (current) =>
                        current && { ...current, name: event.target.value },
                    )
                  }
                  placeholder="Ví dụ Kệ A1"
                  value={unitDraft.name}
                />
              </label>
              <label>
                Khu vực kiểm kê
                <input
                  list="warehouse-options"
                  maxLength={120}
                  onChange={(event) =>
                    setUnitDraft(
                      (current) =>
                        current && {
                          ...current,
                          warehouse: event.target.value,
                        },
                    )
                  }
                  placeholder="Cùng khu vực của Kiểm kê thông thường"
                  value={unitDraft.warehouse}
                />
                <datalist id="warehouse-options">
                  {warehouses.map((item) => (
                    <option key={item} value={item} />
                  ))}
                </datalist>
              </label>
              {unitDraft.entityType === "SHELF" ? (
                <label>
                  Số tầng
                  <input
                    max={20}
                    min={1}
                    onChange={(event) =>
                      setUnitDraft(
                        (current) =>
                          current && {
                            ...current,
                            floorCount: Number(event.target.value),
                          },
                      )
                    }
                    type="number"
                    value={unitDraft.floorCount}
                  />
                </label>
              ) : (
                <p className={styles.noFloor}>
                  <Truck size={18} /> Xe không có tầng.
                </p>
              )}
              <p className={styles.autoBarcode}>
                <Barcode size={18} /> Barcode riêng sẽ được hệ thống tự sinh khi
                lưu và giữ nguyên khi chỉnh sửa.
              </p>
            </div>
            <footer>
              <button onClick={() => setUnitDraft(null)} type="button">
                Hủy
              </button>
              <button
                className={styles.saveButton}
                disabled={pending}
                onClick={saveUnit}
                type="button"
              >
                <Save size={17} /> Lưu Kệ/Xe
              </button>
            </footer>
          </section>
        </div>
      ) : null}
      {printOpen ? (
        <div className={styles.modalBackdrop} role="presentation">
          <section
            aria-modal="true"
            className={styles.printModal}
            role="dialog"
          >
            <header>
              <div>
                <span>Tem Tommy 133 · 16 tem/tờ</span>
                <h2>Xem trước {selectedForPrint.length} mã Kệ/Xe</h2>
              </div>
              <button
                aria-label="Đóng"
                onClick={() => setPrintOpen(false)}
                type="button"
              >
                <X />
              </button>
            </header>
            <p>
              Tem hiển thị tên nổi bật và Barcode riêng để máy quét nhận đúng
              Kệ/Xe.
            </p>
            <div className={styles.printPreview}>
              {selectedForPrint.map((item) => (
                <article key={item.shelfId}>
                  <strong>{item.name}</strong>
                  <span>
                    {unitLabel(item)} · {item.code}
                  </span>
                  <div>
                    <Code128Barcode value={item.barcode} />
                  </div>
                  <b>{item.barcode}</b>
                  <small>
                    {item.warehouse}
                    {item.entityType === "SHELF"
                      ? ` · ${item.floorCount} tầng`
                      : ""}
                  </small>
                </article>
              ))}
            </div>
            <footer>
              <button onClick={() => setPrintOpen(false)} type="button">
                Quay lại
              </button>
              <button
                className={styles.saveButton}
                onClick={printLabels}
                type="button"
              >
                <Printer size={17} /> In tem
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </div>
  );
}
