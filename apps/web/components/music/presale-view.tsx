"use client";

import Link from "next/link";
import { useEffect } from "react";
import { CalendarClock, Check, Clock, EyeOff, LogIn, ShoppingBag } from "lucide-react";

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
import { PRESALE_PROMISE, preorderLabel, presaleCountdown, rememberPresaleSeen } from "@/lib/presale-view";

/**
 * A release on pre-sale (D-PRESALE-02, early pre-sales D-PRESALE-03): what fans see before it is
 * out. Title, artist, date and the offer only (owner, 2026-11-02, following the pre-sale experience
 * guide); the cover once the artist reveals it early (D-COVER-02). Outside a room before the doors
 * open: a closed surface, the date, and the one action, Pre-book.
 */
export function PresaleView({ presale }: { presale: PresalePageRecord }) {
  const { status } = useAuth();
  const signedIn = status === "authenticated";
  const commerce = useCustomerCommerce();
  const preordered = signedIn && commerce.ready && ownsRelease(commerce.entitlements, presale.id);
  const open = presale.open !== false;
  const artistHref = presale.artist_id ? (presale.artist_kind === "band" ? `/bands/${presale.artist_id}` : `/artists/${presale.artist_id}`) : null;
  const price = { amount_minor: presale.offer.amount_minor, currency_code: presale.offer.currency_code };
  const checkout = `/checkout?offer=${presale.offer.id}`;

  // So the release page can open once, the first time this visitor sees it out.
  useEffect(() => rememberPresaleSeen(presale.id), [presale.id]);

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
              <span className="ps-badge">{open ? "Pre-sale" : "Coming soon"}</span>{" "}
              <span className="ml-2">{releaseTypeLabel(presale.release_type)}</span>
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

            <p className="mt-5 flex flex-wrap items-baseline gap-x-2 text-fg">
              <CalendarClock aria-hidden="true" className="size-4 self-center" />
              <span className="text-lg font-semibold">
                Out <DateTime value={presale.release_at} format="date" /> at <DateTime value={presale.release_at} format="time" />
              </span>
              {open ? <span className="text-sm text-fg-muted">{presaleCountdown(presale.release_at)}</span> : null}
            </p>

            <div className="mt-8 border-t border-line pt-6">
              {preordered ? (
                <p role="status" aria-live="polite" className="inline-flex items-start gap-2 font-semibold text-success">
                  <Check aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
                  <span>
                    You&apos;ve pre-ordered this. It unlocks on <DateTime value={presale.release_at} format="date" />.
                  </span>
                </p>
              ) : !open ? (
                <p className="inline-flex max-w-prose items-start gap-2 text-fg">
                  <Clock aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-fg-muted" />
                  The release date has passed and the music is nearly ready. Pre-orders are closed; everyone who pre-ordered gets it the moment
                  it&apos;s out.
                </p>
              ) : (
                <>
                  <p className="text-sm text-fg-muted">
                    Pre-sale price <Money value={price} className="ml-1 text-base font-semibold text-fg" />
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    {signedIn ? (
                      <ButtonLink href={checkout} size="lg">
                        <ShoppingBag aria-hidden="true" /> {preorderLabel(presale.release_type)}
                      </ButtonLink>
                    ) : (
                      <ButtonLink href={`/login?next=${encodeURIComponent(checkout)}`} size="lg" aria-label={`Sign in to pre-book ${presale.title}`}>
                        <LogIn aria-hidden="true" /> Sign in to pre-book
                      </ButtonLink>
                    )}
                  </div>
                  <p className="mt-3 max-w-prose text-sm text-fg-muted">{PRESALE_PROMISE.unlock}</p>
                </>
              )}
            </div>
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
