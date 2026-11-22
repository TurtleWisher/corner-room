"use client";

import { createContext, memo, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  AudioLines,
  LogIn,
  Maximize2,
  MicVocal,
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
import { BetaTag } from "@/components/brand/beta-tag";
import { Logo } from "@/components/brand/logo";
import { PointerLightLayer } from "@/components/brand/pointer-light";
import { RoomCube } from "@/components/brand/room-cube";
import { ButtonLink } from "@/components/ds";
import { roomCameFrom } from "@/components/music/outside-room";
import { playerStatusText, RepeatButton, ShuffleButton, usePlayer, usePlayerProgress, type PlayerTrack } from "@/components/music/player";
import { TrackActions } from "@/components/music/track-actions";
import { useAsync } from "@/components/use-async";
import {
  carouselWindow,
  edgeZone,
  isVisibleOffset,
  leaveTarget,
  nowPlayingAnnouncement,
  pointerDrive,
  SPIN_RETURN_MS,
  queuePositionLabel,
  roomEyebrow,
  slotPose,
  spinTarget,
  springStep,
  swipeDirection,
  titleAtoms,
} from "@/lib/listening-room-view";
import { fetchPlayableCatalog, fetchTrack, type PlayableTrackRecord } from "@/lib/api";
import { coverSrcSet, coverUrl } from "@/lib/cover-view";
import {
  floatingLines,
  lyricAgeAt,
  lyricEnds,
  lyricIndexAt,
  lyricLines,
  lyricTimes,
  lyricVoice,
  ringPose,
  type RingAxis,
  type RingPlane,
} from "@/lib/lyrics-view";
import { creditHref } from "@/lib/music-view";
import { LYRICS_PREF, lyricsChoice, lyricsOnFrom, lyricsSwitch } from "@/lib/room-controls-view";
import { useRoomFullscreen } from "@/components/music/room-fullscreen";
import { RoomLyricsSwitch } from "@/components/music/room-lyrics-switch";
import { RoomGiftButton } from "@/components/music/room-gift-button";
import { StoryShareButton } from "@/components/music/story-share";
import { clock, durationLabel } from "@/lib/player-model";
import { titleFit, titleParts, titleWithVersion } from "@/lib/track-title-view";
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

// How wide the room draws a cover (from `--card` and `--orbit` in listen.css), so the browser
// takes the 1200 px copy whenever the 480 px one would be stretched.
const CARD_SIZES = "(min-width: 1024px) 21rem, (min-width: 768px) 19rem, 64vw";
const FOCUS_SIZES = "(min-width: 1024px) 36rem, 78vw";

// The official cover when the song has one (OD-05), the cube otherwise.
const Cover = memo(function Cover({ id, title, artist, sizes = CARD_SIZES }: { id: string; title: string; artist: string; sizes?: string }) {
  return (
    <CoverArt
      src={coverUrl({ track: id }, 480)}
      srcSet={coverSrcSet({ track: id })}
      sizes={sizes}
      fallback={<Cube title={title} artist={artist} />}
      className="size-full"
    />
  );
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
        className="cr-focus cr-pctl inline-flex size-10 items-center justify-center"
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
      className="cr-focus cr-pctl inline-flex size-10 items-center justify-center"
    >
      <AudioLines aria-hidden="true" className="size-4" />
    </button>
  );
}

/**
 * The artist or band of the playing song, linked to their page (owner, 2026-10-27). The link comes
 * from the public catalog; until it loads, or when it is unknown, the name is plain text.
 */
let publicCatalog: Promise<Map<string, PlayableTrackRecord>> | null = null;

/** The public catalog, once per page view, only to link names (no sign-in needed). */
function loadPublicCatalog(): Promise<Map<string, PlayableTrackRecord>> {
  if (!publicCatalog) {
    publicCatalog = fetchPlayableCatalog({ skipAuth: true })
      .then((page) => new Map(page.items.map((t) => [t.id, t])))
      .catch(() => new Map());
  }
  return publicCatalog;
}

function ArtistLink({ track }: { track: PlayerTrack }) {
  const catalog = useAsync(loadPublicCatalog, []);
  const href = creditHref((catalog.status === "ok" ? catalog.data.get(track.id) : undefined) ?? {});
  const name = track.artist || "Artist not available";
  if (!href || !track.artist) return <>{name}</>;
  return (
    <Link href={href} className="cr-focus hover:text-highlight hover:underline">
      {name}
    </Link>
  );
}

/**
 * The playing title is the way to the song page (owner, 2026-11-01, D-ROOM-03; it replaces the
 * "Track page" link under the bar). Pointing at it or focusing it breaks it into charged pieces
 * that scatter a little and settle back, then hum while the pointer stays (app/styles/modules/
 * listen.css). The pieces are decoration: the link's name is the whole title.
 */
export function RoomTitle({ track, className, version: given }: { track: PlayerTrack; className: string; version?: string | null }) {
  // The song's version after the title (D-VERSION-01), from the same cached read as the lyrics
  // (`version` given directly only on the developer board).
  const loaded = useAsync(() => (given === undefined ? loadLyrics(track.id).then((l) => l.version) : Promise.resolve(given)), [track.id, given]);
  const version = given === undefined ? (loaded.data ?? null) : given;
  const parts = titleParts(titleOf(track), version);
  const label = titleWithVersion(parts.title, parts.version);
  const atoms = useMemo(() => titleAtoms(parts.title), [parts.title]);
  const fit = useOneLineFit(label);
  return (
    <h1 ref={fit.box} id="room-title" className={`lr-title cr-display text-fg ${className}`} style={{ "--lr-fit": fit.scale } as React.CSSProperties}>
      <Link href={`/tracks/${track.id}`} className="lr-title-link cr-focus" aria-label={label}>
        <span ref={fit.line} aria-hidden="true" className="lr-title-line">
          {atoms.map((atom, i) =>
            atom.space ? (
              " "
            ) : (
              <span
                key={i}
                className="lr-atom"
                style={{ "--dx": `${atom.dx}em`, "--dy": `${atom.dy}em`, "--turn": `${atom.turn}deg`, "--delay": `${atom.delayMs}ms` } as React.CSSProperties}
              >
                {atom.text}
              </span>
            ),
          )}
          {parts.version ? <span className="lr-title-version">({parts.version})</span> : null}
        </span>
      </Link>
    </h1>
  );
}

/**
 * The room title on one line at any length (owner, 2026-11-14): the line never wraps, and shrinks
 * just enough to fit its box. Every size inside is in em, so the line's width scales with --lr-fit;
 * the width at full size is read once per change and the scale follows the box as it resizes.
 */
function useOneLineFit(text: string) {
  const box = useRef<HTMLHeadingElement>(null);
  const line = useRef<HTMLSpanElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const b = box.current;
    const l = line.current;
    if (!b || !l) return;
    const measure = () => {
      // The scale on screen now, read from the sizes themselves, so a measure that runs before
      // React has drawn the last scale is still right.
      const full = parseFloat(getComputedStyle(b).fontSize);
      const shown = parseFloat(getComputedStyle(l).fontSize);
      if (!(full > 0) || !(shown > 0)) return;
      const natural = l.getBoundingClientRect().width * (full / shown);
      const next = titleFit(b.clientWidth, natural);
      setScale((prev) => (Math.abs(next - prev) > 0.002 ? next : prev));
    };
    measure();
    // The box resizes with the window; the line changes width when the display face arrives.
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    ro?.observe(b);
    ro?.observe(l);
    void document.fonts?.ready.then(measure);
    return () => ro?.disconnect();
  }, [text]);
  return { box, line, scale };
}

