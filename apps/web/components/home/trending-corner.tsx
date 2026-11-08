"use client";

import Link from "next/link";
import * as React from "react";
import { ChevronLeft, ChevronRight, Lock, LogIn, Pause, Play } from "lucide-react";

import { useAuth } from "@/components/auth-provider";
import { CoverArt } from "@/components/brand/cover-art";
import { RoomCube } from "@/components/brand/room-cube";
import { Money } from "@/components/ds";
import { useCustomerCommerce } from "@/components/music/commerce";
import { useCredits } from "@/components/music/credits";
import { useOptionalPlayer, usePlayerProgress, type PlayerTrack } from "@/components/music/player";
import type { TrendingItem } from "@/features/trending/api";
import { coverUrl } from "@/lib/cover-view";
import { formatCount } from "@/lib/format/count";
import { creditName } from "@/lib/music-view";
import { clock } from "@/lib/player-model";
import { teaserKey } from "@/lib/teaser-room-view";
import {
  AUTO_TURN_MS,
  DRAG_THRESHOLD_PX,
  discPose,
  easeInOutCubic,
  easeOutQuint,
  frontIndex,
  itemDurationMs,
  itemHref,
  kindLabel,
  landingFor,
  mod,
  offsetOf,
  pickTravel,
  poseTransform,
  positionFor,
  spinBoost,
  trendingAccess,
  turnDuration,
  type TrendingAccess,
  type TurnKind,
} from "@/lib/trending-view";
import { cn } from "@/lib/utils";

/** One full turn of a disc at rest, and while its music plays in the mini player. */
const SPIN_REST_MS = 16000;
const SPIN_PLAYING_RATE = 3.2;

type Credits = ReturnType<typeof useCredits>;

function artistOf(item: TrendingItem, credits: Credits): string | null {
  return creditName(item, credits.artists, credits.bands);
}

function cover(item: TrendingItem, size: 160 | 480 = 480): string | null {
  return item.release_id ? coverUrl({ release: item.release_id, hasCover: item.has_cover }, size) : null;
}

/** Is the player on this item right now: one of its songs, or its teaser. */
function isPlayingFrom(player: ReturnType<typeof useOptionalPlayer>, item: TrendingItem): boolean {
  if (!player?.track) return false;
  const id = player.track.id;
  return item.tracks.some((t) => t.id === id || (t.teaser_id !== null && id === teaserKey(t.teaser_id)));
}

/* ---------- The disc ---------- */

/**
 * A picture CD: the cover printed across the face, a clear hub with its silver rings and the hole,
 * fine grooves, and two lights that never spin with it (a rainbow sheen that slides as the disc
 * turns in the carousel, and a fixed gloss). Every moving part is transform or opacity only.
 */
function Disc({ item, artist, index, register }: { item: TrendingItem; artist: string | null; index: number; register: (i: number, part: DiscPart, el: HTMLElement | null) => void }) {
  const src = cover(item);
  return (
    <span className="tc-lift">
      <span className="tc-disc">
        <span className="tc-face" ref={(el) => register(index, "face", el)}>
          {src ? (
            // eslint-disable-next-line @next/next/no-img-element -- cover images come from the API
            <img src={src} alt="" loading="lazy" decoding="async" draggable={false} className="tc-art" />
          ) : (
            <span className="tc-art tc-art-plain" aria-hidden="true">
              <span>{item.title}</span>
            </span>
          )}
          <span className="tc-grooves" />
          <span className="tc-hub" />
        </span>
        <span className="tc-light" ref={(el) => register(index, "light", el)} />
        <span className="tc-gloss" />
        <span className="tc-shade" ref={(el) => register(index, "shade", el)} />
        <span className="tc-twinkle" />
      </span>
      <span className="tc-label" ref={(el) => register(index, "label", el)}>
        <span className="tc-label-in" style={{ animationDelay: `${(index % 5) * -0.9}s` }}>
          <span className="tc-label-title">{item.title}</span>
          {artist ? <span className="tc-label-artist">{artist}</span> : null}
        </span>
      </span>
    </span>
  );
}

