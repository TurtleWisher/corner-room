"use client";

import Link from "next/link";
import { Check } from "lucide-react";

import { useAuth } from "@/components/auth-provider";
import { LitSurface } from "@/components/brand/corner-light";
import { CoverArt } from "@/components/brand/cover-art";
import { RoomCube } from "@/components/brand/room-cube";
import { ButtonLink, Card, EmptyState, ErrorState, Money, Skeleton } from "@/components/ds";
import { PageIntro, RetryButton } from "@/components/shell/staff-panel";
import { loadErrorMessage, useAsync } from "@/components/use-async";
import { fetchMySubscriptions, fetchOffers, fetchSubscriptionPlans, type OfferRecord, type PlanRecord } from "@/lib/api";
import { maybeCoverUrl, offerCoverSource } from "@/lib/cover-view";
import { groupOffers, intervalLabel, offerTitle, planName, productKind, trialLabel } from "@/lib/store-view";

function BuyLink({ href, children, label }: { href: string; children: React.ReactNode; label: string }) {
  const { status } = useAuth();
  if (status !== "authenticated") {
    return (
      <ButtonLink href={`/login?next=${encodeURIComponent(href)}`} variant="secondary" block aria-label={`Sign in to ${label}`}>
        Sign in to buy
      </ButtonLink>
    );
  }
  return (
    <ButtonLink href={href} block aria-label={label}>
      {children}
    </ButtonLink>
  );
}

function PlanCard({ plan, subscribed }: { plan: PlanRecord; subscribed: boolean }) {
  const name = planName(plan.key);
  const interval = intervalLabel(plan);
  const trial = trialLabel(plan);
  return (
    <Card as="article" className="flex h-full flex-col p-6">
      <h3 className="text-lg font-bold text-fg">{name}</h3>
      <p className="mt-4 flex items-baseline gap-2">
        <Money value={{ amount_minor: plan.price_amount_minor, currency_code: plan.currency_code }} variant="display" className="text-[2.75rem] leading-none text-highlight" />
        {interval ? <span className="text-sm text-fg-muted">{interval}</span> : null}
      </p>
      <ul className="mt-4 flex-1 space-y-1 text-sm text-fg">
        <li className="flex items-center gap-2">
          <Check aria-hidden="true" className="size-4 text-success" /> Listen across the catalog
        </li>
        {trial ? (
          <li className="flex items-center gap-2">
            <Check aria-hidden="true" className="size-4 text-success" /> {trial}
          </li>
        ) : null}
      </ul>
      <div className="mt-6">
        {subscribed ? (
          <ButtonLink href="/subscriptions" variant="secondary" block>
            <Check aria-hidden="true" /> You are subscribed
          </ButtonLink>
        ) : (
          <BuyLink href={`/checkout?plan=${plan.id}`} label={`Subscribe to ${name}`}>
            Subscribe
          </BuyLink>
        )}
      </div>
    </Card>
  );
}

function OfferCard({ offer }: { offer: OfferRecord }) {
  const title = offerTitle(offer);
  return (
    <Card as="article" className="flex h-full flex-col p-4">
      <CoverArt
        src={maybeCoverUrl(offerCoverSource(offer.product_type, offer.subject_id), 480)}
        fallback={<RoomCube front={title} side={title} tone="sky" label="" className="w-full" />}
        className="w-full"
      />
      <h3 className="mt-4 truncate text-base font-bold text-fg">{title}</h3>
      {productKind(offer.product_type) !== title ? <p className="text-xs text-fg-muted">{productKind(offer.product_type)}</p> : null}
      <p className="mt-3 flex-1">
        <Money value={{ amount_minor: offer.amount_minor, currency_code: offer.currency_code }} variant="display" className="text-2xl text-highlight" />
      </p>
      <div className="mt-4">
        <BuyLink href={`/checkout?offer=${offer.id}`} label={`Buy ${title}`}>
          Buy
        </BuyLink>
      </div>
    </Card>
  );
}

export default function StorePage() {
  const { status } = useAuth();
  const mine = useAsync(
    () => (status === "authenticated" ? fetchMySubscriptions().then((p) => p.items).catch(() => []) : Promise.resolve([])),
    [status],
  );
  const subscribedPlans = new Set(
    mine.status === "ok" ? mine.data.filter((s) => ["TRIALING", "ACTIVE", "PAST_DUE"].includes(s.status)).map((s) => s.plan_id) : [],
  );
  const data = useAsync(() => Promise.all([fetchOffers(), fetchSubscriptionPlans()]).then(([o, p]) => ({ offers: o.items, plans: p.items })), []);

  return (
    <main id="main" data-theme="ember" data-module="store" className="cr-scope">
      <LitSurface as="section" theme="ember" aria-labelledby="store-title">
        <div className="mx-auto max-w-[90rem] px-4 pb-10 pt-12 md:px-6 md:pt-16">
          <div id="store-title">
            <PageIntro eyebrow="Store" title="Music to keep" lede="Subscribe to listen across the catalog, or buy music to keep." />
          </div>
        </div>
      </LitSurface>

      <div className="mx-auto max-w-[90rem] space-y-14 px-4 pb-16 pt-4 md:px-6">
        {data.status === "loading" ? (
          <div className="grid gap-6 md:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-64 w-full" />
            ))}
          </div>
        ) : data.status === "error" ? (
          <ErrorState title="The Store is unavailable" message={loadErrorMessage(data.error, "the Store")} action={<RetryButton onClick={data.reload} />} />
        ) : data.data.offers.length === 0 && data.data.plans.length === 0 ? (
          <EmptyState title="Nothing on sale yet" body="Plans and music will appear here when they go on sale." />
        ) : (
          <>
            {data.data.plans.length ? (
              <section aria-labelledby="store-plans">
                <h2 id="store-plans" className="mb-5 text-xl font-bold text-fg md:text-2xl">
                  Plans
                </h2>
                <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                  {data.data.plans.map((plan) => (
                    <li key={plan.id}>
                      <PlanCard plan={plan} subscribed={subscribedPlans.has(plan.id)} />
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            {groupOffers(data.data.offers).map((group) => (
              <section key={group.type} aria-labelledby={`store-${group.type}`}>
                <h2 id={`store-${group.type}`} className="mb-5 text-xl font-bold text-fg md:text-2xl">
                  {group.label}
                </h2>
                <ul className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                  {group.offers.map((offer) => (
                    <li key={offer.id}>
                      <OfferCard offer={offer} />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </>
        )}
        <p className="text-sm text-fg-muted">
          Already bought something?{" "}
          <Link href="/purchases" className="cr-focus font-semibold text-link underline">
            See your purchases
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
