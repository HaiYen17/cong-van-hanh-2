import type { Metadata } from "next";
import Image from "next/image";
import { CheckCircle2, Clock3, ShieldCheck, Star, TrendingUp } from "lucide-react";

import { getPublicCandidateResult } from "@/lib/recruitment/runtime";

export const metadata: Metadata = {
  title: "Kết quả đánh giá ứng viên | Thuận Việt",
  robots: { follow: false, index: false },
};

export default async function PublicCandidateResultPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const result = await getPublicCandidateResult(token);

  if (!result) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f4f7f6] p-6">
        <section className="w-full max-w-lg rounded-2xl border border-[#d5e0dc] bg-white p-8 text-center shadow-[0_20px_60px_rgba(17,76,65,0.1)]">
          <Clock3 className="mx-auto text-[#d86425]" size={46} />
          <h1 className="mt-4 text-2xl font-black text-[#114c41]">
            Link không còn hiệu lực
          </h1>
          <p className="mt-2 text-sm leading-6 text-[#6d817b]">
            Kết quả này đã hết hạn, bị thu hồi hoặc đường dẫn không đúng. Vui
            lòng liên hệ bộ phận Tuyển dụng để được hỗ trợ.
          </p>
        </section>
      </main>
    );
  }

  const { application, publication } = result;
  return (
    <main className="min-h-screen bg-[#f4f7f6] px-4 py-8 sm:px-6 sm:py-12">
      <div className="mx-auto max-w-3xl">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Image
              alt="Thuận Việt"
              className="size-12 rounded-xl object-contain"
              height={48}
              src="/logo.png"
              width={48}
            />
            <div>
              <div className="font-black text-[#114c41]">THUẬN VIỆT</div>
              <div className="text-xs font-bold uppercase tracking-[0.12em] text-[#6d817b]">
                Kết quả đánh giá ứng viên
              </div>
            </div>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-[#a8d9c8] bg-[#e8f8f1] px-3 py-2 text-xs font-black text-[#0c6e4c]">
            <ShieldCheck size={16} />
            Xác thực từ hệ thống
          </div>
        </header>

        <section className="mt-6 overflow-hidden rounded-2xl border border-[#d2dfdb] bg-white shadow-[0_20px_60px_rgba(17,76,65,0.1)]">
          <div className="bg-[#114c41] px-6 py-8 text-white sm:px-9">
            <div className="text-xs font-black uppercase tracking-[0.12em] text-[#f3b37f]">
              Thông báo kết quả
            </div>
            <h1 className="mt-3 text-3xl font-black sm:text-4xl">
              {application.candidateName}
            </h1>
            <p className="mt-2 text-sm text-white/75">
              {application.candidateCode || "Ứng viên"} ·{" "}
              {application.position || "Vị trí tuyển dụng"}
            </p>
          </div>

          <div className="p-6 sm:p-9">
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[#a8d9c8] bg-[#e8f8f1] p-4">
              <CheckCircle2 className="text-[#0c6e4c]" size={24} />
              <div>
                <div className="text-xs font-black uppercase tracking-[0.08em] text-[#0c6e4c]">
                  Trạng thái công bố
                </div>
                <div className="mt-1 font-black text-[#114c41]">
                  {publication.publicStatus === "pass"
                    ? "Đạt"
                    : publication.publicStatus === "consider"
                      ? "Cân nhắc"
                      : publication.publicStatus === "fail"
                        ? "Không đạt"
                        : "Đã hoàn tất đánh giá"}
                </div>
              </div>
              {publication.publishedScore != null ? (
                <div className="ml-auto text-right">
                  <div className="text-xs font-bold text-[#6d817b]">
                    Điểm tổng hợp
                  </div>
                  <div className="text-3xl font-black text-brand">
                    {publication.publishedScore}
                    <span className="text-sm text-[#6d817b]">/10</span>
                  </div>
                </div>
              ) : null}
            </div>

            {publication.summary ? (
              <section className="mt-6">
                <h2 className="text-lg font-black text-[#114c41]">
                  Tóm tắt kết quả
                </h2>
                <p className="mt-2 whitespace-pre-line text-sm leading-7 text-[#49665f]">
                  {publication.summary}
                </p>
              </section>
            ) : null}

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              {publication.strengths ? (
                <section className="rounded-xl border border-[#d8e2df] bg-[#f9fbfa] p-5">
                  <div className="flex items-center gap-2 font-black text-[#114c41]">
                    <Star className="text-brand" size={19} />
                    Điểm mạnh
                  </div>
                  <p className="mt-3 whitespace-pre-line text-sm leading-6 text-[#49665f]">
                    {publication.strengths}
                  </p>
                </section>
              ) : null}
              {publication.development ? (
                <section className="rounded-xl border border-[#d8e2df] bg-[#f9fbfa] p-5">
                  <div className="flex items-center gap-2 font-black text-[#114c41]">
                    <TrendingUp className="text-brand" size={19} />
                    Điểm cần phát triển
                  </div>
                  <p className="mt-3 whitespace-pre-line text-sm leading-6 text-[#49665f]">
                    {publication.development}
                  </p>
                </section>
              ) : null}
            </div>

            <div className="mt-8 border-t border-[#dce5e2] pt-5 text-xs leading-5 text-[#6d817b]">
              Kết quả được phát hành bởi {publication.publishedByName || "Thuận Việt"}
              {publication.publishedAt
                ? ` vào ${new Intl.DateTimeFormat("vi-VN", {
                    dateStyle: "short",
                    timeStyle: "short",
                  }).format(new Date(publication.publishedAt))}`
                : ""}
              . Đường dẫn này chỉ dành cho người được chia sẻ.
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
