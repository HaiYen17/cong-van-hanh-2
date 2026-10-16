"use client";

import {
  useActionState,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  ACCOUNT_ACTIVATION_PENDING_MESSAGE,
  ACCOUNT_ACTIVATION_REQUIRED_MESSAGE,
  ACCOUNT_DISABLED_MESSAGE,
  canRequestAccountActivation,
  type AccountActivationStatus,
} from "@/lib/auth/account-activation";

import { loginAction, type LoginFormState } from "./actions";

const initialState: LoginFormState = {};

export type LoginEmployee = {
  accountStatus: "ACTIVE" | "INACTIVE" | "ARCHIVED" | null;
  activationStatus: AccountActivationStatus;
  department: string | null;
  employeeCode: string;
  fullName: string;
  hasPassword: boolean;
  id: string;
  requiresPassword: boolean;
  title: string | null;
};

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/đ/g, "d")
    .replace(/\s+/g, " ")
    .trim();
}

export function LoginForm({ employees }: { employees: LoginEmployee[] }) {
  const [state, action, pending] = useActionState(loginAction, initialState);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<LoginEmployee | null>(null);
  const [duplicates, setDuplicates] = useState<LoginEmployee[]>([]);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const root = useRef<HTMLDivElement>(null);

  const normalizedQuery = normalize(query);
  const filtered = useMemo(() => {
    const list = normalizedQuery
      ? employees.filter((employee) =>
          normalize(
            [
              employee.fullName,
              employee.employeeCode,
              employee.department,
              employee.title,
            ].join(" "),
          ).includes(normalizedQuery),
        )
      : employees;
    return list.slice(0, 12);
  }, [employees, normalizedQuery]);

  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  const chooseByName = (employee: LoginEmployee) => {
    const sameName = employees.filter(
      (item) => normalize(item.fullName) === normalize(employee.fullName),
    );
    setQuery(employee.fullName);
    setDuplicates(sameName);
    setSelected(sameName.length === 1 ? employee : null);
    setOpen(false);
    setHighlighted(-1);
  };

  const requiresPassword = Boolean(selected?.requiresPassword);
  const needsFirstPassword =
    selected?.activationStatus === "APPROVED" &&
    requiresPassword &&
    !selected.hasPassword;
  const accountDisabled = Boolean(
    selected?.accountStatus && selected.accountStatus !== "ACTIVE",
  );
  const actionMessageMatches = Boolean(
    selected && state.employeeId === selected.id,
  );
  const activationPending = Boolean(
    selected?.activationStatus === "PENDING" ||
      (actionMessageMatches &&
        state.success &&
        selected?.activationStatus !== "APPROVED"),
  );
  const activationApproved = selected?.activationStatus === "APPROVED";
  const canRequestActivation = Boolean(
    selected &&
      !accountDisabled &&
      canRequestAccountActivation(selected.activationStatus),
  );
  const canSubmit = Boolean(selected) && !pending && !accountDisabled && !activationPending;
  const selectionMessage = !selected
    ? ""
    : accountDisabled
      ? ACCOUNT_DISABLED_MESSAGE
      : activationPending
        ? ACCOUNT_ACTIVATION_PENDING_MESSAGE
        : !activationApproved
          ? ACCOUNT_ACTIVATION_REQUIRED_MESSAGE
          : needsFirstPassword
            ? "Tài khoản đã được kích hoạt. Vui lòng tạo mật khẩu để đăng nhập."
            : "";
  const formMessage = actionMessageMatches
    ? state.error || state.success || selectionMessage
    : selectionMessage;
  const messageIsError = Boolean(
    accountDisabled || (actionMessageMatches && state.error),
  );
  const messageIsSuccess = Boolean(actionMessageMatches && state.success);
  const buttonIntent = canRequestActivation ? "request-activation" : "login";
  const buttonLabel = pending
    ? canRequestActivation
      ? "Đang gửi yêu cầu..."
      : "Đang đăng nhập..."
    : activationPending
      ? "Đã gửi yêu cầu"
      : canRequestActivation
        ? "Yêu cầu kích hoạt"
        : needsFirstPassword
          ? "Tạo mật khẩu & đăng nhập"
          : "Đăng nhập";

  return (
    <form action={action} className="login-form" id="loginForm" noValidate>
      <input name="employeeId" type="hidden" value={selected?.id ?? ""} />
      <div className="field-group">
        <label className="field-label" htmlFor="employeeNameInput">
          Tên nhân viên
        </label>
        <div
          className="combobox ui-combobox"
          data-menu-placement="bottom"
          data-open={open ? "true" : "false"}
          ref={root}
        >
          <input
            aria-autocomplete="list"
            aria-controls="employeeNameList"
            aria-expanded={open}
            autoComplete="off"
            className="text-input ui-combobox-input"
            id="employeeNameInput"
            onChange={(event) => {
              setQuery(event.target.value);
              setSelected(null);
              setDuplicates([]);
              setHighlighted(-1);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setOpen(true);
                setHighlighted((value) =>
                  Math.min(value + 1, filtered.length - 1),
                );
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setOpen(true);
                setHighlighted((value) => Math.max(value - 1, 0));
              } else if (
                event.key === "Enter" &&
                highlighted >= 0 &&
                filtered[highlighted]
              ) {
                event.preventDefault();
                chooseByName(filtered[highlighted]);
              } else if (event.key === "Escape") {
                setOpen(false);
              }
            }}
            placeholder="Gõ để tìm hoặc chọn từ danh sách"
            role="combobox"
            type="text"
            value={query}
          />
          <button
            aria-label="Mở danh sách tên nhân viên"
            className="combobox-toggle ui-combobox-toggle"
            onClick={() => setOpen((value) => !value)}
            type="button"
          >
            <span />
          </button>
          <div
            className={`dropdown-menu ui-combobox-menu${
              open ? "" : " is-hidden"
            }`}
            id="employeeNameList"
            role="listbox"
          >
            {filtered.length > 0 ? (
              filtered.map((employee, index) => (
                <button
                  className={`dropdown-item ui-combobox-option${
                    index === highlighted ? " is-active" : ""
                  }`}
                  key={employee.id}
                  onClick={() => chooseByName(employee)}
                  onMouseEnter={() => setHighlighted(index)}
                  aria-selected={selected?.id === employee.id}
                  role="option"
                  type="button"
                >
                  <span className="ui-combobox-option-label">
                    {employee.fullName}
                  </span>
                  <span className="ui-combobox-option-meta">
                    {employee.department ||
                      employee.title ||
                      "Chưa gắn phòng ban"}
                  </span>
                </button>
              ))
            ) : (
              <div className="dropdown-empty ui-combobox-empty">
                Không có tên phù hợp trong bộ dữ liệu hiện tại.
              </div>
            )}
          </div>
        </div>
      </div>

      <div
        aria-hidden={duplicates.length < 2}
        className={`field-group${duplicates.length < 2 ? " is-hidden" : ""}`}
        id="roleField"
      >
        <label className="field-label" htmlFor="roleSelect">
          Phòng ban
        </label>
        <div className="select-shell">
          <select
            className="select-input"
            id="roleSelect"
            onChange={(event) =>
              setSelected(
                duplicates.find((item) => item.id === event.target.value) ??
                  null,
              )
            }
            value={selected?.id ?? ""}
          >
            <option value="">Chọn phòng ban</option>
            {duplicates.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.department || employee.title || employee.fullName}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div
        aria-hidden={!activationApproved || !requiresPassword}
        className={`field-group${
          activationApproved && requiresPassword ? "" : " is-hidden"
        }`}
        id="passwordField"
      >
        <label className="field-label" htmlFor="passwordInput">
          {needsFirstPassword ? "Tạo mật khẩu" : "Mật khẩu"}
        </label>
        <input
          autoComplete={needsFirstPassword ? "new-password" : "current-password"}
          className="text-input"
          id="passwordInput"
          name={needsFirstPassword ? "newPassword" : "password"}
          placeholder={
            needsFirstPassword
              ? "Tạo mật khẩu lần đầu để đăng nhập"
              : "Nhập mật khẩu để đăng nhập"
          }
          type="password"
        />
      </div>

      <div
        aria-hidden={!needsFirstPassword}
        className={`field-group${needsFirstPassword ? "" : " is-hidden"}`}
        id="passwordConfirmField"
      >
        <label className="field-label" htmlFor="passwordConfirmInput">
          Nhập lại mật khẩu
        </label>
        <input
          autoComplete="new-password"
          className="text-input"
          id="passwordConfirmInput"
          name="confirmPassword"
          placeholder="Nhập lại mật khẩu vừa tạo"
          type="password"
        />
      </div>

      <div className="status-row">
        <p
          aria-live="polite"
          className={`form-message${messageIsError ? " is-error" : ""}${
            messageIsSuccess ? " is-success" : ""
          }`}
          id="formMessage"
          role="status"
        >
          {formMessage}
        </p>
      </div>

      <button
        className={`primary-button${pending ? " is-loading" : ""}`}
        disabled={!canSubmit}
        id="startButton"
        name="intent"
        type="submit"
        value={buttonIntent}
      >
        <span className="primary-button-label">{buttonLabel}</span>
      </button>
    </form>
  );
}
