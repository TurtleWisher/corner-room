"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  AudioLines,
  LogIn,
  Maximize2,
  Pause,
  Play,
  RotateCcw,
  ShoppingBag,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";

import { CoverArt } from "@/components/brand/cover-art";
import { Logo } from "@/components/brand/logo";
import { PointerLightLayer } from "@/components/brand/pointer-light";
import { RoomCube } from "@/components/brand/room-cube";
import { ButtonLink } from "@/components/ds";
import { roomCameFrom } from "@/components/music/outside-room";
import { playerStatusText, RepeatButton, ShuffleButton, usePlayer, usePlayerProgress, type PlayerTrack } from "@/components/music/player";
import { TrackActions } from "@/components/music/track-actions";
import {
  carouselWindow,
  edgeZone,
  isVisibleOffset,
  leaveTarget,
  nowPlayingAnnouncement,
  queuePositionLabel,
  swipeDirection,
} from "@/lib/listening-room-view";
import { coverUrl } from "@/lib/cover-view";
import { clock, durationLabel } from "@/lib/player-model";
import { cn } from "@/lib/utils";

/*
 * The listening room (owner direction 2026-10-14). A dedicated full-screen room: the playing
 * cover blurred across the whole screen and drifting while music plays, a centred 3D carousel
 * (earlier tracks on the left, later on the right), and a focus view for one song whose
 * neighbours slide in only when a mouse nears the left or right edge. Presentation only: every
 * control calls the one PlayerProvider, and every state shown is the audio element's own.
 */

/** Keyboard step on the scrubbers (music.md section 9). */
const SEEK_STEP_S = 5;
/** How long an outgoing backdrop stays while the new one fades in. */
const BACKDROP_FADE_MS = 1400;
/** Side of the canvas the cover is drawn into for the backdrop; stretched, it is the blur. */
const BACKDROP_PX = 40;

type Mode = "carousel" | "focus";

// Covers only redraw when their words change; turning the carousel never redraws them.
const Cube = memo(function Cube({ title, artist }: { title: string; artist: string }) {
  return <RoomCube front={title} side={artist} tone="sky" label="" className="size-full" />;
});

// The official cover when the song has one (OD-05), the cube otherwise.
const Cover = memo(function Cover({ id, title, artist }: { id: string; title: string; artist: string }) {
  return <CoverArt src={coverUrl({ track: id }, 480)} fallback={<Cube title={title} artist={artist} />} className="size-full" />;
});

function titleOf(t: PlayerTrack): string {
  return t.title || "Track";
}

/**
 * The playing cover, blurred across the whole room. The cover is drawn into a tiny canvas and
 * stretched to fill the screen: the stretch is the blur, so the browser never blurs a full
 * screen of pixels each frame, and the slow drift moves one small texture. A new track's cover
 * fades in over the old one.
 */
