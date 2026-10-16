"use client";

import Link from "next/link";
import {
  AlertCircle,
  CalendarDays,
  Check,
  FileCheck2,
  FileText,
  Printer,
  Search,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import {
  useActionState,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useToast, WriteLoadingOverlay } from "@/components/ui/toast";

import {
  previewAuthorizationLettersAction,
  submitAuthorizationLettersAction,
  type AuthorizationActionState,
} from "./actions";
import styles from "./cap-giay.module.css";
import type {
  AuthorizationCartItem,
  AuthorizationCompany,
  AuthorizationDocumentType,
  AuthorizationEmployee,
  AuthorizationPersonMode,
  AuthorizationPersonSnapshot,
  AuthorizationReceiptRow,
} from "./types";

const DRAFT_KEY = "authorization-letter-v3-draft";
const initialState: AuthorizationActionState = {};

function text(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalize(value: unknown) {
  return text(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/đ/gi, "d")
    .toLocaleLowerCase("vi-VN");
}

function formatDate(value: string) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Bangkok",
    year: "numeric",
  }).format(date);
}

function employeeSnapshot(
  employee: AuthorizationEmployee | null,
  source: "self" | "system",
  fallbackName = "",
): AuthorizationPersonSnapshot {
  return {
    birthDate: employee?.birthDate || "",
    companyId: employee?.companyId || "",
    companyName: employee?.companyName || "",
    department: employee?.department || "",
    email: employee?.email || "",
    employeeCode: employee?.employeeCode || "",
    employeeId: employee?.id || "",
    identityDate: employee?.identityDate || "",
    identityNumber: employee?.identityNumber || "",
    identityPlace: employee?.identityPlace || "",
    name: employee?.fullName || fallbackName,
    source,
    title: employee?.title || "",
  };
}

function openingDocument(title: string, note: string) {
  return `<!doctype html><html lang="vi"><head><meta charset="UTF-8"><title>${title}</title><style>body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#f5f6f1;color:#114c41;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px}.card{max-width:560px;background:#fff;border:1px solid #114c411a;border-radius:24px;padding:28px;box-shadow:0 18px 36px #0f2d2614}h1{margin:0 0 10px;font-size:22px}p{margin:0;line-height:1.6;color:#5f746f}.dot{display:inline-block;width:14px;height:14px;border-radius:999px;border:3px solid #d4196a3d;border-top-color:#d4196a;animation:spin .8s linear infinite;margin-right:10px;vertical-align:-2px}@keyframes spin{to{transform:rotate(360deg)}}</style></head><body><div class="card"><h1><span class="dot"></span>${title}</h1><p>${note}</p></div></body></html>`;
}

function openOutputWindow(title: string, note: string) {
  const output = window.open(
    "",
    `hcCapGiayPrintWindow-${Date.now()}`,
    "popup=yes,width=1180,height=920",
  );
  if (!output) return null;
  output.document.open();
  output.document.write(openingDocument(title, note));
  output.document.close();
  return output;
}

function Field({
  children,
  invalid = false,
  label,
  required = false,
  wide = false,
}: {
  children: React.ReactNode;
  invalid?: boolean;
  label: string;
  required?: boolean;
  wide?: boolean;
}) {
  return (
    <div
      className={`${styles.field} ${wide ? styles.span2 : ""} ${
        invalid ? styles.invalid : ""
      }`}
    >
      <div className={styles.label}>
        <span>
          {label}
          {required ? <span className={styles.required}> *</span> : null}
        </span>
      </div>
      {children}
    </div>
  );
}

function PersonPreview({
  empty,
  person,
}: {
  empty: string;
  person: AuthorizationPersonSnapshot | null;
}) {
  if (!person?.name) return <div className={styles.previewEmpty}>{empty}</div>;
  const rows = [
    ["Họ và tên", person.name],
    ["Bộ phận", person.department],
    ["Chức vụ", person.title],
    ["CCCD", person.identityNumber],
    ["Ngày sinh", formatDate(person.birthDate)],
    ["Ngày cấp", formatDate(person.identityDate)],
    ["Nơi cấp", person.identityPlace],
  ];
  return (
    <div className={styles.personPreview}>
      {rows.map(([label, value], index) => (
        <div
          className={index === rows.length - 1 ? styles.previewWide : ""}
          key={label}
        >
          <div className={styles.previewLabel}>{label}</div>
          <div className={styles.previewValue}>{value || "—"}</div>
        </div>
      ))}
    </div>
  );
}

