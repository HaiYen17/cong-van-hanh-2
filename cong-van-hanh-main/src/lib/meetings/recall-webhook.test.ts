import { createHmac } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";

import {
  recallBotStatusForEvent,
  verifyRecallWebhook,
} from "./recall-webhook";
import { recallRecordingDownload } from "./recall";

function signedRequest(payload: string, timestamp = Math.floor(Date.now() / 1000)) {
  const id = "msg_meeting_test";
  const key = Buffer.from("meeting-webhook-test-key");
  const secret = `whsec_${key.toString("base64")}`;
  const signature = createHmac("sha256", key)
    .update(`${id}.${timestamp}.${payload}`)
    .digest("base64");
  return {
    headers: new Headers({
      "webhook-id": id,
      "webhook-signature": `v1,${signature}`,
      "webhook-timestamp": String(timestamp),
    }),
    id,
    payload,
    secret,
  };
}

test("Recall webhook accepts a matching HMAC signature", () => {
  const request = signedRequest('{"event":"transcript.done"}');
  assert.equal(verifyRecallWebhook(request).id, request.id);
});

test("Recall webhook rejects modified payloads", () => {
  const request = signedRequest('{"event":"transcript.done"}');
  assert.throws(() =>
    verifyRecallWebhook({ ...request, payload: '{"event":"transcript.failed"}' }),
  );
});

test("Recall webhook rejects stale signatures", () => {
  const request = signedRequest(
    '{"event":"transcript.done"}',
    Math.floor(Date.now() / 1000) - 601,
  );
  assert.throws(() => verifyRecallWebhook(request));
});

test("Recall webhook maps current bot event names", () => {
  assert.equal(recallBotStatusForEvent("bot.joining_call"), "JOINING");
  assert.equal(recallBotStatusForEvent("bot.in_call_recording"), "IN_CALL");
  assert.equal(recallBotStatusForEvent("bot.done"), "COMPLETED");
  assert.equal(recallBotStatusForEvent("bot.fatal"), "FAILED");
});

test("Recall webhook keeps compatibility with the legacy status event", () => {
  assert.equal(
    recallBotStatusForEvent("bot.status_change", "in_waiting_room"),
    "WAITING_ROOM",
  );
});

test("Recall recording prefers the mixed MP3 artifact", () => {
  assert.deepEqual(
    recallRecordingDownload({
      recordings: [
        {
          completed_at: "2026-08-04T08:00:00Z",
          expires_at: "2026-08-11T08:00:00Z",
          media_shortcuts: {
            audio_mixed: {
              data: { download_url: "https://example.test/meeting.mp3" },
              format: "mp3",
            },
          },
          status: { code: "done" },
        },
      ],
    }),
    {
      expiresAt: "2026-08-11T08:00:00Z",
      format: "mp3",
      kind: "audio",
      url: "https://example.test/meeting.mp3",
    },
  );
});

test("Recall recording keeps legacy MP4 playback compatibility", () => {
  assert.equal(
    recallRecordingDownload({
      recordings: [
        {
          media_shortcuts: {
            video_mixed: {
              data: { download_url: "https://example.test/meeting.mp4" },
              format: "mp4",
            },
          },
          status: { code: "done" },
        },
      ],
    })?.kind,
    "legacy-video",
  );
});
