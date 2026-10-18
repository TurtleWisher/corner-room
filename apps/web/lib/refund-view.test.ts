import { describe, expect, it } from "vitest";

import type { StaffTicket } from "@/features/commerce/api";

import { canSendRefund, normalizeReference, orderReferenceOf, reasonLabel, refundActions, refundScope, ticketBlockedReason } from "./refund-view";

const ticket = (over: Partial<StaffTicket> = {}): StaffTicket => ({
  id: "t1",
  status: "ISSUED",
  ticket_type_name: "General",
  unit_amount_minor: 100,
  currency_code: "BDT",
  refundable: true,
  refund_pending: false,
  ...over,
});

describe("refund view", () => {
  it("accepts the reference the buyer reads out, in any case or spacing", () => {
    expect(normalizeReference("cr-1a2b3c4d")).toBe("CR-1A2B3C4D");
    expect(normalizeReference(" 1A2B 3C4D ")).toBe("CR-1A2B3C4D");
    expect(normalizeReference("CR1A2B3C4D")).toBe("CR-1A2B3C4D");
    expect(normalizeReference("CR-1A2B3C4")).toBeNull();
    expect(normalizeReference("CR-ZZZZZZZZ")).toBeNull();
  });

  it("matches the checkout reference", () => {
    expect(orderReferenceOf("01a12c0a-5420-7cdf-8446-cc15618ee0bc")).toBe("CR-618EE0BC");
  });

  it("offers approve, then complete, then nothing", () => {
    expect(refundActions({ status: "REQUESTED" })).toEqual(["approve"]);
    expect(refundActions({ status: "APPROVED" })).toEqual(["complete"]);
    expect(refundActions({ status: "COMPLETED" })).toEqual([]);
    expect(refundActions({ status: "REJECTED" })).toEqual([]);
  });

  it("shows words for reasons and scope", () => {
    expect(reasonLabel("GOODWILL", [{ reason_code: "GOODWILL", label: "Goodwill / service issue", requires_finance_approve: true }])).toBe("Goodwill / service issue");
    expect(reasonLabel("UNKNOWN", [])).toBe("UNKNOWN");
    expect(refundScope({ ticket_ids: null })).toBe("Whole order");
    expect(refundScope({ ticket_ids: ["a"] })).toBe("1 ticket");
    expect(refundScope({ ticket_ids: ["a", "b"] })).toBe("2 tickets");
  });

  it("explains why a ticket can't be picked", () => {
    expect(ticketBlockedReason(ticket())).toBeNull();
    expect(ticketBlockedReason(ticket({ refund_pending: true, refundable: false }))).toMatch(/already waiting/);
    expect(ticketBlockedReason(ticket({ status: "REFUNDED", refundable: false }))).toBe("Already refunded");
    expect(ticketBlockedReason(ticket({ status: "EXPIRED", refundable: false }))).toBe("Can't be refunded");
  });

  it("needs at least one ticket and a reason", () => {
    expect(canSendRefund(0, "CUSTOMER_REQUEST")).toBe(false);
    expect(canSendRefund(2, "")).toBe(false);
    expect(canSendRefund(1, "CUSTOMER_REQUEST")).toBe(true);
  });
});
