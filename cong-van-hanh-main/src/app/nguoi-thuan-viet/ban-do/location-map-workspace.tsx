"use client";

import { useEffect, useState } from "react";
import { MapPinned, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui";

export type LocationPerson = {
  avatarUrl: string;
  department: string;
  employeeCode: string;
  lastMs: number;
  name: string;
};

export type LocationZone = {
  imageUrl: string;
  key: string;
  label: string;
  people: LocationPerson[];
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return parts.at(-1)?.charAt(0).toUpperCase() || "?";
}

function time(value: number) {
  return new Intl.DateTimeFormat("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function LocationMapWorkspace({
  enabled,
  serverMs,
  zones,
}: {
  enabled: boolean;
  serverMs: number;
  zones: LocationZone[];
}) {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const total = zones.reduce((sum, zone) => sum + zone.people.length, 0);

  useEffect(() => {
    const timer = window.setInterval(() => router.refresh(), 20_000);
    return () => window.clearInterval(timer);
  }, [router]);

  if (!enabled) {
    return (
      <section className="ui-module-panel grid min-h-64 place-items-center border-dashed p-8 text-center">
        <div>
          <MapPinned className="mx-auto text-accent" size={40} />
          <h2 className="mt-3 text-xl font-extrabold text-primary">
            Tính năng định vị đang tắt
          </h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-muted">
            Bật cấu hình định vị và chọn nhân sự theo dõi để Notifier bắt đầu
            ghi nhận hiện diện.
          </p>
        </div>
      </section>
    );
  }

  return (
    <>
      <div className="ui-module-toolbar mb-4 flex flex-wrap items-center justify-between gap-3 p-3">
        <span className="text-sm text-muted">
          Đang online: <strong className="text-primary">{total}</strong> người ·
          cập nhật lúc {time(serverMs)}
        </span>
        <Button
          disabled={refreshing}
          onClick={() => {
            setRefreshing(true);
            router.refresh();
            window.setTimeout(() => setRefreshing(false), 500);
          }}
          size="sm"
          variant="secondary"
        >
          <RefreshCw className={refreshing ? "animate-spin" : ""} size={16} />
          Làm mới
        </Button>
      </div>
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {zones.map((zone) => (
          <article
            className={`ui-module-panel min-h-[300px] overflow-hidden ${
              zone.key === "other" ? "border-dashed" : ""
            }`}
            key={zone.key}
          >
            <div
              className="flex h-36 items-end bg-[linear-gradient(145deg,rgba(17,76,65,.95),rgba(38,120,104,.78))] bg-cover bg-center"
              style={
                zone.imageUrl
                  ? { backgroundImage: `url("${zone.imageUrl}")` }
                  : undefined
              }
            >
              <div className="flex w-full items-center justify-between gap-3 bg-gradient-to-t from-black/70 to-transparent px-4 pb-3 pt-8 text-white">
                <h2 className="font-extrabold">{zone.label}</h2>
                <span className="rounded-full bg-white/20 px-3 py-1 text-xs font-bold">
                  {zone.people.length} người
                </span>
              </div>
            </div>
            {zone.people.length ? (
              <div className="flex flex-wrap content-start gap-4 p-4">
                {zone.people.map((person) => (
                  <div
                    className="w-[74px] text-center"
                    key={person.employeeCode}
                    title={`${person.name} · online ${time(person.lastMs)}`}
                  >
                    {person.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        alt=""
                        className="mx-auto size-14 rounded-full border-[3px] border-accent bg-surface-muted object-cover shadow-md"
                        src={person.avatarUrl}
                      />
                    ) : (
                      <span className="mx-auto grid size-14 place-items-center rounded-full border-[3px] border-accent bg-surface-muted text-lg font-extrabold text-primary shadow-md">
                        {initials(person.name)}
                      </span>
                    )}
                    <span className="mt-2 block truncate text-xs font-bold text-primary">
                      {person.name}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid min-h-36 place-items-center p-5 text-center text-sm text-muted">
                {zone.key === "other"
                  ? "Không có ai đang ở nơi khác."
                  : "Chưa có ai online ở đây."}
              </div>
            )}
          </article>
        ))}
      </section>
    </>
  );
}
