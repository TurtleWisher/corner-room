import { describe, expect, it } from "vitest";

import type { EventRecord } from "@/lib/api";
import { groupByMonth, ticketState, whatsOnOrder } from "@/lib/events-view";

const ev = (id: string, starts_at: string | null, status = "TICKETING_OPEN"): EventRecord => ({
  id,
  venue_id: null,
  title: id,
  description: null,
  status,
  timezone: "Asia/Dhaka",
  starts_at,
  ends_at: null,
});

describe("whatsOnOrder", () => {
  it("puts live first, then upcoming soonest, then the rest", () => {
    const now = new Date("2026-10-11T00:00:00Z");
    const order = whatsOnOrder(
      [ev("later", "2026-12-01T00:00:00Z"), ev("tbc", null), ev("live", "2026-10-10T00:00:00Z", "LIVE"), ev("soon", "2026-10-20T00:00:00Z")],
      now,
    );
    expect(order.map((e) => e.id)).toEqual(["live", "soon", "later", "tbc"]);
  });
});

describe("groupByMonth", () => {
  it("groups in the event's own zone and labels undated events", () => {
    // 31 Oct 20:00 UTC is 1 Nov 02:00 in Dhaka
    const groups = groupByMonth([ev("a", "2026-10-20T10:00:00Z"), ev("b", "2026-10-31T20:00:00Z"), ev("c", null)]);
    expect(groups.map((g) => [g.label, g.events.map((e) => e.id)])).toEqual([
      ["October 2026", ["a"]],
      ["November 2026", ["b"]],
      ["Date to be announced", ["c"]],
    ]);
  });
});

describe("ticketState", () => {
  it("sells only when both the event and the type are on sale", () => {
    expect(ticketState({ status: "TICKETING_OPEN" }, { status: "ON_SALE", remaining: 5 })).toEqual({ kind: "buy" });
    expect(ticketState({ status: "PUBLISHED" }, { status: "ON_SALE", remaining: 5 })).toEqual({ kind: "unavailable", label: "Not on sale yet" });
    expect(ticketState({ status: "CANCELLED" }, { status: "ON_SALE", remaining: 5 }).kind).toBe("unavailable");
  });
  it("says sold out when nothing is left, without showing counts", () => {
    expect(ticketState({ status: "TICKETING_OPEN" }, { status: "ON_SALE", remaining: 0 })).toEqual({ kind: "sold_out" });
    expect(ticketState({ status: "TICKETING_OPEN" }, { status: "SOLD_OUT", remaining: 3 })).toEqual({ kind: "sold_out" });
  });
});
