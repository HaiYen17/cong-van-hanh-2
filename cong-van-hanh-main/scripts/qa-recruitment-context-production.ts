import "dotenv/config";

import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";

import { SESSION_COOKIE_NAME } from "../src/lib/auth/constants";
import { getDb } from "../src/lib/db";

const BASE_URL = process.env.QA_BASE_URL || "https://thuanvietgroup.biz.vn";

async function callRpc(token: string, method: string, payload: object) {
  const response = await fetch(`${BASE_URL}/api/recruitment/rpc`, {
    body: JSON.stringify({ method, payload }),
    headers: {
      "content-type": "application/json",
      cookie: `${SESSION_COOKIE_NAME}=${token}`,
      "user-agent": "recruitment-context-production-qa",
    },
    method: "POST",
  });
  const body = (await response.json()) as {
    message?: string;
    ok?: boolean;
    result?: unknown;
  };
  return { body, status: response.status };
}

async function main() {
  const db = getDb();
  const assignments = await db.recruitmentAssignment.findMany({
    select: { id: true, reviewerEmployeeId: true },
    take: 2000,
    where: {
      interview: { status: { not: "cancelled" } },
      reviewerEmployeeId: { not: null },
      status: { notIn: ["cancelled", "legacy_grouped"] },
    },
  });
  const assignedEmployeeIds = [
    ...new Set(assignments.map((row) => row.reviewerEmployeeId).filter(Boolean)),
  ] as string[];
  const employees = await db.employee.findMany({
    include: { user: { include: { userRoles: { include: { role: true } } } } },
    where: { id: { in: assignedEmployeeIds }, user: { isNot: null } },
  });
  const target = employees.find((employee) => {
    const roles = employee.user?.userRoles.map(({ role }) => role.key) || [];
    return (
      employee.user?.status === "ACTIVE" &&
      !roles.some((role) =>
        ["admin", "super-admin", "admin-tuyen-dung"].includes(role),
      )
    );
  });
  assert(target?.user, "Không tìm thấy thành viên Hội đồng thường để QA production.");

  const secret = process.env.AUTH_SESSION_SECRET;
  assert(secret, "Thiếu AUTH_SESSION_SECRET để tạo phiên QA tạm.");
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHmac("sha256", secret).update(token).digest("hex");
  await db.authSession.create({
    data: {
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      tokenHash,
      userAgent: "recruitment-context-production-qa",
      userId: target.user.id,
    },
  });

  try {
    const queueResponse = await callRpc(token, "getAssessmentQueue", {
      limit: 100,
    });
    assert.equal(queueResponse.status, 200, "Không tải được hàng đợi Hội đồng.");
    assert.equal(queueResponse.body.ok, true, queueResponse.body.message);
    const queue = queueResponse.body.result as {
      entries: Array<{ reviewerEmployeeId: string }>;
    };
    const reviewerIds = new Set([target.id, target.employeeCode, target.user.id]);
    const foreignEntries = queue.entries.filter(
      (entry) => !reviewerIds.has(entry.reviewerEmployeeId),
    );
    const foreignAssignment = assignments.find(
      (assignment) =>
        assignment.reviewerEmployeeId &&
        !reviewerIds.has(assignment.reviewerEmployeeId),
    );
    assert(foreignAssignment, "Không có phiếu người khác để thử chặn quyền.");
    const forbiddenResponse = await callRpc(token, "openAssessment", {
      assignmentId: foreignAssignment.id,
    });
    const pageResponse = await fetch(`${BASE_URL}/tuyen-dung/danh-gia`, {
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${token}`,
        "user-agent": "recruitment-context-production-qa",
      },
      redirect: "manual",
    });
    const authorizationLetterResponse = await fetch(
      `${BASE_URL}/thuc-thi/cap-giay`,
      {
        headers: {
          cookie: `${SESSION_COOKIE_NAME}=${token}`,
          "user-agent": "recruitment-context-production-qa",
        },
        redirect: "manual",
      },
    );
    const documentSealResponse = await fetch(`${BASE_URL}/thuc-thi/dong-dau`, {
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${token}`,
        "user-agent": "recruitment-context-production-qa",
      },
      redirect: "manual",
    });
    const ok =
      pageResponse.status === 200 &&
      authorizationLetterResponse.status === 200 &&
      documentSealResponse.status === 200 &&
      queue.entries.length > 0 &&
      foreignEntries.length === 0 &&
      forbiddenResponse.status === 403 &&
      forbiddenResponse.body.ok === false;
    console.log(
      JSON.stringify(
        {
          foreignEntries: foreignEntries.length,
          foreignOpenStatus: forbiddenResponse.status,
          modulePageStatus: pageResponse.status,
          standardEmployeePageStatus: {
            authorizationLetter: authorizationLetterResponse.status,
            documentSeal: documentSealResponse.status,
          },
          ok,
          ownQueueEntries: queue.entries.length,
          target: {
            employeeCode: target.employeeCode,
            fullName: target.fullName,
          },
        },
        null,
        2,
      ),
    );
    if (!ok) process.exitCode = 1;
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
