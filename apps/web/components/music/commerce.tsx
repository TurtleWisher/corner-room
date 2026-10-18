"use client";

import Link from "next/link";
import { Check, LogIn, Play, ShoppingBag } from "lucide-react";

import { useAuth } from "@/components/auth-provider";
import { Button, ButtonLink, Money } from "@/components/ds";
import { DownloadButton } from "@/components/music/download-button";
import { useOptionalPlayer, type PlayOptions, type PlayerTrack } from "@/components/music/player";
import { useAsync } from "@/components/use-async";
import { fetchMyEntitlements, fetchOffers, fetchPlayableCatalog, type EntitlementRecord, type OfferRecord, type PlayableTrackRecord } from "@/lib/api";
import { trackBuyState } from "@/lib/ownership";

export type CustomerCommerce = { offers: OfferRecord[]; entitlements: EntitlementRecord[]; ready: boolean; reload: () => void };

/** Public offers plus, for signed-in customers, what they already own. */
export function useCustomerCommerce(): CustomerCommerce {
  const { status } = useAuth();
  const data = useAsync(async () => {
    if (status === "loading") return null;
    const [offers, entitlements] = await Promise.all([
      fetchOffers().then((p) => p.items).catch(() => [] as OfferRecord[]),
      status === "authenticated" ? fetchMyEntitlements().then((p) => p.items).catch(() => [] as EntitlementRecord[]) : Promise.resolve([] as EntitlementRecord[]),
    ]);
    return { offers, entitlements };
  }, [status]);
  return {
    offers: data.status === "ok" && data.data ? data.data.offers : [],
    entitlements: data.status === "ok" && data.data ? data.data.entitlements : [],
    ready: data.status === "ok" && data.data !== null,
    reload: data.reload,
  };
}

/**
 * The one control a track needs: Play when the customer owns it (bought or catalog access),
 * Buy with the real price when it is on sale, otherwise a route to a plan. Guests are asked to
 * sign in. Purchases go through /checkout; the API still decides access when playing.
 */
export function TrackBuyControl({
  track,
  commerce,
  size = "sm",
  showPlan = true,
  playFrom,
  releaseIds,
}: {
  track: PlayerTrack;
  commerce: CustomerCommerce;
  size?: "sm" | "md" | "lg";
  showPlan?: boolean;
  /** The list this track is shown in: playing it queues the list as Up next. */
  playFrom?: PlayOptions;
  /** Releases the track is known to be on, so a bought release counts as owning it. */
  releaseIds?: readonly string[];
}) {
  const { status } = useAuth();
  const player = useOptionalPlayer();
  if (status !== "authenticated") {
    return (
      <ButtonLink href={`/login?next=${encodeURIComponent(`/tracks/${track.id}`)}`} variant="secondary" size={size}>
        <LogIn aria-hidden="true" /> Sign in to listen
      </ButtonLink>
    );
  }
  if (!commerce.ready) return <span className="inline-block h-9 w-24" aria-hidden="true" />;
  const state = trackBuyState(commerce.entitlements, commerce.offers, track.id, releaseIds);
  if (state.kind === "owned") {
    const current = player?.isCurrent(track.id) && player.status === "playing";
    const main = player ? (
      <Button size={size} onClick={() => (current ? player.toggle() : void player.play(track, playFrom))} aria-label={`${current ? "Pause" : "Play"} ${track.title}`}>
        <Play aria-hidden="true" /> {current ? "Playing" : "Play"}
      </Button>
    ) : (
      <ButtonLink href={`/tracks/${track.id}`} size={size}>
        <Check aria-hidden="true" /> Owned
      </ButtonLink>
    );
    // Bought songs download (D-AUDIO-06); listening through a plan does not.
    if (state.via === "catalog") return main;
    return (
      <span className="inline-flex items-center gap-1">
        {main}
        <DownloadButton trackId={track.id} title={track.title} size={size === "sm" ? "sm" : "md"} />
      </span>
    );
  }
  if (state.kind === "buy") {
    return (
      <ButtonLink href={`/checkout?offer=${state.offer.id}`} size={size} aria-label={`Buy ${track.title}`}>
        <ShoppingBag aria-hidden="true" /> Buy <Money value={{ amount_minor: state.offer.amount_minor, currency_code: state.offer.currency_code }} />
      </ButtonLink>
    );
  }
  return showPlan ? (
    <ButtonLink href="/store" variant="secondary" size={size}>
      Get a plan
    </ButtonLink>
  ) : (
    <Link href="/store" className="cr-focus whitespace-nowrap text-xs font-semibold text-fg-muted hover:text-highlight">
      With a plan
    </Link>
  );
}

/** The signed-in playable catalog (titles, artists, durations, playability), keyed by track id. */
export function usePlayableCatalog(): { map: Map<string, PlayableTrackRecord>; list: PlayableTrackRecord[]; ready: boolean } {
  const { status } = useAuth();
  const data = useAsync(
    () => (status === "authenticated" ? fetchPlayableCatalog().then((p) => p.items).catch(() => [] as PlayableTrackRecord[]) : Promise.resolve([] as PlayableTrackRecord[])),
    [status],
  );
  const list = data.status === "ok" ? data.data : [];
  return { map: new Map(list.map((t) => [t.id, t])), list, ready: data.status === "ok" };
}
