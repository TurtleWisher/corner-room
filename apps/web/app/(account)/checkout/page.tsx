"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { CircleCheck, LogIn } from "lucide-react";

import { useAuth } from "@/components/auth-provider";
import { LitSurface } from "@/components/brand/corner-light";
import { RoomCube } from "@/components/brand/room-cube";
import { Button, ButtonLink, Card, ErrorState, Field, Input, Money, Skeleton, StatusChip } from "@/components/ds";
import { RetryButton } from "@/components/shell/staff-panel";
import { friendlyError } from "@/lib/error-copy";
import { loadErrorMessage, useAsync } from "@/components/use-async";
import {
  createCatalogOrder,
  createHold,
  createOrder,
  createSubscriptionOrder,
  fetchEvent,
  fetchEventTicketTypes,
  fetchMyEntitlements,
  fetchMySubscriptions,
  fetchOffers,
  fetchSubscriptionPlans,
  sandboxConfirmPayment,
  type EntitlementRecord,
  type OrderRecord,
} from "@/lib/api";
import { cityFromTimeZone } from "@/lib/home-view";
import { hasCatalogAccess, ownsTrack } from "@/lib/ownership";
import { ORDER_STATUS, PAYMENT_STATUS } from "@/lib/status-maps";
import {
  afterPurchaseHref,
  checkoutItemFromParams,
  intervalLabel,
  offerTitle,
  planName,
  productKind,
  trialLabel,
  type CheckoutItem,
} from "@/lib/store-view";

type Summary = {
  title: string;
  kind: string;
  price: { amount_minor: number; currency_code: string } | null;
  note: string | null;
  tone: "sky" | "ember";
  /** Secondary word for the cube's side face (city for events); defaults to the title. */
  side?: string;
  /** For music offers: what is being bought, to check ownership and route after paying. */
  offer?: { product_type: string | null; subject_id?: string | null };
};

function alreadyOwns(entitlements: EntitlementRecord[], offer: NonNullable<Summary["offer"]>): boolean {
  if (offer.product_type === "TRACK" && offer.subject_id) return ownsTrack(entitlements, offer.subject_id);
  if (offer.product_type === "CATALOG_ACCESS") return hasCatalogAccess(entitlements);
  return false;
}

function newKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `checkout-${Date.now()}`;
}

async function loadSummary(item: CheckoutItem): Promise<Summary | null> {
  if (item.kind === "offer") {
    const offer = (await fetchOffers()).items.find((o) => o.id === item.id);
    if (!offer) return null;
    return {
      title: offerTitle(offer),
      kind: productKind(offer.product_type),
      price: { amount_minor: offer.amount_minor, currency_code: offer.currency_code },
      note: null,
      tone: "sky",
      offer: { product_type: offer.product_type, subject_id: offer.subject_id },
    };
  }
  if (item.kind === "plan") {
    const plan = (await fetchSubscriptionPlans()).items.find((p) => p.id === item.id);
    if (!plan) return null;
    return {
      title: planName(plan.key),
      kind: ["Subscription", intervalLabel(plan)?.replace("/ ", "every ")].filter(Boolean).join(", "),
      price: { amount_minor: plan.price_amount_minor, currency_code: plan.currency_code },
      note: trialLabel(plan),
      tone: "sky",
    };
  }
  // Ticket types are read through their event; without the event the order total still comes from the API.
  if (item.eventId) {
    const [event, types] = await Promise.all([fetchEvent(item.eventId, { skipAuth: true }), fetchEventTicketTypes(item.eventId, { skipAuth: true })]);
    const type = types.items.find((t) => t.id === item.id);
    if (!type) return null;
    return {
      title: event.title,
      kind: type.name,
      price: { amount_minor: type.price_amount_minor, currency_code: type.currency_code },
      note: "Price per ticket",
      tone: "ember",
      side: cityFromTimeZone(event.timezone) ?? event.title,
    };
  }
  return { title: "Tickets", kind: "Event tickets", price: null, note: null, tone: "ember" };
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main id="main" data-theme="ember" className="cr-scope">
      <LitSurface as="section" theme="ember" aria-labelledby="checkout-title" className="min-h-[70dvh]">
        <div className="mx-auto max-w-3xl px-4 py-12 md:py-16">
          <p className="cr-eyebrow text-highlight">Checkout</p>
          <h1 id="checkout-title" className="mt-3 text-3xl font-bold text-fg md:text-4xl">
            Review and pay
          </h1>
          <div className="mt-8">{children}</div>
        </div>
      </LitSurface>
    </main>
  );
}

