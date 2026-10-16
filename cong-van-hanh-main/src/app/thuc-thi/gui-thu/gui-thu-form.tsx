"use client";

import {
  useActionState,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { Button, Input, Select } from "@/components/ui";
import { useToast, WriteLoadingOverlay } from "@/components/ui/toast";
import type {
  VtpDistrict,
  VtpProvince,
  VtpService,
  VtpWard,
} from "@/lib/integrations/viettelpost-mail";
import type {
  SendMailLocationAddress,
  SendMailLocationOption,
} from "@/lib/send-mail/office-locations";

import {
  createMailOrderAction,
  mailGetServices,
  mailListDistricts,
  mailListProvinces,
  mailListWards,
  type MailActionState,
} from "./actions";

const initialState: MailActionState = {};

type AddressMode = "new" | "old";
type AccountOption = {
  company: string;
  defaultLocationKey: string;
  env: string;
  hasToken: boolean;
  id: string;
  name: string;
};
type EmployeeOption = {
  company: string;
  department: string;
  employeeId: string;
  name: string;
  phone: string;
  title: string;
};

const textareaClass =
  "min-h-24 w-full resize-y rounded-2xl border border-border bg-surface px-4 py-3 text-sm text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] outline-none transition placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent/20";

function Field({
  children,
  hint,
  label,
}: {
  children: ReactNode;
  hint?: string;
  label: string;
}) {
  return (
    <label className="grid gap-2.5 text-sm font-semibold text-foreground">
      <span className="leading-5">{label}</span>
      {children}
      {hint ? (
        <span className="block text-xs font-normal leading-5 text-muted">
          {hint}
        </span>
      ) : null}
    </label>
  );
}

function MailSection({
  action,
  children,
  description,
  number,
  title,
}: {
  action?: ReactNode;
  children: ReactNode;
  description: string;
  number: number;
  title: string;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-border/80 bg-surface shadow-[0_12px_30px_rgba(17,45,39,0.05)]">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border/80 bg-surface-muted/45 px-5 py-4 md:px-6">
        <div className="flex min-w-0 items-center gap-3.5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-extrabold text-white">
            {number}
          </span>
          <div className="min-w-0">
            <h3 className="text-base font-extrabold text-primary">{title}</h3>
            <p className="mt-0.5 text-xs leading-5 text-muted">{description}</p>
          </div>
        </div>
        {action}
      </header>
      <div className="space-y-6 p-5 md:p-6">{children}</div>
    </section>
  );
}

function AddressModeSwitch({
  lockedMode,
  mode,
  onChange,
}: {
  lockedMode?: "old";
  mode: AddressMode;
  onChange: (mode: AddressMode) => void;
}) {
  return (
    <div className="inline-flex rounded-xl border border-border bg-surface p-1">
      {(
        [
          ["new", "Địa chỉ mới"],
          ["old", "Địa chỉ cũ"],
        ] as const
      ).map(([value, label]) => (
        <button
          className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
            mode === value
              ? "bg-primary text-white shadow-sm"
              : "text-muted hover:bg-surface-muted hover:text-primary"
          }`}
          disabled={Boolean(lockedMode && value !== lockedMode)}
          key={value}
          onClick={() => onChange(value)}
          type="button"
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function money(value: number) {
  return `${new Intl.NumberFormat("vi-VN").format(value)}đ`;
}

function locationAddress(
  location: SendMailLocationOption | undefined,
  mode: AddressMode,
): SendMailLocationAddress | undefined {
  if (!location) return undefined;
  return mode === "old" && location.oldAddress
    ? location.oldAddress
    : location.newAddress || location.oldAddress;
}

const PAYMENT_OPTIONS = [
  { label: "Không thu hộ", value: "1" },
  { label: "Thu hộ tiền hàng và cước", value: "2" },
  { label: "Thu hộ tiền hàng", value: "3" },
  { label: "Thu hộ tiền cước", value: "4" },
];

export function GuiThuForm({
  accounts,
  defaultSenderName,
  defaultSenderPhone,
  employees,
  locations,
}: {
  accounts: AccountOption[];
  defaultSenderName: string;
  defaultSenderPhone: string;
  employees: EmployeeOption[];
  locations: SendMailLocationOption[];
}) {
  const [state, action, pending] = useActionState(
    createMailOrderAction,
    initialState,
  );
  const { toast } = useToast();
  const seen = useRef<MailActionState | null>(null);

  const firstAccount = accounts[0];
  const firstLocation =
    locations.find(
      (location) => location.key === firstAccount?.defaultLocationKey,
    ) ||
    locations.find((location) => location.key === "q12-main") ||
    locations[0];
  const firstMode: AddressMode =
    firstLocation?.preferredAddressMode === "old" && firstLocation.oldAddress
      ? "old"
      : "new";
  const firstAddress = locationAddress(firstLocation, firstMode);

  const [accountId, setAccountId] = useState(firstAccount?.id ?? "");
  const env = accounts.find((account) => account.id === accountId)?.env ?? "PROD";

  const [senderLocationKey, setSenderLocationKey] = useState(
    firstLocation?.key ?? "",
  );
  const [senderAddressMode, setSenderAddressMode] =
    useState<AddressMode>(firstMode);
  const [senderName, setSenderName] = useState(defaultSenderName);
  const [senderPhone, setSenderPhone] = useState(defaultSenderPhone);
  const [senderAddress, setSenderAddress] = useState(
    firstAddress?.address ?? "",
  );
  const [senderProvince, setSenderProvince] = useState(
    firstAddress ? String(firstAddress.provinceId) : "",
  );
  const [senderDistrict, setSenderDistrict] = useState(
    firstAddress?.districtId ? String(firstAddress.districtId) : "",
  );
  const [senderWard, setSenderWard] = useState(
    firstAddress ? String(firstAddress.wardId) : "",
  );

  const [receiverLocationKey, setReceiverLocationKey] = useState("");
  const [receiverAddressMode, setReceiverAddressMode] =
    useState<AddressMode>("new");
  const [receiverName, setReceiverName] = useState("");
  const [receiverPhone, setReceiverPhone] = useState("");
  const [receiverAddress, setReceiverAddress] = useState("");
  const [receiverProvince, setReceiverProvince] = useState("");
  const [receiverDistrict, setReceiverDistrict] = useState("");
  const [receiverWard, setReceiverWard] = useState("");

  const [senderProvinces, setSenderProvinces] = useState<VtpProvince[]>([]);
  const [receiverProvinces, setReceiverProvinces] = useState<VtpProvince[]>([]);
  const [senderDistricts, setSenderDistricts] = useState<VtpDistrict[]>([]);
  const [receiverDistricts, setReceiverDistricts] = useState<VtpDistrict[]>([]);
  const [senderWards, setSenderWards] = useState<VtpWard[]>([]);
  const [receiverWards, setReceiverWards] = useState<VtpWard[]>([]);
  const [catalogError, setCatalogError] = useState("");
  const [catalogInfo, setCatalogInfo] = useState("");
  const [loadingCatalog, setLoadingCatalog] = useState(0);

  const [productType, setProductType] = useState<"TH" | "HH">("TH");
  const [productName, setProductName] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [weight, setWeight] = useState("50");
  const [productPrice, setProductPrice] = useState("0");
  const [moneyCollection, setMoneyCollection] = useState("0");
  const [productLength, setProductLength] = useState("0");
  const [productWidth, setProductWidth] = useState("0");
  const [productHeight, setProductHeight] = useState("0");
  const [orderPayment, setOrderPayment] = useState("1");
  const [orderNumber, setOrderNumber] = useState("");
  const [note, setNote] = useState("");

  const [services, setServices] = useState<VtpService[]>([]);
  const [loadingFee, setLoadingFee] = useState(false);
  const [feeError, setFeeError] = useState("");
  const [picked, setPicked] = useState<VtpService | null>(null);
  const [orderServiceAdd, setOrderServiceAdd] = useState("");
  const [successOpen, setSuccessOpen] = useState(false);

  function invalidateQuote() {
    setServices([]);
    setPicked(null);
    setOrderServiceAdd("");
    setFeeError("");
  }

  function reportCatalogError(message: string) {
    setCatalogError(message);
    toast({
      message,
      title: "Không tải được danh mục địa chỉ",
      tone: "error",
    });
  }

  useEffect(() => {
    let alive = true;
    void Promise.resolve()
      .then(() => {
        if (alive) setLoadingCatalog((count) => count + 1);
        return mailListProvinces(env, senderAddressMode);
      })
      .then((result) => {
        if (!alive) return;
        if (result.error) {
          reportCatalogError(result.error);
          setSenderProvinces([]);
          return;
        }
        setCatalogError("");
        setSenderProvinces(result.provinces);
        if (result.syncedAt) {
          setCatalogInfo(
            `Danh mục ${senderAddressMode === "old" ? "cũ" : "mới"} từ PostgreSQL · cập nhật ${new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" }).format(new Date(result.syncedAt))}`,
          );
        }
      })
      .finally(() => {
        if (alive) setLoadingCatalog((count) => Math.max(0, count - 1));
      });
    return () => {
      alive = false;
    };
    // toast ổn định từ ToastProvider; chỉ tải lại khi env/chế độ thay đổi.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [env, senderAddressMode]);

  useEffect(() => {
    let alive = true;
    void Promise.resolve()
      .then(() => {
        if (alive) setLoadingCatalog((count) => count + 1);
        return mailListProvinces(env, receiverAddressMode);
      })
      .then((result) => {
        if (!alive) return;
        if (result.error) {
          reportCatalogError(result.error);
          setReceiverProvinces([]);
          return;
        }
        setCatalogError("");
        setReceiverProvinces(result.provinces);
      })
      .finally(() => {
        if (alive) setLoadingCatalog((count) => Math.max(0, count - 1));
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [env, receiverAddressMode]);

  useEffect(() => {
    if (senderAddressMode !== "old" || !senderProvince) {
      return;
    }
    let alive = true;
    void Promise.resolve()
      .then(() => {
        if (alive) setLoadingCatalog((count) => count + 1);
        return mailListDistricts(env, Number(senderProvince));
      })
      .then((result) => {
        if (!alive) return;
        if (result.error) reportCatalogError(result.error);
        setSenderDistricts(result.districts);
      })
      .finally(() => {
        if (alive) setLoadingCatalog((count) => Math.max(0, count - 1));
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [env, senderAddressMode, senderProvince]);

  useEffect(() => {
    if (receiverAddressMode !== "old" || !receiverProvince) {
      return;
    }
    let alive = true;
    void Promise.resolve()
      .then(() => {
        if (alive) setLoadingCatalog((count) => count + 1);
        return mailListDistricts(env, Number(receiverProvince));
      })
      .then((result) => {
        if (!alive) return;
        if (result.error) reportCatalogError(result.error);
        setReceiverDistricts(result.districts);
      })
      .finally(() => {
        if (alive) setLoadingCatalog((count) => Math.max(0, count - 1));
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [env, receiverAddressMode, receiverProvince]);

  useEffect(() => {
    const lookupReady =
      senderAddressMode === "old" ? senderDistrict : senderProvince;
    if (!lookupReady) {
      return;
    }
    let alive = true;
    void Promise.resolve()
      .then(() => {
        if (alive) setLoadingCatalog((count) => count + 1);
        return mailListWards(env, {
          addressMode: senderAddressMode,
          districtId: Number(senderDistrict) || undefined,
          provinceId: Number(senderProvince) || undefined,
        });
      })
      .then((result) => {
        if (!alive) return;
        if (result.error) reportCatalogError(result.error);
        setSenderWards(result.wards);
      })
      .finally(() => {
        if (alive) setLoadingCatalog((count) => Math.max(0, count - 1));
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [env, senderAddressMode, senderDistrict, senderProvince]);

  useEffect(() => {
    const lookupReady =
      receiverAddressMode === "old" ? receiverDistrict : receiverProvince;
    if (!lookupReady) {
      return;
    }
    let alive = true;
    void Promise.resolve()
      .then(() => {
        if (alive) setLoadingCatalog((count) => count + 1);
        return mailListWards(env, {
          addressMode: receiverAddressMode,
          districtId: Number(receiverDistrict) || undefined,
          provinceId: Number(receiverProvince) || undefined,
        });
      })
      .then((result) => {
        if (!alive) return;
        if (result.error) reportCatalogError(result.error);
        setReceiverWards(result.wards);
      })
      .finally(() => {
        if (alive) setLoadingCatalog((count) => Math.max(0, count - 1));
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    env,
    receiverAddressMode,
    receiverDistrict,
    receiverProvince,
  ]);

  useEffect(() => {
    if (state === seen.current) return;
    seen.current = state;
    queueMicrotask(() => {
      if (state.success) {
        setSuccessOpen(true);
        toast({
          message: state.success,
          title: "Tạo vận đơn thành công",
          tone: "success",
        });
        if (state.warning) {
          toast({
            message: state.warning,
            title: "Vận đơn đã tạo, link in chưa sẵn sàng",
            tone: "warning",
          });
        }
      } else if (state.error) {
        toast({
          message: state.error,
          title: "Không tạo được đơn",
          tone: "error",
        });
      }
    });
  }, [state, toast]);

  function applyLocation(
    party: "sender" | "receiver",
    locationKey: string,
  ) {
    const location = locations.find((item) => item.key === locationKey);
    if (!location) {
      if (party === "sender") setSenderLocationKey("");
      else setReceiverLocationKey("");
      invalidateQuote();
      return;
    }
    const mode: AddressMode =
      location.preferredAddressMode === "old" && location.oldAddress
        ? "old"
        : "new";
    const address = locationAddress(location, mode);
    if (!address) return;

    if (party === "sender") {
      setSenderLocationKey(location.key);
      setSenderAddressMode(mode);
      setSenderAddress(address.address);
      setSenderProvince(String(address.provinceId));
      setSenderDistrict(address.districtId ? String(address.districtId) : "");
      setSenderWard(String(address.wardId));
    } else {
      setReceiverLocationKey(location.key);
      setReceiverAddressMode(mode);
      setReceiverAddress(address.address);
      setReceiverProvince(String(address.provinceId));
      setReceiverDistrict(address.districtId ? String(address.districtId) : "");
      setReceiverWard(String(address.wardId));
    }
    invalidateQuote();
  }

  function changeAddressMode(party: "sender" | "receiver", mode: AddressMode) {
    const selectedLocation =
      party === "sender" ? senderLocationKey : receiverLocationKey;
    const location = locations.find((item) => item.key === selectedLocation);
    if (location?.lockedAddressMode) {
      mode = location.lockedAddressMode;
    }
    const preset = locationAddress(location, mode);
    if (party === "sender") {
      setSenderAddressMode(mode);
      setSenderDistrict("");
      setSenderWard("");
      setSenderWards([]);
      if (preset) {
        setSenderAddress(preset.address);
        setSenderProvince(String(preset.provinceId));
        setSenderDistrict(preset.districtId ? String(preset.districtId) : "");
        setSenderWard(String(preset.wardId));
      }
    } else {
      setReceiverAddressMode(mode);
      setReceiverDistrict("");
      setReceiverWard("");
      setReceiverWards([]);
      if (preset) {
        setReceiverAddress(preset.address);
        setReceiverProvince(String(preset.provinceId));
        setReceiverDistrict(preset.districtId ? String(preset.districtId) : "");
        setReceiverWard(String(preset.wardId));
      }
    }
    invalidateQuote();
  }

  function changeAccount(nextAccountId: string) {
    setAccountId(nextAccountId);
    const account = accounts.find((item) => item.id === nextAccountId);
    if (account?.defaultLocationKey) {
      applyLocation("sender", account.defaultLocationKey);
    } else {
      invalidateQuote();
    }
  }

  function onReceiverName(name: string) {
    setReceiverName(name);
    const employee = employees.find((item) => item.name === name);
    if (employee) setReceiverPhone(employee.phone);
    invalidateQuote();
  }

  function resetForNextOrder() {
    setReceiverLocationKey("");
    setReceiverAddressMode("new");
    setReceiverName("");
    setReceiverPhone("");
    setReceiverAddress("");
    setReceiverProvince("");
    setReceiverDistrict("");
    setReceiverWard("");
    setReceiverDistricts([]);
    setReceiverWards([]);
    setProductType("TH");
    setProductName("");
    setQuantity("1");
    setWeight("50");
    setProductPrice("0");
    setMoneyCollection("0");
    setProductLength("0");
    setProductWidth("0");
    setProductHeight("0");
    setOrderPayment("1");
    setOrderNumber("");
    setNote("");
    invalidateQuote();
  }

  async function checkFee() {
    setFeeError("");
    setLoadingFee(true);
    setPicked(null);
    setOrderServiceAdd("");
    toast({
      message: "Đang lấy dịch vụ và mức cước cho tuyến đã chọn.",
      title: "Đang kiểm tra cước Viettel Post",
      tone: "info",
      duration: 2500,
    });
    const result = await mailGetServices({
      accountId,
      moneyCollection:
        productType === "HH" ? Number(moneyCollection) || 0 : 0,
      productHeight:
        productType === "HH" ? Number(productHeight) || 0 : 0,
      productLength:
        productType === "HH" ? Number(productLength) || 0 : 0,
      productPrice: productType === "HH" ? Number(productPrice) || 0 : 0,
      productType,
      productWeight: productType === "HH" ? Number(weight) || 1 : 50,
      productWidth: productType === "HH" ? Number(productWidth) || 0 : 0,
      receiverAddressMode,
      receiverDistrict: Number(receiverDistrict) || 0,
      receiverProvince: Number(receiverProvince) || 0,
      receiverWard: Number(receiverWard) || 0,
      senderAddressMode,
      senderDistrict: Number(senderDistrict) || 0,
      senderProvince: Number(senderProvince) || 0,
      senderWard: Number(senderWard) || 0,
    });
    setLoadingFee(false);
    if (result.error) {
      setFeeError(result.error);
      setServices([]);
      toast({
        message: result.error,
        title: "Không lấy được cước",
        tone: "error",
      });
      return;
    }
    setServices(result.services);
    if (!result.services.length) {
      setFeeError("Không có dịch vụ phù hợp tuyến này.");
    } else {
      toast({
        message: `Đã nhận ${result.services.length} gói dịch vụ.`,
        title: "Đã lấy cước Viettel Post",
        tone: "success",
      });
    }
  }

  const canCheckFee = Boolean(
    accountId &&
      senderProvince &&
      senderWard &&
      receiverProvince &&
      receiverWard &&
      (senderAddressMode === "new" || senderDistrict) &&
      (receiverAddressMode === "new" || receiverDistrict),
  );
  const canSubmit = Boolean(
    canCheckFee &&
      senderName.trim() &&
      senderPhone.trim() &&
      senderAddress.trim() &&
      receiverName.trim() &&
      receiverPhone.trim() &&
      receiverAddress.trim() &&
      picked,
  );

  function provinceSelect(
    list: VtpProvince[],
    value: string,
    onChange: (value: string) => void,
  ) {
    return (
      <Select
        disabled={loadingCatalog > 0 && !list.length}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        <option value="">
          {loadingCatalog > 0 && !list.length
            ? "Đang tải tỉnh/thành..."
            : "Chọn tỉnh/thành"}
        </option>
        {list.map((province) => (
          <option key={province.id} value={province.id}>
            {province.name}
          </option>
        ))}
      </Select>
    );
  }

  function districtSelect(
    list: VtpDistrict[],
    value: string,
    onChange: (value: string) => void,
    provinceChosen: boolean,
  ) {
    return (
      <Select
        disabled={!provinceChosen}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        <option value="">
          {provinceChosen ? "Chọn quận/huyện" : "Chọn tỉnh trước"}
        </option>
        {list.map((district) => (
          <option key={district.id} value={district.id}>
            {district.name}
          </option>
        ))}
      </Select>
    );
  }

  function wardSelect(
    list: VtpWard[],
    value: string,
    onChange: (value: string) => void,
    parentChosen: boolean,
  ) {
    return (
      <Select
        disabled={!parentChosen}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        <option value="">
          {parentChosen ? "Chọn phường/xã" : "Chọn khu vực trước"}
        </option>
        {list.map((ward) => (
          <option key={ward.id} value={ward.id}>
            {ward.name}
            {ward.districtName ? ` — ${ward.districtName}` : ""}
          </option>
        ))}
      </Select>
    );
  }

  const senderProvinceName =
    senderProvinces.find((item) => String(item.id) === senderProvince)?.name ||
    firstAddress?.provinceName ||
    "";
  const senderDistrictName =
    senderDistricts.find((item) => String(item.id) === senderDistrict)?.name ||
    firstAddress?.districtName ||
    "";
  const senderWardName =
    senderWards.find((item) => String(item.id) === senderWard)?.name ||
    firstAddress?.wardName ||
    "";
  const receiverProvinceName =
    receiverProvinces.find((item) => String(item.id) === receiverProvince)
      ?.name || "";
  const receiverDistrictName =
    receiverDistricts.find((item) => String(item.id) === receiverDistrict)
      ?.name || "";
  const receiverWardName =
    receiverWards.find((item) => String(item.id) === receiverWard)?.name || "";
  const selectedSenderLocation = locations.find(
    (item) => item.key === senderLocationKey,
  );
  const selectedReceiverLocation = locations.find(
    (item) => item.key === receiverLocationKey,
  );

  return (
    <>
      <WriteLoadingOverlay
        message="Đang tạo vận đơn và lấy link in A5..."
        show={pending}
      />

      <div className="space-y-6">
        <div className="rounded-2xl border border-primary/15 bg-primary/[0.035] p-5">
          <div className="grid items-end gap-5 lg:grid-cols-[minmax(0,1fr)_auto]">
            <Field
              hint="Danh sách đã lọc theo công ty/phòng ban được cấp quyền."
              label="Tài khoản Viettel Post gửi"
            >
              <Select
                onChange={(event) => changeAccount(event.target.value)}
                value={accountId}
              >
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                    {account.company ? ` · ${account.company}` : ""}
                    {account.hasToken ? "" : " (chưa có token)"}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="pb-1 text-xs text-muted">
              {catalogInfo || "Danh mục địa chỉ đang được nạp từ PostgreSQL"}
            </div>
          </div>
        </div>

        {catalogError ? (
          <div className="rounded-xl border border-danger/40 bg-danger/5 px-4 py-3 text-sm text-danger">
            {catalogError}
          </div>
        ) : null}

        <div className="grid items-start gap-6 xl:grid-cols-2">
          <MailSection
            description="Chọn văn phòng gửi hoặc nhập địa chỉ khác."
            number={1}
            title="Người gửi"
          >
            <Field label="Văn phòng / chi nhánh gửi">
              <Select
                onChange={(event) =>
                  applyLocation("sender", event.target.value)
                }
                value={senderLocationKey}
              >
                <option value="">Khác — nhập tay</option>
                {locations.map((location) => (
                  <option key={location.key} value={location.key}>
                    {location.label}
                  </option>
                ))}
              </Select>
            </Field>

            <div className="flex flex-wrap items-center justify-between gap-3 border-y border-border/70 py-3">
              <span className="text-xs font-bold uppercase tracking-[0.12em] text-muted">
                Hệ địa chỉ
              </span>
              <AddressModeSwitch
                lockedMode={selectedSenderLocation?.lockedAddressMode}
                mode={senderAddressMode}
                onChange={(mode) => changeAddressMode("sender", mode)}
              />
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Tên người gửi">
                <Input
                  onChange={(event) => setSenderName(event.target.value)}
                  readOnly
                  value={senderName}
                />
              </Field>
              <Field label="SĐT người gửi">
                <Input
                  onChange={(event) => setSenderPhone(event.target.value)}
                  readOnly
                  value={senderPhone}
                />
              </Field>
            </div>

            <div
              className={`grid gap-5 ${
                senderAddressMode === "old"
                  ? "sm:grid-cols-3"
                  : "sm:grid-cols-2"
              }`}
            >
              <Field label="Tỉnh/Thành gửi">
                {provinceSelect(
                  senderProvinces,
                  senderProvince,
                  (value) => {
                    setSenderProvince(value);
                    setSenderDistrict("");
                    setSenderWard("");
                    setSenderDistricts([]);
                    setSenderWards([]);
                    invalidateQuote();
                  },
                )}
              </Field>
              {senderAddressMode === "old" ? (
                <Field label="Quận/Huyện gửi">
                  {districtSelect(
                    senderDistricts,
                    senderDistrict,
                    (value) => {
                      setSenderDistrict(value);
                      setSenderWard("");
                      setSenderWards([]);
                      invalidateQuote();
                    },
                    Boolean(senderProvince),
                  )}
                </Field>
              ) : null}
              <Field label="Phường/Xã gửi">
                {wardSelect(
                  senderWards,
                  senderWard,
                  (value) => {
                    setSenderWard(value);
                    invalidateQuote();
                  },
                  senderAddressMode === "old"
                    ? Boolean(senderDistrict)
                    : Boolean(senderProvince),
                )}
              </Field>
            </div>

            <Field label="Địa chỉ chi tiết gửi">
              <textarea
                className={textareaClass}
                onChange={(event) => {
                  setSenderAddress(event.target.value);
                  invalidateQuote();
                }}
                placeholder="Số nhà, đường..."
                value={senderAddress}
              />
            </Field>
          </MailSection>

          <MailSection
            description="Có thể chọn nhân sự nội bộ và điểm nhận có sẵn."
            number={2}
            title="Người nhận"
          >
            <Field label="Điểm nhận có sẵn">
              <Select
                onChange={(event) =>
                  applyLocation("receiver", event.target.value)
                }
                value={receiverLocationKey}
              >
                <option value="">Khác — nhập tay</option>
                {locations.map((location) => (
                  <option key={location.key} value={location.key}>
                    {location.label}
                  </option>
                ))}
              </Select>
            </Field>

            <div className="flex flex-wrap items-center justify-between gap-3 border-y border-border/70 py-3">
              <span className="text-xs font-bold uppercase tracking-[0.12em] text-muted">
                Hệ địa chỉ
              </span>
              <AddressModeSwitch
                lockedMode={selectedReceiverLocation?.lockedAddressMode}
                mode={receiverAddressMode}
                onChange={(mode) => changeAddressMode("receiver", mode)}
              />
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <Field
                hint="Tìm theo tên; chọn nhân sự để tự điền SĐT."
                label="Tên người nhận"
              >
                <Input
                  list="send-mail-receiver-employees"
                  onChange={(event) => onReceiverName(event.target.value)}
                  value={receiverName}
                />
                <datalist id="send-mail-receiver-employees">
                  {employees.map((employee) => (
                    <option
                      key={employee.employeeId}
                      label={[
                        employee.phone,
                        employee.department,
                        employee.company,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                      value={employee.name}
                    />
                  ))}
                </datalist>
              </Field>
              <Field label="SĐT người nhận">
                <Input
                  onChange={(event) => {
                    setReceiverPhone(event.target.value);
                    invalidateQuote();
                  }}
                  value={receiverPhone}
                />
              </Field>
            </div>

            <div
              className={`grid gap-5 ${
                receiverAddressMode === "old"
                  ? "sm:grid-cols-3"
                  : "sm:grid-cols-2"
              }`}
            >
              <Field label="Tỉnh/Thành nhận">
                {provinceSelect(
                  receiverProvinces,
                  receiverProvince,
                  (value) => {
                    setReceiverProvince(value);
                    setReceiverDistrict("");
                    setReceiverWard("");
                    setReceiverDistricts([]);
                    setReceiverWards([]);
                    invalidateQuote();
                  },
                )}
              </Field>
              {receiverAddressMode === "old" ? (
                <Field label="Quận/Huyện nhận">
                  {districtSelect(
                    receiverDistricts,
                    receiverDistrict,
                    (value) => {
                      setReceiverDistrict(value);
                      setReceiverWard("");
                      setReceiverWards([]);
                      invalidateQuote();
                    },
                    Boolean(receiverProvince),
                  )}
                </Field>
              ) : null}
              <Field label="Phường/Xã nhận">
                {wardSelect(
                  receiverWards,
                  receiverWard,
                  (value) => {
                    setReceiverWard(value);
                    invalidateQuote();
                  },
                  receiverAddressMode === "old"
                    ? Boolean(receiverDistrict)
                    : Boolean(receiverProvince),
                )}
              </Field>
            </div>

            <Field label="Địa chỉ chi tiết nhận">
              <textarea
                className={textareaClass}
                onChange={(event) => {
                  setReceiverAddress(event.target.value);
                  invalidateQuote();
                }}
                placeholder="Số nhà, đường..."
                value={receiverAddress}
              />
            </Field>
          </MailSection>
        </div>

        <MailSection
          description="Thư/hồ sơ dùng cấu hình nhanh 50g; hàng hoá mở đầy đủ trọng lượng, COD và kích thước."
          number={3}
          title="Chi tiết bưu gửi"
        >
          <div className="inline-flex rounded-xl border border-border bg-surface p-1">
            {(
              [
                ["TH", "Thư / hồ sơ"],
                ["HH", "Hàng hóa"],
              ] as const
            ).map(([value, label]) => (
              <button
                className={`rounded-lg px-4 py-2 text-sm font-bold transition ${
                  productType === value
                    ? "bg-accent text-white shadow-sm"
                    : "text-primary hover:bg-surface-muted"
                }`}
                key={value}
                onClick={() => {
                  setProductType(value);
                  if (value === "TH") setOrderPayment("1");
                  invalidateQuote();
                }}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>

          {productType === "HH" ? (
            <div className="grid gap-5 md:grid-cols-3">
              <Field label="Tên hàng">
                <Input
                  onChange={(event) => {
                    setProductName(event.target.value);
                    invalidateQuote();
                  }}
                  placeholder="Tên hàng hóa"
                  value={productName}
                />
              </Field>
              <Field label="Số lượng">
                <Input
                  min={1}
                  onChange={(event) => {
                    setQuantity(event.target.value);
                    invalidateQuote();
                  }}
                  type="number"
                  value={quantity}
                />
              </Field>
              <Field hint="gram" label="Trọng lượng">
                <Input
                  min={1}
                  onChange={(event) => {
                    setWeight(event.target.value);
                    invalidateQuote();
                  }}
                  type="number"
                  value={weight}
                />
              </Field>
              <Field hint="VNĐ" label="Giá trị hàng">
                <Input
                  min={0}
                  onChange={(event) => {
                    setProductPrice(event.target.value);
                    invalidateQuote();
                  }}
                  type="number"
                  value={productPrice}
                />
              </Field>
              <Field hint="VNĐ · COD" label="Tiền thu hộ">
                <Input
                  min={0}
                  onChange={(event) => {
                    const value = event.target.value;
                    setMoneyCollection(value);
                    if (Number(value) > 0 && orderPayment === "1") {
                      setOrderPayment("3");
                    }
                    invalidateQuote();
                  }}
                  type="number"
                  value={moneyCollection}
                />
              </Field>
              <Field label="Thanh toán">
                <Select
                  onChange={(event) => {
                    setOrderPayment(event.target.value);
                    invalidateQuote();
                  }}
                  value={orderPayment}
                >
                  {PAYMENT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field hint="cm" label="Dài">
                <Input
                  min={0}
                  onChange={(event) => {
                    setProductLength(event.target.value);
                    invalidateQuote();
                  }}
                  type="number"
                  value={productLength}
                />
              </Field>
              <Field hint="cm" label="Rộng">
                <Input
                  min={0}
                  onChange={(event) => {
                    setProductWidth(event.target.value);
                    invalidateQuote();
                  }}
                  type="number"
                  value={productWidth}
                />
              </Field>
              <Field hint="cm" label="Cao">
                <Input
                  min={0}
                  onChange={(event) => {
                    setProductHeight(event.target.value);
                    invalidateQuote();
                  }}
                  type="number"
                  value={productHeight}
                />
              </Field>
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-surface-muted/55 px-4 py-3 text-sm leading-6 text-muted">
              Thư/hồ sơ: tên “Thư/hồ sơ”, số lượng 1, trọng lượng 50g,
              không thu hộ.
            </div>
          )}

          <div className="grid gap-5 md:grid-cols-2">
            <Field hint="Để trống để Viettel Post tự sinh." label="Mã đơn nội bộ">
              <Input
                onChange={(event) => setOrderNumber(event.target.value)}
                value={orderNumber}
              />
            </Field>
            <Field label="Ghi chú phát hàng">
              <Input
                onChange={(event) => setNote(event.target.value)}
                placeholder="Ví dụ: gọi trước khi giao"
                value={note}
              />
            </Field>
          </div>
        </MailSection>

        <MailSection
          action={
            <Button
              disabled={!canCheckFee || loadingFee}
              onClick={checkFee}
              size="sm"
              type="button"
              variant="secondary"
            >
              {loadingFee ? "Đang lấy cước..." : "Kiểm tra cước"}
            </Button>
          }
          description="Mỗi khi đổi tuyến hoặc thông tin hàng, báo giá cũ sẽ tự xoá để tránh tạo sai cước."
          number={4}
          title="Dịch vụ và cước Viettel Post"
        >
          {!canCheckFee ? (
            <p className="text-sm leading-6 text-muted">
              Chọn đủ địa chỉ người gửi và người nhận để lấy danh sách dịch vụ.
            </p>
          ) : null}
          {feeError ? (
            <div className="rounded-xl border border-danger/40 bg-danger/5 px-4 py-3 text-sm text-danger">
              {feeError}
            </div>
          ) : null}
          {services.length ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {services.map((service) => {
                const selected = picked?.code === service.code;
                return (
                  <button
                    className={`rounded-2xl border px-4 py-4 text-left transition ${
                      selected
                        ? "border-accent bg-accent-soft shadow-[0_10px_24px_rgba(226,102,37,0.12)]"
                        : "border-border bg-surface hover:border-primary/25 hover:bg-surface-muted"
                    }`}
                    key={service.code}
                    onClick={() => {
                      setPicked(service);
                      setOrderServiceAdd("");
                    }}
                    type="button"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span className="font-bold leading-5 text-primary">
                        {service.name || service.code}
                      </span>
                      <span className="shrink-0 font-mono text-sm font-extrabold text-accent">
                        {money(service.fee)}
                      </span>
                    </div>
                    <div className="mt-2 text-xs leading-5 text-muted">
                      {service.code}
                      {service.eta ? ` · ${service.eta}` : ""}
                      {service.extra.length
                        ? ` · +${service.extra.length} dịch vụ thêm`
                        : ""}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : null}
          {picked?.extra.length ? (
            <Field label="Dịch vụ cộng thêm">
              <Select
                onChange={(event) => setOrderServiceAdd(event.target.value)}
                value={orderServiceAdd}
              >
                <option value="">Không dùng</option>
                {picked.extra.map((extra) => (
                  <option key={extra.code} value={extra.code}>
                    {extra.name || extra.code}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
        </MailSection>

        <MailSection
          description="Kiểm tra lần cuối trước khi gửi yêu cầu tạo vận đơn."
          number={5}
          title="Xác nhận và tạo đơn"
        >
          {picked ? (
            <div className="grid gap-4 rounded-2xl border border-primary/15 bg-primary/[0.035] p-5 lg:grid-cols-[1fr_auto_1fr]">
              <div>
                <div className="text-xs font-bold uppercase tracking-[0.12em] text-muted">
                  Người gửi
                </div>
                <div className="mt-2 font-extrabold text-primary">
                  {senderName || "—"}
                </div>
                <div className="mt-1 text-sm text-muted">{senderPhone}</div>
                <div className="mt-2 text-sm leading-6 text-foreground">
                  {[
                    senderAddress,
                    senderWardName,
                    senderAddressMode === "old" ? senderDistrictName : "",
                    senderProvinceName,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                </div>
              </div>
              <div className="hidden items-center text-xl text-accent lg:flex">
                →
              </div>
              <div>
                <div className="text-xs font-bold uppercase tracking-[0.12em] text-muted">
                  Người nhận
                </div>
                <div className="mt-2 font-extrabold text-primary">
                  {receiverName || "—"}
                </div>
                <div className="mt-1 text-sm text-muted">{receiverPhone}</div>
                <div className="mt-2 text-sm leading-6 text-foreground">
                  {[
                    receiverAddress,
                    receiverWardName,
                    receiverAddressMode === "old" ? receiverDistrictName : "",
                    receiverProvinceName,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                </div>
              </div>
              <div className="border-t border-border pt-4 lg:col-span-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="font-bold text-primary">
                      {picked.code} · {picked.name}
                    </div>
                    <div className="mt-1 text-xs text-muted">
                      {productType === "TH"
                        ? "Thư / hồ sơ · 50g"
                        : `${productName || "Hàng hóa"} · ${weight}g`}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs font-bold uppercase tracking-wide text-muted">
                      Cước dự kiến
                    </div>
                    <div className="mt-1 text-xl font-extrabold text-accent">
                      {money(picked.fee)}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border px-4 py-5 text-center text-sm text-muted">
              Kiểm tra cước và chọn một dịch vụ để xem phần xác nhận.
            </div>
          )}

          <form action={action}>
            <input name="accountId" type="hidden" value={accountId} />
            <input
              name="senderAddressMode"
              type="hidden"
              value={senderAddressMode}
            />
            <input name="senderName" type="hidden" value={senderName} />
            <input name="senderPhone" type="hidden" value={senderPhone} />
            <input name="senderAddress" type="hidden" value={senderAddress} />
            <input
              name="senderProvince"
              type="hidden"
              value={senderProvince}
            />
            <input
              name="senderDistrict"
              type="hidden"
              value={senderDistrict}
            />
            <input name="senderWard" type="hidden" value={senderWard} />
            <input
              name="receiverAddressMode"
              type="hidden"
              value={receiverAddressMode}
            />
            <input name="receiverName" type="hidden" value={receiverName} />
            <input name="receiverPhone" type="hidden" value={receiverPhone} />
            <input
              name="receiverAddress"
              type="hidden"
              value={receiverAddress}
            />
            <input
              name="receiverProvince"
              type="hidden"
              value={receiverProvince}
            />
            <input
              name="receiverDistrict"
              type="hidden"
              value={receiverDistrict}
            />
            <input name="receiverWard" type="hidden" value={receiverWard} />
            <input name="productType" type="hidden" value={productType} />
            <input name="productName" type="hidden" value={productName} />
            <input name="quantity" type="hidden" value={quantity} />
            <input name="weight" type="hidden" value={weight} />
            <input name="productPrice" type="hidden" value={productPrice} />
            <input
              name="moneyCollection"
              type="hidden"
              value={moneyCollection}
            />
            <input
              name="productLength"
              type="hidden"
              value={productLength}
            />
            <input
              name="productWidth"
              type="hidden"
              value={productWidth}
            />
            <input
              name="productHeight"
              type="hidden"
              value={productHeight}
            />
            <input name="orderPayment" type="hidden" value={orderPayment} />
            <input name="orderNumber" type="hidden" value={orderNumber} />
            <input name="note" type="hidden" value={note} />
            <input
              name="orderService"
              type="hidden"
              value={picked?.code ?? ""}
            />
            <input
              name="serviceName"
              type="hidden"
              value={picked?.name ?? ""}
            />
            <input
              name="orderServiceAdd"
              type="hidden"
              value={orderServiceAdd}
            />
            <Button
              className="w-full"
              disabled={pending || !canSubmit}
              type="submit"
            >
              {pending ? "Đang tạo vận đơn..." : "Tạo vận đơn Viettel Post"}
            </Button>
          </form>
        </MailSection>
      </div>

      {successOpen ? (
        <div
          aria-modal="true"
          className="fixed inset-0 z-[190] grid place-items-center bg-[rgba(7,24,21,0.5)] px-4 backdrop-blur-sm"
          role="dialog"
        >
          <div className="w-full max-w-lg rounded-3xl border border-border bg-surface p-6 shadow-[0_30px_80px_rgba(17,45,39,0.3)] md:p-8">
            <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-[#e8f8f1] text-2xl font-extrabold text-[#0c6e4c]">
              ✓
            </div>
            <h3 className="mt-4 text-center text-xl font-extrabold text-primary">
              Tạo vận đơn thành công
            </h3>
            <p className="mt-2 text-center text-sm leading-6 text-muted">
              Mã vận đơn{" "}
              <strong className="font-mono text-accent">
                {state.trackingCode}
              </strong>{" "}
              đã được lưu vào Đơn của tôi.
            </p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <Button
                onClick={() => {
                  if (state.printUrl) {
                    window.open(state.printUrl, "_blank", "noopener,noreferrer");
                  }
                }}
                type="button"
                variant="secondary"
                disabled={!state.printUrl}
              >
                {state.printUrl ? "In nhãn A5" : "Chưa có link in"}
              </Button>
              <Button
                onClick={() => {
                  setSuccessOpen(false);
                  resetForNextOrder();
                }}
                type="button"
              >
                Tạo đơn tiếp theo
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