/**
 * Floating lyrics (owner, 2026-10-27, D-LYRICS-01): on by default since 2026-11-06 (D-ROOM-05),
 * with a switch under the close button and the small button by the volume. Lines float in 3D around the playing cover (owner, 2026-11-01).
 * When staff have timed the song (D-LYRICS-03) each line arrives as it is sung; otherwise the
 * lines are paced across the song, an estimate. Decorative here: the song page has the full
 * lyrics for reading and screen readers.
 */
type RoomLyrics = {
  trackId: string | null;
  loaded: boolean;
  lines: string[];
  times: number[] | null;
  /** D-LYRICS-05: when each timed line's singing ends (seconds), else null. */
  ends: number[] | null;
  on: boolean;
  toggle: () => void;
};
const LyricsContext = createContext<RoomLyrics>({ trackId: null, loaded: false, lines: [], times: null, ends: null, on: false, toggle: () => {} });
type LoadedLyrics = { text: string | null; timingsMs: number[] | null; endsMs: number[] | null; version: string | null };
const lyricsCache = new Map<string, Promise<LoadedLyrics>>();

/** A released song's lyrics and version, once per song per page view (public read, no sign-in needed). */
function loadLyrics(trackId: string): Promise<LoadedLyrics> {
  let hit = lyricsCache.get(trackId);
  if (!hit) {
    hit = fetchTrack(trackId, { skipAuth: true })
      .then((t) => ({
        text: t.lyrics ?? null,
        timingsMs: t.lyrics_timings_ms ?? null,
        endsMs: t.lyrics_line_ends_ms ?? null,
        version: t.version_title ?? null,
      }))
      .catch(() => ({ text: null, timingsMs: null, endsMs: null, version: null }));
    lyricsCache.set(trackId, hit);
  }
  return hit;
}

