import { getDb } from "@/lib/db";
import {
  compareMotivationBulletins,
  filterMotivationRecords,
  motivationStringArray,
  type MotivationAudience,
} from "@/lib/motivation-policy";

export type MotivationOption = {
  label: string;
  symbol: string;
  tone?: string;
  value: string;
};

export type MotivationItem = {
  autoDismissMs: number | null;
  body: string | null;
  bypassSnooze: boolean;
  closePolicy: string;
  displayChannel: string;
  displayMode: string;
  endAt: string | null;
  eventId: string;
  imageUrls: string[];
  imageUrl: string | null;
  kind: string;
  level: string;
  location: string | null;
  myReaction: string | null;
  options: MotivationOption[];
  popupContentMode: string;
  priority: number;
  reminderTimes: string[];
  requireAck: boolean;
  startAt: string | null;
  targetUrl: string | null;
  thumbnailUrl: string | null;
  title: string;
};

export type MotivationStage = {
  messages: MotivationItem[];
  notifications: MotivationItem[];
};

/** Thông điệp (random) + bản tin đang hiệu lực và đúng đối tượng người xem. */
export async function getActiveMotivations(
  identityUserId: string | string[],
): Promise<MotivationStage> {
  const db = getDb();
  const now = new Date();
  const userIds = [
    ...new Set(
      (Array.isArray(identityUserId) ? identityUserId : [identityUserId])
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];

  const [events, users] = await Promise.all([
    db.motivationEvent.findMany({
      include: {
        reactionSet: true,
        reactions: { take: 1, where: { userId: { in: userIds } } },
      },
      orderBy: [{ priority: "desc" }, { updatedAt: "desc" }],
      take: 150,
      where: {
        AND: [
          { OR: [{ startAt: null }, { startAt: { lte: now } }] },
          { OR: [{ endAt: null }, { endAt: { gte: now } }] },
        ],
        archivedAt: null,
        status: "ACTIVE",
      },
    }),
    db.user.findMany({
      include: {
        employee: {
          include: { company: true },
        },
      },
      where: { id: { in: userIds } },
    }),
  ]);

  const audiences: MotivationAudience[] = users.map((user) => ({
    companyTokens: user.employee?.company
      ? [
          user.employee.company.id,
          user.employee.company.code,
          user.employee.company.shortName ?? "",
          user.employee.company.legalName,
        ].filter(Boolean)
      : [],
    department: user.employee?.department ?? null,
    employeeCode: user.employee?.employeeCode ?? null,
    employeeId: user.employeeId ?? null,
    email: user.email ?? null,
    userId: user.id,
    username: user.username ?? null,
  }));
  const visibleEvents = events.filter((event) =>
    audiences.some(
      (audience) => filterMotivationRecords([event], audience, now).length > 0,
    ),
  );

  const toItem = (event: (typeof visibleEvents)[number]): MotivationItem => {
    const rawOptions = event.reactionSet?.options;
    const options: MotivationOption[] = Array.isArray(rawOptions)
      ? (rawOptions as unknown as MotivationOption[])
      : [];
    const imageUrls = motivationStringArray(event.imageUrls);
    return {
      autoDismissMs: event.autoDismissMs,
      body: event.body,
      bypassSnooze: event.bypassSnooze,
      closePolicy: event.closePolicy,
      displayChannel: event.displayChannel,
      displayMode: event.displayMode,
      endAt: event.endAt?.toISOString() ?? null,
      eventId: event.id,
      imageUrls:
        imageUrls.length > 0
          ? imageUrls
          : event.imageUrl
            ? [event.imageUrl]
            : [],
      imageUrl: event.imageUrl,
      kind: event.kind,
      level: event.level,
      location: event.location,
      myReaction: event.reactions[0]?.value ?? null,
      options,
      popupContentMode: event.popupContentMode,
      priority: event.priority,
      reminderTimes: motivationStringArray(event.reminderTimes),
      requireAck: event.requireAck,
      startAt: event.startAt?.toISOString() ?? null,
      targetUrl: event.targetUrl,
      thumbnailUrl: event.thumbnailUrl,
      title: event.title,
    };
  };

  // Bản V2 chỉ phát thông điệp trên WebApp; bản tin vẫn hiện trong rail để tra cứu.
  const messages = visibleEvents
    .filter(
      (event) =>
        event.kind === "message" &&
        ["webapp", "both"].includes(event.displayChannel),
    )
    .map(toItem);
  const notifications = visibleEvents
    .filter((event) => event.kind !== "message")
    .sort(compareMotivationBulletins)
    .slice(0, 12)
    .map(toItem);

  // Random thứ tự thông điệp ở server để client không lệch hydrate.
  for (let index = messages.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [messages[index], messages[randomIndex]] = [
      messages[randomIndex],
      messages[index],
    ];
  }

  return { messages, notifications };
}
