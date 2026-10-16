"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  MousePointerClick,
  Palette,
  RotateCcw,
  Save,
  Sparkles,
} from "lucide-react";
import { useRouter } from "next/navigation";

import { useToast, WriteLoadingOverlay } from "@/components/ui/toast";
import {
  BRAND_BUTTON_HOVER_OPTIONS,
  BRAND_BUTTON_RADIUS_OPTIONS,
  BRAND_BUTTON_SIZE_OPTIONS,
  BRAND_BUTTON_STYLE_OPTIONS,
  BRAND_GRADIENT_OPTIONS,
  BRAND_SHADOW_OPTIONS,
  BRAND_SURFACE_RADIUS_OPTIONS,
  DEFAULT_BRAND_THEME,
  applyBrandThemeToDocument,
  brandGradientBackground,
  brandThemeCssVariables,
  type BrandTheme,
} from "@/lib/config/brand-theme-shared";
import { configSections } from "@/lib/config/definitions";
import { ModuleIcon } from "@/lib/module-icons";
import {
  ESHOP_BACKEND_SPREADSHEET_ID,
  ESHOP_ZERO_GUID,
  VTP_BASE_URLS,
  VTP_DASHBOARD_BASE_URL,
  type EshopAccountUi,
  type GlobalConfigSnapshot,
  type ModuleConfigUi,
  type ScopeOption,
  type VtpAccountUi,
} from "@/lib/config/global-config-shared";
import type { VtpApiDiagnostic } from "@/lib/integrations/viettelpost";
import { EsignCompanyConfigEditor } from "./esign-company-config";

import {
  copyRfidSecretAction,
  refreshGlobalConfigAction,
  resetBrandThemeAction,
  resetModuleHeaderAction,
  saveBrandThemeAction,
  saveModuleHeaderAction,
  saveModuleConfigAction,
} from "./actions";
import {
  deleteEshopAccountAction,
  deleteVtpAccountAction,
  getVtpLongTokenAction,
  getVtpShortTokenAction,
  saveEshopAccountAction,
  saveVtpAccountAction,
  testEshopOpenPlatformAction,
  testVtpOrdersAction,
  testVtpProvinceAction,
  type ActionResult,
  type EshopAccountInput,
  type VtpAccountInput,
} from "./integration-actions";

type ConfirmState = {
  message: string;
  onConfirm: () => void;
  title: string;
};

const emptyVtp = (): VtpAccountInput => ({
  accountName: "",
  clearDashboardToken: false,
  clearPassword: false,
  clearToken: false,
  companyScope: [],
  dashboardToken: "",
  departmentScope: [],
  env: "PROD",
  id: "",
  note: "",
  partnerAccountId: "",
  password: "",
  status: "Kích hoạt",
  testOrderCode: "",
  token: "",
  username: "",
});

const emptyEshop = (): EshopAccountInput => ({
  accountName: "",
  apiAppId: "",
  apiDomain: "",
  apiSecret: "",
  backendSpreadsheetId: ESHOP_BACKEND_SPREADSHEET_ID,
  clearApiSecret: false,
  clearWebBearer: false,
  clearWebCookie: false,
  companyScope: [],
  departmentScope: [],
  eshopCompanyKey: "",
  eshopCompanyName: "",
  id: "",
  inventorySheetName: "",
  note: "",
  orderSheetName: "",
  status: "Kích hoạt",
  webBaseUrl: "",
  webBearer: "",
  webBranchId: ESHOP_ZERO_GUID,
  webCompanyCode: "",
  webCookie: "",
  webLanguage: "vi-VN",
});

function Field({
  children,
  label,
  wide = false,
}: {
  children: ReactNode;
  label: string;
  wide?: boolean;
}) {
  return (
    <label
      className={`ui-module-field global-config-field${wide ? " global-config-field--wide" : ""}`}
    >
      <span className="ui-module-label">{label}</span>
      {children}
    </label>
  );
}