type DiscPart = "item" | "face" | "light" | "shade" | "label";

/* ---------- The carousel ---------- */

/**
 * Trending Corner (owner, 2026-11-08, D-TRENDING-01): the picked music as discs standing side by
 * side at an angle, turning back to front by themselves (the middle one is the front). Point at a
 * disc and it lifts with a twinkle; click it and the whole ring spins fast and brings it to the
 * front; drag or swipe either way; arrow keys step. The mini player below always follows the
 * front disc, whether it got there by itself or by hand.
 *
 * Smoothness: one requestAnimationFrame loop runs only while the ring moves and writes transforms
 * and opacity straight onto the elements (no React render per frame). React renders when the front
 * changes. The discs spin on the browser's animation engine. Nothing moves while the section is off
 * screen or the tab is hidden. Reduced motion: no spinning, short glides, no laps.
 */
export function TrendingCorner({ items }: { items: TrendingItem[] }) {
  const n = items.length;
  const credits = useCredits();
  const player = useOptionalPlayer();
  const [front, setFront] = React.useState(0);
  const sectionRef = React.useRef<HTMLDivElement>(null);
  const viewportRef = React.useRef<HTMLDivElement>(null);
  const parts = React.useRef<Record<DiscPart, (HTMLElement | null)[]>>({ item: [], face: [], light: [], shade: [], label: [] });
  const engine = React.useRef<Engine | null>(null);

  const register = React.useCallback((i: number, part: DiscPart, el: HTMLElement | null) => {
    parts.current[part][i] = el;
  }, []);

  // Playing from this carousel keeps it still, so the song you chose stays in front.
  const playingHere = !!player && player.status === "playing" && items.some((it) => isPlayingFrom(player, it));
  const frontPlaying = !!player && player.status === "playing" && isPlayingFrom(player, items[front] ?? items[0]);

  React.useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const e = createEngine({ n, parts: parts.current, viewport, onFront: setFront });
    engine.current = e;
    return () => {
      e.destroy();
      engine.current = null;
    };
  }, [n]);

  React.useEffect(() => {
    engine.current?.setHold("playing", playingHere);
  }, [playingHere]);
  React.useEffect(() => {
    engine.current?.setPlayingFront(frontPlaying ? front : null);
  }, [frontPlaying, front]);

  // Off screen or in a background tab, nothing turns or spins.
  React.useEffect(() => {
    const el = sectionRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => engine.current?.setHold("offscreen", !entry.isIntersecting), { rootMargin: "80px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const item = items[front] ?? items[0];
  if (!item) return null;

  return (
    <div
      ref={sectionRef}
      className="tc"
      onPointerEnter={(e) => e.pointerType !== "touch" && engine.current?.setHold("hover", true)}
      onPointerLeave={() => engine.current?.setHold("hover", false)}
      onFocus={() => engine.current?.setHold("focus", true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) engine.current?.setHold("focus", false);
      }}
    >
      <div
        className="tc-stage cr-cut cr-glass-card"
        role="group"
        aria-roledescription="carousel"
        aria-label="Trending Corner"
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
            e.preventDefault();
            engine.current?.step(e.key === "ArrowLeft" ? -1 : 1);
          }
        }}
      >
        <div aria-hidden="true" className="tc-floor" />
        <div ref={viewportRef} className="tc-viewport" data-count={n}>
          <div className="tc-ring">
            {items.map((it, i) => {
              const artist = artistOf(it, credits);
              const isFront = i === front;
              return (
                <button
                  key={it.id}
                  type="button"
                  ref={(el) => register(i, "item", el)}
                  className="tc-item"
                  data-front={isFront || undefined}
                  aria-current={isFront || undefined}
                  aria-label={isFront ? `${it.title}${artist ? ` by ${artist}` : ""}, in front` : `Bring ${it.title}${artist ? ` by ${artist}` : ""} to the front`}
                  onClick={() => engine.current?.pick(i)}
                >
                  <Disc item={it} artist={artist} index={i} register={register} />
                </button>
              );
            })}
          </div>
        </div>
        {n > 1 ? (
          <div className="tc-dots" aria-hidden="true">
            {items.map((it, i) => (
              <span key={it.id} data-on={i === front || undefined} />
            ))}
          </div>
        ) : null}
      </div>

      <MiniRoom
        item={item}
        artist={artistOf(item, credits)}
        index={front}
        count={n}
        onStep={(delta) => engine.current?.step(delta)}
      />
    </div>
  );
}

