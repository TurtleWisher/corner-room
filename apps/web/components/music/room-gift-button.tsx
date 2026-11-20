"use client";

/*
 * Give as a gift, in the listening room's top corner (owner, 2026-11-21, D-GIFT-FAN-01): a small gift
 * icon beside the lyrics toggle and the ✕; its words slide out on hover or keyboard focus and are
 * always its name for screen readers. Shown when someone is signed in and the song (or the release
 * it is sold with) can be given; it opens checkout with Give it as a gift ticked.
 */

import Link from "next/link";
import { Gift } from "lucide-react";

import { useOptionalAuth } from "@/components/auth-provider";
import { useCustomerCommerce, usePlayableCatalog } from "@/components/music/commerce";
import { giftHref, giftOffer } from "@/lib/fan-gift-view";
import { releaseIdsFor } from "@/lib/ownership";

export function RoomGiftButton({ trackId, title }: { trackId: string; title: string }) {
  // Signed-in people only; the room may be drawn without the app shell (tests), so no auth is no icon.
  if (useOptionalAuth()?.status !== "authenticated") return null;
  return <SignedInGift trackId={trackId} title={title} />;
}

function SignedInGift({ trackId, title }: { trackId: string; title: string }) {
  const commerce = useCustomerCommerce();
  const catalog = usePlayableCatalog();
  if (!commerce.ready || !catalog.ready) return null;
  const offer = giftOffer(commerce.offers, "TRACK", trackId, releaseIdsFor(catalog.map, trackId));
  if (!offer) return null;
  return (
    <Link
      href={giftHref(offer.id)}
      aria-label={`Give ${title} as a gift`}
      className="lr-chip lr-chip-icon lr-reveal cr-cut cr-cut-sm cr-focus"
    >
      <Gift aria-hidden="true" className="size-4 shrink-0" />
      <span aria-hidden="true" className="lr-reveal-words">
        Give as a gift
      </span>
    </Link>
  );
}