function Backdrop({ track }: { track: PlayerTrack | null }) {
  const source = useRef<HTMLDivElement>(null);
  // The song the next backdrop layer belongs to (read when its canvas mounts).
  const trackId = useRef<string | null>(null);
  trackId.current = track?.id ?? null;
  const [layers, setLayers] = useState<{ key: string; leaving: boolean }[]>([]);
  const key = track ? `${track.id}|${titleOf(track)}|${track.artist ?? ""}` : "";

  useEffect(() => {
    if (!key) return;
    setLayers((prev) =>
      prev.at(-1)?.key === key ? prev : [...prev.filter((l) => !l.leaving).map((l) => ({ ...l, leaving: true })), { key, leaving: false }],
    );
    const done = window.setTimeout(() => setLayers((prev) => prev.filter((l) => !l.leaving)), BACKDROP_FADE_MS);
    return () => window.clearTimeout(done);
  }, [key]);

  const draw = useCallback((canvas: HTMLCanvasElement | null) => {
    if (!canvas || canvas.dataset.drawn) return;
    const svg = source.current?.querySelector("svg");
    const id = trackId.current;
    if (!svg && !id) return;
    canvas.dataset.drawn = "1";
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = canvas.getContext("2d");
    } catch {
      ctx = null;
    }
    if (!ctx) return;
    const paint = (img: HTMLImageElement) => {
      ctx.clearRect(0, 0, BACKDROP_PX, BACKDROP_PX);
      ctx.filter = "blur(2px)";
      ctx.drawImage(img, -3, -3, BACKDROP_PX + 6, BACKDROP_PX + 6);
      canvas.dataset.ready = "";
    };
    const cube = () => {
      if (!svg) return;
      const img = new Image();
      img.onload = () => paint(img);
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
    };
    // The official cover blurred behind the room (OD-05); the cube's when there is none.
    if (!id) return cube();
    const photo = new Image();
    photo.onload = () => paint(photo);
    photo.onerror = cube;
    photo.src = coverUrl({ track: id }, 160) ?? "";
  }, []);

  return (
    <div aria-hidden="true" className="lr-backdrop">
      {/* The cover the canvas copies: drawn once, never shown. */}
      <div ref={source} className="lr-backdrop-source">
        {track ? <Cube title={titleOf(track)} artist={track.artist || titleOf(track)} /> : null}
      </div>
      <div className="lr-drift">
        {layers.map((l) => (
          <canvas key={l.key} ref={l.leaving ? undefined : draw} width={BACKDROP_PX} height={BACKDROP_PX} data-leaving={l.leaving ? "" : undefined} />
        ))}
      </div>
      <div className="lr-scrim" />
    </div>
  );
}

function Scrubber({ label, wide = false }: { label: string; wide?: boolean }) {
  const p = usePlayer();
  const { position, duration } = usePlayerProgress();
  // While dragging, show where the thumb is; the media position is set when it is let go.
  const [scrub, setScrub] = useState<number | null>(null);
  const known = duration > 0;
  const shown = scrub ?? position;
  const pct = known ? Math.min(100, (shown / duration) * 100) : 0;
  const commit = () => {
    if (scrub !== null) p.seek(scrub);
    setScrub(null);
  };
  return (
    <div className={cn("lr-scrub", wide && "lr-scrub-wide")}>
      <span className="cr-num text-xs text-fg-muted">{clock(shown)}</span>
      <input
        type="range"
        min={0}
        max={known ? duration : 1}
        step={0.1}
        value={known ? shown : 0}
        disabled={!known}
        style={{ "--pct": `${pct}%` } as React.CSSProperties}
        onChange={(e) => setScrub(Number(e.target.value))}
        onPointerUp={commit}
        onTouchEnd={commit}
        onBlur={commit}
        onKeyDown={(e) => {
          const to =
            e.key === "ArrowRight" || e.key === "ArrowUp"
              ? position + SEEK_STEP_S
              : e.key === "ArrowLeft" || e.key === "ArrowDown"
                ? position - SEEK_STEP_S
                : e.key === "Home"
                  ? 0
                  : e.key === "End"
                    ? duration
                    : null;
          if (to === null) return;
          e.preventDefault();
          e.stopPropagation();
          setScrub(null);
          p.seek(to);
        }}
        aria-label={`Seek in ${label}`}
        aria-valuetext={known ? `${clock(shown)} of ${clock(duration)}` : "Length not known yet"}
        className="lr-range cr-focus"
      />
      <span className="cr-num text-right text-xs text-fg-muted">{durationLabel(duration)}</span>
    </div>
  );
}

function Volume() {
  const p = usePlayer();
  const level = p.muted ? 0 : p.volume;
  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={p.toggleMute}
        aria-pressed={p.muted}
        aria-label={p.muted ? "Unmute" : "Mute"}
        className="cr-focus inline-flex size-10 items-center justify-center text-fg-muted hover:text-fg"
      >
        {level === 0 ? <VolumeX aria-hidden="true" className="size-4" /> : <Volume2 aria-hidden="true" className="size-4" />}
      </button>
      {p.volumeSettable ? (
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={level}
          style={{ "--pct": `${level * 100}%` } as React.CSSProperties}
          onChange={(e) => p.setVolume(Number(e.target.value))}
          onKeyDown={(e) => e.stopPropagation()}
          aria-label="Volume"
          aria-valuetext={`${Math.round(level * 100)}%`}
          className="lr-range lr-volume cr-focus"
        />
      ) : null}
      <Normalise />
    </div>
  );
}