/* ---------- The engine (no React inside) ---------- */

type Hold = "hover" | "focus" | "drag" | "offscreen" | "hidden" | "playing";

type Engine = {
  pick: (i: number) => void;
  step: (delta: number) => void;
  setHold: (reason: Hold, on: boolean) => void;
  setPlayingFront: (i: number | null) => void;
  destroy: () => void;
};

function createEngine({
  n,
  parts,
  viewport,
  onFront,
}: {
  n: number;
  parts: Record<DiscPart, (HTMLElement | null)[]>;
  viewport: HTMLElement;
  onFront: (i: number) => void;
}): Engine {
  const reduced = !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  let pos = 0;
  let stepPx = 160;
  let raf = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastFront = 0;
  let tween: { from: number; to: number; start: number; dur: number; ease: (t: number) => number } | null = null;
  let lastFrame = { t: 0, pos: 0 };
  let speed = 0;
  let playingFront: number | null = null;
  let boosted = false;
  const holds = new Set<Hold>();
  if (typeof document !== "undefined" && document.hidden) holds.add("hidden");

  // The discs' own spin: one infinite animation per face, sped up while the ring travels.
  const spins: (Animation | null)[] = parts.face.map((face) =>
    face && !reduced && typeof face.animate === "function"
      ? face.animate([{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }], { duration: SPIN_REST_MS, iterations: Infinity })
      : null,
  );

  const measure = () => {
    const disc = parts.item.find(Boolean)?.querySelector<HTMLElement>(".tc-disc");
    stepPx = (disc?.offsetWidth || 220) * 0.84;
  };
  measure();
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => (measure(), render())) : null;
  ro?.observe(viewport);

  function render() {
    for (let i = 0; i < n; i++) {
      const el = parts.item[i];
      if (!el) continue;
      const p = discPose(offsetOf(i, pos, n), n, stepPx);
      el.style.transform = poseTransform(p);
      el.style.opacity = p.opacity.toFixed(3);
      el.style.visibility = p.opacity < 0.01 ? "hidden" : "visible";
      el.style.pointerEvents = p.opacity < 0.5 ? "none" : "";
      const shade = parts.shade[i];
      if (shade) shade.style.opacity = p.shade.toFixed(3);
      const label = parts.label[i];
      if (label) label.style.opacity = p.label.toFixed(3);
      const light = parts.light[i];
      if (light) light.style.transform = `rotate(${p.light.toFixed(1)}deg)`;
    }
    const f = frontIndex(pos, n);
    if (f !== lastFront && !tween) {
      lastFront = f;
      onFront(f);
    }
  }

  function setSpinRates() {
    spins.forEach((a, i) => {
      if (!a) return;
      const rate = boosted ? spinBoost(speed) : i === playingFront ? SPIN_PLAYING_RATE : 1;
      if (Math.abs((a.playbackRate || 1) - rate) > 0.15) a.updatePlaybackRate(rate);
      if (holds.has("offscreen") || holds.has("hidden")) a.pause();
      else if (a.playState === "paused") a.play();
    });
  }

  function frame(t: number) {
    raf = 0;
    const dt = Math.max(1, t - (lastFrame.t || t - 16)) / 1000;
    if (tween) {
      const k = tween.dur > 0 ? (t - tween.start) / tween.dur : 1;
      pos = tween.from + (tween.to - tween.from) * tween.ease(k);
      if (k >= 1) {
        pos = tween.to;
        tween = null;
      }
    }
    speed = (pos - lastFrame.pos) / dt;
    lastFrame = { t, pos };
    render();
    boosted = !!tween && Math.abs(speed) > 0.4;
    setSpinRates();
    if (tween || drag?.moved) raf = requestAnimationFrame(frame);
    else settle();
  }

  function kick() {
    if (!raf) {
      lastFrame = { t: 0, pos };
      raf = requestAnimationFrame(frame);
    }
  }

  function settle() {
    // Keep the number small after many laps; the pose is the same.
    if (n >= 3) pos = mod(pos, n);
    lastFrame.pos = pos;
    boosted = false;
    setSpinRates();
    schedule();
  }

  function go(target: number, kind: TurnKind) {
    if (n === 0) return;
    const distance = target - pos;
    const dur = reduced ? Math.min(240, turnDuration(distance, kind)) : turnDuration(distance, kind);
    const ease = kind === "pick" || kind === "drag" ? easeOutQuint : easeInOutCubic;
    tween = { from: pos, to: target, start: performance.now(), dur, ease };
    const f = frontIndex(target, n);
    // The mini player changes as the turn starts, so it arrives together with the disc.
    if (f !== lastFront) {
      lastFront = f;
      onFront(f);
    }
    clear();
    kick();
  }

  function clear() {
    if (timer) clearTimeout(timer);
    timer = null;
  }

  function schedule() {
    clear();
    if (n < 2 || holds.size > 0) return;
    timer = setTimeout(() => {
      timer = null;
      if (holds.size > 0 || tween) return;
      const next = n < 3 ? (frontIndex(pos, n) + 1) % n : Math.round(pos) + 1;
      go(n < 3 ? next : next, "auto");
    }, AUTO_TURN_MS);
  }

  // --- dragging: the ring follows the finger or mouse, then lands on the nearest disc -----------
  let drag: { id: number; x: number; startPos: number; moved: boolean; v: number; lastX: number; lastT: number } | null = null;
  let swallowClick = false;

  const onDown = (e: PointerEvent) => {
    if (e.button !== 0 || n === 0) return;
    drag = { id: e.pointerId, x: e.clientX, startPos: pos, moved: false, v: 0, lastX: e.clientX, lastT: e.timeStamp };
  };
  const onMove = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    if (!drag.moved) {
      if (Math.abs(dx) < DRAG_THRESHOLD_PX) return;
      drag.moved = true;
      // Pick up from wherever the ring is, even mid-turn.
      drag.startPos = pos;
      drag.x = e.clientX;
      tween = null;
      holds.add("drag");
      clear();
      viewport.setPointerCapture?.(e.pointerId);
      viewport.dataset.dragging = "";
    }
    let next = drag.startPos - (e.clientX - drag.x) / stepPx;
    if (n < 3) {
      // No loop to go round: a soft pull past the ends.
      const max = Math.max(n - 1, 0);
      if (next < 0) next = -rubber(-next);
      if (next > max) next = max + rubber(next - max);
    }
    const dt = Math.max(1, e.timeStamp - drag.lastT) / 1000;
    const v = -((e.clientX - drag.lastX) / stepPx) / dt;
    drag.v = drag.v * 0.7 + v * 0.3;
    drag.lastX = e.clientX;
    drag.lastT = e.timeStamp;
    pos = next;
    kick();
  };
  const onUp = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    const was = drag;
    drag = null;
    if (!was.moved) return;
    swallowClick = true;
    holds.delete("drag");
    delete viewport.dataset.dragging;
    // A flick still moving fast lands further on.
    const recent = e.timeStamp - was.lastT < 90 ? was.v : 0;
    go(landingFor(pos, recent, n), "drag");
  };
  const onClickCapture = (e: MouseEvent) => {
    if (swallowClick) {
      swallowClick = false;
      e.preventDefault();
      e.stopPropagation();
    }
  };
  const onVisibility = () => {
    if (document.hidden) holds.add("hidden");
    else holds.delete("hidden");
    setSpinRates();
    schedule();
  };
  viewport.addEventListener("pointerdown", onDown);
  viewport.addEventListener("pointermove", onMove);
  viewport.addEventListener("pointerup", onUp);
  viewport.addEventListener("pointercancel", onUp);
  viewport.addEventListener("click", onClickCapture, true);
  document.addEventListener("visibilitychange", onVisibility);

  render();
  schedule();

  return {
    pick(i) {
      if (n === 0) return;
      if (i === frontIndex(pos, n) && !tween) return;
      go(pos + (reduced ? positionFor(i, pos, n) - pos : pickTravel(i, pos, n)), "pick");
    },
    step(delta) {
      if (n < 2) return;
      const base = tween ? tween.to : Math.round(pos);
      const target = n < 3 ? Math.min(Math.max(base + delta, 0), n - 1) : base + delta;
      if (target !== base) go(target, "step");
    },
    setHold(reason, on) {
      const had = holds.has(reason);
      if (on) holds.add(reason);
      else holds.delete(reason);
      if (had !== on) {
        if (reason === "offscreen" || reason === "hidden") setSpinRates();
        if (!tween) schedule();
      }
    },
    setPlayingFront(i) {
      playingFront = i;
      setSpinRates();
    },
    destroy() {
      clear();
      if (raf) cancelAnimationFrame(raf);
      ro?.disconnect();
      spins.forEach((a) => a?.cancel());
      viewport.removeEventListener("pointerdown", onDown);
      viewport.removeEventListener("pointermove", onMove);
      viewport.removeEventListener("pointerup", onUp);
      viewport.removeEventListener("pointercancel", onUp);
      viewport.removeEventListener("click", onClickCapture, true);
      document.removeEventListener("visibilitychange", onVisibility);
    },
  };
}

