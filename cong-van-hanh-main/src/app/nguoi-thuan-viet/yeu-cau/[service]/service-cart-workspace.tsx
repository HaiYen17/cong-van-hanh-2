"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ImageIcon, Plus, Trash2 } from "lucide-react";

import { Badge, Button, Input, Select } from "@/components/ui";
import { FilePicker } from "@/components/ui/file-picker";
import { useToast, WriteLoadingOverlay } from "@/components/ui/toast";

import {
  submitRequestAction,
  type RequestActionState,
} from "@/app/thuc-thi/actions";
import {
  ALLOCATION_CATEGORY,
  type AllocationCatalogItem,
} from "@/lib/assets/allocation-catalog";
import type { AllocationImportEmployee } from "@/lib/assets/allocation-import";

import { AllocationFileImport } from "./allocation-file-import";

type EmployeeOption = AllocationImportEmployee;

type ServiceKind = "asset-allocation" | "repair-request" | "support-request";

type DraftItem = {
  assignee?: string;
  assigneeId?: string;
  category?: string;
  damage?: string;
  description?: string;
  estimatedHours?: string;
  itemCode?: string;
  itemName?: string;
  quantity?: string;
  supportType?: string;
  urgent?: boolean;
};

const initialState: RequestActionState = {};

const DEFINITION: Record<
  ServiceKind,
  {
    badge: string;
    title: string;
    submitLabel: string;
    addLabel: string;
  }
> = {
  "asset-allocation": {
    addLabel: "Thêm vào danh sách",
    badge: "Tạo đề xuất cấp phát",
    submitLabel: "Nộp đăng ký",
    title: "Đề xuất cấp phát hàng hóa/CCDC",
  },
  "repair-request": {
    addLabel: "Thêm vào danh sách",
    badge: "Tạo yêu cầu sửa chữa",
    submitLabel: "Nộp đề xuất",
    title: "Yêu cầu sửa chữa, bảo trì",
  },
  "support-request": {
    addLabel: "Thêm vào danh sách",
    badge: "Tạo yêu cầu hỗ trợ",
    submitLabel: "Nộp yêu cầu",
    title: "Yêu cầu hỗ trợ",
  },
};

function Field({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <label className="ui-module-field">
      <span className="ui-module-label">{label}</span>
      {children}
    </label>
  );
}

function blankItem(kind: ServiceKind): DraftItem {
  if (kind === "asset-allocation") {
    return { category: "", itemName: "", description: "", quantity: "1", assignee: "" };
  }
  if (kind === "repair-request") {
    return { itemCode: "", itemName: "", damage: "", urgent: false };
  }
  return { supportType: "Tư vấn", estimatedHours: "", description: "", urgent: false };
}

function validate(
  kind: ServiceKind,
  item: DraftItem,
  catalogItem?: AllocationCatalogItem,
) {
  if (kind === "asset-allocation") {
    if (!item.category) return "Chọn danh mục đăng ký.";
    if (!catalogItem) return "Chọn hàng hóa / CCDC trong danh mục Setup tài sản.";
    if (catalogItem.category === ALLOCATION_CATEGORY.uniform) {
      if (!catalogItem.sizeOptions.length) {
        return "Mẫu đồng phục này chưa được cấu hình size trong Setup tài sản.";
      }
      if (!item.description) return "Chọn size áo Nam hoặc Nữ.";
    }
    if (!(Number(item.quantity) > 0)) return "Số lượng phải lớn hơn 0.";
  }
  if (kind === "repair-request") {
    if (!item.itemName?.trim()) return "Nhập tên CCDC.";
    if (!item.damage?.trim()) return "Nhập mô tả hư hỏng.";
  }
  if (kind === "support-request" && !item.description?.trim()) {
    return "Nhập mô tả yêu cầu hỗ trợ.";
  }
  return "";
}

function rowTitle(kind: ServiceKind, item: DraftItem) {
  if (kind === "support-request") return item.supportType || "Yêu cầu hỗ trợ";
  return item.itemName || "Chưa có tên";
}

