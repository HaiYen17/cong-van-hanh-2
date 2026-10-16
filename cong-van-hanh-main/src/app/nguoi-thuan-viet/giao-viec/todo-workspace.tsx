"use client";

import {
  useActionState,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  CalendarRange,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  ClipboardCheck,
  Clock3,
  Columns3,
  Eye,
  EyeOff,
  FolderKanban,
  ListChecks,
  MessageSquareText,
  Minus,
  Plus,
  RefreshCw,
  Repeat2,
  Search,
  Send,
  Target,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";

import { Badge, Button, Input, Select } from "@/components/ui";
import { MultiSelect } from "@/components/ui/multi-select";
import { useToast, WriteLoadingOverlay } from "@/components/ui/toast";
import {
  isTodoOutputClosed,
  isTodoOutputOverdueForWeek,
} from "@/lib/todo/output";

import {
  createTodoTaskAction,
  deleteTodoTaskAction,
  reviewTodoOutputAction,
  stopTodoRecurrenceAction,
  submitTodoFeedbackAction,
  type TodoActionState,
} from "./actions";
import styles from "./todo.module.css";

type EmployeeOption = {
  department: string;
  fullName: string;
  id: string;
  label: string;
  userId: string;
};

type TodoFeedback = {
  actorName: string;
  createdAt: string;
  id: string;
  report: string;
  status: string;
};

type TodoOutput = {
  assignedToMe: boolean;
  assignee: string;
  assigneeEmployeeIds: string[];
  assigneeUserIds: string[];
  assignees: string[];
  description: string;
  dueAt: string;
  feedbacks: TodoFeedback[];
  id: string;
  status: string;
};

type TodoDraftOutput = {
  assigneeEmployeeIds: string[];
  description: string;
  dueAt: string;
  id: string;
};

type TodoTask = {
  canReview: boolean;
  code: string;
  context: string;
  createdAt: string;
  createdByMe: boolean;
  id: string;
  kind: string;
  outputs: TodoOutput[];
  projectName: string;
  recurrenceTemplateId: string;
  repeatEnabled: boolean;
  repeatLabel: string;
  status: string;
  statusLabel: string;
  title: string;
};

type TaskFilter = "all" | "mine" | "created";
type BoardMode = "steps" | "week" | "project";

type BoardCard = {
  index: number;
  output: TodoOutput;
  task: TodoTask;
};

type BoardColumn = {
  cards: BoardCard[];
  key: string;
  label: string;
  subtitle: string;
  tone: "neutral" | "accent" | "warning" | "danger" | "success";
};

const initialState: TodoActionState = {};

const taskFilters: Array<{ key: TaskFilter; label: string }> = [
  { key: "mine", label: "Việc của tôi" },
  { key: "created", label: "Tôi đã giao" },
  { key: "all", label: "Tất cả" },
];

const boardModes: Array<{
  icon: LucideIcon;
  key: BoardMode;
  label: string;
}> = [
  { icon: Columns3, key: "steps", label: "Theo bước" },
  { icon: CalendarRange, key: "week", label: "Lịch tuần" },
  { icon: FolderKanban, key: "project", label: "Theo dự án" },
];

const kindOptions: Array<{
  icon: LucideIcon;
  label: string;
  value: "planned" | "recurring";
}> = [
  { icon: ClipboardCheck, label: "Theo kế hoạch", value: "planned" },
  { icon: Repeat2, label: "Lặp lại", value: "recurring" },
];

function createOutputId() {
  return globalThis.crypto?.randomUUID?.() || `output-${Date.now()}-${Math.random()}`;
}

function emptyOutput(): TodoDraftOutput {
  return {
    assigneeEmployeeIds: [],
    description: "",
    dueAt: "",
    id: createOutputId(),
  };
}

function fmt(value: string) {
  if (!value) return "Chưa đặt hạn";
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  if (Number.isNaN(date.getTime())) return "Chưa đặt hạn";
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function shortDate(date: Date) {
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
  }).format(date);
}

function dayKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, amount: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function weekStart(offset: number) {
  const now = new Date();
  now.setHours(12, 0, 0, 0);
  const mondayDistance = (now.getDay() + 6) % 7;
  return addDays(now, -mondayDistance + offset * 7);
}

function outputTone(status: string) {
  if (status === "APPROVED") return "success" as const;
  if (status === "WAITING_REVIEW") return "warning" as const;
  if (status === "RETURNED") return "danger" as const;
  return "neutral" as const;
}

function outputStatusLabel(status: string) {
  if (status === "APPROVED") return "Đã duyệt";
  if (status === "WAITING_REVIEW") return "Chờ duyệt";
  if (status === "RETURNED") return "Cần bổ sung";
  return "Cần làm";
}

function normalized(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .trim();
}

