"use client";

/*
 * The Preview Room (owner, 2026-11-07, D-TEASER-00 to D-TEASER-04, URL-11; named 2026-11-08, D-TEASER-06). Anyone can listen here,
 * without an account, as often as they like: the teaser is the free way to hear a song before buying
 * it. It says "Preview" in words, plays only the preview's own audio through the site's player (no
 * listening session, no song play reported), and after each full listen offers a gentle next step
 * that never stops the preview, never moves the page, and goes away with Escape or Not now.
 */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, Headphones, Link2, Pause, Play, RotateCcw, X } from "lucide-react";

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
import { PREVIEW_FACTS, ownedLink, shareLink, suggestionFor, teaserKey, teaserLabel, teaserLength, teaserPath } from "@/lib/teaser-room-view";

function backLink(t: PublicTeaserRecord): { href: string; label: string } {
  if (t.track_released) return { href: `/tracks/${t.track_id}`, label: "Back to the song" };
  return { href: `/releases/${t.release_id}`, label: `About ${t.release_title}` };
}

function Scrubber({ title, current, lengthMs }: { title: string; current: boolean; lengthMs: number | null }) {
  const p = usePlayer();
  const live = usePlayerProgress();
  // Before the first play the bar is already there, at rest, showing the preview's own length.
  const position = current ? live.position : 0;
  const duration = current && live.duration > 0 ? live.duration : (lengthMs ?? 0) / 1000;
  return (
    <div className="flex items-center gap-3">
      <span className="cr-num w-10 text-right text-xs text-fg-muted">{clock(position)}</span>
      <input
        type="range"
        min={0}
        max={Math.max(1, Math.floor(duration || 0))}
        step={1}
        value={Math.floor(position)}
        disabled={!current || duration <= 0}
        style={{ "--pct": `${duration > 0 ? Math.min(100, (position / duration) * 100) : 0}%` } as React.CSSProperties}
        onChange={(e) => p.seek(Number(e.target.value))}
        aria-label={`Seek in the preview of ${title}`}
        aria-valuetext={`${clock(position)} of ${durationLabel(duration)}`}
        className="cr-focus cr-prange min-w-0 flex-1"
      />
      <span className="cr-num w-10 text-xs text-fg-muted">{durationLabel(duration)}</span>
    </div>
  );
}

/** Copy this preview's link. Says so in words; falls back to showing the link when copying is blocked. */
function CopyLink({ teaserId }: { teaserId: string }) {
  const [state, setState] = useState<"idle" | "copied" | "blocked">("idle");
  const copy = async () => {
    const link = shareLink(window.location.origin, teaserId);
    try {
      await navigator.clipboard.writeText(link);
      setState("copied");
    } catch {
      setState("blocked");
    }
    window.setTimeout(() => setState("idle"), 2400);
  };
  return (
    <Button size="lg" variant="ghost" onClick={() => void copy()}>
      {state === "copied" ? <Check aria-hidden="true" /> : <Link2 aria-hidden="true" />}
      <span aria-live="polite">{state === "copied" ? "Link copied" : state === "blocked" ? "Copy it from the address bar" : "Copy link"}</span>
    </Button>
  );
}