function rowDescription(kind: ServiceKind, item: DraftItem) {
  if (kind === "asset-allocation") {
    return [item.category, item.description, `SL: ${item.quantity || 1}`, item.assignee]
      .filter(Boolean)
      .join(" · ");
  }
  if (kind === "repair-request") {
    return [item.itemCode, item.damage, item.urgent ? "Khẩn cấp" : ""]
      .filter(Boolean)
      .join(" · ");
  }
  return [
    item.description,
    item.estimatedHours ? `${item.estimatedHours} giờ` : "",
    item.urgent ? "Khẩn cấp" : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

export function ServiceCartWorkspace({
  catalog,
  employees,
  kind,
}: {
  catalog: AllocationCatalogItem[];
  employees: EmployeeOption[];
  kind: ServiceKind;
}) {
  const definition = DEFINITION[kind];
  const router = useRouter();
  const { toast } = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const seen = useRef<RequestActionState | null>(null);
  const [state, action, pending] = useActionState(submitRequestAction, initialState);
  const [draft, setDraft] = useState<DraftItem>(() => blankItem(kind));
  const [items, setItems] = useState<DraftItem[]>([]);

  const categories = useMemo(
    () => Array.from(new Set(catalog.map((item) => item.category).filter(Boolean))),
    [catalog],
  );
  const filteredCatalog = useMemo(
    () =>
      catalog.filter(
        (item) => !draft.category || item.category === draft.category,
      ),
    [catalog, draft.category],
  );
  const selectedCatalogItem = useMemo(
    () =>
      filteredCatalog.find(
        (item) =>
          item.name.localeCompare(draft.itemName?.trim() || "", "vi", {
            sensitivity: "accent",
          }) === 0,
      ),
    [draft.itemName, filteredCatalog],
  );

  useEffect(() => {
    if (state === seen.current) return;
    seen.current = state;
    if (state.success) {
      toast({
        message: state.success,
        title: "Đã ghi vào hệ thống",
        tone: "success",
      });
      formRef.current?.reset();
      router.refresh();
      queueMicrotask(() => {
        setItems([]);
        setDraft(blankItem(kind));
      });
    } else if (state.error) {
      toast({
        message: state.error,
        title: "Không thể hoàn tất",
        tone: "error",
      });
    }
  }, [kind, router, state, toast]);

  const addItem = () => {
    const error = validate(kind, draft, selectedCatalogItem);
    if (error) {
      toast({ message: error, title: "Chưa đủ thông tin", tone: "warning" });
      return;
    }
    setItems((current) => [...current, { ...draft }]);
    setDraft(blankItem(kind));
    toast({
      message: "Mục vừa nhập đã được đưa sang danh sách chờ nộp.",
      title: "Đã thêm",
      tone: "info",
    });
  };

  const payload = JSON.stringify({
    itemCount: items.length,
    items,
    submittedFrom: "nguoi-thuan-viet",
  });
  const totalHours =
    kind === "support-request"
      ? items.reduce((sum, item) => sum + (Number(item.estimatedHours) || 0), 0)
      : 0;

  return (
    <>
      <WriteLoadingOverlay
        message="Dữ liệu đang được ghi vào Hệ thống..."
        show={pending}
      />
      {kind === "asset-allocation" ? (
        <div className="mb-5">
          <AllocationFileImport
            catalog={catalog}
            employees={employees}
            onImport={(importedItems) =>
              setItems((current) => [...current, ...importedItems])
            }
          />
        </div>
      ) : null}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(480px,1.1fr)]">
        <section className="ui-module-panel p-5">
          <div className="mb-5 flex items-center justify-between gap-3">
            <div>
              <Badge tone="info">{definition.badge}</Badge>
              <h2 className="mt-2 text-xl font-extrabold text-primary">
                {definition.title}
              </h2>
            </div>
            <span className="ui-badge">{items.length} mục</span>
          </div>

          <div className="grid gap-4">
            {kind === "asset-allocation" ? (
              <>
                <Field label="Danh mục đăng ký">
                  <Select
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        category: event.target.value,
                        description: "",
                        itemName: "",
                      }))
                    }
                    value={draft.category}
                  >
                    <option value="">-- Chọn danh mục --</option>
                    {(categories.length
                      ? categories
                      : Object.values(ALLOCATION_CATEGORY)
                    ).map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Tên hàng hoá / CCDC">
                  <Input
                    list="asset-catalog-options"
                    onChange={(event) => {
                      const itemName = event.target.value;
                      const selectedItem = filteredCatalog.find(
                        (item) => item.name === itemName,
                      );
                      setDraft((current) => ({
                        ...current,
                        description:
                          selectedItem?.category ===
                          ALLOCATION_CATEGORY.stationery
                            ? selectedItem.description
                            : "",
                        itemName,
                      }));
                    }}
                    value={draft.itemName}
                  />
                  <datalist id="asset-catalog-options">
                    {filteredCatalog.map((item) => (
                      <option key={item.id} value={item.name} />
                    ))}
                  </datalist>
                </Field>
                {draft.category ? (
                  <div className="ui-module-field">
                    <span className="ui-module-label">
                      Hình ảnh mô tả hàng hóa / CCDC
                    </span>
                    <div className="relative grid h-52 place-items-center overflow-hidden rounded-lg border border-border bg-surface-muted p-3">
                      <div className="grid max-w-xs place-items-center gap-2 text-center text-sm leading-5 text-muted">
                        <ImageIcon aria-hidden size={30} />
                        {selectedCatalogItem
                          ? "Mặt hàng này chưa có hình trong Setup tài sản."
                          : "Chọn hàng hóa / CCDC để xem hình minh họa."}
                      </div>
                      {selectedCatalogItem?.imageUrl ? (
                        <img
                          alt={`Hình minh họa ${selectedCatalogItem.name}`}
                          className="absolute inset-0 size-full bg-surface object-contain p-3"
                          key={selectedCatalogItem.imageUrl}
                          loading="lazy"
                          onError={(event) => {
                            event.currentTarget.style.display = "none";
                          }}
                          src={selectedCatalogItem.imageUrl}
                        />
                      ) : null}
                    </div>
                  </div>
                ) : null}
                {draft.category === ALLOCATION_CATEGORY.uniform ? (
                  <div className="grid gap-3">
                    {(["Nam", "Nữ"] as const).map((group) => {
                      const options = selectedCatalogItem?.sizeOptions.filter(
                        (option) => option.group === group,
                      );
                      return options?.length ? (
                        <div className="ui-module-field" key={group}>
                          <span className="ui-module-label">Size {group}</span>
                          <div className="flex flex-wrap gap-2 rounded-lg border border-[#d7e1de] bg-[#f7faf8] p-3">
                            {options.map((option) => {
                              const selected =
                                draft.description === option.value;
                              return (
                                <button
                                  aria-pressed={selected}
                                  className={`min-h-9 min-w-11 rounded-lg border px-3 text-xs font-black transition ${
                                    selected
                                      ? "border-transparent bg-[#114c41] text-white"
                                      : "border-[#d2dfdb] bg-white text-[#114c41] hover:border-[#114c41]"
                                  }`}
                                  key={option.value}
                                  onClick={() =>
                                    setDraft((current) => ({
                                      ...current,
                                      description:
                                        current.description === option.value
                                          ? ""
                                          : option.value,
                                    }))
                                  }
                                  type="button"
                                >
                                  {option.size}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ) : null;
                    })}
                    {!selectedCatalogItem ? (
                      <div className="rounded-lg border border-dashed border-border bg-surface-muted px-4 py-3 text-sm text-muted">
                        Chọn mẫu đồng phục để xem các size đang có.
                      </div>
                    ) : !selectedCatalogItem.sizeOptions.length ? (
                      <div className="rounded-lg border border-danger/30 bg-danger/5 px-4 py-3 text-sm font-semibold text-danger">
                        Mẫu này chưa có size trong Setup tài sản.
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {draft.category === ALLOCATION_CATEGORY.stationery ? (
                  <div className="ui-module-field">
                    <span className="ui-module-label">
                      Màu sắc và tính chất
                    </span>
                    <div className="min-h-12 rounded-lg border border-border bg-surface-muted px-4 py-3 text-sm font-semibold leading-6 text-primary">
                      {selectedCatalogItem
                        ? selectedCatalogItem.description ||
                          "Chưa cấu hình màu sắc và tính chất."
                        : "Chọn văn phòng phẩm để xem mô tả."}
                    </div>
                  </div>
                ) : null}
                <Field label="Số lượng">
                  <Input
                    min={1}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        quantity: event.target.value,
                      }))
                    }
                    type="number"
                    value={draft.quantity}
                  />
                </Field>
                <Field label="Người được gán">
                  <Input
                    list="employee-assignee-options"
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        assignee: event.target.value,
                      }))
                    }
                    value={draft.assignee}
                  />
                  <datalist id="employee-assignee-options">
                    {employees.map((employee) => (
                      <option key={employee.id} value={employee.label} />
                    ))}
                  </datalist>
                </Field>
              </>
            ) : null}

            {kind === "repair-request" ? (
              <>
                <Field label="Mã CCDC">
                  <Input
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        itemCode: event.target.value,
                      }))
                    }
                    value={draft.itemCode}
                  />
                </Field>
                <Field label="CCDC">
                  <Input
                    list="repair-catalog-options"
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        itemName: event.target.value,
                      }))
                    }
                    value={draft.itemName}
                  />
                  <datalist id="repair-catalog-options">
                    {catalog.map((item, index) => (
                      <option key={`${item.name}-${index}`} value={item.name} />
                    ))}
                  </datalist>
                </Field>
                <Field label="Mô tả hư hỏng">
                  <textarea
                    className="ui-module-textarea"
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        damage: event.target.value,
                      }))
                    }
                    value={draft.damage}
                  />
                </Field>
              </>
            ) : null}

            {kind === "support-request" ? (
              <>
                <div className="ui-segmented">
                  {["Tư vấn", "Trao đổi", "Phối hợp hành động"].map((value) => (
                    <button
                      className={`ui-segmented-button ${
                        draft.supportType === value ? "is-active" : ""
                      }`}
                      key={value}
                      onClick={() =>
                        setDraft((current) => ({
                          ...current,
                          supportType: value,
                        }))
                      }
                      type="button"
                    >
                      {value}
                    </button>
                  ))}
                </div>
                <Field label="Ước lượng (giờ)">
                  <Input
                    min={0}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        estimatedHours: event.target.value,
                      }))
                    }
                    step="0.5"
                    type="number"
                    value={draft.estimatedHours}
                  />
                </Field>
                <Field label="Mô tả">
                  <textarea
                    className="ui-module-textarea"
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        description: event.target.value,
                      }))
                    }
                    value={draft.description}
                  />
                </Field>
              </>
            ) : null}

            {kind !== "asset-allocation" ? (
              <label className="flex min-h-12 items-center gap-3 rounded-lg border border-border bg-surface-muted px-4 text-sm font-bold text-primary">
                <input
                  checked={Boolean(draft.urgent)}
                  className="size-5 accent-brand"
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      urgent: event.target.checked,
                    }))
                  }
                  type="checkbox"
                />
                Khẩn cấp
              </label>
            ) : null}

            <Button onClick={addItem} type="button">
              <Plus aria-hidden size={18} />
              {definition.addLabel}
            </Button>
          </div>
        </section>

        <section className="ui-module-panel flex min-h-[420px] flex-col p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <Badge tone="warning">Đơn đã lên</Badge>
              <h2 className="mt-2 text-xl font-extrabold text-primary">
                Danh sách chờ nộp
              </h2>
            </div>
            {kind === "support-request" ? (
              <span className="ui-pill">Tổng {totalHours} giờ</span>
            ) : null}
          </div>

          <div className="mt-4 min-h-0 flex-1 overflow-auto">
            {items.length ? (
              <div className="space-y-2">
                {items.map((item, index) => (
                  <article
                    className="grid grid-cols-[minmax(0,1fr)_44px] items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3"
                    key={`${rowTitle(kind, item)}-${index}`}
                  >
                    <div className="min-w-0">
                      <div className="font-extrabold text-primary">
                        {rowTitle(kind, item)}
                      </div>
                      <div className="mt-1 text-sm leading-5 text-muted">
                        {rowDescription(kind, item)}
                      </div>
                    </div>
                    <button
                      aria-label="Xóa mục"
                      className="ui-icon-button ui-icon-button--accent"
                      onClick={() =>
                        setItems((current) =>
                          current.filter((_, itemIndex) => itemIndex !== index),
                        )
                      }
                      type="button"
                    >
                      <Trash2 aria-hidden size={18} />
                    </button>
                  </article>
                ))}
              </div>
            ) : (
              <div className="grid min-h-56 place-items-center rounded-lg border border-dashed border-border bg-surface-muted/70 px-6 text-center text-sm text-muted">
                Chưa có mục nào. Nhập thông tin bên trái rồi bấm “
                {definition.addLabel}”.
              </div>
            )}
          </div>

          <form action={action} className="mt-5 space-y-4" ref={formRef}>
            <input name="serviceCode" type="hidden" value={kind} />
            <input
              name="priority"
              type="hidden"
              value={items.some((item) => item.urgent) ? "Khẩn" : "Bình thường"}
            />
            <input
              name="title"
              type="hidden"
              value={`${definition.title} · ${items.length} mục`}
            />
            <input name="payload" type="hidden" value={payload} />

            {kind === "repair-request" ? (
              <Field label="Hình ảnh đính kèm">
                <FilePicker
                  accept="image/*,.pdf"
                  maxFileSizeBytes={8 * 1024 * 1024}
                  maxFiles={8}
                  multiple
                  name="attachments"
                  triggerLabel="Chọn hình ảnh"
                />
              </Field>
            ) : null}

            <Field label="Ghi chú chung">
              <textarea
                className="ui-module-textarea"
                name="note"
                placeholder="Thông tin cần lưu ý cho toàn bộ danh sách..."
              />
            </Field>
            <Button disabled={pending || items.length === 0} type="submit">
              {pending ? "Đang ghi dữ liệu..." : definition.submitLabel}
            </Button>
          </form>
        </section>
      </div>
    </>
  );
}
