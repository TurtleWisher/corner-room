"use client";

import Link from "next/link";
import { LockKeyhole } from "lucide-react";

import { useAuth } from "@/components/auth-provider";
import { ButtonLink, Card, DateTime, Money } from "@/components/ds";
import { PresaleCover } from "@/components/music/presale-cover";
import type { PresalePageRecord } from "@/features/catalog/api";
import { countPresale, type PresalePlace } from "@/features/presales/api";
import { coverUrl } from "@/lib/cover-view";
import { notePlace } from "@/lib/presale-campaign-view";
import { presaleCountdown } from "@/lib/presale-view";
import { cn } from "@/lib/utils";

/**
 * A release on pre-sale in a list (owner, 2026-11-06, D-PRESALE-04): the Store, Releases, the home
 * page's Store card and artist profiles all use this one card, so a pre-sale always reads the
 * same: marked "Pre-sale" with the time left, the pre-sale price, and Pre-book. Never in the home
 * page's New releases (that list is music that is out).
 */
export function PresaleCard({ presale, place, className }: { presale: PresalePageRecord; place: PresalePlace; className?: string }) {
  const open = presale.open !== false;
  const releaseHref = `/releases/${presale.id}`;
  const artistHref = presale.artist_id ? (presale.artist_kind === "band" ? `/bands/${presale.artist_id}` : `/artists/${presale.artist_id}`) : null;
  const price = { amount_minor: presale.offer.amount_minor, currency_code: presale.offer.currency_code };
  return (
    <Card as="article" className={cn("flex h-full flex-col p-4", className)}>
      <PresaleCover coverUrl={coverUrl({ signed: presale.cover_url }, 480)} title={presale.title} artist={presale.artist}>
        {open ? (
          <div className="psc-cta">
            <PrebookLink presale={presale} place={place} size="sm" />
          </div>
        ) : null}
      </PresaleCover>
      <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-semibold text-fg">
        <span className="ps-badge text-highlight">{open ? "Pre-sale" : "Coming soon"}</span>
        {open ? (
          <span className="psc-when text-fg-muted" data-open="">
            {presaleCountdown(presale.release_at)}
          </span>
        ) : null}
      </p>
      <h3 className="mt-2 truncate text-base font-bold text-fg">
        <Link href={releaseHref} className="cr-focus hover:text-highlight" onClick={() => notePlace(presale.id, place)}>
          {presale.title}
        </Link>
      </h3>
      {presale.artist ? (
        <p className="truncate text-sm text-fg-muted">
          {artistHref ? (
            <Link href={artistHref} className="cr-focus hover:text-fg">
              {presale.artist}
            </Link>
          ) : (
            presale.artist
          )}
        </p>
      ) : null}
      <p className="mt-1 text-xs text-fg-muted">
        Out <DateTime value={presale.release_at} format="date" />
      </p>
      {open ? (
        <p className="mt-3 flex-1">
          <Money value={price} variant="display" className="text-2xl text-highlight" />
        </p>
      ) : (
        <p className="mt-3 flex-1 text-sm text-fg-muted">Pre-orders are closed until it&apos;s out.</p>
      )}
      <div className="mt-4 space-y-2">
        <ButtonLink href={releaseHref} variant="secondary" block aria-label={`View pre-sale for ${presale.title}`} onClick={() => notePlace(presale.id, place)}>
          View pre-sale
        </ButtonLink>
        {open ? <PrebookLink presale={presale} place={place} block /> : null}
      </div>
    </Card>
  );
}

/** Pre-book: to checkout when signed in, through sign-in otherwise. Each press is counted. */
export function PrebookLink({
  presale,
  place,
  size,
  block,
  className,
}: {
  presale: PresalePageRecord;
  place: PresalePlace;
  size?: "sm" | "lg";
  block?: boolean;
  className?: string;
}) {
  const { status } = useAuth();
  const checkout = `/checkout?offer=${presale.offer.id}`;
  const signedIn = status === "authenticated";
  return (
    <ButtonLink
      href={signedIn ? checkout : `/login?next=${encodeURIComponent(checkout)}`}
      variant="brand"
      size={size}
      block={block}
      className={className}
      aria-label={signedIn ? `Pre-book ${presale.title}` : `Sign in to pre-book ${presale.title}`}
      onClick={() => countPresale(presale.id, { kind: "prebook", place })}
    >
      <LockKeyhole aria-hidden="true" /> {signedIn ? "Pre-book" : "Sign in to pre-book"}
    </ButtonLink>
  );
}
