"use client";

import Link from "next/link";
import { useState } from "react";
import { CircleAlert, CircleCheck, Clock, FlaskConical, LoaderCircle, RefreshCw } from "lucide-react";

import { Button, ButtonLink, Card, Money } from "@/components/ds";
import { sandboxConfirmPayment, type OrderRecord } from "@/lib/api";
import {
  formatCountdown,
  orderReference,
  paymentPresentation,
  secondsLeft,
  type PurchaseStage,
} from "@/lib/checkout-view";
import { friendlyError } from "@/lib/error-copy";

/*
 * The shared payment step for every purchase (tickets, tracks, plans). It shows what the server
 * says: the amount, the method, the reservation clock and the status. Showing the QR, opening this
 * page or pressing a button never marks anything as paid.
 */

const METHOD_NAME = "Bangla QR";

/** A clearly marked stand-in until the real QR is supplied. Deliberately not a QR pattern. */
function SampleCode() {
  return (
    <div className="relative grid aspect-square w-full place-items-center border-2 border-dashed border-line-strong bg-surface-sunken p-6 text-center">
      {["left-2 top-2 border-l-2 border-t-2", "right-2 top-2 border-r-2 border-t-2", "bottom-2 left-2 border-b-2 border-l-2", "bottom-2 right-2 border-b-2 border-r-2"].map((c) => (
        <span key={c} aria-hidden="true" className={`absolute size-6 border-fg-muted ${c}`} />
      ))}
      <div>
        <p className="cr-eyebrow text-highlight">Sample</p>
        <p className="mt-2 text-sm font-semibold text-fg">The Bangla QR code goes here</p>
        <p className="mt-1 text-xs text-fg-muted">Not a payment code. Nothing to scan yet.</p>
      </div>
    </div>
  );
}

function StageLine({ stage, order }: { stage: PurchaseStage; order: OrderRecord }) {
  const lateAfterExpiry = order.hold_status === "EXPIRED" || order.hold_status === "RELEASED";
  const lines: Record<PurchaseStage, { icon: typeof Clock; text: string; tone: string }> = {
    awaiting_payment: { icon: LoaderCircle, text: "Waiting for your payment. This page updates by itself.", tone: "text-fg" },
    expired: {
      icon: Clock,
      text: "Your reservation has run out. If you already paid, keep this page open: we will still confirm it.",
      tone: "text-warning",
    },
    failed: { icon: CircleAlert, text: "The payment did not go through.", tone: "text-danger" },
    cancelled: { icon: CircleAlert, text: "This order was cancelled.", tone: "text-danger" },
    paid_processing: {
      icon: LoaderCircle,
      text: lateAfterExpiry
        ? "Payment received after your reservation ran out. Our team will sort out your order; you do not need to pay again."
        : "Payment received. We are finishing your order.",
      tone: "text-fg",
    },
    complete: { icon: CircleCheck, text: "Payment confirmed.", tone: "text-success" },
    refunded: { icon: CircleCheck, text: "This order was refunded.", tone: "text-fg" },
    partly_refunded: { icon: CircleCheck, text: "Part of this order was refunded.", tone: "text-fg" },
  };
  const { icon: Icon, text, tone } = lines[stage];
  const spinning = stage === "awaiting_payment" || stage === "paid_processing";
  return (
    <p role="status" aria-live="polite" className={`flex items-start gap-2 text-sm ${tone}`}>
      <Icon aria-hidden="true" className={`mt-0.5 size-4 shrink-0 ${spinning ? "animate-spin motion-reduce:animate-none" : ""}`} />
      <span>{text}</span>
    </p>
  );
}

