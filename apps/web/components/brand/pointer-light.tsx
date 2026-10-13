"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";

/*
 * Pointer light (brand v1.4, owner request 2026-10-13): the corner light's focus follows the
 * visitor's pointer, beneath the grain and beneath all content.
 *
 * Smoothness is the whole point, so the work is compositor-only: each lit region has one light
 * element moved with translate3d, and one shared animation loop eases it toward the pointer.
 * React never re-renders on pointer movement, no CSS variable changes on large elements, and the
 * loop stops as soon as the light has caught up. Touch screens, pens and reduced motion get the
 * light resting at the lit corner instead (no tracking).
 */

type Canvas = { el: HTMLElement; spot: HTMLElement };

const canvases = new Set<Canvas>();
let target = { x: 0, y: 0 };
let current = { x: 0, y: 0 };
let placed = false;
let frame = 0;
let last = 0;
let listening = false;
let tracking = false;

/** Ease time constant in ms: how quickly the light catches up (about 0.25 s to settle). */
export const EASE_MS = 80;

/** Frame-rate independent easing step toward the pointer. Pure, so it is tested. */
export function easeToward(from: number, to: number, dtMs: number, tauMs = EASE_MS): number {
  const k = 1 - Math.exp(-Math.max(0, dtMs) / tauMs);
  return from + (to - from) * k;
}

function restingPoint() {
  // The lit corner: where the brand's light comes from.
  return { x: window.innerWidth * 0.16, y: window.innerHeight * 0.14 };
}

function paint() {
  for (const c of canvases) {
    const r = c.el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight || r.width === 0) continue; // off screen
    c.spot.style.transform = `translate3d(${(current.x - r.left).toFixed(1)}px, ${(current.y - r.top).toFixed(1)}px, 0)`;
  }
}

function tick(now: number) {
  const dt = last ? Math.min(64, now - last) : 16;
  last = now;
  current = { x: easeToward(current.x, target.x, dt), y: easeToward(current.y, target.y, dt) };
  paint();
  if (Math.abs(current.x - target.x) < 0.3 && Math.abs(current.y - target.y) < 0.3) {
    current = { ...target };
    paint();
    frame = 0;
    last = 0;
    return;
  }
  frame = requestAnimationFrame(tick);
}

function kick() {
  if (!frame) {
    last = 0;
    frame = requestAnimationFrame(tick);
  }
}

function onMove(e: PointerEvent) {
  if (e.pointerType !== "mouse") return;
  target = { x: e.clientX, y: e.clientY };
  if (!placed) {
    placed = true;
    current = { ...target };
  }
  kick();
}

function onScrollOrResize() {
  // The pointer has not moved, but the regions under it have: re-place without easing lag.
  if (!tracking) target = restingPoint();
  paint();
  kick();
}

function ensureListening() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  const fine = window.matchMedia?.("(hover: hover) and (pointer: fine)").matches ?? false;
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  tracking = fine && !reduced;
  target = restingPoint();
  current = { ...target };
  if (tracking) window.addEventListener("pointermove", onMove, { passive: true });
  window.addEventListener("scroll", onScrollOrResize, { passive: true });
  window.addEventListener("resize", onScrollOrResize, { passive: true });
}

function register(c: Canvas) {
  ensureListening();
  canvases.add(c);
  paint();
  return () => {
    canvases.delete(c);
  };
}

/**
 * The light and the grain for one lit region, as two sibling layers so the grain's soft-light
 * blend reaches the real page beneath (inside a shared layer it would only see the empty light
 * layer and turn grey). `page` layers are fixed to the viewport: the costly blend then only ever
 * covers one screen. Decorative; never focusable or clickable.
 */
export function PointerLightLayer({ page = false }: { page?: boolean }) {
  const el = React.useRef<HTMLDivElement>(null);
  const spot = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!el.current || !spot.current) return;
    return register({ el: el.current, spot: spot.current });
  }, []);
  const where = page ? " cr-pl-page" : "";
  return (
    <>
      <div ref={el} aria-hidden="true" className={`cr-pl cr-pl-clip${where}`}>
        <div ref={spot} className="cr-pl-spot" />
      </div>
      <div aria-hidden="true" className={`cr-pl cr-pl-grain${where}`} />
    </>
  );
}

/**
 * Puts the light (and the page grain) into each page's <main>, where the page light lives. Mounted
 * once in the app shell, so every page gets it without touching each page. Follows the current
 * <main> when a page swaps it (for example a loading frame replaced by the real page). Staff pages
 * get the grain with a still light (CSS hides the moving part there).
 */
export function PagePointerLight() {
  const pathname = usePathname();
  const [main, setMain] = React.useState<HTMLElement | null>(null);
  React.useEffect(() => {
    let currentMain: HTMLElement | null = null;
    const find = () => {
      const found = document.querySelector<HTMLElement>("main#main.cr-scope");
      if (found !== currentMain) {
        currentMain = found;
        setMain(found);
      }
    };
    find();
    const watch = new MutationObserver(() => {
      if (!currentMain?.isConnected) find();
    });
    watch.observe(document.body, { childList: true, subtree: true });
    return () => watch.disconnect();
  }, [pathname]);
  return main ? createPortal(<PointerLightLayer page />, main) : null;
}
