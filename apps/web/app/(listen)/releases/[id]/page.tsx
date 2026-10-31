"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { FormEvent, useState } from "react";
import { Check, Lock, LogIn, Play, Plus } from "lucide-react";

import { useAuth } from "@/components/auth-provider";
import { LitSurface } from "@/components/brand/corner-light";
import { CoverArt } from "@/components/brand/cover-art";
import { Display, Eyebrow } from "@/components/brand/display";
import { RoomCube } from "@/components/brand/room-cube";
import { Button, ButtonLink, DateTime, EmptyState, ErrorState, Field, Input, Money, Skeleton, StatusChip } from "@/components/ds";
import { canPlay, type CustomerCommerce, TrackBuyControl, useCustomerCommerce } from "@/components/music/commerce";
import { BandLineup } from "@/components/artists/band-lineup";
import { CreditFace } from "@/components/music/credit-face";
import { GiftNote } from "@/components/music/gift-note";
import { PresaleView } from "@/components/music/presale-view";
import { useCredits } from "@/components/music/credits";
import { usePlayer, type PlayOptions } from "@/components/music/player";
import { RetryButton, StaffPanel } from "@/components/shell/staff-panel";
import { loadErrorMessage, useAsync } from "@/components/use-async";
import {
  ApiError,
  addLibraryItem,
  addReleaseTrack,
  fetchPlayableCatalog,
  fetchRelease,
  fetchReleaseTracks,
  fetchTrack,
  transitionRelease,
  type PlayableTrackRecord,
  type ReleaseRecord,
  type TrackRecord,
} from "@/lib/api";
import { fetchPresale, type PresalePageRecord } from "@/features/catalog/api";
import { coverUrl } from "@/lib/cover-view";
import { canModerateMusic, creditName, formatDuration, playQueue, playState, releaseEyebrow, trackCountLabel } from "@/lib/music-view";
import { releaseBuyLabel, releaseBuyState } from "@/lib/ownership";
import { RELEASE_STATUS } from "@/lib/status-maps";
import { cn } from "@/lib/utils";

type Row = { position: number; trackId: string; track: TrackRecord | null };

/* Lifecycle actions the legacy page offered staff. The API decides which are allowed. */
const ACTIONS = ["start_demo", "start_production", "start_qc", "start_metadata_review", "approve", "schedule", "release", "takedown", "archive"];