export function PaymentPanel({
  order,
  stage,
  now,
  onOrder,
  onRefresh,
  restartHref,
}: {
  order: OrderRecord;
  stage: PurchaseStage;
  now: number;
  onOrder: (next: OrderRecord) => void;
  onRefresh: () => Promise<void>;
  /** Where to start a fresh purchase after expiry, failure or cancellation. */
  restartHref: string;
}) {
  const [busy, setBusy] = useState<"confirm" | "refresh" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const total = { amount_minor: order.total_amount_minor, currency_code: order.currency_code };
  const presentation = paymentPresentation(order);
  const left = stage === "awaiting_payment" ? secondsLeft(order.hold_expires_at, now) : null;
  // Once the reservation has run out the code is hidden: paying then would only create a late payment.
  const payable = stage === "awaiting_payment";

  async function confirmTest() {
    if (!order.payment) return;
    setError(null);
    setBusy("confirm");
    try {
      onOrder(await sandboxConfirmPayment(order.payment.id));
    } catch (err) {
      setError(friendlyError(err, "The test payment could not be completed. Please try again."));
      await onRefresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card as="section" aria-labelledby="pay-title" className="p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="pay-title" className="text-lg font-bold text-fg">
          Pay with {METHOD_NAME}
        </h2>
        <p className="text-xs text-fg-muted">
          Reference <span className="cr-num text-sm text-fg">{orderReference(order.id)}</span>
        </p>
      </div>

      <p className="mt-4 text-xs text-fg-muted">Amount to pay</p>
      <p>
        <Money value={total} minorDigits="always" variant="display" className="text-4xl text-highlight" />
      </p>

      {left !== null ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-fg">
          <Clock aria-hidden="true" className="size-4 text-highlight" />
          Seats held for <span className="cr-num text-base" aria-label={`${Math.floor(left / 60)} minutes ${left % 60} seconds`}>{formatCountdown(left)}</span>
        </p>
      ) : null}

      {payable ? (
        <div className="mt-6 grid gap-6 sm:grid-cols-[minmax(0,13rem)_1fr] sm:items-start">
          <div className="mx-auto w-full max-w-[13rem]">
            {presentation.kind === "qr" ? (
              <div className="cr-qr-tile">
                {/* eslint-disable-next-line @next/next/no-img-element -- the QR must be served exactly as supplied */}
                <img src={presentation.src} alt={`${METHOD_NAME} payment code`} />
              </div>
            ) : presentation.kind === "sample" ? (
              <SampleCode />
            ) : (
              <p className="border border-line p-4 text-sm text-fg">{METHOD_NAME} is not available yet. Please check back soon.</p>
            )}
          </div>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-fg marker:text-fg-muted">
            <li>Open your mobile banking or wallet app and scan the code.</li>
            <li>
              Pay exactly <Money value={total} minorDigits="always" />.
            </li>
            <li>Keep this page open. It updates by itself when the payment is confirmed.</li>
          </ol>
        </div>
      ) : null}

      <div className="mt-6 border-t border-line pt-5">
        <StageLine stage={stage} order={order} />
        {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {payable && order.payment?.self_confirm_available ? (
            <Button busy={busy === "confirm"} onClick={() => void confirmTest()}>
              <FlaskConical aria-hidden="true" /> Complete test payment
            </Button>
          ) : null}
          {stage === "awaiting_payment" || stage === "paid_processing" || stage === "expired" ? (
            <Button
              variant="ghost"
              size="sm"
              busy={busy === "refresh"}
              onClick={async () => {
                setBusy("refresh");
                await onRefresh();
                setBusy(null);
              }}
            >
              <RefreshCw aria-hidden="true" /> Check now
            </Button>
          ) : null}
          {stage === "expired" || stage === "failed" || stage === "cancelled" ? (
            <ButtonLink href={restartHref} variant="secondary" size="sm">
              Start again
            </ButtonLink>
          ) : null}
        </div>
        {payable && order.payment?.mode !== "live" ? (
          <p className="mt-4 text-xs text-fg-muted">
            Test mode: no real money moves on this server.{" "}
            <Link href="/orders" className="cr-focus underline">
              Your orders
            </Link>
          </p>
        ) : null}
      </div>
    </Card>
  );
}
