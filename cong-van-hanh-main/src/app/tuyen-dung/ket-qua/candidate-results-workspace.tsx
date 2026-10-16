"use client";

import {
  CheckCircle2,
  Clipboard,
  ExternalLink,
  FileClock,
  Link2,
  Printer,
  RefreshCw,
  Search,
  Send,
  ShieldOff,
  Trophy,
  UsersRound,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  useToast,
  WriteLoadingOverlay,
} from "@/components/ui/toast";
import { postRpc } from "@/lib/rpc-client";
import { HexacoCard } from "../danh-gia/candidate-assessment-workspace";

type Json = Record<string, unknown>;
type RoundCard = {
  decision: string;
  finalScore: number | null;
  id: string;
  items: Array<{
    evidence: string;
    groupKey: string;
    groupName: string;
    itemKey: string;
    itemName: string;
    note: string;
    score: number | null;
    sectionKey: string;
  }>;
  overallComment: string;
  reviewerName: string;
  roleLabel: string;
  roundKey: string;
  roundLabel: string;
  status: string;
  submittedAt: string;
  updatedAt: string;
  version: number;
};
type CenterApplication = {
  applicationCode: string;
  applicationId: string;
  candidateCode: string;
  candidateName: string;
  overallScore: number | null;
  position: string;
  publicationStatus: string;
  rounds: RoundCard[];
  updatedAt: string;
};
type CenterData = {
  applications: CenterApplication[];
  stats: {
    candidates: number;
    decisions: number;
    published: number;
    submittedCards: number;
  };
};
type Publication = {
  accessToken: string;
  development: string;
  expiresAt: string;
  publicStatus: string;
  publishedAt: string;
  publishedByName: string;
  publishedScore: number | null;
  roundVersions: Json;
  status: string;
  strengths: string;
  summary: string;
};
type ReportData = {
  application: {
    applicationCode: string;
    applicationId: string;
    candidateCode: string;
    candidateName: string;
    department: string;
    email: string;
    phone: string;
    position: string;
  };
  personality: Array<{ id: string; kind: string; payload: Json }>;
  publication: Publication | null;
  scorecards: RoundCard[];
  timeline: Array<{
    actorName: string;
    createdAt: string;
    detail: string;
    eventType: string;
    id: string;
    title: string;
  }>;
};
type PublicationDraft = {
  development: string;
  expiresAt: string;
  publicStatus: string;
  showScore: boolean;
  strengths: string;
  summary: string;
};

function text(value: unknown) {
  return value == null ? "" : String(value).trim();
}

