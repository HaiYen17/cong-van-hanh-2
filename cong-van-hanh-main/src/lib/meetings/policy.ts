export type BusyRange = {
  endsAt: Date;
  startsAt: Date;
};

const VIETNAM_OFFSET = "+07:00";

export function parseMeetingDateTime(value: string) {
  const normalized = String(value || "").trim();
  if (!normalized) return new Date(Number.NaN);
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized);
  return new Date(hasTimezone ? normalized : `${normalized}${VIETNAM_OFFSET}`);
}

export function vietnamDateTimeLocalValue(value: Date) {
  return new Intl.DateTimeFormat("sv-SE", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
  })
    .format(value)
    .replace(" ", "T");
}

export function overlaps(left: BusyRange, right: BusyRange) {
  return left.startsAt < right.endsAt && left.endsAt > right.startsAt;
}

export function blockedRange({
  bufferAfterMinutes,
  bufferBeforeMinutes,
  endsAt,
  startsAt,
}: BusyRange & {
  bufferAfterMinutes: number;
  bufferBeforeMinutes: number;
}) {
  return {
    endsAt: new Date(endsAt.getTime() + bufferAfterMinutes * 60_000),
    startsAt: new Date(startsAt.getTime() - bufferBeforeMinutes * 60_000),
  };
}

export function validateMeetingWindow({
  endsAt,
  maxBookingMinutes,
  startsAt,
}: BusyRange & { maxBookingMinutes: number }) {
  if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime())) {
    throw new Error("Thời gian họp không hợp lệ.");
  }
  if (endsAt <= startsAt) {
    throw new Error("Giờ kết thúc phải sau giờ bắt đầu.");
  }
  const durationMinutes = (endsAt.getTime() - startsAt.getTime()) / 60_000;
  if (durationMinutes < 15) {
    throw new Error("Cuộc họp cần kéo dài ít nhất 15 phút.");
  }
  if (durationMinutes > maxBookingMinutes) {
    throw new Error(`Phòng chỉ cho phép đặt tối đa ${maxBookingMinutes} phút.`);
  }
  return durationMinutes;
}

export function weekBounds(anchor: Date, timezoneOffsetMinutes = 420) {
  const shifted = new Date(anchor.getTime() + timezoneOffsetMinutes * 60_000);
  const day = shifted.getUTCDay() || 7;
  const monday = new Date(
    Date.UTC(
      shifted.getUTCFullYear(),
      shifted.getUTCMonth(),
      shifted.getUTCDate() - day + 1,
      0,
      0,
      0,
      0,
    ) -
      timezoneOffsetMinutes * 60_000,
  );
  return {
    endsAt: new Date(monday.getTime() + 7 * 24 * 60 * 60 * 1000),
    startsAt: monday,
  };
}
