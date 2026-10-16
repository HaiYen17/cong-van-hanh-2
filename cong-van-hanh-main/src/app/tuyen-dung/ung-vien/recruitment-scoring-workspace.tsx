"use client";

import {
  Archive,
  CheckCircle2,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Send,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  useToast,
  WriteLoadingOverlay,
} from "@/components/ui/toast";
import { postRpc } from "@/lib/rpc-client";

type Json = Record<string, unknown>;
type StoredRecord = {
  code: string;
  content: Json;
  id: string;
  name: string;
  recordType: string;
  sourceRow: number;
  sourceSheet: string;
  status: string;
  updatedAt: string;
};
type SharedCriterion = {
  code: string;
  content: Json;
  id: string;
  name: string;
  recordType: string;
  status: string;
};
type ConfigData = {
  campaigns: Array<Json>;
  records: StoredRecord[];
  requisitions: Array<Json>;
  sharedCriteria: SharedCriterion[];
};
type Draft = {
  code: string;
  content: Json;
  id: string;
  name: string;
  recordType: string;
  status: string;
};

const MODES = [
  ["group", "Nhóm chấm"],
  ["criterion", "Tiêu chí"],
  ["set", "Bộ tiêu chí"],
  ["round", "Ánh xạ vòng"],
  ["scope", "Phạm vi áp dụng"],
] as const;
const MODE_TYPES: Record<string, string> = {
  criterion: "recruitment-score-criterion",
  group: "recruitment-score-group",
  round: "recruitment-score-round-mapping",
  scope: "recruitment-score-scope-mapping",
  set: "recruitment-score-set",
};

function text(value: unknown) {
  return value == null ? "" : String(value).trim();
}

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function emptyDraft(mode: string): Draft {
  return {
    code: "",
    content: {},
    id: "",
    name: "",
    recordType: MODE_TYPES[mode],
    status: "draft",
  };
}

function codeFromName(value: string, prefix: string) {
  return `${prefix}_${value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "D")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || Date.now().toString(36).toUpperCase()}`;
}

const inputClass =
  "h-11 w-full rounded-lg border border-[#cbdad5] bg-white px-3 text-sm text-[#203a34] outline-none focus:border-brand focus:ring-2 focus:ring-brand/15";
const textareaClass =
  "min-h-24 w-full rounded-lg border border-[#cbdad5] bg-white px-3 py-2 text-sm text-[#203a34] outline-none focus:border-brand focus:ring-2 focus:ring-brand/15";

function Field({
  children,
  label,
  wide,
}: {
  children: React.ReactNode;
  label: string;
  wide?: boolean;
}) {
  return (
    <label className={wide ? "md:col-span-2" : ""}>
      <span className="mb-1.5 block text-xs font-extrabold uppercase tracking-[0.07em] text-[#49665f]">
        {label}
      </span>
      {children}
    </label>
  );
}

