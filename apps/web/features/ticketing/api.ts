/* Ticket types, holds, orders, payments, tickets and attendance. Split from lib/api.ts (Phase 16, Stage 5). */

import { type Page } from "@/features/identity/api";
import { apiFetch } from "@/lib/api/client";

export type TicketTypeRecord = {
  id: string;
  event_id: string;
  name: string;
  status: string;
  price_amount_minor: number;
  currency_code: string;
  quantity_total: number;
  remaining: number;
  sales_starts_at: string | null;
  sales_ends_at: string | null;
  version?: number | null;
};

export type HoldRecord = {
  id: string;
  ticket_type_id: string;
  quantity: number;
  status: string;
  expires_at: string;
};

export type PaymentRecord = {
  id: string;
  order_id: string | null;
  status: string;
  amount_minor: number;
  currency_code: string;
  provider: string;
  /** "test": the sandbox provider, no real money moves. "live": a real provider. */
  mode?: "test" | "live";
  /** Only on local, dev and test servers, while the payment can still be captured. */
  self_confirm_available?: boolean;
  /** Bangla QR image to show. Showing it proves nothing; only the server confirms payment. */
  qr_image_url?: string | null;
};

/** One priced line, exactly as the server priced it. Never recomputed in the browser. */
export type OrderItemRecord = {
  id: string;
  item_type: "TICKET" | "TRACK" | "SUBSCRIPTION" | "OTHER" | string;
  ref_id: string;
  quantity: number;
  unit_amount_minor: number;
  amount_minor: number;
  currency_code: string;
  ticket_type_name?: string | null;
  event_id?: string | null;
  /** For RELEASE items: what was bought, named by the API. */
  release_title?: string | null;
  release_type?: string | null;
};

export type OrderRecord = {
  id: string;
  status: string;
  purpose?: string;
  total_amount_minor: number;
  currency_code: string;
  payment: PaymentRecord | null;
  /** Single-order reads only (create, get, confirm); lists omit them. */
  items?: OrderItemRecord[] | null;
  created_at?: string | null;
  hold_expires_at?: string | null;
  hold_status?: string | null;
  /** Completed refunds on the payment, minor units (single-order reads). */
  refunded_amount_minor?: number | null;
  /** The delivery address confirmed for this order (single-order reads, D-ADDR-01). */
  delivery_address?: Record<string, string | null> | null;
  /** The buyer's latest Bangla QR payment report and what staff decided (Q-PAY-01/05). */
  payment_submission?: PaymentSubmission | null;
};

export type TicketRecord = {
  id: string;
  ticket_type_id: string;
  status: string;
  presentation_token: string | null;
  /** Owner list only (GET /me/tickets, OD-29). */
  event_id?: string | null;
  ticket_type_name?: string | null;
};

export type CheckInRecord = {
  id: string;
  ticket_id: string;
  event_id: string;
  status: string;
  scanned_at: string;
};

export async function fetchEventTicketTypes(eventId: string, opts?: { skipAuth?: boolean }): Promise<Page<TicketTypeRecord>> {
  return apiFetch<Page<TicketTypeRecord>>(`/api/v1/events/${eventId}/ticket-types`, {
    retry: false,
    skipAuth: opts?.skipAuth,
    skipRefresh: opts?.skipAuth,
  });
}

export async function createTicketType(body: {
  event_id: string;
  name: string;
  price_amount_minor: number;
  currency_code: string;
  quantity_total: number;
}): Promise<TicketTypeRecord> {
  return apiFetch<TicketTypeRecord>("/api/v1/ticket-types", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    retry: false,
  });
}

export async function transitionTicketType(
  id: string,
  action: string,
  version?: number,
): Promise<TicketTypeRecord> {
  return apiFetch<TicketTypeRecord>(`/api/v1/ticket-types/${id}/lifecycle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, version }),
    retry: false,
  });
}

export async function createHold(ticket_type_id: string, quantity: number): Promise<HoldRecord> {
  return apiFetch<HoldRecord>("/api/v1/ticket-holds", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticket_type_id, quantity }),
    retry: false,
  });
}

/** `deliveryConfirmed`: the buyer confirmed their Bangladesh delivery address (D-ADDR-01). */
export async function createOrder(hold_id: string, idempotencyKey: string, deliveryConfirmed = false): Promise<OrderRecord> {
  return apiFetch<OrderRecord>("/api/v1/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({ hold_id, delivery_address_confirmed: deliveryConfirmed }),
    retry: false,
  });
}

export async function createCatalogOrder(offer_id: string, idempotencyKey: string, deliveryConfirmed = false): Promise<OrderRecord> {
  return apiFetch<OrderRecord>("/api/v1/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({ offer_id, delivery_address_confirmed: deliveryConfirmed }),
    retry: false,
  });
}

export async function sandboxConfirmPayment(paymentId: string): Promise<OrderRecord> {
  return apiFetch<OrderRecord>(`/api/v1/payments/${paymentId}/sandbox-confirm`, {
    method: "POST",
    retry: false,
  });
}

/** The authoritative order, for resuming checkout and checking payment status. Owner only (404 otherwise). */
export async function fetchOrder(orderId: string): Promise<OrderRecord> {
  return apiFetch<OrderRecord>(`/api/v1/orders/${orderId}`, { retry: false });
}

export async function fetchMyTickets(): Promise<Page<TicketRecord>> {
  return apiFetch<Page<TicketRecord>>("/api/v1/me/tickets", { retry: false });
}

export async function fetchMyOrders(): Promise<Page<OrderRecord>> {
  return apiFetch<Page<OrderRecord>>("/api/v1/me/orders", { retry: false });
}

export async function checkInTicket(token: string): Promise<CheckInRecord> {
  return apiFetch<CheckInRecord>("/api/v1/check-in", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
    retry: false,
  });
}

export async function fetchAttendance(eventId: string): Promise<Page<CheckInRecord>> {
  return apiFetch<Page<CheckInRecord>>(`/api/v1/events/${eventId}/attendance`, { retry: false });
}


/** A buyer's report of a Bangla QR payment (Q-PAY-01). Staff confirm or reject it. */
export type PaymentSubmission = {
  status: "SUBMITTED" | "CONFIRMED" | "REJECTED" | string;
  transaction_ref: string;
  paid_with: string;
  decision_note: string | null;
  submitted_at: string;
};

export async function submitPayment(paymentId: string, body: { transaction_ref: string; paid_from: string; paid_with: string }): Promise<OrderRecord> {
  return apiFetch<OrderRecord>(`/api/v1/payments/${paymentId}/submissions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    retry: false,
  });
}