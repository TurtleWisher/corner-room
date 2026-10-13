"use client";

import * as React from "react";

/** Largest tilt in degrees (owner decision D2, raised from 4 to 7 on 2026-10-13: 4 was too quiet to notice). */
export const MAX_TILT_DEG = 7;

/**
 * Pointer position over an element, as a tilt and a light position. Pure, so it is tested:
 * centre is flat, the edges reach ±MAX_TILT_DEG, and the light sits where the pointer is.
 */
export function tiltFor(x: number, y: number, width: number, height: number) {
  const nx = width > 0 ? Math.min(1, Math.max(0, x / width)) : 0.5;
  const ny = height > 0 ? Math.min(1, Math.max(0, y / height)) : 0.5;
  return {
    tiltX: (nx - 0.5) * 2 * MAX_TILT_DEG,
    tiltY: -(ny - 0.5) * 2 * MAX_TILT_DEG,
    glareX: Math.round(nx * 100),
    glareY: Math.round(ny * 100),
  };
}

/**
 * The featured poster leans gently toward a mouse and catches light on its edge (home M2).
 * Fine pointers only: touch and pens get the still poster. Off under reduced motion. One
 * listener, throttled to animation frames, writing CSS variables; React never re-renders.
 */
export function PosterTilt({ children }: { children: React.ReactNode }) {
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fine = window.matchMedia?.("(hover: hover) and (pointer: fine)").matches;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!fine || reduced) return;
    let frame = 0;
    let last: PointerEvent | null = null;
    const apply = () => {
      frame = 0;
      if (!last) return;
      const r = el.getBoundingClientRect();
      const t = tiltFor(last.clientX - r.left, last.clientY - r.top, r.width, r.height);
      el.style.setProperty("--tilt-x", `${t.tiltX.toFixed(2)}deg`);
      el.style.setProperty("--tilt-y", `${t.tiltY.toFixed(2)}deg`);
      el.style.setProperty("--glare-x", `${t.glareX}%`);
      el.style.setProperty("--glare-y", `${t.glareY}%`);
    };
    const onMove = (e: PointerEvent) => {
      last = e;
      el.dataset.tilting = "true";
      el.style.setProperty("--glare", "1");
      if (!frame) frame = requestAnimationFrame(apply);
    };
    const onLeave = () => {
      last = null;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      delete el.dataset.tilting;
      for (const p of ["--tilt-x", "--tilt-y", "--glare-x", "--glare-y", "--glare"]) el.style.removeProperty(p);
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div ref={ref} className="home-poster" data-testid="poster-tilt">
      <div aria-hidden="true" className="home-poster-halo" />
      <div className="home-poster-card relative">
        {children}
        <div aria-hidden="true" className="home-poster-edge" />
      </div>
    </div>
  );
}
