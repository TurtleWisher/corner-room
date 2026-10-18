"use client";

/*
 * Bangla QR payment checks on Staff -> Commerce (owner, 2026-10-18: Q-PAY-01 "staff first",
 * Q-PAY-05). Each row is what a buyer sent after paying: the app, the transaction ID and the number
 * paid from. Finance staff find it on the statement and confirm (the order completes) or reject
 * with a reason the buyer sees (they may fix and resend). The server checks finance.post in the
 * order's label and captures the payment; nothing here decides money.
 */

import { useState } from "react";

import { DateTime, Field, Input, Money } from "@/components/ds";
import { Button, Card, EmptyState, ErrorState, LoadingState } from "@/components/staff/kit";
import { useAsync } from "@/components/use-async";
import { confirmSubmission, fetchStaffSubmissions, rejectSubmission, type StaffSubmission } from "@/features/commerce/api";
import { ApiError } from "@/lib/api/client";
import { paidWithLabel } from "@/lib/checkout-view";
import { orderReferenceOf } from "@/lib/refund-view";

function CheckRow({ row, onDone }: { row: StaffSubmission; onDone: () => void }) {
  const [busy, setBusy] = useState<"confirm" | "reject" | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function act(kind: "confirm" | "reject") {
    setBusy(kind);
    setError(null);
    try {
      await (kind === "confirm" ? confirmSubmission(row.id) : rejectSubmission(row.id, reason.trim()));
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That could not be saved.");
      setBusy(null);
    }
  }

  return (
    <li className="border-t border-line py-4 first:border-t-0">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="text-sm text-fg">
          <span className="cr-num mr-2 text-fg-muted">{orderReferenceOf(row.order_id)}</span>
          {paidWithLabel(row.paid_with)} · {row.purpose === "TICKET" ? "Tickets" : row.purpose === "SUBSCRIPTION" ? "Subscription" : "Music"}
        </p>
        <Money value={{ amount_minor: row.amount_minor, currency_code: row.currency_code }} minorDigits="always" className="text-lg font-bold text-fg" />
      </div>
      <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <div>
          <dt className="inline text-fg-muted">Transaction ID </dt>
          <dd className="cr-num inline text-fg">{row.transaction_ref}</dd>
        </div>
        <div>
          <dt className="inline text-fg-muted">Paid from </dt>
          <dd className="cr-num inline text-fg">{row.paid_from}</dd>
        </div>
        <div>
          <dt className="inline text-fg-muted">Buyer </dt>
          <dd className="inline text-fg">{row.buyer_email ?? "Not available"}</dd>
        </div>
        <div>
          <dt className="inline text-fg-muted">Sent </dt>
          <dd className="inline text-fg">
            <DateTime value={row.submitted_at} />
          </dd>
        </div>
      </dl>
      {rejecting ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end">
          <Field label="Reason the buyer will see" required>
            {(c) => <Input {...c} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="Transaction ID not found on the statement" />}
          </Field>
          <Button type="button" size="sm" variant="outline" disabled={busy !== null || !reason.trim()} onClick={() => void act("reject")}>
            {busy === "reject" ? "Sending" : "Send rejection"}
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={busy !== null} onClick={() => setRejecting(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" size="sm" disabled={busy !== null} onClick={() => void act("confirm")}>
            {busy === "confirm" ? "Confirming" : "Found it: confirm payment"}
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={() => setRejecting(true)}>
            Not found: reject
          </Button>
        </div>
      )}
      {error ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </li>
  );
}

export function PaymentChecks() {
  const queue = useAsync(fetchStaffSubmissions, []);
  return (
    <section aria-labelledby="payment-checks-title" className="space-y-3">
      <h2 id="payment-checks-title" className="text-lg font-semibold text-fg">
        Bangla QR payment checks
      </h2>
      <p className="text-sm text-fg-muted">
        Find each payment on the bKash, Nagad, Rocket, Upay or bank statement before confirming. Confirming completes the order; a rejection shows your reason
        to the buyer, who can send the details again.
      </p>
      <Card>
        {queue.status === "loading" ? (
          <LoadingState label="Loading payment checks" />
        ) : queue.status === "error" ? (
          <ErrorState title="Payment checks" message={queue.error instanceof ApiError ? queue.error.message : "Payment checks could not be loaded."} />
        ) : queue.data.length === 0 ? (
          <EmptyState message="No payments are waiting to be checked." />
        ) : (
          <ul>
            {queue.data.map((row) => (
              <CheckRow key={row.id} row={row} onDone={queue.reload} />
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}
