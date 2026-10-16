"use client";

import {
  Archive,
  BellRing,
  CheckCircle2,
  FileSearch,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Rocket,
  Save,
  Send,
  Trash2,
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
  createdAt: string;
  id: string;
  name: string;
  note: string;
  parentId: string;
  status: string;
  text: string;
  updatedAt: string;
};
type Employee = {
  department: string | null;
  employeeCode: string;
  fullName: string;
  title: string | null;
};
type ConfigData = {
  counts: Record<string, number>;
  employees: Employee[];
  jdDocuments: StoredRecord[];
  references: StoredRecord[];
  records: StoredRecord[];
  tab: string;
};
type Draft = {
  code: string;
  content: Json;
  id: string;
  name: string;
  note: string;
  parentId: string;
  recordType: string;
  status: string;
};

const TABS = [
  ["overview", "Tổng quan"],
  ["levels", "Cấp bậc"],
  ["sources", "Nguồn"],
  ["criteria", "Tiêu chí"],
  ["workflow", "Workflow"],
  ["types", "Loại đánh giá"],
  ["cycles", "Kỳ & phân bổ"],
  ["monitoring", "Theo dõi"],
] as const;

const TAB_RECORD_TYPES: Record<string, string> = {
  criteria: "evaluation-score-group",
  cycles: "evaluation-cycle",
  levels: "evaluation-position-level",
  monitoring: "evaluation-instance",
  sources: "evaluation-source",
  types: "evaluation-cycle-type-template",
  workflow: "evaluation-workflow-template",
};

const TYPE_LABELS: Record<string, string> = {
  "evaluation-criteria": "Tiêu chí",
  "evaluation-criteria-set": "Bộ tiêu chí",
  "evaluation-criteria-set-item": "Tiêu chí trong bộ",
  "evaluation-cycle": "Kỳ đánh giá",
  "evaluation-cycle-member": "Phân bổ nhân sự",
  "evaluation-cycle-type-template": "Loại đánh giá",
  "evaluation-final-result": "Kết quả cuối",
  "evaluation-generation-job": "Tác vụ sinh phiếu",
  "evaluation-instance": "Phiếu đánh giá",
  "evaluation-jd-activity-rule": "Quy tắc phân loại JD",
  "evaluation-jd-classification-job": "Tác vụ phân loại JD",
  "evaluation-jd-document": "Tài liệu JD",
  "evaluation-position-level": "Cấp bậc",
  "evaluation-score-group": "Nhóm đánh giá",
  "evaluation-source": "Nguồn dữ liệu",
  "evaluation-workflow-step": "Bước workflow",
  "evaluation-workflow-template": "Workflow",
};

function text(value: unknown) {
  return value == null ? "" : String(value).trim();
}

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asObject(value: unknown): Json {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Json;
}

function codeFromName(value: string, prefix: string) {
  const normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "D")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `${prefix}_${normalized || Date.now().toString(36).toUpperCase()}`;
}

function emptyDraft(tab: string, recordType?: string): Draft {
  return {
    code: "",
    content: {},
    id: "",
    name: "",
    note: "",
    parentId: "",
    recordType: recordType || TAB_RECORD_TYPES[tab] || "",
    status: ["types", "workflow"].includes(tab) ? "draft" : "active",
  };
}

function Field({
  children,
  label,
  required,
  wide,
}: {
  children: React.ReactNode;
  label: string;
  required?: boolean;
  wide?: boolean;
}) {
  return (
    <label className={wide ? "md:col-span-2" : ""}>
      <span className="mb-1.5 block text-xs font-extrabold uppercase tracking-[0.07em] text-[#49665f]">
        {label}
        {required ? <span className="ml-1 text-danger">*</span> : null}
      </span>
      {children}
    </label>
  );
}

const controlClass =
  "h-11 w-full rounded-lg border border-[#cbdad5] bg-white px-3 text-sm text-[#203a34] outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/15 disabled:bg-[#f1f4f3]";
const textareaClass =
  "min-h-24 w-full rounded-lg border border-[#cbdad5] bg-white px-3 py-2 text-sm text-[#203a34] outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/15 disabled:bg-[#f1f4f3]";

