import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cho phép CI/build kiểm thử dùng thư mục riêng khi OneDrive đang giữ khóa `.next`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Ẩn chỉ báo dev "Rendering…" của Next (xấu, không cần cho người dùng).
  devIndicators: false,
  // Tạo image Cloud Run gọn, chỉ mang theo đúng runtime files Next.js cần.
  output: "standalone",
  outputFileTracingIncludes: {
    "/api/pdf-worker": ["./node_modules/pdfjs-dist/build/pdf.worker.mjs"],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "30mb",
    },
  },
};

export default nextConfig;
