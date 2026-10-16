"use client";

import {
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  FileText,
  History,
  LoaderCircle,
  LockKeyhole,
  Phone,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Send,
  ShieldCheck,
  UserRoundCheck,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  useToast,
  WriteLoadingOverlay,
} from "@/components/ui/toast";
import { postRpc } from "@/lib/rpc-client";

type Json = Record<string, unknown>;
type QueueEntry = {
  age: number | null;
  applicationCode: string;
  applicationId: string;
  assignmentId: string;
  candidateCode: string;
  candidateName: string;
  cardId: string;
  cvUrl: string;
  decision: string;
  department: string;
  email: string;
  finalScore: number | null;
  id: string;
  phone: string;
  position: string;
  receivedAt: string;
  reviewerName: string;
  roleLabel: string;
  roundKey: string;
  roundLabel: string;
  status: string;
  updatedAt: string;
  version: number;
};
type QueueData = {
  actor: { displayName: string; employeeCode: string; isAdmin: boolean };
  entries: QueueEntry[];
  positions: string[];
  stats: {
    draft: number;
    notStarted: number;
    shown: number;
    submitted: number;
    total: number;
  };
};
type ScoreItem = {
  bonusLearning: boolean;
  bonusTechnical: boolean;
  criterionId: string;
  criterionName: string;
  evidence: string;
  groupKey: string;
  groupName: string;
  id: string;
  itemKey: string;
  itemName: string;
  level: number | null;
  meta: Json;
  note: string;
  score: number | null;
  sectionKey: string;
  weight: number | null;
};
type Scorecard = {
  criteriaSetId: string;
  criteriaSetName: string;
  decision: string;
  finalScore: number | null;
  id: string;
  items: ScoreItem[];
  overallComment: string;
  reviewerName: string;
  roleLabel: string;
  roundKey: string;
  roundLabel: string;
  scoringMode: string;
  status: string;
  submittedAt: string;
  version: number;
};
type AssessmentData = {
  application: {
    applicationCode: string;
    applicationId: string;
    candidateCode: string;
    candidateName: string;
    cvUrl: string;
    department: string;
    email: string;
    phone: string;
    position: string;
  };
  card: Scorecard;
  criteriaSet: {
    code: string;
    id: string;
    items: ScoreItem[];
    name: string;
    scopeType: string;
  } | null;
  jd: {
    activityCount: number;
    fileName: string;
    fileUrl: string;
    source: string;
    sourceLabel: string;
    title: string;
    workGroupCount: number;
  } | null;
  personality: Array<{ id: string; kind: string; payload: Json }>;
  previousCards: Scorecard[];
  scoringOptions: {
    criteriaItems: ScoreItem[];
    jdItems: ScoreItem[];
  };
};

const ROUND_TABS = [
  ["all", "Tất cả"],
  ["preliminary", "Sơ vấn"],
  ["round1", "Vòng 1"],
  ["round2", "Vòng 2"],
] as const;
const DECISIONS = [
  ["pass", "Đạt", "bg-[#0c6e4c] text-white"],
  ["consider", "Cân nhắc", "bg-[#e97835] text-white"],
  ["fail", "Không đạt", "bg-[#a44836] text-white"],
] as const;

