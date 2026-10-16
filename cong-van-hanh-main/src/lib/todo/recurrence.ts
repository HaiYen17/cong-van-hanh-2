export type TodoRepeatMode = "daily" | "monthly" | "weekly";
export type TodoRepeatCalendar = "lunar" | "solar";

export type TodoRepeatSchedule = {
  calendar: TodoRepeatCalendar;
  enabled: boolean;
  endDate: string;
  mode: TodoRepeatMode;
  monthDays: number[];
  startDate: string;
  times: string[];
  type: "recurrence";
  weekdays: number[];
};

export type VietnameseLunarDate = {
  day: number;
  leap: boolean;
  month: number;
  year: number;
};

function recordOf(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function normalized(value: unknown) {
  return text(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase();
}

function dateKey(value: unknown) {
  const candidate = text(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(candidate) ? candidate : "";
}

function numberList(value: unknown, min: number, max: number) {
  const source = Array.isArray(value)
    ? value
    : text(value)
        .split(/[\s,;|]+/)
        .filter(Boolean);
  return [...new Set(
    source
      .map((item) => Number(item))
      .filter((item) => Number.isInteger(item) && item >= min && item <= max),
  )].sort((left, right) => left - right);
}

function timeList(value: unknown) {
  const source = Array.isArray(value)
    ? value
    : text(value)
        .split(/[\s,;|]+/)
        .filter(Boolean);
  return [...new Set(
    source
      .map((item) => text(item))
      .filter((item) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(item)),
  )].sort();
}

function modeOf(value: unknown): TodoRepeatMode | null {
  const valueKey = normalized(value);
  if (["daily", "day"].includes(valueKey) || valueKey.includes("hang ngay")) {
    return "daily";
  }
  if (["weekly", "week"].includes(valueKey) || valueKey.includes("hang tuan")) {
    return "weekly";
  }
  if (["monthly", "month"].includes(valueKey) || valueKey.includes("hang thang")) {
    return "monthly";
  }
  return null;
}

function calendarOf(value: unknown): TodoRepeatCalendar {
  const valueKey = normalized(value);
  return valueKey === "lunar" || valueKey === "am" || valueKey.includes("am lich")
    ? "lunar"
    : "solar";
}

function dateFromKey(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

function keyFromParts(year: number, month: number, day: number) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function bangkokDateKey(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Bangkok",
    year: "numeric",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function addTodoDays(value: string, amount: number) {
  const date = dateFromKey(value);
  date.setUTCDate(date.getUTCDate() + amount);
  return keyFromParts(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

export function todoDaysBetween(from: string, to: string) {
  if (!dateKey(from) || !dateKey(to)) return 0;
  return Math.round((dateFromKey(to).getTime() - dateFromKey(from).getTime()) / 86_400_000);
}

export function todoIsoWeekday(value: string) {
  const day = dateFromKey(value).getUTCDay();
  return day === 0 ? 7 : day;
}

function lunarInt(value: number) {
  return Math.floor(value);
}

function lunarJdFromDate(day: number, month: number, year: number) {
  const a = lunarInt((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  let jd =
    day +
    lunarInt((153 * m + 2) / 5) +
    365 * y +
    lunarInt(y / 4) -
    lunarInt(y / 100) +
    lunarInt(y / 400) -
    32045;
  if (jd < 2299161) {
    jd =
      day +
      lunarInt((153 * m + 2) / 5) +
      365 * y +
      lunarInt(y / 4) -
      32083;
  }
  return jd;
}

function lunarNewMoon(k: number) {
  const t = k / 1236.85;
  const t2 = t * t;
  const t3 = t2 * t;
  const dr = Math.PI / 180;
  let jd1 =
    2415020.75933 +
    29.53058868 * k +
    0.0001178 * t2 -
    0.000000155 * t3;
  jd1 += 0.00033 * Math.sin((166.56 + 132.87 * t - 0.009173 * t2) * dr);
  const m = 359.2242 + 29.10535608 * k - 0.0000333 * t2 - 0.00000347 * t3;
  const mpr = 306.0253 + 385.81691806 * k + 0.0107306 * t2 + 0.00001236 * t3;
  const f = 21.2964 + 390.67050646 * k - 0.0016528 * t2 - 0.00000239 * t3;
  let c1 =
    (0.1734 - 0.000393 * t) * Math.sin(m * dr) +
    0.0021 * Math.sin(2 * dr * m);
  c1 -= 0.4068 * Math.sin(mpr * dr) + 0.0161 * Math.sin(2 * dr * mpr);
  c1 -= 0.0004 * Math.sin(3 * dr * mpr);
  c1 += 0.0104 * Math.sin(2 * dr * f) - 0.0051 * Math.sin((m + mpr) * dr);
  c1 -= 0.0074 * Math.sin((m - mpr) * dr) + 0.0004 * Math.sin((2 * f + m) * dr);
  c1 -= 0.0004 * Math.sin((2 * f - m) * dr) - 0.0006 * Math.sin((2 * f + mpr) * dr);
  c1 += 0.001 * Math.sin((2 * f - mpr) * dr) + 0.0005 * Math.sin((2 * mpr + m) * dr);
  const deltaT =
    t < -11
      ? 0.001 + 0.000839 * t + 0.0002261 * t2 - 0.00000845 * t3 - 0.000000081 * t * t3
      : -0.000278 + 0.000265 * t + 0.000262 * t2;
  return jd1 + c1 - deltaT;
}

function lunarSunLongitude(jdn: number) {
  const t = (jdn - 2451545) / 36525;
  const t2 = t * t;
  const dr = Math.PI / 180;
  const m = 357.5291 + 35999.0503 * t - 0.0001559 * t2 - 0.00000048 * t * t2;
  const l0 = 280.46645 + 36000.76983 * t + 0.0003032 * t2;
  let dl = (1.9146 - 0.004817 * t - 0.000014 * t2) * Math.sin(dr * m);
  dl +=
    (0.019993 - 0.000101 * t) * Math.sin(2 * dr * m) +
    0.00029 * Math.sin(3 * dr * m);
  const longitude = (l0 + dl) * dr;
  return longitude - Math.PI * 2 * lunarInt(longitude / (Math.PI * 2));
}

function lunarNewMoonDay(k: number, timeZoneOffset = 7) {
  return lunarInt(lunarNewMoon(k) + 0.5 + timeZoneOffset / 24);
}

function lunarSunLongitudeSegment(dayNumber: number, timeZoneOffset = 7) {
  return lunarInt(lunarSunLongitude(dayNumber - 0.5 - timeZoneOffset / 24) / Math.PI * 6);
}

function lunarMonth11(year: number, timeZoneOffset = 7) {
  const off = lunarJdFromDate(31, 12, year) - 2415021;
  const k = lunarInt(off / 29.530588853);
  let newMoon = lunarNewMoonDay(k, timeZoneOffset);
  if (lunarSunLongitudeSegment(newMoon, timeZoneOffset) >= 9) {
    newMoon = lunarNewMoonDay(k - 1, timeZoneOffset);
  }
  return newMoon;
}

function lunarLeapMonthOffset(a11: number, timeZoneOffset = 7) {
  const k = lunarInt((a11 - 2415021.076998695) / 29.530588853 + 0.5);
  let last = 0;
  let index = 1;
  let arc = lunarSunLongitudeSegment(lunarNewMoonDay(k + index, timeZoneOffset), timeZoneOffset);
  do {
    last = arc;
    index += 1;
    arc = lunarSunLongitudeSegment(lunarNewMoonDay(k + index, timeZoneOffset), timeZoneOffset);
  } while (arc !== last && index < 14);
  return index - 1;
}

export function solarToVietnameseLunar(value: string | Date): VietnameseLunarDate {
  const solarKey = typeof value === "string" ? dateKey(value) : bangkokDateKey(value);
  if (!solarKey) throw new Error("Ngày dương lịch không hợp lệ.");
  const [year, month, day] = solarKey.split("-").map(Number);
  const timeZoneOffset = 7;
  const dayNumber = lunarJdFromDate(day, month, year);
  const k = lunarInt((dayNumber - 2415021.076998695) / 29.530588853);
  let monthStart = lunarNewMoonDay(k + 1, timeZoneOffset);
  if (monthStart > dayNumber) monthStart = lunarNewMoonDay(k, timeZoneOffset);
  let a11 = lunarMonth11(year, timeZoneOffset);
  let b11 = a11;
  let lunarYear: number;
  if (a11 >= monthStart) {
    lunarYear = year;
    a11 = lunarMonth11(year - 1, timeZoneOffset);
  } else {
    lunarYear = year + 1;
    b11 = lunarMonth11(year + 1, timeZoneOffset);
  }
  const lunarDay = dayNumber - monthStart + 1;
  const diff = lunarInt((monthStart - a11) / 29);
  let lunarLeap = false;
  let lunarMonth = diff + 11;
  if (b11 - a11 > 365) {
    const leapMonthDiff = lunarLeapMonthOffset(a11, timeZoneOffset);
    if (diff >= leapMonthDiff) {
      lunarMonth = diff + 10;
      if (diff === leapMonthDiff) lunarLeap = true;
    }
  }
  if (lunarMonth > 12) lunarMonth -= 12;
  if (lunarMonth >= 11 && diff < 4) lunarYear -= 1;
  return { day: lunarDay, leap: lunarLeap, month: lunarMonth, year: lunarYear };
}

export function normalizeTodoRepeatSchedule(
  value: unknown,
  fallbackAnchorDate = bangkokDateKey(),
): TodoRepeatSchedule | null {
  const source = recordOf(value);
  const mode = modeOf(source.mode || source.frequency || source.type);
  if (!mode) return null;
  const calendar = calendarOf(source.calendar || source.calendarType);
  const startDate = dateKey(source.startDate || source.startAt) || fallbackAnchorDate;
  const endDate = dateKey(source.endDate || source.endAt);
  const anchorWeekday = todoIsoWeekday(startDate);
  const anchorSolarDay = Number(startDate.slice(8, 10));
  const anchorLunarDay = solarToVietnameseLunar(startDate).day;
  const weekdays = numberList(source.weekdays || source.daysOfWeek, 1, 7);
  const monthDays = numberList(
    source.monthDays || source.daysOfMonth || source.lunarDays,
    1,
    calendar === "lunar" ? 30 : 31,
  );
  return {
    calendar,
    enabled: source.enabled !== false,
    endDate,
    mode,
    monthDays:
      mode === "monthly"
        ? monthDays.length
          ? monthDays
          : [calendar === "lunar" ? anchorLunarDay : anchorSolarDay]
        : [],
    startDate,
    times: timeList(source.times || source.reminderTimes).length
      ? timeList(source.times || source.reminderTimes)
      : ["08:00"],
    type: "recurrence",
    weekdays:
      mode === "weekly"
        ? weekdays.length
          ? weekdays
          : [anchorWeekday]
        : mode === "daily"
          ? weekdays
          : [],
  };
}

export function isTodoRepeatDueOnDate(schedule: TodoRepeatSchedule, value: string) {
  const candidate = dateKey(value);
  if (!candidate || !schedule.enabled) return false;
  if (schedule.startDate && candidate < schedule.startDate) return false;
  if (schedule.endDate && candidate > schedule.endDate) return false;
  if (schedule.mode === "daily") {
    return !schedule.weekdays.length || schedule.weekdays.includes(todoIsoWeekday(candidate));
  }
  if (schedule.mode === "weekly") {
    return schedule.weekdays.includes(todoIsoWeekday(candidate));
  }
  const candidateDay =
    schedule.calendar === "lunar"
      ? solarToVietnameseLunar(candidate).day
      : Number(candidate.slice(8, 10));
  return schedule.monthDays.includes(candidateDay);
}

export function formatTodoRepeatSchedule(schedule: TodoRepeatSchedule | null) {
  if (!schedule) return "";
  const weekdayLabels = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];
  const times = schedule.times.join(", ");
  if (schedule.mode === "daily") {
    const days = schedule.weekdays.length
      ? schedule.weekdays.map((day) => weekdayLabels[day - 1]).filter(Boolean).join(", ")
      : "mỗi ngày";
    return ["Hằng ngày", days, times].filter(Boolean).join(" · ");
  }
  if (schedule.mode === "weekly") {
    const days = schedule.weekdays.map((day) => weekdayLabels[day - 1]).filter(Boolean).join(", ");
    return ["Hằng tuần", days, times].filter(Boolean).join(" · ");
  }
  return [
    "Hằng tháng",
    schedule.calendar === "lunar" ? "Âm lịch" : "Dương lịch",
    `ngày ${schedule.monthDays.join(", ")}`,
    times,
  ]
    .filter(Boolean)
    .join(" · ");
}

function isoWeekNumber(value: string) {
  const date = dateFromKey(value);
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1, 12));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

export function todoRecurringOccurrenceTitle(
  title: string,
  schedule: TodoRepeatSchedule,
  occurrenceDate: string,
) {
  const cleanTitle = text(title)
    .replace(/^(?:\d{1,2}\/\d{2,4}|Tuần\s+\d{1,2})\s*:\s*/i, "")
    .trim();
  if (schedule.mode === "monthly") {
    return `${occurrenceDate.slice(5, 7)}/${occurrenceDate.slice(2, 4)}: ${cleanTitle}`;
  }
  if (schedule.mode === "weekly") {
    return `Tuần ${String(isoWeekNumber(occurrenceDate)).padStart(2, "0")}: ${cleanTitle}`;
  }
  return cleanTitle;
}
