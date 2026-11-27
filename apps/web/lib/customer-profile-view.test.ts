import { describe, expect, it } from "vitest";

import {
  accountActionWords,
  byDay,
  dayWord,
  deviceLabel,
  filterMoments,
  freshKeys,
  isRecent,
  lastActivityLine,
  matchesChip,
  momentWords,
  orderSteps,
  paymentShort,
  profileHref,
  searchRows,
  statusCounts,
  timeAgo,
  type Moment,
  type ProfileOrder,
} from "./customer-profile-view";
import type { CustomerRow } from "./customers-view";

const NOW = new Date("2026-11-27T12:00:00Z");

function row(patch: Partial<CustomerRow>): CustomerRow {
  return {
    key: patch.key ?? "u1",
    name: null,
    email: "fan@example.com",
    phone: null,
    address: null,
    user_id: "u1",
    account_status: "ACTIVE",
    email_verified: true,
    joined_at: "2026-11-01T00:00:00Z",
    orders: 0,
    spent: {},
    last_order_at: null,
    presales: [],
    sources: ["WEBSITE"],
    ...patch,
  };
}

function order(patch: Partial<ProfileOrder>): ProfileOrder {
  return {
    order_id: "o1",
    status: "NOT_SENT",
    order_status: "PENDING_PAYMENT",
    purpose: "TRACK",
    is_presale: false,
    is_gift: false,
    is_music_gift: false,
    paid_with_credit_minor: 0,
    amount_minor: 11400,
    currency_code: "BDT",
    created_at: "2026-11-27T10:00:00Z",
    updated_at: null,
    items: [{ name: "Chaya Pore", kind: "TRACK", quantity: 1, amount_minor: 11400, currency_code: "BDT" }],
    submissions: [],
    refunds: [],
    delivery_address: null,
    ...patch,
  };
}

describe("what a person did last", () => {
  it("says it in words with what it was for", () => {
    expect(lastActivityLine("CHECKOUT_OPENED", ["Chaya Pore"])).toBe("Opened the payment page for Chaya Pore");
    expect(lastActivityLine("PAID", ["Chaya Pore", "Meghe Dhaka"])).toBe("Paid for Chaya Pore, Meghe Dhaka");
    expect(lastActivityLine("SIGNED_UP", [])).toBe("Joined Corner Room");
    expect(lastActivityLine(null)).toBe("No activity yet");
  });

  it("counts time in plain words, then gives up for the date", () => {
    expect(timeAgo("2026-11-27T11:59:30Z", NOW)).toBe("just now");
    expect(timeAgo("2026-11-27T11:55:00Z", NOW)).toBe("5 min ago");
    expect(timeAgo("2026-11-27T09:00:00Z", NOW)).toBe("3 h ago");
    expect(timeAgo("2026-11-26T09:00:00Z", NOW)).toBe("yesterday");
    expect(timeAgo("2026-11-23T09:00:00Z", NOW)).toBe("4 days ago");
    expect(timeAgo("2026-11-01T09:00:00Z", NOW)).toBeNull();
    expect(timeAgo(null, NOW)).toBeNull();
  });

  it("marks people active in the last half hour", () => {
    expect(isRecent("2026-11-27T11:40:00Z", NOW)).toBe(true);
    expect(isRecent("2026-11-27T11:00:00Z", NOW)).toBe(false);
  });
});

describe("the list", () => {
  const rows = [
    row({ key: "a", payment_status: "PAID", last_activity_at: "2026-11-27T11:50:00Z" }),
    row({
      key: "b",
      payment_status: "WAITING",
      payments: [
        { order_id: "1", status: "WAITING", items: ["Chaya Pore"], amount_minor: 100, currency_code: "BDT", transaction_ref: "DKO0W76JXI", paid_from: "+8801916777366", paid_with: "BKASH", decision_note: null, at: "2026-11-27T10:00:00Z" },
        { order_id: "2", status: "NOT_SENT", items: ["Chaya Pore"], amount_minor: 100, currency_code: "BDT", transaction_ref: null, paid_from: null, paid_with: null, decision_note: null, at: "2026-11-26T10:00:00Z" },
      ],
    }),
    row({ key: "c", payment_status: null, name: "Royal Bengal Sarkar", phone: "+8801717665551" }),
  ];

  it("counts each payment state a person has been in", () => {
    const c = statusCounts(rows, NOW);
    expect(c.all).toBe(3);
    expect(c.PAID).toBe(1);
    expect(c.WAITING).toBe(1);
    expect(c.NOT_SENT).toBe(1);
    expect(c.none).toBe(1);
    expect(c.active_now).toBe(1);
    expect(rows.filter((r) => matchesChip(r, "NOT_SENT", NOW)).map((r) => r.key)).toEqual(["b"]);
  });

  it("finds people by what they typed when paying, and phones however they are written", () => {
    expect(searchRows(rows, "dko0w76").map((r) => r.key)).toEqual(["b"]);
    expect(searchRows(rows, "01717 665551").map((r) => r.key)).toEqual(["c"]);
    expect(searchRows(rows, "royal").map((r) => r.key)).toEqual(["c"]);
    expect(searchRows(rows, "  ")).toHaveLength(3);
  });

  it("lights up only people whose activity changed since the last load", () => {
    expect(freshKeys(null, rows).size).toBe(0);
    const later = [row({ key: "a", last_activity_at: "2026-11-27T11:58:00Z" }), rows[1], rows[2]];
    expect([...freshKeys(rows, later)]).toEqual(["a"]);
  });

  it("keeps the status pill short so it fits its column", () => {
    expect(paymentShort("NOT_SENT")).toBe("Opened, not paid");
    expect(paymentShort(null)).toBe("Never ordered");
    for (const s of ["PAID", "WAITING", "REJECTED", "EXPIRED", "NOT_SENT", "REFUNDED"]) expect(paymentShort(s).length).toBeLessThanOrEqual(17);
  });

  it("opens a person by key, never by email", () => {
    expect(profileHref("presale-1b2c")).toBe("/staff/customers/presale-1b2c");
  });
});

