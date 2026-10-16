"use client";

import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Download,
  FileSpreadsheet,
  FolderInput,
  History,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Trash2,
  UserRoundSearch,
  UsersRound,
  X,
} from "lucide-react";
import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";

import { RecruitmentScoringWorkspace } from "./recruitment-scoring-workspace";
import type {
  ManagedCandidate,
  ManagementTab,
  RecruitmentCampaignView,
  RecruitmentManagementData,
} from "./management-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui/table";
import { useToast, WriteLoadingOverlay } from "@/components/ui/toast";
import { postRpc } from "@/lib/rpc-client";

const TABS: Array<{
  icon: typeof ClipboardList;
  key: ManagementTab;
  label: string;
}> = [
  { icon: ClipboardList, key: "today", label: "Việc hôm nay" },
  { icon: UserRoundSearch, key: "pipeline", label: "Hành trình ứng viên" },
  { icon: UsersRound, key: "campaigns", label: "Nhu cầu tuyển" },
  { icon: CalendarClock, key: "schedule", label: "Lịch & phân công" },
  { icon: FolderInput, key: "intake", label: "Tiếp nhận hồ sơ" },
  { icon: AlertTriangle, key: "quality", label: "Kiểm tra dữ liệu" },
  { icon: Settings2, key: "tools", label: "Công cụ vận hành" },
  { icon: CheckCircle2, key: "scoring", label: "Tiêu chí chấm" },
];

const inputClass =
  "h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm text-foreground outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20";
const textareaClass =
  "min-h-24 w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20";

function text(value: FormDataEntryValue | null) {
  return value == null ? "" : String(value).trim();
}

function formatDate(value: string, withTime = true) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    ...(withTime ? { timeStyle: "short" as const } : {}),
  }).format(date);
}

function toLocalInput(value: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000)
    .toISOString()
    .slice(0, 16);
}

function tone(status: string) {
  const value = status.toLowerCase();
  if (
    value.includes("đạt") ||
    value.includes("open") ||
    value.includes("hoàn tất") ||
    value.includes("active")
  ) {
    return "success" as const;
  }
  if (
    value.includes("hủy") ||
    value.includes("loại") ||
    value.includes("không") ||
    value.includes("trùng")
  ) {
    return "danger" as const;
  }
  return "info" as const;
}