function StatusPill({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  const active = ["active", "published", "done", "finalized"].includes(
    normalized,
  );
  return (
    <span
      className={`rounded-full border px-2.5 py-1 text-[10px] font-extrabold uppercase ${
        active
          ? "border-[#a8d9c8] bg-[#e8f8f1] text-[#0c6e4c]"
          : normalized === "draft" || normalized === "pending"
            ? "border-[#e8c398] bg-[#fff4e8] text-[#9b591e]"
            : "border-[#d9e1df] bg-[#f2f5f4] text-[#677b75]"
      }`}
    >
      {status || "active"}
    </span>
  );
}

export function EvaluationConfigWorkspace() {
  const { toast } = useToast();
  const [tab, setTab] = useState("overview");
  const [data, setData] = useState<ConfigData | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft("overview"));
  const [loading, setLoading] = useState(true);
  const [writing, setWriting] = useState(false);
  const [search, setSearch] = useState("");
  const [criteriaMode, setCriteriaMode] = useState<
    "group" | "criterion" | "set"
  >("group");
  const [setLines, setSetLines] = useState<
    Array<{ criteriaId: string; weight: number }>
  >([]);
  const [workflowSteps, setWorkflowSteps] = useState<
    Array<{ mode: string; role: string }>
  >([{ mode: "sequential", role: "self" }]);
  const [readiness, setReadiness] = useState<Json | null>(null);
  const [selectedCycleId, setSelectedCycleId] = useState("");
  const [selectedJdId, setSelectedJdId] = useState("");

  const load = useCallback(
    async (nextTab = tab) => {
      setLoading(true);
      try {
        const result = await postRpc<ConfigData>(
          "/api/evaluation/rpc",
          "getConfigTab",
          { tab: nextTab },
        );
        setData(result);
        if (nextTab !== "overview") {
          setDraft(emptyDraft(nextTab));
        }
        if (nextTab === "cycles") {
          const firstCycle = result.records.find(
            (record) => text(record.content.recordType) === "evaluation-cycle",
          );
          setSelectedCycleId(firstCycle?.id || "");
        }
      } catch (error) {
        toast({
          message: error instanceof Error ? error.message : String(error),
          title: "Không tải được cấu hình đánh giá",
          tone: "error",
        });
      } finally {
        setLoading(false);
      }
    },
    [tab, toast],
  );

  useEffect(() => {
    void load("overview");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function switchTab(nextTab: string) {
    setTab(nextTab);
    setSearch("");
    setReadiness(null);
    void load(nextTab);
  }

  const records = useMemo(() => {
    const normalized = search.trim().toLocaleLowerCase("vi");
    return (data?.records || []).filter((record) => {
      if (!normalized) return true;
      return [
        record.name,
        record.code,
        TYPE_LABELS[text(record.content.recordType)],
        JSON.stringify(record.content),
      ]
        .join(" ")
        .toLocaleLowerCase("vi")
        .includes(normalized);
    });
  }, [data, search]);

  const sourceRecords = records.filter(
    (record) => text(record.content.recordType) === "evaluation-source",
  );
  const scoreGroups = records.filter(
    (record) => text(record.content.recordType) === "evaluation-score-group",
  );
  const criteria = records.filter(
    (record) => text(record.content.recordType) === "evaluation-criteria",
  );
  const criteriaSets = records.filter(
    (record) => text(record.content.recordType) === "evaluation-criteria-set",
  );
  const referenceRecords = data?.references || [];
  const workflows = [...records, ...referenceRecords].filter(
    (record) =>
      text(record.content.recordType) === "evaluation-workflow-template",
  );
  const cycles = records.filter(
    (record) => text(record.content.recordType) === "evaluation-cycle",
  );
  const members = records.filter(
    (record) => text(record.content.recordType) === "evaluation-cycle-member",
  );
  const instances = records.filter(
    (record) => text(record.content.recordType) === "evaluation-instance",
  );

  function setContent(key: string, value: unknown) {
    setDraft((current) => ({
      ...current,
      content: { ...current.content, [key]: value },
    }));
  }

  function edit(record: StoredRecord) {
    const recordType =
      text(record.content.recordType) || TAB_RECORD_TYPES[tab] || "";
    setDraft({
      code: record.code,
      content: record.content,
      id: record.id,
      name: record.name,
      note: record.note,
      parentId: record.parentId,
      recordType,
      status: record.status,
    });
    if (recordType === "evaluation-workflow-template") {
      const related = records
        .filter(
          (item) =>
            text(item.content.recordType) === "evaluation-workflow-step" &&
            (text(item.content.workflowTemplateId) ===
              text(record.content.id || record.id) ||
              item.parentId === text(record.content.id || record.id)),
        )
        .map((item) => ({
          mode: text(item.content.mode || item.content.runMode) || "sequential",
          role:
            text(item.content.role || item.content.evaluatorRole) || "self",
        }));
      setWorkflowSteps(related.length ? related : workflowSteps);
    }
    if (recordType === "evaluation-criteria-set") {
      setSetLines(
        Array.isArray(record.content.items)
          ? (record.content.items as Array<Json>).map((item) => ({
              criteriaId: text(item.criteriaId),
              weight: numberValue(item.weightPercent),
            }))
          : [],
      );
    }
    window.scrollTo({ behavior: "smooth", top: 0 });
  }

  async function saveRecord(
    override?: Partial<Draft>,
    silent = false,
  ): Promise<StoredRecord | null> {
    const next = { ...draft, ...override };
    if (!next.name.trim()) {
      toast({
        message: "Vui lòng nhập tên trước khi lưu.",
        title: "Thiếu thông tin",
        tone: "warning",
      });
      return null;
    }
    const code =
      next.code.trim() ||
      codeFromName(
        next.name,
        next.recordType
          .replace(/^evaluation-/, "")
          .replace(/[^a-z]+/gi, "_")
          .toUpperCase(),
      );
    setWriting(true);
    try {
      const result = await postRpc<{
        message: string;
        record: StoredRecord;
      }>("/api/evaluation/rpc", "saveConfigRecord", {
        ...next,
        code,
      });
      if (!silent) {
        toast({
          message: result.message,
          title: "Đã cập nhật",
          tone: "success",
        });
      }
      return result.record;
    } catch (error) {
      toast({
        message: error instanceof Error ? error.message : String(error),
        title: "Không lưu được cấu hình",
        tone: "error",
      });
      return null;
    } finally {
      setWriting(false);
    }
  }

  async function saveAndReload(override?: Partial<Draft>) {
    const saved = await saveRecord(override);
    if (saved) await load(tab);
  }

  async function setStatus(record: StoredRecord, status: string) {
    if (
      status === "inactive" &&
      !window.confirm(`Ngưng sử dụng “${record.name || record.code}”?`)
    ) {
      return;
    }
    setWriting(true);
    try {
      const result = await postRpc<{ message: string }>(
        "/api/evaluation/rpc",
        "setConfigStatus",
        { id: record.id, status },
      );
      toast({ message: result.message, title: "Đã cập nhật", tone: "success" });
      await load(tab);
    } catch (error) {
      toast({
        message: error instanceof Error ? error.message : String(error),
        title: "Không cập nhật được",
        tone: "error",
      });
    } finally {
      setWriting(false);
    }
  }

  async function saveCriteriaSet() {
    const total = setLines.reduce((sum, item) => sum + item.weight, 0);
    if (!setLines.length || Math.abs(total - 100) > 0.01) {
      toast({
        message: `Chọn tiêu chí và phân bổ tổng trọng số đúng 100%. Hiện tại: ${total}%.`,
        title: "Trọng số chưa hợp lệ",
        tone: "warning",
      });
      return;
    }
    const saved = await saveRecord({
      content: {
        ...draft.content,
        items: setLines.map((line, index) => ({
          ...line,
          criteriaCode:
            criteria.find((item) => item.id === line.criteriaId)?.code || "",
          criteriaName:
            criteria.find((item) => item.id === line.criteriaId)?.name || "",
          sortOrder: (index + 1) * 10,
          weightPercent: line.weight,
        })),
        totalWeightPercent: 100,
        versionNo: numberValue(draft.content.versionNo, 1),
      },
      recordType: "evaluation-criteria-set",
      status: draft.status || "draft",
    });
    if (saved) await load(tab);
  }

  async function saveWorkflow() {
    if (!workflowSteps.length) {
      toast({
        message: "Workflow cần ít nhất một bước.",
        title: "Thiếu bước",
        tone: "warning",
      });
      return;
    }
    const saved = await saveRecord({
      content: {
        ...draft.content,
        steps: workflowSteps,
        versionNo: numberValue(draft.content.versionNo, 1),
      },
      recordType: "evaluation-workflow-template",
    });
    if (!saved) return;
    for (const [index, step] of workflowSteps.entries()) {
      const stepCode = `${saved.code}_STEP_${index + 1}`;
      const existingStep = (data?.records || []).find(
        (record) =>
          record.code === stepCode &&
          text(record.content.recordType) === "evaluation-workflow-step",
      );
      await saveRecord(
        {
          code: stepCode,
          content: {
            evaluatorRole: step.role,
            mode: step.mode,
            role: step.role,
            runMode: step.mode,
            sortOrder: index + 1,
            workflowTemplateId: saved.id,
          },
          id: existingStep?.id || "",
          name: `${saved.name} · ${step.role} · ${index + 1}`,
          parentId: saved.id,
          recordType: "evaluation-workflow-step",
          status: "active",
        },
        true,
      );
    }
    toast({
      message: "Đã lưu workflow và các bước.",
      title: "Đã cập nhật",
      tone: "success",
    });
    await load(tab);
  }

  async function checkReadiness() {
    if (!selectedCycleId) return;
    setWriting(true);
    try {
      const result = await postRpc<Json>(
        "/api/evaluation/rpc",
        "checkCycleReadiness",
        { cycleId: selectedCycleId },
      );
      setReadiness(result);
      toast({
        message: result.ok
          ? "Kỳ đã sẵn sàng sinh phiếu."
          : `Còn ${result.invalid} nhân sự cần xử lý.`,
        title: "Đã rà soát",
        tone: result.ok ? "success" : "warning",
      });
    } catch (error) {
      toast({
        message: error instanceof Error ? error.message : String(error),
        title: "Không rà soát được",
        tone: "error",
      });
    } finally {
      setWriting(false);
    }
  }

  async function generateInstances() {
    if (!selectedCycleId) return;
    if (
      !window.confirm(
        "Đưa danh sách nhân sự của kỳ này vào hàng đợi sinh phiếu?",
      )
    ) {
      return;
    }
    setWriting(true);
    try {
      const result = await postRpc<{ message: string }>(
        "/api/evaluation/rpc",
        "generateInstances",
        { cycleId: selectedCycleId },
      );
      toast({
        message: result.message,
        title: "Đã hoàn tất sinh phiếu",
        tone: "success",
      });
      await load(tab);
    } catch (error) {
      toast({
        message: error instanceof Error ? error.message : String(error),
        title: "Không sinh được phiếu",
        tone: "error",
      });
    } finally {
      setWriting(false);
    }
  }

  async function syncSource(record: StoredRecord) {
    setWriting(true);
    try {
      const result = await postRpc<{ message: string }>(
        "/api/evaluation/rpc",
        "syncSourceFolder",
        { sourceId: record.id },
      );
      toast({
        message: result.message,
        title: "Đã đồng bộ Folder",
        tone: "success",
      });
      await load(tab);
    } catch (error) {
      toast({
        message: error instanceof Error ? error.message : String(error),
        title: "Không đồng bộ được Folder",
        tone: "error",
      });
    } finally {
      setWriting(false);
    }
  }

  async function returnRole(instance: StoredRecord, role: string) {
    const note = window.prompt("Lý do trả lại lượt đánh giá:");
    if (note == null) return;
    setWriting(true);
    try {
      const result = await postRpc<{ message: string }>(
        "/api/evaluation/rpc",
        "returnReview",
        { instanceId: instance.id, note, role },
      );
      toast({ message: result.message, title: "Đã trả lại", tone: "success" });
      await load(tab);
    } catch (error) {
      toast({
        message: error instanceof Error ? error.message : String(error),
        title: "Không trả lại được",
        tone: "error",
      });
    } finally {
      setWriting(false);
    }
  }

  async function finalize(instance: StoredRecord) {
    const decision = window.prompt("Nhập kết luận cuối:");
    if (!decision) return;
    const hrComment = window.prompt("Nhận xét của HR/Admin:") || "";
    setWriting(true);
    try {
      const result = await postRpc<{ message: string }>(
        "/api/evaluation/rpc",
        "finalizeInstance",
        { decision, hrComment, instanceId: instance.id },
      );
      toast({ message: result.message, title: "Đã chốt", tone: "success" });
      await load(tab);
    } catch (error) {
      toast({
        message: error instanceof Error ? error.message : String(error),
        title: "Không chốt được kết quả",
        tone: "error",
      });
    } finally {
      setWriting(false);
    }
  }

  function baseFields() {
    return (
      <>
        <Field label="Tên" required wide>
          <input
            className={controlClass}
            onChange={(event) =>
              setDraft((current) => ({ ...current, name: event.target.value }))
            }
            placeholder="Nhập tên cấu hình"
            value={draft.name}
          />
        </Field>
        <Field label="Mã">
          <input
            className={controlClass}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                code: event.target.value.toUpperCase(),
              }))
            }
            placeholder="Tự sinh nếu để trống"
            value={draft.code}
          />
        </Field>
        <Field label="Trạng thái">
          <select
            className={controlClass}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                status: event.target.value,
              }))
            }
            value={draft.status}
          >
            <option value="active">Đang dùng</option>
            <option value="draft">Nháp</option>
            <option value="published">Đã phát hành</option>
            <option value="inactive">Ngưng dùng</option>
          </select>
        </Field>
      </>
    );
  }

  function renderEditor() {
    if (tab === "levels") {
      return (
        <>
          {baseFields()}
          <Field label="Nhóm level">
            <input
              className={controlClass}
              onChange={(event) => setContent("levelGroup", event.target.value)}
              placeholder="Quản lý cấp trung"
              value={text(draft.content.levelGroup)}
            />
          </Field>
          <Field label="Thứ tự">
            <input
              className={controlClass}
              min="0"
              onChange={(event) =>
                setContent("sortOrder", Number(event.target.value))
              }
              type="number"
              value={text(draft.content.sortOrder)}
            />
          </Field>
        </>
      );
    }
    if (tab === "sources") {
      return (
        <>
          {baseFields()}
          <Field label="Loại nguồn">
            <select
              className={controlClass}
              onChange={(event) => setContent("sourceType", event.target.value)}
              value={text(draft.content.sourceType) || "jd"}
            >
              <option value="jd">JD</option>
              <option value="culture">Văn hóa</option>
              <option value="leadership">Năng lực lãnh đạo</option>
              <option value="manual">Bảng nhập tay</option>
              <option value="custom">Khác</option>
            </select>
          </Field>
          <Field label="Cách nhập">
            <select
              className={controlClass}
              onChange={(event) => setContent("inputMode", event.target.value)}
              value={text(draft.content.inputMode) || "drive"}
            >
              <option value="manual">Bảng nhập tay</option>
              <option value="drive">Folder Drive</option>
              <option value="hybrid">Kết hợp cả hai</option>
            </select>
          </Field>
          <Field label="ID Folder Drive" wide>
            <input
              className={controlClass}
              onChange={(event) => setContent("folderId", event.target.value)}
              placeholder="Dán link hoặc ID Folder chứa tài liệu"
              value={text(
                draft.content.folderId || draft.content.driveFolderId,
              )}
            />
          </Field>
          <Field label="Giới hạn file mỗi lần">
            <input
              className={controlClass}
              max="250"
              min="1"
              onChange={(event) =>
                setContent("syncLimit", Number(event.target.value))
              }
              type="number"
              value={text(draft.content.syncLimit) || "80"}
            />
          </Field>
          <Field label="Tần suất">
            <select
              className={controlClass}
              onChange={(event) => setContent("syncMode", event.target.value)}
              value={text(draft.content.syncMode) || "manual"}
            >
              <option value="manual">Không tự động</option>
              <option value="daily">Hằng ngày</option>
              <option value="weekly">Hằng tuần</option>
              <option value="monthly">Hằng tháng</option>
            </select>
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
    if (tab === "criteria") {
      if (criteriaMode === "group") {
        return (
          <>
            {baseFields()}
            <Field label="Điểm tối đa">
              <input
                className={controlClass}
                min="1"
                onChange={(event) =>
                  setContent("maxScore", Number(event.target.value))
                }
                type="number"
                value={text(draft.content.maxScore) || "100"}
              />
            </Field>
            <Field label="Trọng số mặc định (%)">
              <input
                className={controlClass}
                max="100"
                min="0"
                onChange={(event) =>
                  setContent("defaultWeightPercent", Number(event.target.value))
                }
                type="number"
                value={text(draft.content.defaultWeightPercent) || "100"}
              />
            </Field>
          </>
        );
      }
      if (criteriaMode === "criterion") {
        return (
          <>
            {baseFields()}
            <Field label="Cách chấm">
              <select
                className={controlClass}
                onChange={(event) =>
                  setContent("scoringMethod", event.target.value)
                }
                value={text(draft.content.scoringMethod) || "scale_10"}
              >
                <option value="scale_10">Theo thang điểm 0–10</option>
                <option value="scale_5">Theo thang điểm 0–5</option>
                <option value="percent">Theo phần trăm</option>
              </select>
            </Field>
            <Field label="Nhóm đánh giá">
              <select
                className={controlClass}
                onChange={(event) =>
                  setContent("scoreGroupId", event.target.value)
                }
                value={text(draft.content.scoreGroupId)}
              >
                <option value="">Chọn nhóm</option>
                {scoreGroups.map((record) => (
                  <option key={record.id} value={record.id}>
                    {record.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Mô tả / bằng chứng cần tìm" wide>
              <textarea
                className={textareaClass}
                onChange={(event) =>
                  setContent("description", event.target.value)
                }
                value={text(draft.content.description)}
              />
            </Field>
          </>
        );
      }
      return (
        <>
          {baseFields()}
          <div className="md:col-span-2">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-extrabold uppercase text-[#49665f]">
                Tiêu chí trong bộ · Tổng{" "}
                {setLines.reduce((sum, item) => sum + item.weight, 0)}%
              </span>
              <Button
                onClick={() =>
                  setSetLines((current) => [
                    ...current,
                    { criteriaId: "", weight: 0 },
                  ])
                }
                size="sm"
                variant="secondary"
              >
                <Plus size={15} />
                Thêm dòng
              </Button>
            </div>
            <div className="space-y-2">
              {setLines.map((line, index) => (
                <div
                  className="grid gap-2 rounded-lg border border-[#d9e3e0] bg-[#f9fbfa] p-2 sm:grid-cols-[1fr_110px_38px]"
                  key={`${line.criteriaId}-${index}`}
                >
                  <select
                    className={controlClass}
                    onChange={(event) =>
                      setSetLines((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, criteriaId: event.target.value }
                            : item,
                        ),
                      )
                    }
                    value={line.criteriaId}
                  >
                    <option value="">Chọn tiêu chí</option>
                    {criteria.map((record) => (
                      <option key={record.id} value={record.id}>
                        {record.name}
                      </option>
                    ))}
                  </select>
                  <input
                    className={controlClass}
                    max="100"
                    min="0"
                    onChange={(event) =>
                      setSetLines((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, weight: Number(event.target.value) }
                            : item,
                        ),
                      )
                    }
                    placeholder="%"
                    type="number"
                    value={line.weight}
                  />
                  <button
                    aria-label="Xóa dòng"
                    className="grid size-9 place-items-center self-center rounded-lg text-[#b83c32] hover:bg-[#fdeeee]"
                    onClick={() =>
                      setSetLines((current) =>
                        current.filter((_, itemIndex) => itemIndex !== index),
                      )
                    }
                    type="button"
                  >
                    <X size={17} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </>
      );
    }
    if (tab === "workflow") {
      return (
        <>
          {baseFields()}
          <Field label="Version">
            <input
              className={controlClass}
              min="1"
              onChange={(event) =>
                setContent("versionNo", Number(event.target.value))
              }
              type="number"
              value={text(draft.content.versionNo) || "1"}
            />
          </Field>
          <div className="md:col-span-2">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-extrabold uppercase text-[#49665f]">
                Đối tượng và thứ tự
              </span>
              <Button
                onClick={() =>
                  setWorkflowSteps((current) => [
                    ...current,
                    { mode: "sequential", role: "manager" },
                  ])
                }
                size="sm"
                variant="secondary"
              >
                <Plus size={15} />
                Thêm bước
              </Button>
            </div>
            <div className="space-y-2">
              {workflowSteps.map((step, index) => (
                <div
                  className="grid gap-2 rounded-lg border border-[#d9e3e0] bg-[#f9fbfa] p-2 sm:grid-cols-[42px_1fr_1fr_38px]"
                  key={`${step.role}-${index}`}
                >
                  <span className="grid h-11 place-items-center rounded-lg bg-[#114c41] text-sm font-black text-white">
                    {index + 1}
                  </span>
                  <select
                    className={controlClass}
                    onChange={(event) =>
                      setWorkflowSteps((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, role: event.target.value }
                            : item,
                        ),
                      )
                    }
                    value={step.role}
                  >
                    <option value="self">Bản thân</option>
                    <option value="manager">Cấp trên</option>
                    <option value="peer">Đồng nghiệp</option>
                    <option value="hr">HR</option>
                  </select>
                  <select
                    className={controlClass}
                    onChange={(event) =>
                      setWorkflowSteps((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, mode: event.target.value }
                            : item,
                        ),
                      )
                    }
                    value={step.mode}
                  >
                    <option value="sequential">Sau bước trước</option>
                    <option value="parallel">Song song bước trước</option>
                  </select>
                  <button
                    aria-label="Xóa bước"
                    className="grid size-9 place-items-center self-center rounded-lg text-[#b83c32] hover:bg-[#fdeeee]"
                    onClick={() =>
                      setWorkflowSteps((current) =>
                        current.filter((_, itemIndex) => itemIndex !== index),
                      )
                    }
                    type="button"
                  >
                    <X size={17} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </>
      );
    }
    if (tab === "types") {
      const weights = asObject(draft.content.roleScoreWeights);
      return (
        <>
          {baseFields()}
          <Field label="Nhóm loại">
            <select
              className={controlClass}
              onChange={(event) => setContent("category", event.target.value)}
              value={text(draft.content.category) || "probation"}
            >
              <option value="probation">Thử việc</option>
              <option value="periodic">Định kỳ</option>
              <option value="promotion">Thăng bậc</option>
              <option value="ad_hoc">Đột xuất</option>
              <option value="other">Khác</option>
            </select>
          </Field>
          <Field label="Thời hạn hoàn thành (ngày)">
            <input
              className={controlClass}
              min="1"
              onChange={(event) =>
                setContent("defaultDeadlineDays", Number(event.target.value))
              }
              type="number"
              value={text(draft.content.defaultDeadlineDays) || "10"}
            />
          </Field>
          <Field label="Workflow mặc định">
            <select
              className={controlClass}
              onChange={(event) =>
                setContent("defaultWorkflowTemplateId", event.target.value)
              }
              value={text(draft.content.defaultWorkflowTemplateId)}
            >
              <option value="">Chọn workflow</option>
              {workflows.map((record) => (
                <option key={record.id} value={record.id}>
                  {record.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Cách hoàn tất phiếu">
            <select
              className={controlClass}
              onChange={(event) =>
                setContent("completionMode", event.target.value)
              }
              value={
                text(draft.content.completionMode) || "manual_finalization"
              }
            >
              <option value="manual_finalization">
                HR/Admin chốt kết quả
              </option>
              <option value="auto_complete">Tự hoàn tất sau lượt cuối</option>
            </select>
          </Field>
          <Field label="Cách gom điểm">
            <select
              className={controlClass}
              onChange={(event) =>
                setContent("scoreAggregationMode", event.target.value)
              }
              value={text(draft.content.scoreAggregationMode) || "equal"}
            >
              <option value="equal">Các vai trò ngang nhau</option>
              <option value="custom">Theo trọng số tùy chỉnh</option>
            </select>
          </Field>
          <Field label="Trọng số Bản thân / Cấp trên / Đồng nghiệp / HR" wide>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {["self", "manager", "peer", "hr"].map((role) => (
                <input
                  className={controlClass}
                  key={role}
                  max="100"
                  min="0"
                  onChange={(event) =>
                    setContent("roleScoreWeights", {
                      ...weights,
                      [role]: Number(event.target.value),
                    })
                  }
                  placeholder={role}
                  type="number"
                  value={text(weights[role])}
                />
              ))}
            </div>
          </Field>
          <Field label="Tần suất công việc lấy từ JD" wide>
            <input
              className={controlClass}
              onChange={(event) =>
                setContent(
                  "allowedJdFrequencies",
                  event.target.value
                    .split(",")
                    .map((item) => item.trim())
                    .filter(Boolean),
                )
              }
              placeholder="monthly, quarterly, yearly"
              value={
                Array.isArray(draft.content.allowedJdFrequencies)
                  ? draft.content.allowedJdFrequencies.join(", ")
                  : ""
              }
            />
          </Field>
        </>
      );
    }
    if (tab === "cycles") {
      if (draft.recordType === "evaluation-cycle-member") {
        const employee = data?.employees.find(
          (item) =>
            item.employeeCode === text(draft.content.employeeCode),
        );
        return (
          <>
            <Field label="Kỳ đánh giá" required wide>
              <select
                className={controlClass}
                onChange={(event) => {
                  const cycle = cycles.find(
                    (item) => item.id === event.target.value,
                  );
                  setDraft((current) => ({
                    ...current,
                    parentId: event.target.value,
                    content: {
                      ...current.content,
                      cycleId: text(cycle?.content.id || cycle?.id),
                      cycleName: cycle?.name || "",
                      evaluationCycleId: text(
                        cycle?.content.id || cycle?.id,
                      ),
                    },
                  }));
                }}
                value={draft.parentId}
              >
                <option value="">Chọn kỳ</option>
                {cycles.map((record) => (
                  <option key={record.id} value={record.id}>
                    {record.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Nhân sự" required wide>
              <select
                className={controlClass}
                onChange={(event) => {
                  const next = data?.employees.find(
                    (item) => item.employeeCode === event.target.value,
                  );
                  setDraft((current) => ({
                    ...current,
                    code: `MEM_${text(
                      current.content.cycleId || current.parentId,
                    )}_${next?.employeeCode || ""}`,
                    name: next?.fullName || "",
                    content: {
                      ...current.content,
                      departmentName: next?.department || "",
                      employeeCode: next?.employeeCode || "",
                      employeeName: next?.fullName || "",
                      jobTitleName: next?.title || "",
                    },
                  }));
                }}
                value={text(draft.content.employeeCode)}
              >
                <option value="">Chọn nhân sự</option>
                {data?.employees.map((item) => (
                  <option key={item.employeeCode} value={item.employeeCode}>
                    {item.employeeCode} · {item.fullName} · {item.title || "—"}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Chức danh">
              <input
                className={controlClass}
                onChange={(event) =>
                  setContent("jobTitleName", event.target.value)
                }
                value={text(
                  draft.content.jobTitleName || employee?.title || "",
                )}
              />
            </Field>
            <Field label="Quản lý trực tiếp (MNV)">
              <input
                className={controlClass}
                onChange={(event) =>
                  setContent("managerEmployeeCode", event.target.value)
                }
                value={text(draft.content.managerEmployeeCode)}
              />
            </Field>
            <Field label="Đồng nghiệp đánh giá (MNV)">
              <input
                className={controlClass}
                onChange={(event) =>
                  setContent("peerEmployeeCode", event.target.value)
                }
                value={text(draft.content.peerEmployeeCode)}
              />
            </Field>
            <Field label="HR phụ trách (MNV)">
              <input
                className={controlClass}
                onChange={(event) =>
                  setContent("hrEmployeeCode", event.target.value)
                }
                value={text(draft.content.hrEmployeeCode)}
              />
            </Field>
          </>
        );
      }
      return (
        <>
          {baseFields()}
          <Field label="Loại đánh giá">
            <select
              className={controlClass}
              onChange={(event) =>
                setContent("cycleTypeTemplateId", event.target.value)
              }
              value={text(draft.content.cycleTypeTemplateId)}
            >
              <option value="">Chọn loại</option>
              {[...(data?.records || []), ...(data?.references || [])]
                .filter(
                  (record) =>
                    text(record.content.recordType) ===
                    "evaluation-cycle-type-template",
                )
                .map((record) => (
                  <option key={record.id} value={record.id}>
                    {record.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Workflow">
            <select
              className={controlClass}
              onChange={(event) =>
                setContent("workflowTemplateId", event.target.value)
              }
              value={text(draft.content.workflowTemplateId)}
            >
              <option value="">Chọn workflow</option>
              {workflows.map((record) => (
                <option key={record.id} value={record.id}>
                  {record.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Bắt đầu">
            <input
              className={controlClass}
              onChange={(event) => setContent("startDate", event.target.value)}
              type="date"
              value={text(draft.content.startDate)}
            />
          </Field>
          <Field label="Kết thúc">
            <input
              className={controlClass}
              onChange={(event) => setContent("endDate", event.target.value)}
              type="date"
              value={text(draft.content.endDate)}
            />
          </Field>
          <Field label="Ghi chú" wide>
            <textarea
              className={textareaClass}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  note: event.target.value,
                }))
              }
              value={draft.note}
            />
          </Field>
        </>
      );
    }
    return <>{baseFields()}</>;
  }

  function editorTitle() {
    if (tab === "levels") return draft.id ? "Cập nhật cấp bậc" : "Định nghĩa cấp bậc";
    if (tab === "sources") return draft.id ? "Cập nhật nguồn dữ liệu" : "Định nghĩa nguồn dữ liệu";
    if (tab === "criteria") {
      return criteriaMode === "group"
        ? "Định nghĩa nhóm đánh giá"
        : criteriaMode === "criterion"
          ? "Định nghĩa tiêu chí"
          : "Thông tin bộ tiêu chí";
    }
    if (tab === "workflow") return "Thiết lập workflow";
    if (tab === "types") return "Tạo mẫu đánh giá";
    if (tab === "cycles")
      return draft.recordType === "evaluation-cycle-member"
        ? "Gán nhân sự"
        : "Tạo và lưu kỳ";
    return "Cấu hình";
  }

  function renderRecordCard(record: StoredRecord) {
    const recordType =
      text(record.content.recordType) || TAB_RECORD_TYPES[tab] || "";
    return (
      <article
        className="rounded-lg border border-[#d9e3e0] bg-white p-3 shadow-[0_8px_18px_rgba(17,76,65,0.04)]"
        key={record.id}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] font-black uppercase tracking-[0.08em] text-brand-strong">
              {TYPE_LABELS[recordType] || recordType}
            </div>
            <h4 className="mt-1 truncate font-extrabold text-[#114c41]">
              {record.name || record.code}
            </h4>
            <p className="mt-1 text-xs text-[#6d817b]">
              {record.code || "Không có mã"} · Cập nhật{" "}
              {new Date(record.updatedAt).toLocaleDateString("vi-VN")}
            </p>
          </div>
          <StatusPill status={record.status} />
        </div>
        <div className="mt-3 flex flex-wrap justify-end gap-1.5">
          <button
            className="grid size-8 place-items-center rounded-lg border border-[#d5e0dc] text-[#114c41] hover:bg-[#eef5f2]"
            onClick={() => edit(record)}
            title="Chỉnh sửa"
            type="button"
          >
            <Pencil size={15} />
          </button>
          {["draft"].includes(record.status.toLowerCase()) ? (
            <button
              className="inline-flex h-8 items-center gap-1 rounded-lg border border-[#d9b78e] px-2 text-xs font-bold text-[#9a5712]"
              onClick={() => void setStatus(record, "published")}
              type="button"
            >
              <Send size={14} />
              Phát hành
            </button>
          ) : null}
          {record.status.toLowerCase() !== "inactive" ? (
            <button
              className="grid size-8 place-items-center rounded-lg border border-[#edd0ca] text-[#b83c32] hover:bg-[#fdeeee]"
              onClick={() => void setStatus(record, "inactive")}
              title="Ngưng dùng"
              type="button"
            >
              <Archive size={15} />
            </button>
          ) : null}
        </div>
      </article>
    );
  }

  return (
    <div className="mt-5">
      <WriteLoadingOverlay
        message="Đang cập nhật cấu hình đánh giá trên PostgreSQL..."
        show={writing}
      />
      <nav className="flex gap-1 overflow-x-auto rounded-xl border border-[#d2dfdb] bg-white p-1.5 shadow-sm">
        {TABS.map(([key, label]) => (
          <button
            className={`shrink-0 rounded-lg px-4 py-2 text-sm font-extrabold transition ${
              tab === key
                ? "bg-[#114c41] text-white shadow-sm"
                : "text-[#48665f] hover:bg-[#eef5f2]"
            }`}
            key={key}
            onClick={() => switchTab(key)}
            type="button"
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === "overview" ? (
        <div className="mt-4 space-y-4">
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {TABS.slice(1).map(([key, label]) => {
              const types: Record<string, string[]> = {
                criteria: [
                  "evaluation-score-group",
                  "evaluation-criteria",
                  "evaluation-criteria-set",
                  "evaluation-criteria-set-item",
                ],
                cycles: ["evaluation-cycle", "evaluation-cycle-member"],
                levels: ["evaluation-position-level"],
                monitoring: [
                  "evaluation-instance",
                  "evaluation-final-result",
                  "evaluation-generation-job",
                ],
                sources: [
                  "evaluation-source",
                  "evaluation-jd-folder",
                ],
                types: ["evaluation-cycle-type-template"],
                workflow: [
                  "evaluation-workflow-template",
                  "evaluation-workflow-step",
                ],
              };
              const count = (types[key] || []).reduce(
                (sum, type) => sum + (data?.counts[type] || 0),
                0,
              );
              return (
                <button
                  className="rounded-lg border border-[#d6e1dd] bg-white p-4 text-left shadow-[0_10px_24px_rgba(17,76,65,0.05)] hover:border-[#9dbdb4]"
                  key={key}
                  onClick={() => switchTab(key)}
                  type="button"
                >
                  <span className="text-xs font-extrabold uppercase text-[#6e827c]">
                    {label}
                  </span>
                  <strong className="mt-2 block text-3xl font-black text-[#114c41]">
                    {count}
                  </strong>
                </button>
              );
            })}
          </section>
          <section className="rounded-xl border border-[#d2dfdb] bg-white p-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-black text-[#114c41]">
                  Dữ liệu cấu hình gần đây
                </h2>
                <p className="mt-1 text-sm text-[#6d817b]">
                  Mọi thay đổi đều ghi trực tiếp vào PostgreSQL và lưu audit.
                </p>
              </div>
              <button
                className="grid size-9 place-items-center rounded-lg border border-[#d5e0dc] text-[#114c41]"
                onClick={() => void load(tab)}
                type="button"
              >
                <RefreshCw className={loading ? "animate-spin" : ""} size={17} />
              </button>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {records.slice(0, 12).map(renderRecordCard)}
            </div>
          </section>
        </div>
      ) : (
        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(360px,0.78fr)_minmax(0,1.22fr)]">
          {tab !== "monitoring" ? (
            <section className="self-start rounded-xl border border-[#d2dfdb] bg-white p-5 shadow-[0_14px_34px_rgba(17,76,65,0.06)] xl:sticky xl:top-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[11px] font-black uppercase tracking-[0.1em] text-brand-strong">
                    {draft.id ? "Đang chỉnh sửa" : "Tạo mới"}
                  </div>
                  <h2 className="mt-1 text-lg font-black text-[#114c41]">
                    {editorTitle()}
                  </h2>
                </div>
                <Button
                  onClick={() => {
                    setDraft(emptyDraft(tab));
                    setSetLines([]);
                    setWorkflowSteps([{ mode: "sequential", role: "self" }]);
                  }}
                  size="sm"
                  variant="secondary"
                >
                  <Plus size={15} />
                  Tạo mới
                </Button>
              </div>

              {tab === "criteria" ? (
                <div className="mt-4 grid grid-cols-3 gap-1 rounded-lg bg-[#eef4f2] p-1">
                  {[
                    ["group", "1 Nhóm"],
                    ["criterion", "2 Tiêu chí"],
                    ["set", "3 Bộ"],
                  ].map(([key, label]) => (
                    <button
                      className={`rounded-md px-2 py-2 text-xs font-extrabold ${
                        criteriaMode === key
                          ? "bg-white text-[#114c41] shadow-sm"
                          : "text-[#657a74]"
                      }`}
                      key={key}
                      onClick={() => {
                        setCriteriaMode(
                          key as "group" | "criterion" | "set",
                        );
                        setDraft(
                          emptyDraft(
                            tab,
                            key === "group"
                              ? "evaluation-score-group"
                              : key === "criterion"
                                ? "evaluation-criteria"
                                : "evaluation-criteria-set",
                          ),
                        );
                      }}
                      type="button"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              ) : null}

              {tab === "cycles" ? (
                <div className="mt-4 grid grid-cols-2 gap-1 rounded-lg bg-[#eef4f2] p-1">
                  {[
                    ["evaluation-cycle", "1 Tạo kỳ"],
                    ["evaluation-cycle-member", "2 Phân bổ"],
                  ].map(([key, label]) => (
                    <button
                      className={`rounded-md px-2 py-2 text-xs font-extrabold ${
                        draft.recordType === key
                          ? "bg-white text-[#114c41] shadow-sm"
                          : "text-[#657a74]"
                      }`}
                      key={key}
                      onClick={() =>
                        setDraft(emptyDraft(tab, key))
                      }
                      type="button"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              ) : null}

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                {renderEditor()}
              </div>
              <div className="mt-5 flex flex-wrap justify-end gap-2">
                <Button
                  disabled={writing}
                  onClick={() =>
                    tab === "criteria" && criteriaMode === "set"
                      ? void saveCriteriaSet()
                      : tab === "workflow"
                        ? void saveWorkflow()
                        : void saveAndReload()
                  }
                >
                  <Save size={17} />
                  {tab === "criteria" && criteriaMode === "set"
                    ? "Lưu bộ tiêu chí"
                    : tab === "workflow"
                      ? "Lưu workflow"
                      : tab === "cycles" &&
                          draft.recordType === "evaluation-cycle-member"
                        ? "Thêm nhân sự"
                        : "Lưu cấu hình"}
                </Button>
              </div>
            </section>
          ) : null}

          <section
            className={`rounded-xl border border-[#d2dfdb] bg-white p-5 shadow-[0_14px_34px_rgba(17,76,65,0.06)] ${
              tab === "monitoring" ? "xl:col-span-2" : ""
            }`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-black text-[#114c41]">
                  {tab === "levels"
                    ? "Level đã định nghĩa"
                    : tab === "sources"
                      ? "Nguồn và tài liệu JD"
                      : tab === "criteria"
                        ? "Các nhóm, tiêu chí và bộ tiêu chí"
                        : tab === "workflow"
                          ? "Workflow đã định nghĩa"
                          : tab === "types"
                            ? "Loại đánh giá đã định nghĩa"
                            : tab === "cycles"
                              ? "Kỳ, phân bổ và sinh phiếu"
                              : "Theo dõi và chốt đánh giá"}
                </h2>
                <p className="mt-1 text-sm text-[#6d817b]">
                  {records.length} bản ghi đang hiển thị.
                </p>
              </div>
              <div className="flex gap-2">
                <input
                  className="h-9 w-56 rounded-lg border border-[#cbdad5] px-3 text-sm max-sm:w-40"
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Tìm nhanh"
                  value={search}
                />
                <button
                  className="grid size-9 place-items-center rounded-lg border border-[#d5e0dc] text-[#114c41]"
                  onClick={() => void load(tab)}
                  type="button"
                >
                  <RefreshCw
                    className={loading ? "animate-spin" : ""}
                    size={17}
                  />
                </button>
              </div>
            </div>

            {tab === "sources" ? (
              <>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {sourceRecords.map((record) => (
                    <article
                      className="rounded-lg border border-[#d9e3e0] bg-[#f9fbfa] p-4"
                      key={record.id}
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <h3 className="font-black text-[#114c41]">
                            {record.name}
                          </h3>
                          <p className="mt-1 text-xs text-[#6d817b]">
                            Folder:{" "}
                            {text(
                              record.content.folderId ||
                                record.content.driveFolderId,
                            ) || "Chưa cấu hình"}
                          </p>
                        </div>
                        <StatusPill status={record.status} />
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
                        <Button
                          onClick={() => void syncSource(record)}
                          size="sm"
                          variant="secondary"
                        >
                          <RefreshCw size={14} />
                          Đồng bộ Folder
                        </Button>
                      </div>
                    </article>
                  ))}
                </div>
                <div className="mt-5 border-t border-[#dce5e2] pt-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="font-black text-[#114c41]">
                        Tài liệu JD đã nhận diện
                      </h3>
                      <p className="mt-1 text-xs text-[#6d817b]">
                        Ưu tiên JD mới; bản [BC] chỉ dùng khi vị trí chưa có bản
                        mới.
                      </p>
                    </div>
                    <span className="rounded-full bg-[#e9f4f0] px-3 py-1 text-xs font-extrabold text-[#176754]">
                      {data?.jdDocuments.length || 0} tài liệu
                    </span>
                  </div>
                  <div className="mt-3 max-h-[520px] space-y-2 overflow-y-auto pr-1">
                    {(data?.jdDocuments || []).map((document) => (
                      <button
                        className={`w-full rounded-lg border p-3 text-left ${
                          selectedJdId === document.id
                            ? "border-brand bg-brand-soft"
                            : "border-[#dce5e2] bg-white"
                        }`}
                        key={document.id}
                        onClick={() => setSelectedJdId(document.id)}
                        type="button"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <strong className="text-sm text-[#114c41]">
                              {document.name}
                            </strong>
                            <div className="mt-1 text-xs text-[#6d817b]">
                              {text(document.content.fileName)}
                            </div>
                          </div>
                          <StatusPill status={document.status} />
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </>
            ) : tab === "cycles" ? (
              <div className="mt-4 space-y-4">
                <div className="rounded-lg border border-[#d8e2df] bg-[#f9fbfa] p-4">
                  <div className="grid gap-3 md:grid-cols-[1fr_auto_auto]">
                    <select
                      className={controlClass}
                      onChange={(event) =>
                        setSelectedCycleId(event.target.value)
                      }
                      value={selectedCycleId}
                    >
                      <option value="">Chọn kỳ để rà soát và sinh phiếu</option>
                      {cycles.map((record) => (
                        <option key={record.id} value={record.id}>
                          {record.name}
                        </option>
                      ))}
                    </select>
                    <Button
                      disabled={!selectedCycleId}
                      onClick={() => void checkReadiness()}
                      variant="secondary"
                    >
                      <FileSearch size={17} />
                      Rà soát trước khi sinh
                    </Button>
                    <Button
                      disabled={!selectedCycleId}
                      onClick={() => void generateInstances()}
                    >
                      <Rocket size={17} />
                      Sinh phiếu nền
                    </Button>
                  </div>
                  {readiness ? (
                    <div className="mt-3 rounded-lg border border-[#d8e2df] bg-white p-3">
                      <div className="flex items-center gap-2 font-bold text-[#114c41]">
                        {readiness.ok ? (
                          <CheckCircle2 className="text-[#0c6e4c]" size={18} />
                        ) : (
                          <LoaderCircle className="text-brand-strong" size={18} />
                        )}
                        {readiness.ok
                          ? "Có thể sinh phiếu"
                          : "Cần xử lý trước khi chạy"}
                      </div>
                      <div className="mt-2 grid gap-2 sm:grid-cols-3">
                        {([
                          ["Tổng", readiness.total],
                          ["Sẵn sàng", readiness.ready],
                          ["Còn lỗi", readiness.invalid],
                        ] as Array<[string, unknown]>).map(([label, value]) => (
                          <div
                            className="rounded-md bg-[#f2f6f5] p-2 text-sm"
                            key={String(label)}
                          >
                            <span className="text-[#6d817b]">{label}</span>
                            <strong className="ml-2 text-[#114c41]">
                              {String(value)}
                            </strong>
                          </div>
                        ))}
                      </div>
                      <div className="mt-2 space-y-1">
                        {Array.isArray(readiness.rows)
                          ? (readiness.rows as Array<Json>)
                              .filter((row) => !row.ok)
                              .slice(0, 12)
                              .map((row) => (
                                <div
                                  className="text-xs text-[#9a5712]"
                                  key={text(row.employeeCode)}
                                >
                                  {text(row.employeeCode)} ·{" "}
                                  {text(row.employeeName)}:{" "}
                                  {Array.isArray(row.errors)
                                    ? row.errors.join(", ")
                                    : ""}
                                </div>
                              ))
                          : null}
                      </div>
                    </div>
                  ) : null}
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  {[...cycles, ...members].map(renderRecordCard)}
                </div>
              </div>
            ) : tab === "monitoring" ? (
              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                {instances.map((instance) => {
                  const activeRoles = Array.isArray(
                    instance.content.activeStepRoles,
                  )
                    ? instance.content.activeStepRoles.map(text)
                    : [];
                  const submittedRoles = ["self", "manager", "peer", "hr"].filter(
                    (role) =>
                      text(
                        instance.content[
                          `${role === "self" ? "employee" : role}ReviewStatus`
                        ],
                      ) === "submitted",
                  );
                  return (
                    <article
                      className="rounded-lg border border-[#d8e2df] bg-white p-4"
                      key={instance.id}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="font-black text-[#114c41]">
                            {instance.name}
                          </h3>
                          <p className="mt-1 text-xs text-[#6d817b]">
                            {text(instance.content.employeeCode)} ·{" "}
                            {text(instance.content.cycleName)}
                          </p>
                        </div>
                        <StatusPill status={instance.status} />
                      </div>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {["self", "manager", "peer", "hr"].map((role) => {
                          if (
                            !activeRoles.includes(role) &&
                            !submittedRoles.includes(role)
                          ) {
                            return null;
                          }
                          return (
                            <span
                              className={`rounded-full px-2 py-1 text-[10px] font-bold ${
                                submittedRoles.includes(role)
                                  ? "bg-[#e8f8f1] text-[#0c6e4c]"
                                  : "bg-[#fff2e8] text-[#9a5712]"
                              }`}
                              key={role}
                            >
                              {role === "self"
                                ? "Bản thân"
                                : role === "manager"
                                  ? "Cấp trên"
                                  : role === "peer"
                                    ? "Đồng nghiệp"
                                    : "HR"}
                            </span>
                          );
                        })}
                      </div>
                      <div className="mt-4 flex flex-wrap justify-end gap-2">
                        {submittedRoles.map((role) => (
                          <Button
                            key={role}
                            onClick={() => void returnRole(instance, role)}
                            size="sm"
                            variant="secondary"
                          >
                            Trả lại {role}
                          </Button>
                        ))}
                        {Boolean(instance.content.workflowCompleted) &&
                        !["finalized", "completed"].includes(
                          instance.status.toLowerCase(),
                        ) ? (
                          <Button
                            onClick={() => void finalize(instance)}
                            size="sm"
                          >
                            Chốt kết quả
                          </Button>
                        ) : null}
                        {["finalized", "completed"].includes(
                          instance.status.toLowerCase(),
                        ) ? (
                          <a
                            className="inline-flex h-9 items-center rounded-full border border-[#d2dfdb] px-4 text-sm font-bold text-[#114c41]"
                            href={`/api/evaluation/result-pdf?instanceId=${encodeURIComponent(
                              instance.id,
                            )}`}
                            rel="noopener"
                            target="_blank"
                          >
                            In PDF
                          </a>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {records.map(renderRecordCard)}
              </div>
            )}

            {!records.length && !loading ? (
              <div className="mt-5 rounded-lg border border-dashed border-[#cbdad5] p-8 text-center text-sm text-[#6d817b]">
                Chưa có dữ liệu trong nhóm này. Dùng khung bên trái để tạo bản
                ghi đầu tiên.
              </div>
            ) : null}
          </section>
        </div>
      )}
    </div>
  );
}
