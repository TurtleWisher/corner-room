import { describe, expect, it } from "vitest";

import { boxFrom, clicksLine, dayGroup, groupByDay, initials, toLine, whyLine } from "./mailbox-view";

describe("mailbox", () => {
  it("opens the folder in the address, else Sent", () => {
    expect(boxFrom("?box=write")).toBe("write");
    expect(boxFrom("?box=nope")).toBe("sent");
    expect(boxFrom("")).toBe("sent");
  });

  it("says why each person got an email", () => {
    expect(whyLine({ kind: "GIFT_UPDATE", campaign: "Poster", gift_status: "DISPATCHED", picked: false })).toBe("Poster: gift on its way, sent by itself");
    expect(whyLine({ kind: "GIFT_UPDATE", campaign: "Poster", gift_status: "OTHER", picked: true })).toBe("Poster: gift other news, to buyers you picked");
    expect(whyLine({ kind: "MANUAL", mail_subject: "New single" })).toBe('Your email "New single"');
    expect(whyLine({ kind: "GIFT", gift_title: "For friends" })).toBe("Music gift: For friends");
    expect(whyLine({ kind: "THANK_YOU" })).toMatch(/Thank-you/);
    expect(whyLine({ kind: "TEST" })).toMatch(/test/);
  });

  it("names people without addresses", () => {
    expect(initials("Samiul Islam")).toBe("SI");
    expect(initials("রুমি")).toBe("র");
    expect(initials(null)).toBe("?");
    expect(toLine({ kind: "TEST", to_name: null })).toBe("You");
    expect(toLine({ kind: "MANUAL", to_name: " " })).toBe("A buyer with no name on file");
  });

  it("groups by day in Bangladesh time", () => {
    const now = new Date("2026-11-09T10:00:00Z");
    expect(dayGroup("2026-11-09T01:00:00Z", now)).toBe("Today");
    expect(dayGroup("2026-11-08T12:00:00Z", now)).toBe("Yesterday");
    expect(dayGroup("2026-11-05T12:00:00Z", now)).toBe("This week");
    expect(dayGroup("2026-09-05T12:00:00Z", now)).toBe("September 2026");
    const groups = groupByDay([{ queued_at: "2026-11-09T01:00:00Z" }, { queued_at: "2026-11-09T02:00:00Z" }, { queued_at: "2026-11-08T12:00:00Z" }], now);
    expect(groups.map((g) => [g.label, g.items.length])).toEqual([["Today", 2], ["Yesterday", 1]]);
    expect(clicksLine(0)).toBeNull();
    expect(clicksLine(2)).toBe("2 link presses");
  });
});

describe("old Gifts > Emails links", () => {
  it("open the campaign's Emails part or the Mailbox", async () => {
    const { oldEmailsTarget } = await import("./mailbox-view");
    expect(oldEmailsTarget("?view=gifts&campaign=01a1bc71-c5b2-71b1-b459-dc073d65ace2")).toBe("/studio/gifts/01a1bc71-c5b2-71b1-b459-dc073d65ace2#emails");
    expect(oldEmailsTarget("?view=gifts&campaign=../../x")).toBe("/studio/mailbox");
    expect(oldEmailsTarget("?view=report")).toBe("/studio/mailbox?box=report");
    expect(oldEmailsTarget("")).toBe("/studio/mailbox");
  });
});
