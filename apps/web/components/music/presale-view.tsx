"use client";

import Link from "next/link";
import { CalendarClock, Check, EyeOff, LogIn, ShoppingBag } from "lucide-react";

import { useAuth } from "@/components/auth-provider";
import { LitSurface } from "@/components/brand/corner-light";
import { CoverArt } from "@/components/brand/cover-art";
import { Display, Eyebrow } from "@/components/brand/display";
import { ButtonLink, DateTime, Money } from "@/components/ds";
import { useCustomerCommerce } from "@/components/music/commerce";
import type { PresalePageRecord } from "@/features/catalog/api";
import { coverUrl } from "@/lib/cover-view";
import { releaseTypeLabel } from "@/lib/music-view";
import { ownsRelease } from "@/lib/ownership";
import { preorderLabel, presaleCountdown } from "@/lib/presale-view";

/**
 * A release on pre-sale (D-PRESALE-02): what fans see before it is out. The music unlocks on
 * release day; until then there is nothing to play, only the pre-order. Title, artist, date and
 * the offer only (owner, 2026-11-02); the cover once the artist reveals it early (D-COVER-02).
 */
export function PresaleView({ presale }: { presale: PresalePageRecord }) {
  const { status } = useAuth();
  const signedIn = status === "authenticated";
  const commerce = useCustomerCommerce();
  const preordered = signedIn && commerce.ready && ownsRelease(commerce.entitlements, presale.id);
  const artistHref = presale.artist_id ? (presale.artist_kind === "band" ? `/bands/${presale.artist_id}` : `/artists/${presale.artist_id}`) : null;
  const price = { amount_minor: presale.offer.amount_minor, currency_code: presale.offer.currency_code };
  const checkout = `/checkout?offer=${presale.offer.id}`;

  return (
    <main id="main" data-theme="sky" className="cr-scope">
      <LitSurface as="section" theme="sky" aria-labelledby="presale-title">
        <div className="mx-auto grid max-w-[90rem] items-center gap-10 px-4 py-12 md:grid-cols-[minmax(0,26rem)_1fr] md:px-6 md:py-16">
          {presale.cover_url ? (
            // The closed surface keeps the square while the revealed cover loads.
            <CoverArt src={coverUrl({ signed: presale.cover_url }, 1200)} fallback={<div className="ps-sealed w-full" aria-hidden="true" />} className="w-full" />
          ) : (
            <SealedCover />
          )}
          <div>
            <Eyebrow>
              {releaseTypeLabel(presale.release_type)} · Pre-order
            </Eyebrow>
            <Display as="h1" id="presale-title" size="lg" className="mt-4">
              {presale.title}
            </Display>
            {presale.artist ? (
              <p className="mt-4 text-lg text-fg">
                {artistHref ? (
                  <Link href={artistHref} className="cr-focus hover:text-highlight">
                    {presale.artist}
                  </Link>
                ) : (
                  presale.artist
                )}
              </p>
            ) : null}
            <p className="mt-3 inline-flex items-center gap-2 text-sm text-fg">
              <CalendarClock aria-hidden="true" className="size-4" />
              <span>
                Out <DateTime value={presale.release_at} format="datetime" /> · <span className="font-semibold">{presaleCountdown(presale.release_at)}</span>
              </span>
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              {preordered ? (
                <p role="status" className="inline-flex items-center gap-2 font-semibold text-success">
                  <Check aria-hidden="true" className="size-5" /> You&apos;ve pre-ordered this. It unlocks for you on release day.
                </p>
              ) : signedIn ? (
                <ButtonLink href={checkout} size="lg">
                  <ShoppingBag aria-hidden="true" /> {preorderLabel(presale.release_type)} <Money value={price} />
                </ButtonLink>
              ) : (
                <>
                  <ButtonLink href={`/login?next=${encodeURIComponent(checkout)}`} size="lg" aria-label={`Sign in to pre-order ${presale.title}`}>
                    <LogIn aria-hidden="true" /> Sign in to pre-order
                  </ButtonLink>
                  <p className="text-sm text-fg">
                    Pre-sale price <Money value={price} className="font-semibold" />
                  </p>
                </>
              )}
            </div>
            {!preordered ? (
              <p className="mt-3 max-w-prose text-sm text-fg-muted">
                Pay now and the music is yours the moment it comes out. We&apos;ll email you when it&apos;s ready to play.
              </p>
            ) : null}
          </div>
        </div>
      </LitSurface>
    </main>
  );
}

/** The cover before it is revealed: a closed surface with a seam of light, nothing from the cover. */
function SealedCover() {
  return (
    <figure className="w-full">
      <div className="ps-sealed w-full" aria-hidden="true" />
      <figcaption className="mt-3 inline-flex items-center gap-2 text-sm text-fg-muted">
        <EyeOff aria-hidden="true" className="size-4" /> The cover is still under wraps.
      </figcaption>
    </figure>
  );
}
