"use client";

import {
  Archive,
  Bell,
  Check,
  FileCheck2,
  History,
  LoaderCircle,
  LockOpen,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Stamp,
  UploadCloud,
  X,
} from "lucide-react";
import {
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { Button, FilePicker, Input, Select } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import {
  buildLegalDossierStorageName,
} from "@/lib/admin-tools/storage-name";
import type {
  LegalDossierQueueData,
  LegalDossierQueueItem,
  LockedCorrectionUser,
} from "@/lib/admin-tools/legal-dossier";

import {
  cancelDossierCorrectionAction,
  finalizeDossierUploadAction,
  refreshCorrectionQueueAction,
  requestDossierFollowUpAction,
  unlockCorrectionEmployeeAction,
  updateCorrectionSourceItemAction,
  uploadDossierFileAction,
} from "./actions";

type OfficeFilter = "" | "q12" | "thanh-cong";
type Draft = {
  documentNumber: string;
  storageCounterparty: string;
  storageIssuedDate: string;
  storageRevision: string;
  storageSummary: string;
};
type SourceEditDraft = {
  companyName: string;
  documentName: string;
  documentTypeName: string;
  partner: string;
  shortName: string;
  signedDate: string;
  stampTypes: string[];
};
type UploadState = {
  error?: string;
  file: File;
  status: "queued" | "running" | "done" | "failed";
};

const textareaClass =
  "min-h-24 w-full resize-y rounded-2xl border border-border bg-surface px-4 py-3 text-sm text-foreground outline-none transition placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:bg-surface-muted";
const SEAL_STAMP_OPTIONS = [
  "Đóng chính",
  "Giáp lai",
  "Dấu treo",
  "Sao y",
  "Ký điện tử",
];

function emptyDraft(item?: LegalDossierQueueItem | null): Draft {
  return {
    documentNumber: item?.documentNumber || "",
    storageCounterparty:
      item?.storageCounterparty || item?.partner || "",
    storageIssuedDate: item?.storageIssuedDate || "",
    storageRevision: item?.storageRevision || "",
    storageSummary: item?.storageSummary || item?.detail || "",
  };
}

function emptySourceEditDraft(
  item?: LegalDossierQueueItem | null,
): SourceEditDraft {
  return {
    companyName: item?.companyName || item?.companyShortName || "",
    documentName: item?.sourceDocumentName || item?.generatedStorageName || "",
    documentTypeName: item?.documentTypeName || "",
    partner:
      item?.storageCounterparty || item?.partner || item?.detail || "",
    shortName: item?.sourceShortName || "",
    signedDate: item?.storageIssuedDate || "",
    stampTypes: item?.sourceStampTypes || [],
  };
}

function fmtDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function normalizeSearchText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/đ/gi, "d")
    .toLocaleLowerCase("vi-VN")
    .replace(/\s+/g, " ")
    .trim();
}

function dossierMatchesSearch(
  item: LegalDossierQueueItem,
  normalizedQuery: string,
) {
  if (!normalizedQuery) return true;
  return normalizeSearchText(
    [
      item.requestCode,
      item.requestTitle,
      item.itemIndex,
      item.generatedStorageName,
      item.documentNumber,
      item.documentTypeName,
      item.companyName,
      item.companyShortName,
      item.creatorName,
      item.partner,
      item.detail,
      item.storageCounterparty,
      item.storageSummary,
      item.officeLabel,
    ].join(" "),
  ).includes(normalizedQuery);
}

function Field({
  children,
  label,
  required,
}: {
  children: ReactNode;
  label: string;
  required?: boolean;
}) {
  return (
    <label className="grid gap-2 text-sm font-bold text-primary">
      <span>
        {label}
        {required ? <span className="ml-1 text-accent">*</span> : null}
      </span>
      {children}
    </label>
  );
}

function Meta({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-border/80 bg-surface-muted/70 px-3 py-2.5">
      <div className="text-[10px] font-extrabold uppercase tracking-[0.08em] text-muted">
        {label}
      </div>
      <div className="mt-1 truncate text-sm font-bold text-primary" title={value}>
        {value || "—"}
      </div>
    </div>
  );
}

function Dialog({
  children,
  onClose,
  title,
  wide = false,
}: {
  children: ReactNode;
  onClose: () => void;
  title: string;
  wide?: boolean;
}) {
  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-[170] grid place-items-center bg-[rgba(7,24,21,0.52)] p-4 backdrop-blur-[3px]"
      role="dialog"
    >
      <section
        className={`max-h-[calc(100dvh-2rem)] w-full overflow-y-auto rounded-3xl border border-border bg-surface p-5 shadow-[0_28px_80px_rgba(7,24,21,0.3)] ${
          wide ? "max-w-6xl" : "max-w-lg"
        }`}
      >
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-xl font-extrabold text-primary">{title}</h2>
          <button
            aria-label="Đóng"
            className="ui-icon-button"
            onClick={onClose}
            type="button"
          >
            <X aria-hidden size={18} />
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </section>
    </div>
  );
}