/**
 * "Normalise volume" (D-AUDIO-08): songs play at a similar loudness, on by default. Hidden where
 * the device ignores page volume (iOS), since it could not work there.
 */
function Normalise() {
  const p = usePlayer();
  if (!p.levellingAvailable) return null;
  return (
    <button
      type="button"
      onClick={p.toggleNormalise}
      aria-pressed={p.normalise}
      aria-label={p.normalise ? "Normalise volume: on" : "Normalise volume: off"}
      title={p.normalise ? "Normalise volume on: songs play at a similar loudness" : "Normalise volume off"}
      className={cn("cr-focus inline-flex size-10 items-center justify-center hover:text-fg", p.normalise ? "text-highlight" : "text-fg-muted")}
    >
      <AudioLines aria-hidden="true" className="size-4" />
    </button>
  );
}

/** What is streaming, from the API ("Opus · 160 kbps"). Nothing when it is not known. */
function Format() {
  const p = usePlayer();
  if (!p.format) return null;
  return <span className="cr-num text-[0.6875rem] text-fg-muted">{p.format}</span>;
}

function Transport({ label, large = false, keyRef }: { label: string; large?: boolean; keyRef?: React.Ref<HTMLButtonElement> }) {
  const p = usePlayer();
  const playing = p.status === "playing";
  const problem = p.status === "problem" ? p.problem : null;
  const icon = large ? "size-6" : "size-5";
  return (
    <div className="flex items-center gap-1">
      <ShuffleButton />
      <button
        type="button"
        onClick={p.previous}
        aria-label="Previous track"
        className="cr-focus inline-flex size-11 items-center justify-center text-fg-muted hover:text-fg"
      >
        <SkipBack aria-hidden="true" className={icon} />
      </button>
      <button
        ref={keyRef}
        type="button"
        onClick={p.toggle}
        disabled={p.status === "loading"}
        aria-label={problem ? `Try ${label} again` : playing ? `Pause ${label}` : `Play ${label}`}
        className={cn("lr-key cr-cut cr-cut-sm cr-focus", large && "lr-key-large")}
      >
        {problem ? (
          <RotateCcw aria-hidden="true" className={icon} />
        ) : playing ? (
          <Pause aria-hidden="true" className={icon} />
        ) : (
          <Play aria-hidden="true" className={cn(icon, "translate-x-0.5")} />
        )}
      </button>
      <button
        type="button"
        onClick={p.next}
        disabled={!p.hasNext}
        aria-label="Next track"
        className="cr-focus inline-flex size-11 items-center justify-center text-fg-muted hover:text-fg disabled:opacity-35 disabled:hover:text-fg-muted"
      >
        <SkipForward aria-hidden="true" className={icon} />
      </button>
      <RepeatButton />
    </div>
  );
}

/** Library actions only make sense once the API has let this listener play the track. */
function Actions({ track }: { track: PlayerTrack }) {
  const p = usePlayer();
  if (p.status === "problem" && (p.problem?.kind === "signed_out" || p.problem?.kind === "needs_access")) return null;
  return <TrackActions trackId={track.id} title={titleOf(track)} />;
}

function Status() {
  const p = usePlayer();
  const problem = p.status === "problem" ? p.problem : null;
  return (
    <p className="lr-status" data-state={problem ? "problem" : p.needsGesture ? "gesture" : p.status}>
      {p.status === "playing" && !p.buffering ? (
        <span aria-hidden="true" className="lr-eq">
          <i />
          <i />
          <i />
        </span>
      ) : null}
      <span>{playerStatusText(p)}</span>
    </p>
  );
}

