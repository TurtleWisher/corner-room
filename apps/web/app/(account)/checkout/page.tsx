"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { CircleCheck, LogIn } from "lucide-react";

import { useAuth } from "@/components/auth-provider";
import { LitSurface } from "@/components/brand/corner-light";
import { CoverArt } from "@/components/brand/cover-art";
import { RoomCube } from "@/components/brand/room-cube";
import { DeliveryAddressStep } from "@/components/checkout/delivery-address-step";
import { PaymentPanel } from "@/components/checkout/payment-panel";
import { PowerTransition } from "@/components/checkout/power-transition";
import { GenericSummary, MusicReceipt, TicketConfirmation, TicketSummary, TrackSummary } from "@/components/checkout/summaries";
import { useOrderStatus } from "@/components/checkout/use-order-status";
import { Button, ButtonLink, Card, ErrorState, Field, Input, Money, Skeleton } from "@/components/ds";
import { useCredits } from "@/components/music/credits";
import { RetryButton } from "@/components/shell/staff-panel";
import { maybeCoverUrl, offerCoverSource } from "@/lib/cover-view";
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
  fetchOrder,
  fetchRelease,
  fetchSubscriptionPlans,
  fetchTrack,
  type EntitlementRecord,
  type EventRecord,
  type OrderRecord,
  type ReleaseRecord,
  type TrackRecord,
} from "@/lib/api";
import { cityFromTimeZone } from "@/lib/home-view";
import { creditName } from "@/lib/music-view";
import { hasCatalogAccess, ownsRelease, ownsTrack } from "@/lib/ownership";
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
  if (offer.product_type === "RELEASE" && offer.subject_id) return ownsRelease(entitlements, offer.subject_id);
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
      note: "Price per ticket. We hold your seats while you pay.",
      tone: "ember",
      side: cityFromTimeZone(event.timezone) ?? event.title,
    };
  }
  return { title: "Tickets", kind: "Event tickets", price: null, note: null, tone: "ember" };
}

/** The page heading; each step names itself, so a finished order no longer says "Review and pay". */
function Heading({ children }: { children: React.ReactNode }) {
  return (
    <h1 id="checkout-title" className="mb-8 mt-3 text-3xl font-bold text-fg md:text-4xl">
      {children}
    </h1>
  );
}

function Shell({ children, theme = "ember" }: { children: React.ReactNode; theme?: "ember" | "sky" }) {
  return (
    <main id="main" data-theme={theme} data-module="ticketing" className="cr-scope">
      <LitSurface as="section" theme={theme} aria-labelledby="checkout-title" className="min-h-[70dvh]">
        <div className="mx-auto max-w-6xl px-4 py-12 md:px-6 md:py-16">
          <p className="cr-eyebrow text-highlight">Checkout</p>
          {children}
        </div>
      </LitSurface>
    </main>
  );
}

/* ---------- A placed order: the server's order drives everything ---------- */

type OrderContext =
  | { kind: "tickets"; event: EventRecord | null }
  | { kind: "track"; track: TrackRecord | null }
  | { kind: "release"; id: string; title: string; release: ReleaseRecord | null }
  | { kind: "other"; title: string };

async function loadOrderContext(order: OrderRecord): Promise<OrderContext> {
  const first = order.items?.[0];
  if (first?.item_type === "TICKET") {
    const event = first.event_id ? await fetchEvent(first.event_id, { skipAuth: true }).catch(() => null) : null;
    return { kind: "tickets", event };
  }
  if (first?.item_type === "TRACK") {
    const track = await fetchTrack(first.ref_id).catch(() => null);
    return track ? { kind: "track", track } : { kind: "other", title: "Music" };
  }
  if (first?.item_type === "RELEASE") {
    const release = await fetchRelease(first.ref_id).catch(() => null);
    return { kind: "release", id: first.ref_id, title: release?.title ?? first.release_title ?? "Your release", release };
  }
  return { kind: "other", title: order.purpose === "SUBSCRIPTION" ? "Subscription" : "Your order" };
}

function restartHref(order: OrderRecord, context: OrderContext | null): string {
  const first = order.items?.[0];
  if (first?.item_type === "TICKET" && first.event_id) return `/events/${first.event_id}`;
  if (context?.kind === "track" && context.track) return `/tracks/${context.track.id}`;
  if (context?.kind === "release") return `/releases/${context.id}`;
  return "/store";
}

