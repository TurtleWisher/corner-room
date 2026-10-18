"use client";

/*
 * Refunds on Staff -> Commerce (owner, 2026-10-18: D-REF-01, Q-COM-01, Q-COM-02). Find an order by
 * the reference the buyer sees (CR-1A2B3C4D), tick the tickets to refund (or refund what is left on
 * a non-ticket order), pick a reason and send it for finance approval; then approve and complete.
 * The server works out every amount, checks finance.post in the order's label (another label's
 * order reads as "not found") and decides every status. Nothing here computes money.
 */

import { FormEvent, useRef, useState } from "react";

import { DateTime, Field, Money, StatusChip } from "@/components/ds";
import { Button, Card, EmptyState, ErrorState, Input, LoadingState, selectClasses } from "@/components/staff/kit";
import { useAsync } from "@/components/use-async";
import {
  approveRefund,
  completeManualRefund,
  completeSandboxRefund,
  fetchRefundReasons,
  fetchStaffRefunds,
  lookupStaffOrder,
  requestRemainingRefund,
  requestTicketRefund,
  type RefundReason,
  type RefundRecord,
  type StaffOrder,
} from "@/features/commerce/api";
import { ApiError } from "@/lib/api/client";
import {
  canSendRefund,
  normalizeReference,
  orderReferenceOf,
  reasonLabel,
  refundActions,
  refundScope,
  ticketBlockedReason,
} from "@/lib/refund-view";

function newKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