function ProblemActions({ track }: { track: PlayerTrack }) {
  const p = usePlayer();
  const problem = p.status === "problem" ? p.problem : null;
  if (!problem || (problem.kind !== "signed_out" && problem.kind !== "needs_access")) return null;
  return problem.kind === "signed_out" ? (
    <ButtonLink href={`/login?next=${encodeURIComponent(`/listen/${track.id}`)}`} size="sm">
      <LogIn aria-hidden="true" /> Sign in
    </ButtonLink>
  ) : (
    <ButtonLink href={`/tracks/${track.id}`} size="sm">
      <ShoppingBag aria-hidden="true" /> Get access
    </ButtonLink>
  );
}

/** The centred 3D carousel. Choosing a side card plays it; choosing the front card opens focus. */
function Carousel({ onFocus, frontRef }: { onFocus: () => void; frontRef: React.Ref<HTMLButtonElement> }) {
  const p = usePlayer();
  const touch = useRef<{ x: number; y: number } | null>(null);
  const items = carouselWindow(p.queue, p.index);
  return (
    <div
      className="lr-stage"
      role="group"
      aria-roledescription="carousel"
      aria-label="Tracks in this room"
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          p.previous();
        } else if (e.key === "ArrowRight" && p.hasNext) {
          e.preventDefault();
          p.next();
        }
      }}
      onPointerDown={(e) => {
        if (e.pointerType !== "mouse") touch.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerUp={(e) => {
        const start = touch.current;
        touch.current = null;
        if (!start) return;
        const dir = swipeDirection(e.clientX - start.x, e.clientY - start.y);
        if (dir === "next") p.next();
        else if (dir === "previous") p.previous();
      }}
      onPointerCancel={() => {
        touch.current = null;
      }}
    >
      {items.map(({ item, queueIndex, offset }) => {
        const shown = isVisibleOffset(offset);
        const title = titleOf(item);
        const front = offset === 0;
        return (
          <div key={queueIndex} data-offset={offset} aria-hidden={shown ? undefined : true} className="lr-slot">
            <button
              ref={front ? frontRef : undefined}
              type="button"
              tabIndex={shown ? undefined : -1}
              aria-label={front ? `Open ${title} in focus` : `Play ${title}${item.artist ? ` by ${item.artist}` : ""}`}
              aria-current={front ? "true" : undefined}
              onClick={() => (front ? onFocus() : void p.play(item))}
              className={cn("lr-card cr-cut cr-glass-card cr-focus", front && p.status === "loading" && "lr-card-loading")}
            >
              <span className="lr-cover">
                <Cover id={item.id} title={title} artist={item.artist || title} />
              </span>
              <span className="lr-caption">
                <span className="block truncate text-sm font-bold text-fg">{title}</span>
                <span className="block truncate text-xs text-fg-muted">{item.artist || "Artist not available"}</span>
              </span>
              <span aria-hidden="true" className="lr-dim" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** The bar under the carousel: transport, what is playing with its scrubber, volume and focus. */
function ControlBar({ track, onFocus }: { track: PlayerTrack; onFocus: () => void }) {
  const label = titleOf(track);
  return (
    <div className="lr-bar cr-cut cr-glass-card">
      <Transport label={label} />
      <div className="lr-now">
        <div className="lr-now-cube" aria-hidden="true">
          <CoverArt
            src={coverUrl({ track: track.id }, 160)}
            fallback={<RoomCube front={label} side={track.artist || label} tone="sky" size="front" label="" className="size-full" />}
            className="size-full"
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <p className="truncate text-sm font-bold text-fg">{label}</p>
            <span className="flex items-baseline gap-3">
              <Format />
              <Status />
            </span>
          </div>
          <Scrubber label={label} />
        </div>
      </div>
      <div className="lr-tools">
        <Actions track={track} />
        <Volume />
        <button
          type="button"
          onClick={onFocus}
          aria-label="Focus view"
          title="Focus view"
          className="cr-focus inline-flex size-10 items-center justify-center text-fg-muted hover:text-fg"
        >
          <Maximize2 aria-hidden="true" className="size-4" />
        </button>
      </div>
      <div className="lr-bar-actions empty:hidden">
        <ProblemActions track={track} />
      </div>
    </div>
  );
}

/** The cover of a neighbour that slides in from an edge in focus view (mouse only). */
function EdgePeek({ side, item, shown }: { side: "left" | "right"; item: PlayerTrack | undefined; shown: boolean }) {
  const p = usePlayer();
  if (!item) return null;
  const title = titleOf(item);
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-hidden="true"
      data-side={side}
      data-shown={shown ? "" : undefined}
      onClick={() => (side === "left" ? p.previous() : p.next())}
      className="lr-peek cr-cut cr-glass-card"
    >
      <span className="lr-cover">
        <Cover id={item.id} title={title} artist={item.artist || title} />
      </span>
      <span className="lr-caption">
        <span className="block text-[0.625rem] font-semibold uppercase tracking-[0.18em] text-highlight">{side === "left" ? "Previous" : "Next"}</span>
        <span className="block truncate text-sm font-bold text-fg">{title}</span>
      </span>
    </button>
  );
}

/** One song, large: the cover, its title in Sikat, the full console. */
function FocusView({ track, edge, keyRef }: { track: PlayerTrack; edge: "left" | "right" | null; keyRef: React.Ref<HTMLButtonElement> }) {
  const p = usePlayer();
  const touch = useRef<{ x: number; y: number } | null>(null);
  const label = titleOf(track);
  const position = queuePositionLabel(p.index, p.queue.length);
  return (
    <div
      className="lr-focus"
      onPointerDown={(e) => {
        if (e.pointerType !== "mouse") touch.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerUp={(e) => {
        const start = touch.current;
        touch.current = null;
        if (!start) return;
        const dir = swipeDirection(e.clientX - start.x, e.clientY - start.y);
        if (dir === "next") p.next();
        else if (dir === "previous") p.previous();
      }}
    >
      <div key={track.id} className="lr-focus-cover">
        <div className="lr-halo" aria-hidden="true" />
        <div className="lr-focus-art">
          <Cover id={track.id} title={label} artist={track.artist || label} />
        </div>
      </div>
      <div className="lr-focus-info">
        <p className="cr-eyebrow text-[0.6875rem] text-highlight">
          {[p.source ? `From ${p.source}` : "Listening room", position].filter(Boolean).join(" · ")}
        </p>
        <h1 key={track.id} id="room-title" className="lr-title cr-display mt-4 text-[2.5rem] leading-[0.92] text-fg md:text-[4rem]">
          {label}
        </h1>
        <p className="mt-3 text-lg text-fg-muted">{track.artist || "Artist not available"}</p>
        <div className="lr-focus-console cr-cut cr-glass-card">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <Status />
            <Format />
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <Transport label={label} large keyRef={keyRef} />
            <div className="flex items-center">
              <Actions track={track} />
              <Volume />
            </div>
          </div>
          <Scrubber label={label} wide />
          <div className="mt-3 flex flex-wrap gap-2 empty:hidden">
            <ProblemActions track={track} />
          </div>
        </div>
      </div>
      <EdgePeek side="left" item={p.queue[p.index - 1]} shown={edge === "left"} />
      <EdgePeek side="right" item={p.queue[p.index + 1]} shown={edge === "right"} />
    </div>
  );
}

/**
 * The room itself. Shows whatever the player holds; the page decides what to start. `fallback`
 * is drawn (inside the room's frame) before anything has been loaded into the player.
 */
export function ListeningRoom({ fallback }: { fallback?: React.ReactNode }) {
  const p = usePlayer();
  const router = useRouter();
  const track = fallback ? null : p.track;
  const [mode, setMode] = useState<Mode>("carousel");
  const [edge, setEdge] = useState<"left" | "right" | null>(null);
  const [announce, setAnnounce] = useState("");
  const announced = useRef<string | null>(null);
  const frontCard = useRef<HTMLButtonElement>(null);
  const focusKey = useRef<HTMLButtonElement>(null);
  const moved = useRef(false);

  useEffect(() => {
    if (!track || track.id === announced.current || !track.title) return;
    // The first track is already the heading; announce changes after it.
    if (announced.current !== null) setAnnounce(nowPlayingAnnouncement(track.title, track.artist));
    announced.current = track.id;
  }, [track]);

  // Keyboard focus follows the view: into the focus console on entry, back to the front card on exit.
  useEffect(() => {
    if (!moved.current) return;
    (mode === "focus" ? focusKey.current : frontCard.current)?.focus({ preventScroll: true });
  }, [mode]);
  const enterFocus = useCallback(() => {
    moved.current = true;
    setMode("focus");
  }, []);
  const exitFocus = useCallback(() => {
    moved.current = true;
    setEdge(null);
    setMode("carousel");
  }, []);

  useEffect(() => {
    if (mode !== "focus") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") exitFocus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, exitFocus]);

  const leave = () => {
    if (leaveTarget(roomCameFrom()) === "back") router.back();
    else router.push("/listen");
  };

  const position = queuePositionLabel(p.index, p.queue.length);
  return (
    <section
      aria-labelledby="room-title"
      className="lr"
      data-mode={track ? mode : "carousel"}
      data-playing={track && p.status === "playing" ? "" : undefined}
      onPointerMove={(e) => {
        if (mode !== "focus" || e.pointerType !== "mouse") return;
        const zone = edgeZone(e.clientX, e.currentTarget.clientWidth);
        if (zone !== edge) setEdge(zone);
      }}
      onPointerLeave={() => edge && setEdge(null)}
    >
      <Backdrop track={track} />
      <PointerLightLayer />
      <header className="lr-top">
        <div className="flex items-center gap-3">
          <Logo variant="indigo" height={36} alt="Corner Room" />
          <span className="cr-eyebrow hidden text-[0.6875rem] text-fg-muted sm:inline">Listening room</span>
        </div>
        <div className="flex items-center gap-2">
          {track && mode === "focus" ? (
            <button type="button" onClick={exitFocus} className="lr-chip cr-cut cr-cut-sm cr-focus">
              <ArrowLeft aria-hidden="true" className="size-4" /> All tracks
            </button>
          ) : null}
          <button type="button" onClick={leave} aria-label="Leave the listening room" className="lr-chip lr-chip-icon cr-cut cr-cut-sm cr-focus">
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>
      </header>

      {track ? (
        mode === "focus" ? (
          <FocusView track={track} edge={edge} keyRef={focusKey} />
        ) : (
          <div className="lr-carousel-view">
            <Carousel onFocus={enterFocus} frontRef={frontCard} />
            <div className="lr-heading">
              <p className="cr-eyebrow text-[0.6875rem] text-highlight">
                {[p.source ? `From ${p.source}` : "Listening room", position].filter(Boolean).join(" · ")}
              </p>
              <h1 key={track.id} id="room-title" className="lr-title cr-display mt-3 text-[2.25rem] leading-[0.95] text-fg md:text-[3rem]">
                {titleOf(track)}
              </h1>
              <p className="mt-1.5 text-base text-fg-muted">{track.artist || "Artist not available"}</p>
            </div>
            <ControlBar track={track} onFocus={enterFocus} />
            <Link href={`/tracks/${track.id}`} className="cr-focus mt-4 inline-block text-sm font-semibold text-link hover:underline">
              Track page
            </Link>
          </div>
        )
      ) : (
        <div className="lr-fallback">{fallback ?? null}</div>
      )}

      <p role="status" aria-live="polite" className="sr-only">
        {announce}
      </p>
    </section>
  );
}
