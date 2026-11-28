"use client";

/* The Wrap as a story (owner, 2026-11-28, D-WRAP-01): full screen, one glass card at a time over the
 * dithered carnival light, moving on by itself at staff's pace. Tap the left third to go back,
 * anywhere else to go on; hold to pause; arrow keys and Space work too. The top songs play through
 * the site's one player, so the music carries on after the Wrap. */

import { ChevronLeft, ChevronRight, Pause, Play, Share2, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Logo } from "@/components/brand/logo";
import { useOptionalPlayer } from "@/components/music/player";
import { WrapCardView, Words } from "@/components/wrap/wrap-cards";
import { createWrapDither, type WrapDitherScene } from "@/components/wrap/wrap-dither";
import { WrapShare } from "@/components/wrap/wrap-share";
import { countWrap, type MyWrap, type WrapCard } from "@/features/wraps/api";
import { advance, headlineFor, progressBars, stepTo, tapStep, worldFor, type FillContext, type StoryClock } from "@/lib/wrap-view";

const SPEED = { LIVELY: 1, CALM: 0.35, STILL: 0 } as const;
const HOLD_MS = 220;

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

/** The backdrop canvas; the CSS light under it shows where WebGL can't draw. */
function DitherBackdrop({ wrap, world, sceneRef }: { wrap: MyWrap; world: "ember" | "sky"; sceneRef: React.MutableRefObject<WrapDitherScene | null> }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const reduced = useReducedMotion();
  const { cell, style, motion } = wrap.season.dither;
  const speed = reduced ? 0 : SPEED[motion];
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const scene = createWrapDither(el, world, { cell, style, speed });
    if (!scene) setFailed(true);
    sceneRef.current = scene;
    return () => {
      scene?.destroy();
      sceneRef.current = null;
    };
    // The world and options are passed on below without starting a new scene.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => sceneRef.current?.setWorld(world), [world, sceneRef]);
  useEffect(() => sceneRef.current?.setOptions({ cell, style, speed }), [cell, style, speed, sceneRef]);

  return <canvas ref={canvas} className="wr-dither" aria-hidden data-failed={failed || undefined} />;
}

