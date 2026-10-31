"use client";

import Link from "next/link";
import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { CoverArt } from "@/components/brand/cover-art";
import { RoomCube } from "@/components/brand/room-cube";
import { DateTime } from "@/components/ds";
import { EventMedia } from "@/components/events/event-media";
import { PosterTilt } from "@/components/home/poster-tilt";
import { useCredits } from "@/components/music/credits";
import { coverUrl } from "@/lib/cover-view";
import { cityFromTimeZone, stepSlide, type HomeFeature } from "@/lib/home-view";
import { creditName } from "@/lib/music-view";

/** How long each slide stays before the next turns in. The progress line under the cover runs this long. */
export const AUTOPLAY_MS = 6500;
/** A touch has to travel this far sideways to count as a swipe. */
const SWIPE_PX = 40;

type Credits = ReturnType<typeof useCredits>;

function slideHref(slide: HomeFeature): string {
  return slide.kind === "event" ? `/events/${slide.event.id}` : `/releases/${slide.release.id}`;
}

function slideTitle(slide: HomeFeature): string {
  return slide.kind === "event" ? slide.event.title : slide.release.title;
}

function SlideArt({ slide, credits }: { slide: HomeFeature; credits: Credits }) {
  if (slide.kind === "event") {
    const { event } = slide;
    return (
      <EventMedia
        title={event.title}
        side={cityFromTimeZone(event.timezone) ?? event.title}
        eventId={event.id}
        hasCover={event.has_cover}
        animate
        className="w-full"
      />
    );
  }
  const { release } = slide;
  const artist = creditName(release, credits.artists, credits.bands);
  return (
    <CoverArt
      src={coverUrl({ release: release.id, hasCover: !!release.cover_asset_id }, 1200)}
      fallback={<RoomCube front={release.title} side={artist ?? release.title} tone="sky" label="" className="w-full" />}
      className="w-full"
    />
  );
}

/**
 * The turn between two slides, on the browser's own animation engine (no library, no React
 * re-render per frame): the old cover swings back and away to one side while the new one swings
 * in from the other and a light sweeps across it as it lands. Transform and opacity only; a quick
 * cross-fade under reduced motion. Each animation is cancelled when done, so the CSS resting state
 * (only the active slide visible) always has the last word, even after rapid clicks.
 */
function turn(from: HTMLElement | null, to: HTMLElement | null, dir: 1 | -1, reduced: boolean) {
  for (const el of [from, to]) el?.getAnimations?.({ subtree: true }).forEach((a) => a.cancel());
  if (!from || !to || typeof to.animate !== "function") return;
  const here = { transform: "translate3d(0, 0, 0) rotateY(0deg) scale(1)", opacity: 1 };
  const side = (s: number) => ({ transform: `translate3d(${s * 46}%, 0, -320px) rotateY(${-s * 48}deg) scale(0.86)`, opacity: 0 });
  const timing: KeyframeAnimationOptions = { duration: reduced ? 240 : 900, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "both" };
  const done = (a: Animation) => {
    a.onfinish = () => a.cancel();
  };
  if (reduced) {
    done(from.animate([{ opacity: 1 }, { opacity: 0 }], timing));
    done(to.animate([{ opacity: 0 }, { opacity: 1 }], timing));
    return;
  }
  done(from.animate([here, side(-dir)], { ...timing, duration: 760 }));
  done(to.animate([side(dir), here], timing));
  const sheen = to.querySelector<HTMLElement>(".home-feature-sheen");
  if (sheen) {
    done(
      sheen.animate(
        [
          { transform: "translateX(-130%) skewX(-18deg)", opacity: 0 },
          { opacity: 1, offset: 0.35 },
          { transform: "translateX(130%) skewX(-18deg)", opacity: 0 },
        ],
        { duration: 1100, delay: 260, easing: "cubic-bezier(0.4, 0, 0.2, 1)", fill: "both" },
      ),
    );
  }
}

/**
 * The home hero's featured carousel (owner, 2026-10-31): live and upcoming events and the newest
 * releases turn by themselves, one cover in front at a time, like a 3D slide presentation. Each
 * cover keeps the poster light and tilt (PosterTilt). Pointing at it (or touching it, or keyboard
 * focus inside it) pauses the turning until the pointer leaves; two glass arrows appear on hover
 * for going back and forward, and on touch screens a sideways swipe does the same. The line under
 * the cover shows the time to the next turn and lets anyone jump to a slide. Reduced motion: no
 * turning by itself, and a cross-fade when someone moves.
 */
