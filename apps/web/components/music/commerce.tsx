"use client";

import { usePathname } from "next/navigation";
import { Check, Lock, LogIn, Play } from "lucide-react";

import { useAuth } from "@/components/auth-provider";
import { Button, ButtonLink, Money } from "@/components/ds";
import { DownloadButton } from "@/components/music/download-button";
import { useOptionalPlayer, type PlayOptions, type PlayerTrack } from "@/components/music/player";
import { useAsync } from "@/components/use-async";
import { fetchMyEntitlements, fetchOffers, fetchPlayableCatalog, type EntitlementRecord, type OfferRecord, type PlayableTrackRecord } from "@/lib/api";
import { offerForRelease, trackBuyState } from "@/lib/ownership";

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
 * The one control a track needs (owner, 2026-10-24): visitors see "Sign in" on the play button
 * (and the price, when it is on sale); signed-in people who own it see Play; anyone else sees a
 * lock with the price, which opens the purchase page (/checkout). The API still decides access
 * when playing; this only reflects what the customer owns.
 */
export function TrackBuyControl({
  track,
  commerce,
  size = "sm",
  playFrom,
  releaseIds = [],
}: {
  track: PlayerTrack;
  commerce: CustomerCommerce;
  size?: "sm" | "md" | "lg";
  /** The list this track is shown in: playing it queues the list as Up next. */
  playFrom?: PlayOptions;
  /** Releases the track is known to be on, so a bought release counts as owning it. */
  releaseIds?: readonly string[];
}) {
  const { status } = useAuth();
  const player = useOptionalPlayer();
  const pathname = usePathname();
  if (status !== "authenticated") {
    // Sign in, then come back to this page. The price shows when it is known and on sale.
    const guest = commerce.ready ? trackBuyState([], commerce.offers, track.id, releaseIds) : null;
    return (
      <span className="inline-flex items-center gap-3">
        {guest?.kind === "buy" ? (
          <Money value={{ amount_minor: guest.offer.amount_minor, currency_code: guest.offer.currency_code }} className="text-sm text-fg-muted" />
        ) : null}
        <ButtonLink href={`/login?next=${encodeURIComponent(pathname || `/tracks/${track.id}`)}`} variant="secondary" size={size} aria-label={`Sign in to play ${track.title}`}>
          <LogIn aria-hidden="true" /> Sign in
        </ButtonLink>
      </span>
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
    // Bought songs download (D-AUDIO-06); older whole-catalog access does not.
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
      <ButtonLink href={`/checkout?offer=${state.offer.id}`} size={size} aria-label={`Locked. Buy ${track.title} to play it`} title="Buy to play">
        <Lock aria-hidden="true" /> <Money value={{ amount_minor: state.offer.amount_minor, currency_code: state.offer.currency_code }} />
      </ButtonLink>
    );
  }
  // No price of its own: the release it is on may be for sale (D-AUDIO-12); otherwise it can't be
  // bought yet. Corner Room has no plans or whole-catalog pass (D-COMMERCE-01).
  const release = releaseIds.map((id) => offerForRelease(commerce.entitlements, commerce.offers, id, [track.id])).find(Boolean);
  if (release) {
    return (
      <ButtonLink href={`/checkout?offer=${release.id}`} size={size} aria-label={`Locked. Buy the release with ${track.title} to play it`} title="Buy to play">
        <Lock aria-hidden="true" /> Release <Money value={{ amount_minor: release.amount_minor, currency_code: release.currency_code }} />
      </ButtonLink>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-semibold text-fg-muted" aria-label={`${track.title} is not on sale yet`}>
      <Lock aria-hidden="true" className="size-3.5" /> Not on sale yet
    </span>
  );
}

/** The playable catalog (titles, artists, durations, playability), keyed by track id. Public, so
 * visitors see every song's details too (owner, 2026-10-24). */
export function usePlayableCatalog(): { map: Map<string, PlayableTrackRecord>; list: PlayableTrackRecord[]; ready: boolean } {
  const { status } = useAuth();
  const data = useAsync(
    () =>
      status === "loading"
        ? Promise.resolve([] as PlayableTrackRecord[])
        : fetchPlayableCatalog({ skipAuth: status !== "authenticated" }).then((p) => p.items).catch(() => [] as PlayableTrackRecord[]),
    [status],
  );
  const list = data.status === "ok" ? data.data : [];
  return { map: new Map(list.map((t) => [t.id, t])), list, ready: data.status === "ok" };
}
