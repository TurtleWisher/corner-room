"use client";

import { Headphones, ShoppingBag } from "lucide-react";

import { OrdersTable } from "@/components/account/orders-table";
import { ButtonLink, EmptyState, ErrorState, Skeleton, StatusChip } from "@/components/ds";
import { DateTime } from "@/components/ds/date-time";
import { AccountPage } from "@/components/shell/account-page";
import { RetryButton } from "@/components/shell/staff-panel";
import { loadErrorMessage, useAsync } from "@/components/use-async";
import { fetchMyEntitlements, fetchMyOrders, fetchMySubscriptions, fetchSubscriptionPlans, fetchTrack, type EntitlementRecord } from "@/lib/api";
import { humanizeStatus } from "@/lib/format/status";
import { ENTITLEMENT_STATUS } from "@/lib/status-maps";
import { planName } from "@/lib/store-view";

const ENTITLEMENT_TYPE: Record<string, string> = {
  PURCHASE: "Bought",
  SUBSCRIPTION: "Subscription",
  ADMIN_GRANT: "Granted by Corner Room",
  PROMOTIONAL_GRANT: "Promotion",
};

type Owned = { ent: EntitlementRecord; title: string; href: string | null; action: string | null };

/**
 * Name each entitlement from what the API links it to: TRACK scope points at the track (its title);
 * a catalog purchase is the full catalog; a subscription points at the subscription (its plan).
 */
async function nameEntitlements(ents: EntitlementRecord[]): Promise<Owned[]> {
  const subs = ents.some((e) => e.entitlement_type === "SUBSCRIPTION")
    ? await Promise.all([fetchMySubscriptions().then((p) => p.items), fetchSubscriptionPlans().then((p) => p.items)]).catch(() => [[], []] as const)
    : ([[], []] as const);
  const [mySubs, plans] = subs;
  return Promise.all(
    ents.map(async (ent): Promise<Owned> => {
      if (ent.scope === "TRACK") {
        const track = await fetchTrack(ent.ref_id, { skipAuth: true }).catch(() => null);
        return { ent, title: track?.title ?? "Track", href: `/tracks/${ent.ref_id}`, action: "Listen" };
      }
      if (ent.entitlement_type === "SUBSCRIPTION") {
        const sub = mySubs.find((s) => s.id === ent.ref_id);
        const plan = sub ? plans.find((p) => p.id === sub.plan_id) : undefined;
        return { ent, title: plan ? planName(plan.key) : "Subscription", href: "/releases", action: "Listen" };
      }
      return { ent, title: "Full catalog", href: "/releases", action: "Listen" };
    }),
  );
}

function Purchases() {
  const data = useAsync(async () => {
    const [orders, ents] = await Promise.all([fetchMyOrders().then((p) => p.items), fetchMyEntitlements().then((p) => p.items)]);
    return { orders, owned: await nameEntitlements(ents) };
  }, []);
  if (data.status === "loading") return <Skeleton className="h-64 w-full" />;
  if (data.status === "error") {
    return <ErrorState title="Purchases unavailable" message={loadErrorMessage(data.error, "your purchases")} action={<RetryButton onClick={data.reload} />} />;
  }
  const { orders, owned } = data.data;
  return (
    <div className="space-y-12">
      <section aria-labelledby="owned">
        <h2 id="owned" className="mb-4 text-xl font-bold text-fg">
          What you own
        </h2>
        {owned.length === 0 ? (
          <EmptyState title="Nothing here yet" body="Music you buy or unlock with a plan shows up here." action={<ButtonLink href="/store" size="sm">Go to the Store</ButtonLink>} />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {owned.map(({ ent, title, href, action }) => (
              <li key={ent.id} className="cr-cut flex flex-col gap-2 p-5 cr-glass-card">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-lg font-bold text-fg">{title}</p>
                    <p className="text-xs text-fg-muted">{ENTITLEMENT_TYPE[ent.entitlement_type] ?? humanizeStatus(ent.entitlement_type)}</p>
                  </div>
                  <StatusChip value={ent.status} map={ENTITLEMENT_STATUS} />
                </div>
                <p className="text-xs text-fg-muted">
                  {ent.expires_at ? (
                    <>
                      Until <DateTime value={ent.expires_at} format="date" />
                    </>
                  ) : (
                    "No end date"
                  )}
                </p>
                {href && action && ent.status === "ACTIVE" ? (
                  <ButtonLink href={href} size="sm" variant="secondary" className="mt-2 self-start">
                    <Headphones aria-hidden="true" /> {action}
                  </ButtonLink>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="orders">
        <h2 id="orders" className="mb-4 text-xl font-bold text-fg">
          Orders
        </h2>
        {orders.length === 0 ? <EmptyState title="No orders yet" /> : <OrdersTable orders={orders} />}
      </section>
    </div>
  );
}

export default function PurchasesPage() {
  return (
    <AccountPage
      eyebrow="Your account"
      title="Purchases"
      what="your purchases"
      actions={
        <ButtonLink href="/store" variant="secondary" size="sm">
          <ShoppingBag aria-hidden="true" /> Store
        </ButtonLink>
      }
    >
      <Purchases />
    </AccountPage>
  );
}
