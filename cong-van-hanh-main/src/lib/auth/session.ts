import { createHmac, randomBytes } from "node:crypto";
import { cache } from "react";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { SESSION_COOKIE_NAME } from "@/lib/auth/constants";
import { buildAppSessionForUserId } from "@/lib/auth/session-runtime";
import type { ResolvedSessionIdentity } from "@/lib/auth/session-identity";
import { getDb } from "@/lib/db";
import { requireServerEnv } from "@/lib/env";

const SESSION_TTL_MS = 1000 * 60 * 60 * 8;

export type AppSession = Pick<ResolvedSessionIdentity, "userId"> &
  Partial<Omit<ResolvedSessionIdentity, "userId">> & {
  displayName: string;
  fullAccess: boolean;
  moduleGroups: string[];
  modules: string[];
  permissions: string[];
  roles: string[];
  };

function hashSessionToken(token: string) {
  return createHmac("sha256", requireServerEnv("AUTH_SESSION_SECRET"))
    .update(token)
    .digest("hex");
}

export async function createTokenAuthSession(
  userId: string,
  metadata: { ipAddress?: string; userAgent?: string } = {},
) {
  const db = getDb();
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashSessionToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await db.authSession.create({
    data: {
      expiresAt,
      ipAddress: metadata.ipAddress,
      tokenHash,
      userAgent: metadata.userAgent,
      userId,
    },
  });

  return { expiresAt, token };
}

export async function createAuthSession(userId: string) {
  const { expiresAt, token } = await createTokenAuthSession(userId);

  const cookieStore = await cookies();

  cookieStore.set({
    expires: expiresAt,
    httpOnly: true,
    name: SESSION_COOKIE_NAME,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    value: token,
  });
}

export async function getAuthSessionFromToken(
  token: string,
): Promise<AppSession | null> {
  if (!token) return null;
  const db = getDb();
  const session = await db.authSession.findUnique({
    select: { expiresAt: true, revokedAt: true, userId: true },
    where: {
      tokenHash: hashSessionToken(token),
    },
  });

  if (
    !session ||
    session.revokedAt ||
    session.expiresAt <= new Date()
  ) {
    return null;
  }
  return buildAppSessionForUserId(session.userId);
}

export const getCurrentSession = cache(
  async (): Promise<AppSession | null> => {
    const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
    return token ? getAuthSessionFromToken(token) : null;
  },
);

export async function revokeTokenAuthSession(token: string) {
  if (!token) return;
  await getDb().authSession.updateMany({
    data: { revokedAt: new Date() },
    where: { revokedAt: null, tokenHash: hashSessionToken(token) },
  });
}

export async function requireCurrentSession() {
  const session = await getCurrentSession();

  if (!session) {
    redirect("/login");
  }

  return session;
}

export async function revokeCurrentSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (token) {
    await revokeTokenAuthSession(token);
  }

  cookieStore.delete(SESSION_COOKIE_NAME);
}
