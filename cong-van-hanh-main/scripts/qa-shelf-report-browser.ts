import "dotenv/config";

import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { createRequire } from "node:module";

import { buildAppSessionForUserId } from "../src/lib/auth/session-runtime";
import { SESSION_COOKIE_NAME } from "../src/lib/auth/constants";
import { getDb } from "../src/lib/db";

const baseUrl = (
  process.argv.find((argument) => argument.startsWith("--base-url="))
    ?.slice("--base-url=".length) || "https://thuanvietgroup.biz.vn"
).replace(/\/$/, "");
const playwrightPath =
  "C:/Users/minht/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright";
const browserExecutable = "C:/Program Files/Google/Chrome/Application/chrome.exe";
type BrowserLocator = { click(): Promise<void>; waitFor(): Promise<void> };
type BrowserPage = {
  getByRole(role: string, options: { name: string }): BrowserLocator;
  getByText(text: string): BrowserLocator;
  goto(url: string, options: { timeout: number; waitUntil: string }): Promise<{ status(): number } | null>;
  on(event: "pageerror", listener: (error: Error) => void): void;
};
type BrowserContext = {
  addCookies(cookies: Array<Record<string, unknown>>): Promise<void>;
  close(): Promise<void>;
  newPage(): Promise<BrowserPage>;
};
type Browser = { close(): Promise<void>; newContext(): Promise<BrowserContext> };
const { chromium } = createRequire(import.meta.url)(playwrightPath) as {
  chromium: {
    launch(options: { executablePath: string; headless: boolean }): Promise<Browser>;
  };
};

async function main() {
  const db = getDb();
  const user = await db.user.findFirst({
    select: { id: true },
    where: {
      activationStatus: "APPROVED",
      status: "ACTIVE",
      userRoles: { some: { role: { key: "super-admin", status: "ACTIVE" } } },
    },
  });
  assert(user, "Không tìm thấy tài khoản full quyền cho browser smoke test.");
  const session = await buildAppSessionForUserId(user.id);
  assert(session?.fullAccess, "Phiên browser QA phải có fullAccess.");
  assert(process.env.AUTH_SESSION_SECRET, "Thiếu AUTH_SESSION_SECRET.");
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHmac("sha256", process.env.AUTH_SESSION_SECRET)
    .update(token)
    .digest("hex");
  await db.authSession.create({
    data: {
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      tokenHash,
      userAgent: "shelf-report-browser-qa",
      userId: user.id,
    },
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  try {
    browser = await chromium.launch({ executablePath: browserExecutable, headless: true });
    const context = await browser.newContext();
    await context.addCookies([{
      httpOnly: true,
      name: SESSION_COOKIE_NAME,
      sameSite: "Lax",
      secure: true,
      url: baseUrl,
      value: token,
    }]);
    const page = await context.newPage();
    const browserErrors: string[] = [];
    page.on("pageerror", (error: Error) => browserErrors.push(error.message));
    const response = await page.goto(`${baseUrl}/kho-van/kiem-ke`, {
      waitUntil: "networkidle",
      timeout: 60000,
    });
    assert.equal(response?.status(), 200, "Trang Kiểm kê Kho không trả HTTP 200.");
    await page.getByRole("tab", { name: "Kiểm kê Kệ/Xe" }).click();
    await page.getByRole("button", { name: "Ghép phiên" }).waitFor();
    await page.getByText("Đã chọn 0 phiên Kệ/Xe").waitFor();
    await page.getByRole("tab", { name: "Báo cáo đã ghép" }).click();
    await page.getByText("So sánh 2 kiểm kê Kệ/Xe").waitFor();
    await page.getByRole("button", { name: "⇄ So sánh" }).waitFor();
    assert.equal(browserErrors.length, 0, `Lỗi trình duyệt: ${browserErrors.join(" | ")}`);
    console.log("Browser QA: ghép phiên, danh sách báo cáo và bộ chọn so sánh Kệ/Xe hydrate đúng.");
    await context.close();
  } finally {
    await browser?.close();
    await db.authSession.updateMany({
      data: { revokedAt: new Date() },
      where: { revokedAt: null, tokenHash },
    });
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Browser smoke test failed.");
  process.exitCode = 1;
});
