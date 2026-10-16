"use client";

import {
  Boxes,
  Layers3,
  MapPin,
  Pencil,
  RefreshCw,
  Search,
  Tags,
  Truck,
  Warehouse,
  X,
} from "lucide-react";
import { useMemo, useState, useTransition } from "react";

import { useToast, WriteLoadingOverlay } from "@/components/ui/toast";
import type {
  WarehouseShelfDefinition,
  WarehouseShelfDefinitionUpdate,
  WarehouseShelfEntityType,
} from "@/lib/warehouse/types";

import {
  refreshWarehouseShelfDefinitionsAction,
  updateWarehouseShelfDefinitionAction,
} from "./actions";
import styles from "./warehouse-info.module.css";

type UnitFilter = "ALL" | WarehouseShelfEntityType;

function numberLabel(value: number) {
  return new Intl.NumberFormat("vi-VN").format(value);
}

function timeLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "—";
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function unitLabel(entityType: WarehouseShelfEntityType) {
  return entityType === "VEHICLE" ? "Xe" : "Kệ";
}

function normalizedEpc(value: string) {
  return value.replace(/\s+/g, "").toUpperCase();
}

function RedefineWarehouseUnitModal({
  item,
  onClose,
  onConfirm,
  pending,
}: {
  item: WarehouseShelfDefinition;
  onClose: () => void;
  onConfirm: (input: WarehouseShelfDefinitionUpdate) => void;
  pending: boolean;
}) {
  const [draft, setDraft] = useState<WarehouseShelfDefinitionUpdate>({
    code: item.code,
    entityType: item.entityType,
    epc: item.epc,
    floorCount: item.floorCount,
    name: item.name,
    shelfId: item.shelfId,
    version: item.version,
    warehouse: item.warehouse,
  });
  const epc = normalizedEpc(draft.epc);
  const epcValid =
    /^[0-9A-F]{8,128}$/.test(epc) && epc.length % 2 === 0;
  const floorCountValid =
    draft.entityType === "VEHICLE"
      ? draft.floorCount === 0
      : Number.isInteger(draft.floorCount) &&
        draft.floorCount >= 1 &&
        draft.floorCount <= 20;
  const valid =
    Boolean(draft.code.trim()) &&
    Boolean(draft.name.trim()) &&
    Boolean(draft.warehouse.trim()) &&
    epcValid &&
    floorCountValid;

  return (
    <div className={styles.modalBackdrop} role="presentation">
      <form
        aria-labelledby="redefine-warehouse-unit-title"
        aria-modal="true"
        className={styles.unitModal}
        onSubmit={(event) => {
          event.preventDefault();
          if (!valid) return;
          onConfirm({
            ...draft,
            code: draft.code.trim(),
            epc,
            name: draft.name.trim(),
            warehouse: draft.warehouse.trim(),
          });
        }}
        role="dialog"
      >
        <div className={styles.modalHeader}>
          <div>
            <span>Định nghĩa lại mã Xe/Kệ</span>
            <h2 id="redefine-warehouse-unit-title">
              {unitLabel(item.entityType)} {item.code}
            </h2>
          </div>
          <button
            aria-label="Đóng"
            disabled={pending}
            onClick={onClose}
            type="button"
          >
            <X size={20} />
          </button>
        </div>

        <p className={styles.redefineHint}>
          Sửa tên, mã hiển thị, RFID, khu vực, loại và số tầng. Mã nội bộ được
          giữ nguyên để bảo toàn lịch sử kiểm kê.
        </p>

        <div className={styles.unitFormGrid}>
          <label className={styles.deleteField}>
            <span>Loại đối tượng</span>
            <select
              disabled={pending}
              onChange={(event) => {
                const entityType = event.target
                  .value as WarehouseShelfEntityType;
                setDraft((current) => ({
                  ...current,
                  entityType,
                  floorCount:
                    entityType === "VEHICLE"
                      ? 0
                      : Math.max(1, current.floorCount || 3),
                }));
              }}
              value={draft.entityType}
            >
              <option value="SHELF">Kệ</option>
              <option value="VEHICLE">Xe</option>
            </select>
          </label>
          <label className={styles.deleteField}>
            <span>Số tầng</span>
            <input
              disabled={pending || draft.entityType === "VEHICLE"}
              max={20}
              min={draft.entityType === "VEHICLE" ? 0 : 1}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  floorCount:
                    current.entityType === "VEHICLE"
                      ? 0
                      : Math.max(
                          1,
                          Math.min(20, Math.floor(Number(event.target.value) || 1)),
                        ),
                }))
              }
              type="number"
              value={draft.floorCount}
            />
          </label>
          <label className={styles.deleteField}>
            <span>Mã Xe/Kệ</span>
            <input
              autoFocus
              disabled={pending}
              maxLength={80}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  code: event.target.value,
                }))
              }
              placeholder="Ví dụ: KE-A01 hoặc XE-01"
              required
              value={draft.code}
            />
          </label>
          <label className={styles.deleteField}>
            <span>Tên Xe/Kệ</span>
            <input
              disabled={pending}
              maxLength={160}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
              placeholder="Tên hiển thị trên máy quét và báo cáo"
              required
              value={draft.name}
            />
          </label>
          <label className={styles.deleteField}>
            <span>Khu vực kiểm kê</span>
            <input
              disabled={pending}
              maxLength={120}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  warehouse: event.target.value,
                }))
              }
              placeholder="Ví dụ: Kho tổng"
              required
              value={draft.warehouse}
            />
          </label>
          <label className={styles.deleteField}>
            <span>RFID / EPC</span>
            <input
              aria-invalid={!epcValid}
              disabled={pending}
              maxLength={128}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  epc: event.target.value,
                }))
              }
              placeholder="Chuỗi HEX chẵn, tối thiểu 8 ký tự"
              required
              spellCheck={false}
              value={draft.epc}
            />
          </label>
        </div>

        <div className={styles.unitIdentityNotice}>
          <Tags size={18} />
          <span>
            <strong>Mã nội bộ: {item.shelfId}</strong>
            <small>
              Phiên bản {numberLabel(item.version)} · đổi loại hoặc số tầng sẽ
              yêu cầu máy quét đồng bộ danh mục trước phiên mới.
            </small>
          </span>
        </div>

        <div className={styles.modalActions}>
          <button
            className={styles.secondaryButton}
            disabled={pending}
            onClick={onClose}
            type="button"
          >
            Hủy
          </button>
          <button
            className={styles.primaryButton}
            disabled={pending || !valid}
            type="submit"
          >
            <Pencil size={17} />
            Lưu định nghĩa mới
          </button>
        </div>
      </form>
    </div>
  );
}

