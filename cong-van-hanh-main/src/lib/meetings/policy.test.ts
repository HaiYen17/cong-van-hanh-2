import assert from "node:assert/strict";
import test from "node:test";

import {
  blockedRange,
  overlaps,
  validateMeetingWindow,
  weekBounds,
} from "./policy";

test("meeting ranges use half-open overlap semantics", () => {
  const first = {
    startsAt: new Date("2026-08-03T02:00:00.000Z"),
    endsAt: new Date("2026-08-03T03:00:00.000Z"),
  };
  assert.equal(
    overlaps(first, {
      startsAt: new Date("2026-08-03T03:00:00.000Z"),
      endsAt: new Date("2026-08-03T04:00:00.000Z"),
    }),
    false,
  );
  assert.equal(
    overlaps(first, {
      startsAt: new Date("2026-08-03T02:59:59.000Z"),
      endsAt: new Date("2026-08-03T04:00:00.000Z"),
    }),
    true,
  );
});

test("blocked range includes room buffers", () => {
  assert.deepEqual(
    blockedRange({
      bufferAfterMinutes: 15,
      bufferBeforeMinutes: 10,
      startsAt: new Date("2026-08-03T02:00:00.000Z"),
      endsAt: new Date("2026-08-03T03:00:00.000Z"),
    }),
    {
      startsAt: new Date("2026-08-03T01:50:00.000Z"),
      endsAt: new Date("2026-08-03T03:15:00.000Z"),
    },
  );
});

test("meeting duration follows room maximum", () => {
  assert.equal(
    validateMeetingWindow({
      startsAt: new Date("2026-08-03T02:00:00.000Z"),
      endsAt: new Date("2026-08-03T03:00:00.000Z"),
      maxBookingMinutes: 120,
    }),
    60,
  );
  assert.throws(
    () =>
      validateMeetingWindow({
        startsAt: new Date("2026-08-03T02:00:00.000Z"),
        endsAt: new Date("2026-08-03T05:00:00.000Z"),
        maxBookingMinutes: 120,
      }),
    /tối đa 120 phút/,
  );
});

test("week starts Monday in GMT+7", () => {
  const range = weekBounds(new Date("2026-08-04T05:00:00.000Z"));
  assert.equal(range.startsAt.toISOString(), "2026-08-02T17:00:00.000Z");
  assert.equal(range.endsAt.toISOString(), "2026-08-09T17:00:00.000Z");
});
