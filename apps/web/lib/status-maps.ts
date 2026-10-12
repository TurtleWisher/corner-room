import { defineStatusMap } from "@/lib/format/status";

/*
 * Customer-facing status labels, written from the backend enums (CHECK constraints and
 * lifecycle.py). Values not listed here are humanised with a neutral tone by StatusChip, so a new
 * backend state never breaks a page. Labels only; no transition is implied.
 */

/** events.md section 5. */
export const EVENT_STATUS = defineStatusMap({
  PUBLISHED: { label: "Announced", tone: "info" },
  TICKETING_OPEN: { label: "On sale", tone: "positive" },
  SALES_CLOSED: { label: "Sales closed", tone: "neutral" },
  LIVE: { label: "Happening now", tone: "accent" },
  COMPLETED: { label: "Ended", tone: "neutral" },
  POSTPONED: { label: "Postponed", tone: "warning" },
  CANCELLED: { label: "Cancelled", tone: "negative" },
});

/** music/domain/lifecycle.py. The public API returns RELEASED only; the rest appear for staff. */
export const RELEASE_STATUS = defineStatusMap({
  RELEASED: { label: "Out now", tone: "positive" },
  SCHEDULED: { label: "Scheduled", tone: "info" },
  TAKEN_DOWN: { label: "No longer available", tone: "negative" },
  ARCHIVED: { label: "Archived", tone: "neutral" },
});

/** commerce orders: DRAFT, PENDING_PAYMENT, PAID, FULFILLED, CANCELLED, PARTIALLY_REFUNDED, REFUNDED. */
export const ORDER_STATUS = defineStatusMap({
  DRAFT: { label: "Draft", tone: "neutral" },
  PENDING_PAYMENT: { label: "Awaiting payment", tone: "warning" },
  PAID: { label: "Paid", tone: "info" },
  FULFILLED: { label: "Complete", tone: "positive" },
  CANCELLED: { label: "Cancelled", tone: "negative" },
  PARTIALLY_REFUNDED: { label: "Partly refunded", tone: "warning" },
  REFUNDED: { label: "Refunded", tone: "neutral" },
});

/** finance payments: CREATED, REQUIRES_ACTION, AUTHORIZED, CAPTURED, FAILED, CANCELLED. */
export const PAYMENT_STATUS = defineStatusMap({
  CREATED: { label: "Started", tone: "neutral" },
  REQUIRES_ACTION: { label: "Needs confirmation", tone: "warning" },
  AUTHORIZED: { label: "Authorised", tone: "info" },
  CAPTURED: { label: "Paid", tone: "positive" },
  FAILED: { label: "Failed", tone: "negative" },
  CANCELLED: { label: "Cancelled", tone: "negative" },
});

/** store.md section 5. */
export const SUBSCRIPTION_STATUS = defineStatusMap({
  TRIALING: { label: "Trial", tone: "info" },
  ACTIVE: { label: "Active", tone: "positive" },
  PAST_DUE: { label: "Payment overdue", tone: "warning" },
  CANCELLED: { label: "Cancelled", tone: "negative" },
  EXPIRED: { label: "Ended", tone: "neutral" },
});

export const ENTITLEMENT_STATUS = defineStatusMap({
  ACTIVE: { label: "Active", tone: "positive" },
  REVOKED: { label: "Revoked", tone: "negative" },
  EXPIRED: { label: "Expired", tone: "neutral" },
});

/** ticketing tickets: CREATED, RESERVED, PAYMENT_PENDING, PAID, ISSUED, CHECKED_IN, EXPIRED, CANCELLED, REFUNDED. */
export const TICKET_STATUS = defineStatusMap({
  CREATED: { label: "Processing", tone: "neutral" },
  RESERVED: { label: "Reserved", tone: "info" },
  PAYMENT_PENDING: { label: "Awaiting payment", tone: "warning" },
  PAID: { label: "Paid", tone: "info" },
  ISSUED: { label: "Valid", tone: "positive" },
  CHECKED_IN: { label: "Used", tone: "neutral" },
  EXPIRED: { label: "Expired", tone: "neutral" },
  CANCELLED: { label: "Cancelled", tone: "negative" },
  REFUNDED: { label: "Refunded", tone: "neutral" },
});

/** royalty statements: DRAFT, ISSUED, ACKNOWLEDGED, DISPUTED. */
export const STATEMENT_STATUS = defineStatusMap({
  DRAFT: { label: "Draft", tone: "neutral" },
  ISSUED: { label: "Issued", tone: "info" },
  ACKNOWLEDGED: { label: "Acknowledged", tone: "positive" },
  DISPUTED: { label: "Disputed", tone: "warning" },
});
