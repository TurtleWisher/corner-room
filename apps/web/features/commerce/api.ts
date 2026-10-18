/* Offers, products, plans, subscriptions and entitlements. Split from lib/api.ts (Phase 16, Stage 5). */

import { type Page } from "@/features/identity/api";
import { type OrderRecord } from "@/features/ticketing/api";
import { apiFetch } from "@/lib/api/client";

export type OfferRecord = {
  id: string;
  organization_id: string;
  product_id: string;
  product_type: string | null;
  name: string | null;
  /** What the offer sells: the track id for TRACK products (OD-27). */
  subject_id?: string | null;
  amount_minor: number;
  currency_code: string;
  status: string;
  version: number | null;
  /** EVERYONE, or OWNS_PART_OF_RELEASE for the price fans who already own some songs pay (D-AUDIO-11). */
  audience?: string;
};

export type ProductRecord = {
  id: string;
  organization_id: string;
  product_type: string;
  subject_id: string;
  name: string;
  status: string;
  version: number;
};

export type PlanRecord = {
  id: string;
  key: string;
  status: string;
  price_amount_minor: number;
  currency_code: string;
  interval: string;
  interval_count: number;
  trial_days: number | null;
  version_number: number | null;
};

export type SubscriptionRecord = {
  id: string;
  plan_id: string;
  plan_version_id: string;
  status: string;
  cancel_at_period_end: boolean;
  period_ends_at: string | null;
};

export type EntitlementRecord = {
  id: string;
  entitlement_type: string;
  ref_id: string;
  scope: string;
  status: string;
  expires_at: string | null;
};

export async function fetchOffers(): Promise<Page<OfferRecord>> {
  return apiFetch<Page<OfferRecord>>("/api/v1/offers", { retry: false, skipAuth: true, skipRefresh: true });
}

export async function fetchSubscriptionPlans(): Promise<Page<PlanRecord>> {
  return apiFetch<Page<PlanRecord>>("/api/v1/subscription-plans", {
    retry: false,
    skipAuth: true,
    skipRefresh: true,
  });
}

export async function createSubscriptionOrder(plan_id: string, idempotencyKey: string, deliveryConfirmed = false): Promise<OrderRecord> {
  return apiFetch<OrderRecord>("/api/v1/subscriptions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({ plan_id, delivery_address_confirmed: deliveryConfirmed }),
    retry: false,
  });
}

export async function fetchMySubscription(): Promise<SubscriptionRecord> {
  return apiFetch<SubscriptionRecord>("/api/v1/me/subscription", { retry: false });
}

export async function fetchMySubscriptions(): Promise<Page<SubscriptionRecord>> {
  return apiFetch<Page<SubscriptionRecord>>("/api/v1/me/subscriptions", { retry: false });
}

export async function cancelSubscription(id: string): Promise<SubscriptionRecord> {
  return apiFetch<SubscriptionRecord>(`/api/v1/subscriptions/${id}/cancel`, {
    method: "POST",
    retry: false,
  });
}

export async function fetchMyEntitlements(): Promise<Page<EntitlementRecord>> {
  return apiFetch<Page<EntitlementRecord>>("/api/v1/me/entitlements", { retry: false });
}

export async function fetchStaffProducts(): Promise<Page<ProductRecord>> {
  return apiFetch<Page<ProductRecord>>("/api/v1/products", { retry: false });
}

/** A price an artist proposed for a release or one of its tracks (D-AUDIO-11, D-AUDIO-15). */
export type OfferProposalRecord = {
  id: string;
  release_id: string;
  release_title: string;
  release_status: string;
  subject_type: "TRACK" | "RELEASE";
  subject_id: string;
  subject_title: string;
  audience: "EVERYONE" | "OWNS_PART_OF_RELEASE";
  amount_minor: number;
  currency_code: string;
  note: string | null;
  status: string;
  decision_note: string | null;
  created_at: string;
};

/** Ops queue of proposed prices in the active workspace (commerce.write). */
export async function fetchOfferProposals(status: "PROPOSED" | "ACCEPTED" | "COUNTERED" | "WITHDRAWN" = "PROPOSED"): Promise<OfferProposalRecord[]> {
  return apiFetch<OfferProposalRecord[]>(`/api/v1/offer-proposals?status=${status}`, { retry: false });
}

/** Accept puts exactly the proposed price on sale; counter sends a note back to the artist. */
export async function decideOfferProposal(id: string, decision: "accept" | "counter", note?: string): Promise<OfferProposalRecord> {
  return apiFetch<OfferProposalRecord>(`/api/v1/offer-proposals/${id}/decision`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(note ? { decision, note } : { decision }),
    retry: false,
  });
}

export async function fetchStaffPlans(): Promise<Page<PlanRecord>> {
  return apiFetch<Page<PlanRecord>>("/api/v1/staff/subscription-plans", { retry: false });
}

export async function createProduct(body: {
  product_type: string;
  subject_id: string;
  name: string;
}): Promise<ProductRecord> {
  return apiFetch<ProductRecord>("/api/v1/products", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    retry: false,
  });
}

