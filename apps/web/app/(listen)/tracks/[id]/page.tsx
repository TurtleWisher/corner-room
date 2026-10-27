"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { FormEvent, useState } from "react";
import { ChartLine } from "lucide-react";

import { BandLineup } from "@/components/artists/band-lineup";
import { useAuth } from "@/components/auth-provider";
import { LitSurface } from "@/components/brand/corner-light";
import { CoverArt } from "@/components/brand/cover-art";
import { Display, Eyebrow } from "@/components/brand/display";
import { RoomCube } from "@/components/brand/room-cube";
import { Button, Card, ErrorState, Field, Input, Skeleton, StatusChip } from "@/components/ds";
import { TrackBuyControl, useCustomerCommerce, usePlayableCatalog } from "@/components/music/commerce";
import { CreditFace } from "@/components/music/credit-face";
import { SongLyrics } from "@/components/music/song-lyrics";
import { useCredits } from "@/components/music/credits";
import { TrackAudioPanel } from "@/components/music/track-audio-panel";
import { RetryButton, StaffPanel } from "@/components/shell/staff-panel";
import { loadErrorMessage, useAsync } from "@/components/use-async";
import {
  ApiError,
  addTrackCredit,
  fetchPlayableCatalog,
  fetchTrack,
  fetchTrackCredits,
  transitionTrack,
  type TrackRecord,
} from "@/lib/api";
import { coverUrl } from "@/lib/cover-view";
import { formatCount } from "@/lib/format/count";
import { humanizeStatus } from "@/lib/format/status";
import { canModerateMusic, creditName, creditPerson, formatDuration, playQueue, playState } from "@/lib/music-view";
import { ownsTrack, releaseIdsFor, trackBuyState } from "@/lib/ownership";
import { RELEASE_STATUS } from "@/lib/status-maps";

const ACTIONS = ["submit", "start_review", "approve", "reject", "schedule", "release", "takedown", "archive"];

/** The song's own artist sees its status and audio report here, with the way to Studio; review
 * and release buttons are for staff (owner, 2026-10-27). */
function TrackArtistTools({ track }: { track: TrackRecord }) {
  return (
    <StaffPanel title="Manage this song" description="Only you and Corner Room staff see this.">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-fg-muted">Status</span>
        <StatusChip value={track.status} map={RELEASE_STATUS} />
        {track.isrc ? <span className="cr-num text-fg-muted">ISRC {track.isrc}</span> : null}
        <Link href="/studio" className="cr-focus ml-auto inline-flex items-center gap-1 font-semibold text-link underline">
          Edit in Studio
        </Link>
      </div>
      <TrackAudioPanel trackId={track.id} />
    </StaffPanel>
  );
}

function TrackStaffTools({ track, onChanged }: { track: TrackRecord; onChanged: (row?: TrackRecord) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState("");
  const [artistId, setArtistId] = useState("");

  async function run(key: string, fn: () => Promise<unknown>, after?: (v: unknown) => void) {
    setBusy(key);
    setError(null);
    try {
      const v = await fn();
      after?.(v);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That action could not be completed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <StaffPanel description="Catalog edits only. Playback and royalties are separate.">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-fg-muted">Status</span>
        <StatusChip value={track.status} map={RELEASE_STATUS} />
        {track.isrc ? <span className="cr-num text-fg-muted">ISRC {track.isrc}</span> : null}
        <Link href={`/staff/analytics/tracks/${track.id}`} className="cr-focus ml-auto inline-flex items-center gap-1 font-semibold text-link underline">
          <ChartLine aria-hidden="true" className="size-4" /> Track analytics
        </Link>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {ACTIONS.map((a) => (
          <Button key={a} variant="secondary" size="sm" busy={busy === a} disabled={busy !== null}
            onClick={() => void run(a, () => transitionTrack(track.id, a, track.version), (row) => onChanged(row as TrackRecord))}>
            {humanizeStatus(a)}
          </Button>
        ))}
      </div>
      <TrackAudioPanel trackId={track.id} />
      <form
        className="mt-6 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          void run("credit", () => addTrackCredit(track.id, role, artistId || undefined), () => {
            setRole("");
            setArtistId("");
            onChanged();
          });
        }}
      >
        <Field label="Artist ID">{(c) => <Input {...c} value={artistId} onChange={(e) => setArtistId(e.target.value)} required />}</Field>
        <Field label="Credit role" hint="Attribution only, not a royalty share">
          {(c) => <Input {...c} value={role} onChange={(e) => setRole(e.target.value)} required />}
        </Field>
        <Button type="submit" busy={busy === "credit"} disabled={busy !== null && busy !== "credit"}>
          Add credit
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

