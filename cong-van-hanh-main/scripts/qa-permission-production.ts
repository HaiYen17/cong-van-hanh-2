import "dotenv/config";

import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";

import { SESSION_COOKIE_NAME } from "../src/lib/auth/constants";
import { resolveSessionAccess } from "../src/lib/auth/session-access";
import { getDb } from "../src/lib/db";

const baseUrl = (
  process.argv.find((argument) => argument.startsWith("--base-url="))
    ?.slice("--base-url=".length) || "https://thuanvietgroup.biz.vn"
).replace(/\/$/, "");

const employeeRoutes = [
  "/nguoi-thuan-viet/thong-tin",
  "/nguoi-thuan-viet/review-ho-so",
  "/thuc-thi/dong-dau",
  "/thuc-thi/trich-luc",
  "/thuc-thi/cap-giay",
];

async function main() {
  const db = getDb();
  const user = await db.user.findFirst({
    include: {
      userRoles: {
        include: {
          role: {
            include: {
              roleModuleGroups: {
                include: {
                  moduleGroup: {
                    include: {
                      modules: { where: { isActive: true } },
                    },
                  },
                },
              },
              roleModules: { include: { appModule: true } },
              rolePermissions: { include: { permission: true } },
            },
          },
        },
      },
    },
    where: {
      status: "ACTIVE",
      userRoles: {
        some: { role: { key: "employee", status: "ACTIVE" } },
      },
    },
  });
  assert(user, "Không tìm thấy tài khoản Nhân viên để kiểm tra production.");

  const secret = process.env.AUTH_SESSION_SECRET;
  assert(secret, "Thiếu AUTH_SESSION_SECRET để tạo phiên kiểm tra tạm.");
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHmac("sha256", secret).update(token).digest("hex");
  await db.authSession.create({
    data: {
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      tokenHash,
      userAgent: "permission-production-qa",
      userId: user.id,
    },
  });

  try {
    const session = resolveSessionAccess(
      user.userRoles
        .map(({ role }) => role)
        .filter(({ status }) => status === "ACTIVE"),
    );
    assert(
      session.modules.includes("authorization-letter"),
      "Phiên Nhân viên chưa nhận module authorization-letter từ nhóm legal.",
    );
    assert(
      session.modules.includes("document-seal"),
      "Phiên Nhân viên chưa nhận module document-seal từ nhóm legal.",
    );
    assert(
      session.permissions.includes("my_requests.create"),
      "Phiên Nhân viên chưa có quyền tạo yêu cầu để thao tác trong module.",
    );

    const results = [];
    for (const route of employeeRoutes) {
      const response = await fetch(`${baseUrl}${route}`, {
        headers: {
          cookie: `${SESSION_COOKIE_NAME}=${token}`,
          "user-agent": "permission-production-qa",
        },
        redirect: "manual",
      });
      const html = await response.text();
      const blocked =
        html.includes("Không có quyền truy cập") ||
        html.includes("chưa được cấp quyền mở module") ||
        html.includes("chưa được cấp quyền Cấp giấy") ||
        html.includes("chưa được cấp quyền Đóng dấu");

      results.push({ blocked, route, status: response.status });
      assert.equal(response.status, 200, `${route} trả HTTP ${response.status}.`);
      assert.equal(html.includes("NEXT_REDIRECT"), false, `${route} đang chuyển hướng trong HTML stream, chưa xác thực được phiên QA.`);
      assert.equal(blocked, false, `${route} vẫn hiển thị chặn quyền.`);
    }

    console.log(
      JSON.stringify(
        {
          baseUrl,
          employeeModuleCount: session.modules.length,
          ok: true,
          results,
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

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