function cardMatchesSearch(card: BoardCard, query: string) {
  if (!query) return true;
  const latestFeedback = card.output.feedbacks.at(-1);
  return normalized(
    [
      card.task.code,
      card.task.title,
      card.task.context,
      card.task.projectName,
      card.output.description,
      card.output.assignee,
      latestFeedback?.actorName,
      latestFeedback?.report,
    ]
      .filter(Boolean)
      .join(" "),
  ).includes(query);
}

function buildColumns(
  cards: BoardCard[],
  mode: BoardMode,
  showCompleted: boolean,
  weekOffset: number,
): BoardColumn[] {
  if (mode === "steps") {
    const definitions: Array<Omit<BoardColumn, "cards"> & { statuses: string[] }> = [
      {
        key: "open",
        label: "Cần làm",
        statuses: ["OPEN", "IN_PROGRESS"],
        subtitle: "Đầu việc chưa gửi kết quả",
        tone: "accent",
      },
      {
        key: "waiting",
        label: "Chờ duyệt",
        statuses: ["WAITING_REVIEW"],
        subtitle: "Đã báo cáo, chờ người giao duyệt",
        tone: "warning",
      },
      {
        key: "returned",
        label: "Cần bổ sung",
        statuses: ["RETURNED"],
        subtitle: "Kết quả đã được trả lại",
        tone: "danger",
      },
    ];
    if (showCompleted) {
      definitions.push({
        key: "approved",
        label: "Hoàn thành",
        statuses: ["APPROVED"],
        subtitle: "Đã được duyệt kết quả",
        tone: "success",
      });
    }
    const knownStatuses = definitions.flatMap((column) => column.statuses);
    const columns = definitions.map(({ statuses, ...column }) => ({
      ...column,
      cards: cards.filter((card) => statuses.includes(card.output.status)),
    }));
    const unknownCards = cards.filter(
      (card) => !knownStatuses.includes(card.output.status),
    );
    if (unknownCards.length) {
      columns.push({
        cards: unknownCards,
        key: "unknown",
        label: "Cần kiểm tra",
        subtitle: "Trạng thái cũ chưa được phân loại",
        tone: "neutral",
      });
    }
    return columns;
  }

  if (mode === "week") {
    const start = weekStart(weekOffset);
    const end = addDays(start, 6);
    const dayNames = ["Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7", "Chủ nhật"];
    const overdue: BoardColumn = {
      cards: cards.filter(
        (card) =>
          isTodoOutputOverdueForWeek({
            dueAt: card.output.dueAt,
            status: card.output.status,
            weekStart: dayKey(start),
          }),
      ),
      key: "overdue",
      label: "Việc quá hạn",
      subtitle: `Chưa xong trước ${shortDate(start)}`,
      tone: "danger",
    };
    const completedBeforeWeek: BoardColumn = {
      cards: showCompleted
        ? cards.filter(
            (card) =>
              isTodoOutputClosed(card.output.status) &&
              Boolean(card.output.dueAt && card.output.dueAt < dayKey(start)),
          )
        : [],
      key: "completed-before-week",
      label: "Đã xong trước tuần",
      subtitle: `Hoàn tất trước ${shortDate(start)}`,
      tone: "success",
    };
    const days = dayNames.map((label, index): BoardColumn => {
      const date = addDays(start, index);
      const key = dayKey(date);
      return {
        cards: cards.filter((card) => card.output.dueAt === key),
        key,
        label,
        subtitle: shortDate(date),
        tone: key === dayKey(new Date()) ? "accent" : "neutral",
      };
    });
    const later: BoardColumn = {
      cards: cards.filter(
        (card) => !card.output.dueAt || card.output.dueAt > dayKey(end),
      ),
      key: "later",
      label: "Sau tuần / chưa hạn",
      subtitle: `Sau ${shortDate(end)}`,
      tone: "neutral",
    };
    return [
      overdue,
      ...(completedBeforeWeek.cards.length ? [completedBeforeWeek] : []),
      ...days,
      later,
    ];
  }

  const projects = new Map<string, { cards: BoardCard[]; label: string }>();
  for (const card of cards) {
    const project = card.task.projectName || "Không thuộc dự án";
    const key = normalized(project);
    const current = projects.get(key);
    projects.set(key, {
      cards: [...(current?.cards || []), card],
      label: current?.label || project,
    });
  }
  return [...projects.entries()]
    .sort(([, a], [, b]) => a.label.localeCompare(b.label, "vi"))
    .map(([key, project]) => ({
      cards: project.cards,
      key,
      label: project.label,
      subtitle: `${project.cards.length} đầu việc`,
      tone: project.label === "Không thuộc dự án" ? "neutral" : "accent",
    }));
}

