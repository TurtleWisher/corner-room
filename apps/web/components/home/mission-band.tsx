"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Display } from "@/components/brand/display";
import { ButtonLink, Money } from "@/components/ds";
import { Reveal } from "@/components/ds/reveal";
import { useAsync } from "@/components/use-async";
import { fetchOffers, fetchSubscriptionPlans } from "@/lib/api";
import { storeHighlights } from "@/lib/home-view";
import { intervalLabel, offerTitle, planName } from "@/lib/store-view";

/*
 * The mission and the way into the Store (home section 03). Copy is PROVISIONAL (owner draft,
 * 2026-10-13, OD-30): replace together with the tagline review (LB-02). Products come only from
 * the live store (passes and plans); there are no collectibles or merch (Q-P1-28).
 */
export const MISSION_LINE = "Find the music you love. Help the artists who make it.";

export function MissionBand() {
  const store = useAsync(
    () => Promise.all([fetchOffers(), fetchSubscriptionPlans()]).then(([o, p]) => storeHighlights(o.items, p.items)),
    [],
  );
  const picks = store.status === "ok" ? store.data : { pass: null, plan: null };

  return (
    <Reveal as="section" aria-labelledby="home-mission" className="mx-auto max-w-[90rem] px-4 pb-16 pt-4 md:px-6 md:pb-20">
      <div className="cr-cut cr-glass-card grid gap-8 p-6 md:p-10 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:items-center">
        <div>
          <p className="flex items-baseline gap-3">
            <span aria-hidden="true" className="cr-num text-sm text-highlight">
              03
            </span>
            <span className="cr-eyebrow">Corner Room Store</span>
          </p>
          <Display as="h2" id="home-mission" size="md" className="mt-5 max-w-3xl leading-[0.92]">
            {MISSION_LINE}
          </Display>
          <p className="cr-display-line mt-5 max-w-xl text-base text-fg md:text-lg">Buy a track to keep it, or unlock the whole catalog with a plan.</p>
          <ButtonLink href="/store" size="lg" className="mt-8">
            Visit the Store <ArrowRight aria-hidden="true" />
          </ButtonLink>
        </div>
        {picks.pass || picks.plan ? (
          <ul className="grid gap-3" aria-label="In the Store now">
            {picks.pass ? (
              <li>
                <Link href="/store" className="cr-cut cr-focus cr-glass-card cr-hover flex items-center justify-between gap-4 p-5">
                  <span>
                    <span className="block text-xs text-fg-muted">Catalog pass</span>
                    <span className="block font-semibold text-fg">{offerTitle(picks.pass)}</span>
                  </span>
                  <Money value={{ amount_minor: picks.pass.amount_minor, currency_code: picks.pass.currency_code }} variant="display" className="text-2xl text-highlight" />
                </Link>
              </li>
            ) : null}
            {picks.plan ? (
              <li>
                <Link href="/store" className="cr-cut cr-focus cr-glass-card cr-hover flex items-center justify-between gap-4 p-5">
                  <span>
                    <span className="block text-xs text-fg-muted">Plan</span>
                    <span className="block font-semibold text-fg">{planName(picks.plan.key)}</span>
                  </span>
                  <span className="text-right">
                    <Money value={{ amount_minor: picks.plan.price_amount_minor, currency_code: picks.plan.currency_code }} variant="display" className="text-2xl text-highlight" />
                    {intervalLabel(picks.plan) ? <span className="block text-xs text-fg-muted">{intervalLabel(picks.plan)}</span> : null}
                  </span>
                </Link>
              </li>
            ) : null}
          </ul>
        ) : null}
      </div>
    </Reveal>
  );
}
