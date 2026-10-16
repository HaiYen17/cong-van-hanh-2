"use server";

import { randomInt } from "node:crypto";

import { requireCurrentSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";

const PAIR_CODE_PREFIX = "notifier_pair:";
const PAIR_CODE_TTL_MS = 5 * 60 * 1000;

export type NotifierPairCode = {
  displayPairCode: string;
  expiresAt: string;
  pairCode: string;
};

function formatPairCode(code: string) {
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}

export async function createNotifierPairCodeAction(
  deviceHint = "",
): Promise<NotifierPairCode> {
  const session = await requireCurrentSession();
  const db = getDb();
  const user = await db.user.findUnique({
    select: {
      displayName: true,
      employee: {
        select: {
          employeeCode: true,
          fullName: true,
        },
      },
    },
    where: { id: session.userId },
  });

  if (!user?.employee) {
    throw new Error(
      "Không tìm thấy tài khoản nội bộ để tạo mã ghép máy.",
    );
  }

  await db.systemSetting.deleteMany({
    where: {
      key: { startsWith: PAIR_CODE_PREFIX },
      updatedById: session.userId,
    },
  });

  let pairCode = "";
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const candidate = randomInt(0, 1_000_000).toString().padStart(6, "0");
    const exists = await db.systemSetting.findUnique({
      select: { id: true },
      where: { key: `${PAIR_CODE_PREFIX}${candidate}` },
    });
    if (!exists) {
      pairCode = candidate;
      break;
    }
  }

  if (!pairCode) {
    throw new Error("Chưa tạo được mã ghép máy. Ông thử lại giúp tui nhé.");
  }

  const expiresAt = new Date(Date.now() + PAIR_CODE_TTL_MS);
  await db.systemSetting.create({
    data: {
      key: `${PAIR_CODE_PREFIX}${pairCode}`,
      updatedById: session.userId,
      value: JSON.stringify({
        createdAt: new Date().toISOString(),
        deviceHint: deviceHint.slice(0, 160),
        employeeCode: user.employee.employeeCode,
        employeeName: user.employee.fullName || user.displayName,
        expiresAt: expiresAt.toISOString(),
        pairCode,
        usedAt: "",
        usedByDeviceId: "",
        usedByDeviceName: "",
        userId: session.userId,
      }),
    },
  });

  return {
    displayPairCode: formatPairCode(pairCode),
    expiresAt: expiresAt.toISOString(),
    pairCode,
  };
}
