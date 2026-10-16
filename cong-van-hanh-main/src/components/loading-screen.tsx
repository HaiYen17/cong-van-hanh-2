import Image from "next/image";

// Màn loading thương hiệu dùng chung khi chuyển vùng/module (Suspense fallback).
export function LoadingScreen({ message = "Đang tải..." }: { message?: string }) {
  return (
    <div className="grid min-h-dvh place-items-center px-4">
      <div className="flex flex-col items-center gap-5 rounded-3xl border border-border bg-surface px-12 py-10 shadow-[0_30px_80px_rgba(17,45,39,0.16)]">
        <Image
          alt="Thuần Việt"
          className="h-auto w-36 animate-pulse"
          height={144}
          priority
          src="/login-logo.png"
          width={144}
        />
        <span className="size-7 animate-spin rounded-full border-[3px] border-accent border-t-transparent" />
        <div className="text-sm font-semibold text-primary">{message}</div>
      </div>
    </div>
  );
}
