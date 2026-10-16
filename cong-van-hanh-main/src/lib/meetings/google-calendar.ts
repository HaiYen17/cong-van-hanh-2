import "server-only";

import { createHash } from "node:crypto";

import { GoogleAuth } from "google-auth-library";

import { getDb } from "@/lib/db";
import { getMeetingRuntimeConfig } from "@/lib/meetings/config";

const CALENDAR_EVENTS_SCOPE = "https://www.googleapis.com/auth/calendar.events";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const IAM_SIGN_JWT_BASE_URL =
  "https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/";

const googleAuth = new GoogleAuth({
  scopes: ["https://www.googleapis.com/auth/cloud-platform"],
});

let cachedToken:
  | { expiresAt: number; subject: string; token: string }
  | undefined;

async function delegatedCalendarToken(subject: string) {
  if (
    cachedToken &&
    cachedToken.subject === subject &&
    cachedToken.expiresAt > Date.now() + 60_000
  ) {
    return cachedToken.token;
  }
  const serviceAccountEmail =
    process.env.MODULE_MAIL_SERVICE_ACCOUNT_EMAIL ||
    "thuan-viet-mail-router@tvg-ops-dev.iam.gserviceaccount.com";
  const now = Math.floor(Date.now() / 1000);
  const client = await googleAuth.getClient();
  const signed = await client.request<{ signedJwt?: string }>({
    data: {
      payload: JSON.stringify({
        aud: GOOGLE_TOKEN_URL,
        exp: now + 3600,
        iat: now,
        iss: serviceAccountEmail,
        scope: CALENDAR_EVENTS_SCOPE,
        sub: subject,
      }),
    },
    method: "POST",
    url: `${IAM_SIGN_JWT_BASE_URL}${encodeURIComponent(serviceAccountEmail)}:signJwt`,
  });
  if (!signed.data.signedJwt) {
    throw new Error("Không thể ký JWT để truy cập Google Calendar.");
  }
  const response = await fetch(GOOGLE_TOKEN_URL, {
    body: new URLSearchParams({
      assertion: signed.data.signedJwt,
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    }),
    headers: { "content-type": "application/x-www-form-urlencoded" },
    method: "POST",
    signal: AbortSignal.timeout(20_000),
  });
  const payload = (await response.json()) as {
    access_token?: string;
    error_description?: string;
    expires_in?: number;
  };
  if (!response.ok || !payload.access_token) {
    throw new Error(
      payload.error_description ||
        `Không lấy được quyền Google Calendar (HTTP ${response.status}).`,
    );
  }
  cachedToken = {
    expiresAt: Date.now() + Math.max(60, payload.expires_in || 3600) * 1000,
    subject,
    token: payload.access_token,
  };
  return payload.access_token;
}

function calendarError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "Lỗi không xác định");
  return message.slice(0, 2_000);
}

export async function checkGoogleCalendarAccess() {
  const config = await getMeetingRuntimeConfig();
  try {
    const token = await delegatedCalendarToken(config.googleOrganizerEmail);
    const response = await fetch(
      `${CALENDAR_API}/calendars/primary/events?maxResults=1&singleEvents=true&timeMin=${encodeURIComponent(new Date().toISOString())}`,
      {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(20_000),
      },
    );
    const payload = (await response.json()) as {
      error?: { message?: string };
      items?: unknown[];
      summary?: string;
    };
    if (!response.ok) {
      throw new Error(
        payload.error?.message ||
          `Google Calendar trả lỗi ${response.status}.`,
      );
    }
    return {
      calendarSummary: payload.summary || config.googleOrganizerEmail,
      ok: true as const,
    };
  } catch (error) {
    return { error: calendarError(error), ok: false as const };
  }
}