/** Pulling past the end moves less and less. */
function rubber(over: number): number {
  return over / (1 + over * 2.5);
}

/* ---------- The mini listening room ---------- */

function MiniRoom({
  item,
  artist,
  index,
  count,
  onStep,
}: {
  item: TrendingItem;
  artist: string | null;
  index: number;
  count: number;
  onStep: (delta: number) => void;
}) {
  const { status } = useAuth();
  const commerce = useCustomerCommerce();
  const player = useOptionalPlayer();
  const signedIn = status === "authenticated";
  const access: TrendingAccess | null = commerce.ready || !signedIn ? trendingAccess(item, commerce, signedIn) : null;
  const here = isPlayingFrom(player, item);
  const playing = here && player?.status === "playing";
  const loading = here && player?.status === "loading";
  const href = itemHref(item);
  const src = cover(item);
  const duration = itemDurationMs(item);

  const start = () => {
    if (!player || !access) return;
    if (here) {
      player.toggle();
      return;
    }
    if (access.kind === "play") {
      const queue: PlayerTrack[] = item.tracks.map((t) => ({ id: t.id, title: t.title, artist }));
      void player.play(queue[0], { queue, source: item.title });
    } else if (access.kind === "teaser") {
      const song = item.tracks.find((t) => t.id === access.trackId);
      void player.playTeaser({ teaserId: access.teaserId, trackId: access.trackId, title: song?.title ?? item.title, artist, label: "Teaser" });
    }
  };
  const canStart = !!player && !!access && access.kind !== "buy";
  const playLabel = !access ? "Loading" : access.kind === "teaser" ? (playing ? "Pause the teaser" : "Play the teaser") : playing ? "Pause" : "Play";

  return (
    <div className="tc-room cr-cut cr-glass-card">
      <div key={item.id} className="tc-room-in">
        <Link href={href} className="tc-box cr-focus" aria-label={`Open ${item.title}`}>
          <span className="tc-box-case">
            <CoverArt
              src={src}
              fallback={<RoomCube front={item.title} side={artist ?? item.title} tone="ember" label="" className="w-full" />}
              className="aspect-square w-full"
            />
            <span aria-hidden="true" className="tc-box-spine" />
            <span aria-hidden="true" className="tc-box-gloss" />
          </span>
        </Link>

        <div className="tc-room-body">
          <p className="cr-eyebrow tc-room-eyebrow">
            <span>Trending</span>
            {count > 1 ? (
              <span className="cr-num">
                {index + 1} of {count}
              </span>
            ) : null}
            <span>{kindLabel(item)}</span>
          </p>
          <Link href={href} className="tc-room-title cr-focus">
            {item.title}
          </Link>
          {artist ? <p className="tc-room-artist">{artist}</p> : null}
          <p className="tc-room-meta">
            <span className="cr-num">{formatCount(item.listens)}</span> {item.listens === 1 ? "listen" : "listens"}
            {item.kind === "TRACK" && item.release_title && item.release_title !== item.title ? <span> · from {item.release_title}</span> : null}
            {item.tracks.length > 1 ? <span> · {item.tracks.length} songs</span> : null}
          </p>

          <div className="tc-controls">
            <button type="button" className="tc-key" aria-label="Previous" disabled={count < 2} onClick={() => onStep(-1)}>
              <ChevronLeft aria-hidden="true" className="size-5" />
            </button>
            <button
              type="button"
              className="tc-key tc-key-main"
              aria-label={`${playLabel}: ${item.title}`}
              data-playing={playing || undefined}
              disabled={!canStart}
              onClick={start}
            >
              {playing ? <Pause aria-hidden="true" className="size-5" /> : <Play aria-hidden="true" className="size-5 translate-x-px" />}
            </button>
            <button type="button" className="tc-key" aria-label="Next" disabled={count < 2} onClick={() => onStep(1)}>
              <ChevronRight aria-hidden="true" className="size-5" />
            </button>
            {player ? <RoomTime here={here} durationMs={duration} /> : null}
          </div>

          <p className="tc-room-status">
            {loading ? "Loading" : access?.kind === "teaser" ? (here ? "Playing the teaser" : "Free teaser") : access?.kind === "play" ? (here && playing ? "Playing" : "In your library") : null}
          </p>

          <RoomBuy access={access} />
        </div>
      </div>
    </div>
  );
}

