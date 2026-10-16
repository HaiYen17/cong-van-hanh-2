import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getCurrentSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";

import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Đăng nhập | Cổng Vận hành Nội bộ",
};

const NOTIFIER_WINDOWS_URL =
  "https://drive.google.com/uc?export=download&id=1WkiOpZzjk0_JVnwCtx9kNzc6HhE_MzfY";
const NOTIFIER_MAC_URL =
  "https://drive.google.com/uc?export=download&id=1EVeoxFTSynV8UwYuuvjb2lRsCzjz-IrG";

function WindowsIcon() {
  return (
    <svg focusable="false" role="presentation" viewBox="0 0 24 24">
      <rect height="7" width="7" x="3.5" y="4" />
      <rect height="7" width="7" x="13.5" y="4" />
      <rect height="7" width="7" x="3.5" y="13" />
      <rect height="7" width="7" x="13.5" y="13" />
    </svg>
  );
}

function MacIcon() {
  return (
    <svg focusable="false" role="presentation" viewBox="0 0 24 24">
      <path d="M5 16.5h14" />
      <path d="M7 16.5V7.8c0-.9.7-1.6 1.6-1.6h6.8c.9 0 1.6.7 1.6 1.6v8.7" />
      <path d="M4 18.8h16" />
    </svg>
  );
}

export default async function LoginPage() {
  const session = await getCurrentSession();
  if (session) redirect("/");

  const employees = await getDb().employee.findMany({
    orderBy: { fullName: "asc" },
    select: {
      department: true,
      employeeCode: true,
      fullName: true,
      id: true,
      title: true,
      user: {
        select: {
          activationStatus: true,
          employeeId: true,
          passwordHash: true,
          requiresPassword: true,
          status: true,
          userRoles: {
            select: {
              role: { select: { key: true, status: true } },
            },
          },
        },
      },
    },
    where: { status: "ACTIVE" },
  });

  const loginEmployees = employees.map(({ user, ...employee }) => {
    const isSuperAdmin = Boolean(
      user?.userRoles.some(
        ({ role }) =>
          role.key === "super-admin" && role.status === "ACTIVE",
      ),
    );
    return {
      ...employee,
      accountStatus: user?.status ?? null,
      activationStatus: user?.activationStatus ?? "NOT_REQUESTED",
      hasPassword: Boolean(user?.passwordHash),
      requiresPassword: Boolean(
        user?.employeeId ||
          user?.requiresPassword ||
          isSuperAdmin ||
          (user?.activationStatus === "APPROVED" && !user.passwordHash),
      ),
    };
  });

  return (
    <>
      {/* CSS được trích nguyên bản từ AppStyles của GAS để giữ parity 1:1. */}
      {/* eslint-disable-next-line @next/next/no-css-tags */}
      <link href="/legacy/index-services-parity.css" rel="stylesheet" />
      <div className="app-root" data-view="login" id="appRoot">
        <section className="screen-shell view-screen" id="loginView">
          <aside
            aria-label="Sứ mệnh Thuần Việt"
            className="login-mission-panel"
          >
            <div className="login-mission-copy">
              <blockquote>
                Đồng lòng
                <br />
                kiến tạo
                <br />
                tương lai.
              </blockquote>
              <p className="login-mission-note">
                Mỗi trải nghiệm tốt hơn bắt đầu từ cách chúng ta cùng nhau vận
                hành.
              </p>
            </div>
            <p className="login-mission-foot">
              Cổng vận hành nội bộ · Nệm Thuần Việt
            </p>
          </aside>

          <main className="login-panel">
            <section className="login-card">
              <div className="brand-block">
                <svg
                  aria-label="Logo công ty"
                  className="brand-logo"
                  preserveAspectRatio="xMidYMid meet"
                  role="img"
                  viewBox="120 320 960 540"
                >
                  <image
                    height="1200"
                    href="/login-logo.png"
                    preserveAspectRatio="xMidYMid meet"
                    width="1200"
                    x="0"
                    y="0"
                  />
                </svg>
                <div className="brand-copy">
                  <h1 className="brand-title">Khối Vận hành</h1>
                  <div
                    aria-label="Tải Thuần Việt Notifier"
                    className="notifier-promo-card"
                  >
                    <span className="notifier-promo-main">
                      <span className="notifier-promo-brand">
                        <span className="notifier-promo-icon-shell">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            alt=""
                            className="notifier-promo-icon"
                            src="/logo.png"
                          />
                        </span>
                        <span className="notifier-promo-copy">
                          <span className="notifier-promo-kicker">
                            Ứng dụng nhận thông báo
                          </span>
                          <span className="notifier-promo-title">
                            Thuần Việt Notifier
                          </span>
                        </span>
                      </span>
                    </span>
                    <span
                      aria-label="Chọn hệ điều hành để tải"
                      className="notifier-download-options"
                    >
                      <a
                        aria-label="Tải bản Windows"
                        className="notifier-download-option notifier-download-option--windows"
                        href={NOTIFIER_WINDOWS_URL}
                        rel="noopener"
                        target="_blank"
                        title="Tải bản Windows"
                      >
                        <WindowsIcon />
                      </a>
                      <a
                        aria-label="Tải bản macOS"
                        className="notifier-download-option notifier-download-option--mac"
                        href={NOTIFIER_MAC_URL}
                        rel="noopener"
                        target="_blank"
                        title="Tải bản macOS"
                      >
                        <MacIcon />
                      </a>
                    </span>
                    <span className="notifier-promo-sub">
                      Chọn đúng bản Windows hoặc macOS để cài Thuần Việt
                      Notifier.
                    </span>
                  </div>
                </div>
              </div>
              <div className="form-block">
                <LoginForm employees={loginEmployees} />
              </div>
            </section>
          </main>
        </section>
      </div>
    </>
  );
}
