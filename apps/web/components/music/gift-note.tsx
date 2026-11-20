"use client";

import Link from "next/link";
import { ArrowRight, Gift, Sparkles } from "lucide-react";

import { useAuth } from "@/components/auth-provider";
import type { CustomerCommerce } from "@/components/music/commerce";
import { useAsync } from "@/components/use-async";
import { fetchPublicGifts } from "@/features/gifts/api";
import { giftCornerWords, giftHref, giftOffer } from "@/lib/fan-gift-view";

/**
 * The gift section under a song's or release's buttons.
 *
 * - An artist's live gift campaign (owner, 2026-10-28, D-CAMPAIGN-01): fans see that a gift comes
 *   with the music, never what it is (owner, 2026-11-21, D-CAMPAIGN-09: a surprise until it's in
 *   their hands). Nothing is drawn while no campaign is live.
 * - For someone who already owns the music (owner, 2026-11-21): "Give it to someone", beside that
 *   card, in place of a gift button next to Play (D-GIFT-FAN-01). Others get the gift button beside
 *   Buy instead.
 */
export function GiftNote({
  releaseId,
  trackId,
  className,
  commerce,
  owned = false,
  title,
  releaseIds = [],
}: {
  releaseId?: string;
  trackId?: string;
  className?: string;
  /** With `owned`, the music's gift price for the owner's "Give it to someone" card. */
  commerce?: CustomerCommerce;
  owned?: boolean;
  title?: string;
  releaseIds?: readonly string[];
}) {
  const { status } = useAuth();
  const gifts = useAsync(() => fetchPublicGifts({ releaseId, trackId }).catch(() => []), [releaseId, trackId]);
  const campaigns = gifts.status === "ok" ? gifts.data : [];
  const offer =
    owned && status === "authenticated" && commerce?.ready
      ? giftOffer(commerce.offers, releaseId ? "RELEASE" : "TRACK", (releaseId ?? trackId) as string, releaseIds)
      : null;
  if (campaigns.length === 0 && !offer) return null;
  const words = giftCornerWords(title ?? "this music");
  return (
    <div className={`grid gap-3 ${campaigns.length && offer ? "sm:grid-cols-2" : ""} ${className ?? ""}`}>
      {campaigns.map((g) => (
        <div key={g.id} className="cr-cut cr-glass-card flex items-start gap-3 p-4">
          <Sparkles aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-highlight" />
          <div>
            <p className="text-sm font-bold text-fg">A gift from {g.artist} comes with this music</p>
            <p className="mt-1 text-sm text-fg-muted">What it is stays a surprise until it&apos;s in your hands.</p>
          </div>
        </div>
      ))}
      {offer ? (
        <Link
          href={giftHref(offer.id)}
          className="cr-cut cr-glass-card cr-focus group flex items-start gap-3 p-4 transition-transform duration-200 ease-out hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
          aria-label={words.label}
        >
          <Gift aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-highlight transition-transform duration-200 group-hover:-rotate-6 motion-reduce:group-hover:rotate-0" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-bold text-fg">{words.title}</span>
            <span className="mt-1 block text-sm text-fg-muted">{words.body}</span>
          </span>
          <ArrowRight aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-fg-muted transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-fg motion-reduce:group-hover:translate-x-0" />
        </Link>
      ) : null}
    </div>
  );
}