function QueueCard({
  active,
  item,
  onCancel,
  onFollowUp,
  onSelect,
}: {
  active: boolean;
  item: LegalDossierQueueItem;
  onCancel: () => void;
  onFollowUp?: () => void;
  onSelect: () => void;
}) {
  const office = item.officeLabel || "Chưa xác định khu vực";
  return (
    <article
      className={`rounded-xl border bg-surface p-3.5 transition ${
        active
          ? "border-accent shadow-[0_10px_24px_var(--brand-shadow-soft)]"
          : "border-border hover:border-primary/25 hover:shadow-[0_10px_22px_rgba(17,45,39,0.07)]"
      }`}
    >
      <div className="flex items-start gap-3">
        <button
          aria-label="Chọn hồ sơ"
          className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg border transition ${
            active
              ? "border-accent bg-accent text-white"
              : "border-border bg-surface-muted text-primary hover:border-accent hover:text-accent"
          }`}
          onClick={onSelect}
          type="button"
        >
          {active ? <Check aria-hidden size={16} /> : <Plus aria-hidden size={16} />}
        </button>
        <button
          className="min-w-0 flex-1 text-left"
          onClick={onSelect}
          type="button"
        >
          <div className="line-clamp-2 text-sm font-extrabold leading-5 text-primary">
            {item.documentTypeName || item.requestTitle}
          </div>
          <div className="mt-1 text-xs text-muted">
            {item.requestCode} · Dòng {item.itemIndex} · {fmtDate(item.createdAt)}
          </div>
        </button>
        <div className="flex shrink-0 items-center gap-1">
          {onFollowUp ? (
            <button
              aria-label="Yêu cầu nộp lại bản ký"
              className={`ui-icon-button size-8 ${
                item.followUpPending ? "border-accent bg-accent-soft text-accent" : ""
              }`}
              onClick={onFollowUp}
              title="Yêu cầu hậu kiểm"
              type="button"
            >
              <Bell aria-hidden size={15} />
            </button>
          ) : null}
          <button
            aria-label="Hủy Hiệu đính"
            className="ui-icon-button size-8 text-danger"
            onClick={onCancel}
            title="Hủy Hiệu đính"
            type="button"
          >
            <X aria-hidden size={15} />
          </button>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <span className="ui-chip">{item.companyShortName || item.companyName || "Chưa rõ công ty"}</span>
        <span className="ui-chip">{office}</span>
        {item.kind === "seal" ? (
          <span className="ui-chip">Cần scan</span>
        ) : (
          <span className="ui-chip">Lưu trữ</span>
        )}
        {item.fileCount ? (
          <span className="ui-chip">{item.fileCount} tệp đã nạp</span>
        ) : null}
        {item.followUpPending ? (
          <span className="ui-chip border-accent/30 bg-accent-soft text-accent">
            Đang hậu kiểm
          </span>
        ) : null}
      </div>
      {item.partner || item.detail ? (
        <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted">
          {[item.partner, item.detail].filter(Boolean).join(" · ")}
        </p>
      ) : null}
    </article>
  );
}

function QueueColumn({
  activeId,
  emptyText,
  icon,
  items,
  onCancel,
  onFollowUp,
  onSelect,
  title,
}: {
  activeId: string;
  emptyText: string;
  icon: ReactNode;
  items: LegalDossierQueueItem[];
  onCancel: (item: LegalDossierQueueItem) => void;
  onFollowUp?: (item: LegalDossierQueueItem) => void;
  onSelect: (id: string) => void;
  title: string;
}) {
  return (
    <section className="flex min-h-[380px] flex-col rounded-2xl border border-border bg-surface-muted/45">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded-lg bg-primary text-white">
            {icon}
          </span>
          <h2 className="text-sm font-extrabold text-primary">{title}</h2>
        </div>
        <span className="ui-badge">{items.length}</span>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-auto p-3 xl:max-h-[560px]">
        {items.length ? (
          items.map((item) => (
            <QueueCard
              active={item.id === activeId}
              item={item}
              key={item.id}
              onCancel={() => onCancel(item)}
              onFollowUp={
                onFollowUp ? () => onFollowUp(item) : undefined
              }
              onSelect={() => onSelect(item.id)}
            />
          ))
        ) : (
          <div className="grid min-h-48 place-items-center rounded-xl border border-dashed border-border bg-surface px-6 text-center text-sm leading-6 text-muted">
            {emptyText}
          </div>
        )}
      </div>
    </section>
  );
}

export function CorrectionWorkspace({
  initialData,
}: {
  initialData: LegalDossierQueueData;
}) {
  const { toast } = useToast();
  const [data, setData] = useState(initialData);
  const [selectedLockedUserId, setSelectedLockedUserId] = useState(
    initialData.lockedUsers[0]?.userId || "",
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [officeFilter, setOfficeFilter] = useState<OfficeFilter>("");
  const [activeId, setActiveId] = useState(
    initialData.sealItems[0]?.id || initialData.storageItems[0]?.id || "",
  );
  const [editorOpen, setEditorOpen] = useState(false);
  const [sourceEditOpen, setSourceEditOpen] = useState(false);
  const allItems = useMemo(
    () => [...data.sealItems, ...data.storageItems],
    [data],
  );
  const activeItem = useMemo(
    () => allItems.find((item) => item.id === activeId) || null,
    [activeId, allItems],
  );
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(activeItem));
  const [sourceEditDraft, setSourceEditDraft] = useState<SourceEditDraft>(() =>
    emptySourceEditDraft(activeItem),
  );
  const [files, setFiles] = useState<File[]>([]);
  const [uploads, setUploads] = useState<UploadState[]>([]);
  const [pickerKey, setPickerKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [followUpItem, setFollowUpItem] =
    useState<LegalDossierQueueItem | null>(null);
  const [followUpReason, setFollowUpReason] = useState(
    "Hồ sơ đã hoàn thành nhưng Hành chính vẫn cần bạn nộp lại 01 bản ký đủ chữ ký để lưu.",
  );
  const [cancelItem, setCancelItem] =
    useState<LegalDossierQueueItem | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelPassword, setCancelPassword] = useState("");
  const [unlockUser, setUnlockUser] =
    useState<LockedCorrectionUser | null>(null);
  const [unlockReason, setUnlockReason] = useState(
    "Đã kiểm tra và cho phép nhân viên tiếp tục đăng ký đóng dấu.",
  );
  const selectedLockedUser = useMemo(
    () =>
      data.lockedUsers.find((item) => item.userId === selectedLockedUserId) ||
      null,
    [data.lockedUsers, selectedLockedUserId],
  );
  const normalizedSearchQuery = useMemo(
    () => normalizeSearchText(searchQuery),
    [searchQuery],
  );

  const filteredSeal = useMemo(
    () =>
      data.sealItems.filter(
        (item) =>
          (!officeFilter || item.officeKey === officeFilter) &&
          dossierMatchesSearch(item, normalizedSearchQuery),
      ),
    [data.sealItems, normalizedSearchQuery, officeFilter],
  );
  const filteredStorage = useMemo(
    () =>
      data.storageItems.filter(
        (item) =>
          (!officeFilter || item.officeKey === officeFilter) &&
          dossierMatchesSearch(item, normalizedSearchQuery),
      ),
    [data.storageItems, normalizedSearchQuery, officeFilter],
  );
  const generatedName = useMemo(() => {
    if (!activeItem) return "";
    if (activeItem.kind === "storage") {
      return (
        activeItem.generatedStorageName ||
        buildLegalDossierStorageName({
          companyName: activeItem.companyName,
          companyShortName: activeItem.companyShortName,
          counterparty: draft.storageCounterparty,
          documentTypeName: activeItem.documentTypeName,
          issuedDate: draft.storageIssuedDate,
          revision: draft.storageRevision,
          summary: draft.storageSummary,
        })
      );
    }
    return buildLegalDossierStorageName({
      companyName: activeItem.companyName,
      companyShortName: activeItem.companyShortName,
      counterparty: draft.storageCounterparty,
      documentTypeName: activeItem.documentTypeName,
      issuedDate: draft.storageIssuedDate,
      revision: draft.storageRevision,
      summary: draft.storageSummary,
    });
  }, [activeItem, draft]);

  async function refresh(showToast = true) {
    setRefreshing(true);
    const result = await refreshCorrectionQueueAction();
    setRefreshing(false);
    if (!result.ok || !result.data) {
      toast({
        message: result.message,
        title: "Không làm mới được",
        tone: "error",
      });
      return;
    }
    const refreshedData = result.data;
    const nextItems = [
      ...refreshedData.sealItems,
      ...refreshedData.storageItems,
    ];
    const nextActive =
      nextItems.find((item) => item.id === activeId) || nextItems[0] || null;
    setData(refreshedData);
    setSelectedLockedUserId((current) =>
      refreshedData.lockedUsers.some((item) => item.userId === current)
        ? current
        : refreshedData.lockedUsers[0]?.userId || "",
    );
    if (nextActive?.id !== activeId) {
      setSourceEditOpen(false);
      setEditorOpen(false);
      setActiveId(nextActive?.id || "");
      setDraft(emptyDraft(nextActive));
      setFiles([]);
      setUploads([]);
      setPickerKey((value) => value + 1);
    }
    if (showToast) {
      toast({
        message: result.message,
        title: "Hàng đợi đã cập nhật",
        tone: "success",
      });
    }
  }

  function selectItem(id: string) {
    const item = allItems.find((candidate) => candidate.id === id) || null;
    setSourceEditOpen(false);
    setActiveId(id);
    setDraft(emptyDraft(item));
    setFiles([]);
    setUploads([]);
    setPickerKey((value) => value + 1);
    setEditorOpen(true);
  }

  function openSourceEditor() {
    if (!activeItem) return;
    setSourceEditDraft(emptySourceEditDraft(activeItem));
    setSourceEditOpen(true);
  }

  function resetSourceDocumentName() {
    if (!activeItem) return;
    const company = data.companyOptions.find(
      (option) =>
        normalizeSearchText(option.label) ===
        normalizeSearchText(sourceEditDraft.companyName),
    );
    const suggestedName = buildLegalDossierStorageName({
      companyName: sourceEditDraft.companyName,
      companyShortName: company?.shortName || activeItem.companyShortName,
      counterparty: sourceEditDraft.partner,
      documentTypeName: sourceEditDraft.documentTypeName,
      issuedDate: sourceEditDraft.signedDate,
      revision: draft.storageRevision,
      summary: draft.storageSummary || activeItem.detail,
    });
    setSourceEditDraft((current) => ({
      ...current,
      documentName: suggestedName || current.documentName,
    }));
  }

  async function saveSourceEdit() {
    if (!activeItem || busy) return;
    const edit = sourceEditDraft;
    setBusy(true);
    const result = await updateCorrectionSourceItemAction({
      companyName: edit.companyName,
      dossierId: activeItem.id,
      documentName: edit.documentName,
      documentTypeName: edit.documentTypeName,
      partner: edit.partner,
      shortName: edit.shortName,
      signedDate: edit.signedDate,
      stampTypes: edit.stampTypes,
    });
    setBusy(false);
    toast({
      message: result.message,
      title: result.ok ? "Đã sửa hồ sơ" : "Không sửa được hồ sơ",
      tone: result.ok ? "success" : "error",
    });
    if (!result.ok) return;
    setSourceEditOpen(false);
    if (activeItem.kind === "seal") {
      setDraft((current) => ({
        ...current,
        storageCounterparty: edit.partner,
        storageIssuedDate: edit.signedDate,
      }));
    }
    await refresh(false);
  }

  function formDataFor(item: LegalDossierQueueItem) {
    const formData = new FormData();
    formData.set("dossierId", item.id);
    formData.set("documentNumber", draft.documentNumber);
    formData.set("storageCounterparty", draft.storageCounterparty);
    formData.set("storageIssuedDate", draft.storageIssuedDate);
    formData.set("storageRevision", draft.storageRevision);
    formData.set("storageSummary", draft.storageSummary);
    return formData;
  }

  async function save() {
    if (!activeItem || busy) return;
    if (activeItem.kind === "seal") {
      if (!draft.storageSummary.trim()) {
        toast({
          message: "Vui lòng nhập Nội dung hồ sơ.",
          title: "Chưa đủ thông tin",
          tone: "warning",
        });
        return;
      }
      if (!draft.storageIssuedDate) {
        toast({
          message: "Vui lòng chọn Ngày ký/ban hành.",
          title: "Chưa đủ thông tin",
          tone: "warning",
        });
        return;
      }
      if (
        activeItem.needsCounterparty &&
        !draft.storageCounterparty.trim()
      ) {
        toast({
          message: "Loại hồ sơ này bắt buộc nhập Đối tượng ký kết.",
          title: "Chưa đủ thông tin",
          tone: "warning",
        });
        return;
      }
    }
    if (!files.length && !activeItem.fileCount) {
      toast({
        message: "Vui lòng chọn ít nhất 1 tệp để lưu.",
        title: "Chưa chọn tệp",
        tone: "warning",
      });
      return;
    }

    setBusy(true);
    setUploads(
      files.map((file) => ({ file, status: "queued" as const })),
    );
    if (files.length) {
      toast({
        message: `Bắt đầu nạp tuần tự ${files.length} tệp; ông vẫn theo dõi được từng tệp ngay tại đây.`,
        title: "Đang nạp hồ sơ",
        tone: "info",
      });
    }
    let failed = 0;
    for (let index = 0; index < files.length; index += 1) {
      setUploads((current) =>
        current.map((upload, uploadIndex) =>
          uploadIndex === index ? { ...upload, status: "running" } : upload,
        ),
      );
      const formData = formDataFor(activeItem);
      formData.set("batchSize", String(files.length));
      formData.set("file", files[index]);
      const result = await uploadDossierFileAction(formData);
      if (result.ok) {
        setUploads((current) =>
          current.map((upload, uploadIndex) =>
            uploadIndex === index ? { ...upload, status: "done" } : upload,
          ),
        );
      } else {
        failed += 1;
        setUploads((current) =>
          current.map((upload, uploadIndex) =>
            uploadIndex === index
              ? { ...upload, error: result.message, status: "failed" }
              : upload,
          ),
        );
      }
    }

    if (!failed) {
      const result = await finalizeDossierUploadAction(
        formDataFor(activeItem),
      );
      if (result.ok) {
        toast({
          message: result.message,
          title: "Đã lưu hồ sơ",
          tone: "success",
        });
        setFiles([]);
        setPickerKey((value) => value + 1);
        setEditorOpen(false);
        await refresh(false);
      } else {
        toast({
          message: result.message,
          title: "Tệp đã nạp nhưng chưa thể hoàn tất",
          tone: "error",
        });
        await refresh(false);
      }
    } else {
      toast({
        message: `${files.length - failed}/${files.length} tệp đã nạp. Hồ sơ vẫn nằm trong hàng đợi để ông nạp lại tệp lỗi.`,
        title: "Nạp tệp chưa trọn vẹn",
        tone: "warning",
      });
      await refresh(false);
    }
    setBusy(false);
  }

  async function submitFollowUp() {
    if (!followUpItem || busy) return;
    setBusy(true);
    const result = await requestDossierFollowUpAction({
      dossierId: followUpItem.id,
      reason: followUpReason,
    });
    setBusy(false);
    toast({
      message: result.message,
      title: result.ok ? "Đã gửi hậu kiểm" : "Không gửi được hậu kiểm",
      tone: result.ok ? "success" : "error",
    });
    if (result.ok) {
      setFollowUpItem(null);
      await refresh(false);
    }
  }

  async function submitCancel() {
    if (!cancelItem || busy) return;
    setBusy(true);
    const result = await cancelDossierCorrectionAction({
      dossierId: cancelItem.id,
      password: cancelPassword,
      reason: cancelReason,
    });
    setBusy(false);
    toast({
      message: result.message,
      title: result.ok ? "Đã hủy Hiệu đính" : "Không thể hủy",
      tone: result.ok ? "success" : "error",
    });
    if (result.ok) {
      setCancelItem(null);
      setCancelPassword("");
      setCancelReason("");
      await refresh(false);
    }
  }

  async function submitUnlock() {
    if (!unlockUser || busy) return;
    setBusy(true);
    const result = await unlockCorrectionEmployeeAction({
      reason: unlockReason,
      targetUserId: unlockUser.userId,
    });
    setBusy(false);
    toast({
      message: result.message,
      title: result.ok ? "Đã mở khóa nhân viên" : "Không thể mở khóa",
      tone: result.ok ? "success" : "error",
    });
    if (result.ok) {
      setUnlockUser(null);
      setUnlockReason(
        "Đã kiểm tra và cho phép nhân viên tiếp tục đăng ký đóng dấu.",
      );
      await refresh(false);
    }
  }

  return (
    <>
      <section className="ui-module-panel overflow-hidden">
        <div className="flex justify-end border-b border-border bg-surface-muted/55 px-4 py-3">
            <Button
              disabled={refreshing || busy}
              onClick={() => refresh()}
              size="sm"
              type="button"
              variant="secondary"
            >
              <RefreshCw
                aria-hidden
                className={refreshing ? "animate-spin" : ""}
                size={16}
              />
              Làm mới
            </Button>
        </div>

        <div className="p-4 sm:p-5">
          <div className="mb-4 rounded-xl border border-accent/25 bg-accent-soft p-3.5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent text-white">
                  <LockOpen aria-hidden size={18} />
                </span>
                <div>
                  <h2 className="text-sm font-extrabold text-primary">
                    Mở khóa đăng ký đóng dấu
                  </h2>
                  <p className="mt-1 text-xs leading-5 text-muted">
                    Danh sách chỉ hiển thị nhân viên đang có yêu cầu hậu kiểm
                    chặn chức năng. Nghĩa vụ hậu kiểm vẫn được giữ sau khi mở.
                  </p>
                </div>
              </div>
              <span className="ui-badge border-accent/30 bg-surface text-accent">
                {data.lockedUsers.length} nhân viên bị chặn
              </span>
            </div>

            {data.lockedUsers.length ? (
              <div className="mt-3 grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
                <Select
                  aria-label="Chọn nhân viên đang bị chặn"
                  className="h-10 bg-surface"
                  disabled={busy}
                  onChange={(event) =>
                    setSelectedLockedUserId(event.target.value)
                  }
                  value={selectedLockedUserId}
                >
                  {data.lockedUsers.map((item) => (
                    <option key={item.userId} value={item.userId}>
                      {item.fullName}
                      {item.employeeCode ? ` · ${item.employeeCode}` : ""} · {item.pendingCount} yêu cầu
                    </option>
                  ))}
                </Select>
                <Button
                  disabled={busy || !selectedLockedUser}
                  onClick={() => selectedLockedUser && setUnlockUser(selectedLockedUser)}
                  size="sm"
                  type="button"
                >
                  <LockOpen aria-hidden size={16} />
                  Mở khóa nhân viên
                </Button>
              </div>
            ) : (
              <div className="mt-3 rounded-lg border border-border/70 bg-surface px-3 py-2 text-sm font-semibold text-muted">
                Hiện không có nhân viên nào bị hậu kiểm chặn chức năng.
              </div>
            )}

            {selectedLockedUser?.reasons[0] ? (
              <p className="mt-2 text-xs leading-5 text-muted">
                <strong className="text-primary">Yêu cầu gần nhất:</strong>{" "}
                {selectedLockedUser.reasons[0]}
              </p>
            ) : null}
          </div>

          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface-muted/55 p-2.5">
            <label className="relative min-w-[240px] flex-1">
              <span className="sr-only">Tìm hồ sơ Hiệu đính</span>
              <Search
                aria-hidden
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
                size={17}
              />
              <Input
                aria-label="Tìm hồ sơ Hiệu đính"
                className="h-10 bg-surface pl-10 pr-10"
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Tìm mã đơn, tên hồ sơ, công ty, người tạo, đối tác..."
                value={searchQuery}
              />
              {searchQuery ? (
                <button
                  aria-label="Xóa nội dung tìm kiếm"
                  className="ui-icon-button absolute right-1.5 top-1/2 size-7 -translate-y-1/2 border-0 bg-transparent"
                  onClick={() => setSearchQuery("")}
                  title="Xóa tìm kiếm"
                  type="button"
                >
                  <X aria-hidden size={14} />
                </button>
              ) : null}
            </label>
            <span className="px-2 text-xs font-semibold text-muted">
              Tìm thấy {filteredSeal.length + filteredStorage.length} hồ sơ
            </span>
          </div>

          <div
            aria-label="Lọc theo khu vực nộp"
            className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface-muted/55 p-2.5"
            role="group"
          >
            <span className="px-2 text-xs font-extrabold uppercase tracking-[0.08em] text-muted">
              Khu vực nộp
            </span>
            {(
              [
                ["", "Tất cả"],
                ["q12", "Văn phòng Q12"],
                ["thanh-cong", "Văn phòng Thành Công"],
              ] as const
            ).map(([key, label]) => (
              <button
                className={`rounded-full border px-3 py-1.5 text-xs font-bold transition ${
                  officeFilter === key
                    ? "border-accent bg-accent text-white"
                    : "border-border bg-surface text-primary hover:border-accent/50"
                }`}
                key={key || "all"}
                onClick={() => setOfficeFilter(key)}
                type="button"
              >
                {label}
              </button>
            ))}
            <span className="ml-auto px-2 text-xs font-semibold text-muted">
              {filteredSeal.length + filteredStorage.length} hồ sơ
            </span>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <QueueColumn
              activeId={activeId}
              emptyText={
                normalizedSearchQuery
                  ? `Không tìm thấy hồ sơ Đóng dấu phù hợp với “${searchQuery.trim()}”.`
                  : "Không có hồ sơ Đóng dấu nào đang chờ scan ở khu vực này."
              }
              icon={<Stamp aria-hidden size={17} />}
              items={filteredSeal}
              onCancel={setCancelItem}
              onFollowUp={setFollowUpItem}
              onSelect={selectItem}
              title="Hồ sơ cần scan"
            />
            <QueueColumn
              activeId={activeId}
              emptyText={
                normalizedSearchQuery
                  ? `Không tìm thấy hồ sơ Lưu trữ phù hợp với “${searchQuery.trim()}”.`
                  : "Không có hồ sơ Lưu trữ nào đang chờ nạp file ở khu vực này."
              }
              icon={<Archive aria-hidden size={17} />}
              items={filteredStorage}
              onCancel={setCancelItem}
              onSelect={selectItem}
              title="Hồ sơ chờ nạp file"
            />
          </div>
        </div>
      </section>

      {editorOpen ? (
        <Dialog
          onClose={() => {
            if (busy) return;
            setSourceEditOpen(false);
            setEditorOpen(false);
          }}
          title={
            activeItem
              ? `Hiệu đính hồ sơ · ${activeItem.requestCode}`
              : "Hiệu đính hồ sơ"
          }
          wide
        >
          <section className="p-1">
        {activeItem ? (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="ui-badge">
                    {activeItem.kind === "seal" ? "Đóng dấu" : "Lưu trữ"}
                  </span>
                  <span className="ui-pill">{activeItem.requestCode}</span>
                  {activeItem.followUpPending ? (
                    <span className="ui-badge border-accent/30 bg-accent-soft text-accent">
                      Đang hậu kiểm
                    </span>
                  ) : null}
                </div>
                <h2 className="mt-2 text-xl font-extrabold text-primary">
                  {activeItem.documentTypeName || activeItem.requestTitle}
                </h2>
                <p className="mt-1 text-sm text-muted">
                  Người tạo: {activeItem.creatorName} · {fmtDate(activeItem.createdAt)}
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Button
                  disabled={busy}
                  onClick={openSourceEditor}
                  size="sm"
                  type="button"
                  variant="secondary"
                >
                  <Pencil aria-hidden size={16} />
                  Sửa hồ sơ
                </Button>
                <Button
                  disabled={busy}
                  onClick={() => {
                    setDraft(emptyDraft(activeItem));
                    setFiles([]);
                    setUploads([]);
                    setPickerKey((value) => value + 1);
                  }}
                  size="sm"
                  type="button"
                  variant="secondary"
                >
                  <RotateCcw aria-hidden size={16} />
                  Đặt lại
                </Button>
              </div>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              <Meta
                label="Dịch vụ"
                value={
                  activeItem.kind === "seal"
                    ? "Đóng dấu & Ký số"
                    : "Trích lục / Lưu trữ"
                }
              />
              <Meta
                label="Công ty"
                value={activeItem.companyName || activeItem.companyShortName}
              />
              <Meta label="Loại hồ sơ" value={activeItem.documentTypeName} />
              <Meta label="Mã đơn" value={activeItem.requestCode} />
              <Meta
                label="Khu vực nộp"
                value={activeItem.officeLabel || "Chưa xác định"}
              />
            </div>

            <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(300px,0.72fr)]">
              <div className="grid gap-4">
                {activeItem.kind === "seal" ? (
                  <>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field
                        label="Đối tượng ký kết"
                        required={activeItem.needsCounterparty}
                      >
                        <Input
                          disabled={busy}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              storageCounterparty: event.target.value,
                            }))
                          }
                          placeholder="Tên đối tác / bên ký kết"
                          value={draft.storageCounterparty}
                        />
                      </Field>
                      <Field label="Ngày ký/ban hành" required>
                        <Input
                          disabled={busy}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              storageIssuedDate: event.target.value,
                            }))
                          }
                          type="date"
                          value={draft.storageIssuedDate}
                        />
                      </Field>
                    </div>
                    <Field label="Nội dung hồ sơ" required>
                      <textarea
                        className={textareaClass}
                        disabled={busy}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            storageSummary: event.target.value,
                          }))
                        }
                        placeholder="Nội dung tóm tắt dùng để đặt tên hồ sơ"
                        value={draft.storageSummary}
                      />
                    </Field>
                    <Field label="Lần sửa">
                      <Input
                        disabled={busy}
                        min={1}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            storageRevision: event.target.value,
                          }))
                        }
                        placeholder="Nếu có"
                        type="number"
                        value={draft.storageRevision}
                      />
                    </Field>
                  </>
                ) : (
                  <>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="Công ty">
                        <Input
                          disabled
                          value={
                            activeItem.companyName ||
                            activeItem.companyShortName
                          }
                        />
                      </Field>
                      <Field label="Loại hồ sơ">
                        <Input disabled value={activeItem.documentTypeName} />
                      </Field>
                    </div>
                    <Field label="Số văn bản">
                      <Input
                        disabled={
                          busy ||
                          Boolean(activeItem.documentNumber) ||
                          !activeItem.takesNumber
                        }
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            documentNumber: event.target.value,
                          }))
                        }
                        placeholder={
                          activeItem.takesNumber
                            ? "Để trống để hệ thống tự cấp số"
                            : "Loại hồ sơ này không lấy số"
                        }
                        value={draft.documentNumber}
                      />
                    </Field>
                  </>
                )}

                <Field label="Tên hồ sơ lưu">
                  <textarea
                    className={`${textareaClass} min-h-20 font-semibold text-primary`}
                    disabled
                    value={generatedName}
                  />
                </Field>

                <Field label="Tệp scan / hồ sơ lưu">
                  <FilePicker
                    accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.webp"
                    disabled={busy}
                    emptyText={
                      activeItem.fileCount
                        ? `${activeItem.fileCount} tệp đã nạp; có thể nạp thêm hoặc hoàn tất.`
                        : "Chưa chọn tệp nào."
                    }
                    key={pickerKey}
                    maxFileSizeBytes={8 * 1024 * 1024}
                    maxFiles={8}
                    multiple
                    onFilesChange={setFiles}
                    triggerLabel="Chọn nhiều tệp"
                  />
                </Field>

                {uploads.length ? (
                  <div className="space-y-2 rounded-xl border border-border bg-surface-muted/55 p-3">
                    <div className="text-xs font-extrabold uppercase tracking-[0.08em] text-muted">
                      Hàng đợi tải lên
                    </div>
                    {uploads.map((upload, index) => (
                      <div
                        className="flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2"
                        key={`${upload.file.name}-${index}`}
                      >
                        <span
                          className={`grid size-7 shrink-0 place-items-center rounded-full ${
                            upload.status === "done"
                              ? "bg-[#e8f8f1] text-[#0c6e4c]"
                              : upload.status === "failed"
                                ? "bg-[#fdeeee] text-danger"
                                : "bg-accent-soft text-accent"
                          }`}
                        >
                          {upload.status === "running" ? (
                            <LoaderCircle
                              aria-hidden
                              className="animate-spin"
                              size={15}
                            />
                          ) : upload.status === "done" ? (
                            <Check aria-hidden size={15} />
                          ) : upload.status === "failed" ? (
                            <X aria-hidden size={15} />
                          ) : (
                            <UploadCloud aria-hidden size={15} />
                          )}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-bold text-primary">
                            {upload.file.name}
                          </div>
                          <div className="text-xs text-muted">
                            {upload.error ||
                              (upload.status === "queued"
                                ? "Chờ tải"
                                : upload.status === "running"
                                  ? "Đang tải"
                                  : upload.status === "done"
                                    ? "Đã tải"
                                    : "Lỗi")}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}

                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Button
                    disabled={
                      busy ||
                      (!files.length && !activeItem.fileCount)
                    }
                    onClick={save}
                    type="button"
                  >
                    {busy ? (
                      <LoaderCircle
                        aria-hidden
                        className="animate-spin"
                        size={17}
                      />
                    ) : (
                      <FileCheck2 aria-hidden size={17} />
                    )}
                    {busy
                      ? "Đang xử lý..."
                      : files.length
                        ? "Lưu hồ sơ"
                        : "Hoàn tất hồ sơ"}
                  </Button>
                </div>
              </div>

              <aside className="rounded-2xl border border-border bg-surface-muted/45 p-4">
                <div className="flex items-center gap-2 text-sm font-extrabold text-primary">
                  <History aria-hidden size={17} />
                  Lịch sử hồ sơ
                </div>
                {activeItem.events.length ? (
                  <ol className="mt-4 space-y-3 border-l border-border pl-4">
                    {activeItem.events.map((event, index) => (
                      <li className="relative text-sm" key={`${event.createdAt}-${index}`}>
                        <span className="absolute -left-[21px] top-1 size-2.5 rounded-full border-2 border-surface bg-accent" />
                        <div className="font-bold text-primary">
                          {event.actorName}
                        </div>
                        <div className="mt-0.5 text-xs text-muted">
                          {fmtDate(event.createdAt)} · {event.type}
                        </div>
                        {event.note ? (
                          <p className="mt-1 text-xs leading-5 text-muted">
                            {event.note}
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="mt-4 text-sm leading-6 text-muted">
                    Chưa có sự kiện nào được ghi nhận.
                  </p>
                )}
                {activeItem.condition ? (
                  <div className="mt-5 rounded-xl border border-accent/20 bg-accent-soft p-3 text-xs leading-5 text-[#8b4d12]">
                    <strong>Điều kiện lưu:</strong> {activeItem.condition}
                  </div>
                ) : null}
              </aside>
            </div>
          </>
        ) : (
          <div className="grid min-h-64 place-items-center rounded-xl border border-dashed border-border bg-surface-muted/55 px-6 text-center">
            <div>
              <FileCheck2
                aria-hidden
                className="mx-auto text-muted"
                size={34}
              />
              <h2 className="mt-3 text-lg font-extrabold text-primary">
                Chọn một hồ sơ để Hiệu đính
              </h2>
              <p className="mt-1 text-sm text-muted">
                Bấm dấu cộng ở một trong hai hàng đợi phía trên.
              </p>
            </div>
          </div>
        )}
          </section>
        </Dialog>
      ) : null}

      {sourceEditOpen && activeItem ? (
        <Dialog
          onClose={() => !busy && setSourceEditOpen(false)}
          title={
            activeItem.kind === "seal"
              ? "Sửa hồ sơ đóng dấu"
              : "Sửa tên hồ sơ"
          }
          wide={activeItem.kind === "seal"}
        >
          <div className="rounded-xl border border-accent/20 bg-accent-soft p-3 text-sm leading-6 text-[#8b4d12]">
            Đang sửa dòng {activeItem.itemIndex} của đơn <strong>{activeItem.requestCode}</strong>.
            Thông tin lưu sẽ được đồng bộ lại vào Hiệu đính sau khi lưu.
          </div>

          {activeItem.kind === "seal" ? (
            <>
              <datalist id="correction-company-options">
                {data.companyOptions.map((option) => (
                  <option key={option.label} value={option.label} />
                ))}
              </datalist>
              <datalist id="correction-document-type-options">
                {data.documentTypeOptions.map((option) => (
                  <option key={option} value={option} />
                ))}
              </datalist>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Field label="Loại hồ sơ" required>
                  <Input
                    disabled={busy}
                    list="correction-document-type-options"
                    onChange={(event) =>
                      setSourceEditDraft((current) => ({
                        ...current,
                        documentTypeName: event.target.value,
                      }))
                    }
                    placeholder="Nhập hoặc chọn loại hồ sơ"
                    value={sourceEditDraft.documentTypeName}
                  />
                </Field>
                <Field label="Pháp nhân" required>
                  <Input
                    disabled={busy}
                    list="correction-company-options"
                    onChange={(event) =>
                      setSourceEditDraft((current) => ({
                        ...current,
                        companyName: event.target.value,
                      }))
                    }
                    placeholder="Nhập hoặc chọn pháp nhân"
                    value={sourceEditDraft.companyName}
                  />
                </Field>
                <Field label="Đối tác / Chi tiết" required>
                  <Input
                    disabled={busy}
                    onChange={(event) =>
                      setSourceEditDraft((current) => ({
                        ...current,
                        partner: event.target.value,
                      }))
                    }
                    placeholder="Nhập đối tác hoặc chi tiết"
                    value={sourceEditDraft.partner}
                  />
                </Field>
                <Field label="Tên viết tắt nếu có">
                  <Input
                    disabled={busy}
                    onChange={(event) =>
                      setSourceEditDraft((current) => ({
                        ...current,
                        shortName: event.target.value,
                      }))
                    }
                    placeholder="Dùng cho mẫu số có tên viết tắt"
                    value={sourceEditDraft.shortName}
                  />
                </Field>
                <Field label="Ngày ký" required>
                  <Input
                    disabled={busy}
                    onChange={(event) =>
                      setSourceEditDraft((current) => ({
                        ...current,
                        signedDate: event.target.value,
                      }))
                    }
                    type="date"
                    value={sourceEditDraft.signedDate}
                  />
                </Field>
              </div>
            </>
          ) : null}

          <div className="mt-4">
            <Field label="Tên hồ sơ hệ thống" required>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  disabled={busy}
                  onChange={(event) =>
                    setSourceEditDraft((current) => ({
                      ...current,
                      documentName: event.target.value,
                    }))
                  }
                  placeholder="Nhập tên hồ sơ"
                  value={sourceEditDraft.documentName}
                />
                {activeItem.kind === "seal" ? (
                  <Button
                    className="shrink-0"
                    disabled={busy}
                    onClick={resetSourceDocumentName}
                    type="button"
                    variant="secondary"
                  >
                    <RotateCcw aria-hidden size={16} />
                    Đặt lại tên
                  </Button>
                ) : null}
              </div>
            </Field>
          </div>

          {activeItem.kind === "seal" ? (
            <div className="mt-4">
              <div className="text-sm font-bold text-primary">
                Loại dấu <span className="text-accent">*</span>
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                {SEAL_STAMP_OPTIONS.map((stampType) => {
                  const selected = sourceEditDraft.stampTypes.includes(stampType);
                  return (
                    <button
                      aria-pressed={selected}
                      className={`flex min-h-11 items-center justify-between gap-2 rounded-xl border px-3 text-left text-sm font-bold transition ${
                        selected
                          ? "border-accent bg-accent-soft text-accent"
                          : "border-border bg-surface text-primary hover:border-accent/50"
                      }`}
                      disabled={busy}
                      key={stampType}
                      onClick={() =>
                        setSourceEditDraft((current) => ({
                          ...current,
                          stampTypes: current.stampTypes.includes(stampType)
                            ? current.stampTypes.filter((item) => item !== stampType)
                            : [...current.stampTypes, stampType],
                        }))
                      }
                      type="button"
                    >
                      <span>{stampType}</span>
                      {selected ? <Check aria-hidden size={16} /> : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <Button
              disabled={busy}
              onClick={() => setSourceEditOpen(false)}
              type="button"
              variant="secondary"
            >
              Hủy
            </Button>
            <Button
              disabled={
                busy ||
                !sourceEditDraft.documentName.trim() ||
                (activeItem.kind === "seal" &&
                  (!sourceEditDraft.documentTypeName.trim() ||
                    !sourceEditDraft.companyName.trim() ||
                    !sourceEditDraft.partner.trim() ||
                    !sourceEditDraft.signedDate ||
                    !sourceEditDraft.stampTypes.length))
              }
              onClick={saveSourceEdit}
              type="button"
            >
              {busy ? (
                <LoaderCircle aria-hidden className="animate-spin" size={17} />
              ) : (
                <Pencil aria-hidden size={17} />
              )}
              {busy ? "Đang lưu..." : "Lưu chỉnh sửa"}
            </Button>
          </div>
        </Dialog>
      ) : null}

      {unlockUser ? (
        <Dialog
          onClose={() => !busy && setUnlockUser(null)}
          title="Xác nhận mở khóa nhân viên"
        >
          <div className="rounded-xl border border-accent/25 bg-accent-soft p-3 text-sm leading-6 text-[#8b4d12]">
            Mở khóa đăng ký đóng dấu cho <strong>{unlockUser.fullName}</strong>
            {unlockUser.employeeCode ? ` (${unlockUser.employeeCode})` : ""}.
            {` ${unlockUser.pendingCount} yêu cầu hậu kiểm vẫn được giữ trong lịch sử để tiếp tục theo dõi.`}
          </div>
          <label className="mt-4 grid gap-2 text-sm font-bold text-primary">
            Lý do mở khóa
            <textarea
              className={textareaClass}
              disabled={busy}
              maxLength={1200}
              onChange={(event) => setUnlockReason(event.target.value)}
              value={unlockReason}
            />
          </label>
          <div className="mt-5 flex justify-end gap-2">
            <Button
              disabled={busy}
              onClick={() => setUnlockUser(null)}
              size="sm"
              type="button"
              variant="secondary"
            >
              Đóng
            </Button>
            <Button
              disabled={busy || !unlockReason.trim()}
              onClick={submitUnlock}
              size="sm"
              type="button"
            >
              {busy ? (
                <LoaderCircle
                  aria-hidden
                  className="animate-spin"
                  size={16}
                />
              ) : (
                <LockOpen aria-hidden size={16} />
              )}
              Xác nhận mở khóa
            </Button>
          </div>
        </Dialog>
      ) : null}

      {followUpItem ? (
        <Dialog
          onClose={() => !busy && setFollowUpItem(null)}
          title="Yêu cầu nộp lại bản ký"
        >
          <p className="text-sm leading-6 text-muted">
            Người tạo đơn <strong>{followUpItem.creatorName}</strong> sẽ được
            ghi nhận nghĩa vụ hậu kiểm cho hồ sơ {followUpItem.requestCode}.
          </p>
          <label className="mt-4 grid gap-2 text-sm font-bold text-primary">
            Nội dung yêu cầu
            <textarea
              className={textareaClass}
              disabled={busy}
              maxLength={1200}
              onChange={(event) => setFollowUpReason(event.target.value)}
              value={followUpReason}
            />
          </label>
          <div className="mt-5 flex justify-end gap-2">
            <Button
              disabled={busy}
              onClick={() => setFollowUpItem(null)}
              size="sm"
              type="button"
              variant="secondary"
            >
              Đóng
            </Button>
            <Button
              disabled={busy || !followUpReason.trim()}
              onClick={submitFollowUp}
              size="sm"
              type="button"
            >
              {busy ? (
                <LoaderCircle
                  aria-hidden
                  className="animate-spin"
                  size={16}
                />
              ) : (
                <Bell aria-hidden size={16} />
              )}
              Gửi hậu kiểm
            </Button>
          </div>
        </Dialog>
      ) : null}

      {cancelItem ? (
        <Dialog
          onClose={() => !busy && setCancelItem(null)}
          title="Hủy khỏi danh sách Hiệu đính"
        >
          <div className="rounded-xl border border-[#f3d4a0] bg-accent-soft p-3 text-sm leading-6 text-[#8b4d12]">
            Thao tác chỉ gỡ hồ sơ khỏi hàng đợi. Đơn gốc và số văn bản đã cấp
            vẫn được giữ nguyên. Hồ sơ đã có tệp lưu sẽ không thể hủy.
          </div>
          <label className="mt-4 grid gap-2 text-sm font-bold text-primary">
            Lý do hủy
            <textarea
              className={textareaClass}
              disabled={busy}
              maxLength={1200}
              onChange={(event) => setCancelReason(event.target.value)}
              placeholder="Nhập lý do cụ thể..."
              value={cancelReason}
            />
          </label>
          <label className="mt-4 grid gap-2 text-sm font-bold text-primary">
            Mật khẩu tài khoản đang đăng nhập
            <Input
              autoComplete="current-password"
              disabled={busy}
              onChange={(event) => setCancelPassword(event.target.value)}
              type="password"
              value={cancelPassword}
            />
          </label>
          <div className="mt-5 flex justify-end gap-2">
            <Button
              disabled={busy}
              onClick={() => setCancelItem(null)}
              size="sm"
              type="button"
              variant="secondary"
            >
              Đóng
            </Button>
            <Button
              disabled={
                busy || !cancelReason.trim() || !cancelPassword
              }
              onClick={submitCancel}
              size="sm"
              type="button"
              variant="danger"
            >
              {busy ? (
                <LoaderCircle
                  aria-hidden
                  className="animate-spin"
                  size={16}
                />
              ) : (
                <X aria-hidden size={16} />
              )}
              Xác nhận hủy
            </Button>
          </div>
        </Dialog>
      ) : null}
    </>
  );
}