function BrandColorField({
  help,
  label,
  onChange,
  value,
}: {
  help: string;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  const pickerValue = /^#[0-9a-f]{6}$/i.test(value)
    ? value
    : DEFAULT_BRAND_THEME.brand;
  return (
    <label className="global-config-brand-color">
      <span className="ui-module-label">{label}</span>
      <span className="global-config-brand-color-control">
        <input
          aria-label={`Chọn ${label}`}
          onChange={(event) => onChange(event.target.value)}
          type="color"
          value={pickerValue}
        />
        <input
          className="ui-module-input"
          maxLength={7}
          onChange={(event) => onChange(event.target.value)}
          placeholder="#d4196a"
          spellCheck={false}
          value={value}
        />
      </span>
      <small>{help}</small>
    </label>
  );
}

function BrandOptionField({
  help,
  label,
  onChange,
  options,
  value,
}: {
  help: string;
  label: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<{ label: string; value: string }>;
  value: string;
}) {
  return (
    <label className="global-config-brand-option">
      <span className="ui-module-label">{label}</span>
      <select
        className="ui-module-select"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <small>{help}</small>
    </label>
  );
}

function MultiSelect({
  emptyLabel,
  onChange,
  options,
  selected,
}: {
  emptyLabel: string;
  onChange: (value: string[]) => void;
  options: ScopeOption[];
  selected: string[];
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const label =
    selected.length === 0
      ? emptyLabel
      : `${selected.slice(0, 2).join(", ")}${selected.length > 2 ? ` +${selected.length - 2}` : ""}`;

  return (
    <div
      className="ui-multi-select global-config-multi"
      data-open={open ? "true" : "false"}
      ref={rootRef}
    >
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        className="ui-multi-select-toggle"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <span className="ui-multi-select-label">{label}</span>
        <span className="ui-multi-select-count">{selected.length}</span>
      </button>
      <div
        className={`ui-multi-select-menu${open ? "" : " is-hidden"}`}
        role="listbox"
      >
        {options.length ? (
          options.map((option) => {
            const checked = selected.includes(option.value);
            return (
              <label className="ui-multi-select-option" key={option.id}>
                <input
                  checked={checked}
                  onChange={() =>
                    onChange(
                      checked
                        ? selected.filter((value) => value !== option.value)
                        : [...selected, option.value],
                    )
                  }
                  type="checkbox"
                />
                <span>{option.label}</span>
              </label>
            );
          })
        ) : (
          <div className="global-config-empty">Chưa có dữ liệu để chọn.</div>
        )}
      </div>
    </div>
  );
}

function Chips({
  orange = false,
  values,
}: {
  orange?: boolean;
  values: string[];
}) {
  if (!values.length) {
    return (
      <span className="global-config-chip global-config-chip--muted">
        Chưa chọn
      </span>
    );
  }
  return (
    <>
      {values.slice(0, 3).map((value) => (
        <span
          className={`global-config-chip${orange ? " global-config-chip--orange" : ""}`}
          key={value}
        >
          {value}
        </span>
      ))}
      {values.length > 3 ? (
        <span className="global-config-chip global-config-chip--muted">
          +{values.length - 3}
        </span>
      ) : null}
    </>
  );
}

function ConfirmDialog({
  onClose,
  state,
}: {
  onClose: () => void;
  state: ConfirmState;
}) {
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [onClose]);

  return (
    <div
      aria-modal="true"
      className="global-config-confirm-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="dialog"
    >
      <div className="global-config-confirm">
        <h3>{state.title}</h3>
        <p>{state.message}</p>
        <div className="global-config-actions-right">
          <button
            className="ui-button ui-button--secondary"
            onClick={onClose}
            type="button"
          >
            Hủy
          </button>
          <button
            autoFocus
            className="ui-button ui-button--danger"
            onClick={() => {
              onClose();
              state.onConfirm();
            }}
            type="button"
          >
            Xóa
          </button>
        </div>
      </div>
    </div>
  );
}

function moduleCopy(tabKey: string) {
  if (tabKey === "warehouse-kts-rfid") {
    return {
      kicker: "Kho KTS / RFID",
      note: "Key bí mật để app máy quét gọi các API Kho KTS/RFID. Sau khi lưu, dán cùng giá trị này vào androidRfidApiKey trong local.properties của Android.",
      title: "Key kết nối Android RFID",
    };
  }
  if (tabKey === "ai") {
    return {
      kicker: "AI",
      note: "Gemini dùng chung cho toàn bộ module AI; worker Python dùng cho các tác vụ xử lý nền/xử lý ảnh.",
      title: "Gemini và Worker Python",
    };
  }
  if (tabKey === "recall-ai") {
    return {
      kicker: "Lịch họp",
      note: "API key và Verification Secret dùng chung cho workspace Recall.ai của công ty. Secret được mã hóa trước khi lưu PostgreSQL và không hiển thị ngược ra giao diện.",
      title: "Kết nối Recall.ai",
    };
  }
  if (tabKey === "misa-esign") {
    return {
      kicker: "Đóng dấu và Ký số",
      note: "Thông tin kết nối Remote Signing, tài khoản API và ánh xạ certAlias theo pháp nhân. ClientID, ClientSecret, mật khẩu và ảnh chữ ký được mã hóa trước khi lưu PostgreSQL.",
      title: "Kết nối MISA eSign",
    };
  }
  return {
    kicker: "Folder lưu trữ",
    note: "Quản lý tập trung các folder Drive và link backend: dashboard, kho ứng dụng, dữ liệu Eshop, Phân xưởng, tài sản, biểu mẫu, đối soát, hồ sơ pháp lý và review AI.",
    title: "Folder và backend lưu trữ hệ thống",
  };
}

export function GlobalConfigConsole({
  initial,
  initialTab = "brand-theme",
}: {
  initial: GlobalConfigSnapshot;
  initialTab?: string;
}) {
  const { toast } = useToast();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState(initialTab);
  const [brandDraft, setBrandDraft] = useState<BrandTheme>(initial.brandTheme);
  const [vtpAccounts, setVtpAccounts] = useState(initial.vtpAccounts);
  const [eshopAccounts, setEshopAccounts] = useState(initial.eshopAccounts);
  const [moduleConfigs, setModuleConfigs] = useState(initial.moduleConfigs);
  const [moduleHeaders, setModuleHeaders] = useState(initial.moduleHeaders);
  const [selectedModuleHeaderKey, setSelectedModuleHeaderKey] = useState(
    initial.moduleHeaders.find((item) => item.key === "todo")?.key ||
      initial.moduleHeaders[0]?.key ||
      "",
  );
  const [moduleHeaderDrafts, setModuleHeaderDrafts] = useState(
    Object.fromEntries(
      initial.moduleHeaders.map((item) => [
        item.key,
        { eyebrow: item.eyebrow, title: item.title },
      ]),
    ),
  );
  const [vtp, setVtp] = useState<VtpAccountInput>(emptyVtp);
  const [eshop, setEshop] = useState<EshopAccountInput>(emptyEshop);
  const [vtpDiagnostics, setVtpDiagnostics] = useState<VtpApiDiagnostic[]>([]);
  const [busyMessage, setBusyMessage] = useState("");
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [moduleDrafts, setModuleDrafts] = useState<Record<string, string>>(
    Object.fromEntries(
      initial.moduleConfigs.map((item) => [item.key, item.value]),
    ),
  );
  const [moduleClears, setModuleClears] = useState<Record<string, boolean>>({});

  const editingVtp = useMemo(
    () => vtpAccounts.find((account) => account.id === vtp.id) ?? null,
    [vtp.id, vtpAccounts],
  );
  const editingEshop = useMemo(
    () =>
      eshopAccounts.find((account) => account.id === eshop.id) ?? null,
    [eshop.id, eshopAccounts],
  );
  const selectedModuleHeader = useMemo(
    () =>
      moduleHeaders.find((item) => item.key === selectedModuleHeaderKey) ??
      moduleHeaders[0] ??
      null,
    [moduleHeaders, selectedModuleHeaderKey],
  );
  const selectedModuleHeaderDraft = selectedModuleHeader
    ? moduleHeaderDrafts[selectedModuleHeader.key] || {
        eyebrow: selectedModuleHeader.eyebrow,
        title: selectedModuleHeader.title,
      }
    : null;
  const vtpDiagnosticText = useMemo(
    () =>
      vtpDiagnostics.length
        ? JSON.stringify(
            {
              account: vtp.accountName || vtp.username,
              environment: vtp.env,
              generatedAt: new Date().toISOString(),
              note: "Mật khẩu và token đã được ứng dụng che trước khi hiển thị.",
              requests: vtpDiagnostics,
            },
            null,
            2,
          )
        : "",
    [
      vtp.accountName,
      vtp.env,
      vtp.username,
      vtpDiagnostics,
    ],
  );

  async function copyVtpDiagnostics() {
    if (!vtpDiagnosticText) return;
    try {
      await navigator.clipboard.writeText(vtpDiagnosticText);
      toast({
        duration: 3600,
        message: "Đã sao chép phản hồi an toàn để gửi IT Viettel Post.",
        title: "Đã sao chép",
        tone: "success",
      });
    } catch {
      toast({
        duration: 7000,
        message:
          "Trình duyệt không cho sao chép tự động. Ông bôi đen nội dung phản hồi để sao chép thủ công.",
        title: "Cần kiểm tra",
        tone: "error",
      });
    }
  }

  function showResult<T>(
    result: ActionResult<T>,
    onSuccess?: (data: T) => void,
  ) {
    if (result.ok) {
      onSuccess?.(result.data);
      toast({
        duration: 5600,
        message: result.message,
        title: "Thành công",
        tone: "success",
      });
    } else {
      toast({
        duration: 9000,
        message: result.message,
        title: "Cần kiểm tra",
        tone: "error",
      });
    }
  }

  async function perform<T>(
    message: string,
    operation: () => Promise<ActionResult<T>>,
    onSuccess?: (data: T) => void,
    onSettled?: (result: ActionResult<T>) => void,
  ) {
    if (busyMessage) return;
    setBusyMessage(message);
    try {
      const result = await operation();
      onSettled?.(result);
      showResult(result, onSuccess);
    } catch (error) {
      toast({
        duration: 9000,
        message:
          error instanceof Error ? error.message : "Thao tác không thành công.",
        title: "Cần kiểm tra",
        tone: "error",
      });
    } finally {
      setBusyMessage("");
    }
  }

  function resetVtp(showToast = false) {
    setVtp(emptyVtp());
    setVtpDiagnostics([]);
    if (showToast) {
      toast({
        duration: 3200,
        message: "Đang tạo cụm tài khoản Viettel Post mới.",
        title: "Thông báo",
      });
    }
  }

  function resetEshop(showToast = false) {
    setEshop(emptyEshop());
    if (showToast) {
      toast({
        duration: 3200,
        message: "Đang tạo cụm cấu hình Eshop mới.",
        title: "Thông báo",
      });
    }
  }

  function editVtp(account: VtpAccountUi) {
    setVtp({
      accountName: account.accountName,
      clearDashboardToken: false,
      clearPassword: false,
      clearToken: false,
      companyScope: account.companyScope,
      dashboardToken: "",
      departmentScope: account.departmentScope,
      env: account.env,
      id: account.id,
      note: account.note,
      partnerAccountId: "",
      password: "",
      status: account.status,
      testOrderCode: "",
      token: "",
      username: account.username,
    });
    setVtpDiagnostics([]);
    window.scrollTo({ behavior: "smooth", top: 0 });
  }

  function editEshop(account: EshopAccountUi) {
    setEshop({
      accountName: account.accountName,
      apiAppId: account.apiAppId,
      apiDomain: account.apiDomain,
      apiSecret: "",
      backendSpreadsheetId: account.backendSpreadsheetId,
      clearApiSecret: false,
      clearWebBearer: false,
      clearWebCookie: false,
      companyScope: account.companyScope,
      departmentScope: account.departmentScope,
      eshopCompanyKey: account.eshopCompanyKey,
      eshopCompanyName: account.eshopCompanyName,
      id: account.id,
      inventorySheetName: account.inventorySheetName,
      note: account.note,
      orderSheetName: account.orderSheetName,
      status: account.status,
      webBaseUrl: account.webBaseUrl,
      webBearer: "",
      webBranchId: account.webBranchId,
      webCompanyCode: account.webCompanyCode,
      webCookie: "",
      webLanguage: account.webLanguage,
    });
    window.scrollTo({ behavior: "smooth", top: 0 });
  }

  function applyEshopCompanyDefaults(companyScope: string[]) {
    const first = companyScope[0] ?? "";
    const option = initial.companies.find((item) => item.value === first);
    const key = (option?.shortName || first).trim().toUpperCase();
    const known =
      key === "TVG"
        ? {
            code: "nemthuanviet",
            inventory: "Dữ liệu kho TVG",
            order: "Dữ liệu đơn TVG",
          }
        : key === "TVD"
          ? {
              code: "thuanvietdigital",
              inventory: "Dữ liệu kho TVD",
              order: "Dữ liệu đơn TVD",
            }
          : null;
    setEshop((current) => ({
      ...current,
      companyScope,
      eshopCompanyKey: key,
      eshopCompanyName: first || key,
      inventorySheetName:
        current.inventorySheetName ||
        known?.inventory ||
        (key ? `Dữ liệu kho ${key}` : ""),
      orderSheetName:
        current.orderSheetName ||
        known?.order ||
        (key ? `Dữ liệu đơn ${key}` : ""),
      webBaseUrl:
        current.webBaseUrl ||
        (known ? `https://${known.code}.mshopkeeper.vn` : ""),
      webCompanyCode: current.webCompanyCode || known?.code || "",
      apiDomain:
        current.apiDomain ||
        (known ? `${known.code}.mshopkeeper.vn` : ""),
    }));
  }

  async function refreshAll() {
    await perform(
      "Đang tải lại Cấu hình Tổng từ PostgreSQL...",
      refreshGlobalConfigAction,
      ({ snapshot }) => {
        setVtpAccounts(snapshot.vtpAccounts);
        setEshopAccounts(snapshot.eshopAccounts);
        setBrandDraft(snapshot.brandTheme);
        setModuleConfigs(snapshot.moduleConfigs);
        setModuleHeaders(snapshot.moduleHeaders);
        setModuleHeaderDrafts(
          Object.fromEntries(
            snapshot.moduleHeaders.map((item) => [
              item.key,
              { eyebrow: item.eyebrow, title: item.title },
            ]),
          ),
        );
        setModuleDrafts(
          Object.fromEntries(
            snapshot.moduleConfigs.map((item) => [item.key, item.value]),
          ),
        );
      },
    );
  }

  const activeDefinition = configSections.find(
    (section) => section.key === activeTab,
  );

  return (
    <div className="global-config-root">
      <WriteLoadingOverlay
        message={busyMessage || "Đang xử lý Cấu hình Tổng..."}
        show={Boolean(busyMessage)}
      />
      {confirmState ? (
        <ConfirmDialog
          onClose={() => setConfirmState(null)}
          state={confirmState}
        />
      ) : null}

      <nav aria-label="Cấu hình Tổng" className="global-config-tabs">
        {initial.tabs.map((tab) => (
          <button
            className={`global-config-tab${activeTab === tab.key ? " is-active" : ""}`}
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {activeTab === "viettel-post" ? (
        <section className="global-config-pane">
          <div className="global-config-grid">
            <section className="ui-module-panel global-config-panel">
              <div className="global-config-panel-head">
                <div>
                  <p className="global-config-kicker">Tài khoản kết nối</p>
                  <h2 className="global-config-title">
                    Viettel Post theo phạm vi công ty/phòng ban
                  </h2>
                  <p className="global-config-note">
                    Mỗi cụm tài khoản có thể áp dụng cho nhiều công ty và nhiều
                    phòng ban.
                  </p>
                </div>
                <button
                  className="ui-button ui-button--secondary"
                  onClick={() => resetVtp(true)}
                  type="button"
                >
                  <span className="global-config-plus">+</span>
                  Cụm tài khoản
                </button>
              </div>

              <div className="global-config-form-grid">
                <Field label="Tên cấu hình">
                  <input
                    className="ui-module-input"
                    onChange={(event) =>
                      setVtp((current) => ({
                        ...current,
                        accountName: event.target.value,
                      }))
                    }
                    placeholder="Ví dụ: VTP TVG - Hành chính"
                    value={vtp.accountName}
                  />
                </Field>
                <Field label="Môi trường">
                  <select
                    className="ui-module-select"
                    onChange={(event) => {
                      const env =
                        event.target.value === "DEV" ? "DEV" : "PROD";
                      setVtp((current) => ({
                        ...current,
                        env,
                        partnerAccountId: "",
                      }));
                      setVtpDiagnostics([]);
                    }}
                    value={vtp.env}
                  >
                    <option value="PROD">Production</option>
                    <option value="DEV">Sandbox</option>
                  </select>
                </Field>
                <Field label="Công ty" wide>
                  <MultiSelect
                    emptyLabel="Chọn công ty"
                    onChange={(companyScope) =>
                      setVtp((current) => ({ ...current, companyScope }))
                    }
                    options={initial.companies}
                    selected={vtp.companyScope}
                  />
                </Field>
                <Field label="Phòng ban" wide>
                  <MultiSelect
                    emptyLabel="Chọn phòng ban"
                    onChange={(departmentScope) =>
                      setVtp((current) => ({ ...current, departmentScope }))
                    }
                    options={initial.departments}
                    selected={vtp.departmentScope}
                  />
                </Field>
                <Field label="Tài khoản">
                  <input
                    autoComplete="off"
                    className="ui-module-input"
                    onChange={(event) => {
                      setVtp((current) => ({
                        ...current,
                        username: event.target.value,
                      }));
                      setVtpDiagnostics([]);
                    }}
                    value={vtp.username}
                  />
                </Field>
                <Field label="Trạng thái">
                  <select
                    className="ui-module-select"
                    onChange={(event) =>
                      setVtp((current) => ({
                        ...current,
                        status:
                          event.target.value === "Vô hiệu"
                            ? "Vô hiệu"
                            : "Kích hoạt",
                      }))
                    }
                    value={vtp.status}
                  >
                    <option value="Kích hoạt">Kích hoạt</option>
                    <option value="Vô hiệu">Vô hiệu</option>
                  </select>
                </Field>
                <div className="global-config-field global-config-field--wide">
                  <div className="global-config-token-flow">
                    <Field label="Mật khẩu">
                      <span className="global-config-secret-row">
                        <input
                          autoComplete="new-password"
                          className="ui-module-input"
                          onChange={(event) => {
                            setVtp((current) => ({
                              ...current,
                              password: event.target.value,
                            }));
                            setVtpDiagnostics([]);
                          }}
                          placeholder={
                            editingVtp?.hasPassword
                              ? "Đã lưu mật khẩu; nhập mới nếu muốn đổi"
                              : "Nhập mới nếu cần lưu/đổi"
                          }
                          type="password"
                          value={vtp.password}
                        />
                        <label className="global-config-clear">
                          <input
                            checked={Boolean(vtp.clearPassword)}
                            disabled={!editingVtp?.hasPassword}
                            onChange={(event) =>
                              setVtp((current) => ({
                                ...current,
                                clearPassword: event.target.checked,
                              }))
                            }
                            type="checkbox"
                          />
                          Xóa mật khẩu đã lưu
                        </label>
                      </span>
                    </Field>
                    <Field label="Tài khoản Partner cấp quyền">
                      <select
                        className="ui-module-select"
                        onChange={(event) => {
                          setVtp((current) => ({
                            ...current,
                            partnerAccountId: event.target.value,
                          }));
                          setVtpDiagnostics([]);
                        }}
                        value={vtp.partnerAccountId ?? ""}
                      >
                        <option value="">
                          Dùng chính tài khoản này (nếu là Partner)
                        </option>
                        {vtpAccounts
                          .filter(
                            (account) =>
                              account.id !== vtp.id &&
                              account.env === vtp.env &&
                              account.status === "Kích hoạt" &&
                              account.hasPassword,
                          )
                          .map((account) => (
                            <option key={account.id} value={account.id}>
                              {account.accountName || account.username} ·{" "}
                              {account.username}
                            </option>
                          ))}
                      </select>
                      <span className="global-config-field-help">
                        Với tài khoản phụ/được ủy quyền, chọn một tài khoản
                        Partner đã liên kết và có lưu mật khẩu.
                      </span>
                    </Field>
                    <div className="global-config-token-actions">
                      <button
                        className="ui-button ui-button--secondary"
                        onClick={() =>
                          perform(
                            "Đang kiểm tra đăng nhập Partner...",
                            () => getVtpShortTokenAction(vtp),
                            undefined,
                            (result) =>
                              setVtpDiagnostics(
                                result.data?.diagnostics ?? [],
                              ),
                          )
                        }
                        type="button"
                      >
                        Kiểm tra tài khoản hiện tại
                      </button>
                      <button
                        className="ui-button ui-button--primary"
                        onClick={() =>
                          perform(
                            "Đang liên kết tài khoản Viettel Post...",
                            () => getVtpLongTokenAction(vtp),
                            (data) =>
                              setVtp((current) => ({
                                ...current,
                                clearToken: false,
                                token: data.token,
                              })),
                            (result) =>
                              setVtpDiagnostics(
                                result.data?.diagnostics ?? [],
                              ),
                          )
                        }
                        type="button"
                      >
                        Liên kết &amp; lấy token API
                      </button>
                      <button
                        className="ui-button ui-button--secondary"
                        onClick={() =>
                          perform(
                            "Đang test API tỉnh/thành Viettel Post...",
                            () => testVtpProvinceAction(vtp),
                          )
                        }
                        type="button"
                      >
                        Test API
                      </button>
                      <button
                        className="ui-button ui-button--secondary"
                        onClick={() =>
                          perform(
                            "Đang test lấy dữ liệu đơn Viettel Post...",
                            () => testVtpOrdersAction(vtp),
                          )
                        }
                        type="button"
                      >
                        Test lấy dữ liệu đơn
                      </button>
                    </div>
                    {vtpDiagnosticText ? (
                      <section className="global-config-diagnostic">
                        <div className="global-config-diagnostic-head">
                          <div>
                            <strong>
                              Phản hồi ứng dụng gửi/nhận Viettel Post
                            </strong>
                            <span>
                              Đã che mật khẩu, token và header bí mật. Có thể
                              chụp hoặc sao chép gửi IT.
                            </span>
                          </div>
                          <button
                            className="global-config-mini-button"
                            onClick={copyVtpDiagnostics}
                            type="button"
                          >
                            Sao chép phản hồi
                          </button>
                        </div>
                        <pre>{vtpDiagnosticText}</pre>
                      </section>
                    ) : null}
                  </div>
                </div>
                <Field label="API token dài hạn" wide>
                  <span className="global-config-secret-row">
                    <input
                      autoComplete="off"
                      className="ui-module-input"
                      onChange={(event) =>
                        setVtp((current) => ({
                          ...current,
                          token: event.target.value,
                        }))
                      }
                      placeholder={
                        editingVtp?.tokenPreview
                          ? `Đã lưu ${editingVtp.tokenPreview}; nhập mới nếu muốn đổi`
                          : "Tự điền sau khi lấy token dài hạn, hoặc dán thủ công"
                      }
                      type="password"
                      value={vtp.token}
                    />
                    <label className="global-config-clear">
                      <input
                        checked={Boolean(vtp.clearToken)}
                        disabled={!editingVtp?.hasToken}
                        onChange={(event) =>
                          setVtp((current) => ({
                            ...current,
                            clearToken: event.target.checked,
                          }))
                        }
                        type="checkbox"
                      />
                      Xóa token đã lưu
                    </label>
                  </span>
                </Field>
                <Field label="Dashboard web token" wide>
                  <span className="global-config-secret-row">
                    <input
                      autoComplete="off"
                      className="ui-module-input"
                      onChange={(event) =>
                        setVtp((current) => ({
                          ...current,
                          dashboardToken: event.target.value,
                        }))
                      }
                      placeholder={
                        editingVtp?.dashboardTokenPreview
                          ? `Đã lưu ${editingVtp.dashboardTokenPreview}; nhập mới nếu muốn đổi`
                          : "Token dùng cho dashboard Viettel Post nếu cần"
                      }
                      type="password"
                      value={vtp.dashboardToken}
                    />
                    <label className="global-config-clear">
                      <input
                        checked={Boolean(vtp.clearDashboardToken)}
                        disabled={!editingVtp?.hasDashboardToken}
                        onChange={(event) =>
                          setVtp((current) => ({
                            ...current,
                            clearDashboardToken: event.target.checked,
                          }))
                        }
                        type="checkbox"
                      />
                      Xóa dashboard token đã lưu
                    </label>
                  </span>
                </Field>
                <Field label="Mã vận đơn test" wide>
                  <input
                    autoComplete="off"
                    className="ui-module-input"
                    onChange={(event) =>
                      setVtp((current) => ({
                        ...current,
                        testOrderCode: event.target.value,
                      }))
                    }
                    placeholder="Tùy chọn: nhập mã vận đơn để test chi tiết; để trống sẽ lấy danh sách đơn 7 ngày gần nhất"
                    value={vtp.testOrderCode}
                  />
                </Field>
                <div className="global-config-url-preview global-config-field--wide">
                  <span>
                    <strong>Partner API:</strong> {VTP_BASE_URLS[vtp.env]}
                  </span>
                  <span>
                    <strong>Dashboard API:</strong>{" "}
                    {VTP_DASHBOARD_BASE_URL}
                  </span>
                </div>
                <Field label="Ghi chú" wide>
                  <textarea
                    className="ui-module-textarea"
                    onChange={(event) =>
                      setVtp((current) => ({
                        ...current,
                        note: event.target.value,
                      }))
                    }
                    placeholder="Ghi chú nội bộ cho cụm tài khoản này"
                    rows={3}
                    value={vtp.note}
                  />
                </Field>
              </div>

              <div className="global-config-actions">
                <button
                  className="ui-button ui-button--secondary"
                  onClick={refreshAll}
                  type="button"
                >
                  Làm mới
                </button>
                <div className="global-config-actions-right">
                  <button
                    className="ui-button ui-button--secondary"
                    onClick={() => resetVtp(true)}
                    type="button"
                  >
                    Tạo mới
                  </button>
                  <button
                    className="ui-button ui-button--primary"
                    onClick={() =>
                      perform(
                        "Đang lưu cấu hình Viettel Post...",
                        () => saveVtpAccountAction(vtp),
                        ({ accounts }) => {
                          setVtpAccounts(accounts);
                          resetVtp();
                        },
                      )
                    }
                    type="button"
                  >
                    Lưu cấu hình
                  </button>
                </div>
              </div>
            </section>

            <section className="ui-module-panel global-config-panel">
              <div className="global-config-panel-head">
                <div>
                  <p className="global-config-kicker">Danh sách</p>
                  <h2 className="global-config-title">
                    Cụm Viettel Post đã lưu
                  </h2>
                  <p className="global-config-note">
                    Token/mật khẩu thật không hiển thị lại sau khi lưu.
                  </p>
                </div>
                <span className="global-config-count">{vtpAccounts.length}</span>
              </div>
              <div className="global-config-list">
                {vtpAccounts.length ? (
                  vtpAccounts.map((account) => (
                    <article className="global-config-account" key={account.id}>
                      <div className="global-config-account-head">
                        <div>
                          <p className="global-config-account-title">
                            {account.accountName || account.username}
                          </p>
                          <p className="global-config-account-meta">
                            {account.env} · {account.username} ·{" "}
                            {account.status}
                          </p>
                        </div>
                        <div className="global-config-row-actions">
                          <button
                            className="global-config-mini-button"
                            onClick={() => editVtp(account)}
                            type="button"
                          >
                            Sửa
                          </button>
                          <button
                            className="global-config-mini-button global-config-mini-button--danger"
                            onClick={() =>
                              setConfirmState({
                                message: `Xóa cấu hình "${account.accountName || account.username}"?`,
                                onConfirm: () =>
                                  perform(
                                    "Đang xóa cấu hình Viettel Post...",
                                    () =>
                                      deleteVtpAccountAction(account.id),
                                    ({ accounts }) => {
                                      setVtpAccounts(accounts);
                                      if (vtp.id === account.id) resetVtp();
                                    },
                                  ),
                                title: "Xóa cấu hình Viettel Post",
                              })
                            }
                            type="button"
                          >
                            Xóa
                          </button>
                        </div>
                      </div>
                      <div className="global-config-chip-list">
                        <Chips orange values={account.companyScope} />
                      </div>
                      <div className="global-config-chip-list">
                        <Chips values={account.departmentScope} />
                      </div>
                      <p className="global-config-account-meta">
                        {account.hasPassword
                          ? "Có mật khẩu"
                          : "Chưa có mật khẩu"}{" "}
                        ·{" "}
                        {account.tokenPreview
                          ? `API ${account.tokenPreview}`
                          : "Chưa có API token"}{" "}
                        ·{" "}
                        {account.dashboardTokenPreview
                          ? `Dashboard ${account.dashboardTokenPreview}`
                          : "Chưa có dashboard token"}
                      </p>
                    </article>
                  ))
                ) : (
                  <div className="global-config-empty">
                    Chưa có cụm tài khoản Viettel Post nào.
                  </div>
                )}
              </div>
            </section>
          </div>
        </section>
      ) : null}

      {activeTab === "brand-theme" ? (
        <section className="global-config-pane">
          <section className="ui-module-panel global-config-panel global-config-brand-panel">
            <div className="global-config-panel-head">
              <div>
                <p className="global-config-kicker">Nhận diện hệ thống</p>
                <h2 className="global-config-title">Màu sắc và header toàn Cổng</h2>
                <p className="global-config-note">
                  Thay đổi tại đây sẽ áp dụng cho header, nút chính, trạng thái đang
                  chọn, viền focus và các module dùng bộ giao diện chung.
                </p>
              </div>
              <span className="global-config-brand-badge">
                <Palette size={17} /> Dùng chung toàn hệ thống
              </span>
            </div>

            <div
              className="global-config-brand-preview"
              style={{
                background: brandGradientBackground(brandDraft),
              }}
            >
              <div className="global-config-brand-preview-logo">TV</div>
              <div className="global-config-brand-preview-copy">
                <strong style={{ color: brandDraft.headerTitleColor }}>
                  {brandDraft.headerTitle || "Tên Cổng vận hành"}
                </strong>
                <span style={{ color: brandDraft.headerSubtitleColor }}>
                  {brandDraft.headerSubtitle || "Dòng mô tả hệ thống"}
                </span>
              </div>
              <div className="global-config-brand-preview-user">
                <strong style={{ color: brandDraft.headerTitleColor }}>
                  Nguyễn Minh Thông
                </strong>
                <span style={{ color: brandDraft.headerSubtitleColor }}>
                  Xem trước màu chữ header
                </span>
              </div>
            </div>

            <div className="global-config-brand-section-head">
              <span>01</span>
              <div>
                <h3>Header và màu thương hiệu</h3>
                <p>Tùy chỉnh nhận diện chính, nội dung header và hướng gradient.</p>
              </div>
            </div>

            <div className="global-config-brand-layout">
              <div className="global-config-brand-fields">
                <Field label="Tên hiển thị trên header" wide>
                  <input
                    className="ui-module-input"
                    maxLength={60}
                    onChange={(event) =>
                      setBrandDraft((current) => ({
                        ...current,
                        headerTitle: event.target.value,
                      }))
                    }
                    value={brandDraft.headerTitle}
                  />
                </Field>
                <Field label="Dòng mô tả trên header" wide>
                  <input
                    className="ui-module-input"
                    maxLength={120}
                    onChange={(event) =>
                      setBrandDraft((current) => ({
                        ...current,
                        headerSubtitle: event.target.value,
                      }))
                    }
                    value={brandDraft.headerSubtitle}
                  />
                </Field>
                <Field label="Kiểu chuyển màu gradient" wide>
                  <select
                    className="ui-module-select"
                    onChange={(event) =>
                      setBrandDraft((current) => ({
                        ...current,
                        gradientMode: event.target.value as BrandTheme["gradientMode"],
                      }))
                    }
                    value={brandDraft.gradientMode}
                  >
                    {BRAND_GRADIENT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              <div className="global-config-brand-colors">
                {(
                  [
                    ["brandLight", "Màu sáng", "Điểm đầu của gradient header."],
                    ["brand", "Màu thương hiệu chính", "Nút chính và trạng thái đang chọn."],
                    ["brandStrong", "Màu đậm", "Điểm cuối gradient và chữ nhấn."],
                    ["brandSoft", "Màu nền nhạt", "Nền chip, hover và vùng chọn nhẹ."],
                    ["headerTitleColor", "Chữ chính header", "Tên Cổng và tên người dùng."],
                    ["headerSubtitleColor", "Chữ phụ header", "Mô tả và lời chào trên header."],
                  ] as const
                ).map(([key, label, help]) => (
                  <BrandColorField
                    help={help}
                    key={key}
                    label={label}
                    onChange={(value) =>
                      setBrandDraft((current) => ({ ...current, [key]: value }))
                    }
                    value={brandDraft[key]}
                  />
                ))}
              </div>
            </div>

            <div className="global-config-brand-section-head">
              <span>02</span>
              <div>
                <h3>Nút bấm và tương tác</h3>
                <p>Chọn kiểu nền, hình dáng, kích thước, hover và độ nổi dùng chung.</p>
              </div>
            </div>

            <div
              className="global-config-component-preview"
              style={brandThemeCssVariables(brandDraft)}
            >
              <div className="global-config-component-preview-copy">
                <span className="global-config-preview-chip">Xem trước trực tiếp</span>
                <strong>Card và control dùng chung</strong>
                <small>
                  Màu, bo góc, chiều cao và bóng đổ bên dưới thay đổi ngay khi ông chọn.
                </small>
              </div>
              <div className="global-config-preview-actions">
                <button className="ui-button ui-button--primary" type="button">
                  <MousePointerClick size={17} /> Nút chính
                </button>
                <button className="ui-button ui-button--secondary" type="button">
                  Nút phụ
                </button>
                <button className="ui-icon-button" title="Nút icon mẫu" type="button">
                  <Palette size={18} />
                </button>
              </div>
              <div className="global-config-preview-control">
                <input
                  aria-label="Ô nhập mẫu"
                  className="ui-module-input"
                  placeholder="Ô nhập liệu dùng chung"
                  readOnly
                />
                <span className="ui-chip">Trạng thái chọn</span>
              </div>
            </div>

            <div className="global-config-brand-options">
              <BrandOptionField
                help="Gradient, màu đặc, nền nhạt hoặc chỉ viền."
                label="Kiểu nền nút chính"
                onChange={(value) =>
                  setBrandDraft((current) => ({
                    ...current,
                    buttonStyle: value as BrandTheme["buttonStyle"],
                  }))
                }
                options={BRAND_BUTTON_STYLE_OPTIONS}
                value={brandDraft.buttonStyle}
              />
              <BrandOptionField
                help="Áp dụng cho nút chính, phụ và nút hành động chung."
                label="Dáng nút"
                onChange={(value) =>
                  setBrandDraft((current) => ({
                    ...current,
                    buttonRadius: value as BrandTheme["buttonRadius"],
                  }))
                }
                options={BRAND_BUTTON_RADIUS_OPTIONS}
                value={brandDraft.buttonRadius}
              />
              <BrandOptionField
                help="Chiều cao mặc định của nút thao tác."
                label="Kích thước nút"
                onChange={(value) =>
                  setBrandDraft((current) => ({
                    ...current,
                    buttonSize: value as BrandTheme["buttonSize"],
                  }))
                }
                options={BRAND_BUTTON_SIZE_OPTIONS}
                value={brandDraft.buttonSize}
              />
              <BrandOptionField
                help="Nâng nhẹ, phát sáng hoặc đứng yên khi rê chuột."
                label="Hiệu ứng hover"
                onChange={(value) =>
                  setBrandDraft((current) => ({
                    ...current,
                    buttonHoverMode: value as BrandTheme["buttonHoverMode"],
                  }))
                }
                options={BRAND_BUTTON_HOVER_OPTIONS}
                value={brandDraft.buttonHoverMode}
              />
              <BrandOptionField
                help="Điều chỉnh độ nổi của nút và card trên toàn Cổng."
                label="Mức bóng đổ"
                onChange={(value) =>
                  setBrandDraft((current) => ({
                    ...current,
                    shadowMode: value as BrandTheme["shadowMode"],
                  }))
                }
                options={BRAND_SHADOW_OPTIONS}
                value={brandDraft.shadowMode}
              />
              <BrandOptionField
                help="Độ bo góc của panel và card dùng chung."
                label="Bo góc card"
                onChange={(value) =>
                  setBrandDraft((current) => ({
                    ...current,
                    cardRadius: value as BrandTheme["cardRadius"],
                  }))
                }
                options={BRAND_SURFACE_RADIUS_OPTIONS}
                value={brandDraft.cardRadius}
              />
              <BrandOptionField
                help="Độ bo góc của input, select và ô nhập liệu."
                label="Bo góc ô nhập"
                onChange={(value) =>
                  setBrandDraft((current) => ({
                    ...current,
                    controlRadius: value as BrandTheme["controlRadius"],
                  }))
                }
                options={BRAND_SURFACE_RADIUS_OPTIONS}
                value={brandDraft.controlRadius}
              />
            </div>

            <div className="global-config-brand-section-head">
              <span>03</span>
              <div>
                <h3>Nền, chữ và đường viền</h3>
                <p>Hoàn thiện sắc độ của trang, card, nội dung và control dùng chung.</p>
              </div>
            </div>

            <div className="global-config-brand-colors global-config-brand-colors--surface">
              {(
                [
                  ["pageBackground", "Nền trang", "Màu nền tổng phía sau các module."],
                  ["surfaceColor", "Bề mặt card", "Màu nền card, panel và ô nhập."],
                  ["textColor", "Chữ nội dung", "Màu chữ nội dung chính."],
                  ["mutedTextColor", "Chữ phụ", "Mô tả, chú thích và metadata."],
                  ["borderColor", "Màu viền", "Viền card, input và nút phụ."],
                  ["buttonTextColor", "Chữ nút chính", "Dùng khi nút là gradient hoặc màu đặc."],
                ] as const
              ).map(([key, label, help]) => (
                <BrandColorField
                  help={help}
                  key={key}
                  label={label}
                  onChange={(value) =>
                    setBrandDraft((current) => ({ ...current, [key]: value }))
                  }
                  value={brandDraft[key]}
                />
              ))}
            </div>

            <div className="global-config-brand-section-head">
              <span>04</span>
              <div>
                <h3>Tiêu đề các Module</h3>
                <p>
                  Dùng chung mẫu Giao việc: icon, dòng nhóm và tiêu đề lớn; không
                  hiển thị dòng mô tả phụ.
                </p>
              </div>
            </div>

            {selectedModuleHeader && selectedModuleHeaderDraft ? (
              <div className="global-config-module-header-editor">
                <label className="global-config-module-header-picker">
                  <span className="ui-module-label">Chọn Module cần chỉnh</span>
                  <select
                    className="ui-module-select"
                    onChange={(event) =>
                      setSelectedModuleHeaderKey(event.target.value)
                    }
                    value={selectedModuleHeader.key}
                  >
                    {moduleHeaders.map((item) => (
                      <option key={item.key} value={item.key}>
                        {item.defaultTitle}
                        {item.customized ? " · Đã tùy chỉnh" : ""}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="global-config-module-header-preview">
                  <div className="global-config-module-header-icon" aria-hidden="true">
                    <ModuleIcon name={selectedModuleHeader.icon} />
                  </div>
                  <div className="global-config-module-header-copy">
                    <span>
                      <Sparkles size={13} />
                      {selectedModuleHeaderDraft.eyebrow || "Dòng nhóm Module"}
                    </span>
                    <strong>
                      {selectedModuleHeaderDraft.title || "Tiêu đề Module"}
                    </strong>
                  </div>
                </div>

                <div className="global-config-module-header-fields">
                  <Field label="Dòng nhóm phía trên">
                    <input
                      className="ui-module-input"
                      maxLength={120}
                      onChange={(event) =>
                        setModuleHeaderDrafts((current) => ({
                          ...current,
                          [selectedModuleHeader.key]: {
                            ...selectedModuleHeaderDraft,
                            eyebrow: event.target.value,
                          },
                        }))
                      }
                      value={selectedModuleHeaderDraft.eyebrow}
                    />
                  </Field>
                  <Field label="Tiêu đề Module">
                    <input
                      className="ui-module-input"
                      maxLength={80}
                      onChange={(event) =>
                        setModuleHeaderDrafts((current) => ({
                          ...current,
                          [selectedModuleHeader.key]: {
                            ...selectedModuleHeaderDraft,
                            title: event.target.value,
                          },
                        }))
                      }
                      value={selectedModuleHeaderDraft.title}
                    />
                  </Field>
                </div>

                <div className="global-config-module-header-actions">
                  <button
                    className="ui-button ui-button--secondary"
                    onClick={() =>
                      perform(
                        "Đang khôi phục tiêu đề Module mặc định...",
                        () => resetModuleHeaderAction(selectedModuleHeader.key),
                        ({ moduleHeaders: updated }) => {
                          setModuleHeaders(updated);
                          const item = updated.find(
                            (candidate) =>
                              candidate.key === selectedModuleHeader.key,
                          );
                          if (item) {
                            setModuleHeaderDrafts((current) => ({
                              ...current,
                              [item.key]: {
                                eyebrow: item.eyebrow,
                                title: item.title,
                              },
                            }));
                          }
                          router.refresh();
                        },
                      )
                    }
                    type="button"
                  >
                    <RotateCcw size={17} /> Khôi phục Module này
                  </button>
                  <button
                    className="ui-button ui-button--primary"
                    onClick={() =>
                      perform(
                        "Đang áp dụng tiêu đề Module...",
                        () =>
                          saveModuleHeaderAction({
                            ...selectedModuleHeaderDraft,
                            key: selectedModuleHeader.key,
                          }),
                        ({ moduleHeaders: updated }) => {
                          setModuleHeaders(updated);
                          const item = updated.find(
                            (candidate) =>
                              candidate.key === selectedModuleHeader.key,
                          );
                          if (item) {
                            setModuleHeaderDrafts((current) => ({
                              ...current,
                              [item.key]: {
                                eyebrow: item.eyebrow,
                                title: item.title,
                              },
                            }));
                          }
                          router.refresh();
                        },
                      )
                    }
                    type="button"
                  >
                    <Save size={17} /> Lưu tiêu đề Module
                  </button>
                </div>
              </div>
            ) : null}

            <div className="global-config-brand-actions">
              <button
                className="ui-button ui-button--secondary"
                onClick={() =>
                  perform(
                    "Đang khôi phục bộ nhận diện mặc định...",
                    resetBrandThemeAction,
                    ({ brandTheme }) => {
                      setBrandDraft(brandTheme);
                      applyBrandThemeToDocument(brandTheme);
                      router.refresh();
                    },
                  )
                }
                type="button"
              >
                <RotateCcw size={17} /> Khôi phục mặc định
              </button>
              <button
                className="ui-button ui-button--primary"
                onClick={() =>
                  perform(
                    "Đang áp dụng màu thương hiệu cho toàn Cổng...",
                    () => saveBrandThemeAction(brandDraft),
                    ({ brandTheme }) => {
                      setBrandDraft(brandTheme);
                      applyBrandThemeToDocument(brandTheme);
                      router.refresh();
                    },
                  )
                }
                type="button"
              >
                <Save size={17} /> Lưu và áp dụng
              </button>
            </div>
          </section>
        </section>
      ) : null}

      {activeTab === "eshop" ? (
        <section className="global-config-pane">
          <div className="global-config-grid">
            <section className="ui-module-panel global-config-panel">
              <div className="global-config-panel-head">
                <div>
                  <p className="global-config-kicker">MShopKeeper / Eshop</p>
                  <h2 className="global-config-title">
                    Eshop theo phạm vi công ty/phòng ban
                  </h2>
                  <p className="global-config-note">
                    Lưu kết nối OpenPlatform, App ID/API Secret và thông tin
                    sheet xuất dữ liệu cho từng cụm.
                  </p>
                </div>
                <button
                  className="ui-button ui-button--secondary"
                  onClick={() => resetEshop(true)}
                  type="button"
                >
                  <span className="global-config-plus">+</span>
                  Cụm Eshop
                </button>
              </div>

              <div className="global-config-form-grid">
                <Field label="Tên cấu hình">
                  <input
                    className="ui-module-input"
                    onChange={(event) =>
                      setEshop((current) => ({
                        ...current,
                        accountName: event.target.value,
                      }))
                    }
                    placeholder="Ví dụ: Eshop TVG - Hành chính"
                    value={eshop.accountName}
                  />
                </Field>
                <Field label="Trạng thái">
                  <select
                    className="ui-module-select"
                    onChange={(event) =>
                      setEshop((current) => ({
                        ...current,
                        status:
                          event.target.value === "Vô hiệu"
                            ? "Vô hiệu"
                            : "Kích hoạt",
                      }))
                    }
                    value={eshop.status}
                  >
                    <option value="Kích hoạt">Kích hoạt</option>
                    <option value="Vô hiệu">Vô hiệu</option>
                  </select>
                </Field>
                <Field label="Công ty" wide>
                  <MultiSelect
                    emptyLabel="Chọn công ty"
                    onChange={applyEshopCompanyDefaults}
                    options={initial.companies}
                    selected={eshop.companyScope}
                  />
                </Field>
                <Field label="Phòng ban" wide>
                  <MultiSelect
                    emptyLabel="Chọn phòng ban"
                    onChange={(departmentScope) =>
                      setEshop((current) => ({
                        ...current,
                        departmentScope,
                      }))
                    }
                    options={initial.departments}
                    selected={eshop.departmentScope}
                  />
                </Field>
                <Field label="Backend spreadsheet ID" wide>
                  <input
                    className="ui-module-input"
                    onChange={(event) =>
                      setEshop((current) => ({
                        ...current,
                        backendSpreadsheetId: event.target.value,
                      }))
                    }
                    placeholder="Spreadsheet lưu dữ liệu clone Eshop"
                    value={eshop.backendSpreadsheetId}
                  />
                </Field>
                <Field label="Sheet đơn hàng">
                  <input
                    className="ui-module-input"
                    onChange={(event) =>
                      setEshop((current) => ({
                        ...current,
                        orderSheetName: event.target.value,
                      }))
                    }
                    placeholder="Dữ liệu đơn TVG"
                    value={eshop.orderSheetName}
                  />
                </Field>
                <Field label="Sheet tồn kho">
                  <input
                    className="ui-module-input"
                    onChange={(event) =>
                      setEshop((current) => ({
                        ...current,
                        inventorySheetName: event.target.value,
                      }))
                    }
                    placeholder="Dữ liệu kho TVG"
                    value={eshop.inventorySheetName}
                  />
                </Field>
                <Field label="Web Base URL">
                  <input
                    className="ui-module-input"
                    onChange={(event) => {
                      const value = event.target.value;
                      const code =
                        value.match(
                          /^https?:\/\/([^.]+)\.mshopkeeper\.vn/i,
                        )?.[1] ?? "";
                      setEshop((current) => ({
                        ...current,
                        apiDomain:
                          current.apiDomain ||
                          (code ? `${code}.mshopkeeper.vn` : ""),
                        webBaseUrl: value,
                        webCompanyCode: current.webCompanyCode || code,
                      }));
                    }}
                    placeholder="https://nemthuanviet.mshopkeeper.vn"
                    type="url"
                    value={eshop.webBaseUrl}
                  />
                </Field>
                <Field label="Web Company Code">
                  <input
                    className="ui-module-input"
                    onChange={(event) => {
                      const code = event.target.value.trim();
                      setEshop((current) => ({
                        ...current,
                        apiDomain:
                          current.apiDomain ||
                          (code ? `${code}.mshopkeeper.vn` : ""),
                        webBaseUrl:
                          current.webBaseUrl ||
                          (code
                            ? `https://${code}.mshopkeeper.vn`
                            : ""),
                        webCompanyCode: event.target.value,
                      }));
                    }}
                    placeholder="nemthuanviet"
                    value={eshop.webCompanyCode}
                  />
                </Field>
                <Field label="Web Branch ID">
                  <input
                    className="ui-module-input"
                    onChange={(event) =>
                      setEshop((current) => ({
                        ...current,
                        webBranchId: event.target.value,
                      }))
                    }
                    placeholder={ESHOP_ZERO_GUID}
                    value={eshop.webBranchId}
                  />
                </Field>
                <Field label="Web Language">
                  <input
                    className="ui-module-input"
                    onChange={(event) =>
                      setEshop((current) => ({
                        ...current,
                        webLanguage: event.target.value,
                      }))
                    }
                    placeholder="vi-VN"
                    value={eshop.webLanguage}
                  />
                </Field>
                <Field label="Web Bearer lấy đơn hàng" wide>
                  <span className="global-config-secret-row">
                    <textarea
                      className="ui-module-textarea"
                      onChange={(event) =>
                        setEshop((current) => ({
                          ...current,
                          webBearer: event.target.value,
                        }))
                      }
                      placeholder={
                        editingEshop?.webBearerPreview
                          ? `Đã lưu ${editingEshop.webBearerPreview}; nhập mới nếu muốn đổi`
                          : "Bearer lấy đơn từ web mshopkeeper/backendg2"
                      }
                      rows={3}
                      value={eshop.webBearer}
                    />
                    <label className="global-config-clear">
                      <input
                        checked={Boolean(eshop.clearWebBearer)}
                        disabled={!editingEshop?.hasWebBearer}
                        onChange={(event) =>
                          setEshop((current) => ({
                            ...current,
                            clearWebBearer: event.target.checked,
                          }))
                        }
                        type="checkbox"
                      />
                      Xóa bearer đã lưu
                    </label>
                  </span>
                </Field>
                <Field label="Cookie web nếu cần" wide>
                  <span className="global-config-secret-row">
                    <textarea
                      className="ui-module-textarea"
                      onChange={(event) =>
                        setEshop((current) => ({
                          ...current,
                          webCookie: event.target.value,
                        }))
                      }
                      placeholder={
                        editingEshop?.webCookiePreview
                          ? `Đã lưu ${editingEshop.webCookiePreview}; nhập mới nếu muốn đổi`
                          : "Cookie web nếu API đơn hàng cần"
                      }
                      rows={3}
                      value={eshop.webCookie}
                    />
                    <label className="global-config-clear">
                      <input
                        checked={Boolean(eshop.clearWebCookie)}
                        disabled={!editingEshop?.hasWebCookie}
                        onChange={(event) =>
                          setEshop((current) => ({
                            ...current,
                            clearWebCookie: event.target.checked,
                          }))
                        }
                        type="checkbox"
                      />
                      Xóa cookie đã lưu
                    </label>
                  </span>
                </Field>
                <Field label="API Domain">
                  <input
                    className="ui-module-input"
                    onChange={(event) =>
                      setEshop((current) => ({
                        ...current,
                        apiDomain: event.target.value,
                      }))
                    }
                    placeholder="nemthuanviet.mshopkeeper.vn"
                    value={eshop.apiDomain}
                  />
                </Field>
                <Field label="API App ID">
                  <input
                    autoComplete="off"
                    className="ui-module-input"
                    onChange={(event) =>
                      setEshop((current) => ({
                        ...current,
                        apiAppId: event.target.value,
                      }))
                    }
                    value={eshop.apiAppId}
                  />
                </Field>
                <Field label="API Secret / API key" wide>
                  <span className="global-config-secret-row">
                    <textarea
                      className="ui-module-textarea"
                      onChange={(event) =>
                        setEshop((current) => ({
                          ...current,
                          apiSecret: event.target.value,
                        }))
                      }
                      placeholder={
                        editingEshop?.apiSecretPreview
                          ? `Đã lưu ${editingEshop.apiSecretPreview}; nhập mới nếu muốn đổi`
                          : "Secret Key dùng ký HMACSHA256"
                      }
                      rows={3}
                      value={eshop.apiSecret}
                    />
                    <label className="global-config-clear">
                      <input
                        checked={Boolean(eshop.clearApiSecret)}
                        disabled={!editingEshop?.hasApiSecret}
                        onChange={(event) =>
                          setEshop((current) => ({
                            ...current,
                            clearApiSecret: event.target.checked,
                          }))
                        }
                        type="checkbox"
                      />
                      Xóa API Secret đã lưu
                    </label>
                  </span>
                </Field>
                <div className="global-config-token-actions">
                  <button
                    className="ui-button ui-button--secondary"
                    onClick={() =>
                      perform(
                        "Đang kiểm tra Eshop OpenPlatform...",
                        () => testEshopOpenPlatformAction(eshop),
                      )
                    }
                    type="button"
                  >
                    Kiểm tra OpenPlatform
                  </button>
                </div>
                <Field label="Ghi chú" wide>
                  <textarea
                    className="ui-module-textarea"
                    onChange={(event) =>
                      setEshop((current) => ({
                        ...current,
                        note: event.target.value,
                      }))
                    }
                    placeholder="Ghi chú nội bộ cho cụm Eshop này"
                    rows={3}
                    value={eshop.note}
                  />
                </Field>
              </div>

              <div className="global-config-actions">
                <button
                  className="ui-button ui-button--secondary"
                  onClick={refreshAll}
                  type="button"
                >
                  Làm mới
                </button>
                <div className="global-config-actions-right">
                  <button
                    className="ui-button ui-button--secondary"
                    onClick={() => resetEshop(true)}
                    type="button"
                  >
                    Tạo mới
                  </button>
                  <button
                    className="ui-button ui-button--primary"
                    onClick={() =>
                      perform(
                        "Đang lưu cấu hình Eshop...",
                        () => saveEshopAccountAction(eshop),
                        ({ accounts }) => {
                          setEshopAccounts(accounts);
                          resetEshop();
                        },
                      )
                    }
                    type="button"
                  >
                    Lưu cấu hình
                  </button>
                </div>
              </div>
            </section>

            <section className="ui-module-panel global-config-panel">
              <div className="global-config-panel-head">
                <div>
                  <p className="global-config-kicker">Danh sách</p>
                  <h2 className="global-config-title">Cụm Eshop đã lưu</h2>
                  <p className="global-config-note">
                    Token, cookie và API Secret thật không hiển thị lại sau khi
                    lưu.
                  </p>
                </div>
                <span className="global-config-count">
                  {eshopAccounts.length}
                </span>
              </div>
              <div className="global-config-list">
                {eshopAccounts.length ? (
                  eshopAccounts.map((account) => (
                    <article className="global-config-account" key={account.id}>
                      <div className="global-config-account-head">
                        <div>
                          <p className="global-config-account-title">
                            {account.accountName ||
                              account.webCompanyCode ||
                              account.apiDomain}
                          </p>
                          <p className="global-config-account-meta">
                            {[
                              account.webCompanyCode || account.apiDomain,
                              account.webBaseUrl,
                              account.status,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        </div>
                        <div className="global-config-row-actions">
                          <button
                            className="global-config-mini-button"
                            onClick={() => editEshop(account)}
                            type="button"
                          >
                            Sửa
                          </button>
                          <button
                            className="global-config-mini-button global-config-mini-button--danger"
                            onClick={() =>
                              setConfirmState({
                                message: `Xóa cấu hình "${account.accountName || account.webCompanyCode || account.apiDomain}"?`,
                                onConfirm: () =>
                                  perform(
                                    "Đang xóa cấu hình Eshop...",
                                    () =>
                                      deleteEshopAccountAction(account.id),
                                    ({ accounts }) => {
                                      setEshopAccounts(accounts);
                                      if (eshop.id === account.id)
                                        resetEshop();
                                    },
                                  ),
                                title: "Xóa cấu hình Eshop",
                              })
                            }
                            type="button"
                          >
                            Xóa
                          </button>
                        </div>
                      </div>
                      <div className="global-config-chip-list">
                        <Chips orange values={account.companyScope} />
                      </div>
                      <div className="global-config-chip-list">
                        <Chips values={account.departmentScope} />
                      </div>
                      <p className="global-config-account-meta">
                        {account.webBearerPreview
                          ? `Token ${account.webBearerPreview}`
                          : "Chưa có token"}{" "}
                        ·{" "}
                        {account.apiSecretPreview
                          ? `API Secret ${account.apiSecretPreview}`
                          : "Chưa có API Secret"}{" "}
                        ·{" "}
                        {account.webCookiePreview
                          ? `Cookie ${account.webCookiePreview}`
                          : "Không có cookie"}
                      </p>
                    </article>
                  ))
                ) : (
                  <div className="global-config-empty">
                    Chưa có cụm cấu hình Eshop nào.
                  </div>
                )}
              </div>
            </section>
          </div>
        </section>
      ) : null}

      {activeTab !== "brand-theme" &&
      activeTab !== "viettel-post" &&
      activeTab !== "eshop" ? (
        <section className="global-config-pane">
          <section className="ui-module-panel global-config-panel">
            <div className="global-config-panel-head">
              <div>
                <p className="global-config-kicker">
                  {moduleCopy(activeTab).kicker}
                </p>
                <h2 className="global-config-title">
                  {moduleCopy(activeTab).title}
                </h2>
                <p className="global-config-note">
                  {moduleCopy(activeTab).note}
                </p>
              </div>
              <button
                className="ui-button ui-button--secondary"
                onClick={refreshAll}
                type="button"
              >
                Làm mới
              </button>
            </div>
            <div className="global-config-module-list">
              {(activeDefinition?.items ?? []).map((definition) => {
                const item =
                  moduleConfigs.find(
                    (config) => config.key === definition.key,
                  ) ??
                  ({
                    ...definition,
                    configured: false,
                    secretConfigured: false,
                    secretPreview: "",
                    source: "",
                    value: "",
                  } satisfies ModuleConfigUi);
                const isSecret = item.type === "secret";
                const draft = moduleDrafts[item.key] ?? "";
                return (
                  <article
                    className="global-config-module-row"
                    key={item.key}
                  >
                    <div className="global-config-module-row-info">
                      <p className="global-config-module-label">{item.label}</p>
                      <div className="global-config-chip-list">
                        <span className="global-config-chip global-config-chip--orange">
                          {item.tag}
                        </span>
                        {item.source ? (
                          <span className="global-config-chip global-config-chip--muted">
                            {item.source}
                          </span>
                        ) : null}
                      </div>
                      <p className="global-config-module-help">{item.help}</p>
                    </div>
                    <div className="global-config-module-value">
                      <input
                        className="ui-module-input"
                        onChange={(event) =>
                          setModuleDrafts((current) => ({
                            ...current,
                            [item.key]: event.target.value,
                          }))
                        }
                        placeholder={
                          isSecret
                            ? item.secretConfigured
                              ? `Đã lưu ${item.secretPreview || "secret"}; nhập mới nếu muốn đổi`
                              : "Nhập secret/key"
                            : item.type === "spreadsheet"
                              ? "Dán link Google Sheet hoặc Spreadsheet ID"
                              : ""
                        }
                        type={
                          item.type === "url"
                            ? "url"
                            : isSecret &&
                                item.key !== "warehouseKts.androidApiKey"
                              ? "password"
                              : "text"
                        }
                        value={draft}
                      />
                      {isSecret ? (
                        <label className="global-config-secret-check">
                          <input
                            checked={Boolean(moduleClears[item.key])}
                            disabled={!item.secretConfigured}
                            onChange={(event) =>
                              setModuleClears((current) => ({
                                ...current,
                                [item.key]: event.target.checked,
                              }))
                            }
                            type="checkbox"
                          />
                          Xóa secret đã lưu
                        </label>
                      ) : null}
                    </div>
                    <div className="global-config-module-actions">
                      {item.key === "warehouseKts.androidApiKey" ? (
                        <>
                          <button
                            className="global-config-mini-button"
                            onClick={() => {
                              const bytes = new Uint8Array(24);
                              window.crypto.getRandomValues(bytes);
                              const value = `rfid_${Array.from(bytes)
                                .map((byte) =>
                                  byte.toString(16).padStart(2, "0"),
                                )
                                .join("")}`;
                              setModuleDrafts((current) => ({
                                ...current,
                                [item.key]: value,
                              }));
                              toast({
                                duration: 3200,
                                message:
                                  "Đã tạo Android RFID API key mới. Copy chuỗi này rồi bấm Lưu để backend nhận key.",
                                title: "Thông báo",
                              });
                            }}
                            type="button"
                          >
                            Tạo key
                          </button>
                          <button
                            className="global-config-mini-button"
                            disabled={!draft && !item.secretConfigured}
                            onClick={async () => {
                              let value = draft;
                              if (!value) {
                                setBusyMessage(
                                  "Đang lấy Android RFID API key đã lưu...",
                                );
                                const result = await copyRfidSecretAction();
                                setBusyMessage("");
                                if (!result.ok) {
                                  showResult(result);
                                  return;
                                }
                                value = result.data.value;
                                setModuleDrafts((current) => ({
                                  ...current,
                                  [item.key]: value,
                                }));
                              }
                              try {
                                await navigator.clipboard.writeText(value);
                                toast({
                                  duration: 5600,
                                  message:
                                    "Đã copy Android RFID API key.",
                                  title: "Thành công",
                                  tone: "success",
                                });
                              } catch {
                                toast({
                                  duration: 9000,
                                  message:
                                    "Trình duyệt chặn copy tự động. Key đã nằm trong ô nhập; bấm Ctrl+C để copy.",
                                  title: "Cần kiểm tra",
                                  tone: "error",
                                });
                              }
                            }}
                            type="button"
                          >
                            Copy key
                          </button>
                        </>
                      ) : null}
                      <button
                        className="global-config-mini-button"
                        onClick={() =>
                          perform(
                            "Đang lưu Cấu hình Tổng...",
                            () =>
                              saveModuleConfigAction({
                                clear: Boolean(moduleClears[item.key]),
                                key: item.key,
                                value: draft,
                              }),
                            ({ moduleConfigs: updated }) => {
                              setModuleConfigs(updated);
                              const updatedItem = updated.find(
                                (config) => config.key === item.key,
                              );
                              setModuleDrafts((current) => ({
                                ...current,
                                [item.key]: isSecret
                                  ? ""
                                  : updatedItem?.value ?? "",
                              }));
                              setModuleClears((current) => ({
                                ...current,
                                [item.key]: false,
                              }));
                            },
                          )
                        }
                        type="button"
                      >
                        Lưu
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
            {activeTab === "misa-esign" ? <EsignCompanyConfigEditor /> : null}
          </section>
        </section>
      ) : null}
    </div>
  );
}
