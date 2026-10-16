"use client";

/* eslint-disable @next/next/no-img-element */

import {
  Boxes,
  CheckCircle2,
  ClipboardList,
  FileSearch,
  ImageIcon,
  Package,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Shirt,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import {
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  analyzeAssetInvoiceAction,
  archiveAssetRecordAction,
  refreshAssetSetupAction,
  retryAssetBackgroundJobAction,
  runAssetBackgroundQueueAction,
  saveAssetCatalogAction,
  saveAssetOptionAction,
  saveStationeryAction,
  saveUniformAction,
} from "@/app/cau-hinh/setup-tai-san/actions";
import { Button, FilePicker } from "@/components/ui";
import {
  useToast,
  WriteLoadingOverlay,
} from "@/components/ui/toast";
import {
  type AssetBackgroundJobDto,
  type AssetCatalogItemDto,
  type AssetDescriptorGroup,
  type AssetDraftInput,
  type AssetInvoiceSuggestion,
  type AssetOptionKind,
  type AssetSetupActionResult,
  type AssetSetupSnapshot,
  type StationeryDraftInput,
  type UniformDraftInput,
} from "@/lib/assets/setup-types";
import { cx } from "@/lib/cx";

type TabKey = "options" | "queue" | "assets" | "stationery" | "uniform";
type DeleteTarget = {
  id: string;
  label: string;
  recordType: "asset-catalog" | "asset-setup" | "stationery" | "uniform";
};

const TABS: Array<{
  icon: typeof Boxes;
  key: TabKey;
  label: string;
}> = [
  { icon: Boxes, key: "options", label: "Tùy chọn CCDC" },
  { icon: ClipboardList, key: "queue", label: "Hàng đợi" },
  { icon: Package, key: "assets", label: "CCDC/tài sản" },
  { icon: FileSearch, key: "stationery", label: "Văn phòng phẩm" },
  { icon: Shirt, key: "uniform", label: "Đồng phục" },
];

const emptyGroup = (): AssetDescriptorGroup => ({
  colors: [],
  fillerPhrases: [],
  materials: [],
  shapes: [],
});

const emptyAssetDraft = (): AssetDraftInput => ({
  assetNameOverride: "",
  assetType: "",
  depreciationPeriod: "",
  descriptorGroups: [emptyGroup()],
  functionAreas: [],
  heightCm: "",
  lengthCm: "",
  note: "",
  productValue: "",
  warrantyPeriod: "",
  widthCm: "",
});

const emptyStationeryDraft = (): StationeryDraftInput => ({
  color: "",
  name: "",
  note: "",
  packageQuantity: "",
  packageUnit: "",
  thickness: "",
});

const emptyUniformDraft = (): UniformDraftInput => ({
  femaleSizes: [],
  maleSizes: [],
  name: "",
  note: "",
});

function normalized(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("vi")
    .replace(/đ/g, "d");
}

function formatDate(value: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("vi-VN", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(date);
}

function formatValue(value: string) {
  if (!value) return "—";
  const number = Number(value.replace(/[.,\s]/g, ""));
  return Number.isFinite(number) && number > 0
    ? new Intl.NumberFormat("vi-VN").format(number)
    : value;
}

function generatedAssetName(input: AssetDraftInput) {
  if (input.assetNameOverride.trim()) return input.assetNameOverride.trim();
  const parts = [input.assetType, ...input.functionAreas];
  for (const group of input.descriptorGroups) {
    parts.push(...group.shapes);
    parts.push(...group.fillerPhrases);
    parts.push(...group.materials);
    parts.push(...group.colors.map((color) => color.name));
  }
  const dimensions = [input.lengthCm, input.widthCm, input.heightCm].filter(
    (value) => value.trim(),
  );
  if (dimensions.length) parts.push(`(${dimensions.join(" x ")} cm)`);
  const raw = parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("vi");
  return raw
    ? `${raw.charAt(0).toLocaleUpperCase("vi")}${raw.slice(1)}`
    : "";
}

function Field({
  children,
  className,
  label,
}: {
  children: ReactNode;
  className?: string;
  label: string;
}) {
  return (
    <label className={cx("ui-module-field", className)}>
      <span className="ui-module-label">{label}</span>
      {children}
    </label>
  );
}

function StatusDot({
  configured,
  label,
}: {
  configured: boolean;
  label: string;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-extrabold",
        configured
          ? "border-[#b6e2d1] bg-[#e8f8f1] text-[#0c6e4c]"
          : "border-[#f3d4a0] bg-[#fff6e8] text-[#9a5712]",
      )}
    >
      <span
        className={cx(
          "size-2 rounded-full",
          configured ? "bg-[#0f8a5f]" : "bg-[#ef8f2f]",
        )}
      />
      {label}
    </span>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-[#cbdad5] bg-[#f9fbfa] p-8 text-center text-sm text-[#6d817b]">
      {children}
    </div>
  );
}

function SearchInput({
  onChange,
  placeholder,
  value,
}: {
  onChange: (value: string) => void;
  placeholder: string;
  value: string;
}) {
  return (
    <label className="relative block min-w-0 flex-1">
      <Search
        className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#6d817b]"
        size={16}
      />
      <input
        className="ui-module-input !min-h-10 !pl-10"
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        value={value}
      />
    </label>
  );
}

function ChoicePicker({
  colorMap,
  label,
  onChange,
  options,
  selected,
}: {
  colorMap?: Map<string, string>;
  label: string;
  onChange: (next: string[]) => void;
  options: string[];
  selected: string[];
}) {
  const [custom, setCustom] = useState("");
  const toggle = (value: string) => {
    onChange(
      selected.some((item) => normalized(item) === normalized(value))
        ? selected.filter((item) => normalized(item) !== normalized(value))
        : [...selected, value],
    );
  };
  const addCustom = () => {
    const value = custom.trim();
    if (!value) return;
    if (!selected.some((item) => normalized(item) === normalized(value))) {
      onChange([...selected, value]);
    }
    setCustom("");
  };
  return (
    <div className="ui-module-field">
      <span className="ui-module-label">{label}</span>
      {selected.length ? (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((value) => (
            <button
              className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-[#cbdad5] bg-white px-3 text-xs font-extrabold text-[#114c41]"
              key={value}
              onClick={() => toggle(value)}
              type="button"
            >
              {colorMap?.get(value) ? (
                <span
                  className="size-3 rounded-full border border-black/10"
                  style={{ backgroundColor: colorMap.get(value) }}
                />
              ) : null}
              {value}
              <X size={12} />
            </button>
          ))}
        </div>
      ) : null}
      {options.length ? (
        <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto rounded-lg border border-[#d7e1de] bg-[#f7faf8] p-2">
          {options.map((value) => {
            const active = selected.some(
              (item) => normalized(item) === normalized(value),
            );
            return (
              <button
                className={cx(
                  "inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-bold transition",
                  active
                    ? "border-transparent bg-[#114c41] text-white"
                    : "border-[#d2dfdb] bg-white text-[#114c41] hover:border-brand",
                )}
                key={value}
                onClick={() => toggle(value)}
                type="button"
              >
                {colorMap?.get(value) ? (
                  <span
                    className="size-3 rounded-full border border-black/10"
                    style={{ backgroundColor: colorMap.get(value) }}
                  />
                ) : null}
                {value}
              </button>
            );
          })}
        </div>
      ) : null}
      <div className="grid grid-cols-[minmax(0,1fr)_40px] gap-2">
        <input
          className="ui-module-input !min-h-10"
          onChange={(event) => setCustom(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addCustom();
            }
          }}
          placeholder="Gõ thêm giá trị..."
          value={custom}
        />
        <button
          aria-label={`Thêm ${label}`}
          className="grid size-10 place-items-center rounded-lg border border-[#d2dfdb] bg-white text-[#114c41]"
          onClick={addCustom}
          type="button"
        >
          <Plus size={16} />
        </button>
      </div>
    </div>
  );
}

function Toggle({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      className={cx(
        "flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-[#d7e1de] bg-[#f9fbfa] px-4 py-3 text-sm font-bold text-[#114c41]",
        disabled && "cursor-not-allowed opacity-60",
      )}
    >
      <span>{label}</span>
      <input
        checked={checked}
        className="size-5 accent-brand"
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
    </label>
  );
}

function ItemImage({
  name,
  url,
}: {
  name: string;
  url: string;
}) {
  return (
    <div className="grid aspect-[4/3] place-items-center overflow-hidden rounded-lg border border-[#d8e2df] bg-[#f3f6f4]">
      {url ? (
        <img
          alt={name}
          className="size-full object-contain"
          loading="lazy"
          src={url}
        />
      ) : (
        <ImageIcon className="text-[#9bada7]" size={30} />
      )}
    </div>
  );
}

function DeleteButton({
  onClick,
}: {
  onClick: () => void;
}) {
  return (
    <button
      aria-label="Xóa"
      className="grid size-9 place-items-center rounded-lg border border-[#ebcccc] bg-[#fff5f5] text-[#ba2f2f] transition hover:bg-[#fdeaea]"
      onClick={onClick}
      type="button"
    >
      <Trash2 size={15} />
    </button>
  );
}

export function AssetSetupWorkspace({
  initialSnapshot,
}: {
  initialSnapshot: AssetSetupSnapshot;
}) {
  const { toast } = useToast();
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [tab, setTab] = useState<TabKey>("options");
  const [writing, setWriting] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);

  const applyResult = (
    result: AssetSetupActionResult<AssetSetupSnapshot>,
    title: string,
  ) => {
    if (result.data) setSnapshot(result.data);
    toast({
      message: result.message,
      title: result.ok ? title : "Không thực hiện được",
      tone: result.ok ? "success" : "error",
    });
    return result.ok;
  };

  const refresh = async () => {
    setWriting(true);
    setLoadingMessage("Đang tải lại Setup tài sản từ PostgreSQL...");
    try {
      applyResult(await refreshAssetSetupAction(), "Đã làm mới");
    } finally {
      setWriting(false);
      setLoadingMessage("");
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setWriting(true);
    setLoadingMessage(`Đang xóa ${deleteTarget.label}...`);
    try {
      applyResult(
        await archiveAssetRecordAction({
          id: deleteTarget.id,
          recordType: deleteTarget.recordType,
        }),
        "Đã xóa",
      );
      setDeleteTarget(null);
    } finally {
      setWriting(false);
      setLoadingMessage("");
    }
  };

  const runQueue = async (showOverlay = true) => {
    if (showOverlay) {
      setWriting(true);
      setLoadingMessage("Worker Python đang xử lý một hình trong hàng đợi...");
    }
    try {
      const result = await runAssetBackgroundQueueAction();
      applyResult(result, "Hàng đợi đã chạy");
    } finally {
      if (showOverlay) {
        setWriting(false);
        setLoadingMessage("");
      }
    }
  };

  const processQueuedInBackground = () => {
    if (!snapshot.environment.workerConfigured) return;
    toast({
      message:
        "Worker đang chạy nền; ông vẫn có thể tiếp tục thao tác ở các tab khác.",
      title: "Đang xử lý hình",
      tone: "info",
    });
    void runQueue(false);
  };

  return (
    <div className="mt-6 space-y-4">
      <WriteLoadingOverlay message={loadingMessage} show={writing} />

      <section className="ui-module-panel p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            <StatusDot
              configured={snapshot.environment.gcsConfigured}
              label="Kho ảnh GCS"
            />
            <StatusDot
              configured={snapshot.environment.workerConfigured}
              label="Worker tách nền"
            />
            <StatusDot
              configured={snapshot.environment.geminiConfigured}
              label={`Gemini · ${snapshot.environment.geminiModel}`}
            />
          </div>
          <button
            aria-label="Tải lại dữ liệu"
            className="ui-icon-button !size-10"
            onClick={() => void refresh()}
            type="button"
          >
            <RefreshCw size={17} />
          </button>
        </div>
      </section>

      <nav
        aria-label="Các tab Setup tài sản"
        className="ui-module-panel grid grid-cols-2 gap-2 p-2 md:grid-cols-5"
      >
        {TABS.map((item) => {
          const Icon = item.icon;
          return (
            <button
              className={cx(
                "flex min-h-12 items-center justify-center gap-2 rounded-lg px-3 text-sm font-extrabold transition",
                tab === item.key
                  ? "bg-gradient-to-br from-brand-light via-brand to-brand-strong text-white shadow-[0_10px_24px_var(--brand-shadow-medium)]"
                  : "border border-transparent text-[#114c41] hover:border-[#d4dfdc] hover:bg-white",
              )}
              key={item.key}
              onClick={() => setTab(item.key)}
              type="button"
            >
              <Icon size={17} />
              {item.label}
            </button>
          );
        })}
      </nav>

      {tab === "options" ? (
        <OptionsTab
          onDelete={(target) => setDeleteTarget(target)}
          onResult={(result) => applyResult(result, "Đã lưu tùy chọn")}
          setLoadingMessage={setLoadingMessage}
          setWriting={setWriting}
          snapshot={snapshot}
        />
      ) : null}
      {tab === "queue" ? (
        <QueueTab
          onRefresh={() => void refresh()}
          onRetry={async (job) => {
            setWriting(true);
            setLoadingMessage(`Đang đưa lại "${job.itemName}" vào hàng đợi...`);
            try {
              const result = await retryAssetBackgroundJobAction(job.id);
              const ok = applyResult(result, "Đã đưa lại vào hàng đợi");
              if (ok && snapshot.environment.workerConfigured) {
                processQueuedInBackground();
              }
            } finally {
              setWriting(false);
              setLoadingMessage("");
            }
          }}
          onRun={() => void runQueue(true)}
          snapshot={snapshot}
        />
      ) : null}
      {tab === "assets" ? (
        <AssetsTab
          onDelete={(target) => setDeleteTarget(target)}
          onQueued={processQueuedInBackground}
          onResult={(result) => applyResult(result, "Đã lưu CCDC/tài sản")}
          setLoadingMessage={setLoadingMessage}
          setWriting={setWriting}
          snapshot={snapshot}
        />
      ) : null}
      {tab === "stationery" ? (
        <StationeryTab
          onDelete={(target) => setDeleteTarget(target)}
          onQueued={processQueuedInBackground}
          onResult={(result) => applyResult(result, "Đã lưu văn phòng phẩm")}
          setLoadingMessage={setLoadingMessage}
          setWriting={setWriting}
          snapshot={snapshot}
        />
      ) : null}
      {tab === "uniform" ? (
        <UniformTab
          onDelete={(target) => setDeleteTarget(target)}
          onQueued={processQueuedInBackground}
          onResult={(result) => applyResult(result, "Đã lưu đồng phục")}
          setLoadingMessage={setLoadingMessage}
          setWriting={setWriting}
          snapshot={snapshot}
        />
      ) : null}

      {deleteTarget ? (
        <div className="fixed inset-0 z-[190] grid place-items-center bg-[rgba(7,24,21,0.48)] px-4 backdrop-blur-[2px]">
          <section
            aria-modal="true"
            className="w-full max-w-md rounded-xl border border-[#d2dfdb] bg-white p-6 shadow-[0_28px_80px_rgba(17,45,39,0.28)]"
            role="dialog"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-black uppercase tracking-[0.12em] text-[#ba2f2f]">
                  Xác nhận xóa
                </div>
                <h2 className="mt-1 text-lg font-black text-[#114c41]">
                  Xóa {deleteTarget.label}?
                </h2>
              </div>
              <button
                aria-label="Đóng"
                className="grid size-9 place-items-center rounded-full border border-[#d6e0dd] text-[#114c41]"
                onClick={() => setDeleteTarget(null)}
                type="button"
              >
                <X size={17} />
              </button>
            </div>
            <p className="mt-4 text-sm leading-6 text-[#657a74]">
              Bản ghi sẽ được đánh dấu <strong>Đã xóa</strong> trong PostgreSQL
              và ẩn khỏi danh mục đang dùng. Lịch sử và hình gốc vẫn được giữ.
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <Button
                onClick={() => setDeleteTarget(null)}
                variant="secondary"
              >
                Hủy
              </Button>
              <Button onClick={() => void confirmDelete()} variant="danger">
                <Trash2 size={16} />
                Xóa
              </Button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function OptionsTab({
  onDelete,
  onResult,
  setLoadingMessage,
  setWriting,
  snapshot,
}: {
  onDelete: (target: DeleteTarget) => void;
  onResult: (result: AssetSetupActionResult<AssetSetupSnapshot>) => boolean;
  setLoadingMessage: (value: string) => void;
  setWriting: (value: boolean) => void;
  snapshot: AssetSetupSnapshot;
}) {
  const [kind, setKind] = useState<AssetOptionKind>("assetType");
  const [name, setName] = useState("");
  const [colorHex, setColorHex] = useState("#FFFFFF");
  const [search, setSearch] = useState("");
  const rows = snapshot.options.filter(
    (item) =>
      (!search ||
        normalized(`${item.name} ${item.kindLabel}`).includes(
          normalized(search),
        )) &&
      item.kind === kind,
  );
  const save = async () => {
    setWriting(true);
    setLoadingMessage("Đang lưu tùy chọn vào PostgreSQL...");
    try {
      const ok = onResult(
        await saveAssetOptionAction({ colorHex, kind, name }),
      );
      if (ok) {
        setName("");
        if (kind === "color") setColorHex("#FFFFFF");
      }
    } finally {
      setWriting(false);
      setLoadingMessage("");
    }
  };
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(300px,0.82fr)_minmax(0,1.35fr)]">
      <section className="ui-module-panel p-5">
        <div className="text-xs font-black uppercase tracking-[0.12em] text-brand-strong">
          Tạo tùy chọn
        </div>
        <h2 className="mt-1 text-lg font-black text-[#114c41]">
          Danh mục cấu thành tên CCDC
        </h2>
        <div className="mt-4 grid gap-4">
          <Field label="Nhóm cấu hình">
            <select
              className="ui-module-select"
              onChange={(event) =>
                setKind(event.target.value as AssetOptionKind)
              }
              value={kind}
            >
              {snapshot.optionKinds.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Tên">
            <input
              className="ui-module-input"
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void save();
                }
              }}
              placeholder="Nhập giá trị mới"
              value={name}
            />
          </Field>
          {kind === "color" ? (
            <Field label="Mã màu #RRGGBB">
              <div className="grid grid-cols-[56px_minmax(0,1fr)] gap-2">
                <input
                  aria-label="Chọn màu"
                  className="h-[52px] w-full rounded-lg border border-[#d2dfdb] bg-white p-1"
                  onChange={(event) =>
                    setColorHex(event.target.value.toUpperCase())
                  }
                  type="color"
                  value={colorHex}
                />
                <input
                  className="ui-module-input"
                  maxLength={7}
                  onChange={(event) =>
                    setColorHex(event.target.value.toUpperCase())
                  }
                  value={colorHex}
                />
              </div>
            </Field>
          ) : null}
          <Button disabled={!name.trim()} onClick={() => void save()}>
            <Save size={17} />
            Lưu tùy chọn
          </Button>
        </div>
      </section>

      <section className="ui-module-panel p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-black text-[#114c41]">
              {snapshot.optionKinds.find((item) => item.key === kind)?.label}
            </h2>
            <p className="mt-1 text-sm text-[#6d817b]">
              {rows.length} giá trị đang dùng.
            </p>
          </div>
          <div className="w-full max-w-xs">
            <SearchInput
              onChange={setSearch}
              placeholder="Tìm tùy chọn"
              value={search}
            />
          </div>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {rows.map((item) => (
            <article
              className="flex items-center justify-between gap-3 rounded-lg border border-[#d8e2df] bg-[#f9fbfa] p-3"
              key={item.id}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {item.colorHex ? (
                    <span
                      className="size-5 shrink-0 rounded-full border border-black/10"
                      style={{ backgroundColor: item.colorHex }}
                    />
                  ) : null}
                  <strong className="truncate text-sm text-[#114c41]">
                    {item.name}
                  </strong>
                </div>
                <div className="mt-1 text-[11px] text-[#758780]">
                  {item.updatedBy || "Dữ liệu đã nhập"} ·{" "}
                  {formatDate(item.updatedAt)}
                </div>
              </div>
              <DeleteButton
                onClick={() =>
                  onDelete({
                    id: item.id,
                    label: `"${item.name}"`,
                    recordType: "asset-setup",
                  })
                }
              />
            </article>
          ))}
        </div>
        {!rows.length ? (
          <div className="mt-4">
            <EmptyState>Chưa có tùy chọn trong nhóm này.</EmptyState>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function QueueTab({
  onRefresh,
  onRetry,
  onRun,
  snapshot,
}: {
  onRefresh: () => void;
  onRetry: (job: AssetBackgroundJobDto) => void;
  onRun: () => void;
  snapshot: AssetSetupSnapshot;
}) {
  const queued = snapshot.backgroundJobs.filter(
    (job) => job.status === "queued",
  ).length;
  const failed = snapshot.backgroundJobs.filter(
    (job) => job.status === "failed",
  ).length;
  const done = snapshot.backgroundJobs.filter(
    (job) => job.status === "done",
  ).length;
  return (
    <section className="ui-module-panel p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-[#114c41]">
            Hàng đợi xử lý nền
          </h2>
          <p className="mt-1 text-sm text-[#6d817b]">
            Hình gốc luôn được giữ để có thể thử lại nếu worker gặp lỗi.
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={onRefresh} size="sm" variant="secondary">
            <RefreshCw size={15} />
            Làm mới
          </Button>
          <Button
            disabled={!snapshot.environment.workerConfigured || queued === 0}
            onClick={onRun}
            size="sm"
          >
            <Sparkles size={15} />
            Chạy hàng đợi
          </Button>
        </div>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {[
          ["Đang chờ", queued, "text-[#9a5712] bg-[#fff6e8]"],
          ["Hoàn tất", done, "text-[#0c6e4c] bg-[#e8f8f1]"],
          ["Lỗi", failed, "text-[#ba2f2f] bg-[#fdeeee]"],
        ].map(([label, value, tone]) => (
          <div className={cx("rounded-lg p-4", String(tone))} key={String(label)}>
            <div className="text-xs font-black uppercase tracking-[0.1em]">
              {label}
            </div>
            <div className="mt-1 text-2xl font-black">{value}</div>
          </div>
        ))}
      </div>
      {!snapshot.environment.workerConfigured ? (
        <div className="mt-4 rounded-lg border border-[#f3d4a0] bg-[#fff6e8] p-4 text-sm leading-6 text-[#8d571d]">
          Chưa cấu hình URL worker Python ở{" "}
          <strong>Cấu hình Tổng → AI</strong>. Ông vẫn có thể lưu ảnh gốc bằng
          cách tắt “Loại nền khi lưu”.
        </div>
      ) : null}
      <div className="mt-4 space-y-3">
        {snapshot.backgroundJobs.map((job) => (
          <article
            className="rounded-lg border border-[#d7e1de] bg-white p-4"
            key={job.id}
          >
            <div className="grid gap-4 md:grid-cols-[88px_minmax(0,1fr)_auto]">
              <ItemImage
                name={job.itemName}
                url={
                  job.processedImage.url ||
                  job.originalImage.url
                }
              />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <strong className="text-sm text-[#114c41]">
                    {job.itemName}
                  </strong>
                  <span
                    className={cx(
                      "rounded-full px-2.5 py-1 text-[10px] font-black uppercase",
                      job.status === "done"
                        ? "bg-[#e8f8f1] text-[#0c6e4c]"
                        : job.status === "failed"
                          ? "bg-[#fdeeee] text-[#ba2f2f]"
                          : "bg-[#fff2e8] text-[#9a5712]",
                    )}
                  >
                    {job.status === "done"
                      ? "Hoàn tất"
                      : job.status === "failed"
                        ? "Lỗi"
                        : job.status === "processing"
                          ? "Đang xử lý"
                          : "Đang chờ"}
                  </span>
                </div>
                <p className="mt-2 text-xs leading-5 text-[#6d817b]">
                  {job.message || "Chưa có thông báo."}
                </p>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#e8efec]">
                  <div
                    className={cx(
                      "h-full rounded-full transition-all",
                      job.status === "failed"
                        ? "bg-[#ba2f2f]"
                        : "bg-gradient-to-r from-brand-light to-brand-strong",
                    )}
                    style={{ width: `${job.progress}%` }}
                  />
                </div>
                <div className="mt-2 text-[11px] text-[#7b8d87]">
                  {job.itemType} · lần thử {job.attempts} ·{" "}
                  {formatDate(job.createdAt)}
                </div>
              </div>
              <div className="flex items-start">
                {job.status === "failed" ? (
                  <Button
                    onClick={() => onRetry(job)}
                    size="sm"
                    variant="secondary"
                  >
                    <RotateCcw size={14} />
                    Thử lại
                  </Button>
                ) : job.status === "done" ? (
                  <CheckCircle2 className="text-[#0c6e4c]" size={24} />
                ) : null}
              </div>
            </div>
          </article>
        ))}
      </div>
      {!snapshot.backgroundJobs.length ? (
        <div className="mt-4">
          <EmptyState>Chưa có lịch sử xử lý nền.</EmptyState>
        </div>
      ) : null}
    </section>
  );
}

function AssetsTab({
  onDelete,
  onQueued,
  onResult,
  setLoadingMessage,
  setWriting,
  snapshot,
}: {
  onDelete: (target: DeleteTarget) => void;
  onQueued: () => void;
  onResult: (result: AssetSetupActionResult<AssetSetupSnapshot>) => boolean;
  setLoadingMessage: (value: string) => void;
  setWriting: (value: boolean) => void;
  snapshot: AssetSetupSnapshot;
}) {
  const [draft, setDraft] = useState(emptyAssetDraft);
  const [image, setImage] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [removeBackground, setRemoveBackground] = useState(false);
  const [search, setSearch] = useState("");
  const [invoice, setInvoice] = useState<File | null>(null);
  const [suggestions, setSuggestions] = useState<AssetInvoiceSuggestion[]>([]);
  const options = useMemo(() => {
    const byKind = new Map<AssetOptionKind, string[]>();
    for (const kind of snapshot.optionKinds) {
      byKind.set(
        kind.key,
        snapshot.options
          .filter((option) => option.kind === kind.key)
          .map((option) => option.name),
      );
    }
    return byKind;
  }, [snapshot]);
  const colorMap = useMemo(
    () =>
      new Map(
        snapshot.options
          .filter((option) => option.kind === "color")
          .map((option) => [option.name, option.colorHex]),
      ),
    [snapshot.options],
  );
  const filtered = snapshot.assets.filter((item) =>
    normalized(
      `${item.name} ${item.assetType} ${item.functionAreas.join(" ")}`,
    ).includes(normalized(search)),
  );

  const reset = () => {
    setDraft(emptyAssetDraft());
    setImage(null);
    setFileKey((value) => value + 1);
    setRemoveBackground(false);
  };
  const updateGroup = (
    index: number,
    field: "colors" | "fillerPhrases" | "materials" | "shapes",
    values: string[],
  ) => {
    setDraft((current) => ({
      ...current,
      descriptorGroups: current.descriptorGroups.map((group, groupIndex) =>
        groupIndex !== index
          ? group
          : field === "colors"
            ? {
                ...group,
                colors: values.map((name) => ({
                  colorHex: colorMap.get(name) || "",
                  name,
                })),
              }
            : { ...group, [field]: values },
      ),
    }));
  };
  const save = async () => {
    const formData = new FormData();
    formData.set("payload", JSON.stringify(draft));
    formData.set("removeBackground", String(removeBackground));
    if (image) formData.set("image", image);
    setWriting(true);
    setLoadingMessage(
      removeBackground
        ? "Đang giữ hình gốc và tạo tác vụ xử lý nền..."
        : "Đang lưu CCDC/tài sản và hình ảnh vào Google Cloud...",
    );
    try {
      const result = await saveAssetCatalogAction(formData);
      const ok = onResult(result);
      if (ok) {
        reset();
        if (removeBackground) onQueued();
      }
    } finally {
      setWriting(false);
      setLoadingMessage("");
    }
  };
  const analyze = async () => {
    const formData = new FormData();
    if (invoice) formData.set("invoice", invoice);
    setWriting(true);
    setLoadingMessage("Gemini đang đọc hóa đơn và dựng nháp CCDC/tài sản...");
    try {
      const result = await analyzeAssetInvoiceAction(formData);
      if (result.ok && result.data) {
        setSuggestions(result.data.suggestions);
      }
      onResult({
        data: undefined,
        message: result.message,
        ok: result.ok,
      });
    } finally {
      setWriting(false);
      setLoadingMessage("");
    }
  };

  return (
    <div className="space-y-4">
      <section className="ui-module-panel p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.12em] text-brand-strong">
              Hóa đơn đầu vào
            </div>
            <h2 className="mt-1 text-lg font-black text-[#114c41]">
              Gemini tạo nháp CCDC/tài sản
            </h2>
            <p className="mt-1 text-sm text-[#6d817b]">
              Nhận PDF hoặc hình ảnh; mỗi mặt hàng chỉ tạo một nháp để ông rà
              lại trước khi lưu.
            </p>
          </div>
          <StatusDot
            configured={snapshot.environment.geminiConfigured}
            label={snapshot.environment.geminiModel}
          />
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
          <FilePicker
            accept="application/pdf,image/*"
            maxFileSizeBytes={10 * 1024 * 1024}
            maxFiles={1}
            onFilesChange={(files) => setInvoice(files[0] ?? null)}
            triggerLabel="Chọn hóa đơn"
            triggerStyle="dashed"
          />
          <Button
            disabled={!invoice || !snapshot.environment.geminiConfigured}
            onClick={() => void analyze()}
          >
            <Sparkles size={17} />
            Phân tích bằng Gemini
          </Button>
        </div>
        {suggestions.length ? (
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {suggestions.map((suggestion, index) => (
              <article
                className={cx(
                  "rounded-lg border p-4",
                  suggestion.lowSignificance
                    ? "border-[#f0d7ae] bg-[#fff9ef]"
                    : "border-[#d7e1de] bg-[#f9fbfa]",
                )}
                key={`${suggestion.generatedName}-${index}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <strong className="text-sm text-[#114c41]">
                      {suggestion.generatedName}
                    </strong>
                    <p className="mt-1 text-xs text-[#6d817b]">
                      {suggestion.invoiceItemName}
                    </p>
                  </div>
                  <button
                    aria-label="Bỏ gợi ý"
                    className="grid size-8 place-items-center rounded-lg border border-[#d8e2df] text-[#657a74]"
                    onClick={() =>
                      setSuggestions((items) =>
                        items.filter((_, itemIndex) => itemIndex !== index),
                      )
                    }
                    type="button"
                  >
                    <X size={14} />
                  </button>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
                  <span className="rounded-full bg-white px-2.5 py-1 font-bold text-[#114c41]">
                    {suggestion.assetType}
                  </span>
                  {suggestion.quantity ? (
                    <span className="rounded-full bg-white px-2.5 py-1 text-[#657a74]">
                      SL {suggestion.quantity} {suggestion.unit}
                    </span>
                  ) : null}
                  {suggestion.productValue ? (
                    <span className="rounded-full bg-white px-2.5 py-1 text-[#657a74]">
                      {formatValue(suggestion.productValue)}
                    </span>
                  ) : null}
                </div>
                <div className="mt-3 flex justify-end">
                  <Button
                    onClick={() => {
                      setDraft({
                        assetNameOverride: suggestion.assetNameOverride,
                        assetType: suggestion.assetType,
                        depreciationPeriod: suggestion.depreciationPeriod,
                        descriptorGroups: suggestion.descriptorGroups.length
                          ? suggestion.descriptorGroups
                          : [emptyGroup()],
                        functionAreas: suggestion.functionAreas,
                        heightCm: suggestion.heightCm,
                        lengthCm: suggestion.lengthCm,
                        note: suggestion.note,
                        productValue: suggestion.productValue,
                        warrantyPeriod: suggestion.warrantyPeriod,
                        widthCm: suggestion.widthCm,
                      });
                      setSuggestions((items) =>
                        items.filter((_, itemIndex) => itemIndex !== index),
                      );
                    }}
                    size="sm"
                    variant="secondary"
                  >
                    Áp dụng vào biểu mẫu
                  </Button>
                </div>
              </article>
            ))}
          </div>
        ) : null}
      </section>

      <div className="grid gap-4 2xl:grid-cols-[minmax(440px,0.95fr)_minmax(0,1.2fr)]">
        <section className="ui-module-panel p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.12em] text-brand-strong">
                Tạo danh mục
              </div>
              <h2 className="mt-1 text-lg font-black text-[#114c41]">
                CCDC/tài sản
              </h2>
            </div>
            <Button onClick={reset} size="sm" variant="secondary">
              <RotateCcw size={14} />
              Làm lại
            </Button>
          </div>
          <div className="mt-4 grid gap-4">
            <Field label="Tên sản phẩm ưu tiên">
              <input
                className="ui-module-input"
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    assetNameOverride: event.target.value,
                  }))
                }
                placeholder="Có thể bỏ trống để hệ thống tự ghép tên"
                value={draft.assetNameOverride}
              />
            </Field>
            <Field label="Loại CCDC/tài sản">
              <input
                className="ui-module-input"
                list="asset-type-options"
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    assetType: event.target.value,
                  }))
                }
                placeholder="Chọn hoặc nhập loại CCDC"
                value={draft.assetType}
              />
              <datalist id="asset-type-options">
                {(options.get("assetType") || []).map((value) => (
                  <option key={value} value={value} />
                ))}
              </datalist>
            </Field>
            <ChoicePicker
              label="Công năng/ Khu vực bố trí"
              onChange={(functionAreas) =>
                setDraft((current) => ({ ...current, functionAreas }))
              }
              options={options.get("functionArea") || []}
              selected={draft.functionAreas}
            />
            <div className="space-y-3">
              {draft.descriptorGroups.map((group, index) => (
                <div
                  className="rounded-lg border border-[#d6e0dd] bg-[#f7faf8] p-4"
                  key={index}
                >
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <strong className="text-sm text-[#114c41]">
                      Bộ mô tả {index + 1}
                    </strong>
                    {draft.descriptorGroups.length > 1 ? (
                      <button
                        aria-label="Bỏ bộ mô tả"
                        className="grid size-8 place-items-center rounded-lg border border-[#ebcccc] bg-white text-[#ba2f2f]"
                        onClick={() =>
                          setDraft((current) => ({
                            ...current,
                            descriptorGroups:
                              current.descriptorGroups.filter(
                                (_, groupIndex) => groupIndex !== index,
                              ),
                          }))
                        }
                        type="button"
                      >
                        <Trash2 size={14} />
                      </button>
                    ) : null}
                  </div>
                  <div className="grid gap-3">
                    <ChoicePicker
                      label="Đặc điểm/ hình dạng"
                      onChange={(values) =>
                        updateGroup(index, "shapes", values)
                      }
                      options={options.get("shape") || []}
                      selected={group.shapes}
                    />
                    <ChoicePicker
                      label="Cụm từ đệm"
                      onChange={(values) =>
                        updateGroup(index, "fillerPhrases", values)
                      }
                      options={options.get("fillerPhrase") || []}
                      selected={group.fillerPhrases}
                    />
                    <ChoicePicker
                      label="Chất liệu"
                      onChange={(values) =>
                        updateGroup(index, "materials", values)
                      }
                      options={options.get("material") || []}
                      selected={group.materials}
                    />
                    <ChoicePicker
                      colorMap={colorMap}
                      label="Màu sắc"
                      onChange={(values) =>
                        updateGroup(index, "colors", values)
                      }
                      options={options.get("color") || []}
                      selected={group.colors.map((color) => color.name)}
                    />
                  </div>
                </div>
              ))}
              <Button
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    descriptorGroups: [
                      ...current.descriptorGroups,
                      emptyGroup(),
                    ],
                  }))
                }
                size="sm"
                variant="secondary"
              >
                <Plus size={14} />
                Thêm bộ mô tả
              </Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                ["Chiều dài cm", "lengthCm"],
                ["Chiều rộng cm", "widthCm"],
                ["Chiều cao cm", "heightCm"],
              ].map(([label, key]) => (
                <Field key={key} label={label}>
                  <input
                    className="ui-module-input"
                    inputMode="decimal"
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        [key]: event.target.value,
                      }))
                    }
                    value={draft[key as "heightCm" | "lengthCm" | "widthCm"]}
                  />
                </Field>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Giá trị sản phẩm">
                <input
                  className="ui-module-input"
                  inputMode="numeric"
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      productValue: event.target.value,
                    }))
                  }
                  value={draft.productValue}
                />
              </Field>
              <Field label="Thời gian bảo hành">
                <input
                  className="ui-module-input"
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      warrantyPeriod: event.target.value,
                    }))
                  }
                  placeholder="Ví dụ: 12 tháng"
                  value={draft.warrantyPeriod}
                />
              </Field>
              <Field label="Thời gian khấu hao">
                <input
                  className="ui-module-input"
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      depreciationPeriod: event.target.value,
                    }))
                  }
                  placeholder="Ví dụ: 36 tháng"
                  value={draft.depreciationPeriod}
                />
              </Field>
            </div>
            <Field label="Ghi chú">
              <textarea
                className="ui-module-textarea"
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    note: event.target.value,
                  }))
                }
                value={draft.note}
              />
            </Field>
            <FilePicker
              accept="image/*"
              key={fileKey}
              maxFileSizeBytes={8 * 1024 * 1024}
              maxFiles={1}
              onFilesChange={(files) => setImage(files[0] ?? null)}
              triggerLabel="Chọn hình CCDC/tài sản"
              triggerStyle="dashed"
            />
            <Toggle
              checked={removeBackground}
              disabled={!snapshot.environment.workerConfigured}
              label="Loại nền khi lưu"
              onChange={setRemoveBackground}
            />
            <div className="rounded-lg border border-[#d6e0dd] bg-[#f3f7f5] p-4">
              <div className="text-[11px] font-black uppercase tracking-[0.1em] text-[#6d817b]">
                Tên sẽ lưu
              </div>
              <div className="mt-1 font-black text-[#114c41]">
                {generatedAssetName(draft) || "Chưa đủ thông tin để sinh tên"}
              </div>
            </div>
            <Button
              disabled={!image || !draft.assetType.trim()}
              onClick={() => void save()}
            >
              <Save size={17} />
              {removeBackground
                ? "Đưa vào hàng đợi"
                : "Lưu CCDC/tài sản"}
            </Button>
          </div>
        </section>

        <CatalogPanel
          count={filtered.length}
          onSearch={setSearch}
          search={search}
          title="Danh mục CCDC/tài sản"
        >
          <div className="grid gap-3 md:grid-cols-2">
            {filtered.map((item) => (
              <AssetCard
                item={item}
                key={item.id}
                onDelete={() =>
                  onDelete({
                    id: item.id,
                    label: `"${item.name}"`,
                    recordType: "asset-catalog",
                  })
                }
              />
            ))}
          </div>
          {!filtered.length ? (
            <EmptyState>Chưa có CCDC/tài sản phù hợp.</EmptyState>
          ) : null}
        </CatalogPanel>
      </div>
    </div>
  );
}

function CatalogPanel({
  children,
  count,
  onSearch,
  search,
  title,
}: {
  children: ReactNode;
  count: number;
  onSearch: (value: string) => void;
  search: string;
  title: string;
}) {
  return (
    <section className="ui-module-panel p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-[#114c41]">{title}</h2>
          <p className="mt-1 text-sm text-[#6d817b]">
            {count} bản ghi đang hiển thị.
          </p>
        </div>
        <div className="w-full max-w-xs">
          <SearchInput
            onChange={onSearch}
            placeholder="Tìm nhanh"
            value={search}
          />
        </div>
      </div>
      <div className="mt-4 space-y-3">{children}</div>
    </section>
  );
}

function AssetCard({
  item,
  onDelete,
}: {
  item: AssetCatalogItemDto;
  onDelete: () => void;
}) {
  const descriptions = item.descriptorGroups.flatMap((group) => [
    ...group.shapes,
    ...group.fillerPhrases,
    ...group.materials,
    ...group.colors.map((color) => color.name),
  ]);
  return (
    <article className="rounded-lg border border-[#d8e2df] bg-white p-3">
      <ItemImage name={item.name} url={item.image.url} />
      <div className="mt-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-black leading-5 text-[#114c41]">
            {item.name}
          </h3>
          <p className="mt-1 text-xs text-[#6d817b]">{item.assetType}</p>
        </div>
        <DeleteButton onClick={onDelete} />
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {item.functionAreas.map((value) => (
          <span
            className="rounded-full bg-[#e9f4f0] px-2.5 py-1 text-[10px] font-bold text-[#176754]"
            key={value}
          >
            {value}
          </span>
        ))}
        {descriptions.slice(0, 5).map((value) => (
          <span
            className="rounded-full bg-[#fff2e8] px-2.5 py-1 text-[10px] font-bold text-[#9a5712]"
            key={value}
          >
            {value}
          </span>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-md bg-[#f4f7f6] p-2">
          <span className="text-[#71837d]">Giá trị</span>
          <strong className="ml-1 text-[#114c41]">
            {formatValue(item.productValue)}
          </strong>
        </div>
        <div className="rounded-md bg-[#f4f7f6] p-2">
          <span className="text-[#71837d]">Kích thước</span>
          <strong className="ml-1 text-[#114c41]">
            {[item.lengthCm, item.widthCm, item.heightCm]
              .filter(Boolean)
              .join(" × ") || "—"}
          </strong>
        </div>
      </div>
      <div className="mt-3 text-[10px] text-[#7a8d86]">
        {item.updatedBy || "Dữ liệu đã nhập"} · {formatDate(item.updatedAt)}
      </div>
    </article>
  );
}

function StationeryTab({
  onDelete,
  onQueued,
  onResult,
  setLoadingMessage,
  setWriting,
  snapshot,
}: {
  onDelete: (target: DeleteTarget) => void;
  onQueued: () => void;
  onResult: (result: AssetSetupActionResult<AssetSetupSnapshot>) => boolean;
  setLoadingMessage: (value: string) => void;
  setWriting: (value: boolean) => void;
  snapshot: AssetSetupSnapshot;
}) {
  const [draft, setDraft] = useState(emptyStationeryDraft);
  const [image, setImage] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [removeBackground, setRemoveBackground] = useState(false);
  const [search, setSearch] = useState("");
  const filtered = snapshot.stationeryItems.filter((item) =>
    normalized(
      `${item.name} ${item.color} ${item.thickness} ${item.packageLabel}`,
    ).includes(normalized(search)),
  );
  const reset = () => {
    setDraft(emptyStationeryDraft());
    setImage(null);
    setFileKey((value) => value + 1);
    setRemoveBackground(false);
  };
  const save = async () => {
    const formData = new FormData();
    formData.set("payload", JSON.stringify(draft));
    formData.set("removeBackground", String(removeBackground));
    if (image) formData.set("image", image);
    setWriting(true);
    setLoadingMessage(
      removeBackground
        ? "Đang tạo tác vụ xử lý nền văn phòng phẩm..."
        : "Đang lưu văn phòng phẩm và hình ảnh...",
    );
    try {
      const ok = onResult(await saveStationeryAction(formData));
      if (ok) {
        reset();
        if (removeBackground) onQueued();
      }
    } finally {
      setWriting(false);
      setLoadingMessage("");
    }
  };
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(340px,0.8fr)_minmax(0,1.25fr)]">
      <section className="ui-module-panel p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.12em] text-brand-strong">
              Tạo danh mục
            </div>
            <h2 className="mt-1 text-lg font-black text-[#114c41]">
              Văn phòng phẩm
            </h2>
          </div>
          <Button onClick={reset} size="sm" variant="secondary">
            <RotateCcw size={14} />
            Làm lại
          </Button>
        </div>
        <div className="mt-4 grid gap-4">
          <Field label="Tên văn phòng phẩm">
            <input
              className="ui-module-input"
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
              value={draft.name}
            />
          </Field>
          <Field label="Màu sắc">
            <input
              className="ui-module-input"
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  color: event.target.value,
                }))
              }
              value={draft.color}
            />
          </Field>
          <div className="ui-module-field">
            <span className="ui-module-label">Tính chất</span>
            <div className="grid grid-cols-2 gap-2">
              {["Dày", "Mỏng"].map((value) => (
                <button
                  className={cx(
                    "min-h-11 rounded-lg border text-sm font-extrabold",
                    draft.thickness === value
                      ? "border-transparent bg-[#114c41] text-white"
                      : "border-[#d2dfdb] bg-white text-[#114c41]",
                  )}
                  key={value}
                  onClick={() =>
                    setDraft((current) => ({
                      ...current,
                      thickness:
                        current.thickness === value ? "" : value,
                    }))
                  }
                  type="button"
                >
                  {value}
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Số lượng đóng gói">
              <input
                className="ui-module-input"
                inputMode="numeric"
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    packageQuantity: event.target.value,
                  }))
                }
                value={draft.packageQuantity}
              />
            </Field>
            <Field label="Đơn vị tính">
              <input
                className="ui-module-input"
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    packageUnit: event.target.value,
                  }))
                }
                placeholder="Hộp, ram, cây..."
                value={draft.packageUnit}
              />
            </Field>
          </div>
          <Field label="Ghi chú">
            <textarea
              className="ui-module-textarea"
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  note: event.target.value,
                }))
              }
              value={draft.note}
            />
          </Field>
          <FilePicker
            accept="image/*"
            key={fileKey}
            maxFileSizeBytes={8 * 1024 * 1024}
            maxFiles={1}
            onFilesChange={(files) => setImage(files[0] ?? null)}
            triggerLabel="Chọn hình văn phòng phẩm"
            triggerStyle="dashed"
          />
          <Toggle
            checked={removeBackground}
            disabled={!snapshot.environment.workerConfigured}
            label="Loại nền khi lưu"
            onChange={setRemoveBackground}
          />
          <Button
            disabled={!image || !draft.name.trim()}
            onClick={() => void save()}
          >
            <Save size={17} />
            {removeBackground ? "Đưa vào hàng đợi" : "Lưu văn phòng phẩm"}
          </Button>
        </div>
      </section>
      <CatalogPanel
        count={filtered.length}
        onSearch={setSearch}
        search={search}
        title="Danh mục Văn phòng phẩm"
      >
        <div className="grid gap-3 md:grid-cols-2">
          {filtered.map((item) => (
            <article
              className="rounded-lg border border-[#d8e2df] bg-white p-3"
              key={item.id}
            >
              <ItemImage name={item.name} url={item.image.url} />
              <div className="mt-3 flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-black text-[#114c41]">
                    {item.name}
                  </h3>
                  <p className="mt-1 text-xs text-[#6d817b]">
                    {[item.color, item.thickness, item.packageLabel]
                      .filter(Boolean)
                      .join(" · ") || "Chưa có quy cách"}
                  </p>
                </div>
                <DeleteButton
                  onClick={() =>
                    onDelete({
                      id: item.id,
                      label: `"${item.name}"`,
                      recordType: "stationery",
                    })
                  }
                />
              </div>
              <div className="mt-3 text-[10px] text-[#7a8d86]">
                {item.updatedBy || "Dữ liệu đã nhập"} ·{" "}
                {formatDate(item.updatedAt)}
              </div>
            </article>
          ))}
        </div>
        {!filtered.length ? (
          <EmptyState>Chưa có văn phòng phẩm phù hợp.</EmptyState>
        ) : null}
      </CatalogPanel>
    </div>
  );
}

function UniformTab({
  onDelete,
  onQueued,
  onResult,
  setLoadingMessage,
  setWriting,
  snapshot,
}: {
  onDelete: (target: DeleteTarget) => void;
  onQueued: () => void;
  onResult: (result: AssetSetupActionResult<AssetSetupSnapshot>) => boolean;
  setLoadingMessage: (value: string) => void;
  setWriting: (value: boolean) => void;
  snapshot: AssetSetupSnapshot;
}) {
  const [draft, setDraft] = useState(emptyUniformDraft);
  const [image, setImage] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [removeBackground, setRemoveBackground] = useState(false);
  const [search, setSearch] = useState("");
  const filtered = snapshot.uniformItems.filter((item) =>
    normalized(
      `${item.name} ${item.maleSizes.join(" ")} ${item.femaleSizes.join(" ")}`,
    ).includes(normalized(search)),
  );
  const reset = () => {
    setDraft(emptyUniformDraft());
    setImage(null);
    setFileKey((value) => value + 1);
    setRemoveBackground(false);
  };
  const toggleSize = (gender: "femaleSizes" | "maleSizes", size: string) => {
    setDraft((current) => ({
      ...current,
      [gender]: current[gender].includes(size)
        ? current[gender].filter((value) => value !== size)
        : [...current[gender], size],
    }));
  };
  const save = async () => {
    const formData = new FormData();
    formData.set("payload", JSON.stringify(draft));
    formData.set("removeBackground", String(removeBackground));
    if (image) formData.set("image", image);
    setWriting(true);
    setLoadingMessage(
      removeBackground
        ? "Đang tạo tác vụ xử lý nền đồng phục..."
        : "Đang lưu đồng phục và hình ảnh...",
    );
    try {
      const ok = onResult(await saveUniformAction(formData));
      if (ok) {
        reset();
        if (removeBackground) onQueued();
      }
    } finally {
      setWriting(false);
      setLoadingMessage("");
    }
  };
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(340px,0.8fr)_minmax(0,1.25fr)]">
      <section className="ui-module-panel p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.12em] text-brand-strong">
              Tạo danh mục
            </div>
            <h2 className="mt-1 text-lg font-black text-[#114c41]">
              Đồng phục
            </h2>
          </div>
          <Button onClick={reset} size="sm" variant="secondary">
            <RotateCcw size={14} />
            Làm lại
          </Button>
        </div>
        <div className="mt-4 grid gap-4">
          <Field label="Tên đồng phục">
            <input
              className="ui-module-input"
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
              value={draft.name}
            />
          </Field>
          {(
            [
              ["maleSizes", "Size nam"],
              ["femaleSizes", "Size nữ"],
            ] as const
          ).map(([gender, label]) => (
            <div className="ui-module-field" key={gender}>
              <span className="ui-module-label">{label}</span>
              <div className="flex flex-wrap gap-2 rounded-lg border border-[#d7e1de] bg-[#f7faf8] p-3">
                {snapshot.uniformSizeOptions.map((size) => (
                  <button
                    className={cx(
                      "min-h-9 min-w-11 rounded-lg border px-3 text-xs font-black",
                      draft[gender].includes(size)
                        ? "border-transparent bg-[#114c41] text-white"
                        : "border-[#d2dfdb] bg-white text-[#114c41]",
                    )}
                    key={size}
                    onClick={() => toggleSize(gender, size)}
                    type="button"
                  >
                    {size}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <Field label="Ghi chú">
            <textarea
              className="ui-module-textarea"
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  note: event.target.value,
                }))
              }
              value={draft.note}
            />
          </Field>
          <FilePicker
            accept="image/*"
            key={fileKey}
            maxFileSizeBytes={8 * 1024 * 1024}
            maxFiles={1}
            onFilesChange={(files) => setImage(files[0] ?? null)}
            triggerLabel="Chọn hình đồng phục"
            triggerStyle="dashed"
          />
          <Toggle
            checked={removeBackground}
            disabled={!snapshot.environment.workerConfigured}
            label="Loại nền khi lưu"
            onChange={setRemoveBackground}
          />
          <Button
            disabled={!image || !draft.name.trim()}
            onClick={() => void save()}
          >
            <Save size={17} />
            {removeBackground ? "Đưa vào hàng đợi" : "Lưu đồng phục"}
          </Button>
        </div>
      </section>
      <CatalogPanel
        count={filtered.length}
        onSearch={setSearch}
        search={search}
        title="Danh mục Đồng phục"
      >
        <div className="grid gap-3 md:grid-cols-2">
          {filtered.map((item) => (
            <article
              className="rounded-lg border border-[#d8e2df] bg-white p-3"
              key={item.id}
            >
              <ItemImage name={item.name} url={item.image.url} />
              <div className="mt-3 flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-black text-[#114c41]">
                    {item.name}
                  </h3>
                  <p className="mt-1 text-xs text-[#6d817b]">
                    Nam: {item.maleSizes.join(", ") || "—"}
                  </p>
                  <p className="mt-1 text-xs text-[#6d817b]">
                    Nữ: {item.femaleSizes.join(", ") || "—"}
                  </p>
                </div>
                <DeleteButton
                  onClick={() =>
                    onDelete({
                      id: item.id,
                      label: `"${item.name}"`,
                      recordType: "uniform",
                    })
                  }
                />
              </div>
              <div className="mt-3 text-[10px] text-[#7a8d86]">
                {item.updatedBy || "Dữ liệu đã nhập"} ·{" "}
                {formatDate(item.updatedAt)}
              </div>
            </article>
          ))}
        </div>
        {!filtered.length ? (
          <EmptyState>Chưa có đồng phục phù hợp.</EmptyState>
        ) : null}
      </CatalogPanel>
    </div>
  );
}
