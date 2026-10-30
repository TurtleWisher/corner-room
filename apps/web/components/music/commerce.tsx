"use client";

import { usePathname } from "next/navigation";
import { Check, Lock, LogIn, Play } from "lucide-react";

import { useAuth } from "@/components/auth-provider";
import { Button, ButtonLink, Money } from "@/components/ds";
import { SaveOfflineButton } from "@/components/music/save-offline-button";
import { useOptionalPlayer, type PlayOptions, type PlayerTrack } from "@/components/music/player";
import { useAsync } from "@/components/use-async";
import { fetchMyEntitlements, fetchOffers, fetchPlayableCatalog, type EntitlementRecord, type OfferRecord, type PlayableTrackRecord } from "@/lib/api";
import { fetchMyStreamAccess } from "@/features/streaming/api";
import { offerForRelease, ownsTrack, releaseBuyLabel, trackBuyState } from "@/lib/ownership";

export type CustomerCommerce = {
  offers: OfferRecord[];
  entitlements: EntitlementRecord[];
  /** Songs this person may listen to without buying: catalog staff, or the music's own artist or band (D-STREAM-02). */
  streamable?: ReadonlySet<string>;
  ready: boolean;
  reload: () => void;
};

/** Can this person play the song now: bought it (or a release it is on), or may listen without buying. */
export function canPlay(commerce: CustomerCommerce, trackId: string, releaseIds: readonly string[] = []): boolean {
  return ownsTrack(commerce.entitlements, trackId, releaseIds) || commerce.streamable?.has(trackId) === true;
}

/** Public offers plus, for signed-in customers, what they already own. */
export function useCustomerCommerce(): CustomerCommerce {
  const { status } = useAuth();
  const data = useAsync(async () => {
    if (status === "loading") return null;
    const signedIn = status === "authenticated";
    const [offers, entitlements, streamable] = await Promise.all([
      fetchOffers().then((p) => p.items).catch(() => [] as OfferRecord[]),
      signedIn ? fetchMyEntitlements().then((p) => p.items).catch(() => [] as EntitlementRecord[]) : Promise.resolve([] as EntitlementRecord[]),
      signedIn ? fetchMyStreamAccess().catch(() => [] as string[]) : Promise.resolve([] as string[]),
    ]);
    return { offers, entitlements, streamable: new Set(streamable) };
  }, [status]);
  return {
    offers: data.status === "ok" && data.data ? data.data.offers : [],
    entitlements: data.status === "ok" && data.data ? data.data.entitlements : [],
    streamable: data.status === "ok" && data.data ? data.data.streamable : undefined,
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
  releaseIds,
  onReleasePage,
}: {
  track: PlayerTrack;
  commerce: CustomerCommerce;
  size?: "sm" | "md" | "lg";
  /** The list this track is shown in: playing it queues the list as Up next. */
  playFrom?: PlayOptions;
  /** The released albums, EPs and singles the song is on (the API's `release_ids`). Required, so no
   * list can forget them: without them a song sold as part of a release reads "Not on sale yet" and
   * a bought release doesn't count as owning it (owner, 2026-10-30). Pass [] only for a song on none. */
  releaseIds: readonly string[];
  /** The release whose own page this is: it already shows its buy button, so a song sold only as
   * part of it gets a quiet lock here, not a second price button (owner, 2026-10-25). */
  onReleasePage?: string;
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
  const state = trackBuyState(commerce.entitlements, commerce.offers, track.id, releaseIds, commerce.streamable);
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
    // Bought songs can be saved for offline listening in the app (D-AUDIO-18, replaces the file
    // download of D-AUDIO-06); older whole-catalog access can't.
    // Offline saving needs a purchase; whole-catalog access and free listening (D-STREAM-02) don't have one.
    if (state.via === "catalog" || state.via === "access") return main;
    return (
      <span className="inline-flex items-center gap-1">
        {main}
        <SaveOfflineButton trackId={track.id} title={track.title} releaseIds={releaseIds} size={size === "sm" ? "sm" : "md"} />
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
  if (release && onReleasePage && release.subject_id === onReleasePage) {
    return (
      <span className="inline-flex items-center text-fg-muted" role="img" aria-label={`${track.title}: buy the release above to play it`} title="Buy the release above to play">
        <Lock aria-hidden="true" className="size-4" />
      </span>
    );
  }
  if (release) {
    // "Buy the album ৳115", never a bare "Release ৳115" that reads as this one song's price (owner, 2026-10-30).
    return (
      <ButtonLink
        href={`/checkout?offer=${release.id}`}
        size={size}
        aria-label={`Locked. ${releaseBuyLabel(release.release_type, release)} with ${track.title} to play it`}
        title={`${track.title} is sold as part of ${release.name ?? "a release"}`}
      >
        <Lock aria-hidden="true" /> {releaseBuyLabel(release.release_type, release)}{" "}
        <Money value={{ amount_minor: release.amount_minor, currency_code: release.currency_code }} />
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