/** Time heard and length, with a thin line; only this part re-renders as the song plays. */
function RoomTime({ here, durationMs }: { here: boolean; durationMs: number | null }) {
  const progress = usePlayerProgress();
  const total = here && progress.duration > 0 ? progress.duration : durationMs != null ? durationMs / 1000 : null;
  const at = here ? progress.position : 0;
  const share = total && total > 0 ? Math.min(at / total, 1) : 0;
  return (
    <span className="tc-time">
      <span className="tc-time-text cr-num">
        {clock(at)} / {total != null ? clock(total) : "Not available"}
      </span>
      <span aria-hidden="true" className="tc-time-line">
        <span style={{ transform: `scaleX(${share.toFixed(4)})` }} />
      </span>
    </span>
  );
}

function RoomBuy({ access }: { access: TrendingAccess | null }) {
  if (!access || access.kind === "play") return null;
  if (access.signIn) {
    // Visitors see the price when it is on sale, and sign in to buy (as on every song page).
    return (
      <span className="tc-buy-row">
        {access.buy ? (
          <span className="tc-room-note">
            {access.buy.label} <Money value={{ amount_minor: access.buy.offer.amount_minor, currency_code: access.buy.offer.currency_code }} />
          </span>
        ) : null}
        <Link href="/login?next=%2F%23trending" className="tc-buy cr-cut cr-cut-sm cr-focus">
          <LogIn aria-hidden="true" className="size-4" /> Sign in to buy
        </Link>
      </span>
    );
  }
  if (!access.buy) {
    return (
      <span className="tc-room-note">
        <Lock aria-hidden="true" className="size-3.5" /> Not on sale yet
      </span>
    );
  }
  return (
    <Link href={`/checkout?offer=${access.buy.offer.id}`} className={cn("tc-buy cr-cut cr-cut-sm cr-focus")}>
      <Lock aria-hidden="true" className="size-4" /> {access.buy.label}{" "}
      <Money value={{ amount_minor: access.buy.offer.amount_minor, currency_code: access.buy.offer.currency_code }} />
    </Link>
  );
}
