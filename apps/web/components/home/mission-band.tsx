"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Display } from "@/components/brand/display";
import { ButtonLink, Money } from "@/components/ds";
import { Reveal } from "@/components/ds/reveal";
import { useAsync } from "@/components/use-async";
import { fetchOffers } from "@/lib/api";
import { storeHighlights } from "@/lib/home-view";
import { offerTitle, productKind } from "@/lib/store-view";

/*
 * The mission and the way into the Store (home section 03). Copy is PROVISIONAL (owner draft,
 * 2026-10-13, OD-30): replace together with the tagline review (LB-02). Products come only from
 * the live store (songs and releases; no plans or passes, D-COMMERCE-01); there are no collectibles
 * or merch (Q-P1-28).
 */
export const MISSION_LINE = "Find the music you love. Help the artists who make it.";

export function MissionBand() {
  const store = useAsync(() => fetchOffers().then((o) => storeHighlights(o.items)), []);
  const picks = store.status === "ok" ? store.data : [];

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
          <p className="cr-display-line mt-5 max-w-xl text-base text-fg md:text-lg">Buy songs and releases straight from the artists, and keep them.</p>
          <ButtonLink href="/store" size="lg" className="mt-8">
            Visit the Store <ArrowRight aria-hidden="true" />
          </ButtonLink>
        </div>
        {picks.length ? (
          <ul className="grid gap-3" aria-label="In the Store now">
            {picks.map((pick) => (
              <li key={pick.id}>
                <Link href="/store" className="cr-cut cr-focus cr-glass-card cr-hover flex items-center justify-between gap-4 p-5">
                  <span>
                    <span className="block text-xs text-fg-muted">{productKind(pick.product_type)}</span>
                    <span className="block font-semibold text-fg">{offerTitle(pick)}</span>
                  </span>
                  <Money value={{ amount_minor: pick.amount_minor, currency_code: pick.currency_code }} variant="display" className="text-2xl text-highlight" />
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Reveal>
  );
}