function ReceiptDialog({
  currentUserName,
  onClose,
  printUrl,
  requestCode,
  rows,
}: {
  currentUserName: string;
  onClose: () => void;
  printUrl: string;
  requestCode: string;
  rows: AuthorizationReceiptRow[];
}) {
  const [seconds, setSeconds] = useState(3);
  useEffect(() => {
    const timer = window.setInterval(
      () => setSeconds((value) => Math.max(0, value - 1)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (seconds === 0) onClose();
  }, [onClose, seconds]);

  return (
    <div className={styles.dialogBackdrop} role="presentation">
      <section
        aria-labelledby="cap-giay-receipt-title"
        aria-modal="true"
        className={styles.receipt}
        role="dialog"
      >
        <div className={styles.receiptHead}>
          <div className={styles.receiptMark}>
            <Check size={25} />
          </div>
          <div>
            <h2 id="cap-giay-receipt-title">Đã gửi đăng ký cấp giấy</h2>
            <p>
              Mã đơn <strong>{requestCode}</strong> · Người tạo{" "}
              <strong>{currentUserName}</strong>
            </p>
          </div>
          <button
            aria-label="Đóng biên nhận"
            className={styles.iconButton}
            onClick={onClose}
            type="button"
          >
            <X size={17} />
          </button>
        </div>
        <div className={styles.receiptTableWrap}>
          <table className={styles.receiptTable}>
            <thead>
              <tr>
                <th>Loại giấy</th>
                <th>Pháp nhân</th>
                <th>Thời hạn</th>
                <th>Người được cấp</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={`${row.type}-${row.companies}-${index}`}>
                  <td>{row.type}</td>
                  <td>{row.companies}</td>
                  <td>{row.period}</td>
                  <td>{row.person}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className={styles.receiptFoot}>
          <span>Tự đóng sau {seconds} giây</span>
          <a
            className={`${styles.button} ${styles.buttonPrimary}`}
            href={printUrl}
            rel="noreferrer"
            target="_blank"
          >
            <Printer size={15} /> Mở lại bản in
          </a>
        </div>
      </section>
    </div>
  );
}

export function CapGiayForm({
  companies,
  currentUserName,
  docTypes,
  employees,
  selfEmployee,
}: {
  companies: AuthorizationCompany[];
  currentUserName: string;
  docTypes: AuthorizationDocumentType[];
  employees: AuthorizationEmployee[];
  selfEmployee: AuthorizationEmployee | null;
}) {
  const [state, formAction, pending] = useActionState(
    submitAuthorizationLettersAction,
    initialState,
  );
  const { toast } = useToast();
  const seenState = useRef<AuthorizationActionState | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const pendingPrintWindow = useRef<Window | null>(null);
  const uid = useRef(0);

  const [cart, setCart] = useState<AuthorizationCartItem[]>([]);
  const [selectedTypeId, setSelectedTypeId] = useState(docTypes[0]?.id || "");
  const [selectedCompanyIds, setSelectedCompanyIds] = useState<string[]>([]);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [reason, setReason] = useState("");
  const [personMode, setPersonMode] =
    useState<AuthorizationPersonMode>("self");
  const [selectedEmployee, setSelectedEmployee] =
    useState<AuthorizationEmployee | null>(null);
  const [employeeQuery, setEmployeeQuery] = useState("");
  const [employeeMenuOpen, setEmployeeMenuOpen] = useState(false);
  const [manual, setManual] = useState({
    birthDate: "",
    department: "",
    email: "",
    identityDate: "",
    identityNumber: "",
    identityPlace: "",
    name: "",
    title: "",
  });
  const [invalid, setInvalid] = useState<string[]>([]);
  const [previewing, setPreviewing] = useState(false);
  const [receipt, setReceipt] = useState<{
    printUrl: string;
    requestCode: string;
    rows: AuthorizationReceiptRow[];
  } | null>(null);

  const selfPerson = useMemo(
    () => employeeSnapshot(selfEmployee, "self", currentUserName),
    [currentUserName, selfEmployee],
  );
  const systemPerson = useMemo(
    () =>
      selectedEmployee
        ? employeeSnapshot(selectedEmployee, "system")
        : null,
    [selectedEmployee],
  );
  const selectedType = docTypes.find((item) => item.id === selectedTypeId);
  const searchKey = normalize(employeeQuery);
  const filteredEmployees = useMemo(
    () =>
      employees
        .filter((employee) => {
          if (!searchKey) return true;
          return normalize(
            [
              employee.fullName,
              employee.employeeCode,
              employee.department,
              employee.title,
              employee.companyName,
            ].join(" "),
          ).includes(searchKey);
        })
        .slice(0, 8),
    [employees, searchKey],
  );

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) {
        window.setTimeout(() => {
          setCart(parsed as AuthorizationCartItem[]);
          toast({
            message: `Đã khôi phục ${parsed.length} mục trong giỏ.`,
            title: "Khôi phục bản nháp",
            tone: "info",
          });
        }, 0);
      }
    } catch {
      window.localStorage.removeItem(DRAFT_KEY);
    }
  }, [toast]);

  useEffect(() => {
    try {
      if (cart.length) {
        window.localStorage.setItem(DRAFT_KEY, JSON.stringify(cart));
      } else {
        window.localStorage.removeItem(DRAFT_KEY);
      }
    } catch {
      // Trình duyệt có thể chặn localStorage; giỏ hiện tại vẫn hoạt động.
    }
  }, [cart]);

  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (!cart.length) return;
      event.preventDefault();
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [cart.length]);

  useEffect(() => {
    if (state === seenState.current) return;
    seenState.current = state;
    if (state.success && state.requestCode && state.printUrl) {
      toast({
        message: state.success,
        title: "Cấp giấy thành công",
        tone: "success",
      });
      if (pendingPrintWindow.current && !pendingPrintWindow.current.closed) {
        pendingPrintWindow.current.location.href = state.printUrl;
        pendingPrintWindow.current.focus();
      }
      pendingPrintWindow.current = null;
      window.setTimeout(() => {
        setCart([]);
        setReceipt({
          printUrl: state.printUrl!,
          requestCode: state.requestCode!,
          rows: state.receiptRows || [],
        });
      }, 0);
    } else if (state.error) {
      if (pendingPrintWindow.current && !pendingPrintWindow.current.closed) {
        pendingPrintWindow.current.close();
      }
      pendingPrintWindow.current = null;
      toast({
        message: state.error,
        title: "Không gửi được đăng ký",
        tone: "error",
      });
    }
  }, [state, toast]);

  const selectedPerson = useMemo<AuthorizationPersonSnapshot | null>(() => {
    if (personMode === "self") return selfPerson;
    if (personMode === "system") return systemPerson;
    return {
      birthDate: manual.birthDate,
      companyId: "",
      companyName: "",
      department: manual.department,
      email: manual.email,
      employeeCode: "",
      employeeId: "",
      identityDate: manual.identityDate,
      identityNumber: manual.identityNumber,
      identityPlace: manual.identityPlace,
      name: manual.name,
      source: "manual",
      title: manual.title,
    };
  }, [manual, personMode, selfPerson, systemPerson]);

  const formReady =
    Boolean(selectedTypeId) &&
    selectedCompanyIds.length > 0 &&
    Boolean(fromDate && toDate && fromDate <= toDate) &&
    Boolean(text(reason)) &&
    Boolean(selectedPerson?.name) &&
    (personMode !== "system" || Boolean(selectedEmployee)) &&
    (personMode !== "manual" ||
      Boolean(
        text(manual.name) &&
          text(manual.title) &&
          manual.birthDate &&
          text(manual.identityNumber) &&
          text(manual.identityPlace) &&
          manual.identityDate,
      ));

  const resetAfterAdd = () => {
    setSelectedCompanyIds([]);
    setFromDate("");
    setToDate("");
    setUrgent(false);
    setReason("");
    setPersonMode("self");
    setSelectedEmployee(null);
    setEmployeeQuery("");
    setManual({
      birthDate: "",
      department: "",
      email: "",
      identityDate: "",
      identityNumber: "",
      identityPlace: "",
      name: "",
      title: "",
    });
    setInvalid([]);
  };

  const addItem = () => {
    const nextInvalid: string[] = [];
    if (!selectedTypeId) nextInvalid.push("type");
    if (!selectedCompanyIds.length) nextInvalid.push("companies");
    if (!fromDate || !toDate || fromDate > toDate) nextInvalid.push("dates");
    if (!text(reason)) nextInvalid.push("reason");
    if (!selectedPerson?.name) nextInvalid.push("person");
    if (personMode === "system" && !selectedEmployee) nextInvalid.push("person");
    if (
      personMode === "manual" &&
      (!text(manual.name) ||
        !text(manual.title) ||
        !manual.birthDate ||
        !text(manual.identityNumber) ||
        !text(manual.identityPlace) ||
        !manual.identityDate)
    ) {
      nextInvalid.push("person");
    }
    setInvalid([...new Set(nextInvalid)]);
    if (nextInvalid.length || !selectedType || !selectedPerson) {
      toast({
        message:
          fromDate && toDate && fromDate > toDate
            ? "Ngày bắt đầu phải nhỏ hơn hoặc bằng ngày kết thúc."
            : "Vui lòng nhập đủ các trường bắt buộc trước khi thêm vào giỏ.",
        title: "Chưa thêm được vào giỏ",
        tone: "error",
      });
      return;
    }
    uid.current += 1;
    setCart((items) => [
      ...items,
      {
        companyIds: [...selectedCompanyIds],
        documentTypeId: selectedType.id,
        fromDate,
        person: selectedPerson,
        reason: text(reason),
        toDate,
        typeLabel: selectedType.name,
        uid: `letter-${Date.now()}-${uid.current}`,
        urgent,
      },
    ]);
    toast({
      message: `Đã thêm ${selectedCompanyIds.length} bản in theo pháp nhân.`,
      title: "Giỏ cấp giấy",
      tone: "success",
    });
    resetAfterAdd();
  };

  const previewAll = async () => {
    if (!cart.length) {
      toast({
        message: "Vui lòng thêm ít nhất một mục trước khi xem bản nháp.",
        title: "Chưa có dữ liệu",
        tone: "error",
      });
      return;
    }
    const output = openOutputWindow(
      "Đang dựng bản nháp",
      "Hệ thống đang chuẩn bị bản xem trước có watermark để ông đối chiếu nội dung.",
    );
    setPreviewing(true);
    try {
      const result = await previewAuthorizationLettersAction({ items: cart });
      if (!result.ok) throw new Error(result.error);
      if (output && !output.closed) {
        output.document.open();
        output.document.write(result.html);
        output.document.close();
        output.focus();
      } else {
        toast({
          message:
            "Trình duyệt đang chặn cửa sổ xem trước. Cho phép popup rồi thử lại.",
          title: "Không mở được bản nháp",
          tone: "warning",
        });
      }
    } catch (error) {
      if (output && !output.closed) output.close();
      toast({
        message:
          error instanceof Error ? error.message : "Vui lòng thử lại.",
        title: "Không dựng được bản nháp",
        tone: "error",
      });
    } finally {
      setPreviewing(false);
    }
  };

  const payload = JSON.stringify({ items: cart });
  const title =
    cart.length === 1
      ? `${cart[0].typeLabel}: ${cart[0].person.name}`
      : `Cấp ${cart.length} giấy Ủy quyền/Giới thiệu`;

  const submit = () => {
    if (!cart.length || pending) {
      toast({
        message: "Vui lòng thêm ít nhất một mục trước khi gửi.",
        title: "Chưa có dữ liệu",
        tone: "error",
      });
      return;
    }
    pendingPrintWindow.current = openOutputWindow(
      "Đang dựng bản in",
      "Hệ thống đang cấp số văn bản và chuẩn bị trang in cho ông.",
    );
    formRef.current?.requestSubmit();
  };

  return (
    <>
      <WriteLoadingOverlay
        message="Đang ghi đơn và cấp số văn bản..."
        show={pending}
      />
      <div className={styles.workspace}>
        <section className={styles.panel}>
          <header className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>Tạo đề nghị</h2>
            <span className={styles.moduleHint}>Hồ sơ pháp lý</span>
          </header>
          <div className={styles.panelBody}>
            <Field
              invalid={invalid.includes("type")}
              label="Loại giấy"
              required
            >
              <div className={styles.chipGroup}>
                {docTypes.map((item) => (
                  <button
                    aria-pressed={selectedTypeId === item.id}
                    className={`${styles.chip} ${
                      selectedTypeId === item.id ? styles.chipActive : ""
                    }`}
                    key={item.id}
                    onClick={() => {
                      setSelectedTypeId(item.id);
                      setInvalid((items) =>
                        items.filter((key) => key !== "type"),
                      );
                    }}
                    type="button"
                  >
                    <FileText size={15} />
                    {item.name}
                  </button>
                ))}
              </div>
            </Field>

            <Field
              invalid={invalid.includes("companies")}
              label="Pháp nhân áp dụng"
              required
            >
              <div className={styles.companyGrid}>
                {companies.map((company) => {
                  const active = selectedCompanyIds.includes(company.id);
                  return (
                    <button
                      aria-pressed={active}
                      className={`${styles.companyCard} ${
                        active ? styles.companyCardActive : ""
                      }`}
                      key={company.id}
                      onClick={() => {
                        setSelectedCompanyIds((ids) =>
                          ids.includes(company.id)
                            ? ids.filter((id) => id !== company.id)
                            : [...ids, company.id],
                        );
                        setInvalid((items) =>
                          items.filter((key) => key !== "companies"),
                        );
                      }}
                      type="button"
                    >
                      <span className={styles.companyCheck}>
                        {active ? <Check size={12} /> : null}
                      </span>
                      <strong>{company.legalName}</strong>
                      <small>{company.representativeName || "Chưa cấu hình người đại diện"}</small>
                    </button>
                  );
                })}
              </div>
              <p className={styles.hint}>
                Có thể chọn nhiều pháp nhân. Hệ thống tự tách thành từng bản in
                riêng.
              </p>
            </Field>

            <div className={styles.formGrid}>
              <Field
                invalid={invalid.includes("dates")}
                label="Từ ngày"
                required
              >
                <div className={styles.inputWithIcon}>
                  <CalendarDays size={15} />
                  <input
                    className={styles.input}
                    onChange={(event) => {
                      const value = event.target.value;
                      setFromDate(value);
                      if (toDate && value > toDate) setToDate(value);
                      setInvalid((items) =>
                        items.filter((key) => key !== "dates"),
                      );
                    }}
                    type="date"
                    value={fromDate}
                  />
                </div>
              </Field>
              <Field
                invalid={invalid.includes("dates")}
                label="Đến ngày"
                required
              >
                <div className={styles.inputWithIcon}>
                  <CalendarDays size={15} />
                  <input
                    className={styles.input}
                    min={fromDate}
                    onChange={(event) => {
                      setToDate(event.target.value);
                      setInvalid((items) =>
                        items.filter((key) => key !== "dates"),
                      );
                    }}
                    type="date"
                    value={toDate}
                  />
                </div>
              </Field>
              <Field label="Mức ưu tiên" wide>
                <label className={styles.switch}>
                  <input
                    checked={urgent}
                    onChange={(event) => setUrgent(event.target.checked)}
                    type="checkbox"
                  />
                  <span>Khẩn cấp</span>
                </label>
              </Field>
              <Field
                invalid={invalid.includes("reason")}
                label="Lý do"
                required
                wide
              >
                <textarea
                  className={styles.textarea}
                  maxLength={4000}
                  onChange={(event) => {
                    setReason(event.target.value);
                    setInvalid((items) =>
                      items.filter((key) => key !== "reason"),
                    );
                  }}
                  placeholder="Ghi rõ lý do sử dụng giấy hoặc nội dung cần giới thiệu..."
                  value={reason}
                />
              </Field>
            </div>

            <section
              className={`${styles.personShell} ${
                invalid.includes("person") ? styles.invalidShell : ""
              }`}
            >
              <div className={styles.label}>
                <span>
                  Người được Ủy quyền / Giới thiệu
                  <span className={styles.required}> *</span>
                </span>
              </div>
              <div className={styles.modeGroup}>
                {[
                  ["self", "Là tôi"],
                  ["system", "Chọn nhân sự hệ thống"],
                  ["manual", "Nhập tay"],
                ].map(([value, label]) => (
                  <button
                    aria-pressed={personMode === value}
                    className={`${styles.modeButton} ${
                      personMode === value ? styles.modeButtonActive : ""
                    }`}
                    key={value}
                    onClick={() => {
                      setPersonMode(value as AuthorizationPersonMode);
                      setInvalid((items) =>
                        items.filter((key) => key !== "person"),
                      );
                    }}
                    type="button"
                  >
                    <UserRound size={14} />
                    {label}
                  </button>
                ))}
              </div>

              {personMode === "self" ? (
                <PersonPreview
                  empty="Hệ thống sẽ lấy thông tin người đăng nhập để in lên giấy."
                  person={selfPerson}
                />
              ) : null}
              {personMode === "system" ? (
                <div className={styles.systemPicker}>
                  <div className={styles.searchBox}>
                    <Search size={16} />
                    <input
                      autoComplete="off"
                      onBlur={() =>
                        window.setTimeout(() => setEmployeeMenuOpen(false), 140)
                      }
                      onChange={(event) => {
                        setEmployeeQuery(event.target.value);
                        setSelectedEmployee(null);
                        setEmployeeMenuOpen(true);
                      }}
                      onFocus={() => setEmployeeMenuOpen(true)}
                      placeholder="Gõ tên, mã nhân sự hoặc bộ phận để tìm nhanh"
                      value={
                        selectedEmployee
                          ? `${selectedEmployee.fullName} · ${selectedEmployee.employeeCode}`
                          : employeeQuery
                      }
                    />
                    {selectedEmployee ? (
                      <button
                        aria-label="Bỏ chọn nhân sự"
                        onClick={() => {
                          setSelectedEmployee(null);
                          setEmployeeQuery("");
                        }}
                        type="button"
                      >
                        <X size={14} />
                      </button>
                    ) : null}
                  </div>
                  {employeeMenuOpen ? (
                    <div className={styles.searchMenu}>
                      {filteredEmployees.length ? (
                        filteredEmployees.map((employee) => (
                          <button
                            key={employee.id}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => {
                              setSelectedEmployee(employee);
                              setEmployeeQuery("");
                              setEmployeeMenuOpen(false);
                              setInvalid((items) =>
                                items.filter((key) => key !== "person"),
                              );
                            }}
                            type="button"
                          >
                            <strong>{employee.fullName}</strong>
                            <small>
                              {[
                                employee.employeeCode,
                                employee.title,
                                employee.department,
                              ]
                                .filter(Boolean)
                                .join(" • ")}
                            </small>
                          </button>
                        ))
                      ) : (
                        <div className={styles.previewEmpty}>
                          Không tìm thấy nhân sự phù hợp.
                        </div>
                      )}
                    </div>
                  ) : null}
                  <PersonPreview
                    empty="Chọn nhân sự hệ thống để tự điền thông tin cá nhân."
                    person={systemPerson}
                  />
                </div>
              ) : null}
              {personMode === "manual" ? (
                <div className={styles.manualGrid}>
                  {[
                    ["name", "Họ và tên", "text", true],
                    ["department", "Bộ phận", "text", false],
                    ["title", "Chức vụ", "text", true],
                    ["birthDate", "Ngày sinh", "date", true],
                    ["identityNumber", "Số CCCD", "text", true],
                    ["identityPlace", "Nơi cấp CCCD", "text", true],
                    ["identityDate", "Ngày cấp CCCD", "date", true],
                    ["email", "Email", "email", false],
                  ].map(([key, label, type, required]) => (
                    <label className={styles.manualField} key={key as string}>
                      <span>
                        {label}
                        {required ? (
                          <span className={styles.required}> *</span>
                        ) : null}
                      </span>
                      <input
                        className={styles.input}
                        onChange={(event) =>
                          setManual((current) => ({
                            ...current,
                            [key as string]: event.target.value,
                          }))
                        }
                        type={type as string}
                        value={manual[key as keyof typeof manual]}
                      />
                    </label>
                  ))}
                </div>
              ) : null}
            </section>

            <div className={styles.formFooter}>
              <span className={styles.hint}>
                Số văn bản được giữ khi nộp và mở bản in. Đơn bị hủy sẽ trả số
                về đúng quy cách.
              </span>
              <button
                className={`${styles.button} ${styles.buttonPrimary}`}
                disabled={!formReady}
                onClick={addItem}
                type="button"
              >
                <FileCheck2 size={16} />
                Thêm vào giỏ
              </button>
            </div>
          </div>
        </section>

        <aside className={styles.panel}>
          <header className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>Giỏ cấp giấy</h2>
            <span className={styles.countBadge}>{cart.length}</span>
          </header>
          <div className={styles.cartBody}>
            {!cart.length ? (
              <div className={styles.emptyCart}>
                <div className={styles.emptyIcon}>
                  <FileText size={25} />
                </div>
                <strong>Chưa có mục nào trong giỏ</strong>
                <span>
                  Mỗi pháp nhân sẽ sinh ra một bản in riêng sau khi gửi.
                </span>
              </div>
            ) : (
              <div className={styles.cartList}>
                {cart.map((item) => {
                  const selectedCompanies = item.companyIds
                    .map(
                      (id) =>
                        companies.find((company) => company.id === id)
                          ?.legalName,
                    )
                    .filter(Boolean);
                  return (
                    <article
                      className={`${styles.cartCard} ${
                        item.urgent ? styles.cartCardUrgent : ""
                      }`}
                      key={item.uid}
                    >
                      <div className={styles.cartHead}>
                        <div>
                          <h3>{item.typeLabel}</h3>
                          <div className={styles.tags}>
                            <span>{item.companyIds.length} pháp nhân</span>
                            {item.urgent ? <em>Khẩn cấp</em> : null}
                          </div>
                        </div>
                        <button
                          aria-label={`Xóa ${item.typeLabel}`}
                          className={styles.deleteButton}
                          onClick={() => {
                            setCart((items) =>
                              items.filter(
                                (cartItem) => cartItem.uid !== item.uid,
                              ),
                            );
                            toast({
                              message: "Đã xóa mục khỏi giỏ cấp giấy.",
                              title: "Giỏ cấp giấy",
                              tone: "info",
                            });
                          }}
                          type="button"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                      <dl className={styles.cartGrid}>
                        <div>
                          <dt>Pháp nhân</dt>
                          <dd>{selectedCompanies.join(", ")}</dd>
                        </div>
                        <div>
                          <dt>Thời hạn</dt>
                          <dd>
                            {formatDate(item.fromDate)} —{" "}
                            {formatDate(item.toDate)}
                          </dd>
                        </div>
                        <div className={styles.cartWide}>
                          <dt>Người được cấp giấy</dt>
                          <dd>
                            {[item.person.name, item.person.title]
                              .filter(Boolean)
                              .join(" • ")}
                          </dd>
                        </div>
                        <div className={styles.cartWide}>
                          <dt>Lý do</dt>
                          <dd>{item.reason}</dd>
                        </div>
                      </dl>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
          <div className={styles.cartFooter}>
            <div className={styles.submitRow}>
              <Link
                className={`${styles.button} ${styles.buttonSecondary}`}
                href="/"
              >
                Quay lại dashboard
              </Link>
              <button
                className={`${styles.button} ${styles.buttonSecondary}`}
                disabled={!cart.length || previewing || pending}
                onClick={previewAll}
                type="button"
              >
                <Printer size={15} />
                {previewing ? "Đang dựng..." : "Xem bản nháp"}
              </button>
            </div>
            <button
              className={`${styles.button} ${styles.buttonAccent} ${styles.submitButton}`}
              disabled={!cart.length || pending || previewing}
              onClick={submit}
              type="button"
            >
              {pending ? "Đang nộp và cấp số..." : "Nộp và mở bản in"}
            </button>
            <form action={formAction} ref={formRef}>
              <input name="serviceCode" type="hidden" value="authorization-letter" />
              <input name="title" type="hidden" value={title} />
              <input name="payload" type="hidden" value={payload} />
            </form>
          </div>
        </aside>
      </div>

      {receipt ? (
        <ReceiptDialog
          currentUserName={currentUserName}
          onClose={() => setReceipt(null)}
          printUrl={receipt.printUrl}
          requestCode={receipt.requestCode}
          rows={receipt.rows}
        />
      ) : null}
      {invalid.length ? (
        <div className={styles.validationSummary}>
          <AlertCircle size={16} />
          Còn trường bắt buộc chưa hoàn tất.
        </div>
      ) : null}
    </>
  );
}