function formatDate(value: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function decisionLabel(value: string) {
  if (value === "pass") return "Đạt";
  if (value === "consider") return "Cân nhắc";
  if (value === "fail") return "Không đạt";
  return "Chưa kết luận";
}

function emptyPublication(): PublicationDraft {
  const defaultExpiry = new Date();
  defaultExpiry.setDate(defaultExpiry.getDate() + 30);
  return {
    development: "",
    expiresAt: defaultExpiry.toISOString().slice(0, 10),
    publicStatus: "completed",
    showScore: true,
    strengths: "",
    summary: "",
  };
}

export function CandidateResultsWorkspace() {
  const { toast } = useToast();
  const [center, setCenter] = useState<CenterData | null>(null);
  const [report, setReport] = useState<ReportData | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [writing, setWriting] = useState(false);
  const [publicationDraft, setPublicationDraft] =
    useState<PublicationDraft>(emptyPublication);

  const applyPublication = useCallback((publication: Publication | null) => {
    if (!publication) {
      setPublicationDraft(emptyPublication());
      return;
    }
    setPublicationDraft({
      development: publication.development,
      expiresAt: publication.expiresAt
        ? publication.expiresAt.slice(0, 10)
        : "",
      publicStatus: publication.publicStatus || "completed",
      showScore: publication.publishedScore != null,
      strengths: publication.strengths,
      summary: publication.summary,
    });
  }, []);

  const openReport = useCallback(
    async (applicationId: string) => {
      if (!applicationId) {
        setReport(null);
        return;
      }
      setSelectedId(applicationId);
      setLoading(true);
      try {
        const result = await postRpc<ReportData>(
          "/api/recruitment/rpc",
          "getResultReport",
          { applicationId },
        );
        setReport(result);
        applyPublication(result.publication);
      } catch (error) {
        toast({
          message: error instanceof Error ? error.message : "Không mở được kết quả.",
          title: "Lỗi tải báo cáo",
          tone: "error",
        });
      } finally {
        setLoading(false);
      }
    },
    [applyPublication, toast],
  );

  const loadCenter = useCallback(
    async (keepSelection = false) => {
      setLoading(true);
      try {
        const result = await postRpc<CenterData>(
          "/api/recruitment/rpc",
          "getResultsCenter",
          { query },
        );
        setCenter(result);
        const target =
          keepSelection &&
          result.applications.some((item) => item.applicationId === selectedId)
            ? selectedId
            : result.applications[0]?.applicationId || "";
        if (target) await openReport(target);
        else setReport(null);
      } catch (error) {
        toast({
          message: error instanceof Error ? error.message : "Không tải được trung tâm kết quả.",
          title: "Lỗi tải dữ liệu",
          tone: "error",
        });
        setLoading(false);
      }
    },
    [openReport, query, selectedId, toast],
  );

  useEffect(() => {
    void loadCenter();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const latestCards = useMemo(() => {
    const result = new Map<string, RoundCard>();
    for (const card of report?.scorecards || []) {
      if (!result.has(card.roundKey)) result.set(card.roundKey, card);
    }
    return Array.from(result.values());
  }, [report]);
  const allVersions = useMemo(() => {
    const result = new Map<string, RoundCard[]>();
    for (const card of report?.scorecards || []) {
      const current = result.get(card.roundKey) || [];
      current.push(card);
      result.set(card.roundKey, current);
    }
    return result;
  }, [report]);
  const publicLink =
    report?.publication?.accessToken && typeof window !== "undefined"
      ? `${window.location.origin}/ket-qua-ung-vien/${report.publication.accessToken}`
      : "";

  async function publish() {
    if (!report) return;
    setWriting(true);
    try {
      const publication = await postRpc<Publication>(
        "/api/recruitment/rpc",
        "publishResult",
        {
          applicationId: report.application.applicationId,
          ...publicationDraft,
        },
      );
      setReport((current) =>
        current ? { ...current, publication } : current,
      );
      applyPublication(publication);
      toast({
        message: "Link công khai đã được tạo và có thể gửi cho người nhận.",
        title: "Đã công bố kết quả",
        tone: "success",
      });
      await loadCenter(true);
    } catch (error) {
      toast({
        message: error instanceof Error ? error.message : "Không công bố được kết quả.",
        title: "Công bố thất bại",
        tone: "error",
      });
    } finally {
      setWriting(false);
    }
  }

  async function revoke() {
    if (!report || !window.confirm("Thu hồi link công khai của ứng viên này?")) {
      return;
    }
    setWriting(true);
    try {
      const publication = await postRpc<Publication>(
        "/api/recruitment/rpc",
        "revokeResult",
        { applicationId: report.application.applicationId },
      );
      setReport((current) =>
        current ? { ...current, publication } : current,
      );
      toast({
        message: "Link cũ đã bị khóa truy cập.",
        title: "Đã thu hồi",
        tone: "success",
      });
      await loadCenter(true);
    } catch (error) {
      toast({
        message: error instanceof Error ? error.message : "Không thu hồi được.",
        title: "Thu hồi thất bại",
        tone: "error",
      });
    } finally {
      setWriting(false);
    }
  }

  async function copyLink() {
    if (!publicLink) return;
    try {
      await navigator.clipboard.writeText(publicLink);
      toast({
        message: "Đã sao chép link kết quả công khai.",
        title: "Đã sao chép",
        tone: "success",
      });
    } catch {
      toast({
        message: publicLink,
        title: "Sao chép link này",
        tone: "info",
      });
    }
  }

  return (
    <div className="relative">
      <WriteLoadingOverlay
        message="Đang cập nhật bản công bố kết quả..."
        show={writing}
      />
      <section className="print:hidden rounded-xl border border-[#d2dfdb] bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.1em] text-brand-strong">
              Tuyển dụng
            </div>
            <h1 className="mt-1 text-2xl font-black text-[#114c41]">
              Trung tâm kết quả ứng viên
            </h1>
            <p className="mt-1 text-sm text-[#6d817b]">
              Tổng hợp 3 vòng, phiên bản, HEXACO, lịch sử và công bố an toàn.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ["Ứng viên", center?.stats.candidates || 0, UsersRound],
              ["Phiếu đã nộp", center?.stats.submittedCards || 0, CheckCircle2],
              ["Có kết luận", center?.stats.decisions || 0, Trophy],
              ["Đã công bố", center?.stats.published || 0, Link2],
            ].map(([label, value, Icon]) => {
              const StatIcon = Icon as typeof UsersRound;
              return (
                <div
                  className="min-w-28 rounded-lg border border-[#dce5e2] bg-[#f7faf9] p-3"
                  key={String(label)}
                >
                  <StatIcon className="text-brand-strong" size={17} />
                  <strong className="mt-1 block text-xl text-[#114c41]">
                    {String(value)}
                  </strong>
                  <span className="text-[10px] font-bold uppercase text-[#6d817b]">
                    {String(label)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          <label className="relative flex-1">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6d817b]"
              size={17}
            />
            <input
              className="h-10 w-full rounded-lg border border-[#cbdad5] pl-9 pr-3 text-sm"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void loadCenter();
              }}
              placeholder="Tìm theo tên, mã, vị trí, điện thoại..."
              value={query}
            />
          </label>
          <Button onClick={() => void loadCenter()}>
            <RefreshCw className={loading ? "animate-spin" : ""} size={17} />
            Tìm
          </Button>
        </div>
      </section>

      <div className="mt-5 grid gap-5 xl:grid-cols-[340px_minmax(0,1fr)] print:block">
        <aside className="print:hidden max-h-[calc(100vh-210px)] space-y-2 overflow-y-auto rounded-xl border border-[#d2dfdb] bg-white p-3 shadow-sm xl:sticky xl:top-4">
          {(center?.applications || []).map((application) => (
            <button
              className={`w-full rounded-lg border p-3 text-left ${
                selectedId === application.applicationId
                  ? "border-brand bg-brand-soft"
                  : "border-[#dce5e2] bg-[#f9fbfa]"
              }`}
              key={application.applicationId}
              onClick={() => void openReport(application.applicationId)}
              type="button"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <strong className="text-sm text-[#114c41]">
                    {application.candidateName}
                  </strong>
                  <div className="mt-1 text-xs text-[#6d817b]">
                    {application.candidateCode || application.applicationCode} ·{" "}
                    {application.position}
                  </div>
                </div>
                <span className="text-xl font-black text-brand">
                  {application.overallScore ?? "—"}
                </span>
              </div>
              <div className="mt-3 flex items-center justify-between text-[10px] font-bold">
                <span className="text-[#6d817b]">
                  {application.rounds.length} vòng có dữ liệu
                </span>
                <span
                  className={`rounded-full px-2 py-1 ${
                    application.publicationStatus === "published"
                      ? "bg-[#e8f8f1] text-[#0c6e4c]"
                      : "bg-[#f0f3f2] text-[#647972]"
                  }`}
                >
                  {application.publicationStatus === "published"
                    ? "Đã công bố"
                    : "Nội bộ"}
                </span>
              </div>
            </button>
          ))}
        </aside>

        <main className="min-w-0 space-y-4">
          {report ? (
            <>
              <section className="rounded-xl border border-[#d2dfdb] bg-white p-5 shadow-sm print:border-0 print:shadow-none">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="text-xs font-black uppercase tracking-[0.1em] text-brand-strong">
                      Báo cáo đánh giá ứng viên
                    </div>
                    <h2 className="mt-2 text-3xl font-black text-[#114c41]">
                      {report.application.candidateName}
                    </h2>
                    <p className="mt-1 text-sm text-[#6d817b]">
                      {report.application.candidateCode ||
                        report.application.applicationCode}{" "}
                      · {report.application.position} ·{" "}
                      {report.application.department || "Chưa có phòng ban"}
                    </p>
                  </div>
                  <div className="print:hidden flex flex-wrap gap-2">
                    <Button
                      onClick={() => window.print()}
                      variant="secondary"
                    >
                      <Printer size={17} />
                      In báo cáo
                    </Button>
                    {publicLink ? (
                      <a
                        className="inline-flex h-10 items-center gap-2 rounded-full border border-[#d2dfdb] px-4 text-sm font-bold text-[#114c41]"
                        href={publicLink}
                        rel="noopener"
                        target="_blank"
                      >
                        <ExternalLink size={16} />
                        Mở link
                      </a>
                    ) : null}
                  </div>
                </div>
                <div className="mt-5 grid gap-3 sm:grid-cols-3">
                  {latestCards.map((card) => (
                    <div
                      className="rounded-lg border border-[#d8e2df] bg-[#f9fbfa] p-4"
                      key={card.id}
                    >
                      <div className="text-xs font-black uppercase text-[#6d817b]">
                        {card.roundLabel} · v{card.version}
                      </div>
                      <div className="mt-2 text-3xl font-black text-brand">
                        {card.finalScore ?? "—"}
                        <span className="text-sm text-[#6d817b]">/10</span>
                      </div>
                      <div className="mt-2 text-xs font-bold text-[#114c41]">
                        {decisionLabel(card.decision)}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {report.personality.map((snapshot) =>
                snapshot.kind === "hexaco" ? (
                  <HexacoCard key={snapshot.id} snapshot={snapshot} />
                ) : null,
              )}

              {latestCards.map((card) => {
                const versions = allVersions.get(card.roundKey) || [];
                const groups = new Map<string, RoundCard["items"]>();
                card.items.forEach((item) => {
                  const key = item.groupKey || item.sectionKey || "general";
                  groups.set(key, [...(groups.get(key) || []), item]);
                });
                return (
                  <section
                    className="rounded-xl border border-[#d2dfdb] bg-white p-5 shadow-sm print:break-inside-avoid"
                    key={card.id}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 className="text-lg font-black text-[#114c41]">
                          {card.roundLabel}
                        </h3>
                        <p className="mt-1 text-xs text-[#6d817b]">
                          {card.reviewerName || "Chưa xác định người chấm"} ·{" "}
                          {formatDate(card.submittedAt || card.updatedAt)}
                        </p>
                      </div>
                      <div className="flex gap-1">
                        {versions.map((version) => (
                          <span
                            className={`rounded-full px-2.5 py-1 text-[10px] font-black ${
                              version.id === card.id
                                ? "bg-[#114c41] text-white"
                                : "bg-[#f0f3f2] text-[#647972]"
                            }`}
                            key={version.id}
                          >
                            v{version.version} · {version.finalScore ?? "—"}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="mt-4 space-y-3">
                      {Array.from(groups.entries()).map(([key, items]) => (
                        <div
                          className="rounded-lg border border-[#d8e2df] bg-[#f9fbfa] p-3"
                          key={key}
                        >
                          <div className="mb-2 text-xs font-black uppercase tracking-[0.06em] text-[#49665f]">
                            {items[0]?.groupName || "Nội dung đánh giá"}
                          </div>
                          <div className="space-y-2">
                            {items.map((item) => (
                              <div
                                className="grid gap-2 border-t border-[#e1e8e6] pt-2 text-sm first:border-0 first:pt-0 md:grid-cols-[1fr_72px]"
                                key={`${item.itemKey}-${item.itemName}`}
                              >
                                <div>
                                  <strong className="text-[#203a34]">
                                    {item.itemName}
                                  </strong>
                                  {item.evidence || item.note ? (
                                    <p className="mt-1 text-xs leading-5 text-[#6d817b]">
                                      {[item.evidence, item.note]
                                        .filter(Boolean)
                                        .join(" · ")}
                                    </p>
                                  ) : null}
                                </div>
                                <strong className="text-right text-brand">
                                  {item.score ?? "—"}
                                </strong>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                    {card.overallComment ? (
                      <div className="mt-4 rounded-lg bg-[#eef5f2] p-3 text-sm leading-6 text-[#36564e]">
                        <strong className="block text-[#114c41]">
                          Nhận xét tổng thể
                        </strong>
                        {card.overallComment}
                      </div>
                    ) : null}
                  </section>
                );
              })}

              <section className="print:hidden rounded-xl border border-[#d2dfdb] bg-white p-5 shadow-sm">
                <div className="flex items-center gap-2">
                  <Link2 className="text-brand-strong" size={20} />
                  <div>
                    <h3 className="font-black text-[#114c41]">
                      Công bố kết quả
                    </h3>
                    <p className="mt-1 text-xs text-[#6d817b]">
                      Chỉ những nội dung trong khung này mới xuất hiện ở link công khai.
                    </p>
                  </div>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <label>
                    <span className="mb-1 block text-xs font-bold text-[#49665f]">
                      Trạng thái công khai
                    </span>
                    <select
                      className="h-11 w-full rounded-lg border border-[#cbdad5] px-3 text-sm"
                      onChange={(event) =>
                        setPublicationDraft((current) => ({
                          ...current,
                          publicStatus: event.target.value,
                        }))
                      }
                      value={publicationDraft.publicStatus}
                    >
                      <option value="completed">Đã hoàn tất đánh giá</option>
                      <option value="pass">Đạt</option>
                      <option value="consider">Cân nhắc</option>
                      <option value="fail">Không đạt</option>
                    </select>
                  </label>
                  <label>
                    <span className="mb-1 block text-xs font-bold text-[#49665f]">
                      Link hết hạn
                    </span>
                    <input
                      className="h-11 w-full rounded-lg border border-[#cbdad5] px-3 text-sm"
                      onChange={(event) =>
                        setPublicationDraft((current) => ({
                          ...current,
                          expiresAt: event.target.value,
                        }))
                      }
                      type="date"
                      value={publicationDraft.expiresAt}
                    />
                  </label>
                  {[
                    ["summary", "Tóm tắt công bố"],
                    ["strengths", "Điểm mạnh"],
                    ["development", "Điểm cần phát triển"],
                  ].map(([key, label]) => (
                    <label
                      className={key === "summary" ? "md:col-span-2" : ""}
                      key={key}
                    >
                      <span className="mb-1 block text-xs font-bold text-[#49665f]">
                        {label}
                      </span>
                      <textarea
                        className="min-h-24 w-full rounded-lg border border-[#cbdad5] px-3 py-2 text-sm"
                        onChange={(event) =>
                          setPublicationDraft((current) => ({
                            ...current,
                            [key]: event.target.value,
                          }))
                        }
                        value={text(
                          publicationDraft[key as keyof PublicationDraft],
                        )}
                      />
                    </label>
                  ))}
                </div>
                <label className="mt-3 flex items-center gap-2 rounded-lg border border-[#d8e2df] bg-[#f9fbfa] p-3 text-sm font-bold text-[#36564e]">
                  <input
                    checked={publicationDraft.showScore}
                    onChange={(event) =>
                      setPublicationDraft((current) => ({
                        ...current,
                        showScore: event.target.checked,
                      }))
                    }
                    type="checkbox"
                  />
                  Cho phép hiển thị điểm tổng hợp trên link công khai
                </label>
                {report.publication ? (
                  <div className="mt-4 rounded-lg border border-[#a8d9c8] bg-[#e8f8f1] p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <CheckCircle2 className="text-[#0c6e4c]" size={18} />
                      <strong className="text-sm text-[#0c6e4c]">
                        {report.publication.status === "published"
                          ? "Link đang hoạt động"
                          : "Link đã bị thu hồi"}
                      </strong>
                    </div>
                    <div className="mt-2 break-all text-xs text-[#36564e]">
                      {publicLink}
                    </div>
                  </div>
                ) : null}
                <div className="mt-4 flex flex-wrap justify-end gap-2">
                  {report.publication?.status === "published" ? (
                    <>
                      <Button onClick={() => void copyLink()} variant="secondary">
                        <Clipboard size={16} />
                        Sao chép link
                      </Button>
                      <Button onClick={() => void revoke()} variant="secondary">
                        <ShieldOff size={16} />
                        Thu hồi
                      </Button>
                    </>
                  ) : null}
                  <Button onClick={() => void publish()}>
                    <Send size={17} />
                    {report.publication ? "Cập nhật công bố" : "Công bố kết quả"}
                  </Button>
                </div>
              </section>

              <section className="print:hidden rounded-xl border border-[#d2dfdb] bg-white p-5 shadow-sm">
                <div className="flex items-center gap-2 font-black text-[#114c41]">
                  <FileClock size={19} />
                  Dòng thời gian
                </div>
                <div className="mt-4 space-y-3">
                  {report.timeline.map((event) => (
                    <div
                      className="grid gap-1 border-l-2 border-[#d8e2df] pl-4 text-sm"
                      key={event.id}
                    >
                      <strong className="text-[#203a34]">{event.title}</strong>
                      <span className="text-xs text-[#6d817b]">
                        {formatDate(event.createdAt)} ·{" "}
                        {event.actorName || "Hệ thống"}
                      </span>
                      {event.detail ? (
                        <span className="text-xs text-[#49665f]">
                          {event.detail}
                        </span>
                      ) : null}
                    </div>
                  ))}
                </div>
              </section>
            </>
          ) : (
            <div className="grid min-h-96 place-items-center rounded-xl border border-dashed border-[#cbdad5] bg-white p-8 text-center">
              <div>
                <Trophy className="mx-auto text-[#9bb0aa]" size={48} />
                <h2 className="mt-3 font-black text-[#114c41]">
                  Chọn ứng viên để xem báo cáo
                </h2>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
