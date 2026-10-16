"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  Check,
  ClipboardCopy,
  Download,
  Search,
  X,
} from "lucide-react";

import { Badge, Button, Input, Select } from "@/components/ui";
import { useToast } from "@/components/ui/toast";

type AppVersion = {
  commandText: string;
  downloadType: string;
  downloadUrl: string;
  fileName: string;
  fileUrl: string;
  versionId: string;
  versionName: string;
};

type SupportApp = {
  description: string;
  functionTags: string[];
  guideImages: string[];
  guideText: string;
  id: string;
  logoUrl: string;
  name: string;
  tags: string[];
  versions: AppVersion[];
};

function normalized(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLocaleLowerCase("vi");
}

function activeVersion(app: SupportApp) {
  return app.versions[app.versions.length - 1] || null;
}

export function SupportToolsWorkspace({ apps }: { apps: SupportApp[] }) {
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [functionTag, setFunctionTag] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [guide, setGuide] = useState<SupportApp | null>(null);

  useEffect(() => {
    const raw = window.localStorage.getItem("support-tools-draft");
    if (!raw) return;
    try {
      const value = JSON.parse(raw);
      if (Array.isArray(value)) {
        const restored = value
          .map(String)
          .filter((id) => apps.some((app) => app.id === id));
        queueMicrotask(() => setSelected(restored));
      }
    } catch {
      window.localStorage.removeItem("support-tools-draft");
    }
  }, [apps]);

  useEffect(() => {
    window.localStorage.setItem("support-tools-draft", JSON.stringify(selected));
  }, [selected]);

  const functions = useMemo(
    () =>
      Array.from(
        new Set(apps.flatMap((app) => app.functionTags).filter(Boolean)),
      ).sort((left, right) => left.localeCompare(right, "vi")),
    [apps],
  );
  const visible = useMemo(() => {
    const needle = normalized(query);
    return apps.filter((app) => {
      if (functionTag && !app.functionTags.includes(functionTag)) return false;
      if (!needle) return true;
      return normalized(
        [app.name, app.description, ...app.tags, ...app.functionTags].join(" "),
      ).includes(needle);
    });
  }, [apps, functionTag, query]);

  const downloadSelected = async () => {
    const selectedApps = apps.filter((app) => selected.includes(app.id));
    if (!selectedApps.length) {
      toast({
        message: "Chọn ít nhất một ứng dụng cần tải hoặc sao chép.",
        title: "Chưa chọn ứng dụng",
        tone: "warning",
      });
      return;
    }
    let copied = 0;
    let opened = 0;
    for (const app of selectedApps) {
      const version = activeVersion(app);
      if (!version) continue;
      if (version.downloadType === "copy" && version.commandText) {
        await navigator.clipboard.writeText(version.commandText);
        copied += 1;
      } else {
        const url = version.downloadUrl || version.fileUrl;
        if (url) {
          window.open(url, "_blank", "noopener,noreferrer");
          opened += 1;
        }
      }
    }
    toast({
      message: [
        opened ? `Đã mở ${opened} file tải.` : "",
        copied ? `Đã sao chép nội dung của ${copied} ứng dụng.` : "",
      ]
        .filter(Boolean)
        .join(" "),
      title: "Đã xử lý lựa chọn",
      tone: "success",
    });
  };

  return (
    <>
      <section className="ui-module-toolbar p-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(260px,1fr)_240px_auto_auto_auto]">
          <label className="relative">
            <Search
              aria-hidden
              className="absolute left-4 top-1/2 -translate-y-1/2 text-accent"
              size={18}
            />
            <Input
              className="pl-11"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Tìm kiếm ứng dụng"
              value={query}
            />
          </label>
          <Select
            onChange={(event) => setFunctionTag(event.target.value)}
            value={functionTag}
          >
            <option value="">Chức năng</option>
            {functions.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </Select>
          <Button
            onClick={() =>
              setSelected((current) =>
                Array.from(new Set([...current, ...visible.map((app) => app.id)])),
              )
            }
            variant="secondary"
          >
            Chọn kết quả
          </Button>
          <Button onClick={() => setSelected([])} variant="secondary">
            Bỏ chọn
          </Button>
          <Button onClick={downloadSelected}>
            <Download size={17} />
            Tải đã chọn ({selected.length})
          </Button>
        </div>
      </section>

      <section className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {visible.length ? (
          visible.map((app) => {
            const checked = selected.includes(app.id);
            const version = activeVersion(app);
            return (
              <article className="ui-app-card flex min-h-[260px] flex-col p-4" key={app.id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    {app.logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        alt=""
                        className="ui-logo-tile size-14 shrink-0 p-1"
                        src={app.logoUrl}
                      />
                    ) : (
                      <div className="ui-logo-tile grid size-14 shrink-0 place-items-center bg-primary text-lg font-extrabold text-white">
                        {app.name.slice(0, 2).toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0">
                      <h2 className="truncate text-base font-extrabold text-primary">
                        {app.name}
                      </h2>
                      <div className="mt-1 text-xs text-muted">
                        Phiên bản {version?.versionName || "1.0"}
                      </div>
                    </div>
                  </div>
                  <button
                    aria-label={checked ? "Bỏ chọn ứng dụng" : "Chọn ứng dụng"}
                    className={`grid size-9 shrink-0 place-items-center rounded-lg border ${
                      checked
                        ? "border-accent bg-accent text-white"
                        : "border-border bg-surface text-muted"
                    }`}
                    onClick={() =>
                      setSelected((current) =>
                        checked
                          ? current.filter((id) => id !== app.id)
                          : [...current, app.id],
                      )
                    }
                    type="button"
                  >
                    {checked ? <Check size={18} /> : null}
                  </button>
                </div>

                <p className="mt-4 line-clamp-3 text-sm leading-6 text-muted">
                  {app.description || "Ứng dụng nội bộ Thuần Việt."}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {[...app.functionTags, ...app.tags].slice(0, 5).map((tag) => (
                    <span className="ui-chip min-h-7 px-2.5 text-xs" key={tag}>
                      {tag}
                    </span>
                  ))}
                </div>

                <div className="mt-auto flex flex-wrap gap-2 pt-4">
                  {app.guideText || app.guideImages.length ? (
                    <Button
                      onClick={() => setGuide(app)}
                      size="sm"
                      variant="secondary"
                    >
                      <BookOpen size={16} />
                      Hướng dẫn
                    </Button>
                  ) : null}
                  {version?.downloadType === "copy" && version.commandText ? (
                    <Button
                      onClick={async () => {
                        await navigator.clipboard.writeText(version.commandText);
                        toast({
                          message: `Đã sao chép nội dung của ${app.name}.`,
                          title: "Đã sao chép",
                          tone: "success",
                        });
                      }}
                      size="sm"
                    >
                      <ClipboardCopy size={16} />
                      Sao chép
                    </Button>
                  ) : version?.downloadUrl || version?.fileUrl ? (
                    <a
                      className="ui-button ui-button--primary min-h-9 px-4 text-sm"
                      href={version.downloadUrl || version.fileUrl}
                      rel="noreferrer"
                      target="_blank"
                    >
                      <Download size={16} />
                      Tải về
                    </a>
                  ) : (
                    <Badge tone="neutral">Chưa có file</Badge>
                  )}
                </div>
              </article>
            );
          })
        ) : (
          <div className="ui-module-panel col-span-full grid min-h-56 place-items-center border-dashed p-8 text-center text-sm text-muted">
            Không tìm thấy ứng dụng phù hợp.
          </div>
        )}
      </section>

      {guide ? (
        <div className="fixed inset-0 z-[150] grid place-items-center bg-[rgba(7,24,21,0.48)] p-4 backdrop-blur-[3px]">
          <section className="max-h-[90dvh] w-full max-w-3xl overflow-hidden rounded-lg border border-border bg-surface shadow-[0_32px_90px_rgba(17,45,39,0.28)]">
            <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
              <div>
                <Badge tone="info">Hướng dẫn</Badge>
                <h2 className="mt-2 text-xl font-extrabold text-primary">
                  {guide.name}
                </h2>
              </div>
              <button
                aria-label="Đóng"
                className="ui-close-button"
                onClick={() => setGuide(null)}
                type="button"
              >
                <X size={20} />
              </button>
            </header>
            <div className="max-h-[calc(90dvh-110px)] overflow-auto p-5">
              <p className="whitespace-pre-wrap text-sm leading-7 text-foreground">
                {guide.guideText || "Chưa có hướng dẫn dạng văn bản."}
              </p>
              {guide.guideImages.length ? (
                <div className="mt-5 space-y-3">
                  {guide.guideImages.map((url, index) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      alt={`Hướng dẫn ${index + 1}`}
                      className="w-full rounded-lg border border-border"
                      key={url}
                      src={url}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
