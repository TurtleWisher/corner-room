import { describe, expect, it } from "vitest";

import type { GiftRecipient } from "@/features/gifts/api";

import { actionable, countsLine, emailsLine, isLater, movesFor, reviewKind, trackedSince, waitingKindLabel, waitingLine, worksLine, type GiftTransitions } from "./gifts-view";

describe("gift campaign words (owner, 2026-10-28)", () => {
  it("sums up the gifts, leaving out statuses with none", () => {
    const zero = { YET_TO_SEND: 0, PREPARED: 0, DISPATCHED: 0, RECEIVED: 0, RETURNED: 0, MISSING: 0, TOTAL: 0, SCHEDULED: 0 };
    expect(countsLine(zero)).toBe("No one has earned this gift yet");
    expect(countsLine({ ...zero, YET_TO_SEND: 3, PREPARED: 4, RECEIVED: 5, TOTAL: 12 })).toBe("12 gifts: 3 not prepared, 4 prepared, 5 received");
    expect(countsLine({ ...zero, MISSING: 1, TOTAL: 1 })).toBe("1 gift: 1 missing");
  });

  it("names the music it covers", () => {
    expect(worksLine([])).toBe("No music chosen");
    expect(worksLine([{ title: "Chaya Pore" }])).toBe("Chaya Pore");
    expect(worksLine([{ title: "Chaya Pore" }, { title: "Haiku" }, { title: "X" }])).toBe("Chaya Pore and 2 more");
  });

  it("tells a new campaign from a change", () => {
    expect(reviewKind({ status: "IN_REVIEW", pending: null })).toBe("new");
    expect(reviewKind({ status: "ACTIVE", pending: { title: "New" } })).toBe("change");
    expect(reviewKind({ status: "ACTIVE", pending: null })).toBeNull();
  });

  it("tells staff how many people the artist added wait for approval", () => {
    const zero = { YET_TO_SEND: 0, PREPARED: 0, DISPATCHED: 0, RECEIVED: 0, RETURNED: 0, MISSING: 0, TOTAL: 0, SCHEDULED: 0 };
    expect(waitingLine({ counts: zero })).toBeNull();
    expect(waitingLine({ counts: { ...zero, WAITING: 1 } })).toBe("1 person added by the artist waits for approval");
    expect(waitingLine({ counts: { ...zero, WAITING: 3 } })).toBe("3 people added by the artist wait for approval");
  });

  it("tells staff when the artist's gift emails wait for approval (D-CAMPAIGN-05)", () => {
    const zero = { YET_TO_SEND: 0, PREPARED: 0, DISPATCHED: 0, RECEIVED: 0, RETURNED: 0, MISSING: 0, TOTAL: 0, SCHEDULED: 0 };
    expect(emailsLine({ emails_waiting: 0 })).toBeNull();
    expect(emailsLine({ emails_waiting: 1 })).toBe("1 gift email written by the artist waits for approval");
    expect(emailsLine({ emails_waiting: 2 })).toBe("2 gift emails written by the artist wait for approval");
    expect(waitingKindLabel({ counts: zero, emails_waiting: 2 })).toBe("Emails waiting");
    expect(waitingKindLabel({ counts: { ...zero, WAITING: 1 }, emails_waiting: 0 })).toBe("People waiting");
    expect(waitingKindLabel({ counts: { ...zero, WAITING: 1 }, emails_waiting: 1 })).toBe("People and emails waiting");
    // Emails to buyers the artist picked wait too (D-CAMPAIGN-07).
    expect(emailsLine({ emails_waiting: 0, sends_waiting: 1 })).toBe("1 email to buyers the artist picked waits for approval");
    expect(emailsLine({ emails_waiting: 1, sends_waiting: 2 })).toBe(
      "1 gift email written by the artist waits for approval; 2 emails to buyers the artist picked wait for approval",
    );
    expect(waitingKindLabel({ counts: zero, emails_waiting: 0, sends_waiting: 1 })).toBe("Emails waiting");
  });
});

describe("tracking moves (D-CAMPAIGN-03)", () => {
  const t: GiftTransitions = {
    YET_TO_SEND: ["PREPARED"],
    PREPARED: ["YET_TO_SEND", "DISPATCHED"],
    DISPATCHED: ["RECEIVED", "RETURNED", "MISSING"],
    RETURNED: ["PREPARED"],
    MISSING: ["RECEIVED", "PREPARED"],
    RECEIVED: [],
  };
  const r = (id: string, status: GiftRecipient["status"]): GiftRecipient => ({ id, status, has_account: true });
  const all = [r("a", "YET_TO_SEND"), r("b", "PREPARED"), r("c", "DISPATCHED"), r("d", "RECEIVED"), r("e", "MISSING")];

  it("applies a move only to the chosen gifts that can make it, by the API's list", () => {
    const chosen = new Set(["a", "b", "c", "d"]);
    expect(actionable(all, chosen, "PREPARED", t)).toEqual(["a"]);
    expect(actionable(all, chosen, "DISPATCHED", t)).toEqual(["b"]);
    expect(actionable(all, chosen, "RECEIVED", t)).toEqual(["c"]);
    expect(actionable(all, new Set(), "PREPARED", t)).toEqual([]);
  });

  it("offers the moves the chosen gifts allow, in tracking order", () => {
    expect(movesFor(all, new Set(["a", "e"]), t).map((m) => [m.to, m.ids])).toEqual([
      ["PREPARED", ["a", "e"]],
      ["RECEIVED", ["e"]],
    ]);
    expect(movesFor(all, new Set(["d"]), t)).toEqual([]);
  });

  it("checks a dispatch time is still to come", () => {
    expect(isLater("2026-11-07T10:30:00+06:00", new Date("2026-11-01T00:00:00Z"))).toBe(true);
    expect(isLater("2026-11-07T10:30:00+06:00", new Date("2026-12-01T00:00:00Z"))).toBe(false);
    expect(isLater(null, new Date())).toBe(false);
  });

  it("shows the date that matters for each status", () => {
    expect(trackedSince({ ...r("x", "PREPARED"), prepared_at: "2026-11-06T10:00:00Z" })).toEqual({ label: "Prepared", at: "2026-11-06T10:00:00Z" });
    expect(trackedSince({ ...r("x", "PREPARED"), prepared_at: "2026-11-06T10:00:00Z", dispatch_at: "2026-11-08T09:00:00Z" })?.label).toBe("Leaves");
    expect(trackedSince({ ...r("x", "DISPATCHED"), dispatched_at: "2026-11-07T09:00:00Z" })?.label).toBe("Left");
    expect(trackedSince({ ...r("x", "RETURNED"), outcome_at: "2026-11-09T09:00:00Z" })?.label).toBe("Returned");
    expect(trackedSince(r("x", "YET_TO_SEND"))).toBeNull();
  });
});