function useRoomLyrics(trackId: string | null): RoomLyrics {
  // On by default (owner, 2026-11-06, D-ROOM-05): listeners could not find them behind the small
  // button. A listener who turns them off is remembered in this browser.
  const [on, setOn] = useState(true);
  useEffect(() => {
    try {
      setOn(lyricsOnFrom(window.localStorage.getItem(LYRICS_PREF)));
    } catch {
      // Storage blocked: a first visit, so lyrics stay on.
    }
  }, []);
  const toggle = useCallback(() => {
    setOn((was) => {
      try {
        window.localStorage.setItem(LYRICS_PREF, lyricsChoice(!was));
      } catch {
        // Remembering is a convenience only.
      }
      return !was;
    });
  }, []);
  const loaded = useAsync(async () => (trackId ? { trackId, ...(await loadLyrics(trackId)) } : null), [trackId]);
  // Never show the previous song's lines while the next song's are loading.
  const mine = loaded.status === "ok" && loaded.data?.trackId === trackId ? loaded.data : null;
  const text = mine?.text ?? null;
  const timingsMs = mine?.timingsMs ?? null;
  const lines = useMemo(() => lyricLines(text), [text]);
  const times = useMemo(() => lyricTimes(lines.length, timingsMs), [lines, timingsMs]);
  const endsMs = mine?.endsMs ?? null;
  const ends = useMemo(() => lyricEnds(times, endsMs), [times, endsMs]);
  return { trackId, loaded: mine !== null, lines, times, ends, on, toggle };
}

/** The lyrics toggle beside the close button, on the room's one lyrics state. */
function TopLyricsSwitch() {
  const lyrics = useContext(LyricsContext);
  return <RoomLyricsSwitch state={lyricsSwitch({ loaded: lyrics.loaded, lineCount: lyrics.lines.length, on: lyrics.on })} onToggle={lyrics.toggle} />;
}

function LyricsToggle() {
  const lyrics = useContext(LyricsContext);
  if (lyrics.lines.length === 0) return null;
  return (
    <button
      type="button"
      onClick={lyrics.toggle}
      aria-pressed={lyrics.on}
      aria-label="Lyrics"
      title={lyrics.on ? "Hide lyrics" : "Show lyrics"}
      className="cr-focus cr-pctl inline-flex size-10 items-center justify-center"
    >
      <MicVocal aria-hidden="true" className="size-4" />
    </button>
  );
}

/** Phones stack the lines above and over the cover; wider rooms float them beside it. */
const COMPACT_ROOM = "(max-width: 767px)";

// Where media queries are not available, the room keeps its wide layout.
function compactQuery(): MediaQueryList | null {
  return typeof window.matchMedia === "function" ? window.matchMedia(COMPACT_ROOM) : null;
}

function subscribeCompact(change: () => void): () => void {
  const query = compactQuery();
  query?.addEventListener("change", change);
  return () => query?.removeEventListener("change", change);
}

