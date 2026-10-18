import type { OrderRecord } from "@/lib/api";

/*
 * What the checkout page shows, derived only from the server's order (status, payment status,
 * reservation). The browser never decides that something is paid: opening checkout, showing the
 * QR or clicking a button changes nothing until the server says so.
 */

export type PurchaseStage =
  /** Order placed, waiting for the payment to be confirmed by the server. */
  | "awaiting_payment"
  /** The buyer sent their Bangla QR payment details; finance staff are checking (seats stay held, Q-PAY-05). */
  | "verifying"
  /** The reservation ran out before payment was confirmed. A late payment is still kept by the server. */
  | "expired"
  /** The payment provider reported a failure. */
  | "failed"
  /** The order or payment was cancelled. */
  | "cancelled"
  /** Money arrived after the order was cancelled (Q-COM-03): staff refund it. */
  | "late_payment"
  /** Payment confirmed, tickets or access not granted yet (e.g. a late payment after the hold expired). */
  | "paid_processing"
  /** Paid and fulfilled: tickets issued or the track is in the library. */
  | "complete"
  | "refunded"
  | "partly_refunded";

/** Stages that no longer change by waiting, so status checks can stop. */
const SETTLED: ReadonlySet<PurchaseStage> = new Set(["failed", "cancelled", "late_payment", "complete", "refunded", "partly_refunded"]);

export function purchaseStage(order: OrderRecord, nowMs: number): PurchaseStage {
  const payment = order.payment?.status;
  switch (order.status) {
    case "FULFILLED":
      return "complete";
    case "REFUNDED":
      return "refunded";
    case "PARTIALLY_REFUNDED":
      return "partly_refunded";
    case "CANCELLED":
      if (payment !== "CAPTURED") return "cancelled";
      // The refund amount comes from the server; the browser only compares it with the total.
      return (order.refunded_amount_minor ?? 0) >= order.total_amount_minor ? "refunded" : "late_payment";
    case "PAID":
      return "paid_processing";
  }
  // A submitted payment is being checked by staff; the hold timer does not run meanwhile.
  if (order.payment_submission?.status === "SUBMITTED" && payment !== "CAPTURED") return "verifying";
  if (payment === "FAILED") return "failed";
  if (payment === "CANCELLED") return "cancelled";
  if (payment === "CAPTURED") return "paid_processing";
  if (order.hold_status === "EXPIRED" || order.hold_status === "RELEASED") return "expired";
  if (order.hold_expires_at && Date.parse(order.hold_expires_at) <= nowMs) return "expired";
  return "awaiting_payment";
}

export function isSettled(stage: PurchaseStage): boolean {
  return SETTLED.has(stage);
}

/**
 * Whether to keep asking the server. Awaiting and processing orders are checked; an expired one is
 * checked too, because a payment made just before expiry can still be confirmed late.
 */
export function shouldPoll(stage: PurchaseStage): boolean {
  return !isSettled(stage);
}

/** Gentle back-off: 3 s, then 5 s, then every 10 s. */
export function pollDelayMs(attempt: number): number {
  if (attempt < 4) return 3000;
  if (attempt < 10) return 5000;
  return 10000;
}

/** Whole seconds left on the reservation, from the server's expiry. Null when there is none. */
export function secondsLeft(holdExpiresAt: string | null | undefined, nowMs: number): number | null {
  if (!holdExpiresAt) return null;
  const end = Date.parse(holdExpiresAt);
  if (Number.isNaN(end)) return null;
  return Math.max(0, Math.floor((end - nowMs) / 1000));
}

export function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * The success moment plays only when this page saw the order go from not-complete to complete.
 * Returning later to an order that was already complete shows the confirmation without it.
 */
export function shouldCelebrate(previous: PurchaseStage | null, next: PurchaseStage): boolean {
  return previous !== null && previous !== "complete" && next === "complete";
}

/** A short, human order reference from the order id (display only; the id stays the key). */
export function orderReference(orderId: string): string {
  return `CR-${orderId.replace(/-/g, "").slice(-8).toUpperCase()}`;
}

export type PaymentPresentation =
  /** A real QR image is configured. */
  | { kind: "qr"; src: string }
  /** No image yet, and this is a test server: a clearly marked sample, never scannable. */
  | { kind: "sample" }
  /** No image and not a test server: the method is not available. */
  | { kind: "unavailable" };

export function paymentPresentation(order: OrderRecord): PaymentPresentation {
  const p = order.payment;
  if (p?.qr_image_url) return { kind: "qr", src: p.qr_image_url };
  if (p?.mode !== "live") return { kind: "sample" };
  return { kind: "unavailable" };
}


/** The apps a Bangla QR payment can be made with (owner, 2026-10-18), in the order shown. */
export const PAID_WITH_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "BKASH", label: "bKash" },
  { value: "NAGAD", label: "Nagad" },
  { value: "ROCKET", label: "Rocket" },
  { value: "UPAY", label: "Upay" },
  { value: "BANK_APP", label: "Bank app" },
  { value: "OTHER", label: "Other" },
];

export function paidWithLabel(value: string): string {
  return PAID_WITH_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

/** The staff reason to show above the form after a rejection, or null. */
export function rejectionNote(order: Pick<OrderRecord, "payment_submission">): string | null {
  const sub = order.payment_submission;
  return sub && sub.status === "REJECTED" ? (sub.decision_note ?? "We couldn't find this payment.") : null;
}