"use client";

/*
 * Bangla QR payment checks on Staff -> Commerce (owner, 2026-10-18: Q-PAY-01 "staff first",
 * Q-PAY-05). Each row is what a buyer sent after paying: the app, the transaction ID and the number
 * paid from. Finance staff find it on the statement and confirm (the order completes) or reject
 * with a reason the buyer sees (they may fix and resend). The server checks finance.post in the
 * order's label and captures the payment; nothing here decides money.
 *
 * Owner, 2026-10-28 (D-CUSTOMERS-02): Confirmed and Rejected tabs keep past decisions visible, with
 * the reason given and when, so a payment never disappears once it has been checked.
 */

import { useState } from "react";

import { DateTime, Field, Input, Money } from "@/components/ds";
import { Button, Card, EmptyState, ErrorState, LoadingState } from "@/components/staff/kit";
import { useAsync } from "@/components/use-async";
import { confirmSubmission, fetchStaffSubmissions, rejectSubmission, type StaffSubmission, type SubmissionQueue } from "@/features/commerce/api";
import { ApiError } from "@/lib/api/client";
import { paidWithLabel } from "@/lib/checkout-view";
import { orderReferenceOf } from "@/lib/refund-view";

function CheckRow({ row, onDone, decided = false }: { row: StaffSubmission; onDone: () => void; decided?: boolean }) {
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
        {decided ? (
          <div>
            <dt className="inline text-fg-muted">{row.status === "REJECTED" ? "Rejected " : "Confirmed "}</dt>
            <dd className="inline text-fg">{row.decided_at ? <DateTime value={row.decided_at} /> : "Not available"}</dd>
          </div>
        ) : null}
        {decided && row.decision_note ? (
          <div className="sm:col-span-2">
            <dt className="inline text-fg-muted">Reason given </dt>
            <dd className="inline text-fg">{row.decision_note}</dd>
          </div>
        ) : null}
      </dl>
      {decided ? null : rejecting ? (
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

const TABS: { value: SubmissionQueue; label: string }[] = [
  { value: "SUBMITTED", label: "Waiting" },
  { value: "CONFIRMED", label: "Confirmed" },
  { value: "REJECTED", label: "Rejected" },
];

export function PaymentChecks() {
  const [tab, setTab] = useState<SubmissionQueue>("SUBMITTED");
  const queue = useAsync(() => fetchStaffSubmissions(tab), [tab]);
  const decided = tab !== "SUBMITTED";
  return (
    <section aria-labelledby="payment-checks-title" className="space-y-3">
      <h2 id="payment-checks-title" className="text-lg font-semibold text-fg">
        Bangla QR payment checks
      </h2>
      <p className="text-sm text-fg-muted">
        Find each payment on the bKash, Nagad, Rocket, Upay or bank statement before confirming. Confirming completes the order; a rejection shows your reason
        to the buyer, who can send the details again.
      </p>
      <div role="tablist" aria-label="Payment checks" className="flex gap-1 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={tab === t.value}
            onClick={() => setTab(t.value)}
            className={`cr-focus -mb-px border-b-2 px-3 py-2 text-sm font-semibold ${tab === t.value ? "border-accent text-fg" : "border-transparent text-fg-muted hover:text-fg"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <Card>
        {queue.status === "loading" ? (
          <LoadingState label="Loading payment checks" />
        ) : queue.status === "error" ? (
          <ErrorState title="Payment checks" message={queue.error instanceof ApiError ? queue.error.message : "Payment checks could not be loaded."} />
        ) : queue.data.length === 0 ? (
          <EmptyState
            message={tab === "SUBMITTED" ? "No payments are waiting to be checked." : tab === "CONFIRMED" ? "No confirmed payments yet." : "No rejected payments."}
          />
        ) : (
          <ul>
            {queue.data.map((row) => (
              <CheckRow key={row.id} row={row} onDone={queue.reload} decided={decided} />
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}