export function TodoWorkspace({
  employees,
  tasks,
}: {
  employees: EmployeeOption[];
  tasks: TodoTask[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const seen = useRef<TodoActionState | null>(null);
  const [state, action, pending] = useActionState(createTodoTaskAction, initialState);
  const [mutating, startTransition] = useTransition();
  const [kind, setKind] = useState<"planned" | "recurring">("planned");
  const [title, setTitle] = useState("");
  const [context, setContext] = useState("");
  const [projectName, setProjectName] = useState("");
  const [repeatMode, setRepeatMode] = useState<"daily" | "monthly" | "weekly">("daily");
  const [repeatCalendar, setRepeatCalendar] = useState<"lunar" | "solar">("solar");
  const [repeatStartDate, setRepeatStartDate] = useState(() => dayKey(new Date()));
  const [repeatEndDate, setRepeatEndDate] = useState("");
  const [repeatTime, setRepeatTime] = useState("08:00");
  const [repeatWeekdays, setRepeatWeekdays] = useState<number[]>(() => {
    const weekday = new Date().getDay();
    return [weekday === 0 ? 7 : weekday];
  });
  const [repeatMonthDay, setRepeatMonthDay] = useState(() => String(new Date().getDate()));
  const [outputs, setOutputs] = useState<TodoDraftOutput[]>([emptyOutput()]);
  const [filter, setFilter] = useState<TaskFilter>("mine");
  const [boardMode, setBoardMode] = useState<BoardMode>("steps");
  const [showCompleted, setShowCompleted] = useState(false);
  const [weekOffset, setWeekOffset] = useState(0);
  const [search, setSearch] = useState("");
  const [feedbackText, setFeedbackText] = useState<Record<string, string>>({});
  const [reviewText, setReviewText] = useState<Record<string, string>>({});
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [taskDetailsExpanded, setTaskDetailsExpanded] = useState(true);
  const [expandedOutputIds, setExpandedOutputIds] = useState<Set<string>>(new Set());
  const employeeMultiOptions = useMemo(
    () =>
      employees.map((employee) => ({
        label: employee.fullName,
        sub: [
          employee.label.replace(`${employee.fullName} · `, ""),
          employee.userId ? "" : "Chưa liên kết tài khoản",
        ]
          .filter(Boolean)
          .join(" · "),
        value: employee.id,
      })),
    [employees],
  );

  useEffect(() => {
    if (state === seen.current) return;
    seen.current = state;
    if (state.success) {
      toast({ message: state.success, title: "Đã giao việc", tone: "success" });
      formRef.current?.reset();
      router.refresh();
      queueMicrotask(() => {
        setTitle("");
        setContext("");
        setProjectName("");
        setOutputs([emptyOutput()]);
      });
    } else if (state.error) {
      toast({ message: state.error, title: "Không thể giao việc", tone: "error" });
    }
  }, [router, state, toast]);

  const allCards = useMemo(
    () =>
      tasks.flatMap((task) =>
        task.outputs.map((output, index) => ({ index, output, task })),
      ),
    [tasks],
  );

  const taskCounts = useMemo(
    () => ({
      active: allCards.filter((card) => !isTodoOutputClosed(card.output.status)).length,
      completed: allCards.filter((card) => card.output.status === "APPROVED").length,
      created: allCards.filter(
        (card) => card.task.createdByMe && !isTodoOutputClosed(card.output.status),
      ).length,
      mine: allCards.filter(
        (card) => card.output.assignedToMe && !isTodoOutputClosed(card.output.status),
      ).length,
    }),
    [allCards],
  );

  const visibleCards = useMemo(() => {
    const query = normalized(search);
    return allCards.filter((card) => {
      if (filter === "mine" && !card.output.assignedToMe) return false;
      if (filter === "created" && !card.task.createdByMe) return false;
      if (!showCompleted && isTodoOutputClosed(card.output.status)) return false;
      return cardMatchesSearch(card, query);
    });
  }, [allCards, filter, search, showCompleted]);

  const columns = useMemo(
    () => buildColumns(visibleCards, boardMode, showCompleted, weekOffset),
    [boardMode, showCompleted, visibleCards, weekOffset],
  );
  const selectedWeekStart = weekStart(weekOffset);
  const selectedWeekEnd = addDays(selectedWeekStart, 6);
  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId) || null,
    [selectedTaskId, tasks],
  );

  useEffect(() => {
    if (!selectedTaskId) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (deleteConfirmOpen) setDeleteConfirmOpen(false);
      else setSelectedTaskId(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [deleteConfirmOpen, selectedTaskId]);

  const validOutputs = outputs.filter(
    (output) => output.description.trim() && output.assigneeEmployeeIds.length,
  );
  const payload = JSON.stringify({
    assignmentKind: kind,
    context,
    outputs,
    projectName,
    repeat:
      kind === "recurring"
        ? {
            calendar: repeatCalendar,
            enabled: true,
            endDate: repeatEndDate,
            mode: repeatMode,
            monthDays:
              repeatMode === "monthly" ? [Number(repeatMonthDay)] : [],
            startDate: repeatStartDate,
            times: [repeatTime],
            type: "recurrence",
            weekdays: repeatMode === "weekly" ? repeatWeekdays : [],
          }
        : null,
  });

  const runMutation = (
    actionCall: () => Promise<{ error?: string; success?: string }>,
    onSuccess?: () => void,
    labels?: { error: string; success: string },
  ) => {
    startTransition(async () => {
      const result = await actionCall();
      if (result.error) {
        toast({
          message: result.error,
          title: labels?.error || "Không thể cập nhật",
          tone: "error",
        });
      } else {
        toast({
          message: result.success,
          title: labels?.success || "Đã cập nhật công việc",
          tone: "success",
        });
        onSuccess?.();
        router.refresh();
      }
    });
  };

  const addOutput = () => setOutputs((current) => [...current, emptyOutput()]);

  const openTaskDetails = (taskId: string, outputId: string) => {
    setDeleteConfirmOpen(false);
    setSelectedTaskId(taskId);
    setTaskDetailsExpanded(true);
    setExpandedOutputIds(new Set([outputId]));
  };

  const toggleOutputDetails = (outputId: string) => {
    setExpandedOutputIds((current) => {
      const next = new Set(current);
      if (next.has(outputId)) next.delete(outputId);
      else next.add(outputId);
      return next;
    });
  };

  return (
    <>
      <WriteLoadingOverlay
        message={pending ? "Đang giao việc đúng người phụ trách..." : "Đang cập nhật công việc..."}
        show={pending || mutating}
      />

      <div className={styles.workspace}>
        <section className={`${styles.panel} ${styles.composerPanel}`}>
          <div className={styles.panelHeading}>
            <div className={styles.panelHeadingIcon} aria-hidden="true">
              <Target size={19} />
            </div>
            <div className={styles.panelHeadingCopy}>
              <span className={styles.panelKicker}>Tạo công việc mới</span>
              <h2>Rõ đầu việc, đúng người phụ trách</h2>
              <p>Người thực hiện được nối bằng mã nhân sự, không còn nhập tên tự do.</p>
            </div>
          </div>

          <div className={styles.kindTabs} role="group" aria-label="Loại giao việc">
            {kindOptions.map(({ icon: Icon, label, value }) => (
              <button
                aria-pressed={kind === value}
                className={kind === value ? styles.tabActive : styles.tab}
                key={value}
                onClick={() => setKind(value)}
                type="button"
              >
                <Icon size={15} />
                {label}
              </button>
            ))}
          </div>

          <form action={action} className={styles.composerForm} ref={formRef}>
            <input name="title" type="hidden" value={title} />
            <input name="payload" type="hidden" value={payload} />

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Công việc</span>
              <Input
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Ví dụ: Hoàn thiện hồ sơ gửi đối tác"
                required
                value={title}
              />
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Dự án / nhóm việc</span>
              <Input
                onChange={(event) => setProjectName(event.target.value)}
                placeholder="Ví dụ: OKRs Quý III"
                value={projectName}
              />
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Bối cảnh</span>
              <textarea
                className={styles.textarea}
                onChange={(event) => setContext(event.target.value)}
                placeholder="Yêu cầu, thông tin liên quan hoặc lưu ý cần biết"
                rows={3}
                value={context}
              />
            </label>

            {kind === "recurring" ? (
              <div className={styles.repeatPanel}>
                <div className={styles.repeatTitle}>
                  <Repeat2 size={16} />
                  Lịch lặp lại
                </div>
                <div className={styles.repeatGrid}>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Chu kỳ</span>
                    <Select
                      onChange={(event) =>
                        setRepeatMode(event.target.value as "daily" | "monthly" | "weekly")
                      }
                      value={repeatMode}
                    >
                      <option value="daily">Hằng ngày</option>
                      <option value="weekly">Hằng tuần</option>
                      <option value="monthly">Hằng tháng</option>
                    </Select>
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Ngày bắt đầu</span>
                    <Input
                      onChange={(event) => setRepeatStartDate(event.target.value)}
                      required
                      type="date"
                      value={repeatStartDate}
                    />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Giờ tạo kỳ mới</span>
                    <Input
                      onChange={(event) => setRepeatTime(event.target.value)}
                      required
                      type="time"
                      value={repeatTime}
                    />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Ngày kết thúc (tuỳ chọn)</span>
                    <Input
                      min={repeatStartDate}
                      onChange={(event) => setRepeatEndDate(event.target.value)}
                      type="date"
                      value={repeatEndDate}
                    />
                  </label>
                </div>
                {repeatMode === "weekly" ? (
                  <div className={styles.weekdayField}>
                    <span className={styles.fieldLabel}>Lặp vào thứ</span>
                    <div className={styles.weekdayPicker}>
                      {["T2", "T3", "T4", "T5", "T6", "T7", "CN"].map(
                        (label, index) => {
                          const weekday = index + 1;
                          const active = repeatWeekdays.includes(weekday);
                          return (
                            <button
                              aria-pressed={active}
                              className={active ? styles.weekdayActive : styles.weekdayButton}
                              key={label}
                              onClick={() =>
                                setRepeatWeekdays((current) =>
                                  active
                                    ? current.filter((day) => day !== weekday)
                                    : [...current, weekday].sort(),
                                )
                              }
                              type="button"
                            >
                              {label}
                            </button>
                          );
                        },
                      )}
                    </div>
                  </div>
                ) : null}
                {repeatMode === "monthly" ? (
                  <div className={styles.repeatGrid}>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>Loại lịch</span>
                      <Select
                        onChange={(event) =>
                          setRepeatCalendar(event.target.value as "lunar" | "solar")
                        }
                        value={repeatCalendar}
                      >
                        <option value="solar">Dương lịch</option>
                        <option value="lunar">Âm lịch Việt Nam</option>
                      </Select>
                    </label>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>
                        Ngày {repeatCalendar === "lunar" ? "âm" : "dương"} trong tháng
                      </span>
                      <Input
                        max={repeatCalendar === "lunar" ? 30 : 31}
                        min={1}
                        onChange={(event) => setRepeatMonthDay(event.target.value)}
                        required
                        type="number"
                        value={repeatMonthDay}
                      />
                    </label>
                  </div>
                ) : null}
                <p className={styles.repeatHint}>
                  Hệ thống sẽ tự sinh một công việc PostgreSQL mới ở mỗi kỳ và chống tạo trùng.
                  {repeatMode === "monthly" && repeatCalendar === "lunar"
                    ? " Ngày âm được quy đổi theo múi giờ Việt Nam."
                    : ""}
                </p>
              </div>
            ) : null}

            <div className={styles.outputSection}>
              <div className={styles.outputSectionHeading}>
                <div>
                  <span className={styles.fieldLabel}>Đầu việc cần đạt</span>
                  <small>{outputs.length} đầu việc đang soạn</small>
                </div>
                <Button onClick={addOutput} size="sm" type="button" variant="secondary">
                  <Plus size={15} />
                  Thêm
                </Button>
              </div>

              <div className={styles.outputDraftList}>
                {outputs.map((output, index) => (
                  <article className={styles.outputDraft} key={output.id}>
                    <div className={styles.outputDraftHeading}>
                      <span className={styles.outputNumber}>{index + 1}</span>
                      <strong>Đầu việc {index + 1}</strong>
                      <button
                        aria-label={`Xóa đầu việc ${index + 1}`}
                        className={styles.removeOutput}
                        disabled={outputs.length === 1}
                        onClick={() => setOutputs((current) => current.filter((item) => item.id !== output.id))}
                        title="Xóa đầu việc"
                        type="button"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>

                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>Kết quả cụ thể</span>
                      <Input
                        onChange={(event) => setOutputs((current) => current.map((item) => item.id === output.id ? { ...item, description: event.target.value } : item))}
                        placeholder="Nêu rõ sản phẩm hoặc kết quả cần bàn giao"
                        value={output.description}
                      />
                    </label>

                    <div className={styles.outputDraftGrid}>
                      <div
                        aria-label={`Người thực hiện đầu việc ${index + 1}`}
                        className={`${styles.field} ${styles.assigneePicker}`}
                        role="group"
                      >
                        <span className={styles.fieldLabel}>Người thực hiện (chọn nhiều)</span>
                        <MultiSelect
                          name={`assignees-${output.id}`}
                          onValuesChange={(assigneeEmployeeIds) =>
                            setOutputs((current) =>
                              current.map((item) =>
                                item.id === output.id
                                  ? { ...item, assigneeEmployeeIds }
                                  : item,
                              ),
                            )
                          }
                          options={employeeMultiOptions}
                          placeholder="Gõ tên hoặc mã nhân viên rồi chọn..."
                          values={output.assigneeEmployeeIds}
                        />
                      </div>
                      <label className={styles.field}>
                        <span className={styles.fieldLabel}>Hạn hoàn thành</span>
                        <Input
                          onChange={(event) => setOutputs((current) => current.map((item) => item.id === output.id ? { ...item, dueAt: event.target.value } : item))}
                          type="date"
                          value={output.dueAt}
                        />
                      </label>
                    </div>
                  </article>
                ))}
              </div>
            </div>

            <Button
              className={styles.assignButton}
              disabled={
                pending ||
                !title.trim() ||
                validOutputs.length !== outputs.length ||
                (kind === "recurring" &&
                  (!repeatStartDate ||
                    Boolean(repeatEndDate && repeatEndDate < repeatStartDate) ||
                    (repeatMode === "weekly" && !repeatWeekdays.length)))
              }
              type="submit"
            >
              <Send size={17} />
              {pending
                ? "Đang giao việc..."
                : validOutputs.length
                  ? `Giao ${validOutputs.length} đầu việc`
                  : "Giao việc"}
            </Button>
          </form>
        </section>

        <section className={`${styles.panel} ${styles.boardPanel}`}>
          <div className={styles.boardHeading}>
            <div className={styles.panelHeading}>
              <div className={styles.panelHeadingIcon} aria-hidden="true">
                <ListChecks size={19} />
              </div>
              <div className={styles.panelHeadingCopy}>
                <span className={styles.panelKicker}>Bảng Kanban</span>
                <h2>Tập trung vào việc còn phải làm</h2>
                <p>{visibleCards.length} đầu việc trong góc nhìn hiện tại.</p>
              </div>
            </div>
            <Button aria-label="Tải lại bảng công việc" onClick={() => router.refresh()} size="icon" title="Tải lại" variant="secondary">
              <RefreshCw size={17} />
            </Button>
          </div>

          <div className={styles.summaryGrid}>
            {([
              { icon: CircleDot, label: "Đang hoạt động", value: taskCounts.active },
              { icon: UserRound, label: "Việc của tôi", value: taskCounts.mine },
              { icon: Send, label: "Tôi đã giao", value: taskCounts.created },
              { icon: CheckCircle2, label: "Đã hoàn tất", value: taskCounts.completed },
            ] satisfies Array<{ icon: LucideIcon; label: string; value: number }>).map(({ icon: Icon, label, value }) => (
              <div className={styles.summaryCard} key={label}>
                <span className={styles.summaryIcon} aria-hidden="true"><Icon size={15} /></span>
                <strong>{value}</strong>
                <span>{label}</span>
              </div>
            ))}
          </div>

          <div className={styles.boardToolbar}>
            <label className={styles.searchBox}>
              <Search size={17} aria-hidden="true" />
              <input
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Tìm công việc, dự án hoặc người thực hiện"
                type="search"
                value={search}
              />
            </label>
            <div className={styles.toolbarRow}>
              <div className={styles.filterTabs} role="group" aria-label="Phạm vi công việc">
                {taskFilters.map((item) => (
                  <button
                    aria-pressed={filter === item.key}
                    className={filter === item.key ? styles.filterActive : styles.filterTab}
                    key={item.key}
                    onClick={() => setFilter(item.key)}
                    type="button"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <button className={styles.completedToggle} onClick={() => setShowCompleted((value) => !value)} type="button">
                {showCompleted ? <EyeOff size={15} /> : <Eye size={15} />}
                {showCompleted ? "Ẩn hoàn thành" : "Xem hoàn thành"}
              </button>
            </div>
            <div className={styles.viewTabs} role="group" aria-label="Kiểu bảng Kanban">
              {boardModes.map(({ icon: Icon, key, label }) => (
                <button
                  aria-pressed={boardMode === key}
                  className={boardMode === key ? styles.viewActive : styles.viewTab}
                  key={key}
                  onClick={() => setBoardMode(key)}
                  type="button"
                >
                  <Icon size={15} />
                  {label}
                </button>
              ))}
            </div>
          </div>

          {boardMode === "week" ? (
            <div className={styles.weekNavigator}>
              <button aria-label="Tuần trước" onClick={() => setWeekOffset((value) => value - 1)} type="button"><ChevronLeft size={16} /></button>
              <strong>{shortDate(selectedWeekStart)} – {shortDate(selectedWeekEnd)}</strong>
              <button className={styles.todayButton} onClick={() => setWeekOffset(0)} type="button">Tuần này</button>
              <button aria-label="Tuần sau" onClick={() => setWeekOffset((value) => value + 1)} type="button"><ChevronRight size={16} /></button>
            </div>
          ) : null}

          {visibleCards.length ? (
            <div className={styles.kanbanBoard}>
              {columns.map((column) => (
                <section className={styles.kanbanColumn} data-tone={column.tone} key={column.key}>
                  <div className={styles.columnHeader}>
                    <div>
                      <h3>{column.label}</h3>
                      <span>{column.subtitle}</span>
                    </div>
                    <strong>{column.cards.length}</strong>
                  </div>
                  <div className={styles.columnCards}>
                    {column.cards.length ? column.cards.map(({ output, task }) => (
                      <button
                        aria-label={`Mở chi tiết: ${output.description}`}
                        className={styles.compactCard}
                        data-overdue={Boolean(
                          output.dueAt &&
                          output.dueAt < dayKey(new Date()) &&
                          output.status !== "APPROVED"
                        )}
                        data-tone={outputTone(output.status)}
                        key={`${task.id}-${output.id}`}
                        onClick={() => openTaskDetails(task.id, output.id)}
                        type="button"
                      >
                        <strong>{output.description}</strong>
                        <span><Clock3 size={12} />{fmt(output.dueAt)}</span>
                      </button>
                    )) : (
                      <div className={styles.columnEmpty}>Không có đầu việc</div>
                    )}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div className={styles.emptyState}>
              <ClipboardCheck size={28} />
              <strong>Không còn việc phải xử lý</strong>
              <span>Việc đã hoàn thành đang được ẩn để bảng luôn gọn.</span>
            </div>
          )}
        </section>
      </div>

      {selectedTask ? (
        <div
          aria-label="Chi tiết công việc"
          className={styles.taskDialogBackdrop}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSelectedTaskId(null);
          }}
          role="presentation"
        >
          <section
            aria-labelledby="todo-detail-title"
            aria-modal="true"
            className={styles.taskDialog}
            role="dialog"
          >
            <header className={styles.taskDialogHeader}>
              <div className={styles.dialogTitleBlock}>
                <span className={styles.dialogKicker}>Giao việc</span>
                <h2 id="todo-detail-title">{selectedTask.title}</h2>
                <div className={styles.dialogStatusRow}>
                  <Badge
                    tone={
                      selectedTask.status === "COMPLETED" ? "success" : "info"
                    }
                  >
                    {selectedTask.statusLabel}
                  </Badge>
                  <span>{selectedTask.code}</span>
                </div>
              </div>
              <div className={styles.dialogHeaderActions}>
                {selectedTask.createdByMe ? (
                  <button
                    aria-label="Xóa vĩnh viễn công việc"
                    className={styles.deleteTaskButton}
                    onClick={() => setDeleteConfirmOpen(true)}
                    title="Hủy giao việc và xóa khỏi PostgreSQL"
                    type="button"
                  >
                    <Trash2 size={19} />
                  </button>
                ) : null}
                <button
                  aria-label={taskDetailsExpanded ? "Thu gọn công việc" : "Mở chi tiết công việc"}
                  className={styles.expandButton}
                  onClick={() => setTaskDetailsExpanded((value) => !value)}
                  title={taskDetailsExpanded ? "Thu gọn" : "Mở chi tiết"}
                  type="button"
                >
                  {taskDetailsExpanded ? <Minus size={20} /> : <Plus size={20} />}
                </button>
                <button
                  aria-label="Đóng chi tiết công việc"
                  className={styles.dialogCloseButton}
                  onClick={() => setSelectedTaskId(null)}
                  type="button"
                >
                  <X size={20} />
                </button>
              </div>
            </header>

            {taskDetailsExpanded ? (
              <div className={styles.taskDialogBody}>
                <div className={styles.parentTaskMeta}>
                  <span><FolderKanban size={14} />{selectedTask.projectName}</span>
                  <span><Clock3 size={14} />Giao ngày {fmt(selectedTask.createdAt)}</span>
                  {selectedTask.repeatLabel ? (
                    <span><Repeat2 size={14} />{selectedTask.repeatLabel}</span>
                  ) : null}
                </div>
                {selectedTask.context ? (
                  <p className={styles.parentTaskContext}>{selectedTask.context}</p>
                ) : null}
                {selectedTask.kind === "recurring" && selectedTask.repeatEnabled && selectedTask.canReview ? (
                  <div className={styles.recurrenceNotice}>
                    <div>
                      <strong>Lịch lặp đang hoạt động</strong>
                      <span>Mỗi kỳ sẽ tạo một công việc mới, không ghi đè lịch sử cũ.</span>
                    </div>
                    <Button
                      onClick={() =>
                        runMutation(() =>
                          stopTodoRecurrenceAction({ taskId: selectedTask.id }),
                        )
                      }
                      size="sm"
                      variant="secondary"
                    >
                      Dừng lặp
                    </Button>
                  </div>
                ) : null}

                <div className={styles.detailOutputList}>
                  {selectedTask.outputs.map((output, index) => {
                    const expanded = expandedOutputIds.has(output.id);
                    const canReport =
                      output.assignedToMe &&
                      ["OPEN", "IN_PROGRESS", "RETURNED"].includes(output.status);
                    const canReview =
                      selectedTask.canReview && output.status === "WAITING_REVIEW";
                    return (
                      <article
                        className={styles.detailOutput}
                        data-tone={outputTone(output.status)}
                        key={output.id}
                      >
                        <div className={styles.detailOutputSummary}>
                          <span className={styles.detailOutputNumber}>{index + 1}</span>
                          <div className={styles.detailOutputTitle}>
                            <strong>{output.description}</strong>
                            <div>
                              <Badge tone={outputTone(output.status)}>
                                {outputStatusLabel(output.status)}
                              </Badge>
                              <span><Clock3 size={13} />{fmt(output.dueAt)}</span>
                              <span><UserRound size={13} />{output.assignee || "Chưa gán"}</span>
                            </div>
                          </div>
                          <button
                            aria-label={expanded ? "Thu gọn báo cáo" : "Xem báo cáo và thao tác"}
                            aria-pressed={expanded}
                            className={styles.outputExpandButton}
                            onClick={() => toggleOutputDetails(output.id)}
                            title={expanded ? "Thu gọn" : "Xem báo cáo và duyệt"}
                            type="button"
                          >
                            {expanded ? <Minus size={18} /> : <Plus size={18} />}
                          </button>
                        </div>

                        {expanded ? (
                          <div className={styles.detailOutputBody}>
                            <div className={styles.feedbackSectionHeading}>
                              <MessageSquareText size={15} />
                              <strong>Báo cáo &amp; phản hồi</strong>
                              <span>{output.feedbacks.length}</span>
                            </div>
                            {output.feedbacks.length ? (
                              <div className={styles.feedbackHistory}>
                                {output.feedbacks.map((feedback) => (
                                  <div className={styles.feedbackNote} key={feedback.id}>
                                    <div className={styles.feedbackAuthor}>
                                      <MessageSquareText size={13} />
                                      <strong>{feedback.actorName || "Thành viên"}</strong>
                                      <span>{fmt(feedback.createdAt)}</span>
                                    </div>
                                    <p>{feedback.report}</p>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className={styles.noFeedback}>Chưa có báo cáo cho đầu việc này.</div>
                            )}

                            {canReport ? (
                              <div className={styles.feedbackComposer}>
                                <Input
                                  onChange={(event) =>
                                    setFeedbackText((current) => ({
                                      ...current,
                                      [output.id]: event.target.value,
                                    }))
                                  }
                                  placeholder="Nhập kết quả đã thực hiện..."
                                  value={feedbackText[output.id] || ""}
                                />
                                <Button
                                  className={styles.submitFeedbackButton}
                                  disabled={!feedbackText[output.id]?.trim()}
                                  onClick={() =>
                                    runMutation(
                                      () =>
                                        submitTodoFeedbackAction({
                                          outputId: output.id,
                                          report: feedbackText[output.id] || "",
                                          taskId: selectedTask.id,
                                        }),
                                      () =>
                                        setFeedbackText((current) => ({
                                          ...current,
                                          [output.id]: "",
                                        })),
                                    )
                                  }
                                  size="sm"
                                >
                                  <Send size={15} />Gửi để duyệt
                                </Button>
                              </div>
                            ) : null}

                            {canReview ? (
                              <div className={styles.reviewPanel}>
                                <Input
                                  onChange={(event) =>
                                    setReviewText((current) => ({
                                      ...current,
                                      [output.id]: event.target.value,
                                    }))
                                  }
                                  placeholder="Ghi chú duyệt hoặc lý do trả bổ sung"
                                  value={reviewText[output.id] || ""}
                                />
                                <div className={styles.reviewActions}>
                                  <Button
                                    onClick={() =>
                                      runMutation(() =>
                                        reviewTodoOutputAction({
                                          comment: reviewText[output.id] || "",
                                          decision: "approve",
                                          outputId: output.id,
                                          taskId: selectedTask.id,
                                        }),
                                      )
                                    }
                                    size="sm"
                                  >
                                    <CheckCircle2 size={15} />Duyệt kết quả
                                  </Button>
                                  <Button
                                    onClick={() =>
                                      runMutation(() =>
                                        reviewTodoOutputAction({
                                          comment: reviewText[output.id] || "",
                                          decision: "return",
                                          outputId: output.id,
                                          taskId: selectedTask.id,
                                        }),
                                      )
                                    }
                                    size="sm"
                                    variant="secondary"
                                  >
                                    Trả bổ sung
                                  </Button>
                                </div>
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </section>
        </div>
      ) : null}

      {selectedTask && deleteConfirmOpen ? (
        <div
          className={styles.deleteConfirmBackdrop}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setDeleteConfirmOpen(false);
          }}
          role="presentation"
        >
          <section
            aria-labelledby="todo-delete-title"
            aria-modal="true"
            className={styles.deleteConfirmDialog}
            role="alertdialog"
          >
            <div className={styles.deleteConfirmIcon} aria-hidden="true">
              <Trash2 size={22} />
            </div>
            <div className={styles.deleteConfirmCopy}>
              <h3 id="todo-delete-title">Xóa vĩnh viễn công việc?</h3>
              <p>
                “{selectedTask.title}” cùng toàn bộ đầu việc, báo cáo và lịch sử duyệt
                sẽ bị xóa khỏi PostgreSQL. Thao tác này không thể hoàn tác.
              </p>
              {selectedTask.kind === "recurring" && selectedTask.repeatEnabled ? (
                <strong>Lịch lặp của công việc này cũng sẽ dừng.</strong>
              ) : null}
            </div>
            <div className={styles.deleteConfirmActions}>
              <Button
                autoFocus
                onClick={() => setDeleteConfirmOpen(false)}
                size="sm"
                variant="secondary"
              >
                Giữ lại
              </Button>
              <Button
                onClick={() => {
                  setDeleteConfirmOpen(false);
                  runMutation(
                    () => deleteTodoTaskAction({ taskId: selectedTask.id }),
                    () => setSelectedTaskId(null),
                    {
                      error: "Không thể xóa công việc",
                      success: "Đã xóa giao việc",
                    },
                  );
                }}
                size="sm"
                variant="danger"
              >
                <Trash2 size={15} />Xóa vĩnh viễn
              </Button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
