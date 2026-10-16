import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE_NAME } from "@/lib/auth/constants";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // Endpoint cron là public (tự bảo vệ bằng CRON_SECRET), không gate qua session.
  if (
    pathname.startsWith("/api/cron") ||
    pathname === "/api/pdf-worker" ||
    pathname === "/api/meetings/recall/webhook"
  ) {
    return NextResponse.next();
  }
  // API app kho xác thực bằng API key/access token riêng, không có cookie phiên web.
  if (
    pathname.startsWith("/api/mobile/auth") ||
    pathname.startsWith("/api/mobile/rfid-app") ||
    pathname.startsWith("/api/warehouse/catalog") ||
    pathname.startsWith("/api/warehouse/openapi") ||
    pathname.startsWith("/api/warehouse/rfid")
  ) {
    return NextResponse.next();
  }
  // Link kết quả ứng viên dùng token riêng và phải mở được ngoài phiên nội bộ.
  if (pathname.startsWith("/ket-qua-ung-vien/")) {
    return NextResponse.next();
  }

  const isLoginRoute = pathname === "/login";
  const hasSessionCookie = request.cookies.has(SESSION_COOKIE_NAME);

  if (!hasSessionCookie && !isLoginRoute) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (hasSessionCookie && isLoginRoute) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
