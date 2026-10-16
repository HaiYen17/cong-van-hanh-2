import type { Metadata } from "next";
import { Be_Vietnam_Pro, Montserrat } from "next/font/google";
import { Suspense } from "react";
import "./globals.css";

import { GlobalModuleDock } from "@/components/layout/global-module-dock";
import { ToastProvider } from "@/components/ui/toast";

const beVietnamPro = Be_Vietnam_Pro({
  display: "swap",
  subsets: ["latin", "vietnamese"],
  variable: "--font-be-vietnam-pro",
  weight: ["400", "500", "600", "700", "800"],
});

// Tiêu đề dùng Montserrat — bám bản Hành chính cũ (heading = Montserrat).
const montserrat = Montserrat({
  display: "swap",
  subsets: ["latin", "vietnamese"],
  variable: "--font-montserrat",
  weight: ["600", "700", "800", "900"],
});

export const metadata: Metadata = {
  title: "Cổng Vận hành Nội bộ",
  description: "Hệ thống vận hành nội bộ Thuần Việt.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi" className={`${beVietnamPro.variable} ${montserrat.variable} h-full antialiased`}>
      <body>
        <ToastProvider>
          {children}
          <Suspense fallback={null}>
            <GlobalModuleDock />
          </Suspense>
        </ToastProvider>
      </body>
    </html>
  );
}
