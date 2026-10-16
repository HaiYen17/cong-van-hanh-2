"use client";

import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileDown,
  ListFilter,
  MessageSquareText,
  RefreshCw,
  Save,
  Send,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { useToast, WriteLoadingOverlay } from "@/components/ui/toast";
import {
  applyEvaluationDecisionCalculations,
  normalizeEvaluationDecisionDuration,
  parseEvaluationDecisionDate,
} from "@/lib/evaluation/decision-calculations";
import {
  evaluationDecisionAnswerValues,
  evaluationDecisionFieldIsVisible,
  evaluationDecisionQuestionHtml,
} from "@/lib/evaluation/decision-fields";
import { groupEvaluationWorkspaceScores } from "@/lib/evaluation/workspace-grouping";
import { postRpc } from "@/lib/rpc-client";

type Json = Record<string, unknown>;
type StoredRecord = {
  code: string;
  content: Json;
  id: string;
  name: string;
  note: string;
  parentId: string;
  status: string;
  text: string;
  updatedAt: string;
};
type Workspace = {
  actor: {
    displayName: string;
    employeeCode: string;
    isAdmin: boolean;
  };
  cycles: StoredRecord[];
  decisionFields: StoredRecord[];
  decisionValues: StoredRecord[];
  instances: Array<
    StoredRecord & {
      availableRoles: string[];
    }
  >;
  results: StoredRecord[];
  scores: StoredRecord[];
  selectedId: string;
  selectedRole: string | null;
  workflowSteps: StoredRecord[];
};

const ROLE_LABELS: Record<string, string> = {
  hr: "HR",
  manager: "Cấp trên",
  peer: "Đồng nghiệp",
  self: "Bản thân",
};

function text(value: unknown) {
  return value == null ? "" : String(value).trim();
}

function isActiveStoredRecord(record: StoredRecord) {
  const status = text(record.status || record.content.status).toLowerCase();
  return (
    record.content.isActive !== false &&
    !["archived", "deleted", "inactive"].includes(status)
  );
}

function list(value: unknown) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  return text(value)
    .split(/[,\n;|]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function rolePrefix(role: string) {
  return role === "self" ? "employee" : role;
}

function scoreMax(method: unknown) {
  if (text(method) === "scale_5") return 5;
  if (text(method) === "percent") return 100;
  return 10;
}

function displayScore(value: string, max: number) {
  if (!value) return "—";
  return max === 100 ? `${value}%` : `${value}/${max}`;
}

function decisionDateInputValue(value: unknown) {
  const date = parseEvaluationDecisionDate(value);
  return date ? date.toISOString().slice(0, 10) : "";
}

function decisionDateDisplayValue(value: unknown) {
  const raw = text(value);
  if (raw.toLocaleLowerCase("vi") === "vĩnh viễn") return "Vĩnh viễn";
  const date = parseEvaluationDecisionDate(raw);
  if (!date) return raw;
  return [
    String(date.getUTCDate()).padStart(2, "0"),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    date.getUTCFullYear(),
  ].join("/");
}

function scoreLevelItems(score: StoredRecord) {
  if (score.content.scoreLevelDescriptionsEnabled !== true) return [];
  const descriptions = score.content.scoreLevelDescriptions;
  if (
    !descriptions ||
    typeof descriptions !== "object" ||
    Array.isArray(descriptions)
  ) {
    return [];
  }
  return Object.entries(descriptions as Json)
    .map(([value, description]) => ({
      description: text(description),
      numericValue: Number(value),
      value,
    }))
    .filter(
      (item) =>
        Number.isFinite(item.numericValue) &&
        Number.isInteger(item.numericValue) &&
        Boolean(item.description),
    )
    .sort((left, right) => left.numericValue - right.numericValue);
}

function scoreLevelDescription(score: StoredRecord, value: string) {
  if (!value) return "";
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || !Number.isInteger(numeric)) return "";
  return (
    scoreLevelItems(score).find((item) => item.numericValue === numeric)
      ?.description || ""
  );
}

function statusLabel(value: unknown) {
  const status = text(value).toLowerCase();
  if (status === "finalized") return "Đã chốt";
  if (status === "completed") return "Hoàn tất";
  if (status === "in_progress") return "Đang thực hiện";
  if (status === "draft") return "Bản nháp";
  return status || "Chưa bắt đầu";
}

function FieldLabel({
  children,
  required,
}: {
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <span className="mb-1.5 block text-xs font-extrabold uppercase tracking-[0.08em] text-[#48665f]">
      {children}
      {required ? <span className="ml-1 text-danger">*</span> : null}
    </span>
  );
}

