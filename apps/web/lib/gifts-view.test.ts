import { describe, expect, it } from "vitest";

import type { GiftRecipient } from "@/features/gifts/api";

import { actionable, countsLine, reviewKind, worksLine } from "./gifts-view";

describe("gift campaign words (owner, 2026-10-28)", () => {
  it("sums up the gifts", () => {
    expect(countsLine({ YET_TO_SEND: 0, IN_PROCESS: 0, SENT: 0, TOTAL: 0 })).toBe("No one has earned this gift yet");
    expect(countsLine({ YET_TO_SEND: 4, IN_PROCESS: 3, SENT: 5, TOTAL: 12 })).toBe("12 gifts: 5 sent, 3 in process, 4 yet to send");
    expect(countsLine({ YET_TO_SEND: 1, IN_PROCESS: 0, SENT: 0, TOTAL: 1 })).toBe("1 gift: 0 sent, 0 in process, 1 yet to send");
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
});

describe("actionable", () => {
  const r = (id: string, status: GiftRecipient["status"]): GiftRecipient => ({ id, status, has_account: true });
  const all = [r("a", "YET_TO_SEND"), r("b", "IN_PROCESS"), r("c", "SENT"), r("d", "YET_TO_SEND")];
  it("dispatches only gifts yet to send, and marks sent only those not sent", () => {
    const chosen = new Set(["a", "b", "c"]);
    expect(actionable(all, chosen, "dispatch")).toEqual(["a"]);
    expect(actionable(all, chosen, "sent")).toEqual(["a", "b"]);
    expect(actionable(all, new Set(), "dispatch")).toEqual([]);
  });
});