export async function transitionProduct(id: string, action: string, version?: number): Promise<ProductRecord> {
  return apiFetch<ProductRecord>(`/api/v1/products/${id}/lifecycle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, version }),
    retry: false,
  });
}

export async function createOffer(body: {
  product_id: string;
  amount_minor: number;
  currency_code: string;
}): Promise<OfferRecord> {
  return apiFetch<OfferRecord>("/api/v1/offers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    retry: false,
  });
}

export async function transitionOffer(id: string, action: string, version?: number): Promise<OfferRecord> {
  return apiFetch<OfferRecord>(`/api/v1/offers/${id}/lifecycle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, version }),
    retry: false,
  });
}

export async function createPlan(body: {
  key: string;
  price_amount_minor: number;
  currency_code: string;
  interval: string;
  interval_count: number;
  trial_days?: number | null;
}): Promise<PlanRecord> {
  return apiFetch<PlanRecord>("/api/v1/subscription-plans", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    retry: false,
  });
}

export async function transitionPlan(id: string, action: string): Promise<PlanRecord> {
  return apiFetch<PlanRecord>(`/api/v1/subscription-plans/${id}/lifecycle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
    retry: false,
  });
}


// --- Refunds (Q-COM-01, D-REF-01). The server works out every amount; nothing is computed here. ---

export type RefundReason = { reason_code: string; label: string; requires_finance_approve: boolean };

export type RefundRecord = {
  id: string;
  payment_id: string;
  order_id?: string;
  status: string;
  amount_minor: number;
  currency_code: string;
  reason_code: string;
  ticket_ids: string[] | null;
  created_at?: string;
  /** sandbox: completed with the test button; bangla_qr: paid back by hand with a reference. */
  payment_provider?: string | null;
};

export type StaffTicket = {
  id: string;
  status: string;
  ticket_type_name: string | null;
  unit_amount_minor: number;
  currency_code: string;
  refundable: boolean;
  refund_pending: boolean;
};

export type StaffOrder = {
  id: string;
  status: string;
  purpose: string;
  total_amount_minor: number;
  currency_code: string;
  created_at: string | null;
  buyer_email: string | null;
  payment_id: string | null;
  payment_status: string | null;
  payment_provider: string | null;
  refunded_amount_minor: number;
  items: Array<{ item_type: string; quantity: number; ticket_type_name?: string | null; release_title?: string | null }>;
  tickets: StaffTicket[];
  refunds: RefundRecord[];
};

export async function fetchRefundReasons(): Promise<RefundReason[]> {
  return apiFetch<RefundReason[]>("/api/v1/refund-reasons");
}

export async function lookupStaffOrder(reference: string): Promise<StaffOrder> {
  return apiFetch<StaffOrder>(`/api/v1/staff/orders/lookup?reference=${encodeURIComponent(reference)}`);
}

export async function fetchStaffRefunds(): Promise<RefundRecord[]> {
  return apiFetch<RefundRecord[]>("/api/v1/staff/refunds");
}

export async function requestTicketRefund(orderId: string, ticketIds: string[], reasonCode: string, idempotencyKey: string): Promise<RefundRecord> {
  return apiFetch<RefundRecord>("/api/v1/refunds", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({ order_id: orderId, ticket_ids: ticketIds, reason_code: reasonCode }),
    retry: false,
  });
}

export async function requestRemainingRefund(orderId: string, reasonCode: string, idempotencyKey: string): Promise<RefundRecord> {
  return apiFetch<RefundRecord>("/api/v1/refunds", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({ order_id: orderId, refund_remaining: true, reason_code: reasonCode }),
    retry: false,
  });
}

export async function approveRefund(refundId: string): Promise<RefundRecord> {
  return apiFetch<RefundRecord>(`/api/v1/refunds/${refundId}/approve`, { method: "POST", retry: false });
}

/** Sandbox payments only: marks the refund as paid back (no real money moves on test servers). */
export async function completeSandboxRefund(refundId: string): Promise<RefundRecord> {
  return apiFetch<RefundRecord>(`/api/v1/refunds/${refundId}/sandbox-complete`, { method: "POST", retry: false });
}

/** Bangla QR: finance paid the money back by hand and records the transfer reference. */
export async function completeManualRefund(refundId: string, payoutReference: string): Promise<RefundRecord> {
  return apiFetch<RefundRecord>(`/api/v1/refunds/${refundId}/complete-manual`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ payout_reference: payoutReference }),
    retry: false,
  });
}

// --- Bangla QR payment checks (Q-PAY-01): finance confirm or reject what buyers sent. ---

export type StaffSubmission = {
  id: string;
  order_id: string;
  purpose: string;
  amount_minor: number;
  currency_code: string;
  transaction_ref: string;
  paid_from: string;
  paid_with: string;
  status: string;
  decision_note: string | null;
  buyer_email: string | null;
  submitted_at: string;
};

export async function fetchStaffSubmissions(): Promise<StaffSubmission[]> {
  return apiFetch<StaffSubmission[]>("/api/v1/staff/payment-submissions");
}

export async function confirmSubmission(id: string): Promise<StaffSubmission> {
  return apiFetch<StaffSubmission>(`/api/v1/staff/payment-submissions/${id}/confirm`, { method: "POST", retry: false });
}

export async function rejectSubmission(id: string, reason: string): Promise<StaffSubmission> {
  return apiFetch<StaffSubmission>(`/api/v1/staff/payment-submissions/${id}/reject`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason }),
    retry: false,
  });
}