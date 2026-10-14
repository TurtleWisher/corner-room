import { describe, expect, it } from "vitest";

import type { EventRecord } from "@/lib/api";
import { actsLabel, eventCity, eventEyebrow, fromPrice, groupByMonth, splitPast, ticketState, whatsOnOrder } from "@/lib/events-view";

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

describe("ticket wording for every event state (events.md section 5)", () => {
  const on = { status: "ON_SALE", remaining: 5 };
  it("never says 'not on sale yet' once sales have closed or the night is under way", () => {
    expect(ticketState({ status: "SALES_CLOSED" }, on)).toEqual({ kind: "unavailable", label: "Sales closed" });
    expect(ticketState({ status: "LIVE" }, on)).toEqual({ kind: "unavailable", label: "Happening now" });
    expect(ticketState({ status: "COMPLETED" }, on)).toEqual({ kind: "unavailable", label: "Event ended" });
    expect(ticketState({ status: "POSTPONED" }, on)).toEqual({ kind: "unavailable", label: "Sales paused" });
    expect(ticketState({ status: "CANCELLED" }, on)).toEqual({ kind: "unavailable", label: "Event cancelled" });
  });
});

describe("poster copy", () => {
  it("prints the venue's city when the API names one, else the zone's city", () => {
    expect(eventCity({ timezone: "Asia/Dhaka", venue: { name: "Hall", city: "Chattogram" } })).toBe("Chattogram");
    expect(eventCity({ timezone: "Asia/Dhaka", venue: null })).toBe("Dhaka");
  });

  it("uses city and weekday in the event's zone, never the word Live on its own", () => {
    // 17 Oct 2026 14:00 UTC is Saturday evening in Dhaka.
    expect(eventEyebrow({ timezone: "Asia/Dhaka", starts_at: "2026-10-17T14:00:00Z", venue: null })).toBe("Dhaka · Saturday");
    // 31 Oct 20:00 UTC is already Sunday 1 Nov in Dhaka.
    expect(eventEyebrow({ timezone: "Asia/Dhaka", starts_at: "2026-10-31T20:00:00Z", venue: null })).toBe("Dhaka · Sunday");
    expect(eventEyebrow({ timezone: "UTC", starts_at: null, venue: null })).toBe("Live music");
  });

  it("counts acts in words", () => {
    expect(actsLabel(0)).toBeNull();
    expect(actsLabel(1)).toBe("1 act");
    expect(actsLabel(3)).toBe("3 acts");
  });
});

describe("fromPrice", () => {
  const t = (price: number, status = "ON_SALE", currency = "BDT", remaining = 10) => ({ status, remaining, price_amount_minor: price, currency_code: currency });
  it("picks the lowest price that can be bought now", () => {
    expect(fromPrice({ status: "TICKETING_OPEN" }, [t(250000), t(150000), t(90000, "SOLD_OUT")])).toEqual({ amount_minor: 150000, currency_code: "BDT" });
  });
  it("shows nothing when nothing is on sale or currencies differ", () => {
    expect(fromPrice({ status: "PUBLISHED" }, [t(150000)])).toBeNull();
    expect(fromPrice({ status: "TICKETING_OPEN" }, [t(150000, "ON_SALE", "BDT"), t(2000, "ON_SALE", "USD")])).toBeNull();
    expect(fromPrice({ status: "TICKETING_OPEN" }, [])).toBeNull();
  });
});

describe("splitPast", () => {
  const now = new Date("2026-10-14T00:00:00Z");
  it("moves ended events to Past, newest first, and keeps live and postponed ones current", () => {
    const { current, past } = splitPast(
      [
        ev("soon", "2026-10-20T00:00:00Z"),
        ev("live", "2026-10-13T20:00:00Z", "LIVE"),
        ev("done", "2026-09-01T00:00:00Z", "COMPLETED"),
        ev("lapsed", "2026-10-01T00:00:00Z", "SALES_CLOSED"),
        ev("moved", "2026-10-01T00:00:00Z", "POSTPONED"),
        ev("tbc", null, "PUBLISHED"),
      ],
      now,
    );
    expect(current.map((e) => e.id)).toEqual(["soon", "live", "moved", "tbc"]);
    expect(past.map((e) => e.id)).toEqual(["lapsed", "done"]);
  });
});
