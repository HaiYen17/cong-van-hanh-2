import "dotenv/config";

import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { SESSION_COOKIE_NAME } from "../src/lib/auth/constants";
import { buildAppSessionForUserId } from "../src/lib/auth/session-runtime";
import { getDb } from "../src/lib/db";

const baseUrl = (process.argv.find((value) => value.startsWith("--base-url="))?.slice(11) || "https://thuanvietgroup.biz.vn").replace(/\/$/, "");
const destination = new URL(baseUrl);
assert(destination.protocol === "https:" && (
  destination.hostname === "thuanvietgroup.biz.vn" ||
  destination.hostname === "cong-van-hanh-web-fe6q7l75dq-as.a.run.app" ||
  destination.hostname.endsWith("---cong-van-hanh-web-fe6q7l75dq-as.a.run.app")
), "Chỉ kiểm tra domain đã xác minh của Cloud Run hiện tại.");

const routes = ["/cau-hinh", "/cau-hinh/hunonic", "/nguoi-thuan-viet/dieu-khien-may-lanh", "/kho-van/cau-hinh", "/kho-van/kiem-ke", "/danh-gia", "/cau-hinh/danh-gia", "/tuyen-dung/ung-vien", "/tuyen-dung/danh-gia", "/tuyen-dung/ket-qua"];