export function WrapStory({ wrap, closeHref = "/wrap" }: { wrap: MyWrap; closeHref?: string }) {
  const cards: WrapCard[] = useMemo(() => (wrap.enough ? wrap.cards : []), [wrap]);
  const count = Math.max(1, cards.length);
  const slideMs = wrap.season.slide_seconds * 1000;
  // The clock lives in a ref: progress bars are written straight to the page every frame and React
  // renders only when the card changes.
  const clockRef = useRef<StoryClock>({ index: 0, elapsedMs: 0 });
  const [index, setIndex] = useState(0);
  const barsRef = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  const [held, setHeld] = useState(false);
  const [sharing, setSharing] = useState(false);
  const scene = useRef<WrapDitherScene | null>(null);
  const press = useRef<{ at: number; x: number } | null>(null);
  const finished = useRef(false);
  const player = useOptionalPlayer();
  const world = worldFor(wrap.season.look, index);
  const ctx: FillContext = { firstName: wrap.person.first_name, name: wrap.person.name, year: wrap.season.year, stats: wrap.stats };
  const card = cards[index];
  const atEnd = index >= count - 1;
  const running = !paused && !held && !sharing && cards.length > 0;

  const paint = useCallback(() => {
    const fills = barsRef.current?.querySelectorAll<HTMLElement>(".wr-bar-fill");
    if (!fills) return;
    progressBars(clockRef.current, slideMs, count).forEach((b, i) => {
      if (fills[i]) fills[i].style.transform = `scaleX(${b})`;
    });
  }, [slideMs, count]);

  // One clock: moves only while the story runs and the tab is visible.
  useEffect(() => {
    paint();
    if (!running) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = document.hidden ? 0 : now - last;
      last = now;
      const next = advance(clockRef.current, dt, slideMs, count);
      if (next.index !== clockRef.current.index) setIndex(next.index);
      clockRef.current = next;
      paint();
      if (next.index < count - 1 || next.elapsedMs < slideMs) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // `index` restarts the loop after it stopped on the last card and someone stepped back.
  }, [running, slideMs, count, paint, index]);

  useEffect(() => {
    if (atEnd && cards.length > 1 && !finished.current && !wrap.preview) {
      finished.current = true;
      void countWrap(wrap.season.id, "FINISHED");
    }
  }, [atEnd, cards.length, wrap.preview, wrap.season.id]);

  const go = useCallback(
    (step: number) => {
      const next = stepTo(clockRef.current.index, step, count);
      clockRef.current = { index: next, elapsedMs: 0 };
      setIndex(next);
      paint();
    },
    [count, paint],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (sharing || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === " " && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        setPaused((p) => !p);
      } else return;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, sharing]);

  const interactive = (t: EventTarget | null) => t instanceof Element && !!t.closest("button, a, input, label, [role='dialog']");

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (interactive(e.target)) return;
    press.current = { at: performance.now(), x: e.clientX };
    setHeld(true);
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = press.current;
    press.current = null;
    setHeld(false);
    if (!p || interactive(e.target)) return;
    if (performance.now() - p.at < HOLD_MS) {
      const box = e.currentTarget.getBoundingClientRect();
      go(tapStep(p.x - box.left, box.width));
    }
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    scene.current?.pointer(e.clientX / window.innerWidth, e.clientY / window.innerHeight);
    const box = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty("--mx", `${((e.clientX - box.left) / box.width) * 100}%`);
    e.currentTarget.style.setProperty("--my", `${((e.clientY - box.top) / box.height) * 100}%`);
  };

  const songs = wrap.stats.top_songs;
  const playFrom = (from: number) => {
    if (!player || !songs.length) return;
    const queue = songs.map((s) => ({ id: s.track_id, title: s.title ?? "Song", artist: s.act }));
    void player.play(queue[from] ?? queue[0], { queue, source: wrap.season.name });
    if (!wrap.preview) void countWrap(wrap.season.id, "PLAYED");
  };

  const heading = card ? headlineFor(card.key, card.title, ctx) : "";

  return (
    <div className="wr-root" data-world={world} data-look={wrap.season.look} data-running={running || undefined}>
      <DitherBackdrop wrap={wrap} world={world} sceneRef={scene} />
      <div className="wr-vignette" aria-hidden />
      <div
        className="wr-stage"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          press.current = null;
          setHeld(false);
        }}
        onPointerMove={onPointerMove}
      >
        <div className="wr-marquee" aria-hidden>
          <span />
          <span />
          <span />
          <span />
        </div>
        {cards.length > 1 ? (
          <div className="wr-bars" aria-hidden ref={barsRef}>
            {cards.map((c, i) => (
              <span key={`${i}-${c.key}`} className="wr-bar">
                <span className="wr-bar-fill" />
              </span>
            ))}
          </div>
        ) : null}
        <header className="wr-top">
          <Link href="/" className="wr-logo" aria-label="Corner Room home">
            <Logo variant={world === "sky" ? "indigo" : "ember"} height={40} alt="" />
          </Link>
          <div className="wr-top-title">
            <span className="wr-top-name">{wrap.season.name}</span>
            {wrap.preview ? <span className="wr-badge">Staff preview</span> : null}
          </div>
          <div className="wr-top-actions">
            {cards.length > 1 ? (
              <button type="button" className="wr-icon" onClick={() => setPaused((p) => !p)} aria-label={paused ? "Play the story" : "Pause the story"} aria-pressed={paused}>
                {paused ? <Play aria-hidden className="size-4" /> : <Pause aria-hidden className="size-4" />}
              </button>
            ) : null}
            {wrap.season.sharing.on && wrap.enough ? (
              <button type="button" className="wr-icon" onClick={() => setSharing(true)} aria-label="Share your Wrap">
                <Share2 aria-hidden className="size-4" />
              </button>
            ) : null}
            <Link href={closeHref} className="wr-icon" aria-label="Close the Wrap">
              <X aria-hidden className="size-4" />
            </Link>
          </div>
        </header>

        <section className="wr-slot" aria-live="polite" aria-label={heading || wrap.season.name}>
          {card ? (
            <WrapCardView key={`${index}-${card.key}`} card={card} wrap={wrap} ctx={ctx} onPlay={playFrom} />
          ) : (
            <article className="wr-card cr-cut" data-card="EMPTY">
              <span className="wr-sheen" aria-hidden />
              <p className="wr-eyebrow">
                <span>{wrap.season.name}</span>
                <span className="wr-eyebrow-year">{wrap.season.year}</span>
              </p>
              <h2 className="wr-headline">
                <Words text="Your Wrap is still warming up" />
              </h2>
              <div className="wr-body wr-stack">
                <p className="wr-lede">
                  A Wrap is made from the music you play on Corner Room
                  {wrap.min_listens > 1 ? `: it needs at least ${wrap.min_listens} counted listens in this Wrap's time` : ""}. Play some songs and come back.
                </p>
                <Link href="/listen" className="wr-pill">
                  <Play aria-hidden className="size-4" /> Start listening
                </Link>
              </div>
            </article>
          )}
        </section>

        {card?.key === "SUMMARY" && wrap.season.sharing.on ? (
          <div className="wr-cta">
            <button type="button" className="wr-pill wr-pill-big" onClick={() => setSharing(true)}>
              <Share2 aria-hidden className="size-5" /> Share my Wrap
            </button>
            {songs.length ? (
              <button type="button" className="wr-pill wr-pill-quiet" onClick={() => playFrom(0)}>
                <Play aria-hidden className="size-4" /> Play my top songs
              </button>
            ) : null}
          </div>
        ) : null}

        {cards.length > 1 ? (
          <>
            <button type="button" className="wr-step wr-step-back" onClick={() => go(-1)} disabled={index === 0} aria-label="Previous card">
              <ChevronLeft aria-hidden className="size-6" />
            </button>
            <button type="button" className="wr-step wr-step-next" onClick={() => go(1)} disabled={atEnd} aria-label="Next card">
              <ChevronRight aria-hidden className="size-6" />
            </button>
          </>
        ) : null}
        <p className="sr-only">
          Card {index + 1} of {count}. Use the arrow keys to move and Space to pause.
        </p>
      </div>
      {sharing ? <WrapShare wrap={wrap} onClose={() => setSharing(false)} /> : null}
    </div>
  );
}