function text(value: unknown) {
  return value == null ? "" : String(value).trim();
}

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatDate(value: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function statusLabel(status: string) {
  if (["submitted", "completed", "published"].includes(status)) return "Đã nộp";
  if (status === "draft") return "Bản nháp";
  return "Chưa bắt đầu";
}

function itemScore(item: ScoreItem) {
  if (item.sectionKey === "preliminary") {
    return Math.min(
      10,
      numberValue(item.level) * 2 +
        Number(item.bonusTechnical) +
        Number(item.bonusLearning),
    );
  }
  if (item.sectionKey === "culture") {
    return Math.round(((numberValue(item.score) / 3) * 10) * 10) / 10;
  }
  return numberValue(item.score);
}

function calculateScore(items: ScoreItem[]) {
  const average = (rows: ScoreItem[]) => {
    const totalWeight = rows.reduce(
      (sum, item) => sum + Math.max(numberValue(item.weight, 1), 0),
      0,
    );
    if (!rows.length || !totalWeight) return 0;
    return (
      rows.reduce(
        (sum, item) =>
          sum +
          itemScore(item) * Math.max(numberValue(item.weight, 1), 0),
        0,
      ) / totalWeight
    );
  };
  const core = items.filter((item) => item.sectionKey !== "culture");
  const culture = items.filter((item) => item.sectionKey === "culture");
  const value = culture.length
    ? average(core) * 0.8 + average(culture) * 0.2
    : average(core);
  return Math.round(value * 100) / 100;
}

export function HexacoCard({
  snapshot,
}: {
  snapshot: { id: string; kind: string; payload: Json };
}) {
  const axes = ["H", "E", "X", "A", "C", "O"];
  const values = axes.map((axis) => {
    const direct = numberValue(
      snapshot.payload[axis] ??
        snapshot.payload[axis.toLowerCase()] ??
        snapshot.payload[`score${axis}`],
    );
    if (direct > 10) return Math.min(direct / 10, 10);
    if (direct > 0 && direct <= 5) return direct * 2;
    return Math.min(Math.max(direct, 0), 10);
  });
  const center = 90;
  const radius = 62;
  const points = values
    .map((value, index) => {
      const angle = (Math.PI * 2 * index) / axes.length - Math.PI / 2;
      const r = radius * (value / 10);
      return `${center + Math.cos(angle) * r},${center + Math.sin(angle) * r}`;
    })
    .join(" ");
  const grid = [0.33, 0.66, 1].map((factor) =>
    axes
      .map((_, index) => {
        const angle = (Math.PI * 2 * index) / axes.length - Math.PI / 2;
        return `${center + Math.cos(angle) * radius * factor},${
          center + Math.sin(angle) * radius * factor
        }`;
      })
      .join(" "),
  );
  const peakIndex = values.indexOf(Math.max(...values));
  const riskIndex = values.indexOf(Math.min(...values));
  return (
    <div className="grid gap-3 rounded-lg border border-[#d8e2df] bg-[#f9fbfa] p-3 sm:grid-cols-[180px_1fr]">
      <svg className="mx-auto size-[180px]" viewBox="0 0 180 180">
        {grid.map((polygon) => (
          <polygon
            fill="none"
            key={polygon}
            points={polygon}
            stroke="#cbdad5"
            strokeWidth="1"
          />
        ))}
        <polygon
          fill="color-mix(in srgb, var(--brand) 18%, transparent)"
          points={points}
          stroke="var(--brand-strong)"
          strokeWidth="2"
        />
        {axes.map((axis, index) => {
          const angle = (Math.PI * 2 * index) / axes.length - Math.PI / 2;
          return (
            <text
              fill="#114c41"
              fontSize="12"
              fontWeight="800"
              key={axis}
              textAnchor="middle"
              x={center + Math.cos(angle) * 78}
              y={center + Math.sin(angle) * 78 + 4}
            >
              {axis}
            </text>
          );
        })}
      </svg>
      <div className="self-center">
        <div className="text-xs font-black uppercase tracking-[0.08em] text-brand-strong">
          HEXACO
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {axes.map((axis, index) => (
            <div
              className="rounded-md bg-white p-2 text-center text-xs"
              key={axis}
            >
              <strong className="block text-[#114c41]">{axis}</strong>
              {values[index].toFixed(1)}
            </div>
          ))}
        </div>
        <div className="mt-3 text-xs leading-5 text-[#5c716b]">
          Điểm nổi bật: <strong>{axes[peakIndex]}</strong> · Điểm cần lưu ý:{" "}
          <strong>{axes[riskIndex]}</strong>
        </div>
      </div>
    </div>
  );
}

export function CandidateAssessmentWorkspace() {
  const { toast } = useToast();
  const [queue, setQueue] = useState<QueueData | null>(null);
  const [assessment, setAssessment] = useState<AssessmentData | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [round, setRound] = useState("all");
  const [position, setPosition] = useState("");
  const [query, setQuery] = useState("");
  const [minAge, setMinAge] = useState(16);
  const [maxAge, setMaxAge] = useState(80);
  const [loading, setLoading] = useState(true);
  const [writing, setWriting] = useState(false);

  const loadQueue = useCallback(
    async (options?: { keepSelection?: boolean }) => {
      setLoading(true);
      try {
        const result = await postRpc<QueueData>(
          "/api/recruitment/rpc",
          "getAssessmentQueue",
          { maxAge, minAge, position, query, round },
        );
        setQueue(result);
        const target =
          options?.keepSelection &&
          result.entries.some((entry) => entry.id === selectedId)
            ? selectedId
            : result.entries[0]?.id || "";
        setSelectedId(target);
        if (target) {
          setAssessment(
            await postRpc<AssessmentData>(
              "/api/recruitment/rpc",
              "openAssessment",
              { entryId: target },
            ),
          );
        } else {
          setAssessment(null);
        }
      } catch (error) {
        toast({
          message: error instanceof Error ? error.message : "Không tải được hàng chờ.",
          title: "Lỗi tải dữ liệu",
          tone: "error",
        });
      } finally {
        setLoading(false);
      }
    },
    [maxAge, minAge, position, query, round, selectedId, toast],
  );

  useEffect(() => {
    void loadQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openEntry(id: string) {
    setSelectedId(id);
    setLoading(true);
    try {
      setAssessment(
        await postRpc<AssessmentData>(
          "/api/recruitment/rpc",
          "openAssessment",
          { entryId: id },
        ),
      );
    } catch (error) {
      toast({
        message: error instanceof Error ? error.message : "Không mở được phiếu.",
        title: "Không thể mở phiếu",
        tone: "error",
      });
    } finally {
      setLoading(false);
    }
  }

  function updateItem(index: number, patch: Partial<ScoreItem>) {
    setAssessment((current) =>
      current
        ? {
            ...current,
            card: {
              ...current.card,
              items: current.card.items.map((item, itemIndex) =>
                itemIndex === index ? { ...item, ...patch } : item,
              ),
            },
          }
        : current,
    );
  }

  function switchScoringMode(nextMode: "shared-jd" | "criteria") {
    if (!assessment || assessment.card.scoringMode === nextMode) return;
    const hasWork = assessment.card.items.some(
      (item) =>
        item.note ||
        item.evidence ||
        numberValue(item.score) > 0 ||
        numberValue(item.level) > 0 ||
        item.bonusLearning ||
        item.bonusTechnical,
    );
    if (
      hasWork &&
      !window.confirm(
        "Đổi cách chấm sẽ thay danh sách nội dung hiện tại. Tiếp tục?",
      )
    ) {
      return;
    }
    setAssessment((current) =>
      current
        ? {
            ...current,
            card: {
              ...current.card,
              criteriaSetId:
                nextMode === "criteria" ? current.criteriaSet?.id || "" : "",
              criteriaSetName:
                nextMode === "criteria" ? current.criteriaSet?.name || "" : "",
              items:
                nextMode === "criteria"
                  ? current.scoringOptions.criteriaItems
                  : current.scoringOptions.jdItems,
              scoringMode: nextMode,
            },
          }
        : current,
    );
  }

  async function save(submit: boolean) {
    if (!assessment) return;
    if (submit) {
      const roundOne = assessment.previousCards.find(
        (card) => card.roundKey === "round1" && card.finalScore != null,
      );
      const currentScore = calculateScore(assessment.card.items);
      if (
        assessment.card.roundKey === "round2" &&
        roundOne?.finalScore != null &&
        Math.abs(currentScore - roundOne.finalScore) > 2 &&
        !window.confirm(
          `Điểm vòng 2 lệch ${Math.abs(currentScore - roundOne.finalScore).toFixed(1)} điểm so với vòng 1. Ông vẫn muốn nộp?`,
        )
      ) {
        return;
      }
      if (
        !window.confirm(
          "Nộp phiếu sẽ khóa nội dung. Sau đó chỉ có thể tạo phiên bản chấm lại. Tiếp tục?",
        )
      ) {
        return;
      }
    }
    setWriting(true);
    try {
      const card = await postRpc<Scorecard>(
        "/api/recruitment/rpc",
        "saveAssessment",
        {
          decision: assessment.card.decision,
          criteriaSetId: assessment.card.criteriaSetId,
          criteriaSetName: assessment.card.criteriaSetName,
          items: assessment.card.items,
          overallComment: assessment.card.overallComment,
          scoringMode: assessment.card.scoringMode,
          scorecardId: assessment.card.id,
          submit,
        },
      );
      setAssessment((current) => (current ? { ...current, card } : current));
      toast({
        message: submit
          ? `Phiếu đã nộp với điểm ${card.finalScore}/10.`
          : "Bản nháp đã được lưu trên PostgreSQL.",
        title: submit ? "Đã nộp phiếu" : "Đã lưu nháp",
        tone: "success",
      });
      await loadQueue({ keepSelection: true });
    } catch (error) {
      toast({
        message: error instanceof Error ? error.message : "Không lưu được phiếu.",
        title: "Thao tác thất bại",
        tone: "error",
      });
    } finally {
      setWriting(false);
    }
  }

  async function createRevision() {
    if (!assessment) return;
    setWriting(true);
    try {
      const card = await postRpc<Scorecard>(
        "/api/recruitment/rpc",
        "createAssessmentRevision",
        { scorecardId: assessment.card.id },
      );
      setSelectedId(card.id);
      setAssessment(
        await postRpc<AssessmentData>(
          "/api/recruitment/rpc",
          "openAssessment",
          { scorecardId: card.id },
        ),
      );
      toast({
        message: `Đã mở phiên bản ${card.version} từ dữ liệu phiếu trước.`,
        title: "Sẵn sàng chấm lại",
        tone: "success",
      });
      await loadQueue({ keepSelection: true });
    } catch (error) {
      toast({
        message: error instanceof Error ? error.message : "Không tạo được phiên bản.",
        title: "Chấm lại thất bại",
        tone: "error",
      });
    } finally {
      setWriting(false);
    }
  }

  const groups = useMemo(() => {
    const result = new Map<string, { name: string; indexes: number[] }>();
    (assessment?.card.items || []).forEach((item, index) => {
      const key = item.groupKey || item.sectionKey || "general";
      const current = result.get(key) || {
        indexes: [],
        name: item.groupName || "Nội dung đánh giá",
      };
      current.indexes.push(index);
      result.set(key, current);
    });
    return Array.from(result.entries());
  }, [assessment]);
  const locked = Boolean(
    assessment &&
      ["submitted", "completed", "published"].includes(assessment.card.status),
  );
  const liveScore = assessment
    ? calculateScore(assessment.card.items)
    : 0;

  return (
    <div className="relative">
      <WriteLoadingOverlay
        message="Đang cập nhật phiếu đánh giá ứng viên..."
        show={writing}
      />
      <section className="rounded-xl border border-[#d2dfdb] bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.1em] text-brand-strong">
              Trung tâm đánh giá
            </div>
            <h1 className="mt-1 text-2xl font-black text-[#114c41]">
              Đánh giá ứng viên
            </h1>
            <p className="mt-1 text-sm text-[#6d817b]">
              Hàng chờ 3 vòng · lưu nháp · khóa sau nộp · chấm lại theo phiên bản.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {[
              ["Tổng", queue?.stats.total || 0],
              ["Đang hiện", queue?.stats.shown || 0],
              ["Chưa chấm", queue?.stats.notStarted || 0],
              ["Nháp", queue?.stats.draft || 0],
              ["Đã nộp", queue?.stats.submitted || 0],
            ].map(([label, value]) => (
              <div
                className="rounded-lg border border-[#dce5e2] bg-[#f7faf9] px-3 py-2 text-center"
                key={String(label)}
              >
                <strong className="block text-lg text-[#114c41]">{value}</strong>
                <span className="text-[10px] font-bold uppercase text-[#6d817b]">
                  {label}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-4 flex gap-2 overflow-x-auto">
          {ROUND_TABS.map(([key, label]) => (
            <button
              className={`shrink-0 rounded-full px-4 py-2 text-sm font-extrabold ${
                round === key
                  ? "bg-[#114c41] text-white"
                  : "border border-[#d5e0dc] text-[#49665f]"
              }`}
              key={key}
              onClick={() => setRound(key)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
        <div className="mt-3 grid gap-2 lg:grid-cols-[1.4fr_1fr_100px_100px_auto]">
          <label className="relative">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6d817b]"
              size={17}
            />
            <input
              className="h-10 w-full rounded-lg border border-[#cbdad5] pl-9 pr-3 text-sm"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Tên, mã, điện thoại, email..."
              value={query}
            />
          </label>
          <select
            className="h-10 rounded-lg border border-[#cbdad5] px-3 text-sm"
            onChange={(event) => setPosition(event.target.value)}
            value={position}
          >
            <option value="">Tất cả vị trí</option>
            {(queue?.positions || []).map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
          <input
            className="h-10 rounded-lg border border-[#cbdad5] px-3 text-sm"
            max={80}
            min={16}
            onChange={(event) => setMinAge(numberValue(event.target.value))}
            title="Tuổi từ"
            type="number"
            value={minAge}
          />
          <input
            className="h-10 rounded-lg border border-[#cbdad5] px-3 text-sm"
            max={80}
            min={16}
            onChange={(event) => setMaxAge(numberValue(event.target.value))}
            title="Tuổi đến"
            type="number"
            value={maxAge}
          />
          <Button onClick={() => void loadQueue()}>
            <RefreshCw className={loading ? "animate-spin" : ""} size={17} />
            Lọc
          </Button>
        </div>
      </section>

      <div className="mt-5 grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="max-h-[calc(100vh-220px)] space-y-2 overflow-y-auto rounded-xl border border-[#d2dfdb] bg-white p-3 shadow-sm xl:sticky xl:top-4">
          {(queue?.entries || []).map((entry) => (
            <button
              className={`w-full rounded-lg border p-3 text-left transition ${
                selectedId === entry.id
                  ? "border-brand bg-brand-soft shadow-sm"
                  : "border-[#dce5e2] bg-[#f9fbfa] hover:border-[#aebfba]"
              }`}
              key={entry.id}
              onClick={() => void openEntry(entry.id)}
              type="button"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <strong className="text-sm text-[#114c41]">
                    {entry.candidateName}
                  </strong>
                  <div className="mt-1 text-xs text-[#6d817b]">
                    {entry.candidateCode || entry.applicationCode} ·{" "}
                    {entry.position}
                  </div>
                </div>
                <ChevronRight size={17} />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <span className="rounded-full bg-[#e9f4f0] px-2 py-1 text-[10px] font-black text-[#176754]">
                  {entry.roundLabel}
                </span>
                <span
                  className={`rounded-full px-2 py-1 text-[10px] font-black ${
                    entry.status === "submitted"
                      ? "bg-[#e8f8f1] text-[#0c6e4c]"
                      : entry.status === "draft"
                        ? "bg-[#fff2e8] text-[#9a5712]"
                        : "bg-[#f0f3f2] text-[#647972]"
                  }`}
                >
                  {statusLabel(entry.status)}
                </span>
                <span className="ml-auto text-[10px] font-bold text-[#6d817b]">
                  v{entry.version}
                </span>
              </div>
            </button>
          ))}
          {!queue?.entries.length && !loading ? (
            <div className="p-8 text-center text-sm text-[#6d817b]">
              Không có phiếu phù hợp bộ lọc.
            </div>
          ) : null}
        </aside>

        <main className="min-w-0">
          {loading && !assessment ? (
            <div className="grid min-h-96 place-items-center rounded-xl border border-[#d2dfdb] bg-white">
              <LoaderCircle className="animate-spin text-brand" size={34} />
            </div>
          ) : assessment ? (
            <div className="space-y-4">
              <section className="rounded-xl border border-[#d2dfdb] bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-[#114c41] px-3 py-1 text-xs font-black text-white">
                        {assessment.card.roundLabel}
                      </span>
                      <span className="rounded-full bg-[#fff2e8] px-3 py-1 text-xs font-black text-[#9a5712]">
                        Phiên bản {assessment.card.version}
                      </span>
                      {locked ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-[#e8f8f1] px-3 py-1 text-xs font-black text-[#0c6e4c]">
                          <LockKeyhole size={13} />
                          Đã khóa
                        </span>
                      ) : null}
                    </div>
                    <h2 className="mt-3 text-2xl font-black text-[#114c41]">
                      {assessment.application.candidateName}
                    </h2>
                    <p className="mt-1 text-sm text-[#6d817b]">
                      {assessment.application.candidateCode ||
                        assessment.application.applicationCode}{" "}
                      · {assessment.application.position} ·{" "}
                      {assessment.application.department || "Chưa có phòng ban"}
                    </p>
                    <p className="mt-2 text-xs text-[#6d817b]">
                      Người chấm:{" "}
                      <strong>{assessment.card.reviewerName || queue?.actor.displayName}</strong>{" "}
                      · {assessment.card.roleLabel || "Hội đồng"}
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="text-xs font-black uppercase tracking-[0.08em] text-[#6d817b]">
                      Điểm tạm tính
                    </div>
                    <div className="mt-1 text-4xl font-black text-brand">
                      {liveScore}
                      <span className="text-lg text-[#6d817b]">/10</span>
                    </div>
                    <div className="mt-3 flex flex-wrap justify-end gap-2">
                      {assessment.application.phone ? (
                        <a
                          className="inline-flex h-9 items-center gap-2 rounded-full border border-[#d2dfdb] px-3 text-xs font-bold text-[#114c41]"
                          href={`tel:${assessment.application.phone}`}
                        >
                          <Phone size={14} />
                          Gọi
                        </a>
                      ) : null}
                      {assessment.application.cvUrl ? (
                        <a
                          className="inline-flex h-9 items-center gap-2 rounded-full border border-[#d2dfdb] px-3 text-xs font-bold text-[#114c41]"
                          href={assessment.application.cvUrl}
                          rel="noopener"
                          target="_blank"
                        >
                          <FileText size={14} />
                          Mở CV
                        </a>
                      ) : null}
                    </div>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-[#d8e2df] bg-[#f7faf9] p-3 text-xs">
                  <ShieldCheck className="text-[#0c6e4c]" size={17} />
                  <strong className="text-[#114c41]">
                    {assessment.jd?.sourceLabel || "Chưa tìm thấy JD"}
                  </strong>
                  <span className="text-[#6d817b]">
                    {assessment.jd
                      ? `${assessment.jd.workGroupCount} nhóm · ${assessment.jd.activityCount} hoạt động`
                      : "Phiếu đang dùng bộ tiêu chí dự phòng"}
                  </span>
                  {assessment.jd?.fileUrl ? (
                    <a
                      className="ml-auto font-bold text-brand-strong"
                      href={assessment.jd.fileUrl}
                      rel="noopener"
                      target="_blank"
                    >
                      Xem JD
                    </a>
                  ) : null}
                </div>
                {assessment.card.roundKey !== "preliminary" ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span className="mr-1 text-xs font-black uppercase tracking-[0.06em] text-[#6d817b]">
                      Cách chấm
                    </span>
                    <button
                      className={`rounded-full px-3 py-1.5 text-xs font-black ${
                        assessment.card.scoringMode !== "criteria"
                          ? "bg-[#114c41] text-white"
                          : "border border-[#d5e0dc] text-[#49665f]"
                      }`}
                      disabled={locked}
                      onClick={() => switchScoringMode("shared-jd")}
                      type="button"
                    >
                      Theo JD dùng chung
                    </button>
                    {assessment.criteriaSet ? (
                      <button
                        className={`rounded-full px-3 py-1.5 text-xs font-black ${
                          assessment.card.scoringMode === "criteria"
                            ? "bg-brand text-white"
                            : "border border-[#d5e0dc] text-[#49665f]"
                        }`}
                        disabled={locked}
                        onClick={() => switchScoringMode("criteria")}
                        type="button"
                      >
                        Bộ {assessment.criteriaSet.name} ·{" "}
                        {assessment.criteriaSet.scopeType}
                      </button>
                    ) : (
                      <span className="text-xs text-[#8a9b96]">
                        Chưa có bộ tiêu chí phát hành phù hợp.
                      </span>
                    )}
                  </div>
                ) : null}
              </section>

              {assessment.previousCards.length ? (
                <section className="rounded-xl border border-[#d2dfdb] bg-white p-4">
                  <div className="flex items-center gap-2 font-black text-[#114c41]">
                    <History size={18} />
                    Lịch sử vòng và phiên bản
                  </div>
                  <div className="mt-3 flex gap-2 overflow-x-auto">
                    {assessment.previousCards.map((card) => (
                      <button
                        className="shrink-0 rounded-lg border border-[#d8e2df] bg-[#f9fbfa] px-3 py-2 text-left text-xs"
                        key={card.id}
                        onClick={() => void openEntry(card.id)}
                        type="button"
                      >
                        <strong className="block text-[#114c41]">
                          {card.roundLabel} · v{card.version}
                        </strong>
                        <span className="text-[#6d817b]">
                          {card.finalScore ?? "—"}/10 · {statusLabel(card.status)}
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}

              {assessment.personality.map((snapshot) =>
                snapshot.kind === "hexaco" ? (
                  <HexacoCard key={snapshot.id} snapshot={snapshot} />
                ) : null,
              )}

              {groups.map(([groupKey, group]) => (
                <section
                  className="rounded-xl border border-[#d2dfdb] bg-white p-5 shadow-sm"
                  key={groupKey}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="font-black text-[#114c41]">{group.name}</h3>
                      <p className="mt-1 text-xs text-[#6d817b]">
                        {group.indexes.length} nội dung đánh giá
                      </p>
                    </div>
                    <span className="rounded-full bg-[#e9f4f0] px-3 py-1 text-xs font-black text-[#176754]">
                      {Math.round(
                        (group.indexes.reduce(
                          (sum, index) =>
                            sum + itemScore(assessment.card.items[index]),
                          0,
                        ) /
                          Math.max(group.indexes.length, 1)) *
                          10,
                      ) / 10}
                      /10
                    </span>
                  </div>
                  <div className="mt-4 space-y-4">
                    {group.indexes.map((index) => {
                      const item = assessment.card.items[index];
                      if (item.sectionKey === "preliminary") {
                        return (
                          <article
                            className="rounded-lg border border-[#d8e2df] bg-[#f9fbfa] p-4"
                            key={`${item.itemKey}-${index}`}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <strong className="text-sm text-[#114c41]">
                                {item.itemName}
                              </strong>
                              <span className="text-lg font-black text-brand">
                                {itemScore(item)}/10
                              </span>
                            </div>
                            <div className="mt-3 grid gap-3 md:grid-cols-[180px_1fr]">
                              <select
                                className="h-10 rounded-lg border border-[#cbdad5] px-3 text-sm"
                                disabled={locked}
                                onChange={(event) =>
                                  updateItem(index, {
                                    level: numberValue(event.target.value),
                                  })
                                }
                                value={item.level ?? 0}
                              >
                                {[0, 1, 2, 3, 4, 5].map((level) => (
                                  <option key={level} value={level}>
                                    Mức {level} · {level * 2} điểm
                                  </option>
                                ))}
                              </select>
                              <div className="flex flex-wrap gap-2">
                                <label className="flex items-center gap-2 rounded-lg border border-[#d8e2df] bg-white px-3 text-xs font-bold">
                                  <input
                                    checked={item.bonusTechnical}
                                    disabled={locked}
                                    onChange={(event) =>
                                      updateItem(index, {
                                        bonusTechnical: event.target.checked,
                                      })
                                    }
                                    type="checkbox"
                                  />
                                  +1 chuyên môn
                                </label>
                                <label className="flex items-center gap-2 rounded-lg border border-[#d8e2df] bg-white px-3 text-xs font-bold">
                                  <input
                                    checked={item.bonusLearning}
                                    disabled={locked}
                                    onChange={(event) =>
                                      updateItem(index, {
                                        bonusLearning: event.target.checked,
                                      })
                                    }
                                    type="checkbox"
                                  />
                                  +1 học hỏi
                                </label>
                              </div>
                            </div>
                            <textarea
                              className="mt-3 min-h-20 w-full rounded-lg border border-[#cbdad5] px-3 py-2 text-sm"
                              disabled={locked}
                              onChange={(event) =>
                                updateItem(index, { note: event.target.value })
                              }
                              placeholder="Nhận xét, căn cứ sơ vấn..."
                              value={item.note}
                            />
                          </article>
                        );
                      }
                      if (item.sectionKey === "culture") {
                        return (
                          <article
                            className="grid gap-3 rounded-lg border border-[#d8e2df] bg-[#f9fbfa] p-4 md:grid-cols-[1fr_auto]"
                            key={`${item.itemKey}-${index}`}
                          >
                            <div>
                              <strong className="text-sm text-[#114c41]">
                                {item.itemName}
                              </strong>
                              <textarea
                                className="mt-2 min-h-16 w-full rounded-lg border border-[#cbdad5] px-3 py-2 text-sm"
                                disabled={locked}
                                onChange={(event) =>
                                  updateItem(index, { note: event.target.value })
                                }
                                placeholder="Minh chứng hành vi..."
                                value={item.note}
                              />
                            </div>
                            <div className="self-center">
                              <div className="flex gap-1">
                                {[0, 1, 2, 3].map((score) => (
                                  <button
                                    className={`size-10 rounded-lg text-sm font-black ${
                                      numberValue(item.score) === score
                                        ? "bg-brand text-white"
                                        : "border border-[#d8e2df] bg-white text-[#49665f]"
                                    }`}
                                    disabled={locked}
                                    key={score}
                                    onClick={() => updateItem(index, { score })}
                                    type="button"
                                  >
                                    {score}
                                  </button>
                                ))}
                              </div>
                              <div className="mt-2 text-center text-xs font-bold text-[#6d817b]">
                                Quy đổi {itemScore(item)}/10
                              </div>
                            </div>
                          </article>
                        );
                      }
                      return (
                        <article
                          className="rounded-lg border border-[#d8e2df] bg-[#f9fbfa] p-4"
                          key={`${item.itemKey}-${index}`}
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <strong className="text-sm text-[#114c41]">
                                {item.itemName}
                              </strong>
                              {item.criterionName ? (
                                <div className="mt-1 text-xs text-[#6d817b]">
                                  {item.criterionName}
                                </div>
                              ) : null}
                            </div>
                            <span className="text-xl font-black text-brand">
                              {numberValue(item.score)}/10
                            </span>
                          </div>
                          <input
                            className="mt-3 w-full accent-brand"
                            disabled={locked}
                            max={10}
                            min={0}
                            onChange={(event) =>
                              updateItem(index, {
                                score: numberValue(event.target.value),
                              })
                            }
                            step={0.5}
                            type="range"
                            value={numberValue(item.score)}
                          />
                          <div className="mt-3 grid gap-3 md:grid-cols-2">
                            <textarea
                              className="min-h-20 rounded-lg border border-[#cbdad5] px-3 py-2 text-sm"
                              disabled={locked}
                              onChange={(event) =>
                                updateItem(index, { evidence: event.target.value })
                              }
                              placeholder="Minh chứng từ câu trả lời..."
                              value={item.evidence}
                            />
                            <textarea
                              className="min-h-20 rounded-lg border border-[#cbdad5] px-3 py-2 text-sm"
                              disabled={locked}
                              onChange={(event) =>
                                updateItem(index, { note: event.target.value })
                              }
                              placeholder="Nhận xét của người chấm..."
                              value={item.note}
                            />
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              ))}

              <section className="rounded-xl border border-[#d2dfdb] bg-white p-5 shadow-sm">
                <div className="flex items-center gap-2">
                  <UserRoundCheck className="text-brand-strong" size={20} />
                  <h3 className="font-black text-[#114c41]">
                    Kết luận của người đánh giá
                  </h3>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {DECISIONS.map(([key, label, selectedClass]) => (
                    <button
                      className={`rounded-full border px-5 py-2.5 text-sm font-black ${
                        assessment.card.decision === key
                          ? selectedClass
                          : "border-[#d5e0dc] bg-white text-[#49665f]"
                      }`}
                      disabled={locked}
                      key={key}
                      onClick={() =>
                        setAssessment((current) =>
                          current
                            ? {
                                ...current,
                                card: { ...current.card, decision: key },
                              }
                            : current,
                        )
                      }
                      type="button"
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <textarea
                  className="mt-4 min-h-28 w-full rounded-lg border border-[#cbdad5] px-3 py-2 text-sm"
                  disabled={locked}
                  onChange={(event) =>
                    setAssessment((current) =>
                      current
                        ? {
                            ...current,
                            card: {
                              ...current.card,
                              overallComment: event.target.value,
                            },
                          }
                        : current,
                    )
                  }
                  placeholder="Nhận xét tổng thể, điểm mạnh, rủi ro và khuyến nghị..."
                  value={assessment.card.overallComment}
                />
                <div className="mt-4 flex flex-wrap justify-end gap-2">
                  {locked ? (
                    <>
                      <div className="mr-auto inline-flex items-center gap-2 text-sm font-bold text-[#0c6e4c]">
                        <CheckCircle2 size={18} />
                        Phiếu đã nộp lúc {formatDate(assessment.card.submittedAt)}
                      </div>
                      <Button onClick={() => void createRevision()}>
                        <RotateCcw size={17} />
                        Chấm lại phiên bản mới
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        onClick={() => void save(false)}
                        variant="secondary"
                      >
                        <Save size={17} />
                        Lưu nháp
                      </Button>
                      <Button onClick={() => void save(true)}>
                        <Send size={17} />
                        Nộp và khóa phiếu
                      </Button>
                    </>
                  )}
                </div>
              </section>
            </div>
          ) : (
            <div className="grid min-h-96 place-items-center rounded-xl border border-dashed border-[#cbdad5] bg-white p-8 text-center">
              <div>
                <ClipboardCheck className="mx-auto text-[#9bb0aa]" size={48} />
                <h2 className="mt-3 font-black text-[#114c41]">
                  Chọn một ứng viên trong hàng chờ
                </h2>
                <p className="mt-1 text-sm text-[#6d817b]">
                  Phiếu sẽ mở đúng vòng, đúng người chấm và đúng JD đang hiệu lực.
                </p>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
