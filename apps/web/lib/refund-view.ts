/*
 * Staff refund screen helpers (Q-COM-01, D-REF-01). Pure and display-only: the server works out
 * every amount, checks every permission and decides every status. These only shape what is shown.
 */

import type { RefundReason, RefundRecord, StaffTicket } from "@/features/commerce/api";

/** "cr-1a2b 3c4d", "1A2B3C4D" or "CR-1A2B3C4D" -> "CR-1A2B3C4D"; anything else -> null. */
export function normalizeReference(input: string): string | null {
  const hex = input.trim().toUpperCase().replace(/^CR-?/, "").replace(/[\s-]/g, "");
  return /^[0-9A-F]{8}$/.test(hex) ? `CR-${hex}` : null;
}

export type RefundAction = "approve" | "complete";

/**
 * Buttons for a refund, from the status the server returned (06 §5: REQUESTED -> APPROVED ->
 * PROCESSING -> COMPLETED | REJECTED). The server still refuses anything it does not allow.
 */
export function refundActions(refund: Pick<RefundRecord, "status">): RefundAction[] {
  if (refund.status === "REQUESTED") return ["approve"];
  if (refund.status === "APPROVED" || refund.status === "PROCESSING") return ["complete"];
  return [];
}

export function reasonLabel(code: string, reasons: RefundReason[]): string {
  return reasons.find((r) => r.reason_code === code)?.label ?? code;
}

/** What a refund covers, in words: "2 tickets" or "Whole order". */
export function refundScope(refund: Pick<RefundRecord, "ticket_ids">): string {
  const n = refund.ticket_ids?.length ?? 0;
  if (n === 0) return "Whole order";
  return n === 1 ? "1 ticket" : `${n} tickets`;
}

/** Ticket line for the picker: why a ticket can't be chosen, or null when it can. */
export function ticketBlockedReason(ticket: StaffTicket): string | null {
  if (ticket.refund_pending) return "A refund for this ticket is already waiting";
  if (!ticket.refundable) return ticket.status === "REFUNDED" ? "Already refunded" : "Can't be refunded";
  return null;
}

export function canSendRefund(selectedCount: number, reasonCode: string): boolean {
  return selectedCount > 0 && reasonCode.length > 0;
}

/** Last 8 hex digits of the order id, the same reference the buyer sees at checkout. */
export function orderReferenceOf(orderId: string): string {
  return `CR-${orderId.replace(/-/g, "").slice(-8).toUpperCase()}`;
}
