"use server";

import { redirect } from "next/navigation";

import {
  getCurrentSession,
  revokeCurrentSession,
} from "@/lib/auth/session";
import { getDb } from "@/lib/db";

export async function logoutAction() {
  const session = await getCurrentSession();
  if (session) {
    await getDb().systemSetting.deleteMany({
      where: { key: `portal.presence.${session.userId}` },
    });
  }
  await revokeCurrentSession();
  redirect("/login");
}