function message(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

function RefundRow({ refund, reasons, onChanged }: { refund: RefundRecord; reasons: RefundReason[]; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payout, setPayout] = useState("");
  // Test payments are completed by the test button; real Bangla QR money is sent back by hand.
  const byHand = Boolean(refund.payment_provider && refund.payment_provider !== "sandbox");

  async function act(action: "approve" | "complete") {
    setBusy(true);
    setError(null);
    try {
      await (action === "approve"
        ? approveRefund(refund.id)
        : byHand
          ? completeManualRefund(refund.id, payout.trim())
          : completeSandboxRefund(refund.id));
      onChanged();
    } catch (err) {
      setError(message(err, "That step could not be saved."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="border-t border-line py-3 first:border-t-0">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="text-sm text-fg">
          {refund.order_id ? <span className="cr-num mr-2 text-fg-muted">{orderReferenceOf(refund.order_id)}</span> : null}
          {reasonLabel(refund.reason_code, reasons)} · {refundScope(refund)} <StatusChip value={refund.status} />
        </p>
        <Money value={{ amount_minor: refund.amount_minor, currency_code: refund.currency_code }} minorDigits="always" className="font-semibold text-fg" />
      </div>
      {refund.created_at ? (
        <p className="mt-1 text-xs text-fg-muted">
          Requested <DateTime value={refund.created_at} />
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap items-end gap-2">
        {refundActions(refund).includes("complete") && byHand ? (
          <Field label="Reference of the transfer you sent back" required className="min-w-[14rem] flex-1">
            {(c) => <Input {...c} value={payout} onChange={(e) => setPayout(e.target.value)} maxLength={80} autoComplete="off" />}
          </Field>
        ) : null}
        {refundActions(refund).map((action) => (
          <Button
            key={action}
            type="button"
            size="sm"
            variant={action === "approve" ? "default" : "outline"}
            disabled={busy || (action === "complete" && byHand && payout.trim().length < 4)}
            onClick={() => void act(action)}
          >
            {action === "approve" ? "Approve" : byHand ? "Mark as paid back" : "Mark as paid back (test)"}
          </Button>
        ))}
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </li>
  );
}

function OrderRefund({ order, reasons, onChanged }: { order: StaffOrder; reasons: RefundReason[]; onChanged: () => void }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  // One key per attempt: a double click or a retry after a network error can't create two refunds.
  const key = useRef(newKey());
  const perTicket = order.purpose === "TICKET";
  const nothingLeft = order.refunded_amount_minor >= order.total_amount_minor;

  function toggle(id: string) {
    setPicked((now) => (now.includes(id) ? now.filter((t) => t !== id) : [...now, id]));
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSent(null);
    try {
      const refund = perTicket
        ? await requestTicketRefund(order.id, picked, reason, key.current)
        : await requestRemainingRefund(order.id, reason, key.current);
      key.current = newKey();
      setPicked([]);
      setSent(`Sent for approval: ${refundScope(refund)}.`);
      onChanged();
    } catch (err) {
      setError(message(err, "The refund could not be sent."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h3 className="font-semibold text-fg">
          <span className="cr-num">{orderReferenceOf(order.id)}</span> <StatusChip value={order.status} />
        </h3>
        <Money value={{ amount_minor: order.total_amount_minor, currency_code: order.currency_code }} minorDigits="always" className="text-lg font-bold text-fg" />
      </div>
      <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <div>
          <dt className="inline text-fg-muted">Buyer </dt>
          <dd className="inline text-fg">{order.buyer_email ?? "Not available"}</dd>
        </div>
        <div>
          <dt className="inline text-fg-muted">Payment </dt>
          <dd className="inline text-fg">{order.payment_status ? <StatusChip value={order.payment_status} /> : "None"}</dd>
        </div>
        <div>
          <dt className="inline text-fg-muted">Refunded so far </dt>
          <dd className="inline text-fg">
            <Money value={{ amount_minor: order.refunded_amount_minor, currency_code: order.currency_code }} minorDigits="always" />
          </dd>
        </div>
        {order.created_at ? (
          <div>
            <dt className="inline text-fg-muted">Placed </dt>
            <dd className="inline text-fg">
              <DateTime value={order.created_at} />
            </dd>
          </div>
        ) : null}
      </dl>

      {order.payment_status !== "CAPTURED" ? (
        <p className="mt-4 text-sm text-fg-muted">Only a paid order can be refunded.</p>
      ) : nothingLeft ? (
        <p className="mt-4 text-sm text-fg-muted">This order is fully refunded.</p>
      ) : (
        <form onSubmit={send} className="mt-4 space-y-4">
          {perTicket ? (
            <fieldset>
              <legend className="mb-2 text-sm font-semibold text-fg">Tickets to refund</legend>
              <ul className="space-y-2">
                {order.tickets.map((ticket, index) => {
                  const blocked = ticketBlockedReason(ticket);
                  const boxId = `refund-ticket-${ticket.id}`;
                  return (
                    <li key={ticket.id} className="flex items-start gap-3">
                      <input
                        id={boxId}
                        type="checkbox"
                        className="cr-focus mt-1 size-4"
                        checked={picked.includes(ticket.id)}
                        disabled={blocked !== null}
                        onChange={() => toggle(ticket.id)}
                      />
                      <label htmlFor={boxId} className={`text-sm ${blocked ? "text-fg-muted" : "text-fg"}`}>
                        <span>
                          Ticket {index + 1} · {ticket.ticket_type_name ?? "Ticket"} ·{" "}
                          <Money value={{ amount_minor: ticket.unit_amount_minor, currency_code: ticket.currency_code }} minorDigits="always" />{" "}
                          <StatusChip value={ticket.status} />
                          {blocked ? <span className="block text-xs">{blocked}</span> : null}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-2 text-xs text-fg-muted">
                The refund is the price of the tickets you tick. Refunded tickets stop working at the door; a seat goes back on sale only while the event is still
                selling and has not started.
              </p>
            </fieldset>
          ) : (
            <p className="text-sm text-fg">Refunds everything still refundable on this order.</p>
          )}
          <Field label="Reason" required>
            {(c) => (
              <select {...c} className={selectClasses} value={reason} onChange={(e) => setReason(e.target.value)} required>
                <option value="">Choose a reason</option>
                {reasons.map((r) => (
                  <option key={r.reason_code} value={r.reason_code}>
                    {r.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Button type="submit" size="sm" disabled={busy || !canSendRefund(perTicket ? picked.length : 1, reason)}>
            {busy ? "Sending" : "Send for finance approval"}
          </Button>
        </form>
      )}
      {sent ? (
        <p role="status" className="mt-3 text-sm text-success">
          {sent}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      ) : null}
      {order.refunds.length > 0 ? (
        <div className="mt-5">
          <h4 className="text-sm font-semibold text-fg">Refunds on this order</h4>
          <ul className="mt-1">
            {order.refunds.map((r) => (
              <RefundRow key={r.id} refund={r} reasons={reasons} onChanged={onChanged} />
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}

export function Refunds() {
  const reasons = useAsync(fetchRefundReasons, []);
  const queue = useAsync(fetchStaffRefunds, []);
  const [reference, setReference] = useState("");
  const [order, setOrder] = useState<StaffOrder | null>(null);
  const [finding, setFinding] = useState(false);
  const [findError, setFindError] = useState<string | null>(null);

  async function find(ref: string) {
    setFinding(true);
    setFindError(null);
    try {
      setOrder(await lookupStaffOrder(ref));
    } catch (err) {
      setOrder(null);
      setFindError(err instanceof ApiError && err.status === 404 ? "No order with that reference in this workspace." : message(err, "The order could not be loaded."));
    } finally {
      setFinding(false);
    }
  }

  async function onFind(event: FormEvent) {
    event.preventDefault();
    const ref = normalizeReference(reference);
    if (!ref) {
      setFindError("An order reference looks like CR-1A2B3C4D.");
      return;
    }
    await find(ref);
  }

  function refreshAll() {
    queue.reload();
    if (order) void find(orderReferenceOf(order.id));
  }

  const reasonList = reasons.status === "ok" ? reasons.data : [];

  return (
    <section aria-labelledby="refunds-title" className="space-y-4">
      <h2 id="refunds-title" className="text-lg font-semibold text-fg">
        Refunds
      </h2>
      <p className="text-sm text-fg-muted">Every refund needs a finance approval before money moves.</p>

      <Card>
        <h3 className="text-sm font-semibold text-fg">Waiting for approval or payment</h3>
        {queue.status === "loading" ? (
          <LoadingState label="Loading refunds" />
        ) : queue.status === "error" ? (
          <ErrorState title="Refunds" message={message(queue.error, "Refunds could not be loaded.")} />
        ) : queue.data.length === 0 ? (
          <EmptyState message="No refunds are waiting." />
        ) : (
          <ul className="mt-1">
            {queue.data.map((r) => (
              <RefundRow key={r.id} refund={r} reasons={reasonList} onChanged={refreshAll} />
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <form onSubmit={onFind} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <Field label="Order reference" hint="The buyer sees it at checkout and in their orders, like CR-1A2B3C4D.">
            {(c) => <Input {...c} value={reference} onChange={(e) => setReference(e.target.value)} autoComplete="off" spellCheck={false} />}
          </Field>
          <Button type="submit" size="sm" disabled={finding}>
            {finding ? "Finding" : "Find order"}
          </Button>
        </form>
        {findError ? (
          <p role="alert" className="mt-3 text-sm text-danger">
            {findError}
          </p>
        ) : null}
      </Card>

      {reasons.status === "ok" && reasons.data.length === 0 ? (
        <ErrorState title="No refund reasons" message="No refund reasons are set up yet, so refunds can't be sent." />
      ) : null}
      {order ? <OrderRefund key={order.id} order={order} reasons={reasonList} onChanged={refreshAll} /> : null}
    </section>
  );
}