describe("a person's page", () => {
  it("draws an order's four steps", () => {
    expect(orderSteps(order({})).map((s) => s.state)).toEqual(["done", "todo", "todo", "todo"]);
    const sent = order({
      status: "WAITING",
      submissions: [{ status: "SUBMITTED", transaction_ref: "X", paid_from: "1", paid_with: "BKASH", sent_at: "2026-11-27T10:05:00Z", decided_at: null, decision_note: null }],
    });
    expect(orderSteps(sent).map((s) => s.state)).toEqual(["done", "done", "wait", "todo"]);
    const rejected = order({ status: "REJECTED", submissions: [{ ...sent.submissions[0], status: "REJECTED", decided_at: "2026-11-27T11:00:00Z" }] });
    expect(orderSteps(rejected).map((s) => s.state)).toEqual(["done", "done", "bad", "bad"]);
    expect(orderSteps(order({ status: "PAID", order_status: "FULFILLED", paid_with_credit_minor: 11400 })).map((s) => s.state)).toEqual(["done", "done", "done", "done"]);
    expect(orderSteps(order({ status: "EXPIRED" }))[3].label).toBe("Expired unpaid");
  });

  it("says each moment plainly", () => {
    expect(momentWords({ at: "", kind: "PAYMENT_SENT", title: "Chaya Pore", detail: "ASIFGIFT2026 · +8801761934095 · BKASH" })).toEqual({
      headline: "Sent a payment to check for Chaya Pore",
      sub: "ID ASIFGIFT2026 · from +8801761934095 · via bKash",
    });
    expect(momentWords({ at: "", kind: "LISTENED", title: "Chaya Pore", count: 3 }).headline).toBe("Listened to Chaya Pore (3 listens that day)");
    expect(momentWords({ at: "", kind: "ACCOUNT_ACTION", title: "auth.login_failed" }).headline).toBe("Tried to sign in, wrong password");
    expect(momentWords({ at: "", kind: "PAYMENT_REJECTED", title: "Chaya Pore", detail: "Not on the statement" }).sub).toBe("Reason: Not on the statement");
  });

  it("makes unknown account actions readable", () => {
    expect(accountActionWords("playlist.renamed")).toBe("Playlist renamed");
  });

  it("names devices", () => {
    expect(deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36")).toBe("Chrome on Windows");
    expect(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1")).toBe("Safari on iPhone");
    expect(deviceLabel("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36 Edg/131.0")).toBe("Edge on Android");
    expect(deviceLabel(null)).toBe("Unknown device");
  });

  it("groups the timeline by Dhaka day and filters it", () => {
    const moments: Moment[] = [
      { at: "2026-11-27T11:00:00Z", kind: "PAID", title: "Chaya Pore" },
      { at: "2026-11-26T19:00:00Z", kind: "LISTENED", title: "Chaya Pore" }, // 27 Nov 01:00 in Dhaka
      { at: "2026-11-26T10:00:00Z", kind: "ACCOUNT_ACTION", title: "auth.login" },
    ];
    expect(byDay(moments).map((d) => [d.day, d.moments.length])).toEqual([
      ["2026-11-27", 2],
      ["2026-11-26", 1],
    ]);
    expect(dayWord("2026-11-27", NOW)).toBe("Today");
    expect(dayWord("2026-11-26", NOW)).toBe("Yesterday");
    expect(filterMoments(moments, "payments", "").map((m) => m.kind)).toEqual(["PAID"]);
    expect(filterMoments(moments, "all", "signed in").map((m) => m.kind)).toEqual(["ACCOUNT_ACTION"]);
  });
});
