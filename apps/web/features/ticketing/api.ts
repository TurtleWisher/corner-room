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
};

export type OrderRecord = {
  id: string;
  status: string;
  purpose?: string;
  total_amount_minor: number;
  currency_code: string;
  payment: PaymentRecord | null;
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

export async function createOrder(hold_id: string, idempotencyKey: string): Promise<OrderRecord> {
  return apiFetch<OrderRecord>("/api/v1/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({ hold_id }),
    retry: false,
  });
}

export async function createCatalogOrder(offer_id: string, idempotencyKey: string): Promise<OrderRecord> {
  return apiFetch<OrderRecord>("/api/v1/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({ offer_id }),
    retry: false,
  });
}

export async function sandboxConfirmPayment(paymentId: string): Promise<OrderRecord> {
  return apiFetch<OrderRecord>(`/api/v1/payments/${paymentId}/sandbox-confirm`, {
    method: "POST",
    retry: false,
  });
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