export function FeaturedCarousel({ slides }: { slides: HomeFeature[] }) {
  const count = slides.length;
  const credits = useCredits();
  const [active, setActive] = React.useState(0);
  const [hovering, setHovering] = React.useState(false);
  const [focused, setFocused] = React.useState(false);
  const [touching, setTouching] = React.useState(false);
  // Covers load only once their slide is shown or is next, so the hero never downloads them all.
  const [mounted, setMounted] = React.useState<Set<number>>(() => new Set([0, stepSlide(0, 1, count)]));
  const activeRef = React.useRef(0);
  const slideEls = React.useRef<(HTMLDivElement | null)[]>([]);
  const touch = React.useRef<{ x: number; y: number } | null>(null);
  const swiped = React.useRef(false);
  const reduced = React.useRef(false);

  React.useEffect(() => {
    reduced.current = !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  }, []);

  const go = React.useCallback(
    (delta: number) => {
      if (count < 2 || delta === 0) return;
      const from = activeRef.current;
      const to = stepSlide(from, delta, count);
      const dir = delta > 0 ? 1 : -1;
      setMounted((m) => (m.has(to) && m.has(stepSlide(to, dir, count)) ? m : new Set(m).add(to).add(stepSlide(to, dir, count))));
      turn(slideEls.current[from], slideEls.current[to], dir, reduced.current);
      activeRef.current = to;
      setActive(to);
    },
    [count],
  );

  if (count === 0) return null;
  const slide = slides[active];
  const href = slideHref(slide);
  const paused = hovering || focused || touching;
  const artist = slide.kind === "release" ? creditName(slide.release, credits.artists, credits.bands) : null;

  return (
    <section
      aria-roledescription="carousel"
      aria-label="Featured"
      className="home-poster-in home-feature home-feature-size w-full max-w-[28rem]"
      data-paused={paused || undefined}
      // Touch has its own pause (while a finger is on the cover); mouse and pen pause on hover.
      onPointerEnter={(e) => e.pointerType !== "touch" && setHovering(true)}
      onPointerLeave={() => setHovering(false)}
      onFocus={(e) => setFocused(e.target.matches(":focus-visible"))}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          e.preventDefault();
          go(e.key === "ArrowLeft" ? -1 : 1);
        }
      }}
    >
      <div className="relative">
        <div aria-hidden="true" className="home-feature-floor" />
        <PosterTilt>
          <div
            className="home-feature-stage"
            onTouchStart={(e) => {
              touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
              setTouching(true);
            }}
            onTouchEnd={(e) => {
              const start = touch.current;
              touch.current = null;
              setTouching(false);
              if (!start) return;
              const dx = e.changedTouches[0].clientX - start.x;
              const dy = e.changedTouches[0].clientY - start.y;
              if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy)) {
                swiped.current = true;
                go(dx < 0 ? 1 : -1);
              }
            }}
            onTouchCancel={() => {
              touch.current = null;
              setTouching(false);
            }}
            onClickCapture={(e) => {
              // A swipe is not a tap: don't open the cover it started on.
              if (swiped.current) {
                swiped.current = false;
                e.preventDefault();
                e.stopPropagation();
              }
            }}
          >
            {slides.map((s, i) => {
              const isActive = i === active;
              return (
                <div
                  key={s.kind === "event" ? `e-${s.event.id}` : `r-${s.release.id}`}
                  ref={(el) => {
                    slideEls.current[i] = el;
                  }}
                  role="group"
                  aria-roledescription="slide"
                  aria-label={`${i + 1} of ${count}: ${slideTitle(s)}`}
                  aria-hidden={!isActive || undefined}
                  inert={!isActive}
                  data-active={isActive || undefined}
                  className="home-feature-slide"
                >
                  <Link href={slideHref(s)} className="cr-focus block" aria-label={`${s.label}: ${slideTitle(s)}`}>
                    {mounted.has(i) || isActive ? <SlideArt slide={s} credits={credits} /> : <div className="aspect-square w-full bg-cr-signal/40" />}
                  </Link>
                  <span aria-hidden="true" className="home-feature-sheen" />
                </div>
              );
            })}
          </div>
        </PosterTilt>
        {count > 1 ? (
          <>
            <button type="button" className="home-feature-arrow" data-side="prev" aria-label="Previous" onClick={() => go(-1)}>
              <ChevronLeft aria-hidden="true" className="size-5" strokeWidth={2.25} />
            </button>
            <button type="button" className="home-feature-arrow" data-side="next" aria-label="Next" onClick={() => go(1)}>
              <ChevronRight aria-hidden="true" className="size-5" strokeWidth={2.25} />
            </button>
          </>
        ) : null}
      </div>

      <div key={active} className="home-feature-caption mt-5">
        <div className="flex items-baseline justify-between gap-4">
          <span className="cr-eyebrow flex items-center gap-2 text-[0.6875rem] text-fg-muted">
            {slide.label === "Live now" ? <span aria-hidden="true" className="size-2 bg-cr-red-glow" /> : null}
            {slide.label}
          </span>
          <Link href={href} className="cr-focus truncate text-sm font-semibold text-fg hover:text-highlight">
            {slideTitle(slide)}
          </Link>
        </div>
        {slide.kind === "event" && slide.event.starts_at ? (
          <p className="mt-1 text-right text-xs text-fg-muted">
            <DateTime value={slide.event.starts_at} timeZone={slide.event.timezone} showZone />
          </p>
        ) : artist ? (
          <p className="mt-1 text-right text-xs text-fg-muted">{artist}</p>
        ) : null}
      </div>

      {count > 1 ? (
        <div className="home-feature-steps mt-4 flex gap-1.5">
          {slides.map((s, i) => (
            <button
              key={i}
              type="button"
              className="home-feature-step"
              aria-label={`Show ${i + 1} of ${count}: ${slideTitle(s)}`}
              aria-current={i === active || undefined}
              onClick={() => go(i - activeRef.current)}
            >
              {i === active ? (
                // The fill runs AUTOPLAY_MS and pauses with the carousel; when it ends, the next slide turns in.
                <span key={active} className="home-feature-fill" style={{ animationDuration: `${AUTOPLAY_MS}ms` }} onAnimationEnd={() => go(1)} />
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