function OrderPanel({ order, item, offer, onConfirm, busy }: { order: OrderRecord; item: CheckoutItem; offer?: Summary["offer"]; onConfirm: () => void; busy: boolean }) {
  const total = { amount_minor: order.total_amount_minor, currency_code: order.currency_code };
  const next = afterPurchaseHref(item, offer);
  if (order.status === "FULFILLED") {
    return (
      <Card className="p-6" role="status">
        <p className="flex items-center gap-2 text-xl font-bold text-fg">
          <CircleCheck aria-hidden="true" className="size-6 text-success" /> You&apos;re all set
        </p>
        <p className="mt-2 text-sm text-fg">
          Paid <Money value={total} minorDigits="always" />. Your order is complete.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <ButtonLink href={next.href}>{next.label}</ButtonLink>
          <ButtonLink href={item.kind === "tickets" ? "/discover" : "/purchases"} variant="secondary">
            {item.kind === "tickets" ? "More events" : "Your purchases"}
          </ButtonLink>
        </div>
      </Card>
    );
  }
  return (
    <Card className="p-6">
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
        <dt className="text-fg-muted">Order</dt>
        <dd>
          <StatusChip value={order.status} map={ORDER_STATUS} />
        </dd>
        <dt className="text-fg-muted">Payment</dt>
        <dd>
          <StatusChip value={order.payment?.status} map={PAYMENT_STATUS} />
        </dd>
        <dt className="text-fg-muted">Total</dt>
        <dd className="font-semibold text-fg">
          <Money value={total} minorDigits="always" />
        </dd>
      </dl>
      {order.payment?.status === "REQUIRES_ACTION" ? (
        <div className="mt-6 border-t border-line pt-5">
          <p className="text-sm text-fg">
            Payments run on a test provider for now. Confirming completes the order; no card is charged.
          </p>
          <Button className="mt-4" busy={busy} onClick={onConfirm}>
            Confirm payment
          </Button>
        </div>
      ) : (
        <p className="mt-5 text-sm text-fg-muted">We will update this order when the payment is confirmed.</p>
      )}
    </Card>
  );
}