export async function syncMeetingToGoogleCalendar(meetingId: string) {
  const db = getDb();
  const [meeting, config] = await Promise.all([
    db.meeting.findUnique({
      include: { attendees: true, organizer: true, room: true },
      where: { id: meetingId },
    }),
    getMeetingRuntimeConfig(),
  ]);
  if (!meeting) return { error: "Không tìm thấy cuộc họp.", ok: false as const };
  if (meeting.googleCalendarEventId) {
    return {
      eventId: meeting.googleCalendarEventId,
      meetUrl: meeting.googleMeetUrl || "",
      ok: true as const,
    };
  }

  try {
    const token = await delegatedCalendarToken(config.googleOrganizerEmail);
    const deterministicEventId = createHash("sha256")
      .update(`thuan-viet-meeting:${meeting.id}`)
      .digest("hex")
      .slice(0, 40);
    const attendees = meeting.attendees
      .filter((attendee) => attendee.email !== config.googleOrganizerEmail)
      .map((attendee) => ({
        displayName: attendee.displayName,
        email: attendee.email,
      }));
    if (
      meeting.room?.googleCalendarId &&
      !attendees.some((attendee) => attendee.email === meeting.room?.googleCalendarId)
    ) {
      attendees.push({
        displayName: meeting.room.name,
        email: meeting.room.googleCalendarId,
      });
    }
    const response = await fetch(
      `${CALENDAR_API}/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all`,
      {
        body: JSON.stringify({
          attendees,
          conferenceData: {
            createRequest: {
              conferenceSolutionKey: { type: "hangoutsMeet" },
              requestId: `meeting-${meeting.id}`,
            },
          },
          description: [
            `Mã cuộc họp: ${meeting.code}`,
            `Người đặt: ${meeting.organizer.displayName}`,
            "",
            meeting.agenda,
          ].join("\n"),
          end: {
            dateTime: meeting.endsAt.toISOString(),
            timeZone: meeting.timezone,
          },
          extendedProperties: {
            private: {
              meetingId: meeting.id,
              source: "thuan-viet-v3",
            },
          },
          id: deterministicEventId,
          location: meeting.locationText || meeting.room?.name || undefined,
          start: {
            dateTime: meeting.startsAt.toISOString(),
            timeZone: meeting.timezone,
          },
          summary: meeting.title,
        }),
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
        signal: AbortSignal.timeout(30_000),
      },
    );
    let result = (await response.json()) as {
      conferenceData?: {
        conferenceId?: string;
        entryPoints?: { entryPointType?: string; uri?: string }[];
      };
      error?: { message?: string };
      hangoutLink?: string;
      htmlLink?: string;
      id?: string;
    };
    let eventReady = response.ok;
    if (response.status === 409) {
      const existingResponse = await fetch(
        `${CALENDAR_API}/calendars/primary/events/${deterministicEventId}`,
        {
          headers: { authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(20_000),
        },
      );
      result = (await existingResponse.json()) as typeof result;
      if (!existingResponse.ok) {
        throw new Error(
          result.error?.message ||
            `Không đọc được lịch Google đã tạo (HTTP ${existingResponse.status}).`,
        );
      }
      eventReady = true;
    }
    if (!eventReady || !result.id) {
      throw new Error(
        result.error?.message ||
          `Google Calendar từ chối tạo lịch (HTTP ${response.status}).`,
      );
    }
    const meetUrl =
      result.hangoutLink ||
      result.conferenceData?.entryPoints?.find(
        (entry) => entry.entryPointType === "video",
      )?.uri ||
      "";
    await db.meeting.update({
      data: {
        calendarError: null,
        calendarLastSyncedAt: new Date(),
        calendarSyncStatus: "SYNCED",
        googleCalendarEventId: result.id,
        googleCalendarHtmlLink: result.htmlLink || null,
        googleMeetCode: result.conferenceData?.conferenceId || null,
        googleMeetUrl: meetUrl || null,
      },
      where: { id: meeting.id },
    });
    return { eventId: result.id, meetUrl, ok: true as const };
  } catch (error) {
    const message = calendarError(error);
    await db.meeting.update({
      data: { calendarError: message, calendarSyncStatus: "FAILED" },
      where: { id: meeting.id },
    });
    return { error: message, ok: false as const };
  }
}

export async function cancelGoogleCalendarMeeting(meetingId: string) {
  const db = getDb();
  const [meeting, config] = await Promise.all([
    db.meeting.findUnique({ where: { id: meetingId } }),
    getMeetingRuntimeConfig(),
  ]);
  if (!meeting?.googleCalendarEventId) return { ok: true as const };
  try {
    const token = await delegatedCalendarToken(config.googleOrganizerEmail);
    const response = await fetch(
      `${CALENDAR_API}/calendars/primary/events/${encodeURIComponent(meeting.googleCalendarEventId)}?sendUpdates=all`,
      {
        headers: { authorization: `Bearer ${token}` },
        method: "DELETE",
        signal: AbortSignal.timeout(20_000),
      },
    );
    if (!response.ok && response.status !== 404 && response.status !== 410) {
      const result = (await response.json()) as { error?: { message?: string } };
      throw new Error(result.error?.message || `Google Calendar trả lỗi ${response.status}.`);
    }
    await db.meeting.update({
      data: {
        calendarError: null,
        calendarLastSyncedAt: new Date(),
        calendarSyncStatus: "SYNCED",
      },
      where: { id: meeting.id },
    });
    return { ok: true as const };
  } catch (error) {
    const message = calendarError(error);
    await db.meeting.update({
      data: { calendarError: message, calendarSyncStatus: "FAILED" },
      where: { id: meeting.id },
    });
    return { error: message, ok: false as const };
  }
}
