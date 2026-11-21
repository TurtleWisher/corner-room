"use client";

import Link from "next/link";
import { Gift, Sparkles } from "lucide-react";

import { useAuth } from "@/components/auth-provider";
import type { CustomerCommerce } from "@/components/music/commerce";
import { useAsync } from "@/components/use-async";
import { fetchPublicGifts } from "@/features/gifts/api";
import { giftCornerWords, giftHref, giftOffer } from "@/lib/fan-gift-view";

/**
 * The music's gift corner, in two small pieces placed apart (owner, 2026-11-21: "concise, no
 * details"; "collectibles everywhere, not gifts"; the collectible below the page, not in front).
 *
 * - `show="give"`: for someone who already owns the music, one liquid glass "Give it to someone"
 *   pill under the buttons (D-GIFT-FAN-01). Others get the gift button beside Buy instead.
 * - `show="collectible"`: an artist's live gift campaign (D-CAMPAIGN-01) as one quiet line, "Comes
 *   with a collectible from {artist}", never what it is (D-CAMPAIGN-09). Nothing while none is live.
 */
export function GiftNote({
  releaseId,
  trackId,
  className,
  commerce,
  owned = false,
  title,
  releaseIds = [],
  show,
}: {
  releaseId?: string;
  trackId?: string;
  className?: string;
  /** With `owned`, the music's gift price for the owner's "Give it to someone" pill. */
  commerce?: CustomerCommerce;
  owned?: boolean;
  title?: string;
  releaseIds?: readonly string[];
  show: "give" | "collectible";
}) {
  const { status } = useAuth();
  const gifts = useAsync(
    () => (show === "collectible" ? fetchPublicGifts({ releaseId, trackId }).catch(() => []) : Promise.resolve([])),
    [releaseId, trackId, show],
  );
  const campaigns = gifts.status === "ok" ? gifts.data : [];
  const offer =
    show === "give" && owned && status === "authenticated" && commerce?.ready
      ? giftOffer(commerce.offers, releaseId ? "RELEASE" : "TRACK", (releaseId ?? trackId) as string, releaseIds)
      : null;

  if (show === "give") {
    if (!offer) return null;
    const words = giftCornerWords(title ?? "this music");
    return (
      <div className={className}>
        <Link href={giftHref(offer.id)} className="psc-liquid gift-liquid cr-focus" aria-label={words.label}>
          <Gift aria-hidden="true" className="gift-liquid-icon size-4" />
          {words.title}
        </Link>
      </div>
    );
  }
  if (campaigns.length === 0) return null;
  return (
    <ul className={`grid gap-2 ${className ?? ""}`}>
      {campaigns.map((g) => (
        <li key={g.id} className="gift-collectible">
          <Sparkles aria-hidden="true" className="size-4 shrink-0 text-highlight" />
          <span>
            Comes with a collectible from <span className="font-semibold text-fg">{g.artist}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
