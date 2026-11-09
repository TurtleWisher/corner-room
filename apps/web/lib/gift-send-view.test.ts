import { describe, expect, it } from "vitest";

import type { GiftMailSend } from "@/features/gifts/api";

import { guessPurpose, needsYou, reach, sendButtonLabel, sendPromise, sendStatusLine, sentLine } from "./gift-send-view";

const send = (over: Partial<GiftMailSend>): GiftMailSend => ({
  id: "s1",
  purpose: "DISPATCHED",
  subject: "Hi",
  body: "Hi",
  button_label: null,
  button_url: null,
  file_ids: [],
  recipient_ids: ["a", "b"],
  state: "IN_REVIEW",
  review_note: null,
  submitted_at: null,
  approved_at: null,
  sent_at: null,
  sent_count: 0,
  skipped_count: 0,
  can_review: false,
  ...over,
});

describe("gift sends", () => {
  it("guesses the purpose from the people picked", () => {
    expect(guessPurpose(["DISPATCHED", "DISPATCHED"])).toBe("DISPATCHED");
    expect(guessPurpose(["MISSING"])).toBe("MISSING");
    expect(guessPurpose(["DISPATCHED", "RETURNED"])).toBe("OTHER");
    expect(guessPurpose(["PREPARED"])).toBe("OTHER");
    expect(guessPurpose([])).toBe("OTHER");
  });

  it("says who a purpose reaches and who it skips", () => {
    const people = [
      { id: "a", status: "DISPATCHED" as const, reachable: true },
      { id: "b", status: "PREPARED" as const, reachable: true },
      { id: "c", status: "DISPATCHED" as const, reachable: false },
    ];
    expect(reach("DISPATCHED", people).gets.map((p) => p.id)).toEqual(["a"]);
    expect(reach("DISPATCHED", people).skipped.map((p) => p.id)).toEqual(["b", "c"]);
    expect(reach("OTHER", people).gets.map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("names the button by what it really does", () => {
    expect(sendButtonLabel(false, 3)).toBe("Send for approval (3 buyers)");
    expect(sendButtonLabel(true, 1)).toBe("Send now to 1 buyer");
    expect(sendPromise(false)).toMatch(/Nobody is emailed until it's approved and you press Send/);
    expect(sentLine(false, null, null)).toMatch(/press Send/);
    expect(sentLine(true, 2, 1)).toBe("Emailed 2 buyers. 1 skipped: their gift moved on or they have no email.");
  });

  it("describes each request's state", () => {
    expect(sendStatusLine(send({}))).toMatch(/nobody has been emailed/);
    expect(sendStatusLine(send({ state: "RETURNED", review_note: "Name the courier" }))).toBe("Corner Room asked for a change: Name the courier");
    expect(sendStatusLine(send({ state: "APPROVED" }))).toMatch(/press Send/);
    expect(sendStatusLine(send({ state: "SENT", sent_count: 1, skipped_count: 1 }))).toBe("Emailed 1 of 2 people, 1 skipped.");
    expect(needsYou([send({ state: "APPROVED" }), send({ state: "RETURNED" }), send({})])).toEqual({ ready: 1, fix: 1, waiting: 1 });
  });
});
