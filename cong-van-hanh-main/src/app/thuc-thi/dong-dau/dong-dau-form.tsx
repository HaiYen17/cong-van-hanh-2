"use client";

import Link from "next/link";
import {
  useActionState,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  AlertCircle,
  ArrowRightLeft,
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  ClipboardPaste,
  FileText,
  Files,
  ListChecks,
  Plus,
  Search,
  Trash2,
  Users,
  X,
} from "lucide-react";

import { FilePicker } from "@/components/ui/file-picker";
import { useToast, WriteLoadingOverlay } from "@/components/ui/toast";
import type { DigitalSignaturePlacement } from "@/lib/requests/electronic-signature-payload";

import type { RequestActionState } from "../actions";
import { saveSealPartnerAction, submitSealRequestAction } from "./actions";
import { PdfSignatureEditor } from "./pdf-signature-editor";
import styles from "./dong-dau.module.css";
import type {
  SealCompanyOption,
  SealDeclarationMode,
  SealDocumentTypeOption,
  SealPartnerInput,
  SealPartnerOption,
  SealSubmissionOffice,
} from "./types";

const INITIAL_ACTION_STATE: RequestActionState = {};
const OTHER = "__other__";
const DRAFT_KEY = "thuan-viet:document-seal:draft:v4";
const DETAIL_PREFIX = "Về việc";
const DIGITAL_SIGNATURE = "Ký số";
const ELECTRONIC_SIGNATURE_MAX_FILE_BYTES = 20 * 1024 * 1024;
const PHYSICAL_SEAL_TYPES = [
  "Đóng chính",
  "Giáp lai",
  "Dấu treo",
  "Sao y",
] as const;
const SEAL_TYPES = [...PHYSICAL_SEAL_TYPES, DIGITAL_SIGNATURE] as const;
const DECLARATION_LABEL: Record<SealDeclarationMode, string> = {
  detail: "Chi tiết",
  partner: "Đối tác",
  period: "Thời gian",
};

type BatchRow = {
  documentTypeId: string;
  otherType: string;
  quantity: string;
  sealTypes: string[];
  signDate: string;
  uid: string;
};

type CartItem = {
  companyId: string;
  companyLegalName: string;
  companyShort: string;
  condition: string;
  customNumberingText: string;
  declarationTypes: SealDeclarationMode[];
  documentTypeChoice: string;
  documentTypeId: string;
  entryMode: "single" | "bulk-partner" | "bulk-text" | "partner-bundle";
  note: string;
  partner: string;
  partnerAddress: string;
  partnerEmployeeCode: string;
  partnerIdentifier: string;
  partnerMode: SealDeclarationMode;
  partnerSource: string;
  quantity: number;
  sealTypes: string[];
  secondaryCompanyId: string;
  secondaryCompanyName: string;
  signatureFile: File | null;
  signatureFileName: string;
  signaturePlacements: DigitalSignaturePlacement[];
  signDate: string;
  takesNumber: boolean | null;
  typeLabel: string;
  uid: string;
  urgent: boolean;
};

type ReceiptState = {
  code: string;
  items: CartItem[];
  office: SealSubmissionOffice;
  submittedAt: string;
};

type DialogProps = {
  children: React.ReactNode;
  footer?: React.ReactNode;
  onClose: () => void;
  title: string;
  wide?: boolean;
};

function todayInput() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function nextId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function blankBatchRow(): BatchRow {
  return {
    documentTypeId: "",
    otherType: "",
    quantity: "1",
    sealTypes: [],
    signDate: todayInput(),
    uid: nextId(),
  };
}

function normalizeSearch(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("vi-VN")
    .replace(/\s+/g, " ")
    .trim();
}