function OrderCheckout({ initial }: { initial: OrderRecord }) {
  const status = useOrderStatus(initial);
  const { order, stage } = status;
  const context = useAsync(() => loadOrderContext(initial), [initial.id]);
  const credits = useCredits();
  const [moment, setMoment] = useState<"none" | "playing" | "done">("none");
  const ctx = context.status === "ok" ? context.data : null;
  const artist =
    ctx?.kind === "track" && ctx.track
      ? creditName(ctx.track, credits.artists, credits.bands)
      : ctx?.kind === "release" && ctx.release
        ? creditName(ctx.release, credits.artists, credits.bands)
        : null;
  const bought = ctx?.kind === "release" ? { id: ctx.id, title: ctx.title } : null;

  // The success moment plays once, and only because this page saw the server complete the order.
  if (status.celebrate && moment === "none") setMoment("playing");

  if (stage === "complete" && moment !== "playing") {
    return (
      <div className="mx-auto max-w-3xl">
        <Heading>{ctx?.kind === "tickets" ? "You're going" : "Thank you"}</Heading>
        {ctx?.kind === "tickets" ? (
          <TicketConfirmation order={order} event={ctx.event} />
        ) : ctx?.kind === "track" ? (
          <MusicReceipt order={order} track={ctx.track} artist={artist} />
        ) : ctx?.kind === "release" ? (
          <MusicReceipt order={order} track={null} release={bought} artist={artist} />
        ) : (
          <Card className="p-6" role="status">
            <p className="flex items-center gap-2 text-xl font-bold text-fg">
              <CircleCheck aria-hidden="true" className="size-6 text-success" /> You&apos;re all set
            </p>
            <p className="mt-2 text-sm text-fg">
              Paid <Money value={{ amount_minor: order.total_amount_minor, currency_code: order.currency_code }} minorDigits="always" />. Your order is complete.
            </p>
            <ButtonLink href="/purchases" className="mt-6">
              Your purchases
            </ButtonLink>
          </Card>
        )}
      </div>
    );
  }

  return (
    <>
      <Heading>
        {stage === "paid_processing"
          ? "Finishing your order"
          : stage === "awaiting_payment"
            ? "Review and pay"
            : stage === "verifying"
              ? "Checking your payment"
              : "Your order"}
      </Heading>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:gap-8">
        {ctx?.kind === "tickets" ? (
          <TicketSummary order={order} event={ctx.event} />
        ) : ctx?.kind === "track" ? (
          <TrackSummary order={order} track={ctx.track} artist={artist} />
        ) : ctx?.kind === "release" ? (
          <TrackSummary order={order} track={null} release={bought} artist={artist} />
        ) : ctx ? (
          <GenericSummary order={order} title={ctx.title} />
        ) : (
          <Skeleton className="h-64 w-full" />
        )}
        <PaymentPanel order={order} stage={stage} now={status.now} onOrder={status.setOrder} onRefresh={status.refresh} restartHref={restartHref(order, ctx)} />
      </div>
      <PowerTransition
        confirmed={moment === "playing"}
        title="Payment received"
        detail={
          ctx?.kind === "tickets"
            ? "Your tickets are ready."
            : ctx?.kind === "track" && ctx.track
              ? `${ctx.track.title} is in your library.`
              : ctx?.kind === "release"
                ? `${ctx.title} is in your library.`
                : "Your order is complete."
        }
        onDone={() => {
          setMoment("done");
          status.clearCelebrate();
        }}
      />
    </>
  );
}

function ResumeOrder({ orderId }: { orderId: string }) {
  const order = useAsync(() => fetchOrder(orderId), [orderId]);
  if (order.status === "loading") return <Skeleton className="mt-8 h-64 w-full" />;
  if (order.status === "error") {
    return (
      <Card className="mt-8 p-6">
        <h1 id="checkout-title" className="font-semibold text-fg">We could not find this order.</h1>
        <p className="mt-1 text-sm text-fg-muted">It may belong to another account, or the link is incomplete.</p>
        <ButtonLink href="/orders" variant="secondary" className="mt-4">
          Your orders
        </ButtonLink>
      </Card>
    );
  }
  return <OrderCheckout initial={order.data} />;
}

/* ---------- Before an order exists: choose, then reserve or continue ---------- */

