"use client";

/*
 * "Give as a gift" on song and release pages (owner, 2026-11-20, D-GIFT-FAN-01). Shown to anyone
 * signed in, including people who already own the music (their Buy button turns into Play, so this
 * is their way in). Opens checkout with Give it as a gift ticked.
 */

import { Gift } from "lucide-react";

import { useAuth } from "@/components/auth-provider";
import { ButtonLink } from "@/components/ds";
import type { CustomerCommerce } from "@/components/music/commerce";
import { giftHref, giftOffer } from "@/lib/fan-gift-view";

export function GiveGiftLink({
  commerce,
  kind,
  id,
  title,
  releaseIds = [],
  size = "lg",
}: {
  commerce: CustomerCommerce;
  kind: "TRACK" | "RELEASE";
  id: string;
  title: string;
  releaseIds?: readonly string[];
  size?: "sm" | "md" | "lg";
}) {
  const { status } = useAuth();
  if (status !== "authenticated" || !commerce.ready) return null;
  const offer = giftOffer(commerce.offers, kind, id, releaseIds);
  if (!offer) return null;
  return (
    <ButtonLink href={giftHref(offer.id)} variant="secondary" size={size} aria-label={`Give ${title} as a gift`}>
      <Gift aria-hidden="true" /> Give as a gift
    </ButtonLink>
  );
}
