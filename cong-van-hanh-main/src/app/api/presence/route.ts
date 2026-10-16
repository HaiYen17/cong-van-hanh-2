import { getCurrentSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";

const PRESENCE_PREFIX = "portal.presence.";
const ONLINE_WINDOW_MS = 5 * 60 * 1000;

type StoredPresence = {
  company?: string;
  department?: string;
  displayName?: string;
  employeeCode?: string;
  title?: string;
  userId?: string;
};

function parsePresence(value: string | null): StoredPresence {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as StoredPresence)
      : {};
  } catch {
    return {};
  }
}

async function onlineUsers() {
  const cutoff = new Date(Date.now() - ONLINE_WINDOW_MS);
  const rows = await getDb().systemSetting.findMany({
    orderBy: { updatedAt: "desc" },
    select: { key: true, updatedAt: true, value: true },
    where: {
      key: { startsWith: PRESENCE_PREFIX },
      updatedAt: { gte: cutoff },
    },
  });

  return rows.map((row) => {
    const stored = parsePresence(row.value);
    return {
      company: stored.company || "",
      department: stored.department || "",
      displayName: stored.displayName || "Nhân sự Thuần Việt",
      employeeCode: stored.employeeCode || "",
      lastSeenAt: row.updatedAt.toISOString(),
      title: stored.title || "",
      userId: stored.userId || row.key.slice(PRESENCE_PREFIX.length),
    };
  });
}

export async function GET() {
  const session = await getCurrentSession();
  if (!session) {
    return Response.json({ message: "Phiên đăng nhập đã hết hạn." }, { status: 401 });
  }

  return Response.json(
    { online: await onlineUsers(), serverTime: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST() {
  const session = await getCurrentSession();
  if (!session) {
    return Response.json({ message: "Phiên đăng nhập đã hết hạn." }, { status: 401 });
  }

  const db = getDb();
  const user = await db.user.findUnique({
    select: {
      displayName: true,
      employee: {
        select: {
          company: { select: { legalName: true, shortName: true } },
          department: true,
          employeeCode: true,
          title: true,
        },
      },
    },
    where: { id: session.userId },
  });
  const presence: StoredPresence = {
    company:
      user?.employee?.company?.shortName ||
      user?.employee?.company?.legalName ||
      "",
    department: user?.employee?.department || "",
    displayName: user?.displayName || session.displayName,
    employeeCode: user?.employee?.employeeCode || "",
    title: user?.employee?.title || "",
    userId: session.userId,
  };

  await db.systemSetting.upsert({
    create: {
      key: `${PRESENCE_PREFIX}${session.userId}`,
      updatedById: session.userId,
      value: JSON.stringify(presence),
    },
    update: {
      updatedById: session.userId,
      value: JSON.stringify(presence),
    },
    where: { key: `${PRESENCE_PREFIX}${session.userId}` },
  });

  return Response.json(
    { online: await onlineUsers(), serverTime: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
