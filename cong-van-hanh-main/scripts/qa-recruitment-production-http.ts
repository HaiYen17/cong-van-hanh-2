import "dotenv/config";

import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";

import { SESSION_COOKIE_NAME } from "../src/lib/auth/constants";
import { getDb } from "../src/lib/db";

const BASE_URL =
  process.env.QA_BASE_URL || "https://thuanvietgroup.biz.vn";

async function callRpc(token: string, method: string) {
  const response = await fetch(`${BASE_URL}/api/recruitment/rpc`, {
    body: JSON.stringify({ method, payload: { limit: 40, query: "" } }),
    headers: {
      "content-type": "application/json",
      cookie: `${SESSION_COOKIE_NAME}=${token}`,
    },
    method: "POST",
  });
  const body = (await response.json()) as { message?: string; ok?: boolean };
  if (!response.ok || !body.ok) {
    throw new Error(
      `${method} trả HTTP ${response.status}: ${body.message || "không rõ lỗi"}`,
    );
  }
  return { method, ok: true, status: response.status };
}

async function main() {
  const db = getDb();
  const user = await db.user.findFirst({
    include: { employee: true },
    where: {
      employee: { employeeCode: "2501305" },
      status: "ACTIVE",
      userRoles: { some: { role: { key: "admin-tuyen-dung" } } },
    },
  });
  if (!user) {
    throw new Error("Không tìm thấy tài khoản Admin Tuyển dụng 2501305.");
  }

  const secret = process.env.AUTH_SESSION_SECRET;
  assert(secret, "Thiếu AUTH_SESSION_SECRET để tạo phiên kiểm thử tạm.");
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHmac("sha256", secret).update(token).digest("hex");
  await db.authSession.create({
    data: {
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      ipAddress: "permission-production-qa",
      tokenHash,
      userAgent: "Codex recruitment production smoke test",
      userId: user.id,
    },
  });

  try {
    const checks = [];
    checks.push(await callRpc(token, "getRecruitmentHrWorkspaceBundle"));
    checks.push(await callRpc(token, "getRecruitmentScoringConfig"));
    checks.push(await callRpc(token, "getRecruitmentResultsCenter"));
    console.log(
      JSON.stringify(
        {
          checks,
          employeeCode: user.employee?.employeeCode,
          fullName: user.employee?.fullName,
          ok: true,
          target: BASE_URL,
        },
        null,
        2,
      ),
    );
  } finally {
    await db.authSession.updateMany({
      data: { revokedAt: new Date() },
      where: { revokedAt: null, tokenHash },
    });
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await getDb().$disconnect();
  });
