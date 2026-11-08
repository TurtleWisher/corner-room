"use client";

/*
 * The Preview Room (owner, 2026-11-07, D-TEASER-00 to D-TEASER-04, URL-11; named 2026-11-08, D-TEASER-06). Anyone can listen here,
 * without an account, as often as they like: the teaser is the free way to hear a song before buying
 * it. It says "Teaser" in words, plays only the teaser's own audio through the site's player (no
 * listening session, no song play reported), and after each full listen offers a gentle next step
 * that never stops the teaser, never moves the page, and goes away with Escape or Not now.
 */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Pause, Play, RotateCcw, X } from "lucide-react";

import { useAuth } from "@/components/auth-provider";
import { LitSurface } from "@/components/brand/corner-light";
import { CoverArt } from "@/components/brand/cover-art";
import { Display, Eyebrow } from "@/components/brand/display";
import { RoomCube } from "@/components/brand/room-cube";
import { Button, ButtonLink, ErrorState, Skeleton } from "@/components/ds";
import { PresaleCover } from "@/components/music/presale-cover";
import { playerStatusText, usePlayer, usePlayerProgress } from "@/components/music/player";
import { RetryButton } from "@/components/shell/staff-panel";
import { loadErrorMessage, useAsync } from "@/components/use-async";
import { countTeaser, fetchPublicTeaser, type PublicTeaserRecord } from "@/features/teasers/api";
import { coverUrl } from "@/lib/cover-view";
import { clock, durationLabel } from "@/lib/player-model";
import { ownedLink, suggestionFor, teaserKey, teaserLabel, teaserLength, teaserPath } from "@/lib/teaser-room-view";

function backLink(t: PublicTeaserRecord): { href: string; label: string } {
  if (t.track_released) return { href: `/tracks/${t.track_id}`, label: "Back to the song" };
  return { href: `/releases/${t.release_id}`, label: `About ${t.release_title}` };
}

function Scrubber({ title }: { title: string }) {
  const p = usePlayer();
  const { position, duration } = usePlayerProgress();
  return (
    <div className="flex items-center gap-3">
      <span className="cr-num w-10 text-right text-xs text-fg-muted">{clock(position)}</span>
      <input
        type="range"
        min={0}
        max={Math.max(1, Math.floor(duration || 0))}
        step={1}
        value={Math.floor(position)}
        disabled={duration <= 0}
        style={{ "--pct": `${duration > 0 ? Math.min(100, (position / duration) * 100) : 0}%` } as React.CSSProperties}
        onChange={(e) => p.seek(Number(e.target.value))}
        aria-label={`Seek in the teaser of ${title}`}
        aria-valuetext={`${clock(position)} of ${durationLabel(duration)}`}
        className="cr-focus cr-prange min-w-0 flex-1"
      />
      <span className="cr-num w-10 text-xs text-fg-muted">{durationLabel(duration)}</span>
    </div>
  );
}