function humanAction(action: string): string {
  const s = action.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** The release's own artist sees its status and the way to Studio; review and release buttons are
 * for staff (owner, 2026-10-27). */
function ReleaseArtistTools({ release }: { release: ReleaseRecord }) {
  return (
    <StaffPanel title="Manage this release" description="Only you and Corner Room staff see this.">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-fg-muted">Status</span>
        <StatusChip value={release.status} map={RELEASE_STATUS} />
        <Link href="/studio" className="cr-focus ml-auto inline-flex items-center gap-1 font-semibold text-link underline">
          Edit in Studio
        </Link>
      </div>
    </StaffPanel>
  );
}

function ReleaseStaffTools({ release, onChanged }: { release: ReleaseRecord; onChanged: (row?: ReleaseRecord) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [trackId, setTrackId] = useState("");
  const [position, setPosition] = useState("1");

  async function act(action: string) {
    setError(null);
    setBusy(action);
    try {
      onChanged(await transitionRelease(release.id, action, release.version));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That action could not be completed.");
    } finally {
      setBusy(null);
    }
  }

  async function attach(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy("attach");
    try {
      await addReleaseTrack(release.id, trackId, Number(position));
      setTrackId("");
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The track could not be added.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <StaffPanel description="Releasing a release does not stream, sell or calculate royalties.">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-fg-muted">Status</span>
        <StatusChip value={release.status} map={RELEASE_STATUS} />
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {ACTIONS.map((action) => (
          <Button key={action} variant="secondary" size="sm" busy={busy === action} disabled={busy !== null} onClick={() => void act(action)}>
            {humanAction(action)}
          </Button>
        ))}
      </div>
      <form onSubmit={attach} className="mt-6 grid gap-3 sm:grid-cols-[minmax(0,1fr)_7rem_auto] sm:items-end">
        <Field label="Track ID">{(c) => <Input {...c} value={trackId} onChange={(e) => setTrackId(e.target.value)} required />}</Field>
        <Field label="Position">{(c) => <Input {...c} inputMode="numeric" value={position} onChange={(e) => setPosition(e.target.value)} />}</Field>
        <Button type="submit" busy={busy === "attach"} disabled={busy !== null && busy !== "attach"}>
          Add track
        </Button>
      </form>
      {error ? (
        <p role="alert" className="mt-3 text-danger">
          {error}
        </p>
      ) : null}
    </StaffPanel>
  );
}

function SaveButton({ trackId, title }: { trackId: string; title: string }) {
  const [state, setState] = useState<"idle" | "busy" | "saved" | "error">("idle");
  async function save() {
    setState("busy");
    try {
      await addLibraryItem(trackId, "SAVE");
      setState("saved");
    } catch {
      setState("error");
    }
  }
  if (state === "saved") {
    return (
      <span role="status" className="inline-flex items-center gap-1 text-xs font-semibold text-success">
        <Check aria-hidden="true" className="size-4" /> Added to your library
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2">
      {state === "error" ? (
        <span role="alert" className="text-xs text-danger">
          Not saved
        </span>
      ) : null}
      <Button variant="ghost" size="sm" busy={state === "busy"} onClick={() => void save()} aria-label={`Save ${title} to your library`}>
        <Plus aria-hidden="true" /> Save
      </Button>
    </span>
  );
}

function TrackList({
  rows,
  playable,
  signedIn,
  artist,
  commerce,
  playFrom,
  releaseId,
}: {
  rows: Row[];
  playable: Map<string, PlayableTrackRecord>;
  signedIn: boolean;
  artist: string | null;
  commerce: CustomerCommerce;
  playFrom: PlayOptions;
  releaseId: string;
}) {
  return (
    <ol aria-label="Track list" className="cr-focus-list border-t border-line">
      {rows.map(({ position, trackId, track }) => {
        const record = playable.get(trackId);
        const state = playState(record);
        const title = track?.title ?? record?.title ?? "Track not available";
        const duration = formatDuration(record?.duration_ms);
        return (
          <li key={`${position}-${trackId}`} className="grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-x-4 border-b border-line py-3">
            <span className="cr-num text-right text-lg text-fg-muted">{String(position).padStart(2, "0")}</span>
            <div className="min-w-0">
              <p className="truncate font-semibold text-fg">
                <Link href={`/tracks/${trackId}`} className="cr-focus hover:text-highlight">
                  {title}
                </Link>
              </p>
              {state.kind === "unavailable" ? <p className="text-xs text-fg-muted">{state.reason}</p> : null}
            </div>
            <div className="flex items-center gap-2">
              {duration ? <span className="cr-num text-sm text-fg-muted">{duration}</span> : null}
              {signedIn ? <SaveButton trackId={trackId} title={title} /> : null}
              {state.kind !== "unavailable" ? (
                <TrackBuyControl
                  track={{ id: trackId, title, artist }}
                  commerce={commerce}
                  playFrom={playFrom}
                  releaseIds={[releaseId]}
                  onReleasePage={releaseId}
                />
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export default function ReleasePage() {
  const { id } = useParams<{ id: string }>();
  const { status, user } = useAuth();
  const signedIn = status === "authenticated";
  const credits = useCredits();
  const commerce = useCustomerCommerce();
  const player = usePlayer();
  const [override, setOverride] = useState<ReleaseRecord | null>(null);

  const data = useAsync(async () => {
    if (status === "loading") return null;
    const opts = { skipAuth: !signedIn };
    let release: ReleaseRecord;
    try {
      release = await fetchRelease(id, opts);
    } catch (err) {
      // Not out yet: fans see the pre-order page while the release is on pre-sale (D-PRESALE-02).
      if (err instanceof ApiError && err.status === 404) {
        const presale = await fetchPresale(id).catch(() => null);
        if (presale) return { presale };
      }
      throw err;
    }
    const composed = await fetchReleaseTracks(id, opts);
    const ordered = [...composed.items].sort((a, b) => a.position - b.position);
    const tracks = await Promise.all(ordered.map((r) => fetchTrack(r.track_id, opts).catch(() => null)));
    const rows: Row[] = ordered.map((r, i) => ({ position: r.position, trackId: r.track_id, track: tracks[i] }));
    // Lengths and playability are public (owner, 2026-10-24), so visitors see them too.
    const playable = new Map<string, PlayableTrackRecord>();
    const catalog = await fetchPlayableCatalog(opts).catch(() => null);
    for (const item of catalog?.items ?? []) playable.set(item.id, item);
    return { release, rows, playable, presale: null as PresalePageRecord | null };
  }, [id, status]);

  if (data.status === "loading" || (data.status === "ok" && !data.data)) {
    return (
      <main id="main" data-theme="sky" className="cr-scope">
        <div className="mx-auto grid max-w-[90rem] gap-10 px-4 py-14 md:grid-cols-[minmax(0,26rem)_1fr] md:px-6">
          <Skeleton className="aspect-square w-full" />
          <div className="space-y-4">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-20 w-3/4" />
            <Skeleton className="h-40 w-full" />
          </div>
        </div>
      </main>
    );
  }
  if (data.status === "error") {
    return (
      <main id="main" data-theme="sky" className="cr-scope">
        <div className="mx-auto max-w-3xl px-4 py-16">
          <ErrorState title="Release unavailable" message={loadErrorMessage(data.error, "this release")} action={<RetryButton onClick={data.reload} />} />
        </div>
      </main>
    );
  }

  if (data.data!.presale) return <PresaleView presale={data.data!.presale} />;
  const { rows, playable } = data.data! as { rows: Row[]; playable: Map<string, PlayableTrackRecord> };
  const release = override ?? (data.data! as { release: ReleaseRecord }).release;
  const artist = creditName(release, credits.artists, credits.bands);
  const durations = rows.map((r) => playable.get(r.trackId)?.duration_ms);
  const canStaff = signedIn && typeof release.version === "number";
  const owns = (trackId: string) => canPlay(commerce, trackId, [release.id]);
  const firstOwned = rows.find((r) => playState(playable.get(r.trackId)).kind === "playable" && owns(r.trackId));
  // A whole-release price (D-AUDIO-10, -11). Shown only once the customer's ownership is known.
  const releaseBuy = commerce.ready ? releaseBuyState(signedIn ? commerce.entitlements : [], commerce.offers, release.id, rows.map((r) => r.trackId)) : null;
  const buyRelease = releaseBuy?.kind === "buy" ? releaseBuy.offer : null;
  // Up next: this release's tracks in order, the ones the customer can play.
  const playFrom: PlayOptions = {
    queue: playQueue(
      rows.map((r) => ({ trackId: r.trackId, title: r.track?.title, artist })),
      playable,
      owns,
    ),
    source: release.title,
  };

  return (
    <main id="main" data-theme="sky" className="cr-scope">
      <LitSurface as="section" theme="sky" aria-labelledby="release-title">
        <div className="mx-auto grid max-w-[90rem] items-center gap-10 px-4 py-12 md:grid-cols-[minmax(0,26rem)_1fr] md:px-6 md:py-16">
          <CoverArt
            src={coverUrl({ release: release.id, hasCover: !!release.cover_asset_id }, 1200)}
            fallback={<RoomCube front={release.title} side={artist ?? release.title} tone="sky" label="" animate className="w-full" />}
            className="w-full"
          />
          <div>
            <Eyebrow>{releaseEyebrow(release, artist, rows.length)}</Eyebrow>
            <Display as="h1" id="release-title" size="lg" className="mt-4">
              {release.title}
            </Display>
            <p className="mt-4 text-lg text-fg">
              <CreditFace record={release} people={credits} />
            </p>
            <p className="mt-1 text-sm text-fg">
              {release.release_at ? (
                <>
                  Released <DateTime value={release.release_at} format="date" />
                </>
              ) : null}
              {release.release_at ? " · " : null}
              {trackCountLabel(durations)}
            </p>
            {release.status !== "RELEASED" ? (
              <div className="mt-3">
                <StatusChip value={release.status} map={RELEASE_STATUS} />
              </div>
            ) : null}
            <div className="mt-8 flex flex-wrap gap-3">
              {!signedIn ? (
                // Visitors: "Sign in" on the play button, and the price when it is on sale (owner, 2026-10-24).
                <>
                  <ButtonLink href={`/login?next=${encodeURIComponent(`/releases/${release.id}`)}`} size="lg" aria-label={`Sign in to play ${release.title}`}>
                    <LogIn aria-hidden="true" /> Sign in
                  </ButtonLink>
                  {buyRelease ? (
                    <p className="self-center text-sm text-fg">
                      {releaseBuyLabel(release.release_type, buyRelease)}{" "}
                      <Money value={{ amount_minor: buyRelease.amount_minor, currency_code: buyRelease.currency_code }} className="font-semibold" />
                    </p>
                  ) : null}
                </>
              ) : firstOwned || buyRelease ? (
                <>
                  {firstOwned ? (
                    <Button size="lg" onClick={() => void player.play({ id: firstOwned.trackId, title: firstOwned.track?.title ?? "", artist }, playFrom)}>
                      <Play aria-hidden="true" /> Play
                    </Button>
                  ) : null}
                  {buyRelease ? (
                    <ButtonLink href={`/checkout?offer=${buyRelease.id}`} size="lg" variant={firstOwned ? "secondary" : undefined} title="Buy to play">
                      <Lock aria-hidden="true" /> {releaseBuyLabel(release.release_type, buyRelease)}{" "}
                      <Money value={{ amount_minor: buyRelease.amount_minor, currency_code: buyRelease.currency_code }} />
                    </ButtonLink>
                  ) : null}
                </>
              ) : (
                <p className="self-center text-sm text-fg-muted">Not on sale yet.</p>
              )}
            </div>
          </div>
        </div>
      </LitSurface>

      <div className="mx-auto max-w-[90rem] space-y-12 px-4 pb-16 pt-10 md:px-6">
        <section aria-labelledby="release-tracks">
          <h2 id="release-tracks" className={cn("mb-4 text-xl font-bold text-fg")}>
            Tracks
          </h2>
          {rows.length === 0 ? (
            <EmptyState title="No tracks on this release yet" />
          ) : (
            <TrackList rows={rows} playable={playable} signedIn={signedIn} artist={artist} commerce={commerce} playFrom={playFrom} releaseId={release.id} />
          )}
        </section>
        <GiftNote releaseId={release.id} className="max-w-xl" />
        {release.primary_band_id ? <BandLineup bandId={release.primary_band_id} /> : null}
        {canStaff && !canModerateMusic(user?.permissions) ? <ReleaseArtistTools release={release} /> : null}
        {canStaff && canModerateMusic(user?.permissions) ? (
          <ReleaseStaffTools
            release={release}
            onChanged={(row) => {
              if (row) setOverride(row);
              else data.reload();
            }}
          />
        ) : null}
      </div>
    </main>
  );
}