function useCompactRoom(): boolean {
  return useSyncExternalStore(
    subscribeCompact,
    () => compactQuery()?.matches ?? false,
    () => false,
  );
}

/** A line's place as drawn, eased towards where the ring says it should be. */
type LineState = { x: number; y: number; z: number; o: number; plane: RingPlane | ""; w: number; h: number; held: number | null };

/** How quickly a drawn line catches up with its place, per frame at 60 a second. */
const CATCH_UP = 0.09;
/** How long a tapped line stays held and lit on touch screens. */
const TAP_HOLD_MS = 2600;

/**
 * The lyric ring (owner, 2026-11-01, D-LYRICS-02; lib/lyrics-view.ts `ringPose`). Real text, drawn
 * inside the cover's own 3D space (the floating front card, or the focus cover), so the browser
 * keeps every line in true depth order with the cards: behind the cover a line is hidden by the
 * art, in front it passes over it, and it moves with the card as the card floats.
 *
 * Layer contract: the cover sits at depth 0; a line is in front when its z is above 0 and behind
 * when below. Nothing here uses z-index; the shared 3D space (preserve-3d on the stage, the front
 * slot, the float wrapper and this ring) is the only thing that orders them.
 *
 * Motion: React renders only when the line on show changes. One animation frame loop moves the
 * (at most four) lines with transform and opacity, timing them between the player's progress
 * reports; it stops when playback pauses and the lines have settled, and the browser stops it in
 * a hidden tab. Pointing at a line lights it and leans it towards the pointer while the ring keeps
 * turning (owner, 2026-11-21: the ring never stops under the mouse); tapping one on a touch screen
 * holds it in place for a moment so it can be read.
 */
