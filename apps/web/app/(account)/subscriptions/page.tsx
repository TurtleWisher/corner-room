"use client";

import { useState } from "react";
import { ShoppingBag } from "lucide-react";

import { Button, ButtonLink, EmptyState, ErrorState, Money, Skeleton, StatusChip } from "@/components/ds";
import { DateTime } from "@/components/ds/date-time";
import { Dialog } from "@/components/ds/dialog";
import { AccountPage } from "@/components/shell/account-page";
import { RetryButton } from "@/components/shell/staff-panel";
import { friendlyError } from "@/lib/error-copy";
import { loadErrorMessage, useAsync } from "@/components/use-async";
import { cancelSubscription, fetchMySubscriptions, fetchSubscriptionPlans, type PlanRecord, type SubscriptionRecord } from "@/lib/api";
import { SUBSCRIPTION_STATUS } from "@/lib/status-maps";
import { intervalLabel, planName } from "@/lib/store-view";

const ENDED = new Set(["CANCELLED", "EXPIRED"]);

function SubscriptionRow({ row, plan, onCancel }: { row: SubscriptionRecord; plan: PlanRecord | undefined; onCancel: () => void }) {
  return (
    <li className="cr-cut flex flex-col gap-4 p-5 cr-glass-card sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-lg font-bold text-fg">{plan ? planName(plan.key) : "Plan"}</p>
          <StatusChip value={row.status} map={SUBSCRIPTION_STATUS} />
        </div>
        {plan ? (
          <p className="mt-1 text-sm text-fg">
            <Money value={{ amount_minor: plan.price_amount_minor, currency_code: plan.currency_code }} /> {intervalLabel(plan) ?? ""}
          </p>
        ) : null}
        <p className="mt-1 text-sm text-fg-muted">
          {row.period_ends_at ? (
            <>
              {row.cancel_at_period_end ? "Ends on " : "Current period ends "}
              <DateTime value={row.period_ends_at} format="date" />
            </>
          ) : (
            "Period end not available"
          )}
        </p>
      </div>
      {!ENDED.has(row.status) && !row.cancel_at_period_end ? (
        <Button variant="secondary" size="sm" onClick={onCancel}>
          Cancel subscription
        </Button>
      ) : null}
    </li>
  );
}

function Subscriptions() {
  const data = useAsync(
    () => Promise.all([fetchMySubscriptions(), fetchSubscriptionPlans().catch(() => ({ items: [] as PlanRecord[] }))]).then(([s, p]) => ({ subs: s.items, plans: p.items })),
    [],
  );
  const [confirming, setConfirming] = useState<SubscriptionRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel() {
    if (!confirming) return;
    setBusy(true);
    setError(null);
    try {
      await cancelSubscription(confirming.id);
      setConfirming(null);
      data.reload();
    } catch (err) {
      setError(friendlyError(err, "The subscription could not be cancelled. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  if (data.status === "loading") return <Skeleton className="h-40 w-full" />;
  if (data.status === "error") {
    return <ErrorState title="Subscriptions unavailable" message={loadErrorMessage(data.error, "your subscriptions")} action={<RetryButton onClick={data.reload} />} />;
  }
  const { subs, plans } = data.data;
  return (
    <>
      {subs.length === 0 ? (
        <EmptyState title="No subscription yet" body="A plan lets you listen across the catalog." action={<ButtonLink href="/store" size="sm">See plans</ButtonLink>} />
      ) : (
        <ul className="grid gap-3">
          {subs.map((row) => (
            <SubscriptionRow key={row.id} row={row} plan={plans.find((p) => p.id === row.plan_id)} onCancel={() => setConfirming(row)} />
          ))}
        </ul>
      )}
      <Dialog
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        title="Cancel this subscription?"
        description="You keep access until the end of the current period."
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setConfirming(null)}>
              Keep it
            </Button>
            <Button variant="danger" size="sm" busy={busy} onClick={() => void cancel()}>
              Cancel subscription
            </Button>
          </>
        }
      >
        {error ? (
          <p role="alert" className="text-danger">
            {error}
          </p>
        ) : null}
      </Dialog>
    </>
  );
}

export default function SubscriptionsPage() {
  return (
    <AccountPage
      eyebrow="Your account"
      title="Subscriptions"
      what="your subscriptions"
      actions={
        <ButtonLink href="/store" variant="secondary" size="sm">
          <ShoppingBag aria-hidden="true" /> Plans
        </ButtonLink>
      }
    >
      <Subscriptions />
    </AccountPage>
  );
}