function Stat({
  label,
  value,
  warning,
}: {
  label: string;
  value: number | string;
  warning?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface px-4 py-3 shadow-[0_8px_22px_rgba(17,45,39,0.05)]">
      <div className="text-xs font-bold uppercase tracking-wide text-muted">
        {label}
      </div>
      <div
        className={`mt-1 text-2xl font-extrabold ${
          warning ? "text-[#b45c22]" : "text-primary"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

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
    <label className={wide ? "sm:col-span-2" : ""}>
      <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-muted">
        {label}
      </span>
      {children}
    </label>
  );
}

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Không đọc được file đã chọn."));
    reader.onload = () => resolve(String(reader.result || "").split(",")[1] || "");
    reader.readAsDataURL(file);
  });
}

function downloadCandidates(candidates: ManagedCandidate[]) {
  const headers = [
    "Mã ứng viên",
    "Họ tên",
    "Điện thoại",
    "Email",
    "Vị trí",
    "Nhu cầu",
    "Nguồn",
    "Bước",
    "Tiến độ",
    "Phụ trách",
    "Việc tiếp theo",
    "Hạn",
  ];
  const csv = [headers, ...candidates.map((item) => [
    item.candidateCode,
    item.name,
    item.phone,
    item.email,
    item.position,
    item.requisitionCode,
    item.source,
    item.stageLabel,
    item.progressKey,
    item.ownerName,
    item.nextAction,
    item.dueAt,
  ])]
    .map((row) =>
      row
        .map((cell) => `"${String(cell || "").replaceAll('"', '""')}"`)
        .join(","),
    )
    .join("\r\n");
  const url = URL.createObjectURL(
    new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `ung-vien-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function RecruitmentManagementWorkspace({
  initial,
}: {
  initial: RecruitmentManagementData;
}) {
  const { toast } = useToast();
  const [data, setData] = useState(initial);
  const [activeTab, setActiveTab] = useState<ManagementTab>("today");
  const [loading, setLoading] = useState(false);
  const [writing, setWriting] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("Đang ghi dữ liệu...");
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState("all");
  const [selectedId, setSelectedId] = useState("");
  const [campaignForm, setCampaignForm] =
    useState<RecruitmentCampaignView | null>(null);
  const [sourceRows, setSourceRows] = useState([
    { campaignName: "", cvType: "", source: "" },
  ]);
  const [intakeSelected, setIntakeSelected] = useState<string[]>([]);
  const [duplicateSelected, setDuplicateSelected] = useState<string[]>([]);
  const [codePreview, setCodePreview] = useState<
    Array<{ applicationId: string; from: string; to: string }>
  >([]);
  const [reviewerRoles, setReviewerRoles] = useState<
    Record<string, string>
  >({});
  const importFileRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(
    () => data.candidates.find((item) => item.applicationId === selectedId) ?? null,
    [data.candidates, selectedId],
  );

  const filteredCandidates = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return data.candidates.filter((item) => {
      if (stageFilter !== "all" && item.stageKey !== stageFilter) return false;
      if (!needle) return true;
      return [
        item.candidateCode,
        item.name,
        item.phone,
        item.email,
        item.position,
        item.requisitionCode,
        item.ownerName,
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [data.candidates, search, stageFilter]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await postRpc<RecruitmentManagementData>(
        "/api/recruitment/rpc",
        "getManagementWorkspace",
        { limit: 500 },
      );
      setData(next);
    } catch (error) {
      toast({
        message: error instanceof Error ? error.message : "Không tải được dữ liệu.",
        title: "Quản lý Ứng viên",
        tone: "error",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const write = useCallback(
    async <T,>(
      method: string,
      payload: Record<string, unknown>,
      message: string,
      options: { refresh?: boolean } = { refresh: true },
    ) => {
      setLoadingMessage(message);
      setWriting(true);
      try {
        const result = await postRpc<T & { message?: string }>(
          "/api/recruitment/rpc",
          method,
          payload,
        );
        toast({
          message: result?.message,
          title: "Đã cập nhật",
          tone: "success",
        });
        if (options.refresh !== false) await refresh();
        return result;
      } catch (error) {
        toast({
          message: error instanceof Error ? error.message : "Không ghi được dữ liệu.",
          title: "Không thể hoàn tất",
          tone: "error",
        });
        return null;
      } finally {
        setWriting(false);
      }
    },
    [refresh, toast],
  );

  function openCandidate(candidate: ManagedCandidate) {
    setSelectedId(candidate.applicationId);
    setReviewerRoles({});
  }

  async function saveJourney(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = new FormData(event.currentTarget);
    await write(
      "saveJourney",
      {
        applicationId: selected.applicationId,
        dueAt: text(form.get("dueAt")),
        nextAction: text(form.get("nextAction")),
        note: text(form.get("note")),
        outcomeKey: text(form.get("outcomeKey")),
        ownerEmployeeId: text(form.get("ownerEmployeeId")),
        ownerName:
          data.reviewerOptions.find(
            (item) => item.employeeId === text(form.get("ownerEmployeeId")),
          )?.name || "",
        progressKey: text(form.get("progressKey")),
        stageKey: text(form.get("stageKey")),
      },
      "Đang cập nhật hành trình ứng viên...",
    );
  }

  async function transferCandidate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = new FormData(event.currentTarget);
    await write(
      "transferCandidate",
      {
        applicationId: selected.applicationId,
        campaignId: text(form.get("campaignId")),
        position: text(form.get("position")),
      },
      "Đang điều chuyển hồ sơ...",
    );
  }

  async function saveInterview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = new FormData(event.currentTarget);
    const reviewers = Object.entries(reviewerRoles)
      .filter(([, roleKey]) => roleKey)
      .map(([employeeId, roleKey]) => ({ employeeId, roleKey }));
    await write(
      "saveInterview",
      {
        applicationId: selected.applicationId,
        location: text(form.get("location")),
        meetingLink: text(form.get("meetingLink")),
        note: text(form.get("scheduleNote")),
        reviewers,
        roundKey: text(form.get("roundKey")),
        startAt: text(form.get("startAt")),
      },
      "Đang xếp lịch và phân công...",
    );
  }

  async function saveCampaign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await write(
      "saveCampaign",
      {
        availableOrder: text(form.get("availableOrder")),
        block: text(form.get("block")),
        code: text(form.get("code")),
        company: text(form.get("company")),
        department: text(form.get("department")),
        division: text(form.get("division")),
        endDate: text(form.get("endDate")),
        groupName: text(form.get("groupName")),
        id: text(form.get("id")),
        location: text(form.get("location")),
        position: text(form.get("position")),
        sources: sourceRows,
        startDate: text(form.get("startDate")),
        status: text(form.get("status")),
        team: text(form.get("team")),
      },
      "Đang lưu nhu cầu tuyển dụng...",
    );
    if (result) {
      setCampaignForm(null);
      setSourceRows([{ campaignName: "", cvType: "", source: "" }]);
    }
  }

  async function saveManualIntake(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await write(
      "saveManualIntake",
      {
        cvUrl: text(form.get("cvUrl")),
        email: text(form.get("email")),
        fullName: text(form.get("fullName")),
        phone: text(form.get("phone")),
        position: text(form.get("position")),
        requisitionCode: text(form.get("requisitionCode")),
        source: text(form.get("source")),
      },
      "Đang đưa hồ sơ vào Work Flow...",
    );
    if (result) event.currentTarget.reset();
  }

  async function importIntake(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const file = importFileRef.current?.files?.[0];
    if (!file) {
      toast({
        message: "Vui lòng chọn file CSV, XLS hoặc XLSX.",
        title: "Chưa có file",
        tone: "warning",
      });
      return;
    }
    const base64 = await fileToBase64(file);
    const result = await write(
      "importIntakeFile",
      {
        base64,
        fileName: file.name,
        source: text(form.get("source")),
      },
      `Đang nạp ${file.name}...`,
    );
    if (result) event.currentTarget.reset();
  }

  async function saveSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const mapping: Record<string, string> = {};
    for (const key of [
      "fullName",
      "phone",
      "email",
      "position",
      "source",
      "requisitionCode",
      "cvUrl",
    ]) {
      mapping[key] = text(form.get(key));
    }
    const result = await write(
      "saveSourceDefinition",
      {
        mapping,
        name: text(form.get("name")),
        status: "ACTIVE",
      },
      "Đang lưu định nghĩa nguồn...",
    );
    if (result) event.currentTarget.reset();
  }

  async function saveRequisition(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await write(
      "saveRequisition",
      Object.fromEntries(form.entries()),
      "Đang lưu yêu cầu tuyển dụng...",
    );
    if (result) event.currentTarget.reset();
  }

  function beginEditCampaign(item?: RecruitmentCampaignView) {
    setCampaignForm(
      item ?? {
        availableOrder: "",
        block: "",
        campaignName: "",
        code: "",
        company: "",
        cvType: "",
        department: "",
        division: "",
        endDate: "",
        groupName: "",
        id: "",
        location: "",
        position: "",
        source: "",
        startDate: "",
        status: "OPEN",
        team: "",
      },
    );
    setSourceRows([
      {
        campaignName: item?.campaignName || "",
        cvType: item?.cvType || "",
        source: item?.source || "",
      },
    ]);
  }

  return (
    <div className="mt-5 grid gap-5 xl:grid-cols-[250px_minmax(0,1fr)]">
      <WriteLoadingOverlay message={loadingMessage} show={writing} />

      <aside className="h-fit rounded-xl border border-border bg-surface p-3 shadow-[0_14px_34px_rgba(17,45,39,0.06)] xl:sticky xl:top-20">
        <div className="mb-3 flex items-center justify-between px-2">
          <div>
            <div className="text-xs font-bold uppercase tracking-wide text-muted">
              Tuyển dụng
            </div>
            <div className="font-extrabold text-primary">Workspace HR</div>
          </div>
          <Button
            aria-label="Làm mới"
            disabled={loading}
            onClick={() => void refresh()}
            size="icon"
            variant="ghost"
          >
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
        <nav className="space-y-1">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-bold transition ${
                  activeTab === tab.key
                    ? "bg-primary text-white shadow-[0_8px_18px_rgba(17,76,65,0.18)]"
                    : "text-primary hover:bg-primary/8"
                }`}
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                type="button"
              >
                <Icon className="size-4" />
                <span className="flex-1">{tab.label}</span>
                {tab.key === "pipeline" ? (
                  <span className="text-xs opacity-75">
                    {data.dashboard.activeCandidates}
                  </span>
                ) : null}
                {tab.key === "intake" && data.dashboard.intakePending ? (
                  <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] text-white">
                    {data.dashboard.intakePending}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>
        <div className="mt-3 rounded-lg border border-[#f0d4a3] bg-accent-soft px-3 py-2 text-xs leading-5 text-[#8d551e]">
          Offer và nhận việc đang khóa ở cả giao diện lẫn backend.
        </div>
      </aside>

      <main className="min-w-0">
        {activeTab === "today" ? (
          <section className="space-y-5">
            <header>
              <h2 className="text-2xl font-extrabold text-primary">
                Việc tuyển dụng hôm nay
              </h2>
              <p className="mt-1 text-sm text-muted">
                Việc quá hạn, lịch sắp tới và các phiếu còn thiếu được ưu tiên
                trước.
              </p>
            </header>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Stat label="Ứng viên đang chạy" value={data.dashboard.activeCandidates} />
              <Stat label="Cần chú ý" value={data.dashboard.needAttention} warning />
              <Stat label="Lịch sắp tới" value={data.dashboard.upcomingInterviews} />
              <Stat label="Thiếu phiếu chấm" value={data.dashboard.missingScorecards} warning />
              <Stat label="Nhu cầu đang mở" value={data.dashboard.activeCampaigns} />
              <Stat label="Hồ sơ chờ tiếp nhận" value={data.dashboard.intakePending} />
            </div>
            <div className="grid gap-5 lg:grid-cols-2">
              <section className="rounded-xl border border-border bg-surface p-4">
                <h3 className="font-extrabold text-primary">Việc ưu tiên</h3>
                <div className="mt-3 space-y-2">
                  {data.priority.length ? (
                    data.priority.map((item) => (
                      <button
                        className="flex w-full items-start justify-between gap-3 rounded-lg border border-border bg-surface-muted/50 p-3 text-left transition hover:border-accent"
                        key={item.applicationId}
                        onClick={() => {
                          setActiveTab("pipeline");
                          openCandidate(item);
                        }}
                        type="button"
                      >
                        <span>
                          <strong className="block text-sm text-primary">
                            {item.name} · {item.position || "Chưa có vị trí"}
                          </strong>
                          <small className="mt-1 block text-muted">
                            {item.nextAction || item.stageLabel} ·{" "}
                            {item.ownerName || "Chưa phân công"}
                          </small>
                        </span>
                        {item.isOverdue ? <Badge tone="danger">Quá hạn</Badge> : null}
                      </button>
                    ))
                  ) : (
                    <p className="py-6 text-center text-sm text-muted">
                      Không có việc ưu tiên.
                    </p>
                  )}
                </div>
              </section>
              <section className="rounded-xl border border-border bg-surface p-4">
                <h3 className="font-extrabold text-primary">Lịch gần nhất</h3>
                <div className="mt-3 space-y-2">
                  {data.interviews.slice(0, 12).map((item) => (
                    <div
                      className="rounded-lg border border-border bg-surface-muted/50 p-3"
                      key={item.id}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <strong className="text-sm text-primary">
                          {item.candidateName} · {item.roundLabel}
                        </strong>
                        <Badge tone={tone(item.status)}>{item.status}</Badge>
                      </div>
                      <div className="mt-1 text-xs text-muted">
                        {formatDate(item.startAt)} ·{" "}
                        {item.location || item.meetingLink || "Chưa có địa điểm"}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </section>
        ) : null}

        {activeTab === "pipeline" ? (
          <section className="space-y-4">
            <header className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-2xl font-extrabold text-primary">
                  Hành trình ứng viên
                </h2>
                <p className="mt-1 text-sm text-muted">
                  Mỗi hồ sơ có một bước hiện tại, việc tiếp theo, hạn và người
                  phụ trách.
                </p>
              </div>
              <Button
                onClick={() => downloadCandidates(filteredCandidates)}
                size="sm"
                variant="secondary"
              >
                <Download className="size-4" /> Xuất danh sách
              </Button>
            </header>
            <div className="flex gap-2 overflow-x-auto pb-1">
              <button
                className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-bold ${
                  stageFilter === "all"
                    ? "bg-primary text-white"
                    : "border border-border bg-surface text-primary"
                }`}
                onClick={() => setStageFilter("all")}
                type="button"
              >
                Tất cả · {data.candidates.length}
              </button>
              {data.pipeline
                .filter((item) => !item.locked)
                .map((item) => (
                  <button
                    className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-bold ${
                      stageFilter === item.key
                        ? "bg-primary text-white"
                        : "border border-border bg-surface text-primary"
                    }`}
                    key={item.key}
                    onClick={() => setStageFilter(item.key)}
                    type="button"
                  >
                    {item.label} · {item.count}
                    {item.overdue ? ` · ${item.overdue} trễ` : ""}
                  </button>
                ))}
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-4 top-3.5 size-4 text-muted" />
              <Input
                className="pl-11"
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Tìm mã, tên, SĐT, email, vị trí, người phụ trách..."
                value={search}
              />
            </div>
            <div className="overflow-hidden rounded-xl border border-border bg-surface">
              <Table>
                <TableHead>
                  <TableRow>
                    <TableHeaderCell>Ứng viên</TableHeaderCell>
                    <TableHeaderCell>Vị trí / Nhu cầu</TableHeaderCell>
                    <TableHeaderCell>Bước hiện tại</TableHeaderCell>
                    <TableHeaderCell>Việc tiếp theo</TableHeaderCell>
                    <TableHeaderCell>Phụ trách</TableHeaderCell>
                    <TableHeaderCell>Phiếu</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filteredCandidates.map((item) => (
                    <TableRow key={item.applicationId}>
                      <TableCell>
                        <button
                          className="text-left"
                          onClick={() => openCandidate(item)}
                          type="button"
                        >
                          <strong className="block text-primary">
                            {item.name}
                          </strong>
                          <small className="text-muted">
                            {item.candidateCode || "Chưa có mã"} ·{" "}
                            {item.phone || item.email || "Thiếu liên hệ"}
                          </small>
                        </button>
                      </TableCell>
                      <TableCell>
                        {item.position || "—"}
                        <div className="text-xs text-muted">
                          {item.requisitionCode || item.source || "—"}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge tone={item.isOverdue ? "danger" : "info"}>
                          {item.stageLabel}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {item.nextAction || "—"}
                        <div className="text-xs text-muted">
                          {item.dueAt ? formatDate(item.dueAt) : "Chưa có hạn"}
                        </div>
                      </TableCell>
                      <TableCell>{item.ownerName || "—"}</TableCell>
                      <TableCell>
                        {item.scoreSummary.completed}/{item.scoreSummary.total}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>
        ) : null}

        {activeTab === "campaigns" ? (
          <section className="space-y-4">
            <header className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-2xl font-extrabold text-primary">
                  Nhu cầu tuyển dụng
                </h2>
                <p className="mt-1 text-sm text-muted">
                  Một nhu cầu có thể mở nhiều nguồn hồ sơ nhưng dùng chung mã,
                  vị trí và thời hạn.
                </p>
              </div>
              <Button onClick={() => beginEditCampaign()} size="sm">
                <Plus className="size-4" /> Tạo nhu cầu tuyển
              </Button>
            </header>
            {campaignForm ? (
              <form
                className="rounded-xl border border-border bg-surface p-4"
                onSubmit={(event) => void saveCampaign(event)}
              >
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="font-extrabold text-primary">
                    {campaignForm.id ? "Sửa nhu cầu" : "Tạo nhu cầu tuyển"}
                  </h3>
                  <Button
                    onClick={() => setCampaignForm(null)}
                    size="icon"
                    variant="ghost"
                  >
                    <X className="size-4" />
                  </Button>
                </div>
                <input name="id" type="hidden" value={campaignForm.id} />
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Field label="Mã nhu cầu">
                    <Input defaultValue={campaignForm.code} name="code" />
                  </Field>
                  <Field label="Vị trí">
                    <Input defaultValue={campaignForm.position} name="position" required />
                  </Field>
                  <Field label="Công ty">
                    <Input defaultValue={campaignForm.company} name="company" />
                  </Field>
                  <Field label="Địa điểm">
                    <Input defaultValue={campaignForm.location} name="location" />
                  </Field>
                  <Field label="Khối">
                    <Input defaultValue={campaignForm.block} name="block" />
                  </Field>
                  <Field label="Phòng ban">
                    <Input defaultValue={campaignForm.department} name="department" />
                  </Field>
                  <Field label="Bộ phận">
                    <Input defaultValue={campaignForm.division} name="division" />
                  </Field>
                  <Field label="Team/Nhóm">
                    <Input defaultValue={campaignForm.team || campaignForm.groupName} name="team" />
                  </Field>
                  <Field label="Bắt đầu">
                    <Input defaultValue={campaignForm.startDate} name="startDate" type="date" />
                  </Field>
                  <Field label="Kết thúc">
                    <Input defaultValue={campaignForm.endDate} name="endDate" type="date" />
                  </Field>
                  <Field label="ORDER khả dụng">
                    <Input defaultValue={campaignForm.availableOrder} name="availableOrder" />
                  </Field>
                  <Field label="Trạng thái">
                    <select className={inputClass} defaultValue={campaignForm.status} name="status">
                      <option value="OPEN">Đang mở</option>
                      <option value="PAUSED">Tạm dừng</option>
                      <option value="CLOSED">Đã đóng</option>
                    </select>
                  </Field>
                </div>
                <div className="mt-4 border-t border-border pt-4">
                  <div className="mb-2 flex items-center justify-between">
                    <strong className="text-sm text-primary">Nguồn nhận hồ sơ</strong>
                    <Button
                      onClick={() =>
                        setSourceRows((rows) => [
                          ...rows,
                          { campaignName: "", cvType: "", source: "" },
                        ])
                      }
                      size="sm"
                      variant="secondary"
                    >
                      <Plus className="size-4" /> Thêm nguồn
                    </Button>
                  </div>
                  <div className="space-y-2">
                    {sourceRows.map((row, index) => (
                      <div
                        className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]"
                        key={`${index}-${row.source}`}
                      >
                        <Input
                          list="recruitmentSources"
                          onChange={(event) =>
                            setSourceRows((rows) =>
                              rows.map((item, at) =>
                                at === index ? { ...item, source: event.target.value } : item,
                              ),
                            )
                          }
                          placeholder="Nguồn"
                          value={row.source}
                        />
                        <Input
                          onChange={(event) =>
                            setSourceRows((rows) =>
                              rows.map((item, at) =>
                                at === index
                                  ? { ...item, campaignName: event.target.value }
                                  : item,
                              ),
                            )
                          }
                          placeholder="Tên chiến dịch"
                          value={row.campaignName}
                        />
                        <Input
                          onChange={(event) =>
                            setSourceRows((rows) =>
                              rows.map((item, at) =>
                                at === index ? { ...item, cvType: event.target.value } : item,
                              ),
                            )
                          }
                          placeholder="Loại CV"
                          value={row.cvType}
                        />
                        <Button
                          disabled={sourceRows.length === 1}
                          onClick={() =>
                            setSourceRows((rows) => rows.filter((_, at) => at !== index))
                          }
                          size="icon"
                          variant="ghost"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="mt-4 flex justify-end">
                  <Button type="submit">Lưu nhu cầu tuyển</Button>
                </div>
              </form>
            ) : null}
            <datalist id="recruitmentSources">
              {data.sources.map((item) => (
                <option key={item.id} value={item.name} />
              ))}
            </datalist>
            <div className="overflow-hidden rounded-xl border border-border bg-surface">
              <Table>
                <TableHead>
                  <TableRow>
                    <TableHeaderCell>Mã</TableHeaderCell>
                    <TableHeaderCell>Vị trí</TableHeaderCell>
                    <TableHeaderCell>Cơ cấu</TableHeaderCell>
                    <TableHeaderCell>Nguồn</TableHeaderCell>
                    <TableHeaderCell>Thời gian</TableHeaderCell>
                    <TableHeaderCell>Trạng thái</TableHeaderCell>
                    <TableHeaderCell />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.campaigns.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-bold text-primary">{item.code}</TableCell>
                      <TableCell>{item.position}</TableCell>
                      <TableCell>
                        {item.department || item.company || "—"}
                        <div className="text-xs text-muted">
                          {[item.division, item.team, item.groupName].filter(Boolean).join(" › ")}
                        </div>
                      </TableCell>
                      <TableCell>{item.source}</TableCell>
                      <TableCell>
                        {item.startDate || "—"} → {item.endDate || "—"}
                      </TableCell>
                      <TableCell><Badge tone={tone(item.status)}>{item.status}</Badge></TableCell>
                      <TableCell>
                        <Button onClick={() => beginEditCampaign(item)} size="sm" variant="ghost">
                          Sửa
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>
        ) : null}

        {activeTab === "schedule" ? (
          <section className="space-y-4">
            <header>
              <h2 className="text-2xl font-extrabold text-primary">
                Lịch & phân công phỏng vấn
              </h2>
              <p className="mt-1 text-sm text-muted">
                Mở hồ sơ trong Hành trình ứng viên để tạo hoặc thay đổi lịch.
              </p>
            </header>
            <div className="overflow-hidden rounded-xl border border-border bg-surface">
              <Table>
                <TableHead>
                  <TableRow>
                    <TableHeaderCell>Ứng viên</TableHeaderCell>
                    <TableHeaderCell>Vòng</TableHeaderCell>
                    <TableHeaderCell>Thời gian</TableHeaderCell>
                    <TableHeaderCell>Địa điểm/Link</TableHeaderCell>
                    <TableHeaderCell>Phân công</TableHeaderCell>
                    <TableHeaderCell>Trạng thái</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.interviews.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <button
                          className="text-left font-bold text-primary"
                          onClick={() => {
                            const candidate = data.candidates.find(
                              (entry) => entry.applicationId === item.applicationId,
                            );
                            if (candidate) {
                              setActiveTab("pipeline");
                              openCandidate(candidate);
                            }
                          }}
                          type="button"
                        >
                          {item.candidateName}
                        </button>
                      </TableCell>
                      <TableCell>{item.roundLabel}</TableCell>
                      <TableCell>{formatDate(item.startAt)}</TableCell>
                      <TableCell>{item.location || item.meetingLink || "—"}</TableCell>
                      <TableCell>
                        {item.assignments
                          .filter((entry) => entry.status !== "cancelled")
                          .map((entry) => entry.reviewerName)
                          .join(", ") || "—"}
                      </TableCell>
                      <TableCell><Badge tone={tone(item.status)}>{item.status}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>
        ) : null}

        {activeTab === "intake" ? (
          <section className="space-y-5">
            <header>
              <h2 className="text-2xl font-extrabold text-primary">
                Tiếp nhận hồ sơ
              </h2>
              <p className="mt-1 text-sm text-muted">
                Nhập tay hoặc nạp file theo mapping nguồn, rà soát rồi cập nhật
                vào danh sách tuyển dụng chính.
              </p>
            </header>
            <div className="grid gap-5 lg:grid-cols-2">
              <form
                className="rounded-xl border border-border bg-surface p-4"
                onSubmit={(event) => void saveManualIntake(event)}
              >
                <h3 className="font-extrabold text-primary">Nhập hồ sơ thủ công</h3>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <Field label="Họ và tên"><Input name="fullName" required /></Field>
                  <Field label="Số điện thoại"><Input name="phone" /></Field>
                  <Field label="Email"><Input name="email" type="email" /></Field>
                  <Field label="Vị trí"><Input list="positions" name="position" /></Field>
                  <Field label="Nguồn"><Input list="recruitmentSources" name="source" /></Field>
                  <Field label="Mã nhu cầu"><Input list="requisitions" name="requisitionCode" /></Field>
                  <Field label="Link CV" wide><Input name="cvUrl" type="url" /></Field>
                </div>
                <div className="mt-4 flex justify-end">
                  <Button type="submit">Đưa vào Work Flow</Button>
                </div>
              </form>
              <form
                className="rounded-xl border border-border bg-surface p-4"
                onSubmit={(event) => void importIntake(event)}
              >
                <h3 className="font-extrabold text-primary">Nạp Excel/CSV theo nguồn</h3>
                <p className="mt-1 text-xs leading-5 text-muted">
                  Hỗ trợ CSV, XLSX và định dạng XLS cũ của hệ thống GAS.
                </p>
                <div className="mt-3 space-y-3">
                  <Field label="Nguồn hồ sơ">
                    <select className={inputClass} name="source">
                      <option value="">Tự nhận diện từ file</option>
                      {data.sources.map((item) => (
                        <option key={item.id} value={item.name}>{item.name}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="File Excel / CSV">
                    <input
                      accept=".csv,.xls,.xlsx"
                      className={inputClass}
                      ref={importFileRef}
                      type="file"
                    />
                  </Field>
                </div>
                <div className="mt-4 flex justify-end">
                  <Button type="submit"><FileSpreadsheet className="size-4" /> Nạp file</Button>
                </div>
              </form>
            </div>
            <datalist id="positions">
              {data.dropdowns.positions?.map((item) => <option key={item} value={item} />)}
            </datalist>
            <datalist id="requisitions">
              {data.requisitions.map((item) => (
                <option key={item.id} value={item.requisitionCode}>
                  {item.position}
                </option>
              ))}
            </datalist>
            <div className="rounded-xl border border-border bg-surface p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-extrabold text-primary">Work Flow chờ rà soát</h3>
                  <p className="text-xs text-muted">
                    Đã chọn {intakeSelected.length}/{data.intake.length} hồ sơ.
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    disabled={!intakeSelected.length}
                    onClick={() =>
                      void write(
                        "archiveIntake",
                        { ids: intakeSelected },
                        "Đang lưu trữ hồ sơ đã chọn...",
                      ).then(() => setIntakeSelected([]))
                    }
                    size="sm"
                    variant="danger"
                  >
                    Lưu trữ
                  </Button>
                  <Button
                    disabled={!intakeSelected.length}
                    onClick={() =>
                      void write(
                        "promoteIntake",
                        { ids: intakeSelected },
                        "Đang cập nhật vào danh sách tuyển dụng...",
                      ).then(() => setIntakeSelected([]))
                    }
                    size="sm"
                  >
                    Cập nhật danh sách chính
                  </Button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableHeaderCell />
                      <TableHeaderCell>Ứng viên</TableHeaderCell>
                      <TableHeaderCell>Liên hệ</TableHeaderCell>
                      <TableHeaderCell>Vị trí/Nhu cầu</TableHeaderCell>
                      <TableHeaderCell>Nguồn</TableHeaderCell>
                      <TableHeaderCell>Trạng thái</TableHeaderCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {data.intake.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>
                          <input
                            checked={intakeSelected.includes(item.id)}
                            onChange={(event) =>
                              setIntakeSelected((ids) =>
                                event.target.checked
                                  ? [...ids, item.id]
                                  : ids.filter((id) => id !== item.id),
                              )
                            }
                            type="checkbox"
                          />
                        </TableCell>
                        <TableCell className="font-semibold">{item.fullName}</TableCell>
                        <TableCell>{item.phone || item.email || "—"}</TableCell>
                        <TableCell>
                          {item.position || "—"}
                          <div className="text-xs text-muted">{item.requisitionCode}</div>
                        </TableCell>
                        <TableCell>{item.source || "—"}</TableCell>
                        <TableCell><Badge tone={tone(item.status)}>{item.status}</Badge></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </section>
        ) : null}

        {activeTab === "quality" ? (
          <section className="space-y-5">
            <header>
              <h2 className="text-2xl font-extrabold text-primary">
                Kiểm tra chất lượng hồ sơ
              </h2>
              <p className="mt-1 text-sm text-muted">
                Phát hiện trùng, thiếu liên hệ/CV/vị trí và mã ứng viên không hợp lệ.
              </p>
            </header>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Nhóm trùng" value={data.dataQuality.duplicateGroups.length} warning />
              <Stat label="Thiếu mã" value={data.dataQuality.missingCode} warning />
              <Stat label="Thiếu liên hệ" value={data.dataQuality.missingPhone} warning />
              <Stat label="Thiếu CV/vị trí" value={data.dataQuality.missingCv + data.dataQuality.missingPosition} warning />
            </div>
            <section className="rounded-xl border border-border bg-surface p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-extrabold text-primary">Hồ sơ trùng</h3>
                  <p className="text-xs text-muted">
                    Chọn đúng bản thừa cần archive; bản giữ lại không được chọn.
                  </p>
                </div>
                <Button
                  disabled={!duplicateSelected.length}
                  onClick={() => {
                    if (!window.confirm(`Lưu trữ mềm ${duplicateSelected.length} hồ sơ trùng?`)) return;
                    void write(
                      "archiveDuplicateApplications",
                      { ids: duplicateSelected, note: "Xác nhận từ màn kiểm tra dữ liệu." },
                      "Đang lưu trữ hồ sơ trùng...",
                    ).then(() => setDuplicateSelected([]));
                  }}
                  size="sm"
                  variant="danger"
                >
                  Lưu trữ bản thừa đã chọn
                </Button>
              </div>
              <div className="space-y-3">
                {data.dataQuality.duplicateGroups.map((group) => (
                  <div className="rounded-lg border border-border p-3" key={`${group.field}-${group.value}`}>
                    <div className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">
                      Trùng {group.field === "phone" ? "SĐT" : "email"}: {group.value}
                    </div>
                    <div className="grid gap-2 md:grid-cols-2">
                      {group.items.map((item) => (
                        <label
                          className="flex items-start gap-3 rounded-lg bg-surface-muted/60 p-3"
                          key={item.applicationId}
                        >
                          <input
                            checked={duplicateSelected.includes(item.applicationId)}
                            onChange={(event) =>
                              setDuplicateSelected((ids) =>
                                event.target.checked
                                  ? [...ids, item.applicationId]
                                  : ids.filter((id) => id !== item.applicationId),
                              )
                            }
                            type="checkbox"
                          />
                          <span>
                            <strong className="block text-sm text-primary">{item.name}</strong>
                            <small className="text-muted">
                              {item.candidateCode || "Thiếu mã"} · {item.position || "Thiếu vị trí"} · {item.status}
                            </small>
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
            <section className="rounded-xl border border-border bg-surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-extrabold text-primary">Chuẩn hóa mã ứng viên</h3>
                  <p className="text-xs text-muted">
                    Chỉ sửa mã trống hoặc trùng, giữ nguyên mã hợp lệ để không đứt lịch sử.
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={() =>
                      void write<{
                        preview: Array<{ applicationId: string; from: string; to: string }>;
                      }>(
                        "repairCandidateCodes",
                        { apply: false },
                        "Đang kiểm tra mã ứng viên...",
                        { refresh: false },
                      ).then((result) => setCodePreview(result?.preview || []))
                    }
                    size="sm"
                    variant="secondary"
                  >
                    Kiểm tra mã
                  </Button>
                  <Button
                    disabled={!codePreview.length}
                    onClick={() =>
                      void write(
                        "repairCandidateCodes",
                        { apply: true },
                        "Đang chuẩn hóa mã ứng viên...",
                      ).then(() => setCodePreview([]))
                    }
                    size="sm"
                  >
                    Áp dụng {codePreview.length} mã
                  </Button>
                </div>
              </div>
              {codePreview.length ? (
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {codePreview.slice(0, 100).map((item) => (
                    <div className="rounded-lg bg-surface-muted p-2 text-xs" key={item.applicationId}>
                      {item.from || "Chưa có mã"} → <strong>{item.to}</strong>
                    </div>
                  ))}
                </div>
              ) : null}
            </section>
          </section>
        ) : null}

        {activeTab === "tools" ? (
          <section className="space-y-5">
            <header>
              <h2 className="text-2xl font-extrabold text-primary">
                Công cụ vận hành tuyển dụng
              </h2>
              <p className="mt-1 text-sm text-muted">
                Định nghĩa nguồn, mapping file và yêu cầu tuyển được quản lý trên PostgreSQL.
              </p>
            </header>
            <div className="grid gap-5 lg:grid-cols-2">
              <form
                className="rounded-xl border border-border bg-surface p-4"
                onSubmit={(event) => void saveSource(event)}
              >
                <h3 className="font-extrabold text-primary">Định nghĩa nguồn hồ sơ</h3>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <Field label="Tên nguồn" wide><Input name="name" required /></Field>
                  {[
                    ["fullName", "Header Họ tên"],
                    ["phone", "Header SĐT"],
                    ["email", "Header Email"],
                    ["position", "Header Vị trí"],
                    ["requisitionCode", "Header Mã nhu cầu"],
                    ["cvUrl", "Header Link CV"],
                  ].map(([name, label]) => (
                    <Field key={name} label={label}><Input name={name} /></Field>
                  ))}
                </div>
                <div className="mt-4 flex justify-end"><Button type="submit">Lưu định nghĩa nguồn</Button></div>
                <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-3">
                  {data.sources.map((item) => (
                    <Badge key={item.id} tone={item.status === "ACTIVE" ? "success" : "neutral"}>
                      {item.name}
                    </Badge>
                  ))}
                </div>
              </form>
              <form
                className="rounded-xl border border-border bg-surface p-4"
                onSubmit={(event) => void saveRequisition(event)}
              >
                <h3 className="font-extrabold text-primary">Yêu cầu tuyển dụng</h3>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <Field label="Mã yêu cầu"><Input name="requisitionCode" required /></Field>
                  <Field label="Mã công việc"><Input name="jobCode" /></Field>
                  <Field label="Vị trí"><Input name="position" required /></Field>
                  <Field label="Cấp bậc"><Input name="level" /></Field>
                  <Field label="Công ty"><Input name="company" /></Field>
                  <Field label="Phòng ban"><Input name="department" /></Field>
                  <Field label="Số lượng"><Input min={1} name="requestedQuantity" type="number" /></Field>
                  <Field label="Trạng thái">
                    <select className={inputClass} name="recruitmentStatus">
                      <option>Đang tuyển</option>
                      <option>Tạm dừng</option>
                      <option>Đã hoàn tất</option>
                      <option>Đã hủy</option>
                    </select>
                  </Field>
                  <Field label="Ngày tiếp nhận"><Input name="receivedAt" type="date" /></Field>
                  <Field label="Hạn nhận việc"><Input name="onboardDueAt" type="date" /></Field>
                  <Field label="Lý do tuyển" wide><textarea className={textareaClass} name="reason" /></Field>
                  <Field label="Ghi chú" wide><textarea className={textareaClass} name="note" /></Field>
                </div>
                <div className="mt-4 flex justify-end"><Button type="submit">Lưu yêu cầu tuyển</Button></div>
              </form>
            </div>
            <div className="overflow-hidden rounded-xl border border-border bg-surface">
              <Table>
                <TableHead>
                  <TableRow>
                    <TableHeaderCell>Mã yêu cầu</TableHeaderCell>
                    <TableHeaderCell>Vị trí</TableHeaderCell>
                    <TableHeaderCell>Đơn vị</TableHeaderCell>
                    <TableHeaderCell>Số lượng</TableHeaderCell>
                    <TableHeaderCell>Phụ trách</TableHeaderCell>
                    <TableHeaderCell>Trạng thái</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.requisitions.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-bold text-primary">{item.requisitionCode}</TableCell>
                      <TableCell>{item.position}</TableCell>
                      <TableCell>{item.department || item.company || "—"}</TableCell>
                      <TableCell>{item.requestedQuantity ?? "—"}</TableCell>
                      <TableCell>{item.recruiter || "—"}</TableCell>
                      <TableCell><Badge tone={tone(item.recruitmentStatus)}>{item.recruitmentStatus || "—"}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>
        ) : null}

        {activeTab === "scoring" ? <RecruitmentScoringWorkspace /> : null}
      </main>

      {selected ? (
        <div className="fixed inset-0 z-[120] flex justify-end bg-[rgba(6,24,20,0.46)] backdrop-blur-[2px]">
          <div className="h-full w-full max-w-3xl overflow-y-auto bg-surface p-5 shadow-[-24px_0_60px_rgba(17,45,39,0.25)]">
            <header className="flex items-start justify-between gap-4 border-b border-border pb-4">
              <div>
                <div className="text-xs font-bold uppercase tracking-wide text-muted">
                  {selected.candidateCode || selected.applicationCode}
                </div>
                <h2 className="mt-1 text-2xl font-extrabold text-primary">{selected.name}</h2>
                <p className="mt-1 text-sm text-muted">
                  {selected.position || "Chưa có vị trí"} · {selected.phone || selected.email || "Thiếu liên hệ"}
                </p>
              </div>
              <Button onClick={() => setSelectedId("")} size="icon" variant="ghost">
                <X className="size-5" />
              </Button>
            </header>

            <div className="mt-5 space-y-5">
              <form className="rounded-xl border border-border p-4" onSubmit={(event) => void saveJourney(event)}>
                <h3 className="font-extrabold text-primary">Hành trình và việc tiếp theo</h3>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <Field label="Bước hiện tại">
                    <select className={inputClass} defaultValue={selected.stageKey} name="stageKey">
                      {data.stages.filter((item) => !item.locked).map((item) => (
                        <option key={item.key} value={item.key}>{item.label}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Tiến độ">
                    <select className={inputClass} defaultValue={selected.progressKey} name="progressKey">
                      {data.progressOptions.map((item) => (
                        <option key={item.key} value={item.key}>{item.label}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Kết quả">
                    <select className={inputClass} defaultValue={selected.outcomeKey} name="outcomeKey">
                      {data.outcomeOptions.filter((item) => !["hired"].includes(item.key)).map((item) => (
                        <option key={item.key} value={item.key}>{item.label}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Người phụ trách">
                    <select className={inputClass} defaultValue={selected.ownerEmployeeId} name="ownerEmployeeId">
                      <option value="">Chưa phân công</option>
                      {data.reviewerOptions.map((item) => (
                        <option key={item.employeeId} value={item.employeeId}>{item.label}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Việc tiếp theo" wide><Input defaultValue={selected.nextAction} name="nextAction" /></Field>
                  <Field label="Hạn xử lý"><Input defaultValue={toLocalInput(selected.dueAt)} name="dueAt" type="datetime-local" /></Field>
                  <Field label="Ghi chú" wide><textarea className={textareaClass} name="note" /></Field>
                </div>
                <div className="mt-4 flex justify-end"><Button type="submit">Lưu hành trình</Button></div>
              </form>

              <form className="rounded-xl border border-border p-4" onSubmit={(event) => void transferCandidate(event)}>
                <h3 className="font-extrabold text-primary">Điều chuyển nhu cầu tuyển</h3>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <Field label="Nhu cầu mới">
                    <select className={inputClass} defaultValue={selected.campaignId} name="campaignId" required>
                      <option value="">Chọn nhu cầu</option>
                      {data.campaigns.map((item) => (
                        <option key={item.id} value={item.id}>{item.code} · {item.position} · {item.department || item.company}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Vị trí ghi nhận"><Input defaultValue={selected.position} name="position" /></Field>
                </div>
                <div className="mt-4 flex justify-end"><Button type="submit" variant="secondary">Điều chuyển</Button></div>
              </form>

              <form className="rounded-xl border border-border p-4" onSubmit={(event) => void saveInterview(event)}>
                <h3 className="font-extrabold text-primary">Lịch & phân công phỏng vấn</h3>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <Field label="Vòng">
                    <select className={inputClass} name="roundKey">
                      <option value="preliminary">Sơ vấn</option>
                      <option value="round1">Phỏng vấn vòng 1</option>
                      <option value="round2">Phỏng vấn vòng 2</option>
                    </select>
                  </Field>
                  <Field label="Ngày giờ"><Input name="startAt" required type="datetime-local" /></Field>
                  <Field label="Địa điểm"><Input name="location" /></Field>
                  <Field label="Meeting link"><Input name="meetingLink" type="url" /></Field>
                  <Field label="Ghi chú" wide><textarea className={textareaClass} name="scheduleNote" /></Field>
                </div>
                <div className="mt-4">
                  <div className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">Người phỏng vấn và vai trò</div>
                  <div className="max-h-64 space-y-2 overflow-y-auto rounded-lg border border-border p-2">
                    {data.reviewerOptions.map((item) => (
                      <div className="grid gap-2 rounded-lg bg-surface-muted/60 p-2 sm:grid-cols-[1fr_190px]" key={item.employeeId}>
                        <label className="flex items-center gap-2 text-sm font-semibold text-primary">
                          <input
                            checked={Boolean(reviewerRoles[item.employeeId])}
                            onChange={(event) =>
                              setReviewerRoles((current) => ({
                                ...current,
                                [item.employeeId]: event.target.checked ? "interviewer" : "",
                              }))
                            }
                            type="checkbox"
                          />
                          {item.label}
                        </label>
                        <select
                          className={inputClass}
                          disabled={!reviewerRoles[item.employeeId]}
                          onChange={(event) =>
                            setReviewerRoles((current) => ({
                              ...current,
                              [item.employeeId]: event.target.value,
                            }))
                          }
                          value={reviewerRoles[item.employeeId] || "interviewer"}
                        >
                          <option value="interviewer">Người phỏng vấn</option>
                          <option value="culture">Đánh giá văn hóa</option>
                          <option value="technical">Đánh giá chuyên môn</option>
                          <option value="balance">Đánh giá cân bằng</option>
                          <option value="decision">Quyết định</option>
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="mt-4 flex justify-end"><Button type="submit">Lưu lịch & phân công</Button></div>
              </form>

              <section className="rounded-xl border border-border p-4">
                <h3 className="flex items-center gap-2 font-extrabold text-primary">
                  <History className="size-4" /> Lịch sử xử lý
                </h3>
                <div className="mt-3 space-y-3 border-l-2 border-primary/20 pl-4">
                  {selected.timeline.length ? selected.timeline.map((item, index) => (
                    <div className="relative" key={`${item.createdAt}-${index}`}>
                      <span className="absolute -left-[21px] top-1 size-2 rounded-full bg-accent" />
                      <strong className="block text-sm text-primary">{item.title}</strong>
                      <div className="text-xs text-muted">{item.actorName} · {formatDate(item.createdAt)}</div>
                      {item.detail ? <p className="mt-1 text-sm text-foreground">{item.detail}</p> : null}
                    </div>
                  )) : <p className="text-sm text-muted">Chưa có lịch sử xử lý.</p>}
                </div>
              </section>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