export default function TrackPage() {
  const { id } = useParams<{ id: string }>();
  const { status, user } = useAuth();
  const signedIn = status === "authenticated";
  const people = useCredits();
  const commerce = useCustomerCommerce();
  const catalog = usePlayableCatalog();
  // Up next from a single track page: the customer's playable music, as in the listening room.
  const yourMusic = {
    queue: playQueue(
      catalog.list.map((t) => ({ trackId: t.id, title: t.title, artist: creditName(t, people.artists, people.bands) })),
      catalog.map,
      (trackId) => ownsTrack(commerce.entitlements, trackId, releaseIdsFor(catalog.map, trackId)),
    ),
    source: "Your music",
  };
  const [override, setOverride] = useState<TrackRecord | null>(null);
  const data = useAsync(async () => {
    if (status === "loading") return null;
    const opts = { skipAuth: !signedIn };
    const [track, credits, playable] = await Promise.all([
      fetchTrack(id, opts),
      fetchTrackCredits(id, opts).then((p) => p.items).catch(() => []),
      fetchPlayableCatalog(opts).then((p) => p.items.find((t) => t.id === id)).catch(() => undefined),
    ]);
    return { track, credits, playable };
  }, [id, status]);

  if (data.status === "loading" || (data.status === "ok" && !data.data)) {
    return (
      <main id="main" data-theme="sky" className="cr-scope">
        <div className="mx-auto grid max-w-[90rem] gap-10 px-4 py-14 md:grid-cols-[minmax(0,22rem)_1fr] md:px-6">
          <Skeleton className="aspect-square w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      </main>
    );
  }
  if (data.status === "error") {
    return (
      <main id="main" data-theme="sky" className="cr-scope">
        <div className="mx-auto max-w-3xl px-4 py-16">
          <h1 className="sr-only">Track</h1>
          <ErrorState title="Track unavailable" message={loadErrorMessage(data.error, "this track")} action={<RetryButton onClick={data.reload} />} />
        </div>
      </main>
    );
  }

  const { credits, playable } = data.data!;
  const track = override ?? data.data!.track;
  const artist = creditName(track, people.artists, people.bands);
  const play = playState(playable);
  // A song bought as part of its album or EP counts as owned here too (D-AUDIO-12).
  const buy = trackBuyState(commerce.entitlements, commerce.offers, track.id, track.release_ids ?? []);
  const duration = formatDuration(playable?.duration_ms);
  const canStaff = signedIn && typeof track.version === "number";

  return (
    <main id="main" data-theme="sky" className="cr-scope">
      <LitSurface as="section" theme="sky" aria-labelledby="track-title">
        <div className="mx-auto grid max-w-[90rem] items-center gap-10 px-4 py-12 md:grid-cols-[minmax(0,22rem)_1fr] md:px-6 md:py-16">
          <CoverArt
            src={coverUrl({ track: track.id }, 1200)}
            fallback={<RoomCube front={track.title} side={artist ?? track.title} tone="sky" label="" animate className="w-full" />}
            className="w-full"
          />
          <div>
            <Eyebrow>{["Track", artist, duration].filter(Boolean).join(" · ")}</Eyebrow>
            <Display as="h1" id="track-title" size="lg" className="mt-4">
              {track.title}
            </Display>
            <p className="mt-4 text-lg text-fg">
              <CreditFace record={track} people={people} />
            </p>
            {typeof track.listens === "number" ? (
              <p className="mt-2 text-sm text-fg-muted">
                <span className="cr-num font-semibold text-fg">{formatCount(track.listens)}</span> {track.listens === 1 ? "listen" : "listens"}
              </p>
            ) : null}
            {play.kind === "unavailable" ? <p className="mt-2 text-sm text-fg-muted">{play.reason}</p> : null}
            <div className="mt-8 flex flex-wrap items-center gap-3">
              {play.kind === "unavailable" ? null : (
                <TrackBuyControl
                  track={{ id: track.id, title: track.title, artist }}
                  commerce={commerce}
                  size="lg"
                  playFrom={yourMusic}
                  releaseIds={track.release_ids ?? []}
                />
              )}
            </div>
            {buy.kind === "owned" ? (
              <p className="mt-3 text-sm text-fg">
                {buy.via === "track"
                  ? "You own this track."
                  : buy.via === "release"
                    ? "You own this track with the release you bought."
                    : "Included with your catalog access."}
              </p>
            ) : null}
          </div>
        </div>
      </LitSurface>

      <div className="mx-auto grid max-w-[90rem] gap-12 px-4 pb-16 pt-10 md:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <section aria-labelledby="credits-title">
          <h2 id="credits-title" className="mb-4 text-xl font-bold text-fg">
            Credits
          </h2>
          {credits.length === 0 ? (
            <p className="text-sm text-fg-muted">No credits listed yet.</p>
          ) : (
            <ul className="border-t border-line">
              {credits.map((c) => {
                const who = creditPerson(c, people.artists);
                return (
                  <li key={c.id} className="flex justify-between gap-4 border-b border-line py-3 text-sm">
                    <span className="text-fg-muted">{humanizeStatus(c.credit_role)}</span>
                    <span className="font-semibold text-fg">{who ?? "Not available"}</span>
                  </li>
                );
              })}
            </ul>
          )}
          <SongLyrics lyrics={track.lyrics} />
          {track.primary_band_id ? <BandLineup bandId={track.primary_band_id} className="mt-10" /> : null}
        </section>
        <Card className="h-fit p-5 text-sm text-fg">
          <p className="font-semibold">How listening works</p>
          <p className="mt-2 text-fg-muted">Buy a song, or the release it is on, to keep it. Sign in to listen to what you own.</p>
        </Card>
        {canStaff ? (
          <div className="lg:col-span-2">
            {canModerateMusic(user?.permissions) ? (
              <TrackStaffTools track={track} onChanged={(row) => (row ? setOverride(row) : data.reload())} />
            ) : (
              <TrackArtistTools track={track} />
            )}
          </div>
        ) : null}
      </div>
    </main>
  );
}