function LyricOrbit({ axis }: { axis: RingAxis | "auto" }) {
  const lyrics = useContext(LyricsContext);
  const p = usePlayer();
  const compact = useCompactRoom();
  const count = lyrics.lines.length;
  const times = lyrics.times;
  const ends = lyrics.ends;
  const index = useSyncExternalStore(
    p.progress.subscribe,
    () => lyricIndexAt(count, p.progress.get().position, p.progress.get().duration, times),
    () => -1,
  );
  const shape: RingAxis = axis === "auto" ? (compact ? "over" : "around") : axis;
  const playing = p.status === "playing";
  const show = lyrics.on && count > 0;
  const root = useRef<HTMLDivElement>(null);
  const lines = useRef(new Map<string, LineState>());

  useEffect(() => {
    const orbit = root.current;
    if (!show || !orbit) return;
    const states = lines.current;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    // The cover the ring goes round: the card (carousel) or the art (focus), just before the ring.
    const cover = orbit.previousElementSibling as HTMLElement | null;
    let coverW = cover?.offsetWidth || 300;
    let coverH = cover?.offsetHeight || coverW;
    let frame = 0;
    let last = 0;
    // Playback time between the player's reports (a few a second), so the motion is continuous.
    let base = p.progress.get();
    let baseAt = performance.now();

    const tick = () => {
      // The page clock, the same one the progress timestamps use.
      const now = performance.now();
      frame = 0;
      const dt = last ? Math.min(3, (now - last) / (1000 / 60)) : 1;
      last = now;
      const t = playing ? base.position + Math.min(0.75, (now - baseAt) / 1000) : base.position;
      const ease = 1 - Math.pow(1 - CATCH_UP, dt);
      const seen = new Set<string>();
      let moving = false;
      for (const el of Array.from(orbit.children) as HTMLElement[]) {
        const id = el.dataset.line ?? "";
        const key = Number(el.dataset.index);
        seen.add(id);
        const age = lyricAgeAt(key, count, t, base.duration, times);
        if (!Number.isFinite(age)) continue;
        let st = states.get(id);
        const fresh = !st;
        if (!st) {
          st = { x: 0, y: 0, z: 0, o: 0, plane: "", w: 0, h: 0, held: null };
          states.set(id, st);
        }
        // Sizes are read once per line (and again after a resize), never every frame.
        if (!st.w) {
          st.w = el.offsetWidth;
          st.h = el.offsetHeight;
        }
        // Reduced motion: only the line now, still, where it is sung.
        const at = reduced ? 0.5 : (st.held ?? age);
        const pose = ringPose(key, at, shape, { cover: coverW, coverHeight: coverH, lineWidth: st.w, lineHeight: st.h });
        // D-LYRICS-05: once its singing ends, a line goes quiet until the next one comes in.
        const voice = lyricVoice(times, ends, key, t);
        const opacity = (reduced ? (key === index ? 1 : 0) : pose.opacity) * voice;
        const k = fresh || reduced ? 1 : ease;
        st.x += (pose.x - st.x) * k;
        st.y += (pose.y - st.y) * k;
        st.z += (pose.z - st.z) * k;
        st.o += (opacity - st.o) * k;
        if (Math.abs(pose.x - st.x) + Math.abs(pose.y - st.y) + Math.abs(pose.z - st.z) > 0.5 || Math.abs(opacity - st.o) > 0.01) {
          moving = true;
        }
        el.style.transform = `translate3d(${st.x.toFixed(1)}px, ${st.y.toFixed(1)}px, ${st.z.toFixed(1)}px) translate(-50%, -50%)`;
        el.style.opacity = st.o.toFixed(3);
        if (st.plane !== pose.plane) {
          st.plane = pose.plane;
          el.dataset.plane = pose.plane;
        }
      }
      for (const id of states.keys()) if (!seen.has(id)) states.delete(id);
      if (!reduced && (playing || moving)) frame = window.requestAnimationFrame(tick);
    };
    const start = () => {
      if (!frame) frame = window.requestAnimationFrame(tick);
    };

    const unsubscribe = p.progress.subscribe(() => {
      base = p.progress.get();
      baseAt = performance.now();
      start();
    });
    const resize =
      typeof ResizeObserver === "function" && cover
        ? new ResizeObserver(() => {
            coverW = cover.offsetWidth || coverW;
            coverH = cover.offsetHeight || coverH;
            for (const st of states.values()) st.w = 0;
            start();
          })
        : null;
    if (cover) resize?.observe(cover);
    start();
    return () => {
      window.cancelAnimationFrame(frame);
      unsubscribe();
      resize?.disconnect();
    };
  }, [show, index, playing, shape, count, times, ends, lyrics.trackId, p.progress]);

  if (!show) return null;

  const hold = (el: HTMLElement) => {
    const st = lines.current.get(el.dataset.line ?? "");
    const { position, duration } = p.progress.get();
    if (st && st.held === null) st.held = lyricAgeAt(Number(el.dataset.index), count, position, duration, times);
    el.dataset.focus = "";
  };
  // Mouse: lit only, the line rides on round the ring.
  const light = (el: HTMLElement) => {
    el.dataset.focus = "";
  };
  const release = (el: HTMLElement) => {
    const st = lines.current.get(el.dataset.line ?? "");
    if (st) st.held = null;
    delete el.dataset.focus;
    el.style.removeProperty("--lx");
    el.style.removeProperty("--ly");
  };

  return (
    <div ref={root} aria-hidden="true" className="lr-orbit" data-axis={shape}>
      {floatingLines(lyrics.lines, index).map((line) => {
        const id = `${lyrics.trackId}-${line.key}`;
        return (
          <div
            key={id}
            data-line={id}
            data-index={line.key}
            className="lr-lyric"
            style={{ opacity: 0 }}
            onPointerEnter={(e) => {
              if (e.pointerType === "mouse") light(e.currentTarget);
            }}
            onPointerLeave={(e) => {
              if (e.pointerType === "mouse") release(e.currentTarget);
            }}
            onPointerMove={(e) => {
              if (e.pointerType !== "mouse") return;
              // The light on the words follows the pointer, and the line leans a little towards it.
              const box = e.currentTarget.getBoundingClientRect();
              const fx = (e.clientX - box.left) / box.width;
              const fy = (e.clientY - box.top) / box.height;
              e.currentTarget.style.setProperty("--mx", `${(fx * 100).toFixed(1)}%`);
              e.currentTarget.style.setProperty("--my", `${(fy * 100).toFixed(1)}%`);
              e.currentTarget.style.setProperty("--lx", (fx * 2 - 1).toFixed(3));
              e.currentTarget.style.setProperty("--ly", (fy * 2 - 1).toFixed(3));
            }}
            onPointerDown={(e) => {
              if (e.pointerType === "mouse") return;
              // Touch: a tap holds and lights the line for a moment.
              const el = e.currentTarget;
              hold(el);
              window.setTimeout(() => release(el), TAP_HOLD_MS);
            }}
          >
            <span className="lr-lyric-text">{line.text}</span>
          </div>
        );
      })}
    </div>
  );
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
        className="cr-focus cr-pctl inline-flex size-11 items-center justify-center"
      >
        <SkipBack aria-hidden="true" className={icon} />
      </button>
      <button
        ref={keyRef}
        type="button"
        onClick={p.toggle}
        disabled={p.status === "loading"}
        aria-label={problem ? `Try ${label} again` : playing ? `Pause ${label}` : `Play ${label}`}
        data-playing={playing ? "" : undefined}
        data-ready={p.needsGesture && !problem ? "" : undefined}
        className={cn("lr-key cr-cut cr-cut-sm cr-pkey cr-focus", large && "lr-key-large")}
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
        className="cr-focus cr-pctl inline-flex size-11 items-center justify-center"
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
  return (
    <>
      <TrackActions trackId={track.id} title={titleOf(track)} />
      {/* D-STORY-01: owners share a moment as a story card; shown only when the server says yes. */}
      <StoryShareButton track={track} />
    </>
  );
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

/** Whether the browser asks for less motion (false where it can't tell, as in tests). */
function reducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * The centred 3D carousel. The playing song's card opens focus; any other card plays it.
 * It spins through its cards toward the mouse (owner, 2026-11-22): with the mouse beside the front
 * card it keeps turning that way, each next card gliding to the front, up to the last one, faster
 * further out; back over the front card it settles on the nearest card, which a click plays. The
 * song never changes on its own while browsing, and a while after the mouse leaves the carousel
 * glides back to the playing song. A song change glides the ring on from wherever it is. Everything
 * moves on one spring: one rAF loop runs only while it moves and writes each card's place as CSS
 * variables (`slotPose`, `pointerDrive`, `spinTarget`, `springStep`); React renders only when the
 * card nearest the front changes. Touch swipes change the song; reduced motion: no spin.
 */
function Carousel({ onFocus, frontRef }: { onFocus: () => void; frontRef: React.Ref<HTMLButtonElement> }) {
  const p = usePlayer();
  const touch = useRef<{ x: number; y: number } | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const spin = useRef({
    pos: { x: p.index, v: 0 },
    target: p.index,
    base: p.index,
    drive: 0,
    frame: 0,
    last: 0,
    back: undefined as ReturnType<typeof setTimeout> | undefined,
    // After the song changes, the mouse must move before it spins again (a click on a side card
    // would otherwise carry on spinning past the song just chosen).
    still: null as number | null,
    mouseX: null as number | null,
  });
  const lastIndex = Math.max(0, p.queue.length - 1);
  const lastIndexRef = useRef(lastIndex);
  lastIndexRef.current = lastIndex;
  const [center, setCenter] = useState(p.index);
  const centerRef = useRef(center);
  const items = carouselWindow(p.queue, Math.max(0, Math.min(center, lastIndex)));

  const draw = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const wide = typeof window.matchMedia === "function" ? window.matchMedia("(min-width: 768px)").matches : true;
    const at = spin.current.pos.x;
    for (const slot of stage.querySelectorAll<HTMLElement>(".lr-slot")) {
      const pose = slotPose(Number(slot.dataset.queue) - at, wide);
      slot.style.setProperty("--tx", String(pose.tx));
      slot.style.setProperty("--tz", `${pose.tz}px`);
      slot.style.setProperty("--ry", `${pose.ry}deg`);
      slot.style.setProperty("--s", String(pose.s));
      slot.style.setProperty("--o", String(pose.o));
      slot.style.setProperty("--dim", String(pose.dim));
      slot.style.visibility = pose.o < 0.01 ? "hidden" : "visible";
    }
  }, []);

  /** Re-render only when the card nearest the front changes, so the right cards are drawn. */
  const follow = useCallback(() => {
    const c = Math.round(spin.current.pos.x);
    if (c !== centerRef.current) {
      centerRef.current = c;
      setCenter(c);
    }
  }, []);

  const run = useCallback(() => {
    const s = spin.current;
    if (reducedMotion()) {
      window.cancelAnimationFrame(s.frame);
      s.frame = 0;
      s.pos = { x: Math.round(s.target), v: 0 };
      draw();
      follow();
      return;
    }
    if (s.frame) return;
    s.last = 0;
    const tick = (now: number) => {
      const dt = s.last ? (now - s.last) / 1000 : 1 / 60;
      s.last = now;
      const end = lastIndexRef.current;
      if (s.drive) s.target = spinTarget(s.target, s.drive, dt, end);
      const next = springStep(s.pos, s.target, dt);
      s.pos = { x: next.x, v: next.v };
      draw();
      follow();
      const turning = (s.drive > 0 && s.target < end) || (s.drive < 0 && s.target > 0);
      s.frame = next.rest && !turning ? 0 : window.requestAnimationFrame(tick);
    };
    s.frame = window.requestAnimationFrame(tick);
  }, [draw, follow]);

  const setDrive = useCallback(
    (drive: number) => {
      const s = spin.current;
      if (drive === s.drive) return;
      // Stopping settles on the nearest card, so it rests square to the front.
      if (!drive) s.target = Math.max(0, Math.min(lastIndexRef.current, Math.round(s.target)));
      s.drive = drive;
      run();
    },
    [run],
  );

  // A new song: everything heads for it, gliding on from wherever the ring is (a far jump starts a
  // card and a half away so the cards in between are not all drawn).
  useLayoutEffect(() => {
    const s = spin.current;
    const gap = p.index - s.pos.x;
    if (Math.abs(gap) > 2) s.pos = { x: p.index - Math.sign(gap) * 1.5, v: 0 };
    s.base = p.index;
    s.target = p.index;
    s.drive = 0;
    s.still = s.mouseX;
    follow();
    run();
  }, [p.index, run, follow]);
  // Every render (new cards come in): draw them in place at once.
  useLayoutEffect(() => draw());
  useEffect(() => {
    const s = spin.current;
    return () => {
      window.cancelAnimationFrame(s.frame);
      clearTimeout(s.back);
    };
  }, []);

  return (
    <div
      ref={stageRef}
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
      onPointerMove={(e) => {
        if (e.pointerType !== "mouse" || reducedMotion()) return;
        const s = spin.current;
        clearTimeout(s.back);
        s.mouseX = e.clientX;
        if (s.still !== null) {
          if (Math.abs(e.clientX - s.still) < 24) return;
          s.still = null;
        }
        const stage = e.currentTarget;
        const box = stage.getBoundingClientRect();
        const card = stage.querySelector<HTMLElement>(".lr-slot")?.offsetWidth ?? 0;
        setDrive(pointerDrive(e.clientX, box.left + box.width / 2, card));
      }}
      onPointerLeave={(e) => {
        if (e.pointerType !== "mouse") return;
        const s = spin.current;
        s.mouseX = null;
        s.still = null;
        setDrive(0);
        clearTimeout(s.back);
        s.back = setTimeout(() => {
          s.target = s.base;
          run();
        }, SPIN_RETURN_MS);
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
        const now = queueIndex === p.index;
        return (
          <div
            key={queueIndex}
            data-offset={offset}
            data-queue={queueIndex}
            data-now={now ? "" : undefined}
            aria-hidden={shown ? undefined : true}
            className="lr-slot"
          >
            {/* The card floats while music plays; the lyric ring floats with it. */}
            <div className="lr-bob">
              <button
                ref={now ? frontRef : undefined}
                type="button"
                tabIndex={shown ? undefined : -1}
                aria-label={now ? `Open ${title} in focus` : `Play ${title}${item.artist ? ` by ${item.artist}` : ""}`}
                aria-current={now ? "true" : undefined}
                onClick={() => (now ? onFocus() : void p.play(item))}
                className={cn("lr-card cr-cut cr-glass-card cr-focus", now && p.status === "loading" && "lr-card-loading")}
              >
                <span className={cn("lr-cover", now && "[view-transition-name:cr-now-cover]")}>
                  <Cover id={item.id} title={title} artist={item.artist || title} />
                </span>
                <span className="lr-caption">
                  <span className="block truncate text-sm font-bold text-fg">{title}</span>
                  <span className="block truncate text-xs text-fg-muted">{item.artist || "Artist not available"}</span>
                </span>
                <span aria-hidden="true" className="lr-dim" />
              </button>
              {now ? <LyricOrbit axis="auto" /> : null}
            </div>
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
          {/* The status drops under the title rather than spilling out of the box when space is short. */}
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <p className="min-w-0 flex-[1_1_6rem] truncate text-sm font-bold text-fg">{label}</p>
            <span className="flex items-baseline gap-3">
              <Status />
            </span>
          </div>
          <Scrubber label={label} />
        </div>
      </div>
      <div className="lr-tools">
        <Actions track={track} />
        <LyricsToggle />
        <Volume />
        <button
          type="button"
          onClick={onFocus}
          aria-label="Focus view"
          title="Focus view"
          className="cr-focus cr-pctl inline-flex size-10 items-center justify-center"
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
          <Cover id={track.id} title={label} artist={track.artist || label} sizes={FOCUS_SIZES} />
        </div>
        <LyricOrbit axis="over" />
      </div>
      <div className="lr-focus-info">
        <p className="cr-eyebrow text-[0.6875rem] text-highlight">
          {roomEyebrow(p.source, titleOf(track), position, p.queue.length)}
        </p>
        <RoomTitle key={track.id} track={track} className="mt-4 text-[2.5rem] leading-[0.92] md:text-[4rem]" />
        <p className="mt-3 text-lg text-fg-muted">
          <ArtistLink track={track} />
        </p>
        <div className="lr-focus-console cr-cut cr-glass-card">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <Status />
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <Transport label={label} large keyRef={keyRef} />
            <div className="flex items-center">
              <Actions track={track} />
              <LyricsToggle />
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
  const lyrics = useRoomLyrics(track?.id ?? null);
  const fullscreen = useRoomFullscreen();

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
      onDoubleClick={fullscreen.onDoubleClick}
    >
      <Backdrop track={track} />
      <PointerLightLayer />
      <LyricsContext.Provider value={lyrics}>
        <header className="lr-top">
          <div className="flex items-center gap-3">
            <div className="flex items-end gap-2">
              <Logo variant="indigo" height={36} alt="Corner Room" />
              <BetaTag className="pb-0.5" />
            </div>
            <span className="cr-eyebrow hidden text-[0.6875rem] text-fg-muted sm:inline">Listening room</span>
          </div>
          <div className="lr-top-end">
            {/* One row (owner, 2026-11-21): Give as a gift, the lyrics toggle, then the ways out. */}
            {track ? <RoomGiftButton trackId={track.id} title={track.title} /> : null}
            {track ? <TopLyricsSwitch /> : null}
            <div className="flex items-center gap-2">
              {track && mode === "focus" ? (
                <button type="button" onClick={exitFocus} className="lr-chip cr-cut cr-cut-sm cr-focus">
                  <ArrowLeft aria-hidden="true" className="size-4" /> All tracks
                </button>
              ) : null}
              <button
                type="button"
                onClick={leave}
                aria-label="Leave the listening room"
                data-room-leave=""
                className="lr-chip lr-chip-icon cr-cut cr-cut-sm cr-focus"
              >
                <X aria-hidden="true" className="size-4" />
              </button>
            </div>
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
                  {roomEyebrow(p.source, titleOf(track), position, p.queue.length)}
                </p>
                <RoomTitle key={track.id} track={track} className="mt-3 text-[2.25rem] leading-[0.95] md:text-[3rem]" />
                <p className="mt-1.5 text-base text-fg-muted">
                  <ArtistLink track={track} />
                </p>
              </div>
              <ControlBar track={track} onFocus={enterFocus} />
            </div>
          )
        ) : (
          <div className="lr-fallback">{fallback ?? null}</div>
        )}
      </LyricsContext.Provider>

      <p role="status" aria-live="polite" className="sr-only">
        {announce}
      </p>
    </section>
  );
}
