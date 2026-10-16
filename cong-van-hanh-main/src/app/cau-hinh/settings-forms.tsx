"use client";

import { useRouter } from "next/navigation";
import {
  useActionState,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";

import { Button, Input, LinkButton, Select } from "@/components/ui";
import { MultiSelect, type MultiOption } from "@/components/ui/multi-select";
import { useToast, WriteLoadingOverlay } from "@/components/ui/toast";

import {
  configListProvincesAction,
  configListWardsAction,
  createEmployeeAction,
  createUserAction,
  deletePersonnelIdentityLinkAction,
  saveCompanyAction,
  savePersonnelIdentityLinkAction,
  type PersonnelIdentityActionState,
  type SettingsActionState,
} from "./actions";

const initialState: SettingsActionState = {};

type CompanyOption = {
  code: string;
  id: string;
  legalName: string;
  shortName: string | null;
};

type EmployeeOption = {
  employeeCode: string;
  fullName: string;
  id: string;
};

type RoleOption = {
  id: string;
  key: string;
  name: string;
};

function Message({ state }: { state: SettingsActionState }) {
  if (state.error) {
    return (
      <div className="rounded-lg border border-[#eebfbf] bg-[#fdeeee] px-3 py-2 text-sm font-semibold text-danger">
        {state.error}
      </div>
    );
  }

  if (state.success) {
    return (
      <div className="rounded-lg border border-[#b6e2d1] bg-[#e4f7ef] px-3 py-2 text-sm font-semibold text-success">
        {state.success}
      </div>
    );
  }

  return null;
}

function useActionToast(
  state: SettingsActionState,
  title: string,
  reset?: () => void,
) {
  const { toast } = useToast();
  const seen = useRef<SettingsActionState | null>(null);

  useEffect(() => {
    if (state === seen.current) return;
    seen.current = state;
    if (state.success) {
      toast({ message: state.success, title, tone: "success" });
      reset?.();
    } else if (state.error) {
      toast({ message: state.error, title: "Không thể hoàn tất", tone: "error" });
    }
  }, [reset, state, title, toast]);
}

function Field({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <label className="space-y-2 text-sm font-semibold text-foreground">
      <span>{label}</span>
      {children}
    </label>
  );
}

export type EditingCompany = {
  address: string | null;
  branchName: string | null;
  businessRegistration: string | null;
  code: string;
  id: string;
  legalName: string;
  oldAddress: string | null;
  oldDistrictId: string | null;
  oldDistrictName: string | null;
  oldProvinceId: string | null;
  oldProvinceName: string | null;
  oldWardId: string | null;
  oldWardName: string | null;
  representative: string | null;
  sendMailAddressPriority: string;
  sendMailLocationKey: string | null;
  shortName: string | null;
  status: string;
  taxCode: string | null;
};

export function CompanyForm({ editing }: { editing?: EditingCompany | null }) {
  const [state, action, pending] = useActionState(
    saveCompanyAction,
    initialState,
  );
  const [provinces, setProvinces] = useState<{ id: number; name: string }[]>([]);
  const [wards, setWards] = useState<
    { districtId: number; districtName: string; id: number; name: string }[]
  >([]);
  const [provinceId, setProvinceId] = useState(editing?.oldProvinceId ?? "");
  const [districtId, setDistrictId] = useState(editing?.oldDistrictId ?? "");
  const [wardId, setWardId] = useState(editing?.oldWardId ?? "");
  const [addressPriority, setAddressPriority] = useState(
    editing?.sendMailAddressPriority === "old" ? "old" : "new",
  );
  const { toast } = useToast();

  useActionToast(state, "Cấu hình công ty");

  useEffect(() => {
    let mounted = true;
    configListProvincesAction().then((response) => {
      if (!mounted) return;
      setProvinces(response.provinces);
      if (response.error) {
        toast({
          message: response.error,
          title: "Không tải được danh mục địa chỉ",
          tone: "warning",
        });
      }
    });
    return () => {
      mounted = false;
    };
  }, [toast]);

  useEffect(() => {
    if (!provinceId) {
      return;
    }
    let mounted = true;
    configListWardsAction(Number(provinceId)).then((response) => {
      if (!mounted) return;
      setWards(response.wards);
      if (response.error) {
        toast({
          message: response.error,
          title: "Không tải được Quận/Huyện, Phường/Xã",
          tone: "warning",
        });
      }
    });
    return () => {
      mounted = false;
    };
  }, [provinceId, toast]);

  const districts = useMemo(() => {
    const byId = new Map<number, string>();
    wards.forEach((ward) => {
      if (ward.districtId && ward.districtName) {
        byId.set(ward.districtId, ward.districtName);
      }
    });
    return [...byId].map(([id, name]) => ({ id, name }));
  }, [wards]);
  const visibleWards = useMemo(
    () => wards.filter((ward) => String(ward.districtId) === districtId),
    [districtId, wards],
  );
  const selectedProvinceName =
    provinces.find((item) => String(item.id) === provinceId)?.name ??
    editing?.oldProvinceName ??
    "";
  const selectedDistrictName =
    districts.find((item) => String(item.id) === districtId)?.name ??
    editing?.oldDistrictName ??
    "";
  const selectedWardName =
    visibleWards.find((item) => String(item.id) === wardId)?.name ??
    editing?.oldWardName ??
    "";

  return (
    <>
      <WriteLoadingOverlay message="Đang lưu cấu hình công ty..." show={pending} />
      <form action={action} className="space-y-5" key={editing?.id ?? "new"}>
        <input name="editId" type="hidden" value={editing?.id ?? ""} />
        <input name="oldProvinceName" type="hidden" value={selectedProvinceName} />
        <input name="oldDistrictName" type="hidden" value={selectedDistrictName} />
        <input name="oldWardName" type="hidden" value={selectedWardName} />
        <input name="sendMailAddressPriority" type="hidden" value={addressPriority} />
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Công ty">
            <Input
              defaultValue={editing?.legalName ?? ""}
              name="legalName"
              placeholder="Tên pháp lý công ty"
              required
            />
          </Field>
          <Field label="Viết tắt">
            <Input
              defaultValue={editing?.shortName ?? ""}
              name="shortName"
              placeholder="TVG"
            />
          </Field>
          <Field label="Mã công ty">
            <Input defaultValue={editing?.code ?? ""} name="code" placeholder="TVG" required />
          </Field>
          <Field label="Tên chi nhánh">
            <Input defaultValue={editing?.branchName ?? ""} name="branchName" />
          </Field>
          <Field label="Mã số thuế">
            <Input defaultValue={editing?.taxCode ?? ""} name="taxCode" />
          </Field>
          <Field label="ĐKKD">
            <Input
              defaultValue={editing?.businessRegistration ?? ""}
              name="businessRegistration"
            />
          </Field>
          <Field label="Người đại diện">
            <Input defaultValue={editing?.representative ?? ""} name="representative" />
          </Field>
          <Field label="Kích hoạt">
            <Select defaultValue={editing?.status ?? "ACTIVE"} name="status">
              <option value="ACTIVE">Kích hoạt</option>
              <option value="INACTIVE">Vô hiệu</option>
            </Select>
          </Field>
          <div className="md:col-span-2">
            <Field label="Địa chỉ mới">
              <Input defaultValue={editing?.address ?? ""} name="address" />
            </Field>
          </div>
        </div>

        <section className="rounded-xl border border-border bg-surface-muted p-4">
          <h3 className="text-base font-extrabold text-primary">Địa chỉ cũ</h3>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Field label="Văn phòng Gửi thư">
              <Select
                defaultValue={editing?.sendMailLocationKey ?? ""}
                name="sendMailLocationKey"
              >
                <option value="">Không liên kết</option>
                <option value="q12">Văn phòng Q12</option>
                <option value="thanh-cong">Văn phòng Thành Công</option>
              </Select>
            </Field>
            <Field label="Ưu tiên địa chỉ Gửi thư">
              <div className="grid grid-cols-2 rounded-lg border border-border bg-surface p-1">
                {[
                  ["new", "Mới"],
                  ["old", "Cũ"],
                ].map(([value, label]) => (
                  <button
                    className={`rounded-md px-3 py-2 text-sm font-bold transition ${
                      addressPriority === value
                        ? "bg-primary text-white shadow-sm"
                        : "text-muted hover:bg-surface-muted"
                    }`}
                    key={value}
                    onClick={() => setAddressPriority(value)}
                    type="button"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Tỉnh/Thành cũ">
              <Select
                name="oldProvinceId"
                  onChange={(event) => {
                    setProvinceId(event.target.value);
                    setWards([]);
                    setDistrictId("");
                    setWardId("");
                  }}
                value={provinceId}
              >
                <option value="">Chọn Tỉnh/Thành</option>
                {provinces.map((province) => (
                  <option key={province.id} value={province.id}>
                    {province.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Quận/Huyện cũ">
              <Select
                disabled={!provinceId}
                name="oldDistrictId"
                onChange={(event) => {
                  setDistrictId(event.target.value);
                  setWardId("");
                }}
                value={districtId}
              >
                <option value="">
                  {provinceId ? "Chọn Quận/Huyện" : "Chọn Tỉnh/Thành trước"}
                </option>
                {districts.map((district) => (
                  <option key={district.id} value={district.id}>
                    {district.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Phường/Xã cũ">
              <Select
                disabled={!districtId}
                name="oldWardId"
                onChange={(event) => setWardId(event.target.value)}
                value={wardId}
              >
                <option value="">
                  {districtId ? "Chọn Phường/Xã" : "Chọn Quận/Huyện trước"}
                </option>
                {visibleWards.map((ward) => (
                  <option key={ward.id} value={ward.id}>
                    {ward.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Số nhà, đường (địa chỉ cũ)">
              <Input defaultValue={editing?.oldAddress ?? ""} name="oldAddress" />
            </Field>
          </div>
        </section>

        <Message state={state} />
        <div className="flex flex-wrap gap-2">
          <LinkButton href="/cau-hinh" size="sm" variant="secondary">
            Làm mới
          </LinkButton>
          <Button disabled={pending} type="submit">
            {pending ? "Đang lưu..." : "Lưu cấu hình"}
          </Button>
        </div>
      </form>
    </>
  );
}

export type PersonnelIdentityEmployeeOption = {
  companyLabel: string;
  department: string | null;
  employeeCode: string;
  fullName: string;
  id: string;
};

export type EditingPersonnelIdentity = {
  employeeIds: string[];
  id: string;
  name: string;
  note: string | null;
  primaryEmployeeId: string;
};

export function PersonnelIdentityForm({
  editing,
  employees,
}: {
  editing?: EditingPersonnelIdentity | null;
  employees: PersonnelIdentityEmployeeOption[];
}) {
  const [state, action, pending] = useActionState<
    PersonnelIdentityActionState,
    FormData
  >(savePersonnelIdentityLinkAction, initialState);
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<string[]>(
    editing?.employeeIds ?? [],
  );
  const [primaryEmployeeId, setPrimaryEmployeeId] = useState(
    editing?.primaryEmployeeId ?? editing?.employeeIds[0] ?? "",
  );
  const formRef = useRef<HTMLFormElement>(null);
  const handledSuccessState = useRef<PersonnelIdentityActionState | null>(null);
  const router = useRouter();
  const { toast } = useToast();
  useActionToast(state, "Liên kết tài khoản nhân sự");

  useEffect(() => {
    if (!state.success || handledSuccessState.current === state) return;
    handledSuccessState.current = state;
    setSelectedEmployeeIds([]);
    setPrimaryEmployeeId("");
    formRef.current?.reset();
    if (editing?.id) {
      router.replace("/cau-hinh/dong-bo-nhan-su?view=identity");
    } else {
      router.refresh();
    }
  }, [editing?.id, router, state]);

  const options: MultiOption[] = employees.map((employee) => ({
    label: `${employee.fullName} · ${employee.employeeCode}`,
    sub: [employee.companyLabel, employee.department].filter(Boolean).join(" · "),
    value: employee.id,
  }));
  const selectedEmployees = selectedEmployeeIds
    .map((employeeId) =>
      employees.find((employee) => employee.id === employeeId),
    )
    .filter(
      (employee): employee is PersonnelIdentityEmployeeOption =>
        Boolean(employee),
    );

  return (
    <>
      <WriteLoadingOverlay message="Đang lưu liên kết tài khoản nhân sự..." show={pending} />
      <form
        action={action}
        className="space-y-4"
        key={editing?.id ?? "new"}
        ref={formRef}
        onSubmit={(event) => {
          if (selectedEmployeeIds.length < 2) {
            event.preventDefault();
            toast({
              message:
                "Hãy thêm ít nhất 2 MNV vào nhóm trước khi chọn tài khoản lấy chính.",
              title: "Chưa đủ tài khoản",
              tone: "warning",
            });
            return;
          }
          if (!selectedEmployeeIds.includes(primaryEmployeeId)) {
            event.preventDefault();
            toast({
              message:
                "Tài khoản lấy chính phải nằm trong nhóm MNV đã liên kết.",
              title: "Chưa chọn tài khoản lấy chính",
              tone: "warning",
            });
          }
        }}
      >
        <input name="editId" type="hidden" value={editing?.id ?? ""} />
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Tên liên kết">
            <Input
              defaultValue={editing?.name ?? ""}
              name="name"
              placeholder="Ví dụ: Nguyễn Văn A · TVG + TVD"
              required
            />
          </Field>
          <Field label="Tài khoản lấy chính">
            <Select
              disabled={!selectedEmployees.length}
              name="primaryEmployeeId"
              onChange={(event) => setPrimaryEmployeeId(event.target.value)}
              required
              value={primaryEmployeeId}
            >
              <option value="">
                {selectedEmployees.length
                  ? "Chọn tài khoản lấy chính"
                  : "Thêm tài khoản vào nhóm trước"}
              </option>
              {selectedEmployees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.fullName} · {employee.employeeCode} ·{" "}
                  {employee.companyLabel || "Chưa gắn pháp nhân"}
                </option>
              ))}
            </Select>
            <span className="block text-xs font-normal leading-5 text-muted">
              Pháp nhân và MNV của tài khoản này sẽ được dùng làm dữ liệu chính.
            </span>
          </Field>
          <div className="md:col-span-2">
            <Field label="Thêm tài khoản">
              <MultiSelect
                name="employeeIds"
                onValuesChange={(nextEmployeeIds) => {
                  setSelectedEmployeeIds(nextEmployeeIds);
                  setPrimaryEmployeeId((currentPrimaryEmployeeId) =>
                    nextEmployeeIds.includes(currentPrimaryEmployeeId)
                      ? currentPrimaryEmployeeId
                      : (nextEmployeeIds[0] ?? ""),
                  );
                }}
                options={options}
                placeholder="Gõ tên hoặc MNV để thêm..."
                values={selectedEmployeeIds}
              />
            </Field>
          </div>
          <div className="md:col-span-2">
            <Field label="Ghi chú">
              <Input defaultValue={editing?.note ?? ""} name="note" />
            </Field>
          </div>
        </div>
        <Message state={state} />
        <div className="flex flex-wrap gap-2">
          <LinkButton
            href="/cau-hinh/dong-bo-nhan-su?view=identity"
            size="sm"
            variant="secondary"
          >
            Làm mới
          </LinkButton>
          <Button disabled={pending} type="submit">
            {pending ? "Đang lưu..." : "Lưu liên kết"}
          </Button>
        </div>
      </form>
    </>
  );
}

export function PersonnelIdentityDeleteButton({
  linkId,
  linkName,
}: {
  linkId: string;
  linkName: string;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const { toast } = useToast();

  return (
    <Button
      disabled={pending}
      onClick={() => {
        if (!window.confirm(`Xóa liên kết “${linkName}”?`)) return;
        startTransition(async () => {
          try {
            await deletePersonnelIdentityLinkAction(linkId);
            router.refresh();
            toast({
              message: "Đã xóa liên kết nhân sự.",
              title: "Đã hoàn tất",
              tone: "success",
            });
          } catch (error) {
            toast({
              message:
                error instanceof Error ? error.message : "Không xóa được liên kết.",
              title: "Không thể hoàn tất",
              tone: "error",
            });
          }
        });
      }}
      size="sm"
      type="button"
      variant="danger"
    >
      {pending ? "Đang xóa..." : "Xóa"}
    </Button>
  );
}

export function EmployeeForm({ companies }: { companies: CompanyOption[] }) {
  const [state, action, pending] = useActionState(
    createEmployeeAction,
    initialState,
  );
  useActionToast(state, "Cấu hình nhân sự");

  return (
    <>
      <WriteLoadingOverlay message="Đang lưu nhân sự..." show={pending} />
      <form action={action} className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
        <Field label="Mã nhân viên">
          <Input name="employeeCode" placeholder="NV001" required />
        </Field>
        <Field label="Họ tên">
          <Input name="fullName" required />
        </Field>
        <Field label="Email">
          <Input name="email" type="email" />
        </Field>
        <Field label="Số điện thoại">
          <Input name="phone" />
        </Field>
        <Field label="Phòng ban">
          <Input name="department" />
        </Field>
        <Field label="Chức vụ">
          <Input name="title" />
        </Field>
        <Field label="Công ty">
          <Select name="companyId">
            <option value="">Chưa gắn</option>
            {companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.code} - {company.shortName || company.legalName}
              </option>
            ))}
          </Select>
        </Field>
        </div>
        <Message state={state} />
        <Button disabled={pending} type="submit">
          {pending ? "Đang lưu..." : "Thêm nhân viên"}
        </Button>
      </form>
    </>
  );
}

export function UserForm({
  employees,
  roles,
}: {
  employees: EmployeeOption[];
  roles: RoleOption[];
}) {
  const [state, action, pending] = useActionState(
    createUserAction,
    initialState,
  );
  useActionToast(state, "Cấu hình tài khoản");

  return (
    <>
      <WriteLoadingOverlay message="Đang tạo tài khoản..." show={pending} />
      <form action={action} className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
        <Field label="Tên đăng nhập">
          <Input autoComplete="username" name="username" required />
        </Field>
        <Field label="Email">
          <Input autoComplete="email" name="email" required type="email" />
        </Field>
        <Field label="Tên hiển thị">
          <Input name="displayName" required />
        </Field>
        <Field label="Mật khẩu tạm">
          <Input
            autoComplete="new-password"
            minLength={8}
            name="password"
            required
            type="password"
          />
        </Field>
        <Field label="Nhân viên liên kết">
          <Select name="employeeId">
            <option value="">Không liên kết</option>
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.employeeCode} - {employee.fullName}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Vai trò">
          <Select name="roleId" required>
            <option value="">Chọn vai trò</option>
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name} ({role.key})
              </option>
            ))}
          </Select>
        </Field>
        </div>
        <Message state={state} />
        <Button disabled={pending} type="submit">
          {pending ? "Đang tạo..." : "Tạo tài khoản"}
        </Button>
      </form>
    </>
  );
}