function Room({ teaser }: { teaser: PublicTeaserRecord }) {
  const player = usePlayer();
  const key = teaserKey(teaser.id);
  const current = player.isCurrent(key);
  const playing = current && player.status === "playing";
  const [shown, setShown] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const suggestion = suggestionFor(teaser);
  const back = backLink(teaser);
  const label = teaserLabel(teaser);

  const start = () => {
    setShown(false);
    void player.playTeaser({
      teaserId: teaser.id,
      trackId: teaser.track_id,
      title: teaser.track_title,
      artist: teaser.artist,
      label: teaser.title ?? "Teaser",
    });
  };

  // After each full listen (not on open, play, pause, seeking to the end or a failed load).
  useEffect(
    () =>
      player.onTeaserComplete((id) => {
        if (id === teaser.id) setShown(true);
      }),
    [player, teaser.id],
  );

  useEffect(() => {
    if (!shown) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShown(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shown]);

  const cover = teaser.cover_url ? coverUrl({ signed: teaser.cover_url }, 1200) : null;
  const status = current ? playerStatusText(player) : "";

  return (
    <LitSurface as="section" theme="sky" aria-labelledby="teaser-title">
      <div className="relative mx-auto grid max-w-[80rem] items-center gap-x-12 gap-y-8 px-4 py-12 md:grid-cols-[minmax(0,26rem)_1fr] md:px-6 md:py-16">
        <div>
          {teaser.track_released || cover ? (
            <CoverArt
              src={cover}
              fallback={<RoomCube front={teaser.track_title} side={teaser.artist ?? teaser.track_title} tone="sky" label="" animate className="w-full" />}
              className="w-full"
            />
          ) : (
            <PresaleCover coverUrl={null} title={teaser.track_title} artist={teaser.artist} />
          )}
        </div>
        <div>
          <Link href={back.href} className="cr-focus mb-6 inline-flex items-center gap-1 text-sm font-semibold text-link hover:underline">
            <ArrowLeft aria-hidden="true" className="size-4" /> {back.label}
          </Link>
          <Eyebrow>Preview Room · {label}</Eyebrow>
          <Display as="h1" id="teaser-title" size="lg" className="mt-4">
            {teaser.track_title}
          </Display>
          {teaser.artist ? <p className="mt-3 text-lg text-fg">{teaser.artist}</p> : null}
          <p className="mt-2 text-sm text-fg-muted">
            {teaserLength(teaser.duration_ms) ? `${teaserLength(teaser.duration_ms)} teaser · ` : ""}
            This is a short part of the song, not the full song. Listen free, as often as you like.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button
              size="lg"
              onClick={() => (current && player.status !== "problem" ? player.toggle() : start())}
              busy={current && player.status === "loading"}
              aria-label={playing ? "Pause the teaser" : "Play the teaser"}
              data-playing={playing ? "" : undefined}
            >
              {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />} {playing ? "Pause" : "Play the teaser"}
            </Button>
            {current ? (
              <Button size="lg" variant="secondary" onClick={start} aria-label="Play the teaser again from the start">
                <RotateCcw aria-hidden="true" /> Replay
              </Button>
            ) : null}
            {teaser.next_step.kind === "OWNED" ? (
              <ButtonLink href={ownedLink(teaser).href} size="lg" variant="ghost">
                {ownedLink(teaser).label}
              </ButtonLink>
            ) : null}
          </div>
          {current ? (
            <div className="mt-6 max-w-xl">
              <Scrubber title={teaser.track_title} />
              <p className="mt-2 text-sm text-fg-muted" role="status">
                {status}
              </p>
            </div>
          ) : null}

          {shown && suggestion ? (
            <div
              ref={panel}
              role="status"
              aria-live="polite"
              className="cr-cut cr-glass-card mt-8 max-w-xl p-5"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="cr-eyebrow text-[0.6875rem] text-highlight">{suggestion.eyebrow}</p>
                  <p className="mt-2 text-lg font-bold text-fg">{suggestion.heading}</p>
                  <p className="mt-1 text-sm text-fg">{suggestion.body}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setShown(false)}
                  aria-label="Close the suggestion"
                  className="cr-focus inline-flex size-9 shrink-0 items-center justify-center text-fg-muted hover:text-fg"
                >
                  <X aria-hidden="true" className="size-4" />
                </button>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {suggestion.action ? (
                  <ButtonLink href={suggestion.action.href} onClick={() => countTeaser(teaser.id, "prompt_click")}>
                    {suggestion.action.label}
                  </ButtonLink>
                ) : null}
                <Button variant="secondary" onClick={start}>
                  <RotateCcw aria-hidden="true" /> Listen again
                </Button>
                <Button variant="ghost" onClick={() => setShown(false)}>
                  Not now
                </Button>
              </div>
            </div>
          ) : null}

          {teaser.other_teasers.length > 0 ? (
            <div className="mt-10 max-w-xl">
              <p className="cr-eyebrow text-[0.6875rem] text-fg-muted">More teasers of this song</p>
              <ul className="mt-3 grid gap-2">
                {teaser.other_teasers.map((t) => (
                  <li key={t.id}>
                    <Link href={teaserPath(t.id)} className="cr-focus flex justify-between gap-3 border border-line p-3 text-sm font-semibold text-fg hover:border-highlight">
                      <span>{t.title ?? "Teaser"}</span>
                      <span className="cr-num font-normal text-fg-muted">{teaserLength(t.duration_ms)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    </LitSurface>
  );
}

export function TeaserRoom({ teaserId }: { teaserId: string }) {
  const { status } = useAuth();
  const data = useAsync(
    async () => (status === "loading" ? null : fetchPublicTeaser(teaserId, { signedIn: status === "authenticated" })),
    [teaserId, status],
  );
  return (
    <main id="main" data-theme="sky" className="cr-scope">
      {data.status === "loading" || (data.status === "ok" && !data.data) ? (
        <div className="mx-auto grid max-w-[80rem] gap-10 px-4 py-14 md:grid-cols-[minmax(0,26rem)_1fr] md:px-6">
          <Skeleton className="aspect-square w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : data.status === "error" ? (
        <div className="mx-auto max-w-3xl px-4 py-16">
          <h1 className="sr-only">Teaser</h1>
          <ErrorState title="Teaser unavailable" message={loadErrorMessage(data.error, "this teaser")} action={<RetryButton onClick={data.reload} />} />
        </div>
      ) : (
        <Room teaser={data.data!} />
      )}
    </main>
  );
}
