import { describe, expect, it } from "vitest";

import type { OrderRecord } from "@/lib/api";

import {
  formatCountdown,
  isSettled,
  orderReference,
  paidWithLabel,
  paymentPresentation,
  pollDelayMs,
  purchaseStage,
  rejectionNote,
  secondsLeft,
  shouldCelebrate,
  shouldPoll,
} from "./checkout-view";

const NOW = Date.parse("2026-10-13T10:00:00Z");

function order(over: Partial<OrderRecord> & { pay?: string; mode?: "test" | "live"; qr?: string | null } = {}): OrderRecord {
  const { pay = "REQUIRES_ACTION", mode = "test", qr = null, ...rest } = over;
  return {
    id: "01a12c0a-5420-7cdf-8446-cc15618ee0bc",
    status: "PENDING_PAYMENT",
    total_amount_minor: 300000,
    currency_code: "BDT",
    payment: { id: "p1", order_id: "o1", status: pay, amount_minor: 300000, currency_code: "BDT", provider: "sandbox", mode, qr_image_url: qr },
    hold_expires_at: "2026-10-13T10:10:00Z",
    hold_status: "ACTIVE",
    ...rest,
  };
}

describe("purchaseStage follows the server only", () => {
  it("waits while the order is pending and the reservation is live", () => {
    expect(purchaseStage(order(), NOW)).toBe("awaiting_payment");
  });
  it("is complete only when the server says FULFILLED", () => {
    expect(purchaseStage(order({ status: "FULFILLED", pay: "CAPTURED" }), NOW)).toBe("complete");
  });
  it("treats captured-but-not-fulfilled as processing, never as complete", () => {
    expect(purchaseStage(order({ status: "PAID", pay: "CAPTURED" }), NOW)).toBe("paid_processing");
    expect(purchaseStage(order({ pay: "CAPTURED" }), NOW)).toBe("paid_processing");
  });
  it("shows expiry from the server's hold, by status or by time", () => {
    expect(purchaseStage(order({ hold_status: "EXPIRED" }), NOW)).toBe("expired");
    expect(purchaseStage(order({ hold_expires_at: "2026-10-13T09:59:59Z" }), NOW)).toBe("expired");
  });
  it("names failures and cancellations", () => {
    expect(purchaseStage(order({ pay: "FAILED" }), NOW)).toBe("failed");
    expect(purchaseStage(order({ pay: "CANCELLED" }), NOW)).toBe("cancelled");
    expect(purchaseStage(order({ status: "CANCELLED" }), NOW)).toBe("cancelled");
    // Q-COM-03: money that arrived after cancellation is refunded by staff.
    expect(purchaseStage(order({ status: "CANCELLED", pay: "CAPTURED", refunded_amount_minor: 0 }), NOW)).toBe("late_payment");
    expect(purchaseStage(order({ status: "CANCELLED", pay: "CAPTURED", refunded_amount_minor: 300000 }), NOW)).toBe("refunded");
    expect(isSettled("late_payment")).toBe(true);
    // Q-PAY-05: a submitted payment is being checked; the expired timer doesn't matter meanwhile.
    const checking = { status: "SUBMITTED", transaction_ref: "8N7A6B5C4D", paid_with: "BKASH", decision_note: null, submitted_at: "2026-10-13T09:59:00Z" };
    expect(purchaseStage(order({ payment_submission: checking, hold_expires_at: "2026-10-13T09:00:00Z" }), NOW)).toBe("verifying");
    expect(shouldPoll("verifying")).toBe(true);
    expect(rejectionNote(order({ payment_submission: { ...checking, status: "REJECTED", decision_note: "Not on the statement" } }))).toBe("Not on the statement");
    expect(rejectionNote(order())).toBeNull();
    expect(paidWithLabel("BKASH")).toBe("bKash");
    expect(purchaseStage(order({ status: "REFUNDED", pay: "CAPTURED" }), NOW)).toBe("refunded");
    expect(purchaseStage(order({ status: "PARTIALLY_REFUNDED", pay: "CAPTURED" }), NOW)).toBe("partly_refunded");
  });
  it("music orders without a hold never expire on the client", () => {
    expect(purchaseStage(order({ hold_expires_at: null, hold_status: null }), NOW)).toBe("awaiting_payment");
  });
});

describe("status checks", () => {
  it("keep going until the order settles, including after expiry (late payments)", () => {
    expect(shouldPoll("awaiting_payment")).toBe(true);
    expect(shouldPoll("expired")).toBe(true);
    expect(shouldPoll("paid_processing")).toBe(true);
    for (const s of ["complete", "failed", "cancelled", "refunded", "partly_refunded"] as const) {
      expect(isSettled(s)).toBe(true);
      expect(shouldPoll(s)).toBe(false);
    }
  });
  it("back off gently", () => {
    expect([0, 3, 4, 9, 10, 50].map(pollDelayMs)).toEqual([3000, 3000, 5000, 5000, 10000, 10000]);
  });
});

describe("countdown", () => {
  it("counts down from the server's expiry and stops at zero", () => {
    expect(secondsLeft("2026-10-13T10:10:00Z", NOW)).toBe(600);
    expect(secondsLeft("2026-10-13T09:00:00Z", NOW)).toBe(0);
    expect(secondsLeft(null, NOW)).toBeNull();
    expect(secondsLeft("not a date", NOW)).toBeNull();
    expect(formatCountdown(600)).toBe("10:00");
    expect(formatCountdown(65)).toBe("1:05");
  });
});

describe("the success moment", () => {
  it("plays only when this page saw the order become complete", () => {
    expect(shouldCelebrate("awaiting_payment", "complete")).toBe(true);
    expect(shouldCelebrate("paid_processing", "complete")).toBe(true);
    expect(shouldCelebrate(null, "complete")).toBe(false); // returning to a finished order
    expect(shouldCelebrate("complete", "complete")).toBe(false);
    expect(shouldCelebrate("awaiting_payment", "paid_processing")).toBe(false);
    expect(shouldCelebrate("awaiting_payment", "failed")).toBe(false);
  });
});

describe("payment presentation", () => {
  it("shows a configured QR, a marked sample on test servers, or nothing on live without one", () => {
    expect(paymentPresentation(order({ qr: "/brand/payment/bangla-qr.png" }))).toEqual({ kind: "qr", src: "/brand/payment/bangla-qr.png" });
    expect(paymentPresentation(order())).toEqual({ kind: "sample" });
    expect(paymentPresentation(order({ mode: "live" }))).toEqual({ kind: "unavailable" });
  });
  it("gives a short order reference", () => {
    expect(orderReference("01a12c0a-5420-7cdf-8446-cc15618ee0bc")).toBe("CR-618EE0BC");
  });
});