function formatDate(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

function stripDetailPrefix(value: string) {
  return value.replace(/^\s+/, "").replace(/^về\s+việc(?:[\s:：,\-]+|$)/i, "");
}

function normalizeDetail(value: string) {
  const detail = stripDetailPrefix(value).replace(/\s+/g, " ").trim();
  if (!detail) return "";
  return `${DETAIL_PREFIX} ${detail}`;
}

function conditionNote(
  documentType: SealDocumentTypeOption | null,
  isOther = false,
) {
  if (isOther) {
    return "Hành chính xem xét hồ sơ có thuộc diện cấp số; có thể giữ lại 01 bản chính.";
  }
  if (!documentType) return "Chọn loại hồ sơ để xem lưu ý.";
  const normalized = normalizeSearch(documentType.condition);
  const notes: string[] = [];
  if (normalized.includes("hc giu")) {
    notes.push("Hành chính giữ lại 01 bản chính.");
  } else if (normalized.includes("scan")) {
    notes.push("Hồ sơ cần thời gian scan và lưu trữ.");
  } else if (normalized.includes("khong yeu cau luu")) {
    notes.push("Không yêu cầu lưu hồ sơ.");
  } else if (documentType.condition) {
    notes.push(documentType.condition);
  }
  if (documentType.takesNumber) {
    notes.push("Hành chính sẽ cấp số nếu hồ sơ chưa có số.");
  } else {
    notes.push("Loại hồ sơ này không yêu cầu cấp số.");
  }
  return notes.join(" ");
}

function isBulkHeaderOrTotal(value: string) {
  const normalized = normalizeSearch(value);
  return (
    !normalized ||
    normalized === "stt" ||
    normalized === "so chung tu" ||
    normalized === "so ct" ||
    normalized === "chung tu" ||
    normalized === "so chung tu eshop" ||
    normalized === "ngay" ||
    normalized === "noi dung" ||
    normalized === "tong" ||
    normalized.startsWith("tong cong") ||
    normalized.startsWith("ngay ")
  );
}

function isBulkDateLike(value: string) {
  const text = value.trim();
  return (
    /^\d{4}-\d{2}-\d{2}/.test(text) ||
    /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(text)
  );
}

function isBulkVoucherLike(value: string) {
  const text = value.replace(/\s+/g, " ").trim();
  if (!text || isBulkHeaderOrTotal(text) || isBulkDateLike(text)) return false;
  return /[A-Za-z]\s*\d|\d\s*[A-Za-z]|[/#._-]/.test(text);
}

function pickBulkValueFromLine(line: string) {
  const cells = line
    .trim()
    .split(/\t+/)
    .map((value) =>
      value
        .replace(/\u00a0/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean);
  if (!cells.length) return "";
  if (cells.length === 1) return cells[0];

  return (
    cells.find(isBulkVoucherLike) ||
    cells.find(
      (cell) =>
        !isBulkHeaderOrTotal(cell) &&
        !isBulkDateLike(cell) &&
        !/^\d{1,3}$/.test(cell),
    ) ||
    cells.find((cell) => !isBulkHeaderOrTotal(cell)) ||
    ""
  );
}

function parseBulkValues(raw: string) {
  const seen = new Set<string>();
  return raw
    .split(/\r?\n/)
    .map(pickBulkValueFromLine)
    .map((value) => value.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((value) => {
      if (isBulkHeaderOrTotal(value)) return false;
      const key = normalizeSearch(value);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function isPeriod(value: string) {
  return /^(0[1-9]|1[0-2])\/\d{4}$/.test(value.trim());
}

function formatPeriodInput(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 6);
  return digits.length > 2
    ? `${digits.slice(0, 2)}/${digits.slice(2)}`
    : digits;
}

function fieldClass(invalid: boolean, extra = "") {
  return [styles.field, invalid ? styles.invalid : "", extra]
    .filter(Boolean)
    .join(" ");
}

function statusTone(note: string) {
  const normalized = normalizeSearch(note);
  if (normalized.includes("khong yeu cau luu")) return styles.statusGreen;
  if (normalized.includes("scan") || normalized.includes("hc giu")) {
    return styles.statusOrange;
  }
  return styles.statusRed;
}

function Field({
  children,
  hint,
  invalid = false,
  label,
  required = false,
  span = false,
}: {
  children: React.ReactNode;
  hint?: string;
  invalid?: boolean;
  label: string;
  required?: boolean;
  span?: boolean;
}) {
  return (
    <div className={fieldClass(invalid, span ? styles.span2 : "")}>
      <div className={styles.label}>
        <span>
          {label} {required ? <span className={styles.required}>*</span> : null}
        </span>
      </div>
      {children}
      {hint ? <div className={styles.hint}>{hint}</div> : null}
    </div>
  );
}

function Dialog({
  children,
  footer,
  onClose,
  title,
  wide = false,
}: DialogProps) {
  return (
    <div
      className={styles.backdrop}
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section
        aria-label={title}
        aria-modal="true"
        className={`${styles.dialog} ${wide ? styles.dialogWide : ""}`}
        role="dialog"
      >
        <header className={styles.dialogHeader}>
          <div className={styles.dialogTitle}>{title}</div>
          <button
            aria-label="Đóng"
            className={styles.dialogClose}
            onClick={onClose}
            type="button"
          >
            <X size={17} />
          </button>
        </header>
        <div className={styles.dialogBody}>{children}</div>
        {footer ? (
          <footer className={styles.dialogFooter}>{footer}</footer>
        ) : null}
      </section>
    </div>
  );
}

function useOutsideClose(
  open: boolean,
  close: () => void,
  ref: React.RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!open) return;
    const listener = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) close();
    };
    document.addEventListener("mousedown", listener);
    return () => document.removeEventListener("mousedown", listener);
  }, [close, open, ref]);
}

function DocumentTypeCombobox({
  docTypes,
  invalid = false,
  onChange,
  value,
}: {
  docTypes: SealDocumentTypeOption[];
  invalid?: boolean;
  onChange: (value: string) => void;
  value: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  useOutsideClose(open, () => setOpen(false), root);
  const selected = docTypes.find((item) => item.id === value);
  const filtered = useMemo(() => {
    const key = normalizeSearch(query);
    if (!key) return docTypes;
    return docTypes.filter((item) =>
      normalizeSearch(
        [
          item.name,
          item.condition,
          item.declarationTypes
            .map((mode) => DECLARATION_LABEL[mode])
            .join(" "),
          item.numberingPreview,
        ].join(" "),
      ).includes(key),
    );
  }, [docTypes, query]);

  return (
    <div
      className={`${styles.combo} ${invalid ? styles.invalid : ""}`}
      ref={root}
    >
      <button
        aria-controls={listboxId}
        aria-expanded={open}
        className={styles.comboButton}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span className={!value ? styles.comboPlaceholder : ""}>
          {value === OTHER
            ? "Khác"
            : selected?.name || "Chọn hoặc tìm loại hồ sơ"}
        </span>
        <ChevronDown size={16} />
      </button>
      {open ? (
        <div className={styles.comboMenu}>
          <div className={styles.comboSearch}>
            <Search size={15} />
            <input
              autoFocus
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Tìm tên hồ sơ, điều kiện, loại khai báo..."
              value={query}
            />
          </div>
          <div className={styles.comboList} id={listboxId} role="listbox">
            {filtered.map((item) => (
              <button
                aria-selected={item.id === value}
                className={`${styles.comboOption} ${
                  item.id === value ? styles.comboOptionActive : ""
                }`}
                key={item.id}
                onClick={() => {
                  onChange(item.id);
                  setOpen(false);
                  setQuery("");
                }}
                role="option"
                type="button"
              >
                <div className={styles.optionTitle}>
                  <span>{item.name}</span>
                  {item.takesNumber ? (
                    <span
                      className={`${styles.miniTag} ${styles.miniTagOrange}`}
                    >
                      Có cấp số
                    </span>
                  ) : (
                    <span className={styles.miniTag}>Không cấp số</span>
                  )}
                </div>
                <div className={styles.optionMeta}>
                  <span>
                    {item.declarationTypes
                      .map((mode) => DECLARATION_LABEL[mode])
                      .join(" · ")}
                  </span>
                  {item.condition ? <span>• {item.condition}</span> : null}
                  {item.numberingPreview ? (
                    <span>• Mẫu: {item.numberingPreview}</span>
                  ) : null}
                </div>
              </button>
            ))}
            {!filtered.length ? (
              <div className={styles.comboEmpty}>
                Không tìm thấy loại hồ sơ.
              </div>
            ) : null}
            <button
              className={styles.addPartnerOption}
              onClick={() => {
                onChange(OTHER);
                setOpen(false);
                setQuery("");
              }}
              type="button"
            >
              <Plus size={14} /> Khác — tự nhập loại hồ sơ
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PartnerCombobox({
  invalid = false,
  onAdd,
  onChange,
  partners,
  value,
}: {
  invalid?: boolean;
  onAdd: () => void;
  onChange: (item: SealPartnerOption | null) => void;
  partners: SealPartnerOption[];
  value: SealPartnerOption | null;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  useOutsideClose(open, () => setOpen(false), root);
  const filtered = useMemo(() => {
    const key = normalizeSearch(query);
    const ranked = partners
      .map((partner) => {
        const name = normalizeSearch(partner.name);
        const identifier = normalizeSearch(
          `${partner.taxId} ${partner.employeeCode} ${partner.shortName}`,
        );
        const haystack = normalizeSearch(
          `${partner.searchText} ${partner.label} ${partner.meta || ""}`,
        );
        let score = 0;
        if (!key) score = 1;
        else if (name === key || identifier === key) score = 100;
        else if (name.startsWith(key) || identifier.startsWith(key)) score = 80;
        else if (haystack.includes(key)) score = 50;
        return { partner, score };
      })
      .filter((entry) => entry.score > 0)
      .sort(
        (left, right) =>
          right.score - left.score ||
          left.partner.name.localeCompare(right.partner.name, "vi"),
      );
    return ranked.slice(0, 20).map((entry) => entry.partner);
  }, [partners, query]);

  return (
    <div
      className={`${styles.combo} ${invalid ? styles.invalid : ""}`}
      ref={root}
    >
      <button
        aria-controls={listboxId}
        aria-expanded={open}
        className={styles.comboButton}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span className={!value ? styles.comboPlaceholder : ""}>
          {value?.label || "Gõ tên/MST/CCCD/MNV"}
        </span>
        <ChevronDown size={16} />
      </button>
      {open ? (
        <div className={styles.comboMenu}>
          <div className={styles.comboSearch}>
            <Search size={15} />
            <input
              autoFocus
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Tên, MST, CCCD, mã nhân viên..."
              value={query}
            />
          </div>
          <div className={styles.comboList} id={listboxId} role="listbox">
            {filtered.map((partner) => (
              <button
                aria-selected={partner.id === value?.id}
                className={`${styles.comboOption} ${
                  partner.id === value?.id ? styles.comboOptionActive : ""
                }`}
                key={partner.id}
                onClick={() => {
                  onChange(partner);
                  setOpen(false);
                  setQuery("");
                }}
                role="option"
                type="button"
              >
                <div className={styles.optionTitle}>
                  <span>{partner.label}</span>
                  <span className={styles.miniTag}>{partner.sourceLabel}</span>
                </div>
                <div className={styles.optionMeta}>
                  {partner.taxId ? (
                    <span>
                      {partner.type === "person" ? "CCCD" : "MST"}:{" "}
                      {partner.taxId}
                    </span>
                  ) : null}
                  {partner.shortName ? (
                    <span>• {partner.shortName}</span>
                  ) : null}
                  {partner.meta ? <span>• {partner.meta}</span> : null}
                </div>
              </button>
            ))}
            {!filtered.length ? (
              <div className={styles.comboEmpty}>Không tìm thấy đối tác.</div>
            ) : null}
            <button
              className={styles.addPartnerOption}
              onClick={() => {
                setOpen(false);
                onAdd();
              }}
              type="button"
            >
              <Plus size={14} /> Khác — thêm Đối tác mới
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CompanyPicker({
  allowSecondary = true,
  companies,
  invalid = false,
  onChange,
  onSecondaryChange,
  secondaryId,
  value,
}: {
  allowSecondary?: boolean;
  companies: SealCompanyOption[];
  invalid?: boolean;
  onChange: (value: string) => void;
  onSecondaryChange: (value: string) => void;
  secondaryId: string;
  value: string;
}) {
  const [showSecondary, setShowSecondary] = useState(Boolean(secondaryId));

  return (
    <div className={invalid ? styles.invalid : ""}>
      <div
        aria-label="Pháp nhân ký"
        className={styles.companyPicker}
        role="radiogroup"
      >
        {companies.map((company) => (
          <button
            aria-checked={value === company.id}
            className={`${styles.companyChip} ${
              value === company.id ? styles.companyChipActive : ""
            }`}
            key={company.id}
            onClick={() => {
              onChange(company.id);
              if (secondaryId === company.id) onSecondaryChange("");
            }}
            role="radio"
            type="button"
          >
            {company.legalName}
          </button>
        ))}
        {allowSecondary ? <button
          aria-expanded={showSecondary}
          aria-label="Ký hai pháp nhân"
          className={`${styles.workflowAction} ${styles.companyTransferAction} ${
            showSecondary ? styles.workflowActionActive : ""
          }`}
          onClick={() => {
            setShowSecondary((current) => {
              if (current) onSecondaryChange("");
              return !current;
            });
          }}
          type="button"
        >
          <span className={styles.workflowActionIcon}>
            <Building2 size={20} />
            <ArrowRightLeft
              className={styles.workflowActionIconBadge}
              size={12}
            />
          </span>
          <span className={styles.workflowActionCopy}>
            <span className={styles.workflowActionEyebrow}>
              Tính năng đặc biệt
            </span>
            <strong>Ký 2 pháp nhân</strong>
            <small>Chọn thêm pháp nhân chuyển giao nội bộ</small>
          </span>
          <span className={styles.workflowActionState}>
            {showSecondary ? "Đang bật" : "Thiết lập"}
          </span>
        </button> : null}
      </div>
      {allowSecondary && showSecondary ? (
        <div className={styles.secondaryRow}>
          <select
            aria-label="Pháp nhân chuyển giao nội bộ"
            className={styles.select}
            onChange={(event) => onSecondaryChange(event.target.value)}
            value={secondaryId}
          >
            <option value="">Chọn pháp nhân chuyển giao nội bộ</option>
            {companies
              .filter((company) => company.id !== value)
              .map((company) => (
                <option key={company.id} value={company.id}>
                  {company.legalName}
                </option>
              ))}
          </select>
          <button
            aria-label="Bỏ pháp nhân chuyển giao"
            className={styles.removeMini}
            onClick={() => {
              onSecondaryChange("");
              setShowSecondary(false);
            }}
            type="button"
          >
            <X size={15} />
          </button>
        </div>
      ) : null}
    </div>
  );
}

function StampPicker({
  invalid = false,
  onChange,
  value,
}: {
  invalid?: boolean;
  onChange: (value: string[]) => void;
  value: string[];
}) {
  return (
    <div
      aria-label="Loại dấu"
      className={`${styles.stampGrid} ${invalid ? styles.invalid : ""}`}
      role="group"
    >
      {SEAL_TYPES.map((seal) => {
        const active = value.includes(seal);
        return (
          <button
            aria-pressed={active}
            className={`${styles.stamp} ${active ? styles.stampActive : ""}`}
            key={seal}
            onClick={() => {
              if (active) {
                onChange(value.filter((item) => item !== seal));
                return;
              }
              onChange(
                seal === DIGITAL_SIGNATURE
                  ? [DIGITAL_SIGNATURE]
                  : value.includes(DIGITAL_SIGNATURE)
                    ? [seal]
                    : [...value, seal],
              );
            }}
            type="button"
          >
            <span>{seal}</span>
            <span className={styles.stampCheck}>
              {active ? <Check size={12} /> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function AddPartnerDialog({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (item: SealPartnerOption) => void;
}) {
  const { toast } = useToast();
  const [saving, startSaving] = useTransition();
  const [type, setType] = useState<"business" | "person">("business");
  const [input, setInput] = useState<SealPartnerInput>({
    address: "",
    issuedDate: "",
    issuedPlace: "",
    name: "",
    shortName: "",
    taxId: "",
    type: "business",
  });
  const [invalid, setInvalid] = useState<string[]>([]);

  const save = () => {
    const required =
      type === "business"
        ? ["name", "taxId", "address", "shortName"]
        : ["name", "taxId", "issuedDate", "issuedPlace"];
    const missing = required.filter(
      (key) => !String(input[key as keyof SealPartnerInput] || "").trim(),
    );
    if (missing.length) {
      setInvalid(missing);
      toast({
        message: "Vui lòng nhập đầy đủ thông tin Đối tác.",
        title: "Thiếu thông tin",
        tone: "error",
      });
      return;
    }
    startSaving(async () => {
      const result = await saveSealPartnerAction({ ...input, type });
      if (result.error || !result.item) {
        toast({
          message: result.error || "Không lưu được đối tác.",
          title: "Cập nhật danh sách Đối tác",
          tone: "error",
        });
        return;
      }
      toast({
        message: result.success || "Đã lưu đối tác.",
        title: "Cập nhật danh sách Đối tác",
        tone: "success",
      });
      onSaved(result.item);
    });
  };

  const patch = (key: keyof SealPartnerInput, value: string) => {
    setInput((current) => ({ ...current, [key]: value }));
    setInvalid((current) => current.filter((item) => item !== key));
  };

  return (
    <>
      <WriteLoadingOverlay show={saving} />
      <Dialog
        footer={
          <>
            <button
              className={`${styles.button} ${styles.buttonSecondary}`}
              onClick={onClose}
              type="button"
            >
              Hủy
            </button>
            <button
              className={`${styles.button} ${styles.buttonPrimary}`}
              disabled={saving}
              onClick={save}
              type="button"
            >
              Lưu đối tác
            </button>
          </>
        }
        onClose={onClose}
        title="Thêm Đối tác mới"
      >
        <div className={styles.partnerTabs} role="tablist">
          {(
            [
              ["business", "Doanh nghiệp"],
              ["person", "Cá nhân"],
            ] as const
          ).map(([key, label]) => (
            <button
              aria-selected={type === key}
              className={`${styles.partnerTab} ${
                type === key ? styles.partnerTabActive : ""
              }`}
              key={key}
              onClick={() => {
                setType(key);
                setInvalid([]);
              }}
              role="tab"
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
        <div className={styles.formGrid}>
          <Field
            invalid={invalid.includes("name")}
            label={type === "business" ? "Tên công ty" : "Tên khách hàng"}
            required
            span
          >
            <input
              className={styles.input}
              onChange={(event) => patch("name", event.target.value)}
              value={input.name}
            />
          </Field>
          <Field
            invalid={invalid.includes("taxId")}
            label={type === "business" ? "Mã số thuế" : "CCCD"}
            required
          >
            <input
              className={styles.input}
              onChange={(event) => patch("taxId", event.target.value)}
              value={input.taxId}
            />
          </Field>
          {type === "business" ? (
            <>
              <Field
                invalid={invalid.includes("shortName")}
                label="Tên công ty viết tắt"
                required
              >
                <input
                  className={styles.input}
                  onChange={(event) => patch("shortName", event.target.value)}
                  value={input.shortName}
                />
              </Field>
              <Field
                invalid={invalid.includes("address")}
                label="Địa chỉ"
                required
                span
              >
                <input
                  className={styles.input}
                  onChange={(event) => patch("address", event.target.value)}
                  value={input.address}
                />
              </Field>
            </>
          ) : (
            <>
              <Field
                invalid={invalid.includes("issuedDate")}
                label="Ngày cấp"
                required
              >
                <input
                  className={styles.input}
                  onChange={(event) => patch("issuedDate", event.target.value)}
                  type="date"
                  value={input.issuedDate}
                />
              </Field>
              <Field
                invalid={invalid.includes("issuedPlace")}
                label="Nơi cấp"
                required
                span
              >
                <input
                  className={styles.input}
                  onChange={(event) => patch("issuedPlace", event.target.value)}
                  value={input.issuedPlace}
                />
              </Field>
            </>
          )}
        </div>
      </Dialog>
    </>
  );
}

function BulkPartnerDialog({
  initialIds,
  onApply,
  onClose,
  partners,
}: {
  initialIds: string[];
  onApply: (ids: string[]) => void;
  onClose: () => void;
  partners: SealPartnerOption[];
}) {
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState(initialIds);
  const selected = partners.filter((item) => selectedIds.includes(item.id));
  const filtered = partners
    .filter((partner) =>
      normalizeSearch(
        `${partner.searchText} ${partner.label} ${partner.meta || ""}`,
      ).includes(normalizeSearch(query)),
    )
    .slice(0, 80);

  const toggle = (id: string) =>
    setSelectedIds((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );

  return (
    <Dialog
      footer={
        <>
          <button
            className={`${styles.button} ${styles.buttonSecondary}`}
            onClick={onClose}
            type="button"
          >
            Hủy
          </button>
          <button
            className={`${styles.button} ${styles.buttonPrimary}`}
            disabled={!selectedIds.length}
            onClick={() => onApply(selectedIds)}
            type="button"
          >
            Chọn {selectedIds.length} đối tác
          </button>
        </>
      }
      onClose={onClose}
      title="Chọn nhiều đối tác"
      wide
    >
      <div className={styles.comboSearch}>
        <Search size={15} />
        <input
          autoFocus
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Tìm theo tên, MST, CCCD, mã nhân viên..."
          value={query}
        />
      </div>
      <div className={styles.bulkLayout}>
        <div>
          <div className={styles.label}>
            Kết quả ({filtered.length}
            {partners.length > 80 ? " / tối đa 80" : ""})
          </div>
          <div className={styles.bulkList}>
            {filtered.map((partner) => {
              const active = selectedIds.includes(partner.id);
              return (
                <button
                  className={`${styles.bulkRow} ${
                    active ? styles.bulkRowSelected : ""
                  }`}
                  key={partner.id}
                  onClick={() => toggle(partner.id)}
                  type="button"
                >
                  <span className={styles.bulkCheckbox}>
                    {active ? <Check size={12} /> : null}
                  </span>
                  <span>
                    <strong>{partner.label}</strong>
                    <span className={styles.optionMeta}>
                      {partner.sourceLabel}
                      {partner.taxId ? ` • ${partner.taxId}` : ""}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <div className={styles.label}>Đã chọn ({selected.length})</div>
          <div className={styles.selectedChips}>
            {selected.length ? (
              selected.map((partner) => (
                <span className={styles.selectedChip} key={partner.id}>
                  <span>{partner.label}</span>
                  <button
                    aria-label={`Bỏ ${partner.label}`}
                    onClick={() => toggle(partner.id)}
                    type="button"
                  >
                    <X size={11} />
                  </button>
                </span>
              ))
            ) : (
              <span className={styles.hint}>Chưa chọn đối tác nào.</span>
            )}
          </div>
        </div>
      </div>
    </Dialog>
  );
}

function BulkTextDialog({
  initialRaw,
  onApply,
  onClose,
}: {
  initialRaw: string;
  onApply: (raw: string, values: string[]) => void;
  onClose: () => void;
}) {
  const [raw, setRaw] = useState(initialRaw);
  const values = useMemo(() => parseBulkValues(raw), [raw]);
  return (
    <Dialog
      footer={
        <>
          <button
            className={`${styles.button} ${styles.buttonSecondary}`}
            onClick={onClose}
            type="button"
          >
            Hủy
          </button>
          <button
            className={`${styles.button} ${styles.buttonPrimary}`}
            disabled={!values.length}
            onClick={() => onApply(raw, values)}
            type="button"
          >
            Dùng {values.length} chứng từ
          </button>
        </>
      }
      onClose={onClose}
      title="Dán danh sách chứng từ"
    >
      <Field
        hint="Có thể dán trực tiếp một cột từ Excel. Hệ thống tự bỏ tiêu đề, dòng tổng cộng, ngày và giá trị trùng."
        label="Danh sách chứng từ"
        required
      >
        <textarea
          autoFocus
          className={styles.textarea}
          onChange={(event) => setRaw(event.target.value)}
          placeholder={"Số chứng từ\nPC0001\nPC0002\nPC0003"}
          value={raw}
        />
      </Field>
      <div className={styles.label} style={{ marginTop: 12 }}>
        Xem trước ({values.length})
      </div>
      <div className={styles.previewList}>
        {values.slice(0, 18).map((value) => (
          <span className={styles.previewChip} key={value}>
            {value}
          </span>
        ))}
        {values.length > 18 ? (
          <span className={styles.previewChip}>+{values.length - 18}</span>
        ) : null}
      </div>
    </Dialog>
  );
}

function ReceiptDialog({
  currentUserName,
  onClose,
  receipt,
}: {
  currentUserName: string;
  onClose: () => void;
  receipt: ReceiptState;
}) {
  const [countdown, setCountdown] = useState(15);
  useEffect(() => {
    const timer = window.setInterval(
      () => setCountdown((current) => current - 1),
      1000,
    );
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (countdown <= 0) onClose();
  }, [countdown, onClose]);

  return (
    <Dialog
      footer={
        <button
          className={`${styles.button} ${styles.buttonPrimary}`}
          onClick={onClose}
          type="button"
        >
          Đóng · {Math.max(countdown, 0)}s
        </button>
      }
      onClose={onClose}
      title="Đơn hàng của bạn đã nộp thành công"
      wide
    >
      <div className={styles.receiptSuccess}>
        <CheckCircle2 size={19} />
        Đã chuyển hồ sơ vào hàng đợi Hành chính.
      </div>
      <div className={styles.receiptMeta}>
        <div className={styles.receiptMetaCard}>
          <span className={styles.cartKey}>Mã đơn</span>
          <strong>{receipt.code}</strong>
        </div>
        <div className={styles.receiptMetaCard}>
          <span className={styles.cartKey}>Dịch vụ</span>
          <strong>Đóng dấu và Ký số</strong>
        </div>
        <div className={styles.receiptMetaCard}>
          <span className={styles.cartKey}>Người gửi</span>
          <strong>{currentUserName}</strong>
        </div>
      </div>
      <div className={styles.receiptTableWrap}>
        <table className={styles.receiptTable}>
          <thead>
            <tr>
              <th>Loại hồ sơ</th>
              <th>Pháp nhân ký</th>
              <th>Đối tác / Thời gian / Chi tiết</th>
              <th>Ngày ký</th>
              <th>SL</th>
              <th>Loại dấu</th>
              <th>Khu vực nộp</th>
              <th>Lưu ý</th>
            </tr>
          </thead>
          <tbody>
            {receipt.items.map((item) => (
              <tr key={item.uid}>
                <td>{item.typeLabel}</td>
                <td>
                  {item.companyLegalName}
                  {item.secondaryCompanyName
                    ? ` → ${item.secondaryCompanyName}`
                    : ""}
                </td>
                <td>
                  <strong>{DECLARATION_LABEL[item.partnerMode]}:</strong>{" "}
                  {item.partner}
                </td>
                <td>{formatDate(item.signDate)}</td>
                <td>{item.quantity}</td>
                <td>{item.sealTypes.join(", ")}</td>
                <td>{receipt.office.label}</td>
                <td>
                  <span
                    className={`${styles.statusDot} ${statusTone(item.condition)}`}
                    style={{ display: "inline-block", marginRight: 5 }}
                  />
                  {item.note}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Dialog>
  );
}

function legalDisplay(
  company: SealCompanyOption | undefined,
  secondary: SealCompanyOption | undefined,
) {
  const primaryName = company?.legalName || "";
  const secondaryName = secondary?.legalName || "";
  return secondaryName ? `${primaryName} → ${secondaryName}` : primaryName;
}

export function DongDauForm({
  companies,
  currentUserName,
  docTypes,
  initialPartners,
  submissionOffices,
}: {
  companies: SealCompanyOption[];
  currentUserName: string;
  docTypes: SealDocumentTypeOption[];
  initialPartners: SealPartnerOption[];
  submissionOffices: SealSubmissionOffice[];
}) {
  const [state, formAction, pending] = useActionState(
    submitSealRequestAction,
    INITIAL_ACTION_STATE,
  );
  const { toast } = useToast();
  const seenActionState = useRef<RequestActionState | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const submitRequested = useRef(false);
  const submittedItems = useRef<CartItem[]>([]);
  const submittedOffice = useRef<SealSubmissionOffice | null>(null);
  const draftLoaded = useRef(false);

  const defaultCompanyId =
    companies.find((company) =>
      normalizeSearch(`${company.code} ${company.shortName}`).includes("ntv"),
    )?.id ||
    companies[0]?.id ||
    "";

  const [partners, setPartners] = useState(initialPartners);
  const [mode, setMode] = useState<"single" | "batch">("single");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [invalid, setInvalid] = useState<string[]>([]);

  const [documentTypeId, setDocumentTypeId] = useState("");
  const [otherType, setOtherType] = useState("");
  const [declarationMode, setDeclarationMode] =
    useState<SealDeclarationMode>("partner");
  const [partner, setPartner] = useState<SealPartnerOption | null>(null);
  const [period, setPeriod] = useState("");
  const [detail, setDetail] = useState("");
  const [customNumberingText, setCustomNumberingText] = useState("");
  const [companyId, setCompanyId] = useState(defaultCompanyId);
  const [secondaryCompanyId, setSecondaryCompanyId] = useState("");
  const [signDate, setSignDate] = useState(todayInput());
  const [quantity, setQuantity] = useState("1");
  const [sealTypes, setSealTypes] = useState<string[]>([]);
  const [signatureFile, setSignatureFile] = useState<File | null>(null);
  const [signaturePlacements, setSignaturePlacements] = useState<
    DigitalSignaturePlacement[]
  >([]);
  const [urgent, setUrgent] = useState(false);
  const [bulkPartnerIds, setBulkPartnerIds] = useState<string[]>([]);
  const [bulkTextRaw, setBulkTextRaw] = useState("");
  const [bulkTextValues, setBulkTextValues] = useState<string[]>([]);

  const [batchPartner, setBatchPartner] = useState<SealPartnerOption | null>(
    null,
  );
  const [batchCustomText, setBatchCustomText] = useState("");
  const [batchCompanyId, setBatchCompanyId] = useState(defaultCompanyId);
  const [batchSecondaryCompanyId, setBatchSecondaryCompanyId] = useState("");
  const [batchRows, setBatchRows] = useState<BatchRow[]>([blankBatchRow()]);

  const [addPartnerTarget, setAddPartnerTarget] = useState<
    "single" | "batch" | null
  >(null);
  const [showBulkPartners, setShowBulkPartners] = useState(false);
  const [showBulkText, setShowBulkText] = useState(false);
  const [showOffice, setShowOffice] = useState(false);
  const [selectedOffice, setSelectedOffice] =
    useState<SealSubmissionOffice | null>(null);
  const [receipt, setReceipt] = useState<ReceiptState | null>(null);
  const [uploadingSignatureFiles, setUploadingSignatureFiles] = useState(false);
  const [signatureUploadRetryCode, setSignatureUploadRetryCode] = useState("");

  const selectedDocumentType =
    docTypes.find((item) => item.id === documentTypeId) || null;
  const allowedDeclarationModes =
    documentTypeId === OTHER
      ? (["partner", "period", "detail"] as SealDeclarationMode[])
      : selectedDocumentType?.declarationTypes || [];
  const selectedCondition = conditionNote(
    selectedDocumentType,
    documentTypeId === OTHER,
  );
  const selectedCompany = companies.find((item) => item.id === companyId);
  const selectedSecondaryCompany = companies.find(
    (item) => item.id === secondaryCompanyId,
  );
  const selectedBulkPartners = partners.filter((item) =>
    bulkPartnerIds.includes(item.id),
  );
  const batchNeedsCustomText = batchRows.some(
    (row) =>
      docTypes.find((item) => item.id === row.documentTypeId)
        ?.hasCustomNumberingText,
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const stored = window.localStorage.getItem(DRAFT_KEY);
        if (stored) {
          const parsed = JSON.parse(stored) as { cart?: CartItem[] };
          if (Array.isArray(parsed.cart) && parsed.cart.length) {
            setCart(
              parsed.cart.map((item) => ({
                ...item,
                signatureFile: null,
                signaturePlacements: [],
              })),
            );
            toast({
              message: `Đã khôi phục ${parsed.cart.length} hồ sơ trong đơn nháp.`,
              title: "Khôi phục đơn nháp",
              tone: "info",
            });
          }
        }
      } catch {
        window.localStorage.removeItem(DRAFT_KEY);
      } finally {
        draftLoaded.current = true;
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!draftLoaded.current) return;
    if (cart.length) {
      window.localStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({
          cart: cart.map((item) => ({
            ...item,
            signatureFile: null,
          })),
        }),
      );
    } else {
      window.localStorage.removeItem(DRAFT_KEY);
    }
  }, [cart]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!cart.length) return;
      event.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [cart.length]);

  useEffect(() => {
    if (!selectedOffice || !submitRequested.current) return;
    submitRequested.current = false;
    const frame = window.requestAnimationFrame(() =>
      formRef.current?.requestSubmit(),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [selectedOffice]);

  useEffect(() => {
    if (state === seenActionState.current) return;
    seenActionState.current = state;
    if (state.success && state.requestCode && submittedOffice.current) {
      const completedItems = submittedItems.current;
      const completedOffice = submittedOffice.current;
      const electronicItems = completedItems.filter((item) =>
        item.sealTypes.includes(DIGITAL_SIGNATURE),
      );
      if (!electronicItems.length) {
        setReceipt({
          code: state.requestCode,
          items: completedItems,
          office: completedOffice,
          submittedAt: state.submittedAt || new Date().toISOString(),
        });
        setCart([]);
        window.localStorage.removeItem(DRAFT_KEY);
        setSelectedOffice(null);
        toast({
          message: state.success,
          title: "Đóng dấu và Ký số",
          tone: "success",
        });
        return;
      }

      let cancelled = false;
      setUploadingSignatureFiles(true);
      setSignatureUploadRetryCode(state.requestCode);
      void uploadElectronicSignatureFiles(state.requestCode, completedItems)
        .then(() => {
          if (cancelled) return;
          setReceipt({
            code: state.requestCode || "",
            items: completedItems,
            office: completedOffice,
            submittedAt: state.submittedAt || new Date().toISOString(),
          });
          setCart([]);
          window.localStorage.removeItem(DRAFT_KEY);
          setSelectedOffice(null);
          setSignatureUploadRetryCode("");
          toast({
            message: `${state.success} PDF đã vào hàng chờ AI để tóm tắt trước khi chuyển BOD duyệt.`,
            title: "Đóng dấu và Ký số",
            tone: "success",
          });
        })
        .catch((error) => {
          if (cancelled) return;
          toast({
            message:
              error instanceof Error
                ? `${state.requestCode} đã được tạo nhưng file chưa nạp đủ: ${error.message}`
                : `${state.requestCode} đã được tạo nhưng file chưa nạp đủ.`,
            title: "Cần tải lại PDF ký số",
            tone: "error",
          });
        })
        .finally(() => {
          if (!cancelled) setUploadingSignatureFiles(false);
        });
      return () => {
        cancelled = true;
      };
    } else if (state.error) {
      toast({
        message: state.error,
        title: "Không nộp được hồ sơ",
        tone: "error",
      });
    }
  }, [state, toast]);

  async function uploadElectronicSignatureFiles(
    requestCode: string,
    items: CartItem[],
  ) {
    const electronicItems = items
      .map((item, index) => ({ index, item }))
      .filter(({ item }) => item.sealTypes.includes(DIGITAL_SIGNATURE));
    for (const { index, item } of electronicItems) {
      if (!item.signatureFile) {
        throw new Error(
          `Hồ sơ dòng ${index + 1} cần chọn lại PDF và vẽ vùng ký số.`,
        );
      }
      const body = new FormData();
      body.set("file", item.signatureFile, item.signatureFile.name);
      body.set("itemIndex", String(index + 1));
      body.set("kind", "input");
      body.set("requestId", requestCode);
      const response = await fetch("/api/requests/electronic-signature", {
        body,
        credentials: "same-origin",
        method: "POST",
      });
      const result = (await response.json().catch(() => ({}))) as {
        message?: string;
        ok?: boolean;
      };
      if (!response.ok || !result.ok) {
        throw new Error(
          result.message || `Không nạp được file hồ sơ dòng ${index + 1}.`,
        );
      }
    }
  }

  const setSingleDocumentType = (value: string) => {
    setDocumentTypeId(value);
    setInvalid((current) =>
      current.filter((item) => !["documentType", "otherType"].includes(item)),
    );
    const selected = docTypes.find((item) => item.id === value);
    const modes =
      value === OTHER
        ? (["partner", "period", "detail"] as SealDeclarationMode[])
        : selected?.declarationTypes || [];
    setDeclarationMode((current) =>
      modes.includes(current) ? current : modes[0] || "partner",
    );
    if (!selected?.hasCustomNumberingText) setCustomNumberingText("");
  };

  const openBulkPartnerPicker = () => {
    if (!documentTypeId) {
      setInvalid((current) => [...new Set([...current, "documentType"])]);
      toast({
        message:
          "Vui lòng chọn loại hồ sơ trước khi lập danh sách nhiều đối tác.",
        title: "Chưa chọn loại hồ sơ",
        tone: "warning",
      });
      return;
    }
    if (!allowedDeclarationModes.includes("partner")) {
      toast({
        message: "Loại hồ sơ này không hỗ trợ khai báo theo Đối tác.",
        title: "Không dùng được chức năng này",
        tone: "warning",
      });
      return;
    }
    setShowBulkPartners(true);
  };

  const openBulkTextPicker = () => {
    if (!documentTypeId) {
      setInvalid((current) => [...new Set([...current, "documentType"])]);
      toast({
        message:
          "Vui lòng chọn loại hồ sơ trước khi dán danh sách nhiều chứng từ.",
        title: "Chưa chọn loại hồ sơ",
        tone: "warning",
      });
      return;
    }
    if (!allowedDeclarationModes.includes("detail")) {
      toast({
        message: "Loại hồ sơ này không hỗ trợ khai báo theo Chi tiết.",
        title: "Không dùng được chức năng này",
        tone: "warning",
      });
      return;
    }
    setShowBulkText(true);
  };

  const selectPartner = (item: SealPartnerOption | null) => {
    setPartner(item);
    setBulkPartnerIds([]);
    setInvalid((current) => current.filter((key) => key !== "declaration"));
    if (item && !customNumberingText) {
      setCustomNumberingText(
        item.shortName || item.employeeCode || item.name.split(/\s+/)[0] || "",
      );
    }
  };

  const buildItem = ({
    company,
    customText,
    documentType,
    entryMode,
    itemPartner,
    itemSecondaryCompany,
    mode: itemMode,
    otherLabel,
    qty,
    seals,
    signatureFile: itemSignatureFile,
    signaturePlacements: itemSignaturePlacements,
    signedAt,
    urgentItem,
  }: {
    company: SealCompanyOption;
    customText: string;
    documentType: SealDocumentTypeOption | null;
    entryMode: CartItem["entryMode"];
    itemPartner: SealPartnerOption | { detail: string; source?: string } | null;
    itemSecondaryCompany?: SealCompanyOption;
    mode: SealDeclarationMode;
    otherLabel?: string;
    qty: number;
    seals: string[];
    signatureFile?: File | null;
    signaturePlacements?: DigitalSignaturePlacement[];
    signedAt: string;
    urgentItem: boolean;
  }): CartItem => {
    const declaration =
      itemPartner && "detail" in itemPartner
        ? itemPartner.detail
        : itemPartner?.name || "";
    const condition = documentType?.condition || "";
    const typeLabel = otherLabel || documentType?.name || "Khác";
    return {
      companyId: company.id,
      companyLegalName: company.legalName,
      companyShort: company.shortName || company.code || company.legalName,
      condition,
      customNumberingText: customText.trim(),
      declarationTypes:
        documentType?.declarationTypes ||
        (["partner", "period", "detail"] as SealDeclarationMode[]),
      documentTypeChoice: documentType?.id || OTHER,
      documentTypeId: documentType?.id || "",
      entryMode,
      note: conditionNote(documentType, !documentType),
      partner: declaration,
      partnerAddress:
        itemPartner && !("detail" in itemPartner) ? itemPartner.address : "",
      partnerEmployeeCode:
        itemPartner && !("detail" in itemPartner)
          ? itemPartner.employeeCode
          : "",
      partnerIdentifier:
        itemPartner && !("detail" in itemPartner) ? itemPartner.taxId : "",
      partnerMode: itemMode,
      partnerSource:
        itemPartner && !("detail" in itemPartner)
          ? itemPartner.sourceType
          : itemPartner?.source || itemMode,
      quantity: qty,
      sealTypes: seals,
      secondaryCompanyId: itemSecondaryCompany?.id || "",
      secondaryCompanyName: itemSecondaryCompany?.legalName || "",
      signatureFile: itemSignatureFile || null,
      signatureFileName: itemSignatureFile?.name || "",
      signaturePlacements: itemSignaturePlacements || [],
      signDate: signedAt,
      takesNumber: documentType ? documentType.takesNumber : null,
      typeLabel,
      uid: nextId(),
      urgent: urgentItem,
    };
  };

  const addSingle = () => {
    const errors: string[] = [];
    const qty = Number(quantity);
    if (!documentTypeId) errors.push("documentType");
    if (documentTypeId === OTHER && !otherType.trim()) errors.push("otherType");
    if (!companyId) errors.push("company");
    if (!signDate) errors.push("signDate");
    if (!Number.isInteger(qty) || qty < 1) errors.push("quantity");

    const usesBulkPartners =
      declarationMode === "partner" && selectedBulkPartners.length > 0;
    const usesBulkText =
      declarationMode === "detail" && bulkTextValues.length > 0;
    if (
      declarationMode === "partner" &&
      !partner &&
      !selectedBulkPartners.length
    ) {
      errors.push("declaration");
    }
    if (declarationMode === "period" && !isPeriod(period)) {
      errors.push("declaration");
    }
    if (
      declarationMode === "detail" &&
      !normalizeDetail(detail) &&
      !bulkTextValues.length
    ) {
      errors.push("declaration");
    }

    const seals =
      (usesBulkPartners || usesBulkText) && !sealTypes.length
        ? ["Đóng chính"]
        : sealTypes;
    if (!seals.length) errors.push("seals");
    const usesDigitalSignature = seals.includes(DIGITAL_SIGNATURE);
    if (usesDigitalSignature && (usesBulkPartners || usesBulkText)) {
      toast({
        message:
          "Ký số chỉ cho phép tạo 01 hồ sơ trong mỗi lần nộp.",
        title: "Không thể dùng khai báo hàng loạt",
        tone: "warning",
      });
      return;
    }
    if (usesDigitalSignature && !signatureFile) {
      errors.push("signatureFile");
    }
    if (usesDigitalSignature && signatureFile &&
        (!signatureFile.name.toLocaleLowerCase("vi-VN").endsWith(".pdf") ||
          !["", "application/pdf"].includes(signatureFile.type))) {
      errors.push("signatureFile");
    }
    if (usesDigitalSignature &&
        (!signaturePlacements.length || signaturePlacements.length > 30)) {
      errors.push("signaturePlacements");
    }
    if (usesDigitalSignature && (cart.length || secondaryCompanyId)) {
      toast({
        message: cart.length
          ? "Hồ sơ Ký số phải được nộp riêng, không ghép với mục khác trong đơn."
          : "Ký số chỉ dùng một pháp nhân cho mỗi hồ sơ.",
        title: "Tách riêng hồ sơ Ký số",
        tone: "warning",
      });
      return;
    }
    if (!usesDigitalSignature && cart.some((item) => item.sealTypes.includes(DIGITAL_SIGNATURE))) {
      toast({
        message: "Đơn đang có hồ sơ Ký số nên không thể thêm loại đóng dấu khác.",
        title: "Tách riêng hồ sơ Ký số",
        tone: "warning",
      });
      return;
    }

    const effectiveCustom =
      customNumberingText.trim() ||
      partner?.shortName ||
      partner?.employeeCode ||
      partner?.name.split(/\s+/)[0] ||
      "";
    if (
      selectedDocumentType?.hasCustomNumberingText &&
      !effectiveCustom &&
      !usesBulkPartners
    ) {
      errors.push("customNumberingText");
    }

    if (errors.length || !selectedCompany) {
      setInvalid([...new Set(errors)]);
      toast({
        message:
          "Vui lòng hoàn tất các trường được đánh dấu trước khi thêm hồ sơ.",
        title: "Thiếu thông tin",
        tone: "error",
      });
      return;
    }

    let newItems: CartItem[] = [];
    if (usesBulkPartners) {
      newItems = selectedBulkPartners.map((item) =>
        buildItem({
          company: selectedCompany,
          customText:
            customNumberingText ||
            item.shortName ||
            item.employeeCode ||
            item.name.split(/\s+/)[0],
          documentType: selectedDocumentType,
          entryMode: "bulk-partner",
          itemPartner: item,
          itemSecondaryCompany: selectedSecondaryCompany,
          mode: "partner",
          otherLabel: documentTypeId === OTHER ? otherType.trim() : undefined,
          qty,
          seals,
          signedAt: signDate,
          urgentItem: urgent,
        }),
      );
    } else if (usesBulkText) {
      newItems = bulkTextValues.map((value) =>
        buildItem({
          company: selectedCompany,
          customText: effectiveCustom,
          documentType: selectedDocumentType,
          entryMode: "bulk-text",
          itemPartner: {
            detail: `Chứng từ số: ${value}`,
            source: "bulk-text",
          },
          itemSecondaryCompany: selectedSecondaryCompany,
          mode: "detail",
          otherLabel: documentTypeId === OTHER ? otherType.trim() : undefined,
          qty,
          seals,
          signedAt: signDate,
          urgentItem: urgent,
        }),
      );
    } else {
      const declaration =
        declarationMode === "partner"
          ? partner
          : {
              detail:
                declarationMode === "period"
                  ? period.trim()
                  : normalizeDetail(detail),
              source: declarationMode,
            };
      newItems = [
        buildItem({
          company: selectedCompany,
          customText: effectiveCustom,
          documentType: selectedDocumentType,
          entryMode: "single",
          itemPartner: declaration,
          itemSecondaryCompany: selectedSecondaryCompany,
          mode: declarationMode,
          otherLabel: documentTypeId === OTHER ? otherType.trim() : undefined,
          qty: usesDigitalSignature ? 1 : qty,
          seals,
          signatureFile,
          signaturePlacements,
          signedAt: signDate,
          urgentItem: urgent,
        }),
      ];
    }

    setCart((current) => [...current, ...newItems]);
    setInvalid([]);
    setDocumentTypeId("");
    setOtherType("");
    setPartner(null);
    setPeriod("");
    setDetail("");
    setCustomNumberingText("");
    setQuantity("1");
    setSealTypes([]);
    setSignatureFile(null);
    setSignaturePlacements([]);
    setBulkPartnerIds([]);
    setBulkTextRaw("");
    setBulkTextValues([]);
    toast({
      message:
        newItems.length === 1
          ? "Đã thêm hồ sơ vào đơn."
          : `Đã thêm ${newItems.length} hồ sơ vào đơn.`,
      title: "Đơn đã lên",
      tone: "success",
    });
  };

  const patchBatchRow = (uid: string, patch: Partial<BatchRow>) => {
    setBatchRows((current) =>
      current.map((row) => (row.uid === uid ? { ...row, ...patch } : row)),
    );
    setInvalid((current) => current.filter((key) => key !== `row:${uid}`));
  };

  const toggleBatchSeal = (uid: string, seal: string) => {
    const row = batchRows.find((item) => item.uid === uid);
    if (!row) return;
    const removing = row.sealTypes.includes(seal);
    patchBatchRow(uid, {
      sealTypes: removing
        ? row.sealTypes.filter((item) => item !== seal)
        : [...row.sealTypes, seal],
    });
  };

  const addBatch = () => {
    if (cart.some((item) => item.sealTypes.includes(DIGITAL_SIGNATURE))) {
      toast({
        message: "Đơn đang có hồ sơ Ký số nên không thể ghép thêm bộ hồ sơ đóng dấu.",
        title: "Tách riêng hồ sơ Ký số",
        tone: "warning",
      });
      return;
    }
    const errors: string[] = [];
    if (!batchPartner) errors.push("batchPartner");
    if (!batchCompanyId) errors.push("batchCompany");
    if (batchNeedsCustomText && !batchCustomText.trim()) {
      errors.push("batchCustomText");
    }
    for (const row of batchRows) {
      const qty = Number(row.quantity);
      const selected = docTypes.find((item) => item.id === row.documentTypeId);
      if (
        !row.documentTypeId ||
        (row.documentTypeId === OTHER && !row.otherType.trim()) ||
        (selected && !selected.declarationTypes.includes("partner")) ||
        !row.signDate ||
        !Number.isInteger(qty) ||
        qty < 1 ||
        !row.sealTypes.length
      ) {
        errors.push(`row:${row.uid}`);
      }
    }
    const company = companies.find((item) => item.id === batchCompanyId);
    const secondary = companies.find(
      (item) => item.id === batchSecondaryCompanyId,
    );
    if (errors.length || !company || !batchPartner) {
      setInvalid([...new Set(errors)]);
      toast({
        message:
          "Vui lòng hoàn tất Đối tác, pháp nhân và toàn bộ dòng hồ sơ trong bộ.",
        title: "Bộ hồ sơ chưa hoàn chỉnh",
        tone: "error",
      });
      return;
    }

    const items = batchRows.map((row) => {
      const documentType =
        docTypes.find((item) => item.id === row.documentTypeId) || null;
      return buildItem({
        company,
        customText:
          batchCustomText ||
          batchPartner.shortName ||
          batchPartner.employeeCode ||
          batchPartner.name.split(/\s+/)[0],
        documentType,
        entryMode: "partner-bundle",
        itemPartner: batchPartner,
        itemSecondaryCompany: secondary,
        mode: "partner",
        otherLabel:
          row.documentTypeId === OTHER ? row.otherType.trim() : undefined,
        qty: Number(row.quantity),
        seals: row.sealTypes,
        signedAt: row.signDate,
        urgentItem: false,
      });
    });
    setCart((current) => [...current, ...items]);
    setBatchRows([blankBatchRow()]);
    setBatchPartner(null);
    setBatchCustomText("");
    setInvalid([]);
    toast({
      message: `Đã thêm bộ ${items.length} hồ sơ vào đơn.`,
      title: "Đơn đã lên",
      tone: "success",
    });
  };

  const applySavedPartner = (item: SealPartnerOption) => {
    setPartners((current) => [
      item,
      ...current.filter((partnerItem) => partnerItem.id !== item.id),
    ]);
    if (addPartnerTarget === "batch") {
      setBatchPartner(item);
      if (!batchCustomText) setBatchCustomText(item.shortName || item.name);
    } else {
      selectPartner(item);
    }
    setAddPartnerTarget(null);
  };

  const payload = useMemo(() => {
    const office = selectedOffice;
    return JSON.stringify({
      items: cart.map((item) => {
        const company = companies.find(
          (companyItem) => companyItem.id === item.companyId,
        );
        const secondary = companies.find(
          (companyItem) => companyItem.id === item.secondaryCompanyId,
        );
        const companyNames = [
          company?.legalName || item.companyLegalName,
          secondary?.legalName || item.secondaryCompanyName,
        ].filter(Boolean);
        return {
          companyDisplayName: legalDisplay(company, secondary),
          companyId: item.companyId,
          companyName: item.companyLegalName,
          companyNames,
          companyShort: item.companyShort,
          customNumberingText: item.customNumberingText || undefined,
          date: item.signDate,
          documentCondition: item.condition,
          documentDeclarationTypes: item.declarationTypes,
          documentTypeChoice: item.documentTypeChoice,
          documentTypeId: item.documentTypeId || undefined,
          documentTypeName: item.typeLabel,
          digitalSignature: item.sealTypes.includes(DIGITAL_SIGNATURE),
          electronicSignature: item.sealTypes.includes(DIGITAL_SIGNATURE),
          entryMode: item.entryMode,
          isInternalLegalTransfer: Boolean(item.secondaryCompanyId),
          khuVucNop: office?.label,
          legalEntityTransfer: item.secondaryCompanyName || undefined,
          legalEntityValues: [item.companyId, item.secondaryCompanyId].filter(
            Boolean,
          ),
          loai: item.typeLabel,
          note: item.note,
          officeKey: office?.key,
          officeName: office?.label,
          otherType:
            item.documentTypeChoice === OTHER ? item.typeLabel : undefined,
          partner: item.partner,
          partnerAbbr: item.customNumberingText || undefined,
          partnerAddress: item.partnerAddress || undefined,
          partnerEmployeeCode: item.partnerEmployeeCode || undefined,
          partnerIdentifier: item.partnerIdentifier || undefined,
          partnerMode: item.partnerMode,
          partnerName: item.partner,
          partnerSource: item.partnerSource,
          phapNhan: item.companyLegalName,
          phapNhanDisplay: legalDisplay(company, secondary),
          phapNhanList: companyNames,
          primaryPhapNhan: item.companyLegalName,
          qty: item.quantity,
          quantity: item.quantity,
          sealTypes: item.sealTypes,
          secondaryCompanyId: item.secondaryCompanyId || undefined,
          secondaryCompanyName: item.secondaryCompanyName || undefined,
          secondaryPhapNhan: item.secondaryCompanyName || undefined,
          signDate: item.signDate,
          signatureClientFileName: item.sealTypes.includes(DIGITAL_SIGNATURE)
            ? item.signatureFileName
            : undefined,
          signaturePlacements: item.sealTypes.includes(DIGITAL_SIGNATURE)
            ? item.signaturePlacements
            : undefined,
          signatureStatus: item.sealTypes.includes(DIGITAL_SIGNATURE)
            ? "awaiting_upload"
            : undefined,
          stamps: item.sealTypes,
          submissionOffice: office?.label,
          submissionOfficeKey: office?.key,
          takesNumber: item.takesNumber,
          typeLabel: item.typeLabel,
          urgent: item.urgent,
        };
      }),
      officeKey: office?.key,
      officeName: office?.label,
      submissionOffice: office?.label,
      submissionOfficeKey: office?.key,
      urgent: cart.some((item) => item.urgent),
    });
  }, [cart, companies, selectedOffice]);

  const title =
    cart.length === 1
      ? `${cart[0].sealTypes.includes(DIGITAL_SIGNATURE) ? "Ký số" : "Đóng dấu"}: ${cart[0].typeLabel} - ${cart[0].partner}`
      : `Đóng dấu ${cart.length} hồ sơ`;

  const chooseOffice = (office: SealSubmissionOffice) => {
    submittedItems.current = [...cart];
    submittedOffice.current = office;
    submitRequested.current = true;
    setSelectedOffice(office);
    setShowOffice(false);
    toast({
      message: `Đang nộp ${cart.length} hồ sơ tại ${office.label}.`,
      title: "Đang xử lý",
      tone: "info",
    });
  };

  const retryElectronicSignatureUploads = async () => {
    if (!signatureUploadRetryCode || !submittedOffice.current) return;
    setUploadingSignatureFiles(true);
    submittedItems.current = [...cart];
    try {
      await uploadElectronicSignatureFiles(signatureUploadRetryCode, cart);
      setReceipt({
        code: signatureUploadRetryCode,
        items: [...cart],
        office: submittedOffice.current,
        submittedAt: state.submittedAt || new Date().toISOString(),
      });
      setCart([]);
      window.localStorage.removeItem(DRAFT_KEY);
      setSelectedOffice(null);
      setSignatureUploadRetryCode("");
      toast({
        message: `Đã nạp đủ file ký điện tử cho ${signatureUploadRetryCode}.`,
        title: "Đã hoàn tất nộp hồ sơ",
        tone: "success",
      });
    } catch (error) {
      toast({
        message:
          error instanceof Error
            ? error.message
            : "Không nạp đủ file ký điện tử.",
        title: "Tải file chưa thành công",
        tone: "error",
      });
    } finally {
      setUploadingSignatureFiles(false);
    }
  };

  return (
    <>
      <WriteLoadingOverlay show={pending || uploadingSignatureFiles} />
      <div className={styles.workspace}>
        <section className={styles.panel}>
          <header className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>Tạo đề nghị</h2>
            <FileText size={19} />
          </header>
          <div className={styles.panelBody}>
            <div
              aria-label="Chế độ tạo đề nghị"
              className={styles.tabs}
              role="tablist"
            >
              {(
                [
                  ["single", "Hồ sơ lẻ"],
                  ["batch", "Bộ hồ sơ theo Đối tác"],
                ] as const
              ).map(([key, label]) => (
                <button
                  aria-selected={mode === key}
                  className={`${styles.tab} ${
                    mode === key ? styles.tabActive : ""
                  }`}
                  key={key}
                  onClick={() => {
                    setMode(key);
                    setInvalid([]);
                  }}
                  role="tab"
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>

            {mode === "single" ? (
              <>
                <div className={styles.formGrid}>
                  <Field
                    invalid={invalid.includes("documentType")}
                    label="Loại hồ sơ"
                    required
                    span
                  >
                    <DocumentTypeCombobox
                      docTypes={docTypes}
                      invalid={invalid.includes("documentType")}
                      onChange={setSingleDocumentType}
                      value={documentTypeId}
                    />
                  </Field>

                  {documentTypeId === OTHER ? (
                    <Field
                      invalid={invalid.includes("otherType")}
                      label="Loại hồ sơ của bạn"
                      required
                      span
                    >
                      <input
                        className={styles.input}
                        onChange={(event) => {
                          setOtherType(event.target.value);
                          setInvalid((current) =>
                            current.filter((item) => item !== "otherType"),
                          );
                        }}
                        placeholder="Nhập tên loại hồ sơ"
                        value={otherType}
                      />
                    </Field>
                  ) : null}

                  <Field
                    invalid={invalid.includes("declaration")}
                    label="Khai báo"
                    required
                    span
                  >
                    <div className={styles.modeChoices} role="radiogroup">
                      {(
                        ["partner", "period", "detail"] as SealDeclarationMode[]
                      ).map((itemMode) => (
                        <button
                          aria-checked={declarationMode === itemMode}
                          className={`${styles.modeChoice} ${
                            declarationMode === itemMode
                              ? styles.modeChoiceActive
                              : ""
                          }`}
                          disabled={!allowedDeclarationModes.includes(itemMode)}
                          key={itemMode}
                          onClick={() => {
                            setDeclarationMode(itemMode);
                            setInvalid((current) =>
                              current.filter((item) => item !== "declaration"),
                            );
                          }}
                          role="radio"
                          type="button"
                        >
                          {DECLARATION_LABEL[itemMode]}
                        </button>
                      ))}
                    </div>
                    {declarationMode === "partner" ? (
                      <>
                        {selectedBulkPartners.length ? (
                          <div className={styles.selectedChips}>
                            {selectedBulkPartners.map((item) => (
                              <span
                                className={styles.selectedChip}
                                key={item.id}
                              >
                                {item.label}
                                <button
                                  aria-label={`Bỏ ${item.label}`}
                                  onClick={() =>
                                    setBulkPartnerIds((current) =>
                                      current.filter((id) => id !== item.id),
                                    )
                                  }
                                  type="button"
                                >
                                  <X size={11} />
                                </button>
                              </span>
                            ))}
                          </div>
                        ) : (
                          <PartnerCombobox
                            invalid={invalid.includes("declaration")}
                            onAdd={() => setAddPartnerTarget("single")}
                            onChange={selectPartner}
                            partners={partners}
                            value={partner}
                          />
                        )}
                        <div className={styles.declarationTools}>
                          <button
                            aria-label="Chọn nhiều đối tác"
                            className={`${styles.workflowAction} ${
                              selectedBulkPartners.length
                                ? styles.workflowActionActive
                                : ""
                            }`}
                            onClick={openBulkPartnerPicker}
                            type="button"
                          >
                            <span className={styles.workflowActionIcon}>
                              <Users size={21} />
                              <ListChecks
                                className={styles.workflowActionIconBadge}
                                size={12}
                              />
                            </span>
                            <span className={styles.workflowActionCopy}>
                              <span className={styles.workflowActionEyebrow}>
                                Tạo hàng loạt
                              </span>
                              <strong>Chọn nhiều đối tác</strong>
                              <small>
                                Tạo đồng thời một hồ sơ cho mỗi đối tác
                              </small>
                            </span>
                            <span className={styles.workflowActionState}>
                              {selectedBulkPartners.length
                                ? `${selectedBulkPartners.length} đã chọn`
                                : "Mở danh sách"}
                            </span>
                          </button>
                          {selectedBulkPartners.length ? (
                            <button
                              className={`${styles.button} ${styles.buttonSecondary}`}
                              onClick={() => {
                                setBulkPartnerIds([]);
                                setPartner(null);
                              }}
                              type="button"
                            >
                              Chọn lại một đối tác
                            </button>
                          ) : null}
                        </div>
                      </>
                    ) : declarationMode === "period" ? (
                      <input
                        className={styles.input}
                        inputMode="numeric"
                        onChange={(event) => {
                          setPeriod(formatPeriodInput(event.target.value));
                          setInvalid((current) =>
                            current.filter((item) => item !== "declaration"),
                          );
                        }}
                        placeholder="MM/YYYY"
                        value={period}
                      />
                    ) : (
                      <>
                        {bulkTextValues.length ? (
                          <div className={styles.selectedChips}>
                            {bulkTextValues.slice(0, 18).map((value) => (
                              <span className={styles.selectedChip} key={value}>
                                {value}
                              </span>
                            ))}
                            {bulkTextValues.length > 18 ? (
                              <span className={styles.selectedChip}>
                                +{bulkTextValues.length - 18}
                              </span>
                            ) : null}
                          </div>
                        ) : (
                          <>
                            <div className={styles.detailInputGroup}>
                              <span
                                aria-hidden="true"
                                className={styles.detailPrefix}
                              >
                                {DETAIL_PREFIX}
                              </span>
                              <input
                                aria-label="Nội dung chi tiết"
                                className={styles.detailInput}
                                onChange={(event) => {
                                  setDetail(
                                    stripDetailPrefix(event.target.value),
                                  );
                                  setInvalid((current) =>
                                    current.filter(
                                      (item) => item !== "declaration",
                                    ),
                                  );
                                }}
                                placeholder="Nhập nội dung chi tiết..."
                                value={detail}
                              />
                            </div>
                            <div className={styles.detailPrefixHint}>
                              “Về việc” là tiền tố cố định và sẽ luôn được lưu
                              cùng nội dung chi tiết.
                            </div>
                          </>
                        )}
                        <div className={styles.declarationTools}>
                          <button
                            aria-label="Danh sách nhiều chứng từ"
                            className={`${styles.workflowAction} ${
                              bulkTextValues.length
                                ? styles.workflowActionActive
                                : ""
                            }`}
                            onClick={openBulkTextPicker}
                            type="button"
                          >
                            <span className={styles.workflowActionIcon}>
                              <Files size={21} />
                              <ClipboardPaste
                                className={styles.workflowActionIconBadge}
                                size={12}
                              />
                            </span>
                            <span className={styles.workflowActionCopy}>
                              <span className={styles.workflowActionEyebrow}>
                                Tạo hàng loạt
                              </span>
                              <strong>Danh sách nhiều chứng từ</strong>
                              <small>
                                Dán một cột từ Excel để tạo hàng loạt
                              </small>
                            </span>
                            <span className={styles.workflowActionState}>
                              {bulkTextValues.length
                                ? `${bulkTextValues.length} chứng từ`
                                : "Dán danh sách"}
                            </span>
                          </button>
                          {bulkTextValues.length ? (
                            <button
                              className={`${styles.button} ${styles.buttonSecondary}`}
                              onClick={() => {
                                setBulkTextRaw("");
                                setBulkTextValues([]);
                              }}
                              type="button"
                            >
                              Nhập một chi tiết
                            </button>
                          ) : null}
                        </div>
                      </>
                    )}
                  </Field>

                  {selectedDocumentType?.hasCustomNumberingText ? (
                    <Field
                      hint="Nội dung này được dùng trong quy cách cấp số."
                      invalid={invalid.includes("customNumberingText")}
                      label="Tên viết tắt của đối tác"
                      required
                      span
                    >
                      <input
                        className={styles.input}
                        onChange={(event) => {
                          setCustomNumberingText(event.target.value);
                          setInvalid((current) =>
                            current.filter(
                              (item) => item !== "customNumberingText",
                            ),
                          );
                        }}
                        value={customNumberingText}
                      />
                    </Field>
                  ) : null}

                  <Field
                    invalid={invalid.includes("company")}
                    label="Pháp nhân ký"
                    required
                    span
                  >
                    <CompanyPicker
                      allowSecondary={!sealTypes.includes(DIGITAL_SIGNATURE)}
                      companies={companies}
                      invalid={invalid.includes("company")}
                      onChange={(value) => {
                        setCompanyId(value);
                        setInvalid((current) =>
                          current.filter((item) => item !== "company"),
                        );
                      }}
                      onSecondaryChange={setSecondaryCompanyId}
                      secondaryId={secondaryCompanyId}
                      value={companyId}
                    />
                  </Field>

                  <Field
                    invalid={invalid.includes("signDate")}
                    label="Ngày ký"
                    required
                  >
                    <input
                      className={styles.input}
                      onChange={(event) => {
                        setSignDate(event.target.value);
                        setInvalid((current) =>
                          current.filter((item) => item !== "signDate"),
                        );
                      }}
                      type="date"
                      value={signDate}
                    />
                  </Field>
                  <Field
                    invalid={invalid.includes("quantity")}
                    label="Số lượng"
                    required
                  >
                    <input
                      className={styles.input}
                      disabled={sealTypes.includes(DIGITAL_SIGNATURE)}
                      min={1}
                      onChange={(event) => {
                        setQuantity(event.target.value);
                        setInvalid((current) =>
                          current.filter((item) => item !== "quantity"),
                        );
                      }}
                      type="number"
                      value={sealTypes.includes(DIGITAL_SIGNATURE) ? "1" : quantity}
                    />
                  </Field>

                  <Field
                    invalid={invalid.includes("seals")}
                    label="Loại dấu"
                    required
                    span
                  >
                    <StampPicker
                      invalid={invalid.includes("seals")}
                      onChange={(value) => {
                        setSealTypes(value);
                        if (value.includes(DIGITAL_SIGNATURE)) {
                          setQuantity("1");
                          setSecondaryCompanyId("");
                        } else {
                          setSignatureFile(null);
                          setSignaturePlacements([]);
                        }
                        setInvalid((current) =>
                          current.filter((item) => item !== "seals"),
                        );
                      }}
                      value={sealTypes}
                    />
                  </Field>

                  {sealTypes.includes(DIGITAL_SIGNATURE) ? (
                    <Field
                      invalid={
                        invalid.includes("signatureFile") ||
                        invalid.includes("signaturePlacements")
                      }
                      label="PDF cần ký số và vị trí chữ ký"
                      required
                      span
                    >
                      <div className={styles.signatureFilePicker}>
                        <FilePicker
                          accept="application/pdf,.pdf"
                          emptyText="Chưa chọn PDF cần ký số."
                          maxFileSizeBytes={ELECTRONIC_SIGNATURE_MAX_FILE_BYTES}
                          maxFiles={1}
                          onFilesChange={(files) => {
                            const file = files[0] || null;
                            setSignatureFile(file);
                            setSignaturePlacements([]);
                            setInvalid((current) =>
                              current.filter(
                                (item) =>
                                  item !== "signatureFile" &&
                                  item !== "signaturePlacements",
                              ),
                            );
                          }}
                          triggerLabel="Chọn PDF cần ký"
                        />
                        <span className={styles.hint}>
                          Chỉ 01 PDF, tối đa 20 MB. Kéo trực tiếp trên tài liệu để
                          vẽ từ 01 đến 30 vùng ký.
                        </span>
                        {signatureFile ? (
                          <PdfSignatureEditor
                            companyName={selectedCompany?.legalName || ""}
                            file={signatureFile}
                            key={`${signatureFile.name}:${signatureFile.size}:${signatureFile.lastModified}`}
                            onChange={(value) => {
                              setSignaturePlacements(value);
                              if (value.length) {
                                setInvalid((current) =>
                                  current.filter(
                                    (item) => item !== "signaturePlacements",
                                  ),
                                );
                              }
                            }}
                            placements={signaturePlacements}
                          />
                        ) : null}
                      </div>
                    </Field>
                  ) : null}

                  <div className={`${styles.notice} ${styles.span2}`}>
                    <span className={styles.noticeDot} />
                    <span>
                      <strong>Lưu ý: </strong>
                      {selectedCondition}
                    </span>
                  </div>
                </div>

                <div className={styles.formFooter}>
                  <label className={styles.urgentToggle}>
                    <input
                      checked={urgent}
                      onChange={(event) => setUrgent(event.target.checked)}
                      type="checkbox"
                    />
                    Khẩn cấp
                  </label>
                  <div className={styles.footerActions}>
                    <Link
                      className={`${styles.button} ${styles.buttonSecondary}`}
                      href="/"
                    >
                      Quay lại dashboard
                    </Link>
                    <button
                      className={`${styles.button} ${styles.buttonPrimary}`}
                      onClick={addSingle}
                      type="button"
                    >
                      <Plus size={15} /> Thêm mục
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className={styles.batchTop}>
                  <Field
                    invalid={invalid.includes("batchPartner")}
                    label="Đối tác"
                    required
                  >
                    <PartnerCombobox
                      invalid={invalid.includes("batchPartner")}
                      onAdd={() => setAddPartnerTarget("batch")}
                      onChange={(item) => {
                        setBatchPartner(item);
                        setInvalid((current) =>
                          current.filter((key) => key !== "batchPartner"),
                        );
                        if (item && !batchCustomText) {
                          setBatchCustomText(
                            item.shortName ||
                              item.employeeCode ||
                              item.name.split(/\s+/)[0],
                          );
                        }
                      }}
                      partners={partners}
                      value={batchPartner}
                    />
                  </Field>
                  {batchNeedsCustomText ? (
                    <Field
                      invalid={invalid.includes("batchCustomText")}
                      label="Tên viết tắt đối tác"
                      required
                    >
                      <input
                        className={styles.input}
                        onChange={(event) => {
                          setBatchCustomText(event.target.value);
                          setInvalid((current) =>
                            current.filter((key) => key !== "batchCustomText"),
                          );
                        }}
                        value={batchCustomText}
                      />
                    </Field>
                  ) : (
                    <div />
                  )}
                </div>
                <div style={{ marginTop: 12 }}>
                  <div className={styles.label}>
                    Pháp nhân đóng dấu{" "}
                    <span className={styles.required}>*</span>
                  </div>
                  <CompanyPicker
                    companies={companies}
                    invalid={invalid.includes("batchCompany")}
                    onChange={(value) => {
                      setBatchCompanyId(value);
                      setInvalid((current) =>
                        current.filter((key) => key !== "batchCompany"),
                      );
                    }}
                    onSecondaryChange={setBatchSecondaryCompanyId}
                    secondaryId={batchSecondaryCompanyId}
                    value={batchCompanyId}
                  />
                </div>

                <div className={styles.batchTableWrap}>
                  <table className={styles.batchTable}>
                    <thead>
                      <tr>
                        <th style={{ width: "25%" }}>Loại hồ sơ</th>
                        <th style={{ width: "16%" }}>Ngày ký</th>
                        <th style={{ width: "8%" }}>SL</th>
                        <th style={{ width: "28%" }}>Loại dấu</th>
                        <th style={{ width: "18%" }}>Lưu ý</th>
                        <th style={{ width: "5%" }} />
                      </tr>
                    </thead>
                    <tbody>
                      {batchRows.map((row) => {
                        const rowInvalid = invalid.includes(`row:${row.uid}`);
                        const selected = docTypes.find(
                          (item) => item.id === row.documentTypeId,
                        );
                        const note = conditionNote(
                          selected || null,
                          row.documentTypeId === OTHER,
                        );
                        return (
                          <tr key={row.uid}>
                            <td>
                              <select
                                className={`${styles.tableSelect} ${
                                  rowInvalid ? styles.tableInvalid : ""
                                }`}
                                onChange={(event) =>
                                  patchBatchRow(row.uid, {
                                    documentTypeId: event.target.value,
                                    otherType:
                                      event.target.value === OTHER
                                        ? row.otherType
                                        : "",
                                  })
                                }
                                value={row.documentTypeId}
                              >
                                <option value="">Chọn loại hồ sơ</option>
                                {docTypes
                                  .filter((item) =>
                                    item.declarationTypes.includes("partner"),
                                  )
                                  .map((item) => (
                                    <option key={item.id} value={item.id}>
                                      {item.name}
                                    </option>
                                  ))}
                                <option value={OTHER}>Khác</option>
                              </select>
                              {row.documentTypeId === OTHER ? (
                                <input
                                  className={`${styles.tableInput} ${
                                    rowInvalid ? styles.tableInvalid : ""
                                  }`}
                                  onChange={(event) =>
                                    patchBatchRow(row.uid, {
                                      otherType: event.target.value,
                                    })
                                  }
                                  placeholder="Tên hồ sơ khác"
                                  style={{ marginTop: 5 }}
                                  value={row.otherType}
                                />
                              ) : null}
                            </td>
                            <td>
                              <input
                                className={`${styles.tableInput} ${
                                  rowInvalid ? styles.tableInvalid : ""
                                }`}
                                onChange={(event) =>
                                  patchBatchRow(row.uid, {
                                    signDate: event.target.value,
                                  })
                                }
                                type="date"
                                value={row.signDate}
                              />
                            </td>
                            <td>
                              <input
                                className={`${styles.tableInput} ${
                                  rowInvalid ? styles.tableInvalid : ""
                                }`}
                                min={1}
                                onChange={(event) =>
                                  patchBatchRow(row.uid, {
                                    quantity: event.target.value,
                                  })
                                }
                                type="number"
                                value={row.quantity}
                              />
                            </td>
                            <td>
                              <div className={styles.tableStamps}>
                                {PHYSICAL_SEAL_TYPES.map((seal) => (
                                  <button
                                    aria-pressed={row.sealTypes.includes(seal)}
                                    className={`${styles.tableStamp} ${
                                      row.sealTypes.includes(seal)
                                        ? styles.tableStampActive
                                        : ""
                                    }`}
                                    key={seal}
                                    onClick={() =>
                                      toggleBatchSeal(row.uid, seal)
                                    }
                                    type="button"
                                  >
                                    {seal}
                                  </button>
                                ))}
                              </div>
                            </td>
                            <td>
                              <div className={styles.tableNote}>
                                <span
                                  className={`${styles.statusDot} ${statusTone(
                                    selected?.condition || "",
                                  )}`}
                                />
                                <span>{note}</span>
                              </div>
                            </td>
                            <td>
                              <button
                                aria-label="Xóa dòng"
                                className={styles.cartDelete}
                                disabled={batchRows.length <= 1}
                                onClick={() =>
                                  setBatchRows((current) =>
                                    current.filter(
                                      (item) => item.uid !== row.uid,
                                    ),
                                  )
                                }
                                style={{ position: "static" }}
                                type="button"
                              >
                                <Trash2 size={13} />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <button
                    className={styles.addRowButton}
                    onClick={() =>
                      setBatchRows((current) => [...current, blankBatchRow()])
                    }
                    type="button"
                  >
                    <Plus size={14} /> Thêm dòng
                  </button>
                </div>

                <div className={styles.formFooter}>
                  <span className={styles.hint}>
                    Mỗi dòng phải có loại hồ sơ, ngày ký, số lượng và loại dấu.
                  </span>
                  <div className={styles.footerActions}>
                    <Link
                      className={`${styles.button} ${styles.buttonSecondary}`}
                      href="/"
                    >
                      Quay lại dashboard
                    </Link>
                    <button
                      className={`${styles.button} ${styles.buttonPrimary}`}
                      onClick={addBatch}
                      type="button"
                    >
                      <Plus size={15} /> Thêm bộ vào đơn
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </section>

        <aside className={styles.panel}>
          <header className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>Đơn đã lên</h2>
            <span className={styles.countBadge}>{cart.length}</span>
          </header>
          <div className={styles.cartBody}>
            {!cart.length ? (
              <div className={styles.emptyCart}>
                <div>
                  <div className={styles.emptyCartIcon}>
                    <FileText size={24} />
                  </div>
                  <strong>Chưa có mục nào</strong>
                  <div className={styles.hint}>
                    Hoàn tất biểu mẫu bên trái rồi bấm “Thêm mục”.
                  </div>
                </div>
              </div>
            ) : (
              <div className={styles.cartList}>
                {cart.map((item) => (
                  <article
                    className={`${styles.cartCard} ${
                      item.urgent ? styles.cartCardUrgent : ""
                    }`}
                    key={item.uid}
                  >
                    <div className={styles.cartTitle}>
                      {item.typeLabel}
                      {item.urgent ? (
                        <span className={styles.urgentTag}>Khẩn</span>
                      ) : null}
                    </div>
                    <button
                      aria-label={`Xóa ${item.typeLabel}`}
                      className={styles.cartDelete}
                      onClick={() => {
                        setCart((current) =>
                          current.filter(
                            (cartItem) => cartItem.uid !== item.uid,
                          ),
                        );
                        toast({
                          message: "Đã xóa hồ sơ khỏi đơn.",
                          title: "Đơn đã lên",
                          tone: "info",
                        });
                      }}
                      type="button"
                    >
                      <Trash2 size={13} />
                    </button>
                    <div className={styles.cartMeta}>
                      <div className={styles.cartMetaItem}>
                        <span className={styles.cartKey}>Pháp nhân</span>
                        <span className={styles.cartValue}>
                          {item.companyLegalName}
                          {item.secondaryCompanyName
                            ? ` → ${item.secondaryCompanyName}`
                            : ""}
                        </span>
                      </div>
                      <div className={styles.cartMetaItem}>
                        <span className={styles.cartKey}>Ngày ký · SL</span>
                        <span className={styles.cartValue}>
                          {formatDate(item.signDate)} · {item.quantity}
                        </span>
                      </div>
                      <div className={styles.cartMetaItemWide}>
                        <span className={styles.cartKey}>Loại dấu</span>
                        <span className={styles.cartValue}>
                          {item.sealTypes.join(", ")}
                        </span>
                      </div>
                      {item.sealTypes.includes(DIGITAL_SIGNATURE) ? (
                        <div className={styles.cartMetaItemWide}>
                          <span className={styles.cartKey}>
                            PDF và vùng ký số
                          </span>
                          <div className={styles.cartSignatureFile}>
                            <FilePicker
                              accept="application/pdf,.pdf"
                              emptyText={
                                item.signatureFile
                                  ? item.signatureFile.name
                                  : item.signatureFileName
                                    ? `${item.signatureFileName} · cần chọn lại PDF và vẽ lại vùng ký sau khi khôi phục đơn nháp`
                                    : "Chưa chọn PDF cần ký số."
                              }
                              maxFileSizeBytes={
                                ELECTRONIC_SIGNATURE_MAX_FILE_BYTES
                              }
                              maxFiles={1}
                              onFilesChange={(files) =>
                                setCart((current) =>
                                  current.map((cartItem) =>
                                    cartItem.uid === item.uid
                                      ? {
                                          ...cartItem,
                                          signatureFile: files[0] || null,
                                          signatureFileName:
                                            files[0]?.name || "",
                                          signaturePlacements: [],
                                        }
                                      : cartItem,
                                  ),
                                )
                              }
                              triggerLabel={
                                item.signatureFile ? "Đổi PDF" : "Chọn PDF"
                              }
                            />
                            {item.signatureFile ? (
                              <PdfSignatureEditor
                                companyName={item.companyLegalName}
                                file={item.signatureFile}
                                key={`${item.uid}:${item.signatureFile.name}:${item.signatureFile.size}:${item.signatureFile.lastModified}`}
                                onChange={(placements) =>
                                  setCart((current) =>
                                    current.map((cartItem) =>
                                      cartItem.uid === item.uid
                                        ? { ...cartItem, signaturePlacements: placements }
                                        : cartItem,
                                    ),
                                  )
                                }
                                placements={item.signaturePlacements}
                              />
                            ) : null}
                          </div>
                        </div>
                      ) : null}
                      <div className={styles.cartMetaItemWide}>
                        <span className={styles.cartKey}>
                          {DECLARATION_LABEL[item.partnerMode]}
                        </span>
                        <span className={styles.cartValue}>{item.partner}</span>
                      </div>
                      {item.customNumberingText ? (
                        <div className={styles.cartMetaItemWide}>
                          <span className={styles.cartKey}>
                            Tên viết tắt cấp số
                          </span>
                          <span className={styles.cartValue}>
                            {item.customNumberingText}
                          </span>
                        </div>
                      ) : null}
                      <div className={styles.cartMetaItemWide}>
                        <span className={styles.cartKey}>Lưu ý</span>
                        <span className={styles.cartValue}>{item.note}</span>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
          <div className={styles.cartFooter}>
            <button
              className={`${styles.button} ${styles.buttonAccent} ${styles.submitButton}`}
              disabled={pending || uploadingSignatureFiles || !cart.length}
              onClick={() => {
                if (!cart.length) {
                  toast({
                    message: "Đơn chưa có hồ sơ nào để nộp.",
                    title: "Không thể nộp",
                    tone: "error",
                  });
                  return;
                }
                const missingSignatureFile = cart.find(
                  (item) =>
                    item.sealTypes.includes(DIGITAL_SIGNATURE) &&
                    (!item.signatureFile || !item.signaturePlacements.length),
                );
                if (missingSignatureFile) {
                  toast({
                    message: `Hồ sơ “${missingSignatureFile.typeLabel}” cần chọn PDF và vẽ ít nhất một vùng ký số.`,
                    title: "Thiếu PDF hoặc vùng ký số",
                    tone: "error",
                  });
                  return;
                }
                if (signatureUploadRetryCode) {
                  void retryElectronicSignatureUploads();
                  return;
                }
                setShowOffice(true);
              }}
              type="button"
            >
              {pending || uploadingSignatureFiles
                ? "Đang nộp hồ sơ..."
                : signatureUploadRetryCode
                  ? "Tải lại PDF ký số"
                  : "Nộp hồ sơ"}
            </button>
            <form
              action={formAction}
              onSubmit={() => {
                submittedItems.current = [...cart];
                submittedOffice.current = selectedOffice;
              }}
              ref={formRef}
            >
              <input name="serviceCode" type="hidden" value="document-seal" />
              <input name="title" type="hidden" value={title} />
              <input name="payload" type="hidden" value={payload} />
              <input
                name="priority"
                type="hidden"
                value={
                  cart.some((item) => item.urgent) ? "Khẩn" : "Bình thường"
                }
              />
            </form>
          </div>
        </aside>
      </div>

      {addPartnerTarget ? (
        <AddPartnerDialog
          onClose={() => setAddPartnerTarget(null)}
          onSaved={applySavedPartner}
        />
      ) : null}
      {showBulkPartners ? (
        <BulkPartnerDialog
          initialIds={bulkPartnerIds}
          onApply={(ids) => {
            setBulkPartnerIds(ids);
            setPartner(null);
            setShowBulkPartners(false);
            setInvalid((current) =>
              current.filter((item) => item !== "declaration"),
            );
          }}
          onClose={() => setShowBulkPartners(false)}
          partners={partners}
        />
      ) : null}
      {showBulkText ? (
        <BulkTextDialog
          initialRaw={bulkTextRaw}
          onApply={(raw, values) => {
            setBulkTextRaw(raw);
            setBulkTextValues(values);
            setDetail("");
            setShowBulkText(false);
            setInvalid((current) =>
              current.filter((item) => item !== "declaration"),
            );
          }}
          onClose={() => setShowBulkText(false)}
        />
      ) : null}
      {showOffice ? (
        <Dialog
          onClose={() => setShowOffice(false)}
          title="Chọn khu vực nộp hồ sơ"
        >
          <div className={styles.notice} style={{ marginBottom: 12 }}>
            <AlertCircle size={16} />
            Chọn nơi ông sẽ nộp bản giấy. Khu vực này được dùng để Admin lọc và
            tiếp nhận đúng văn phòng.
          </div>
          <div className={styles.officeGrid}>
            {submissionOffices.map((office) => (
              <button
                className={styles.officeButton}
                key={office.key}
                onClick={() => chooseOffice(office)}
                type="button"
              >
                <Building2 size={27} />
                {office.label}
              </button>
            ))}
          </div>
        </Dialog>
      ) : null}
      {receipt ? (
        <ReceiptDialog
          currentUserName={currentUserName}
          onClose={() => setReceipt(null)}
          receipt={receipt}
        />
      ) : null}
    </>
  );
}
