"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  CircleUserRound,
  RefreshCw,
  UsersRound,
} from "lucide-react";

type OnlineUser = {
  company: string;
  department: string;
  displayName: string;
  employeeCode: string;
  lastSeenAt: string;
  title: string;
  userId: string;
};

type PresenceResponse = {
  online?: OnlineUser[];
  serverTime?: string;
};

function initials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return (parts.at(-1)?.slice(0, 1) || "TV").toUpperCase();
}

function relativeTime(value: string, now: number) {
  const seconds = Math.max(
    0,
    Math.round((now - new Date(value).getTime()) / 1000),
  );
  if (seconds < 20) return "Đang hoạt động";
  if (seconds < 60) return `${seconds} giây trước`;
  return `${Math.max(1, Math.floor(seconds / 60))} phút trước`;
}

export function PortalPresenceDrawer() {
  const [open, setOpen] = useState(false);
  const [online, setOnline] = useState<OnlineUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(async (heartbeat = false) => {
    try {
      const response = await fetch("/api/presence", {
        cache: "no-store",
        method: heartbeat ? "POST" : "GET",
      });
      if (!response.ok) return;
      const payload = (await response.json()) as PresenceResponse;
      setOnline(Array.isArray(payload.online) ? payload.online : []);
      setNow(payload.serverTime ? new Date(payload.serverTime).getTime() : Date.now());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh(true);
    const heartbeatTimer = window.setInterval(() => void refresh(true), 45_000);
    const clockTimer = window.setInterval(() => setNow(Date.now()), 15_000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refresh(true);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearInterval(heartbeatTimer);
      window.clearInterval(clockTimer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [refresh]);

  const groups = useMemo(() => {
    const result = new Map<string, OnlineUser[]>();
    for (const person of online) {
      const key = person.department || person.company || "Khu vực chung";
      result.set(key, [...(result.get(key) || []), person]);
    }
    return [...result.entries()];
  }, [online]);

  return (
    <aside
      aria-label="Nhân sự đang hoạt động trên cổng"
      className={`portal-presence${open ? " is-open" : ""}`}
    >
      <button
        aria-expanded={open}
        aria-label={open ? "Đóng danh sách đang hoạt động" : "Mở danh sách đang hoạt động"}
        className="portal-presence-toggle"
        onClick={() => setOpen((value) => !value)}
        title={open ? "Thu gọn" : "Xem ai đang đăng nhập"}
        type="button"
      >
        {open ? <ChevronRight aria-hidden="true" /> : <ChevronLeft aria-hidden="true" />}
        {!open ? (
          <span className="portal-presence-toggle-count">{online.length}</span>
        ) : null}
      </button>
      <div className="portal-presence-panel">
        <header className="portal-presence-head">
          <span className="portal-presence-head-icon">
            <UsersRound aria-hidden="true" />
          </span>
          <div>
            <span className="portal-presence-kicker">Cổng vận hành</span>
            <h2>Đang hoạt động</h2>
          </div>
          <button
            aria-label="Làm mới danh sách"
            className="portal-presence-refresh"
            disabled={loading}
            onClick={() => void refresh(true)}
            title="Làm mới"
            type="button"
          >
            <RefreshCw aria-hidden="true" className={loading ? "is-spinning" : ""} />
          </button>
        </header>
        <div className="portal-presence-summary">
          <span className="portal-presence-live-dot" />
          <strong>{online.length}</strong> người có hoạt động trong 5 phút gần nhất
        </div>
        <div className="portal-presence-list">
          {loading && online.length === 0 ? (
            <div className="portal-presence-empty">Đang kiểm tra phiên đăng nhập…</div>
          ) : groups.length === 0 ? (
            <div className="portal-presence-empty">
              <CircleUserRound aria-hidden="true" />
              Chưa ghi nhận phiên nào đang hoạt động.
            </div>
          ) : (
            groups.map(([group, people]) => (
              <section className="portal-presence-group" key={group}>
                <h3>{group}</h3>
                {people.map((person) => (
                  <article className="portal-presence-person" key={person.userId}>
                    <span className="portal-presence-avatar" aria-hidden="true">
                      {initials(person.displayName)}
                      <i />
                    </span>
                    <span className="portal-presence-person-copy">
                      <strong>{person.displayName}</strong>
                      <small>
                        {[person.employeeCode, person.title, person.company]
                          .filter(Boolean)
                          .join(" · ") || "Tài khoản nội bộ"}
                      </small>
                      <time dateTime={person.lastSeenAt}>
                        {relativeTime(person.lastSeenAt, now)}
                      </time>
                    </span>
                  </article>
                ))}
              </section>
            ))
          )}
        </div>
      </div>
    </aside>
  );
}
