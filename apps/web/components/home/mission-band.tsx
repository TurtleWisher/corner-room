"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Display } from "@/components/brand/display";
import { ButtonLink, DateTime, Money } from "@/components/ds";
import { Reveal } from "@/components/ds/reveal";
import { useAsync } from "@/components/use-async";
import { PresaleCover } from "@/components/music/presale-cover";
import type { PresalePageRecord } from "@/features/catalog/api";
import { fetchPresales } from "@/features/presales/api";
import { fetchOffers } from "@/lib/api";
import { coverUrl } from "@/lib/cover-view";
import { notePlace } from "@/lib/presale-campaign-view";
import { presaleCountdown } from "@/lib/presale-view";
import { storeHighlights } from "@/lib/home-view";
import { offerTitle, productKind } from "@/lib/store-view";

/*
 * The mission and the way into the Store (home section 03). Copy is PROVISIONAL (owner wording,
 * 2026-10-25, replacing the 2026-10-13 draft, OD-30): replace together with the tagline review
 * (LB-02). Products come only from
 * the live store (songs and releases; no plans or passes, D-COMMERCE-01); there are no collectibles
 * or merch (Q-P1-28).
 */
export const MISSION_LINE = "Find the music you love. Purchase music of your favorite artist and own it.";

export function MissionBand() {
  const store = useAsync(() => fetchOffers().then((o) => storeHighlights(o.items)), []);
  const picks = store.status === "ok" ? store.data : [];
  // Releasing soon (D-PRESALE-04): pre-sales get their own rows, marked, ahead of what's out.
  const soon = useAsync(() => fetchPresales({ limit: 2 }).catch(() => [] as PresalePageRecord[]), []);
  const presales = soon.status === "ok" ? soon.data.filter((p) => p.open !== false) : [];

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
          <p className="cr-display-line mt-5 max-w-xl text-base text-fg md:text-lg">
            Pay once for a song or a release. It stays yours, and you can save it to play offline.
          </p>
          <ButtonLink href="/store" size="lg" className="mt-8">
            Visit the Store <ArrowRight aria-hidden="true" />
          </ButtonLink>
        </div>
        {picks.length || presales.length ? (
          <ul className="grid gap-3" aria-label="In the Store now">
            {presales.map((presale) => (
              <li key={presale.id}>
                <SoonRow presale={presale} />
              </li>
            ))}
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

/** A pre-sale in the Store band: its small screen or lightly blurred cover, "Pre-sale" and the time
 * left in words, the date, and the pre-sale price. Opens the pre-sale page. */
function SoonRow({ presale }: { presale: PresalePageRecord }) {
  return (
    <Link
      href={`/releases/${presale.id}`}
      onClick={() => notePlace(presale.id, "HOME")}
      className="cr-cut cr-focus cr-glass-card cr-hover flex items-center gap-4 p-4"
    >
      <PresaleCover coverUrl={coverUrl({ signed: presale.cover_url }, 160)} title={presale.title} artist={presale.artist} className="w-16 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold">
          <span className="ps-badge text-highlight">Pre-sale</span>
          <span className="psc-when text-fg-muted" data-open="">
            {presaleCountdown(presale.release_at)}
          </span>
        </span>
        <span className="mt-1 block truncate font-semibold text-fg">{presale.title}</span>
        <span className="block truncate text-xs text-fg-muted">
          {presale.artist ? `${presale.artist} · ` : ""}Out <DateTime value={presale.release_at} format="date" />
        </span>
      </span>
      <Money
        value={{ amount_minor: presale.offer.amount_minor, currency_code: presale.offer.currency_code }}
        variant="display"
        className="text-2xl text-highlight"
      />
    </Link>
  );
}
