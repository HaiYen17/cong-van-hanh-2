"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { WriteLoadingOverlay, useToast } from "@/components/ui/toast";

import { performPermissionMutation } from "./actions";
import type {
  PermissionAction,
  PermissionActionMap,
  PermissionAssignment,
  PermissionConsoleData,
  PermissionEmployee,
  PermissionMutation,
  PermissionRole,
} from "./types";

type TabKey = "assign" | "roles";
type AssignmentMode = "create" | "edit" | "password";

type Confirmation = {
  buildMutation: (actorPassword: string) => PermissionMutation;
  buttonLabel: string;
  loadingLabel: string;
  onSuccess: () => void;
  title: string;
};

type RoleDraft = {
  actionMap: PermissionActionMap;
  description: string;
  groupKeys: string[];
  includeDefaultEmployeeAccess: boolean;
  isActive: boolean;
  isCore: boolean;
  key: string;
  name: string;
  originalKey: string;
  rank: string;
};

const EMPTY_ROLE: RoleDraft = {
  actionMap: {},
  description: "",
  groupKeys: [],
  includeDefaultEmployeeAccess: true,
  isActive: true,
  isCore: false,
  key: "",
  name: "",
  originalKey: "",
  rank: "50",
};

const ACTIONS: Array<{ key: PermissionAction; label: string }> = [
  { key: "view", label: "Xem" },
  { key: "edit", label: "Sửa" },
  { key: "delete", label: "Xóa" },
];

function normalizeSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function employeeDisplay(employee: PermissionEmployee) {
  return employee.title
    ? `${employee.fullName} - ${employee.title}`
    : employee.fullName;
}