/** One of the song's other previews: plays here, in the same player, and links to its own room. */
function OtherPreview({ t, teaser }: { t: PublicTeaserRecord["other_teasers"][number]; teaser: PublicTeaserRecord }) {
  const player = usePlayer();
  const current = player.isCurrent(teaserKey(t.id));
  const playing = current && player.status === "playing";
  const name = t.title ?? "Preview";
  return (
    <li className="pr-other" data-current={current || undefined}>
      <button
        type="button"
        className="pr-other-play cr-focus"
        aria-label={`${playing ? "Pause" : "Play"} ${name}`}
        onClick={() =>
          current && player.status !== "problem"
            ? player.toggle()
            : void player.playTeaser({ teaserId: t.id, trackId: teaser.track_id, title: teaser.track_title, artist: teaser.artist, label: name })
        }
      >
        {playing ? <Pause aria-hidden="true" className="size-4" /> : <Play aria-hidden="true" className="size-4" />}
      </button>
      <Link href={teaserPath(t.id)} className="cr-focus min-w-0 flex-1 truncate text-sm font-semibold text-fg hover:text-highlight">
        {name}
      </Link>
      <span className="cr-num text-xs text-fg-muted">{teaserLength(t.duration_ms)}</span>
    </li>
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
  const length = teaserLength(teaser.duration_ms);

  const start = () => {
    setShown(false);
    void player.playTeaser({
      teaserId: teaser.id,
      trackId: teaser.track_id,
      title: teaser.track_title,
      artist: teaser.artist,
      label: teaser.title ?? "Preview",
    });
  };
  const toggle = () => (current && player.status !== "problem" ? player.toggle() : start());

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
  const status = current ? playerStatusText(player) : "Ready when you are";
  const artistHref = teaser.artist_id && teaser.artist_kind ? `/${teaser.artist_kind === "band" ? "bands" : "artists"}/${teaser.artist_id}` : null;

  return (
    <LitSurface as="section" theme="sky" aria-labelledby="teaser-title" className="pr-room">
      {/* The cover, stretched soft behind the room: colour only, never detail. */}
      {cover ? <div aria-hidden="true" className="pr-wash" style={{ backgroundImage: `url("${cover}")` }} /> : null}
      <div className="relative mx-auto max-w-[84rem] px-4 pb-16 pt-8 md:px-6 md:pt-10">
        <Link href={back.href} className="pr-back cr-focus">
          <ArrowLeft aria-hidden="true" className="size-4" /> {back.label}
        </Link>

        <div className="mt-6 grid items-start gap-x-14 gap-y-8 lg:grid-cols-[minmax(0,28rem)_minmax(0,1fr)]">
          {/* Cover: the play key sits on it, as on a record sleeve. */}
          <div className="pr-cover" data-playing={playing || undefined}>
            <div aria-hidden="true" className="pr-cover-glow" />
            <div className="pr-cover-art">
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
            <span aria-hidden="true" className="pr-eq" data-on={playing || undefined}>
              <i /><i /><i /><i />
            </span>
          </div>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Eyebrow>Preview Room</Eyebrow>
              <span className="pr-chip">{label}</span>
              {length ? <span className="pr-chip cr-num">{length}</span> : null}
              <span className="pr-chip pr-chip-free">Free</span>
            </div>
            <Display as="h1" id="teaser-title" size="lg" className="mt-5">
              {teaser.track_title}
            </Display>
            {teaser.artist ? (
              <p className="mt-3 text-lg text-fg">
                {artistHref ? (
                  <Link href={artistHref} className="cr-focus font-semibold hover:text-highlight">
                    {teaser.artist}
                  </Link>
                ) : (
                  teaser.artist
                )}
              </p>
            ) : null}
            <p className="mt-2 max-w-xl text-sm text-fg-muted">
              This is a short part of the song, not the full song. Listen free, as often as you like.
            </p>

            {/* The player: there from the start, so the page never jumps when the music begins. */}
            <div className="pr-deck cr-cut cr-glass-card mt-7 max-w-2xl" data-playing={playing || undefined}>
              <div className="flex items-center gap-4">
                <Button
                  size="lg"
                  onClick={toggle}
                  busy={current && player.status === "loading"}
                  aria-label={playing ? "Pause the preview" : "Play the preview"}
                  data-playing={playing ? "" : undefined}
                  className="pr-key"
                >
                  {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />} {playing ? "Pause" : "Play the preview"}
                </Button>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-fg">{teaser.title ?? "Preview"}</p>
                  <p className="truncate text-xs text-fg-muted" role="status">
                    {status}
                  </p>
                </div>
                {current ? (
                  <Button variant="secondary" onClick={start} aria-label="Play the preview again from the start">
                    <RotateCcw aria-hidden="true" /> Replay
                  </Button>
                ) : null}
              </div>
              <div className="mt-5">
                <Scrubber title={teaser.track_title} current={current} lengthMs={teaser.duration_ms} />
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              {teaser.next_step.kind === "OWNED" ? (
                <ButtonLink href={ownedLink(teaser).href} size="lg" variant="secondary">
                  <Headphones aria-hidden="true" /> {ownedLink(teaser).label}
                </ButtonLink>
              ) : null}
              <CopyLink teaserId={teaser.id} />
            </div>

            {shown && suggestion ? (
              <div ref={panel} role="status" aria-live="polite" className="pr-suggest cr-cut cr-glass-card mt-6 max-w-2xl p-5">
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

            <dl className="pr-facts mt-10 max-w-2xl">
              {PREVIEW_FACTS.map((fact, i) => (
                <div key={fact.title} className="pr-fact">
                  <dt>
                    <span aria-hidden="true" className="cr-num pr-fact-n">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    {fact.title}
                  </dt>
                  <dd>{fact.body}</dd>
                </div>
              ))}
            </dl>

            {teaser.other_teasers.length > 0 ? (
              <div className="mt-10 max-w-2xl">
                <p className="cr-eyebrow text-[0.6875rem] text-fg-muted">More previews of this song</p>
                <ul className="mt-3 grid gap-2">
                  {teaser.other_teasers.map((t) => (
                    <OtherPreview key={t.id} t={t} teaser={teaser} />
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
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
        <div className="mx-auto grid max-w-[84rem] gap-10 px-4 py-14 lg:grid-cols-[minmax(0,28rem)_1fr] md:px-6">
          <Skeleton className="aspect-square w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : data.status === "error" ? (
        <div className="mx-auto max-w-3xl px-4 py-16">
          <h1 className="sr-only">Preview</h1>
          <ErrorState title="Preview unavailable" message={loadErrorMessage(data.error, "this preview")} action={<RetryButton onClick={data.reload} />} />
        </div>
      ) : (
        <Room teaser={data.data!} />
      )}
    </main>
  );
}