export function WarehouseUnitRegistry({
  initialItems,
}: {
  initialItems: WarehouseShelfDefinition[];
}) {
  const [items, setItems] = useState(initialItems);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<UnitFilter>("ALL");
  const [selectedId, setSelectedId] = useState("");
  const [editTarget, setEditTarget] =
    useState<WarehouseShelfDefinition | null>(null);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("vi");
    return items.filter((item) => {
      if (filter !== "ALL" && item.entityType !== filter) return false;
      if (!normalizedQuery) return true;
      return [item.code, item.name, item.warehouse, item.epc, item.shelfId].some(
        (value) => value.toLocaleLowerCase("vi").includes(normalizedQuery),
      );
    });
  }, [filter, items, query]);
  const selectedItem = items.find((item) => item.shelfId === selectedId) ?? null;
  const shelfCount = items.filter((item) => item.entityType === "SHELF").length;
  const vehicleCount = items.length - shelfCount;
  const warehouseCount = new Set(items.map((item) => item.warehouse)).size;

  function refresh() {
    startTransition(async () => {
      const result = await refreshWarehouseShelfDefinitionsAction();
      if (!result.ok || !result.shelves) {
        toast({
          message: result.message,
          title: "Không tải được Xe/Kệ",
          tone: "error",
        });
        return;
      }
      setItems(result.shelves);
      setSelectedId((current) =>
        result.shelves?.some((item) => item.shelfId === current) ? current : "",
      );
      toast({
        message: result.message,
        title: "Danh mục Xe/Kệ đã cập nhật",
        tone: "success",
      });
    });
  }

  function save(input: WarehouseShelfDefinitionUpdate) {
    startTransition(async () => {
      const result = await updateWarehouseShelfDefinitionAction(input);
      if (!result.ok || !result.shelf || !result.shelves) {
        toast({
          message: result.message,
          title: "Không định nghĩa lại được Xe/Kệ",
          tone: "error",
        });
        return;
      }
      setItems(result.shelves);
      setSelectedId("");
      setEditTarget(null);
      toast({
        message: result.message,
        title: "Đã định nghĩa lại Xe/Kệ",
        tone: "success",
      });
    });
  }

  return (
    <>
      <WriteLoadingOverlay
        message="Đang cập nhật định nghĩa Xe/Kệ trong PostgreSQL..."
        show={pending}
      />

      <section className={styles.summaryGrid}>
        <article className={styles.summaryCard}>
          <span className={styles.summaryIcon}>
            <Boxes size={22} />
          </span>
          <div>
            <strong>{numberLabel(items.length)}</strong>
            <span>Tổng mã Xe/Kệ</span>
          </div>
        </article>
        <article className={`${styles.summaryCard} ${styles.summaryActive}`}>
          <span className={styles.summaryIcon}>
            <Layers3 size={22} />
          </span>
          <div>
            <strong>{numberLabel(shelfCount)}</strong>
            <span>Kệ đã định nghĩa</span>
          </div>
        </article>
        <article className={styles.summaryCard}>
          <span className={styles.summaryIcon}>
            <Truck size={22} />
          </span>
          <div>
            <strong>{numberLabel(vehicleCount)}</strong>
            <span>Xe đã định nghĩa</span>
          </div>
        </article>
        <article className={styles.summaryCard}>
          <span className={styles.summaryIcon}>
            <MapPin size={22} />
          </span>
          <div>
            <strong>{numberLabel(warehouseCount)}</strong>
            <span>Khu vực kiểm kê</span>
          </div>
        </article>
      </section>

      <section className={styles.toolbar}>
        <form
          className={styles.searchForm}
          onSubmit={(event) => event.preventDefault()}
        >
          <label htmlFor="warehouse-unit-search">Tìm Xe/Kệ</label>
          <div>
            <Search size={19} />
            <input
              id="warehouse-unit-search"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Tìm theo RFID, mã, tên, khu vực hoặc mã nội bộ..."
              value={query}
            />
          </div>
        </form>
        <div className={styles.statusFilter}>
          <span>Loại đối tượng</span>
          <div>
            {(
              [
                ["ALL", "Tất cả"],
                ["SHELF", "Kệ"],
                ["VEHICLE", "Xe"],
              ] as const
            ).map(([key, label]) => (
              <button
                className={filter === key ? styles.filterActive : ""}
                key={key}
                onClick={() => setFilter(key)}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <button
          aria-label="Tải lại danh mục Xe/Kệ"
          className={styles.refreshButton}
          disabled={pending}
          onClick={refresh}
          title="Tải lại"
          type="button"
        >
          <RefreshCw size={21} />
        </button>
      </section>

      <section className={styles.unitRegistryPanel}>
        <div className={styles.registryHeader}>
          <div>
            <span>Danh mục định nghĩa RFID vị trí</span>
            <h2>Xe và Kệ trong kho</h2>
            <p>
              {numberLabel(filteredItems.length)} kết quả · cập nhật tên và cấu
              hình mà vẫn giữ nguyên lịch sử kiểm kê
            </p>
          </div>
          {selectedItem ? (
            <div className={styles.selectionActions}>
              <span>Đã chọn {unitLabel(selectedItem.entityType)} {selectedItem.code}</span>
              <button
                aria-label={`Định nghĩa lại ${selectedItem.code}`}
                className={styles.redefineSelectionButton}
                onClick={() => setEditTarget(selectedItem)}
                title="Định nghĩa lại mã Xe/Kệ"
                type="button"
              >
                <Pencil size={18} />
              </button>
            </div>
          ) : null}
        </div>

        <div className={styles.tableWrap}>
          <table className={`${styles.table} ${styles.unitTable}`}>
            <thead>
              <tr>
                <th className={styles.selectCell} aria-label="Chọn" />
                <th>RFID / EPC</th>
                <th>Loại / Mã</th>
                <th>Tên hiển thị</th>
                <th>Khu vực</th>
                <th>Cấu hình</th>
                <th>Cập nhật</th>
                <th aria-label="Thao tác" />
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((item) => {
                const selected = selectedId === item.shelfId;
                return (
                  <tr className={selected ? styles.unitRowSelected : ""} key={item.shelfId}>
                    <td className={styles.selectCell}>
                      <input
                        aria-label={`Chọn ${unitLabel(item.entityType)} ${item.code}`}
                        checked={selected}
                        onChange={() =>
                          setSelectedId((current) =>
                            current === item.shelfId ? "" : item.shelfId,
                          )
                        }
                        type="checkbox"
                      />
                    </td>
                    <td>
                      <code className={styles.epc}>{item.epc}</code>
                    </td>
                    <td>
                      <span
                        className={`${styles.unitTypeBadge} ${
                          item.entityType === "VEHICLE"
                            ? styles.unitVehicleBadge
                            : styles.unitShelfBadge
                        }`}
                      >
                        {item.entityType === "VEHICLE" ? (
                          <Truck size={14} />
                        ) : (
                          <Warehouse size={14} />
                        )}
                        {unitLabel(item.entityType)}
                      </span>
                      <strong>{item.code}</strong>
                    </td>
                    <td>
                      <strong>{item.name}</strong>
                      <span>Mã nội bộ: {item.shelfId}</span>
                    </td>
                    <td>
                      <span className={styles.unitWarehouse}>
                        <MapPin size={14} /> {item.warehouse}
                      </span>
                    </td>
                    <td>
                      <strong>
                        {item.entityType === "SHELF"
                          ? `${numberLabel(item.floorCount)} tầng`
                          : "Không chia tầng"}
                      </strong>
                      <span>Phiên bản {numberLabel(item.version)}</span>
                    </td>
                    <td>{timeLabel(item.updatedAt)}</td>
                    <td>
                      <button
                        aria-label={`Sửa định nghĩa ${item.code}`}
                        className={styles.unitEditButton}
                        onClick={() => setEditTarget(item)}
                        title="Sửa định nghĩa"
                        type="button"
                      >
                        <Pencil size={16} />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {!filteredItems.length ? (
                <tr>
                  <td className={styles.emptyTable} colSpan={8}>
                    <Warehouse size={28} />
                    <strong>Không có Xe/Kệ phù hợp</strong>
                    <span>Thử đổi từ khóa hoặc bộ lọc loại đối tượng.</span>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {editTarget ? (
        <RedefineWarehouseUnitModal
          item={editTarget}
          onClose={() => setEditTarget(null)}
          onConfirm={save}
          pending={pending}
        />
      ) : null}
    </>
  );
}