function Status({ status }: { status: string }) {
  const published = ["published", "active"].includes(status.toLowerCase());
  return (
    <span
      className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase ${
        published
          ? "border-[#a8d9c8] bg-[#e8f8f1] text-[#0c6e4c]"
          : status === "inactive"
            ? "border-[#ead5d0] bg-[#fff1ee] text-[#a44836]"
            : "border-[#f0d4b7] bg-[#fff5e9] text-[#9a5712]"
      }`}
    >
      {published ? "Đã phát hành" : status === "inactive" ? "Tạm ngưng" : "Bản nháp"}
    </span>
  );
}

export function RecruitmentScoringWorkspace() {
  const { toast } = useToast();
  const [data, setData] = useState<ConfigData | null>(null);
  const [mode, setMode] = useState("group");
  const [draft, setDraft] = useState<Draft>(() => emptyDraft("group"));
  const [lines, setLines] = useState<
    Array<{ criterionId: string; name: string; weight: number }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [writing, setWriting] = useState(false);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(
        await postRpc<ConfigData>(
          "/api/recruitment/rpc",
          "getScoringConfig",
        ),
      );
    } catch (error) {
      toast({
        message: error instanceof Error ? error.message : "Không tải được cấu hình.",
        title: "Lỗi tải dữ liệu",
        tone: "error",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void load();
    });
    return () => {
      active = false;
    };
  }, [load]);

  const records = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("vi");
    return (data?.records || []).filter(
      (record) =>
        record.recordType === MODE_TYPES[mode] &&
        (!query ||
          [record.name, record.code, JSON.stringify(record.content)]
            .join(" ")
            .toLocaleLowerCase("vi")
            .includes(query)),
    );
  }, [data, mode, search]);
  const ownCriteria = (data?.records || []).filter(
    (record) => record.recordType === "recruitment-score-criterion",
  );
  const sharedCriteria = (data?.sharedCriteria || []).filter(
    (record) => record.recordType === "evaluation-criteria",
  );
  const allCriteria = [
    ...ownCriteria.map((record) => ({
      groupId: text(record.content.groupId),
      id: record.id,
      name: record.name,
      source: "Tuyển dụng",
    })),
    ...sharedCriteria.map((record) => ({
      groupId: text(record.content.groupId),
      id: record.id,
      name: record.name,
      source: "Đánh giá nhân sự",
    })),
  ];
  const sets = (data?.records || []).filter(
    (record) => record.recordType === "recruitment-score-set",
  );
  const groups = (data?.records || []).filter(
    (record) => record.recordType === "recruitment-score-group",
  );
  const totalWeight = lines.reduce(
    (sum, line) => sum + numberValue(line.weight),
    0,
  );

  function switchMode(nextMode: string) {
    setMode(nextMode);
    setDraft(emptyDraft(nextMode));
    setLines([]);
    setSearch("");
  }

  function setContent(key: string, value: unknown) {
    setDraft((current) => ({
      ...current,
      content: { ...current.content, [key]: value },
    }));
  }

  function edit(record: StoredRecord) {
    setDraft({
      code: record.code,
      content: record.content,
      id: record.id,
      name: record.name,
      recordType: record.recordType,
      status: record.status,
    });
    if (record.recordType === "recruitment-score-set") {
      setLines(
        Array.isArray(record.content.items)
          ? record.content.items.map((raw) => {
              const item = raw as Json;
              return {
                criterionId: text(item.criterionId),
                name: text(item.name),
                weight: numberValue(item.weight),
              };
            })
          : [],
      );
    }
    window.scrollTo({ behavior: "smooth", top: 0 });
  }

  async function save() {
    const code =
      draft.code ||
      codeFromName(
        draft.name,
        mode === "group"
          ? "NHOM"
          : mode === "criterion"
            ? "TC"
            : mode === "set"
              ? "BO"
              : mode === "round"
                ? "VONG"
                : "PV",
      );
    if (!draft.name.trim()) {
      toast({
        message: "Vui lòng nhập tên cấu hình.",
        title: "Thiếu thông tin",
        tone: "warning",
      });
      return;
    }
    if (mode === "set" && Math.abs(totalWeight - 100) > 0.01) {
      toast({
        message: `Tổng trọng số đang là ${totalWeight}%, cần đúng 100%.`,
        title: "Sai trọng số",
        tone: "warning",
      });
      return;
    }
    setWriting(true);
    try {
      const content = {
        ...draft.content,
        ...(mode === "set" ? { items: lines, totalWeightPercent: totalWeight } : {}),
      };
      await postRpc(
        "/api/recruitment/rpc",
        "saveScoringConfig",
        { ...draft, code, content },
      );
      toast({
        message: "Dữ liệu đã được ghi vào PostgreSQL.",
        title: "Đã lưu cấu hình chấm",
        tone: "success",
      });
      setDraft(emptyDraft(mode));
      setLines([]);
      await load();
    } catch (error) {
      toast({
        message: error instanceof Error ? error.message : "Không lưu được dữ liệu.",
        title: "Lưu thất bại",
        tone: "error",
      });
    } finally {
      setWriting(false);
    }
  }

  async function setStatus(record: StoredRecord, status: string) {
    setWriting(true);
    try {
      await postRpc(
        "/api/recruitment/rpc",
        "setScoringStatus",
        { id: record.id, status },
      );
      toast({
        message:
          status === "published"
            ? "Bộ cấu hình đã sẵn sàng cho phiếu chấm."
            : "Cấu hình đã được tạm ngưng.",
        title: "Đã cập nhật trạng thái",
        tone: "success",
      });
      await load();
    } catch (error) {
      toast({
        message: error instanceof Error ? error.message : "Không cập nhật được.",
        title: "Thao tác thất bại",
        tone: "error",
      });
    } finally {
      setWriting(false);
    }
  }

  function renderFields() {
    if (mode === "group") {
      return (
        <>
          <Field label="Mã nhóm">
            <input
              className={inputClass}
              onChange={(event) =>
                setDraft((current) => ({ ...current, code: event.target.value }))
              }
              placeholder="Tự sinh nếu để trống"
              value={draft.code}
            />
          </Field>
          <Field label="Tên nhóm">
            <input
              className={inputClass}
              onChange={(event) =>
                setDraft((current) => ({ ...current, name: event.target.value }))
              }
              value={draft.name}
            />
          </Field>
          <Field label="Mô tả" wide>
            <textarea
              className={textareaClass}
              onChange={(event) => setContent("description", event.target.value)}
              value={text(draft.content.description)}
            />
          </Field>
        </>
      );
    }
    if (mode === "criterion") {
      return (
        <>
          <Field label="Tên tiêu chí">
            <input
              className={inputClass}
              onChange={(event) =>
                setDraft((current) => ({ ...current, name: event.target.value }))
              }
              value={draft.name}
            />
          </Field>
          <Field label="Nhóm chấm">
            <select
              className={inputClass}
              onChange={(event) => setContent("groupId", event.target.value)}
              value={text(draft.content.groupId)}
            >
              <option value="">Chọn nhóm</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Hướng dẫn chấm" wide>
            <textarea
              className={textareaClass}
              onChange={(event) => setContent("description", event.target.value)}
              value={text(draft.content.description)}
            />
          </Field>
          <Field label="Thang điểm">
            <select
              className={inputClass}
              onChange={(event) => setContent("scaleMax", event.target.value)}
              value={text(draft.content.scaleMax) || "10"}
            >
              <option value="5">0–5</option>
              <option value="10">0–10</option>
            </select>
          </Field>
        </>
      );
    }
    if (mode === "set") {
      return (
        <>
          <Field label="Tên bộ tiêu chí">
            <input
              className={inputClass}
              onChange={(event) =>
                setDraft((current) => ({ ...current, name: event.target.value }))
              }
              value={draft.name}
            />
          </Field>
          <Field label="Tổng trọng số">
            <div
              className={`flex h-11 items-center rounded-lg border px-3 font-black ${
                Math.abs(totalWeight - 100) < 0.01
                  ? "border-[#a8d9c8] bg-[#e8f8f1] text-[#0c6e4c]"
                  : "border-[#f0d4b7] bg-[#fff5e9] text-[#9a5712]"
              }`}
            >
              {totalWeight}% / 100%
            </div>
          </Field>
          <div className="space-y-2 md:col-span-2">
            {lines.map((line, index) => (
              <div
                className="grid gap-2 rounded-lg border border-[#d8e2df] bg-[#f9fbfa] p-2 sm:grid-cols-[1fr_110px_38px]"
                key={`${line.criterionId}-${index}`}
              >
                <select
                  className={inputClass}
                  onChange={(event) => {
                    const criterion = allCriteria.find(
                      (item) => item.id === event.target.value,
                    );
                    setLines((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index
                          ? {
                              ...item,
                              criterionId: event.target.value,
                              name: criterion?.name || "",
                            }
                          : item,
                      ),
                    );
                  }}
                  value={line.criterionId}
                >
                  <option value="">Chọn tiêu chí</option>
                  {allCriteria.map((criterion) => (
                    <option key={criterion.id} value={criterion.id}>
                      {criterion.name} · {criterion.source}
                    </option>
                  ))}
                </select>
                <input
                  className={inputClass}
                  min={0}
                  onChange={(event) =>
                    setLines((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index
                          ? { ...item, weight: numberValue(event.target.value) }
                          : item,
                      ),
                    )
                  }
                  type="number"
                  value={line.weight}
                />
                <button
                  className="grid size-9 place-items-center self-center rounded-lg border border-[#e6d7d1] text-[#a44836]"
                  onClick={() =>
                    setLines((current) =>
                      current.filter((_, itemIndex) => itemIndex !== index),
                    )
                  }
                  type="button"
                >
                  <X size={16} />
                </button>
              </div>
            ))}
            <Button
              onClick={() =>
                setLines((current) => [
                  ...current,
                  { criterionId: "", name: "", weight: 0 },
                ])
              }
              size="sm"
              variant="secondary"
            >
              <Plus size={15} />
              Thêm tiêu chí
            </Button>
          </div>
        </>
      );
    }
    if (mode === "round") {
      return (
        <>
          <Field label="Tên ánh xạ">
            <input
              className={inputClass}
              onChange={(event) =>
                setDraft((current) => ({ ...current, name: event.target.value }))
              }
              value={draft.name}
            />
          </Field>
          <Field label="Vòng đánh giá">
            <select
              className={inputClass}
              onChange={(event) => setContent("roundKey", event.target.value)}
              value={text(draft.content.roundKey)}
            >
              <option value="">Chọn vòng</option>
              <option value="preliminary">Sơ vấn</option>
              <option value="round1">Phỏng vấn vòng 1</option>
              <option value="round2">Phỏng vấn vòng 2</option>
            </select>
          </Field>
          <Field label="Bộ tiêu chí">
            <select
              className={inputClass}
              onChange={(event) => setContent("criteriaSetId", event.target.value)}
              value={text(draft.content.criteriaSetId)}
            >
              <option value="">Chọn bộ tiêu chí</option>
              {sets.map((set) => (
                <option key={set.id} value={set.id}>
                  {set.name}
                </option>
              ))}
            </select>
          </Field>
        </>
      );
    }
    return (
      <>
        <Field label="Tên phạm vi">
          <input
            className={inputClass}
            onChange={(event) =>
              setDraft((current) => ({ ...current, name: event.target.value }))
            }
            value={draft.name}
          />
        </Field>
        <Field label="Loại phạm vi">
          <select
            className={inputClass}
            onChange={(event) => setContent("scopeType", event.target.value)}
            value={text(draft.content.scopeType) || "global"}
          >
            <option value="global">Toàn hệ thống</option>
            <option value="department">Phòng ban</option>
            <option value="team">Team</option>
            <option value="position">Vị trí</option>
            <option value="jd">JD</option>
            <option value="requisition">Yêu cầu tuyển dụng</option>
          </select>
        </Field>
        <Field label="Giá trị phạm vi">
          <input
            className={inputClass}
            onChange={(event) => setContent("scopeValue", event.target.value)}
            placeholder="Mã/tên tương ứng; để trống nếu toàn hệ thống"
            value={text(draft.content.scopeValue)}
          />
        </Field>
        <Field label="Bộ tiêu chí">
          <select
            className={inputClass}
            onChange={(event) => setContent("criteriaSetId", event.target.value)}
            value={text(draft.content.criteriaSetId)}
          >
            <option value="">Chọn bộ tiêu chí</option>
            {sets.map((set) => (
              <option key={set.id} value={set.id}>
                {set.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Thứ tự ưu tiên" wide>
          <div className="rounded-lg border border-[#d8e2df] bg-[#f5f8f7] p-3 text-sm text-[#49665f]">
            Yêu cầu tuyển dụng → JD → Team → Phòng ban → Toàn hệ thống.
          </div>
        </Field>
      </>
    );
  }

  return (
    <div className="relative">
      <WriteLoadingOverlay
        message="Đang ghi cấu hình tuyển dụng vào PostgreSQL..."
        show={writing}
      />
      <div className="flex gap-2 overflow-x-auto border-b border-[#d9e3e0] pb-3">
        {MODES.map(([key, label]) => (
          <button
            className={`shrink-0 rounded-full px-4 py-2 text-sm font-extrabold ${
              mode === key
                ? "bg-[#114c41] text-white"
                : "border border-[#d5e0dc] bg-white text-[#49665f]"
            }`}
            key={key}
            onClick={() => switchMode(key)}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        <section className="rounded-xl border border-[#d2dfdb] bg-white p-5 shadow-[0_14px_34px_rgba(17,76,65,0.06)]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.1em] text-brand-strong">
                Cấu hình chấm
              </div>
              <h2 className="mt-1 text-xl font-black text-[#114c41]">
                {MODES.find(([key]) => key === mode)?.[1]}
              </h2>
            </div>
            {draft.id ? (
              <Button
                onClick={() => {
                  setDraft(emptyDraft(mode));
                  setLines([]);
                }}
                size="sm"
                variant="secondary"
              >
                <Plus size={15} />
                Tạo mới
              </Button>
            ) : null}
          </div>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {renderFields()}
          </div>
          <div className="mt-5 flex justify-end">
            <Button disabled={writing} onClick={() => void save()}>
              <Save size={17} />
              Lưu bản nháp
            </Button>
          </div>
        </section>

        <section className="rounded-xl border border-[#d2dfdb] bg-white p-5 shadow-[0_14px_34px_rgba(17,76,65,0.06)]">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-black text-[#114c41]">
                Cấu hình đã lưu
              </h2>
              <p className="mt-1 text-sm text-[#6d817b]">
                {records.length} bản ghi · bản phát hành mới được dùng khi tạo phiếu.
              </p>
            </div>
            <div className="flex gap-2">
              <input
                className="h-9 w-44 rounded-lg border border-[#cbdad5] px-3 text-sm"
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Tìm nhanh"
                value={search}
              />
              <button
                className="grid size-9 place-items-center rounded-lg border border-[#d5e0dc] text-[#114c41]"
                onClick={() => void load()}
                type="button"
              >
                <RefreshCw className={loading ? "animate-spin" : ""} size={17} />
              </button>
            </div>
          </div>
          <div className="mt-4 space-y-3">
            {records.map((record) => (
              <article
                className="rounded-lg border border-[#d8e2df] bg-[#f9fbfa] p-4"
                key={record.id}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-black text-[#114c41]">{record.name}</h3>
                    <p className="mt-1 text-xs text-[#6d817b]">
                      {record.code}
                      {record.recordType === "recruitment-score-set"
                        ? ` · ${Array.isArray(record.content.items) ? record.content.items.length : 0} tiêu chí`
                        : ""}
                    </p>
                  </div>
                  <Status status={record.status} />
                </div>
                <div className="mt-3 flex flex-wrap justify-end gap-2">
                  <Button
                    onClick={() => edit(record)}
                    size="sm"
                    variant="secondary"
                  >
                    <Pencil size={14} />
                    Sửa
                  </Button>
                  {record.status !== "published" ? (
                    <Button
                      onClick={() => void setStatus(record, "published")}
                      size="sm"
                    >
                      <Send size={14} />
                      Phát hành
                    </Button>
                  ) : (
                    <Button
                      onClick={() => void setStatus(record, "inactive")}
                      size="sm"
                      variant="secondary"
                    >
                      <Archive size={14} />
                      Tạm ngưng
                    </Button>
                  )}
                </div>
              </article>
            ))}
            {!records.length && !loading ? (
              <div className="rounded-lg border border-dashed border-[#cbdad5] p-8 text-center text-sm text-[#6d817b]">
                Chưa có dữ liệu. Tạo bản ghi đầu tiên ở khung bên trái.
              </div>
            ) : null}
          </div>
          {mode === "scope" ? (
            <div className="mt-4 flex items-center gap-2 rounded-lg bg-[#e8f8f1] p-3 text-xs font-bold text-[#0c6e4c]">
              <CheckCircle2 size={16} />
              Logic chọn bộ chấm luôn theo mức cụ thể nhất.
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
