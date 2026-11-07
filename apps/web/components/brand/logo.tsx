"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import { logoTilt } from "@/lib/logo-tilt";

export type LogoVariant = "ember" | "indigo" | "mono-dark" | "mono-light" | "artist-mint";

const SRC: Record<LogoVariant, string> = {
  ember: "/brand/logo/corner-room-logo-ember.svg",
  indigo: "/brand/logo/corner-room-logo-indigo.svg",
  "mono-dark": "/brand/logo/corner-room-logo-mono-dark.svg",
  "mono-light": "/brand/logo/corner-room-logo-mono-light.svg",
  // Artist Studio colourway (D-THEME-02): it brings its own soft Signal Mint field (see below).
  "artist-mint": "/brand/logo/corner-room-logo-artist-mint.svg",
};

/**
 * Official logo files only (brand/logo). Never redrawn or recoloured. Ember on red or warm black,
 * indigo on sky or deep indigo, mono on neutrals, artist mint on Signal Mint (Artist Studio only).
 * Minimum 40 px tall; below that use the tile.
 *
 * The artist mint mark draws its own field (owner, 2026-11-07, D-LOGO-01): a soft Signal Mint pool
 * of light under the mark, fading out at the edges, instead of a flat square tile. Its Forest sides
 * stay on mint, so the cube still reads on the dark Studio base.
 *
 * Every logo answers the pointer (owner, 2026-11-07, D-LOGO-01): with a mouse it tilts toward the
 * pointer in 3D (at most about 10°), lifts a little over a soft shadow, and a sheen sweeps once
 * across the mark (masked to the mark's own shape). Nothing on touch, nothing under reduced motion.
 * The file itself is never changed: all of it is around and over the image.
 */
export function Logo({
  variant = "ember",
  height = 48,
  className,
  alt = "Corner Room",
}: {
  variant?: LogoVariant;
  height?: number;
  className?: string;
  alt?: string;
}) {
  const h = Math.max(40, height);
  const w = Math.round((h * 279) / 232);
  const body = React.useRef<HTMLSpanElement>(null);
  const frame = React.useRef<number | null>(null);

  const setTilt = (rx: number, ry: number) => {
    const el = body.current;
    if (!el) return;
    el.style.setProperty("--logo-rx", `${rx}deg`);
    el.style.setProperty("--logo-ry", `${ry}deg`);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLSpanElement>) => {
    if (e.pointerType !== "mouse") return;
    const box = e.currentTarget.getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const t = logoTilt({ x, y, left: box.left, top: box.top, width: box.width, height: box.height });
      setTilt(t.rx, t.ry);
    });
  };

  const onPointerLeave = () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    setTilt(0, 0);
  };

  React.useEffect(() => () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
  }, []);

  const src = SRC[variant];
  return (
    <span
      className={cn("cr-logo", className)}
      data-variant={variant}
      style={{ "--logo-src": `url("${src}")`, "--logo-w": `${w}px` } as React.CSSProperties}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
    >
      <span aria-hidden="true" className="cr-logo-shadow" />
      <span ref={body} className="cr-logo-body">
        {variant === "artist-mint" ? <span aria-hidden="true" className="cr-logo-field" /> : null}
        {/* eslint-disable-next-line @next/next/no-img-element -- static SVG brand asset, no optimisation needed */}
        <img src={src} width={w} height={h} alt={alt} className="cr-logo-img" draggable={false} />
        <span aria-hidden="true" className="cr-logo-sheen" />
      </span>
    </span>
  );
}
