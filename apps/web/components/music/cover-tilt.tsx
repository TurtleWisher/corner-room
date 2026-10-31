"use client";

import * as React from "react";

import { tiltFor } from "@/components/home/poster-tilt";

/**
 * The song page cover leans toward the mouse and light spills behind it from the pointer, like the
 * home page's featured cover (owner, 2026-10-31, D-MOTION-02). Fine pointers only, off under
 * reduced motion; one listener, throttled to animation frames, writing CSS variables, so React
 * never re-renders. Styles: `app/styles/modules/music.css`.
 */
export function CoverTilt({ children, className }: { children: React.ReactNode; className?: string }) {
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
    <div ref={ref} className={`music-cover ${className ?? ""}`} data-testid="cover-tilt">
      <div aria-hidden="true" className="music-cover-halo" />
      <div className="music-cover-card relative">
        {children}
        <div aria-hidden="true" className="music-cover-edge" />
      </div>
    </div>
  );
}