export function EvaluationWorkspace() {
  const { toast } = useToast();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [role, setRole] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [query, setQuery] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [loading, setLoading] = useState(true);
  const [writing, setWriting] = useState(false);
  const [scoreDraft, setScoreDraft] = useState<
    Record<string, { comment: string; score: string }>
  >({});
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [overallComment, setOverallComment] = useState("");

  const load = useCallback(
    async (instanceId?: string, requestedRole?: string) => {
      setLoading(true);
      try {
        const result = await postRpc<Workspace>(
          "/api/evaluation/rpc",
          "getWorkspace",
          {
            instanceId: instanceId || selectedId,
            role: requestedRole || role,
          },
        );
        setWorkspace(result);
        setSelectedId(result.selectedId);
        const nextRole = requestedRole || result.selectedRole || "";
        setRole(nextRole);
        const prefix = rolePrefix(nextRole);
        setScoreDraft(
          Object.fromEntries(
            result.scores.map((score) => [
              score.id,
              {
                comment: text(score.content[`${prefix}Comment`]),
                score:
                  score.content[`${prefix}Score`] == null
                    ? ""
                    : text(score.content[`${prefix}Score`]),
              },
            ]),
          ),
        );
        const selected = result.instances.find(
          (instance) => instance.id === result.selectedId,
        );
        const decisionAnswers = (selected?.content.decisionAnswers ||
          {}) as Json;
        setAnswers((decisionAnswers[nextRole] as Record<string, unknown>) || {});
        setOverallComment(text(selected?.content[`${prefix}OverallComment`]));
      } catch (error) {
        toast({
          message: error instanceof Error ? error.message : String(error),
          title: "Không tải được phiếu đánh giá",
          tone: "error",
        });
      } finally {
        setLoading(false);
      }
    },
    [role, selectedId, toast],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    // Chỉ nạp lần đầu; những lần đổi phiếu/vai trò gọi load trực tiếp.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = workspace?.instances.find(
    (instance) => instance.id === selectedId,
  );
  const content = selected?.content || {};
  const prefix = rolePrefix(role);
  const activeRoles = list(content.activeStepRoles);
  const reviewStatus = text(content[`${prefix}ReviewStatus`]);
  const locked =
    ["finalized", "completed"].includes(text(content.status).toLowerCase()) ||
    reviewStatus === "submitted" ||
    (activeRoles.length > 0 &&
      !activeRoles.includes(role) &&
      !workspace?.actor.isAdmin);

  const cycleOptions = useMemo(
    () =>
      Array.from(
        new Set(
          (workspace?.instances || [])
            .map((instance) =>
              text(
                instance.content.cycleTypeName ||
                  instance.content.cycleName ||
                  instance.content.cycleTypeCode,
              ),
            )
            .filter(Boolean),
        ),
      ),
    [workspace],
  );
  const filteredInstances = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("vi");
    return (workspace?.instances || []).filter((instance) => {
      const type = text(
        instance.content.cycleTypeName ||
          instance.content.cycleName ||
          instance.content.cycleTypeCode,
      );
      if (typeFilter && type !== typeFilter) return false;
      if (!normalized) return true;
      return [
        instance.name,
        instance.code,
        instance.content.employeeCode,
        instance.content.jdJobTitleName,
      ]
        .map(text)
        .join(" ")
        .toLocaleLowerCase("vi")
        .includes(normalized);
    });
  }, [query, typeFilter, workspace]);

  const scoreSections = useMemo(
    () => groupEvaluationWorkspaceScores(workspace?.scores || []),
    [workspace],
  );
  const displayScoreGroups = useMemo(
    () =>
      scoreSections.flatMap((section, sectionIndex) =>
        section.groups.map((group, groupIndex) => ({
          ...group,
          contentMode: section.contentMode,
          isSectionStart: groupIndex === 0,
          sectionIndex,
          sectionKey: section.key,
          sectionName: section.name,
          sectionWeightPercent: section.weightPercent,
        })),
      ),
    [scoreSections],
  );

  const roleDecisionFields = useMemo(
    () =>
      (workspace?.decisionFields || []).filter((field) => {
        if (!isActiveStoredRecord(field)) return false;
        const fieldRole = text(
          field.content.role || field.content.evaluatorRole,
        );
        return !fieldRole || fieldRole === role;
      }),
    [role, workspace],
  );
  const resolvedAnswers = useMemo(
    () =>
      applyEvaluationDecisionCalculations(roleDecisionFields, {
        ...answers,
      }),
    [answers, roleDecisionFields],
  );
  const visibleDecisionFields = useMemo(
    () =>
      roleDecisionFields.filter((field) =>
        evaluationDecisionFieldIsVisible(field.content, resolvedAnswers),
      ),
    [resolvedAnswers, roleDecisionFields],
  );

  async function submit(mode: "draft" | "submit") {
    if (!selected || !role) return;
    setWriting(true);
    try {
      const result = await postRpc<{ message: string }>(
        "/api/evaluation/rpc",
        "saveReview",
        {
          answers: resolvedAnswers,
          instanceId: selected.id,
          overallComment,
          role,
          scores: Object.entries(scoreDraft).map(([id, value]) => ({
            comment: value.comment,
            id,
            score: value.score,
          })),
          submissionMode: mode,
        },
      );
      toast({
        message: result.message,
        title: mode === "submit" ? "Đã gửi đánh giá" : "Đã lưu bản nháp",
        tone: "success",
      });
      await load(selected.id, role);
    } catch (error) {
      toast({
        message: error instanceof Error ? error.message : String(error),
        title: mode === "submit" ? "Chưa gửi được đánh giá" : "Chưa lưu được",
        tone: "error",
      });
    } finally {
      setWriting(false);
    }
  }

  function renderDecisionInput(field: StoredRecord) {
    const fieldKey = field.code || field.id;
    const kind = text(field.content.fieldType || field.content.type);
    const value = resolvedAnswers[fieldKey] || "";
    const scalarValue = text(value);
    const common = {
      disabled: locked,
      id: `decision-${field.id}`,
      onChange: (
        event: React.ChangeEvent<
          HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
        >,
      ) =>
        setAnswers((current) => ({
          ...current,
          [fieldKey]: event.target.value,
        })),
      value: scalarValue,
    };
    if (kind === "calculated_date") {
      return (
        <input
          className="h-11 w-full rounded-lg border border-[#cbdad5] bg-[#eef5f2] px-3 text-sm font-semibold text-[#315e54] outline-none"
          disabled={locked}
          id={`decision-${field.id}`}
          placeholder="Tự sinh từ các trường nguồn"
          readOnly
          type="text"
          value={decisionDateDisplayValue(value)}
        />
      );
    }
    if (kind === "duration") {
      const duration = normalizeEvaluationDecisionDuration(value);
      const unit = duration.permanent ? "forever" : duration.unit || "day";
      return (
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(130px,0.65fr)] gap-2">
          <input
            className="h-11 min-w-0 rounded-lg border border-[#cbdad5] bg-white px-3 text-sm outline-none focus:border-brand disabled:bg-[#eef2f1]"
            disabled={locked || unit === "forever"}
            min="1"
            onChange={(event) =>
              setAnswers((current) => ({
                ...current,
                [fieldKey]: {
                  amount: event.target.value,
                  unit,
                },
              }))
            }
            placeholder={unit === "forever" ? "Không giới hạn" : "Số lượng"}
            step="1"
            type="number"
            value={duration.amount > 0 ? String(duration.amount) : ""}
          />
          <select
            className="h-11 min-w-0 rounded-lg border border-[#cbdad5] bg-white px-3 text-sm outline-none focus:border-brand"
            disabled={locked}
            onChange={(event) =>
              setAnswers((current) => ({
                ...current,
                [fieldKey]: {
                  amount:
                    event.target.value === "forever"
                      ? ""
                      : duration.amount > 0
                        ? String(duration.amount)
                        : "",
                  unit: event.target.value,
                },
              }))
            }
            value={unit}
          >
            <option value="day">Ngày</option>
            <option value="month">Tháng</option>
            <option value="year">Năm</option>
            <option value="forever">Vĩnh viễn</option>
          </select>
        </div>
      );
    }
    if (kind === "boolean" || kind === "yes_no") {
      return (
        <select
          {...common}
          className="h-11 w-full rounded-lg border border-[#cbdad5] bg-white px-3 text-sm outline-none focus:border-brand"
        >
          <option value="">Chọn</option>
          <option value="yes">Có</option>
          <option value="no">Không</option>
        </select>
      );
    }
    const configuredOptions = list(
      field.content.options || field.content.optionValues || field.content.choices,
    );
    if (kind === "multi_choice") {
      const selectedValues = evaluationDecisionAnswerValues(value);
      return (
        <div className="grid gap-2 sm:grid-cols-2">
          {configuredOptions.map((option) => {
            const checked = selectedValues.includes(option);
            return (
              <label
                className="flex min-h-11 items-center gap-2 rounded-lg border border-[#cbdad5] bg-white px-3 py-2 text-sm font-semibold text-[#24463f] has-[:checked]:border-[#d66a2c] has-[:checked]:bg-[#fff4eb]"
                key={option}
              >
                <input
                  checked={checked}
                  className="h-4 w-4 accent-[#d66a2c]"
                  disabled={locked}
                  onChange={(event) =>
                    setAnswers((current) => ({
                      ...current,
                      [fieldKey]: event.target.checked
                        ? [...selectedValues, option]
                        : selectedValues.filter((item) => item !== option),
                    }))
                  }
                  type="checkbox"
                />
                <span>{option}</span>
              </label>
            );
          })}
        </div>
      );
    }
    if (kind === "select" || kind === "single_choice") {
      return (
        <select
          {...common}
          className="h-11 w-full rounded-lg border border-[#cbdad5] bg-white px-3 text-sm outline-none focus:border-brand"
        >
          <option value="">Chọn</option>
          {configuredOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      );
    }
    if (kind === "long_text") {
      return (
        <textarea
          {...common}
          className="min-h-24 w-full rounded-lg border border-[#cbdad5] bg-white px-3 py-2 text-sm outline-none focus:border-brand"
        />
      );
    }
    return (
      <input
        {...common}
        className="h-11 w-full rounded-lg border border-[#cbdad5] bg-white px-3 text-sm outline-none focus:border-brand"
        type={
          kind === "date"
            ? "date"
            : ["number", "percent", "currency"].includes(kind)
              ? "number"
              : "text"
        }
        value={kind === "date" ? decisionDateInputValue(value) : scalarValue}
      />
    );
  }

  return (
    <div className="relative mt-5 overflow-hidden rounded-xl border border-[#cedbd7] bg-[#f5f8f7] shadow-[0_16px_38px_rgba(17,76,65,0.08)]">
      <WriteLoadingOverlay
        message="Đang ghi phiếu đánh giá vào PostgreSQL..."
        show={writing}
      />
      <div className="flex min-h-[720px]">
        <aside
          className={`${drawerOpen ? "w-[330px]" : "w-0"} shrink-0 overflow-hidden border-r border-[#d5e0dc] bg-white transition-[width] duration-200 max-lg:absolute max-lg:inset-y-0 max-lg:left-0 max-lg:z-30 ${
            drawerOpen ? "max-lg:w-[min(88vw,340px)]" : "max-lg:w-0"
          }`}
        >
          <div className="flex h-full w-[330px] flex-col p-4 max-lg:w-[min(88vw,340px)]">
            <div className="flex items-start justify-between gap-3 border-b border-[#e2e9e6] pb-3">
              <div>
                <div className="text-xs font-black uppercase tracking-[0.12em] text-brand-strong">
                  Phiếu được gán
                </div>
                <h2 className="mt-1 text-lg font-black text-[#114c41]">
                  Chọn loại đánh giá
                </h2>
              </div>
              <button
                aria-label="Thu gọn danh sách"
                className="grid size-9 place-items-center rounded-lg border border-[#d5e0dc] text-[#114c41]"
                onClick={() => setDrawerOpen(false)}
                type="button"
              >
                <ChevronLeft size={18} />
              </button>
            </div>
            <div className="mt-3 grid gap-2">
              <select
                className="h-10 rounded-lg border border-[#cbdad5] bg-white px-3 text-sm"
                onChange={(event) => setTypeFilter(event.target.value)}
                value={typeFilter}
              >
                <option value="">Tất cả loại đánh giá</option>
                {cycleOptions.map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
              <div className="relative">
                <ListFilter
                  className="absolute left-3 top-2.5 text-[#6d817b]"
                  size={17}
                />
                <input
                  className="h-10 w-full rounded-lg border border-[#cbdad5] pl-9 pr-3 text-sm"
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Tìm tên, MNV, chức danh"
                  value={query}
                />
              </div>
            </div>
            <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
              {filteredInstances.map((instance) => {
                const isSelected = instance.id === selectedId;
                return (
                  <button
                    className={`w-full rounded-lg border p-3 text-left transition ${
                      isSelected
                        ? "border-brand bg-brand-soft shadow-sm"
                        : "border-[#dce5e2] bg-white hover:border-[#9cbdb4]"
                    }`}
                    key={instance.id}
                    onClick={() => void load(instance.id)}
                    type="button"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <strong className="text-sm text-[#114c41]">
                        {instance.name || "Phiếu đánh giá"}
                      </strong>
                      <span className="rounded-full bg-[#e9f4f0] px-2 py-0.5 text-[10px] font-extrabold text-[#176754]">
                        {statusLabel(
                          instance.content.status || instance.status,
                        )}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-[#697d77]">
                      {text(instance.content.employeeCode)} ·{" "}
                      {text(instance.content.jdJobTitleName) ||
                        "Chưa có chức danh"}
                    </div>
                    <div className="mt-1 text-[11px] font-semibold text-[#9a5712]">
                      {text(instance.content.cycleName)}
                    </div>
                  </button>
                );
              })}
              {!filteredInstances.length && !loading ? (
                <div className="rounded-lg border border-dashed border-[#cbdad5] p-5 text-center text-sm text-[#6d817b]">
                  Không có phiếu phù hợp bộ lọc.
                </div>
              ) : null}
            </div>
          </div>
        </aside>

        <main className="min-w-0 flex-1 bg-[#f8faf9]">
          <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-[#d8e2df] bg-white/95 px-5 py-3 backdrop-blur">
            <div className="flex min-w-0 items-center gap-3">
              {!drawerOpen ? (
                <button
                  aria-label="Mở danh sách phiếu"
                  className="grid size-10 shrink-0 place-items-center rounded-lg border border-[#d5e0dc] text-[#114c41]"
                  onClick={() => setDrawerOpen(true)}
                  type="button"
                >
                  <ChevronRight size={18} />
                </button>
              ) : null}
              <div className="min-w-0">
                <div className="text-[11px] font-black uppercase tracking-[0.12em] text-brand-strong">
                  Chấm điểm
                </div>
                <h2 className="truncate text-lg font-black text-[#114c41]">
                  {selected?.name || "Chọn một phiếu để bắt đầu"}
                </h2>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {selected?.availableRoles?.length ? (
                <select
                  className="h-9 rounded-full border border-[#b9d2ca] bg-[#e9f4f0] px-3 text-xs font-extrabold text-[#114c41]"
                  onChange={(event) =>
                    void load(selected.id, event.target.value)
                  }
                  value={role}
                >
                  {selected.availableRoles.map((item) => (
                    <option key={item} value={item}>
                      {ROLE_LABELS[item] || item}
                    </option>
                  ))}
                </select>
              ) : null}
              <button
                aria-label="Tải lại"
                className="grid size-9 place-items-center rounded-lg border border-[#d5e0dc] text-[#114c41]"
                onClick={() => void load(selectedId, role)}
                type="button"
              >
                <RefreshCw
                  className={loading ? "animate-spin" : ""}
                  size={17}
                />
              </button>
            </div>
          </header>

          {!selected ? (
            <div className="grid min-h-[620px] place-items-center p-8">
              <div className="max-w-md text-center">
                <CheckCircle2 className="mx-auto text-[#b7cbc5]" size={48} />
                <h3 className="mt-4 text-xl font-black text-[#114c41]">
                  Chọn một phiếu để bắt đầu
                </h3>
                <p className="mt-2 text-sm leading-6 text-[#6d817b]">
                  Danh sách chỉ hiển thị phiếu thuộc vai trò được phân công của
                  ông.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-4 p-5">
              <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {[
                  ["Kỳ đánh giá", content.cycleName],
                  ["Vai trò", ROLE_LABELS[role] || role],
                  ["JD áp dụng", content.jdJobTitleName || content.jdFileName],
                  [
                    "Trạng thái",
                    statusLabel(content.status || selected.status),
                  ],
                ].map(([label, value]) => (
                  <div
                    className="rounded-lg border border-[#d8e2df] bg-white p-3"
                    key={String(label)}
                  >
                    <span className="text-[11px] font-extrabold uppercase text-[#72857f]">
                      {String(label)}
                    </span>
                    <strong className="mt-1 block text-sm text-[#114c41]">
                      {text(value) || "Chưa có"}
                    </strong>
                  </div>
                ))}
              </section>

              <section className="rounded-lg border border-[#cbdad5] bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-black text-[#114c41]">
                      Tiến độ đánh giá
                    </h3>
                    <p className="mt-1 text-xs text-[#6d817b]">
                      Phiếu tự mở đúng vai trò theo workflow đã cấu hình.
                    </p>
                  </div>
                  <span className="rounded-full bg-[#fff1e6] px-3 py-1 text-xs font-extrabold text-[#a6531d]">
                    {reviewStatus === "submitted"
                      ? "Đã gửi"
                      : reviewStatus === "draft"
                        ? "Đã lưu nháp"
                        : locked
                          ? "Chưa tới lượt"
                          : "Đang tới lượt"}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {["self", "manager", "peer", "hr"].map((item) => {
                    const state = text(
                      content[`${rolePrefix(item)}ReviewStatus`],
                    );
                    const active = activeRoles.includes(item);
                    if (
                      !state &&
                      !active &&
                      !selected.availableRoles.includes(item)
                    ) {
                      return null;
                    }
                    return (
                      <span
                        className={`rounded-full border px-3 py-1 text-xs font-bold ${
                          state === "submitted"
                            ? "border-[#a9d9c8] bg-[#e8f8f1] text-[#0c6e4c]"
                            : active
                              ? "border-[#e9a772] bg-[#fff2e8] text-[#9a5712]"
                              : "border-[#d6e1dd] bg-[#f4f7f6] text-[#667b75]"
                        }`}
                        key={item}
                      >
                        {ROLE_LABELS[item]} ·{" "}
                        {state === "submitted"
                          ? "đã gửi"
                          : state === "draft"
                            ? "bản nháp"
                            : active
                              ? "đang chờ"
                              : "chưa tới lượt"}
                      </span>
                    );
                  })}
                </div>
              </section>

              {workspace?.results.length ||
              ["finalized", "completed"].includes(
                text(content.status).toLowerCase(),
              ) ? (
                <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#a9d9c8] bg-[#e8f8f1] p-4">
                  <div>
                    <div className="text-xs font-black uppercase tracking-[0.1em] text-[#0c6e4c]">
                      Hồ sơ kết quả
                    </div>
                    <div className="mt-1 font-black text-[#114c41]">
                      Điểm cuối {text(content.finalScore) || "—"}/10 ·{" "}
                      {text(
                        workspace?.results[0]?.content.decisionOptionLabel ||
                          content.decisionOptionLabel,
                      ) || "Chưa ghi kết luận"}
                    </div>
                  </div>
                  <a
                    className="inline-flex h-10 items-center gap-2 rounded-full bg-[#114c41] px-4 text-sm font-bold text-white"
                    href={`/api/evaluation/result-pdf?instanceId=${encodeURIComponent(
                      selected.id,
                    )}`}
                    rel="noopener"
                    target="_blank"
                  >
                    <FileDown size={17} />
                    Mở PDF
                  </a>
                </section>
              ) : null}

              {displayScoreGroups.map((group) => (
                <div
                  className="space-y-3"
                  key={`${group.sectionKey}:${group.key}`}
                >
                  {group.isSectionStart ? (
                    <section className="overflow-hidden rounded-lg border border-[#d98a50] bg-gradient-to-r from-[#114c41] to-[#176758] shadow-[0_10px_28px_rgba(17,76,65,0.16)]">
                      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 text-white">
                        <div>
                          <div className="text-[11px] font-black uppercase tracking-[0.14em] text-[#ffd6b7]">
                            Nhóm tiêu chí {group.sectionIndex + 1}
                          </div>
                          <h2 className="mt-1 text-xl font-black">
                            {group.sectionName}
                          </h2>
                        </div>
                        {group.sectionWeightPercent ? (
                          <span className="rounded-full border border-white/30 bg-white/15 px-3 py-1 text-xs font-black">
                            Trọng số {group.sectionWeightPercent}%
                          </span>
                        ) : null}
                      </div>
                    </section>
                  ) : null}
                  <section className="overflow-hidden rounded-lg border border-[#cbdad5] bg-white">
                    {group.contentMode === "jd_dynamic" ? (
                      <div className="border-b border-[#dce5e2] bg-[#eef5f2] px-4 py-3">
                        <div className="text-[11px] font-black uppercase tracking-[0.1em] text-brand-strong">
                          Nhóm công việc
                        </div>
                        <h3 className="mt-1 font-black text-[#114c41]">
                          {group.name}
                        </h3>
                      </div>
                    ) : null}
                    <div className="divide-y divide-[#e2e9e6]">
                      {group.activities.map((activity) => (
                        <article className="p-4" key={activity.key}>
                          {group.contentMode === "jd_dynamic" ? (
                            <div className="mb-3">
                              <h4 className="font-bold leading-6 text-[#203a34]">
                                {activity.activity}
                              </h4>
                              {activity.expected ? (
                                <p className="mt-1 text-xs leading-5 text-[#6d817b]">
                                  Đầu ra: {activity.expected}
                                </p>
                              ) : null}
                            </div>
                          ) : null}
                          <div className="space-y-3">
                            {activity.rows.map((score) => {
                              const draft = scoreDraft[score.id] || {
                                comment: "",
                                score: "",
                              };
                              const max = scoreMax(score.content.scoringMethod);
                              const levelItems = scoreLevelItems(score);
                              const hasLevelDescriptions =
                                levelItems.length > 0;
                              const usesDiscreteScale =
                                hasLevelDescriptions ||
                                text(score.content.scoringMethod) === "scale_5";
                              const levelDescription = scoreLevelDescription(
                                score,
                                draft.score,
                              );
                              const employeeScore = text(
                                score.content.employeeScore,
                              );
                              return (
                                <div
                                  className="grid gap-3 rounded-lg border border-[#e0e8e5] bg-[#fbfcfc] p-3 lg:grid-cols-[minmax(180px,1fr)_minmax(260px,1.3fr)]"
                                  key={score.id}
                                >
                                  <div>
                                    <div className="flex items-start justify-between gap-3">
                                      <strong className="text-sm text-[#114c41]">
                                        {text(
                                          score.content.criteriaName ||
                                            score.name,
                                        )}
                                      </strong>
                                      <output className="rounded-md bg-[#114c41] px-2 py-1 text-xs font-black text-white">
                                        {displayScore(draft.score, max)}
                                      </output>
                                    </div>
                                    <div className="mt-1 text-[11px] text-[#748780]">
                                      Trọng số{" "}
                                      {text(score.content.weightPercent) || "0"}
                                      % · Thang {max}
                                    </div>
                                    {role === "manager" && employeeScore ? (
                                      <details className="mt-2 rounded-md border border-[#cde0da] bg-[#eef6f3] p-2 text-xs text-[#315e54]">
                                        <summary className="cursor-pointer font-bold">
                                          NV tự chấm {employeeScore}/{max}
                                        </summary>
                                        <p className="mt-1 leading-5">
                                          {text(
                                            score.content.employeeComment,
                                          ) || "Nhân viên không nhập ghi chú."}
                                        </p>
                                      </details>
                                    ) : null}
                                  </div>
                                  <div>
                                    <input
                                      className="w-full accent-brand"
                                      disabled={locked}
                                      max={max}
                                      min="0"
                                      onChange={(event) =>
                                        setScoreDraft((current) => ({
                                          ...current,
                                          [score.id]: {
                                            ...draft,
                                            score: event.target.value,
                                          },
                                        }))
                                      }
                                      step={usesDiscreteScale ? "1" : "0.5"}
                                      type="range"
                                      value={draft.score || "0"}
                                    />
                                    <section className="mt-2 overflow-hidden rounded-lg border border-[#f0c6a7] bg-[#fffaf5]">
                                      <div
                                        aria-live="polite"
                                        className="border-b border-[#f4d9c5] px-3 py-2 text-sm leading-5 text-[#6f452c]"
                                      >
                                        <strong className="block text-[11px] font-black uppercase tracking-[0.08em] text-[#b65a24]">
                                          Chi tiết chấm điểm
                                        </strong>
                                        {levelDescription ? (
                                          <p className="mt-1">
                                            <strong className="mr-1 text-[#9f4c20]">
                                              Mức {draft.score}:
                                            </strong>
                                            {levelDescription}
                                          </p>
                                        ) : hasLevelDescriptions ? (
                                          <p className="mt-1 text-xs text-[#806757]">
                                            Kéo thanh điểm để xem ngay ý nghĩa
                                            của mức đang chọn.
                                          </p>
                                        ) : (
                                          <p className="mt-1 text-xs font-semibold text-[#9b4f28]">
                                            Tiêu chí này chưa được cấu hình ý
                                            nghĩa từng mức điểm. Admin cần bổ
                                            sung tại Cấu hình → Tiêu chí.
                                          </p>
                                        )}
                                      </div>
                                      {hasLevelDescriptions ? (
                                        <details className="group px-3 py-2">
                                          <summary className="cursor-pointer list-none text-xs font-extrabold text-[#9f4c20] marker:content-none">
                                            <span className="inline-flex items-center gap-1.5">
                                              Xem đầy đủ {levelItems.length} mức
                                              điểm
                                              <ChevronRight
                                                className="transition-transform group-open:rotate-90"
                                                size={14}
                                              />
                                            </span>
                                          </summary>
                                          <div className="mt-2 grid gap-1.5">
                                            {levelItems.map((item) => {
                                              const selected =
                                                draft.score !== "" &&
                                                Number(draft.score) ===
                                                  item.numericValue;
                                              return (
                                                <div
                                                  className={`grid grid-cols-[34px_minmax(0,1fr)] gap-2 rounded-md border px-2.5 py-2 text-xs leading-5 ${
                                                    selected
                                                      ? "border-[#df8f59] bg-[#fff0e4] text-[#713f25]"
                                                      : "border-[#eedfd4] bg-white text-[#596d66]"
                                                  }`}
                                                  key={item.value}
                                                >
                                                  <strong className="text-center text-[#b65a24]">
                                                    {item.value}
                                                  </strong>
                                                  <span>
                                                    {item.description}
                                                  </span>
                                                </div>
                                              );
                                            })}
                                          </div>
                                        </details>
                                      ) : null}
                                    </section>
                                    <div className="mt-2 flex gap-2">
                                      <MessageSquareText
                                        className="mt-2 shrink-0 text-[#789089]"
                                        size={17}
                                      />
                                      <textarea
                                        className="min-h-16 w-full rounded-lg border border-[#d4dfdc] bg-white px-3 py-2 text-sm outline-none focus:border-brand"
                                        disabled={locked}
                                        onChange={(event) =>
                                          setScoreDraft((current) => ({
                                            ...current,
                                            [score.id]: {
                                              ...draft,
                                              comment: event.target.value,
                                            },
                                          }))
                                        }
                                        placeholder="Nhận xét riêng cho tiêu chí"
                                        value={draft.comment}
                                      />
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>
                </div>
              ))}

              {visibleDecisionFields.length ? (
                <section className="rounded-lg border border-[#cbdad5] bg-white p-4">
                  <h3 className="font-black text-[#114c41]">Thông tin thêm</h3>
                  <p className="mt-1 text-xs text-[#6d817b]">
                    Các câu hỏi ngoài điểm số của mẫu đánh giá.
                  </p>
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    {visibleDecisionFields.map((field) => (
                      <label
                        className={
                          text(field.content.fieldType) === "long_text"
                            ? "md:col-span-2"
                            : ""
                        }
                        key={field.id}
                      >
                        <div className="mb-1.5 text-xs font-extrabold text-[#48665f]">
                          {evaluationDecisionQuestionHtml(field.content) ? (
                            <div
                              className="leading-relaxed"
                              dangerouslySetInnerHTML={{
                                __html: evaluationDecisionQuestionHtml(field.content),
                              }}
                            />
                          ) : (
                            field.name || field.code
                          )}
                          {Boolean(field.content.isRequired) ? (
                            <span className="ml-1 text-danger">*</span>
                          ) : null}
                        </div>
                        {renderDecisionInput(field)}
                      </label>
                    ))}
                  </div>
                </section>
              ) : null}

              <section className="rounded-lg border border-[#cbdad5] bg-white p-4">
                <label>
                  <FieldLabel>Nhận xét chung</FieldLabel>
                  <textarea
                    className="min-h-28 w-full rounded-lg border border-[#cbdad5] bg-white px-3 py-2 text-sm outline-none focus:border-brand"
                    disabled={locked}
                    onChange={(event) => setOverallComment(event.target.value)}
                    placeholder="Nhập nhận xét chung cho phiếu này"
                    value={overallComment}
                  />
                </label>
                {locked ? (
                  <div className="mt-3 rounded-lg border border-[#ead4b9] bg-[#fff7ed] p-3 text-sm font-semibold text-[#8b541f]">
                    {reviewStatus === "submitted"
                      ? "Ông đã gửi phần đánh giá của mình. Phiếu đang chờ bước tiếp theo."
                      : "Chưa tới lượt của ông hoặc phiếu đã được chốt. Màn hình chuyển sang chế độ chỉ xem."}
                  </div>
                ) : null}
                <div className="mt-4 flex flex-wrap justify-end gap-2">
                  <Button
                    disabled={locked || writing}
                    onClick={() => void submit("draft")}
                    variant="secondary"
                  >
                    <Save size={17} />
                    Lưu nháp
                  </Button>
                  <Button
                    disabled={locked || writing}
                    onClick={() => {
                      if (
                        window.confirm(
                          "Gửi đánh giá? Sau khi gửi, phiếu sẽ chuyển sang bước tiếp theo.",
                        )
                      ) {
                        void submit("submit");
                      }
                    }}
                  >
                    <Send size={17} />
                    Gửi đánh giá
                  </Button>
                </div>
              </section>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
