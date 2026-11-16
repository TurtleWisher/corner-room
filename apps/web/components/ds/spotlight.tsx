"use client";

import * as React from "react";

/*
 * Spotlight: a soft light inside a card that follows the mouse (owner, 2026-11-15).
 *
 * One listener per region, not per card: it finds the card under the pointer (`[data-spot]`) and
 * writes two CSS variables on that card only, at most once a frame. The light itself is drawn by
 * the card's own cut-corner fill and edge (styles/spotlight.css), beneath its content.
 * Touch, pens and reduced motion get no listener at all, so cards stay still.
 */
/** `selector`: which elements inside the region catch the light. `trace`: an element (the shell's
 * header) that also gets the pointer's x as --hx, for a line of light that follows along it. */
export function useSpotlight<T extends HTMLElement>(selector = "[data-spot]", trace?: string): React.RefObject<T | null> {
  const ref = React.useRef<T>(null);
  React.useEffect(() => {
    const root = ref.current;
    if (!root || typeof window.matchMedia !== "function") return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    let event: PointerEvent | null = null;
    const paint = () => {
      frame = 0;
      const e = event;
      if (!e || !(e.target instanceof Element)) return;
      const line = trace ? root.querySelector<HTMLElement>(trace) : null;
      if (line) {
        const lr = line.getBoundingClientRect();
        line.style.setProperty("--hx", `${(e.clientX - lr.left).toFixed(0)}px`);
      }
      const card = e.target.closest<HTMLElement>(selector);
      if (!card || !root.contains(card)) return;
      const r = card.getBoundingClientRect();
      card.style.setProperty("--sx", `${(e.clientX - r.left).toFixed(0)}px`);
      card.style.setProperty("--sy", `${(e.clientY - r.top).toFixed(0)}px`);
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      event = e;
      if (!frame) frame = requestAnimationFrame(paint);
    };
    root.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      root.removeEventListener("pointermove", onMove);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [selector, trace]);
  return ref;
}

/** A region whose `[data-spot]` cards catch the pointer's light. */
export function SpotlightRegion<T extends React.ElementType = "div">({
  as,
  children,
  ...rest
}: { as?: T } & Omit<React.ComponentPropsWithoutRef<T>, "as">) {
  const ref = useSpotlight<HTMLElement>();
  const Tag = (as ?? "div") as React.ElementType;
  return (
    <Tag ref={ref} {...rest}>
      {children}
    </Tag>
  );
}