async function main() {
  const db = getDb();
  const users = await db.user.findMany({
    select: { id: true },
    where: { status: "ACTIVE", activationStatus: "APPROVED", userRoles: { some: { role: { key: "super-admin", status: "ACTIVE" } } } },
  });
  let userId = "";
  for (const user of users) {
    if ((await buildAppSessionForUserId(user.id))?.fullAccess) { userId = user.id; break; }
  }
  assert(userId, "Không tìm được tài khoản full quyền đang hoạt động.");
  assert(process.env.AUTH_SESSION_SECRET, "Thiếu secret phiên QA.");
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHmac("sha256", process.env.AUTH_SESSION_SECRET).update(token).digest("hex");
  await db.authSession.create({ data: { userId, tokenHash, expiresAt: new Date(Date.now() + 15 * 60_000), userAgent: "evaluation-release-readonly-qa" } });
  const headers = { cookie: `${SESSION_COOKIE_NAME}=${token}`, "user-agent": "evaluation-release-readonly-qa" };
  const checks: Record<string, unknown> = { baseUrl };
  try {
    const get = async (route: string) => {
      const response = await fetch(`${baseUrl}${route}`, { headers, redirect: "manual", signal: AbortSignal.timeout(90_000) });
      assert.equal(response.status, 200, `${route.split("?")[0]} trả HTTP ${response.status}`);
      return response;
    };
    const services = await (await get("/")).text();
    assert(!services.includes("NEXT_REDIRECT"), "Phiên QA chưa được server xác thực (streamed redirect); kiểm tra secret và database đích.");
    const baseline = JSON.parse(await readFile(path.join(process.cwd(), "docs/deploy-module-baseline.json"), "utf8")) as Array<{ key: string }>;
    for (const entry of baseline) assert(services.includes(`data-key="${entry.key}"`), `Services thiếu card ${entry.key}`);
    checks.servicesCards = baseline.length;
    checks.routes = [];
    for (const route of routes) {
      const html = await (await get(route)).text();
      assert(!html.includes("NEXT_REDIRECT"), `Route chuyển hướng trong stream: ${route}`);
      assert(!/Không có quyền truy cập|chưa được cấp quyền mở module|Application error: a server-side exception/.test(html), `Route bị chặn hoặc lỗi: ${route}`);
      if (route === "/cau-hinh") assert(html.includes("Hunonic"), "Cấu hình thiếu tab Hunonic");
      (checks.routes as string[]).push(route);
    }
    const hash = (buffer: Uint8Array) => createHash("sha256").update(buffer).digest("hex");
    for (const file of ["evaluation-config.html", "evaluation.html"]) {
      const remote = new Uint8Array(await (await get(`/legacy/${file}`)).arrayBuffer());
      const local = await readFile(path.join(process.cwd(), "public/legacy", file));
      assert.equal(hash(remote), hash(local), `Production không khớp code mới: ${file}`);
    }
    checks.evaluationAssetsMatch = true;
    const configResponse = await fetch(`${baseUrl}/api/evaluation/rpc`, {
      method: "POST", headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ method: "getEvaluationConfigData", payload: {} }), signal: AbortSignal.timeout(90_000),
    });
    assert.equal(configResponse.status, 200, "RPC cấu hình lỗi");
    assert.equal((await configResponse.json()).ok, true, "RPC cấu hình trả lỗi");
    checks.evaluationConfigRpc = true;
    const instance = await db.evaluationRecord.findFirst({
      select: { id: true }, where: { recordType: "evaluation-instance", status: { in: ["finalized", "completed"] } }, orderBy: { updatedAt: "desc" },
    });
    if (instance) {
      const pdf = Buffer.from(await (await get(`/api/evaluation/result-pdf?instanceId=${encodeURIComponent(instance.id)}`)).arrayBuffer());
      assert.equal(pdf.subarray(0, 5).toString("ascii"), "%PDF-", "Endpoint kết quả không trả PDF");
      checks.resultPdfBytes = pdf.length;
    } else checks.resultPdf = "Chưa có phiếu hoàn tất để kiểm tra";
    if (process.argv.includes("--browser")) {
      assert(process.env.EVALUATION_QA_PLAYWRIGHT_MODULE, "Cần đường dẫn thư viện Playwright kiểm thử.");
      const { chromium } = await import(pathToFileURL(process.env.EVALUATION_QA_PLAYWRIGHT_MODULE).href);
      const browser = await chromium.launch({ channel: "chrome", headless: true });
      try {
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
        await context.addCookies([{ name: SESSION_COOKIE_NAME, value: token, url: baseUrl, httpOnly: true, secure: true, sameSite: "Lax" }]);
        const blockedRequests: string[] = [];
        // Block business mutations, background POSTs and email actions in visual QA.
        await context.route("**/*", async (route: { request: () => { method: () => string; url: () => string; postDataJSON: () => { method?: string } }; abort: () => Promise<void>; continue: () => Promise<void>; fulfill: (response: { status: number; contentType: string; body: string }) => Promise<void> }) => {
          const request = route.request();
          if (request.method() === "POST" && new URL(request.url()).pathname === "/api/presence") {
            // Exercise the real read endpoint without marking the QA account online.
            const response = await fetch(`${baseUrl}/api/presence`, { headers, signal: AbortSignal.timeout(30_000) });
            return route.fulfill({ status: response.status, contentType: "application/json", body: await response.text() });
          }
          if (!["GET", "HEAD"].includes(request.method())) {
            const readMethods = ["getEvaluationConfigData", "getEvaluationAdminWorkspaceData", "getEvaluationAssignedInstances", "getEvaluationInstanceDetail"];
            if (!request.url().endsWith("/api/evaluation/rpc") || !readMethods.includes(request.postDataJSON()?.method || "")) {
              blockedRequests.push(`${request.method()} ${new URL(request.url()).pathname}`);
              return route.abort();
            }
          }
          return route.continue();
        });
        const page = await context.newPage();
        const pageErrors: string[] = [];
        page.on("pageerror", (error: Error) => pageErrors.push(error.stack || error.message));
        const directory = path.join(process.cwd(), "tmp/evaluation-release-qa");
        await mkdir(directory, { recursive: true });
        await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 90_000 });
        assert.equal(await page.locator(".feature-card[data-key]").count(), baseline.length, "Browser Services thiếu card");
        await page.screenshot({ path: path.join(directory, "services.png"), fullPage: true });
        await page.goto(`${baseUrl}/cau-hinh/danh-gia`, { waitUntil: "networkidle", timeout: 90_000 });
        // The legacy modal is fixed-position, so its body can have zero height.
        await page.frameLocator("iframe").locator("#evaluationConfigModal").waitFor({ state: "visible" });
        await page.screenshot({ path: path.join(directory, "evaluation-config-desktop.png"), fullPage: true });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.screenshot({ path: path.join(directory, "evaluation-config-mobile.png"), fullPage: true });
        if (pageErrors.length) console.log(JSON.stringify({ blockedRequests, pageErrors }, null, 2));
        assert.deepEqual(pageErrors, [], "Giao diện phát sinh lỗi JavaScript");
        checks.browser = "Services + Cấu hình đánh giá desktop/mobile";
      } finally { await browser.close(); }
    }
    console.log(JSON.stringify({ ok: true, ...checks }, null, 2));
  } finally {
    await db.authSession.updateMany({ where: { tokenHash, revokedAt: null }, data: { revokedAt: new Date() } });
    console.log("Đã thu hồi phiên QA tạm.");
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