function NewCheckout() {
  const params = useSearchParams();
  const router = useRouter();
  const item = useMemo(() => checkoutItemFromParams(params), [params]);
  const { status } = useAuth();
  const key = useMemo(newKey, []);
  const [quantity, setQuantity] = useState("1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // D-ADDR-01: the buyer confirms a Bangladesh delivery address before every payment.
  const [addressConfirmed, setAddressConfirmed] = useState(false);
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
      <>
        <Heading>Nothing to pay for</Heading>
        <Card className="p-6">
        <p className="text-fg">There is nothing to check out.</p>
        <ButtonLink href="/store" className="mt-4">
          Go to the Store
        </ButtonLink>
        </Card>
      </>
    );
  }

  if (status === "loading") return <Skeleton className="mt-8 h-48 w-full" />;
  if (status !== "authenticated") {
    const here = `/checkout?${params.toString()}`;
    return (
      <>
        <Heading>Review and pay</Heading>
        <Card className="p-6">
        <p className="text-fg">Sign in to finish your order.</p>
        <ButtonLink href={`/login?next=${encodeURIComponent(here)}`} className="mt-4">
          <LogIn aria-hidden="true" /> Sign in
        </ButtonLink>
        </Card>
      </>
    );
  }

  async function place() {
    if (!item) return;
    setError(null);
    setBusy(true);
    try {
      let order: OrderRecord;
      if (item.kind === "offer") order = await createCatalogOrder(item.id, key, addressConfirmed);
      else if (item.kind === "plan") order = await createSubscriptionOrder(item.id, key, addressConfirmed);
      else {
        const hold = await createHold(item.id, Number.parseInt(quantity, 10));
        order = await createOrder(hold.id, key, addressConfirmed);
      }
      // The order now lives at its own address, so a reload or a later visit resumes it.
      const world = item.kind === "tickets" ? "" : "&world=sky";
      router.replace(`/checkout?order=${order.id}${world}`);
    } catch (err) {
      setError(friendlyError(err, "Your order could not be placed. Please try again."));
      setBusy(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <Heading>Review and pay</Heading>
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
          <CoverArt
            src={maybeCoverUrl(summary.data.offer ? offerCoverSource(summary.data.offer.product_type, summary.data.offer.subject_id) : null, 160)}
            fallback={<RoomCube front={summary.data.title} side={summary.data.side ?? summary.data.title} tone={summary.data.tone} label="" className="w-32" />}
            className="w-32"
          />
          <div>
            <p className="text-xs text-fg-muted">{summary.data.kind}</p>
            <h2 className="mt-1 text-xl font-bold text-fg">{summary.data.title}</h2>
            {summary.data.price ? (
              <p className="mt-2">
                <Money value={summary.data.price} minorDigits="always" variant="display" className="text-3xl text-highlight" />
              </p>
            ) : null}
            {summary.data.note ? <p className="mt-1 text-sm text-fg">{summary.data.note}</p> : null}
            {item.kind === "tickets" ? (
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

      {summary.status === "ok" && summary.data?.offer && owned.status === "ok" && alreadyOwns(owned.data, summary.data.offer) ? (
        <Card className="p-6">
          <p className="font-semibold text-fg">
            {summary.data.offer.product_type === "TRACK"
              ? "You already own this track."
              : summary.data.offer.product_type === "RELEASE"
                ? "You already own this release."
                : "You already have the full catalog."}
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
        <>
          <DeliveryAddressStep confirmed={addressConfirmed} onConfirmedChange={setAddressConfirmed} />
          <div className="flex flex-wrap items-center gap-4">
            <Button size="lg" busy={busy} disabled={!addressConfirmed} onClick={() => void place()}>
              {item.kind === "tickets" ? "Reserve and pay" : "Continue to payment"}
            </Button>
            <Link href="/store" className="cr-focus text-sm font-semibold text-fg-muted hover:text-fg">
              Cancel
            </Link>
          </div>
          {!addressConfirmed ? <p className="text-sm text-fg-muted">Confirm where we can send gifts to continue.</p> : null}
        </>
      ) : null}
    </div>
  );
}

function CheckoutBody() {
  const params = useSearchParams();
  const orderId = params.get("order");
  const { status } = useAuth();
  if (!orderId) return <NewCheckout />;
  if (status === "loading") return <Skeleton className="mt-8 h-64 w-full" />;
  if (status !== "authenticated") {
    return (
      <>
        <Heading>Your order</Heading>
        <Card className="p-6">
        <p className="text-fg">Sign in to see this order.</p>
        <ButtonLink href={`/login?next=${encodeURIComponent(`/checkout?order=${orderId}`)}`} className="mt-4">
          <LogIn aria-hidden="true" /> Sign in
        </ButtonLink>
        </Card>
      </>
    );
  }
  return <ResumeOrder orderId={orderId} />;
}

function CheckoutFrame() {
  const params = useSearchParams();
  // Music offers, plans and music orders sit in the Sky world; tickets in Ember.
  const sky = Boolean(params.get("offer") || params.get("plan") || params.get("world") === "sky");
  return (
    <Shell theme={sky ? "sky" : "ember"}>
      <CheckoutBody />
    </Shell>
  );
}

export default function CheckoutPage() {
  return (
    <Suspense
      fallback={
        <Shell>
          <Skeleton className="h-48 w-full" />
        </Shell>
      }
    >
      <CheckoutFrame />
    </Suspense>
  );
}