function formatActivationRequestTime(value: string | null) {
  if (!value) return "Chưa ghi nhận thời gian";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Chưa ghi nhận thời gian";
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function Toggle({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="permission-switch" aria-label={label}>
      <input
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      <span className="permission-switch-slider" />
    </label>
  );
}

export function PermissionConsole({ data }: { data: PermissionConsoleData }) {
  const router = useRouter();
  const { toast } = useToast();
  const [tab, setTab] = useState<TabKey>("assign");
  const [pending, startTransition] = useTransition();
  const [loadingLabel, setLoadingLabel] = useState("Đang xử lý phân quyền...");

  const [assignmentMode, setAssignmentMode] =
    useState<AssignmentMode>("create");
  const [assignmentQuery, setAssignmentQuery] = useState("");
  const [editingAssignment, setEditingAssignment] =
    useState<PermissionAssignment | null>(null);
  const [selectedEmployee, setSelectedEmployee] =
    useState<PermissionEmployee | null>(null);
  const [employeeQuery, setEmployeeQuery] = useState("");
  const [employeeOpen, setEmployeeOpen] = useState(false);
  const [employeeActiveIndex, setEmployeeActiveIndex] = useState(0);
  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [roleDraft, setRoleDraft] = useState<RoleDraft>(EMPTY_ROLE);
  const [roleQuery, setRoleQuery] = useState("");
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [actorPassword, setActorPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const assignmentEditorRef = useRef<HTMLElement>(null);

  const filteredAssignments = useMemo(() => {
    const query = normalizeSearch(assignmentQuery.trim());
    if (!query) return data.assignments;
    return data.assignments.filter((record) =>
      normalizeSearch(
        `${record.employeeDisplayName} ${record.employeeCode} ${record.roleLabel} ${record.activationStatusLabel} ${record.accessibleGroupLabels.join(" ")}`,
      ).includes(query),
    );
  }, [assignmentQuery, data.assignments]);
  const pendingActivations = useMemo(
    () =>
      data.assignments
        .filter((record) => record.activationStatus === "PENDING")
        .sort((left, right) =>
          String(right.activationRequestedAt).localeCompare(
            String(left.activationRequestedAt),
          ),
        ),
    [data.assignments],
  );
  const selectedRolePreview = useMemo(
    () => data.roles.find((role) => role.id === selectedRoleId) ?? null,
    [data.roles, selectedRoleId],
  );
  const filteredRoles = useMemo(() => {
    const query = normalizeSearch(roleQuery.trim());
    if (!query) return data.roles;
    return data.roles.filter((role) =>
      normalizeSearch(
        `${role.name} ${role.key} ${role.description} ${role.status} ${role.accessibleGroupLabels.join(" ")} ${role.accessibleModuleKeys.join(" ")}`,
      ).includes(query),
    );
  }, [data.roles, roleQuery]);
  const filteredEmployees = useMemo(() => {
    const query = normalizeSearch(employeeQuery.trim());
    const list = query
      ? data.employees.filter((employee) =>
          normalizeSearch(
            `${employee.fullName} ${employee.title} ${employee.department} ${employee.employeeCode}`,
          ).includes(query),
        )
      : data.employees;
    return list.slice(0, 8);
  }, [data.employees, employeeQuery]);
  const permissionScopes = useMemo(
    () =>
      data.groups
        .map((group) => ({
          group,
          modules: data.modules.filter(
            (appModule) => appModule.groupKey === group.key,
          ),
        }))
        .filter(({ modules }) => modules.length > 0),
    [data.groups, data.modules],
  );

  function resetAssignmentForm() {
    setAssignmentMode("create");
    setEditingAssignment(null);
    setSelectedEmployee(null);
    setEmployeeQuery("");
    setEmployeeOpen(false);
    setEmployeeActiveIndex(0);
    setSelectedRoleId("");
    setNewPassword("");
    setConfirmPassword("");
  }

  function selectEmployee(employee: PermissionEmployee) {
    setSelectedEmployee(employee);
    setEmployeeQuery("");
    setEmployeeOpen(false);
    setEmployeeActiveIndex(0);
  }

  function revealAssignmentEditor(focusId: string) {
    // Ở màn hình hẹp form nằm dưới danh sách dài. Cuộn về đầu trang khiến
    // người dùng tưởng nút Chỉnh sửa/Cài mật khẩu không hoạt động, nên đưa
    // đúng editor vào viewport sau khi React render mode mới.
    window.requestAnimationFrame(() => {
      if (window.matchMedia("(max-width: 980px)").matches) {
        assignmentEditorRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }
      window.requestAnimationFrame(() => {
        document.getElementById(focusId)?.focus({ preventScroll: true });
      });
    });
  }

  function startAssignmentEdit(record: PermissionAssignment) {
    const employee =
      data.employees.find((item) => item.id === record.employeeId) ?? null;
    setAssignmentMode("edit");
    setEditingAssignment(record);
    setSelectedEmployee(employee);
    setEmployeeQuery("");
    setSelectedRoleId(record.roleId);
    setNewPassword("");
    setConfirmPassword("");
    revealAssignmentEditor("permission-role");
  }

  function startPasswordEdit(record: PermissionAssignment) {
    const employee =
      data.employees.find((item) => item.id === record.employeeId) ?? null;
    setAssignmentMode("password");
    setEditingAssignment(record);
    setSelectedEmployee(employee);
    setEmployeeQuery("");
    setSelectedRoleId(record.roleId);
    setNewPassword("");
    setConfirmPassword("");
    revealAssignmentEditor("permission-new-password");
  }

  function openConfirmation(next: Confirmation) {
    setActorPassword("");
    setAuthError("");
    setConfirmation(() => next);
  }

  function submitAssignment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedEmployee || !selectedRoleId) {
      toast({
        message: "Vui lòng chọn nhân sự và quyền được phân.",
        title: "Chưa đủ thông tin",
        tone: "warning",
      });
      return;
    }

    if (assignmentMode === "password") {
      if (!editingAssignment) {
        return;
      }
      if (!newPassword || !confirmPassword) {
        toast({
          message: "Vui lòng nhập đủ mật khẩu mới và phần xác nhận.",
          title: "Chưa đủ thông tin",
          tone: "warning",
        });
        return;
      }
      openConfirmation({
        buildMutation: (password) => ({
          actorPassword: password,
          confirmPassword,
          newPassword,
          type: "password-save",
          userId: editingAssignment.userId,
        }),
        buttonLabel: "Xác nhận",
        loadingLabel: "Đang đổi mật khẩu...",
        onSuccess: resetAssignmentForm,
        title: "Xác nhận đổi mật khẩu",
      });
      return;
    }

    openConfirmation({
      buildMutation: (password) => ({
        actorPassword: password,
        employeeId: selectedEmployee.id,
        requiresPassword: true,
        roleId: selectedRoleId,
        type: "assignment-save",
      }),
      buttonLabel: "Xác nhận",
      loadingLabel:
        assignmentMode === "edit"
          ? "Đang cập nhật phân quyền..."
          : "Đang lưu phân quyền...",
      onSuccess: resetAssignmentForm,
      title:
        assignmentMode === "edit"
          ? "Xác nhận cập nhật phân quyền"
          : "Xác nhận lưu phân quyền",
    });
  }

  function requestAssignmentDelete(record: PermissionAssignment) {
    openConfirmation({
      buildMutation: (password) => ({
        actorPassword: password,
        type: "assignment-delete",
        userId: record.userId,
      }),
      buttonLabel: "Xác nhận xóa",
      loadingLabel: "Đang xóa phân quyền...",
      onSuccess: () => {
        if (editingAssignment?.userId === record.userId) {
          resetAssignmentForm();
        }
      },
      title: "Xác nhận xóa phân quyền",
    });
  }

  function requestActivationReview(
    record: PermissionAssignment,
    decision: "approve" | "reject",
  ) {
    const approved = decision === "approve";
    openConfirmation({
      buildMutation: (password) => ({
        actorPassword: password,
        decision,
        type: "activation-review",
        userId: record.userId,
      }),
      buttonLabel: approved ? "Xác nhận kích hoạt" : "Xác nhận từ chối",
      loadingLabel: approved
        ? "Đang kích hoạt tài khoản..."
        : "Đang từ chối yêu cầu...",
      onSuccess: () => undefined,
      title: approved
        ? `Kích hoạt tài khoản ${record.employeeDisplayName}`
        : `Từ chối yêu cầu của ${record.employeeDisplayName}`,
    });
  }

  function resetRoleForm() {
    setRoleDraft({ ...EMPTY_ROLE, actionMap: {}, groupKeys: [] });
  }

  function startRoleEdit(role: PermissionRole) {
    if (!role.isEditable) {
      return;
    }
    setRoleDraft({
      actionMap: Object.fromEntries(
        Object.entries(role.moduleActionMap).map(([key, actions]) => [
          key,
          [...actions],
        ]),
      ),
      description: role.description,
      groupKeys: [...role.accessibleGroupKeys],
      includeDefaultEmployeeAccess: role.includeDefaultEmployeeAccess,
      isActive: role.isActive,
      isCore: role.isCore,
      key: role.key,
      name: role.name,
      originalKey: role.key,
      rank: String(role.rank),
    });
    setTab("roles");
    window.scrollTo({ behavior: "smooth", top: 0 });
  }

  function toggleRoleGroup(groupKey: string, checked: boolean) {
    const moduleKeys = data.modules
      .filter((appModule) => appModule.groupKey === groupKey)
      .map((appModule) => appModule.key);
    setRoleDraft((current) => {
      const nextMap = { ...current.actionMap };
      for (const moduleKey of moduleKeys) {
        if (checked) nextMap[moduleKey] = ["view", "edit", "delete"];
        else delete nextMap[moduleKey];
      }
      return {
        ...current,
        actionMap: nextMap,
        groupKeys: checked
          ? [...new Set([...current.groupKeys, groupKey])]
          : current.groupKeys.filter((key) => key !== groupKey),
      };
    });
  }

  function toggleModuleEnabled(
    moduleKey: string,
    groupKey: string,
    checked: boolean,
  ) {
    setRoleDraft((current) => {
      const nextMap = { ...current.actionMap };
      if (checked) nextMap[moduleKey] = ["view", "edit", "delete"];
      else delete nextMap[moduleKey];
      const groupModuleKeys = data.modules
        .filter((appModule) => appModule.groupKey === groupKey)
        .map((appModule) => appModule.key);
      const wholeGroupEnabled = groupModuleKeys.every((key) =>
        (nextMap[key] ?? []).includes("view"),
      );
      return {
        ...current,
        actionMap: nextMap,
        groupKeys: wholeGroupEnabled
          ? [...new Set([...current.groupKeys, groupKey])]
          : current.groupKeys.filter((key) => key !== groupKey),
      };
    });
  }

  function toggleModuleAction(
    moduleKey: string,
    action: PermissionAction,
    checked: boolean,
  ) {
    setRoleDraft((current) => {
      const currentActions = new Set(current.actionMap[moduleKey] ?? []);
      if (checked) {
        currentActions.add(action);
        if (action === "edit" || action === "delete") {
          currentActions.add("view");
        }
      } else {
        currentActions.delete(action);
        if (
          action === "view" &&
          (currentActions.has("edit") || currentActions.has("delete"))
        ) {
          currentActions.add("view");
        }
      }
      const nextMap = { ...current.actionMap };
      if (currentActions.size) {
        nextMap[moduleKey] = ACTIONS.map(({ key }) => key).filter((key) =>
          currentActions.has(key),
        );
      } else {
        delete nextMap[moduleKey];
      }
      const groupKey = data.modules.find(
        (appModule) => appModule.key === moduleKey,
      )?.groupKey;
      const groupModuleKeys = groupKey
        ? data.modules
            .filter((appModule) => appModule.groupKey === groupKey)
            .map((appModule) => appModule.key)
        : [];
      const wholeGroupEnabled =
        Boolean(groupKey) &&
        groupModuleKeys.every((key) => (nextMap[key] ?? []).includes("view"));
      return {
        ...current,
        actionMap: nextMap,
        groupKeys: !groupKey
          ? current.groupKeys
          : wholeGroupEnabled
            ? [...new Set([...current.groupKeys, groupKey])]
            : current.groupKeys.filter((key) => key !== groupKey),
      };
    });
  }

  function submitRole(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!roleDraft.name.trim()) {
      toast({
        message: "Vui lòng nhập tên quyền.",
        title: "Chưa đủ thông tin",
        tone: "warning",
      });
      return;
    }
    if (
      !roleDraft.includeDefaultEmployeeAccess &&
      roleDraft.groupKeys.length === 0 &&
      Object.keys(roleDraft.actionMap).length === 0
    ) {
      toast({
        message: "Vui lòng chọn ít nhất một nhóm hoặc module cho quyền này.",
        title: "Chưa chọn phạm vi",
        tone: "warning",
      });
      return;
    }

    openConfirmation({
      buildMutation: (password) => ({
        actorPassword: password,
        description: roleDraft.description,
        groupKeys: roleDraft.groupKeys,
        includeDefaultEmployeeAccess:
          roleDraft.key === "employee"
            ? true
            : roleDraft.includeDefaultEmployeeAccess,
        isActive: roleDraft.isCore ? true : roleDraft.isActive,
        moduleActionMap: roleDraft.actionMap,
        name: roleDraft.name,
        originalKey: roleDraft.originalKey,
        rank: Number(roleDraft.rank) || 50,
        roleKey: roleDraft.key,
        type: "role-save",
      }),
      buttonLabel: "Xác nhận",
      loadingLabel: roleDraft.originalKey
        ? "Đang cập nhật quyền..."
        : "Đang tạo quyền...",
      onSuccess: resetRoleForm,
      title: roleDraft.originalKey
        ? "Xác nhận cập nhật quyền"
        : "Xác nhận tạo quyền",
    });
  }

  function requestRoleDelete(role: PermissionRole) {
    openConfirmation({
      buildMutation: (password) => ({
        actorPassword: password,
        roleKey: role.key,
        type: "role-delete",
      }),
      buttonLabel: "Xác nhận xóa",
      loadingLabel: "Đang xóa quyền...",
      onSuccess: () => {
        if (roleDraft.originalKey === role.key) {
          resetRoleForm();
        }
      },
      title: "Xác nhận xóa quyền",
    });
  }

  function submitConfirmation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!confirmation || !actorPassword) {
      setAuthError("Vui lòng nhập mật khẩu Super Admin.");
      return;
    }

    setAuthError("");
    setLoadingLabel(confirmation.loadingLabel);
    startTransition(async () => {
      const result = await performPermissionMutation(
        confirmation.buildMutation(actorPassword),
      );
      if (result.error) {
        setAuthError(result.error);
        toast({
          message: result.error,
          title: "Không thể thực hiện",
          tone: "error",
        });
        return;
      }

      confirmation.onSuccess();
      setConfirmation(null);
      setActorPassword("");
      toast({
        message: result.success,
        title: "Phân quyền",
        tone: "success",
      });
      router.refresh();
    });
  }

  const formTitle =
    assignmentMode === "password"
      ? "Đổi mật khẩu"
      : assignmentMode === "edit"
        ? "Chỉnh sửa phân quyền"
        : "Tạo phân quyền";

  return (
    <>
      <section className="permission-console" aria-label="Phân quyền">
        <header className="permission-console-header permission-console-header--actions">
          <Link
            aria-label="Đóng trang phân quyền"
            className="permission-close-button"
            href="/"
          >
            ×
          </Link>
        </header>

        <div className="permission-tabs" role="tablist">
          <button
            aria-selected={tab === "assign"}
            className={tab === "assign" ? "is-active" : ""}
            onClick={() => setTab("assign")}
            role="tab"
            type="button"
          >
            Gán quyền
          </button>
          <button
            aria-selected={tab === "roles"}
            className={tab === "roles" ? "is-active" : ""}
            onClick={() => setTab("roles")}
            role="tab"
            type="button"
          >
            Thiết lập quyền
          </button>
        </div>

        {tab === "assign" ? (
          <div className="permission-assignment-workspace">
            <section className="permission-panel permission-activation-panel">
              <div className="permission-panel-head">
                <div>
                  <h2>Yêu cầu kích hoạt tài khoản</h2>
                  <p className="permission-activation-note">
                    Xác minh đúng nhân sự trước khi cho phép tạo mật khẩu lần đầu.
                  </p>
                </div>
                <span className="permission-activation-count">
                  {pendingActivations.length} chờ duyệt
                </span>
              </div>

              {pendingActivations.length ? (
                <>
                  <div className="permission-table-wrap">
                    <table className="permission-table permission-activation-table">
                      <thead>
                        <tr>
                          <th>Nhân sự</th>
                          <th>Quyền hiện tại</th>
                          <th>Thời gian yêu cầu</th>
                          <th>Thao tác</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pendingActivations.map((record) => (
                          <tr key={record.userId}>
                            <td>
                              <strong>{record.employeeDisplayName}</strong>
                              <small>{record.employeeCode}</small>
                            </td>
                            <td>
                              <strong>{record.roleLabel}</strong>
                            </td>
                            <td>
                              <strong>
                                {formatActivationRequestTime(
                                  record.activationRequestedAt,
                                )}
                              </strong>
                            </td>
                            <td>
                              <div className="permission-actions">
                                <button
                                  className="permission-button permission-button--primary"
                                  onClick={() =>
                                    requestActivationReview(record, "approve")
                                  }
                                  type="button"
                                >
                                  Kích hoạt
                                </button>
                                <button
                                  className="permission-button permission-button--danger"
                                  onClick={() =>
                                    requestActivationReview(record, "reject")
                                  }
                                  type="button"
                                >
                                  Từ chối
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="permission-cards permission-activation-cards">
                    {pendingActivations.map((record) => (
                      <article className="permission-card" key={record.userId}>
                        <div>
                          <span>Nhân sự</span>
                          <strong>{record.employeeDisplayName}</strong>
                        </div>
                        <div>
                          <span>Mã nhân viên</span>
                          <strong>{record.employeeCode}</strong>
                        </div>
                        <div>
                          <span>Yêu cầu lúc</span>
                          <strong>
                            {formatActivationRequestTime(
                              record.activationRequestedAt,
                            )}
                          </strong>
                        </div>
                        <div className="permission-actions">
                          <button
                            className="permission-button permission-button--primary"
                            onClick={() =>
                              requestActivationReview(record, "approve")
                            }
                            type="button"
                          >
                            Kích hoạt
                          </button>
                          <button
                            className="permission-button permission-button--danger"
                            onClick={() =>
                              requestActivationReview(record, "reject")
                            }
                            type="button"
                          >
                            Từ chối
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                </>
              ) : (
                <p className="permission-empty-card">
                  Hiện chưa có yêu cầu kích hoạt nào đang chờ xử lý.
                </p>
              )}
            </section>

            <div className="permission-assign-layout">
            <section className="permission-panel permission-records-panel">
              <div className="permission-panel-head">
                <h2>Danh sách phân quyền</h2>
                <p>
                  {filteredAssignments.length}/{data.assignments.length} nhân sự
                </p>
              </div>

              <div className="permission-assignment-toolbar">
                <label htmlFor="permission-assignment-search">
                  Tìm người hoặc quyền đang gán
                </label>
                <div>
                  <span aria-hidden="true">⌕</span>
                  <input
                    id="permission-assignment-search"
                    onChange={(event) => setAssignmentQuery(event.target.value)}
                    placeholder="Nhập tên, mã nhân viên hoặc tên quyền..."
                    type="search"
                    value={assignmentQuery}
                  />
                </div>
              </div>

              <div className="permission-table-wrap">
                <table className="permission-table">
                  <thead>
                    <tr>
                      <th>Nhân sự</th>
                      <th>Quyền được phân</th>
                      <th>Kích hoạt</th>
                      <th>Mật khẩu</th>
                      <th>Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAssignments.length ? (
                      filteredAssignments.map((record) => (
                        <tr key={record.userId}>
                          <td>
                            <strong>{record.employeeDisplayName}</strong>
                            <small>{record.employeeCode}</small>
                          </td>
                          <td>
                            <strong>{record.roleLabel}</strong>
                            <small>
                              {record.accessibleGroupLabels.join(" • ") ||
                                "Chưa mở nhóm module"}
                            </small>
                          </td>
                          <td>
                            <span
                              className={`permission-password-chip permission-activation-chip is-${record.activationStatus.toLowerCase()}`}
                            >
                              {record.activationStatusLabel}
                            </span>
                            {record.activationRequestedAt ? (
                              <small>
                                {formatActivationRequestTime(
                                  record.activationRequestedAt,
                                )}
                              </small>
                            ) : null}
                          </td>
                          <td>
                            <span
                              className={`permission-password-chip ${
                                record.requiresPassword ? "is-on" : ""
                              }`}
                            >
                              {record.passwordStatusLabel}
                            </span>
                          </td>
                          <td>
                            <div className="permission-actions">
                              {record.requiresPassword ? (
                                <button
                                  aria-label={`Cài đặt mật khẩu cho ${record.employeeDisplayName}`}
                                  className="permission-gear-button"
                                  onClick={() => startPasswordEdit(record)}
                                  title="Cài đặt mật khẩu"
                                  type="button"
                                >
                                  ⚙
                                </button>
                              ) : null}
                              <button
                                className="permission-button permission-button--secondary"
                                onClick={() => startAssignmentEdit(record)}
                                type="button"
                              >
                                Chỉnh sửa
                              </button>
                              <button
                                className="permission-button permission-button--danger"
                                onClick={() => requestAssignmentDelete(record)}
                                type="button"
                              >
                                Xóa
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td className="permission-empty" colSpan={5}>
                          Chưa có nhân sự nào được phân quyền.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="permission-cards">
                {filteredAssignments.length ? (
                  filteredAssignments.map((record) => (
                    <article className="permission-card" key={record.userId}>
                      <div>
                        <span>Nhân sự</span>
                        <strong>{record.employeeDisplayName}</strong>
                      </div>
                      <div>
                        <span>Quyền</span>
                        <strong>{record.roleLabel}</strong>
                      </div>
                      <div>
                        <span>Danh mục thấy được</span>
                        <strong>
                          {record.accessibleGroupLabels.join(" • ") ||
                            "Chưa mở nhóm module"}
                        </strong>
                      </div>
                      <div>
                        <span>Kích hoạt</span>
                        <strong>{record.activationStatusLabel}</strong>
                      </div>
                      <div>
                        <span>Mật khẩu</span>
                        <strong>{record.passwordStatusLabel}</strong>
                      </div>
                      <div className="permission-actions">
                        {record.requiresPassword ? (
                          <button
                            aria-label={`Cài đặt mật khẩu cho ${record.employeeDisplayName}`}
                            title="Cài đặt mật khẩu"
                            className="permission-gear-button"
                            onClick={() => startPasswordEdit(record)}
                            type="button"
                          >
                            ⚙
                          </button>
                        ) : null}
                        <button
                          className="permission-button permission-button--secondary"
                          onClick={() => startAssignmentEdit(record)}
                          type="button"
                        >
                          Chỉnh sửa
                        </button>
                        <button
                          className="permission-button permission-button--danger"
                          onClick={() => requestAssignmentDelete(record)}
                          type="button"
                        >
                          Xóa
                        </button>
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="permission-empty-card">
                    Chưa có nhân sự nào được phân quyền.
                  </div>
                )}
              </div>
            </section>

            <section
              className="permission-panel permission-form-panel"
              ref={assignmentEditorRef}
            >
              <div className="permission-panel-head">
                <h2>{formTitle}</h2>
                <button
                  className="permission-reset-button"
                  onClick={resetAssignmentForm}
                  type="button"
                >
                  Làm mới form
                </button>
              </div>

              <form className="permission-form" onSubmit={submitAssignment}>
                <div className="permission-field">
                  <label htmlFor="permission-employee">Nhân sự</label>
                  <div
                    className={`permission-combobox ${
                      employeeOpen ? "is-open" : ""
                    }`}
                  >
                    <input
                      aria-autocomplete="list"
                      aria-controls="permission-employee-list"
                      aria-expanded={employeeOpen}
                      autoComplete="off"
                      disabled={assignmentMode !== "create"}
                      id="permission-employee"
                      onChange={(event) => {
                        setSelectedEmployee(null);
                        setEmployeeQuery(event.target.value);
                        setEmployeeOpen(true);
                        setEmployeeActiveIndex(0);
                      }}
                      onFocus={() => {
                        if (assignmentMode === "create") {
                          setEmployeeOpen(true);
                        }
                      }}
                      onKeyDown={(event) => {
                        if (!employeeOpen) {
                          return;
                        }
                        if (event.key === "ArrowDown") {
                          event.preventDefault();
                          setEmployeeActiveIndex((current) =>
                            Math.min(current + 1, filteredEmployees.length - 1),
                          );
                        } else if (event.key === "ArrowUp") {
                          event.preventDefault();
                          setEmployeeActiveIndex((current) =>
                            Math.max(0, current - 1),
                          );
                        } else if (
                          event.key === "Enter" &&
                          filteredEmployees[employeeActiveIndex]
                        ) {
                          event.preventDefault();
                          selectEmployee(
                            filteredEmployees[employeeActiveIndex],
                          );
                        } else if (event.key === "Escape") {
                          setEmployeeOpen(false);
                        }
                      }}
                      placeholder="Gõ để tìm tên nhân sự - chức vụ"
                      role="combobox"
                      value={
                        selectedEmployee
                          ? employeeDisplay(selectedEmployee)
                          : employeeQuery
                      }
                    />
                    <button
                      aria-label="Mở danh sách nhân sự"
                      disabled={assignmentMode !== "create"}
                      onClick={() => setEmployeeOpen((current) => !current)}
                      type="button"
                    >
                      ▾
                    </button>
                    {employeeOpen && assignmentMode === "create" ? (
                      <div
                        className="permission-combobox-menu"
                        id="permission-employee-list"
                        role="listbox"
                      >
                        {filteredEmployees.length ? (
                          filteredEmployees.map((employee, index) => (
                            <button
                              aria-selected={index === employeeActiveIndex}
                              className={
                                index === employeeActiveIndex ? "is-active" : ""
                              }
                              key={employee.id}
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => selectEmployee(employee)}
                              role="option"
                              type="button"
                            >
                              <strong>{employeeDisplay(employee)}</strong>
                              <small>
                                {employee.employeeCode}
                                {employee.department
                                  ? ` • ${employee.department}`
                                  : ""}
                              </small>
                            </button>
                          ))
                        ) : (
                          <p>Không tìm thấy nhân sự phù hợp.</p>
                        )}
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="permission-field">
                  <label htmlFor="permission-role">Quyền được phân</label>
                  <select
                    disabled={assignmentMode === "password"}
                    id="permission-role"
                    onChange={(event) => {
                      setSelectedRoleId(event.target.value);
                    }}
                    value={selectedRoleId}
                  >
                    <option value="">Chọn quyền</option>
                    {data.roleOptions.map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.name}
                      </option>
                    ))}
                  </select>
                </div>

                {selectedRolePreview ? (
                  <section className="permission-selected-role">
                    <div className="permission-selected-role-head">
                      <div>
                        <span>Quyền hiện tại</span>
                        <strong>{selectedRolePreview.name}</strong>
                      </div>
                      <b>
                        {selectedRolePreview.accessibleModuleKeys.length} module
                      </b>
                    </div>
                    <p>
                      {selectedRolePreview.description ||
                        "Quyền truy cập đã được thiết lập cho vai trò này."}
                    </p>
                    <div className="permission-role-chips">
                      {selectedRolePreview.accessibleGroupLabels.map(
                        (label) => (
                          <span key={label}>{label}</span>
                        ),
                      )}
                    </div>
                    <div className="permission-selected-role-actions">
                      {ACTIONS.map((action) => (
                        <span key={action.key}>
                          <b>
                            {
                              Object.values(
                                selectedRolePreview.moduleActionMap,
                              ).filter((actions) =>
                                actions.includes(action.key),
                              ).length
                            }
                          </b>
                          {action.label}
                        </span>
                      ))}
                    </div>
                  </section>
                ) : null}

                <div className="permission-switch-row">
                  <div>
                    <strong>Mật khẩu</strong>
                    <p>
                      Tài khoản chưa có mật khẩu luôn phải được Admin kích hoạt
                      trước, sau đó nhân sự mới được tạo mật khẩu lần đầu.
                    </p>
                  </div>
                  <Toggle
                    checked
                    disabled
                    label="Mọi tài khoản đều bắt buộc dùng mật khẩu"
                    onChange={() => undefined}
                  />
                </div>

                {assignmentMode === "password" ? (
                  <>
                    <div className="permission-field">
                      <label htmlFor="permission-new-password">
                        Mật khẩu mới
                      </label>
                      <input
                        autoComplete="new-password"
                        id="permission-new-password"
                        onChange={(event) => setNewPassword(event.target.value)}
                        placeholder="Tạo mật khẩu mới cho nhân sự này"
                        type="password"
                        value={newPassword}
                      />
                    </div>
                    <div className="permission-field">
                      <label htmlFor="permission-confirm-password">
                        Nhập lại mật khẩu mới
                      </label>
                      <input
                        autoComplete="new-password"
                        id="permission-confirm-password"
                        onChange={(event) =>
                          setConfirmPassword(event.target.value)
                        }
                        placeholder="Nhập lại mật khẩu mới"
                        type="password"
                        value={confirmPassword}
                      />
                    </div>
                  </>
                ) : null}

                <div className="permission-form-actions">
                  <button
                    className="permission-button permission-button--primary"
                    type="submit"
                  >
                    {assignmentMode === "password"
                      ? "Lưu mật khẩu"
                      : "Lưu phân quyền"}
                  </button>
                </div>
              </form>
            </section>
            </div>
          </div>
        ) : (
          <div className="permission-role-layout">
            <section className="permission-panel permission-role-form-panel">
              <div className="permission-panel-head">
                <h2>
                  {roleDraft.originalKey ? "Chỉnh sửa quyền" : "Tạo quyền mới"}
                </h2>
                <button
                  className="permission-reset-button"
                  onClick={resetRoleForm}
                  type="button"
                >
                  Làm mới form
                </button>
              </div>

              <form className="permission-role-form" onSubmit={submitRole}>
                <div className="permission-role-grid">
                  <div className="permission-field">
                    <label htmlFor="permission-role-name">Tên quyền</label>
                    <input
                      id="permission-role-name"
                      onChange={(event) =>
                        setRoleDraft((current) => ({
                          ...current,
                          name: event.target.value,
                        }))
                      }
                      placeholder="VD: Admin Hành chính"
                      value={roleDraft.name}
                    />
                  </div>
                  <div className="permission-field">
                    <label htmlFor="permission-role-key">Mã quyền</label>
                    <input
                      disabled={Boolean(roleDraft.originalKey)}
                      id="permission-role-key"
                      onChange={(event) =>
                        setRoleDraft((current) => ({
                          ...current,
                          key: event.target.value,
                        }))
                      }
                      placeholder="Để trống nếu muốn hệ thống tự tạo"
                      value={roleDraft.key}
                    />
                  </div>
                  <div className="permission-field">
                    <label htmlFor="permission-role-rank">Thứ tự quyền</label>
                    <input
                      id="permission-role-rank"
                      min="1"
                      onChange={(event) =>
                        setRoleDraft((current) => ({
                          ...current,
                          rank: event.target.value,
                        }))
                      }
                      placeholder="VD: 30"
                      step="1"
                      type="number"
                      value={roleDraft.rank}
                    />
                  </div>
                </div>

                <div className="permission-field">
                  <label htmlFor="permission-role-description">Mô tả</label>
                  <textarea
                    id="permission-role-description"
                    onChange={(event) =>
                      setRoleDraft((current) => ({
                        ...current,
                        description: event.target.value,
                      }))
                    }
                    placeholder="Ghi chú ngắn để sau này dễ nhớ quyền này dùng cho ai"
                    rows={2}
                    value={roleDraft.description}
                  />
                </div>

                <div className="permission-role-switch-grid">
                  <div className="permission-switch-row">
                    <div>
                      <strong>Luôn kèm Người Thuần Việt</strong>
                      <p>
                        Bật để quyền này luôn thấy các module của Người Thuần
                        Việt.
                      </p>
                    </div>
                    <Toggle
                      checked={roleDraft.includeDefaultEmployeeAccess}
                      disabled={roleDraft.key === "employee"}
                      label="Luôn kèm Người Thuần Việt"
                      onChange={(checked) =>
                        setRoleDraft((current) => ({
                          ...current,
                          includeDefaultEmployeeAccess: checked,
                        }))
                      }
                    />
                  </div>
                  <div className="permission-switch-row">
                    <div>
                      <strong>Trạng thái</strong>
                      <p>Tắt để quyền này tạm thời không dùng khi đăng nhập.</p>
                    </div>
                    <Toggle
                      checked={roleDraft.isCore ? true : roleDraft.isActive}
                      disabled={roleDraft.isCore}
                      label="Trạng thái quyền"
                      onChange={(checked) =>
                        setRoleDraft((current) => ({
                          ...current,
                          isActive: checked,
                        }))
                      }
                    />
                  </div>
                </div>

                <div className="permission-access-section">
                  <div className="permission-access-head">
                    <h3>Module và quyền thao tác</h3>
                    <p>
                      Bật Module là được cấp sẵn Xem, Sửa và Xóa. Chỉ tinh chỉnh
                      từng quyền khi vai trò này thật sự cần giới hạn.
                    </p>
                  </div>
                  <div className="permission-module-groups">
                    {permissionScopes.map(({ group, modules }) => {
                      const enabledCount = modules.filter((appModule) =>
                        (roleDraft.actionMap[appModule.key] ?? []).includes(
                          "view",
                        ),
                      ).length;
                      const wholeGroupEnabled =
                        modules.length > 0 && enabledCount === modules.length;
                      return (
                        <div
                          className="permission-access-group"
                          key={group.key}
                        >
                          <div className="permission-module-group-head">
                            <div>
                              <h4>{group.title}</h4>
                              <p>{group.description}</p>
                            </div>
                            <label>
                              <input
                                checked={wholeGroupEnabled}
                                onChange={(event) =>
                                  toggleRoleGroup(
                                    group.key,
                                    event.target.checked,
                                  )
                                }
                                type="checkbox"
                              />
                              <span>
                                {wholeGroupEnabled
                                  ? "Đã cấp cả nhóm"
                                  : `Cấp cả nhóm (${enabledCount}/${modules.length})`}
                              </span>
                            </label>
                          </div>
                          <div className="permission-action-matrix">
                            <div className="permission-action-row permission-action-head">
                              <span>Module</span>
                              <span>Bật</span>
                              {ACTIONS.map((action) => (
                                <span key={action.key}>{action.label}</span>
                              ))}
                            </div>
                            {modules.map((appModule) => {
                              const moduleEnabled = (
                                roleDraft.actionMap[appModule.key] ?? []
                              ).includes("view");
                              return (
                                <div
                                  className={`permission-action-row ${
                                    moduleEnabled ? "is-enabled" : ""
                                  }`}
                                  key={appModule.key}
                                >
                                  <span className="permission-action-module">
                                    <strong>{appModule.label}</strong>
                                    <small>{appModule.description}</small>
                                  </span>
                                  <label className="permission-module-toggle">
                                    <input
                                      checked={moduleEnabled}
                                      onChange={(event) =>
                                        toggleModuleEnabled(
                                          appModule.key,
                                          group.key,
                                          event.target.checked,
                                        )
                                      }
                                      type="checkbox"
                                    />
                                    <span>Bật Module</span>
                                  </label>
                                  {ACTIONS.map((action) => (
                                    <label
                                      key={`${appModule.key}-${action.key}`}
                                    >
                                      <input
                                        checked={(
                                          roleDraft.actionMap[appModule.key] ??
                                          []
                                        ).includes(action.key)}
                                        disabled={!moduleEnabled}
                                        onChange={(event) =>
                                          toggleModuleAction(
                                            appModule.key,
                                            action.key,
                                            event.target.checked,
                                          )
                                        }
                                        type="checkbox"
                                      />
                                      <span>{action.label}</span>
                                    </label>
                                  ))}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="permission-form-actions">
                  <button
                    className="permission-button permission-button--primary"
                    type="submit"
                  >
                    Lưu quyền
                  </button>
                </div>
              </form>
            </section>

            <section className="permission-panel permission-role-list-panel">
              <div className="permission-panel-head">
                <h2>Các quyền đã có</h2>
                <p>
                  {filteredRoles.length}/{data.roles.length} quyền · Super Admin
                  được khóa
                </p>
              </div>
              <div className="permission-role-toolbar">
                <label htmlFor="permission-role-search">Tìm quyền</label>
                <div>
                  <span aria-hidden="true">⌕</span>
                  <input
                    id="permission-role-search"
                    onChange={(event) => setRoleQuery(event.target.value)}
                    placeholder="Nhập tên, mã quyền, mô tả hoặc nhóm module..."
                    type="search"
                    value={roleQuery}
                  />
                </div>
              </div>
              <div className="permission-role-list">
                {filteredRoles.length ? (
                  filteredRoles.map((role) => (
                    <article
                      className={`permission-role-card ${
                        role.isActive ? "" : "is-inactive"
                      }`}
                      key={role.id}
                    >
                      <div className="permission-role-title-row">
                        <div>
                          <h3>{role.name}</h3>
                          <p className="permission-role-key">
                            {role.key} • Hạng {role.rank}
                          </p>
                        </div>
                        <span
                          className={`permission-role-badge ${
                            role.isCore ? "is-core" : ""
                          }`}
                        >
                          {role.isCore ? "Quyền lõi" : role.status}
                        </span>
                      </div>
                      {role.description ? (
                        <p className="permission-role-description">
                          {role.description}
                        </p>
                      ) : null}
                      <p className="permission-role-meta">
                        {role.userCount} người •{" "}
                        {role.accessibleModuleKeys.length} module
                        {role.includeDefaultEmployeeAccess
                          ? " • Kèm Người Thuần Việt"
                          : ""}
                      </p>
                      <div className="permission-role-chips">
                        {role.accessibleGroupLabels.length ? (
                          role.accessibleGroupLabels.map((label) => (
                            <span key={label}>{label}</span>
                          ))
                        ) : (
                          <span>Module riêng lẻ</span>
                        )}
                      </div>
                      {role.isEditable ? (
                        <div className="permission-actions">
                          <button
                            className="permission-button permission-button--secondary"
                            onClick={() => startRoleEdit(role)}
                            type="button"
                          >
                            Chỉnh sửa
                          </button>
                          {!role.isCore ? (
                            <button
                              className="permission-button permission-button--danger"
                              onClick={() => requestRoleDelete(role)}
                              type="button"
                            >
                              Xóa
                            </button>
                          ) : null}
                        </div>
                      ) : (
                        <span className="permission-role-lock">
                          Khóa an toàn hệ thống
                        </span>
                      )}
                    </article>
                  ))
                ) : (
                  <div className="permission-empty-card">
                    Không tìm thấy quyền phù hợp.
                  </div>
                )}
              </div>
            </section>
          </div>
        )}
      </section>

      {confirmation ? (
        <div className="permission-auth-modal">
          <button
            aria-label="Đóng xác nhận"
            className="permission-auth-backdrop"
            onClick={() => {
              if (!pending) {
                setConfirmation(null);
              }
            }}
            type="button"
          />
          <section
            aria-labelledby="permission-auth-title"
            aria-modal="true"
            className="permission-auth-dialog"
            role="dialog"
          >
            <header className="permission-console-header">
              <div className="permission-title-wrap">
                <p className="permission-section-tag">Super Admin</p>
                <h2 id="permission-auth-title">{confirmation.title}</h2>
              </div>
              <button
                aria-label="Đóng xác nhận phân quyền"
                className="permission-close-button"
                disabled={pending}
                onClick={() => setConfirmation(null)}
                type="button"
              >
                ×
              </button>
            </header>
            <form
              className="permission-auth-form"
              onSubmit={submitConfirmation}
            >
              <div className="permission-field">
                <label htmlFor="permission-actor-password">
                  Mật khẩu Super Admin
                </label>
                <input
                  autoComplete="current-password"
                  autoFocus
                  id="permission-actor-password"
                  onChange={(event) => {
                    setActorPassword(event.target.value);
                    setAuthError("");
                  }}
                  placeholder="Nhập mật khẩu của Super Admin"
                  type="password"
                  value={actorPassword}
                />
              </div>
              {authError ? (
                <p className="permission-auth-error">{authError}</p>
              ) : null}
              <div className="permission-form-actions">
                <button
                  className="permission-button permission-button--primary"
                  disabled={pending}
                  type="submit"
                >
                  {confirmation.buttonLabel}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      <WriteLoadingOverlay message={loadingLabel} show={pending} />
    </>
  );
}