function CheckoutBody() {
  const params = useSearchParams();
  const item = useMemo(() => checkoutItemFromParams(params), [params]);
  const { status } = useAuth();
  const key = useMemo(newKey, []);
  const [quantity, setQuantity] = useState("1");
  const [order, setOrder] = useState<OrderRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const summary = useAsync(() => (item ? loadSummary(item) : Promise.resolve(null)), [item?.kind, item?.id]);
  const owned = useAsync(
    () =>
      item?.kind === "offer" && status === "authenticated" ? fetchMyEntitlements().then((p) => p.items).catch(() => []) : Promise.resolve([]),
    [item?.kind, item?.id, status],
  );
  const existingPlan = useAsync(
    () =>
      item?.kind === "plan" && status === "authenticated"
        ? fetchMySubscriptions().then((p) => p.items.some((s) => ["TRIALING", "ACTIVE", "PAST_DUE"].includes(s.status)))
        : Promise.resolve(false),
    [item?.kind, status],
  );

  if (!item) {
    return (
      <Card className="p-6">
        <p className="text-fg">There is nothing to check out.</p>
        <ButtonLink href="/store" className="mt-4">
          Go to the Store
        </ButtonLink>
      </Card>
    );
  }

  if (status === "loading") return <Skeleton className="h-48 w-full" />;
  if (status !== "authenticated") {
    const here = `/checkout?${params.toString()}`;
    return (
      <Card className="p-6">
        <p className="text-fg">Sign in to finish your order.</p>
        <ButtonLink href={`/login?next=${encodeURIComponent(here)}`} className="mt-4">
          <LogIn aria-hidden="true" /> Sign in
        </ButtonLink>
      </Card>
    );
  }

  async function place() {
    if (!item) return;
    setError(null);
    setBusy(true);
    try {
      if (item.kind === "offer") setOrder(await createCatalogOrder(item.id, key));
      else if (item.kind === "plan") setOrder(await createSubscriptionOrder(item.id, key));
      else {
        const hold = await createHold(item.id, Number.parseInt(quantity, 10));
        setOrder(await createOrder(hold.id, key));
      }
    } catch (err) {
      setError(friendlyError(err, "Your order could not be placed. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!order?.payment?.id) return;
    setError(null);
    setBusy(true);
    try {
      setOrder(await sandboxConfirmPayment(order.payment.id));
    } catch (err) {
      setError(friendlyError(err, "The payment could not be confirmed. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {summary.status === "loading" ? (
        <Skeleton className="h-40 w-full" />
      ) : summary.status === "error" ? (
        <ErrorState message={loadErrorMessage(summary.error, "this item")} action={<RetryButton onClick={summary.reload} />} />
      ) : !summary.data ? (
        <Card className="p-6">
          <p className="text-fg">This item is no longer on sale.</p>
          <ButtonLink href="/store" variant="secondary" className="mt-4">
            Back to the Store
          </ButtonLink>
        </Card>
      ) : (
        <Card className="grid gap-6 p-6 sm:grid-cols-[8rem_1fr] sm:items-center">
          <RoomCube front={summary.data.title} side={summary.data.side ?? summary.data.title} tone={summary.data.tone} label="" className="w-32" />
          <div>
            <p className="text-xs text-fg-muted">{summary.data.kind}</p>
            <h2 className="mt-1 text-xl font-bold text-fg">{summary.data.title}</h2>
            {summary.data.price ? (
              <p className="mt-2">
                <Money value={summary.data.price} minorDigits="always" variant="display" className="text-3xl text-highlight" />
              </p>
            ) : null}
            {summary.data.note ? <p className="mt-1 text-sm text-fg">{summary.data.note}</p> : null}
            {item.kind === "tickets" && !order ? (
              <div className="mt-4 max-w-[8rem]">
                <Field label="Quantity">
                  {(c) => <Input {...c} inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} />}
                </Field>
              </div>
            ) : null}
          </div>
        </Card>
      )}

      {error ? <ErrorState title="Something went wrong" message={error} /> : null}

      {order ? (
        <OrderPanel order={order} item={item} offer={summary.status === "ok" ? summary.data?.offer : undefined} onConfirm={() => void confirm()} busy={busy} />
      ) : summary.status === "ok" && summary.data?.offer && owned.status === "ok" && alreadyOwns(owned.data, summary.data.offer) ? (
        <Card className="p-6">
          <p className="font-semibold text-fg">
            {summary.data.offer.product_type === "TRACK" ? "You already own this track." : "You already have the full catalog."}
          </p>
          <ButtonLink href={afterPurchaseHref(item, summary.data.offer).href} className="mt-4">
            Listen now
          </ButtonLink>
        </Card>
      ) : existingPlan.status === "ok" && existingPlan.data ? (
        <Card className="p-6">
          <p className="font-semibold text-fg">You already have an active subscription.</p>
          <p className="mt-1 text-sm text-fg-muted">One plan covers the whole catalog.</p>
          <ButtonLink href="/subscriptions" variant="secondary" className="mt-4">
            View your subscription
          </ButtonLink>
        </Card>
      ) : summary.status === "ok" && summary.data ? (
        <div className="flex flex-wrap items-center gap-4">
          <Button size="lg" busy={busy} onClick={() => void place()}>
            Place order
          </Button>
          <Link href="/store" className="cr-focus text-sm font-semibold text-fg-muted hover:text-fg">
            Cancel
          </Link>
        </div>
      ) : null}
    </div>
  );
}

export default function CheckoutPage() {
  return (
    <Shell>
      <Suspense fallback={<Skeleton className="h-48 w-full" />}>
        <CheckoutBody />
      </Suspense>
    </Shell>
  );
}
