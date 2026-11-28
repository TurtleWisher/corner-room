"use client";

/* The Wrap's year as a celebration (owner, 2026-11-28): "2026" lit like a fairground sign. Sikat
 * has no numerals (and the brand keeps it to words), so the digits are Archivo at its widest and
 * heaviest: a face of light (Lamp in the red room, Ice in the blue night), a stacked 3D extrusion in
 * the world's own shadow colours, a ring of bulbs chasing round every outline, a sheen sweeping
 * across, and sparkles twinkling around it. All of it is still under reduced motion. */

import { useId } from "react";
import type * as React from "react";

export const YEAR_PATTERN = /^(19|20)\d{2}$/;

/** Sparkles around the year: x, y (in the 0..W, 0..140 box), size, delay in seconds. */
const SPARKS: [number, number, number, number][] = [
  [10, 22, 13, 0],
  [388, 18, 16, 0.6],
  [372, 128, 10, 1.1],
  [22, 126, 9, 1.6],
  [200, 6, 8, 0.9],
  [300, 134, 7, 0.3],
];

function star(x: number, y: number, r: number): string {
  const k = r * 0.28;
  return `M${x} ${y - r} L${x + k} ${y - k} L${x + r} ${y} L${x + k} ${y + k} L${x} ${y + r} L${x - k} ${y + k} L${x - r} ${y} L${x - k} ${y - k} Z`;
}

export function YearMark({ year }: { year: string }) {
  const id = useId().replace(/:/g, "");
  const W = 400;
  const depth = [7, 6, 5, 4, 3, 2, 1];
  const text = (props: React.SVGProps<SVGTextElement>, key?: React.Key) => (
    <text key={key} x="14" y="114" textLength={W - 28} lengthAdjust="spacingAndGlyphs" className="wr-year-text" {...props}>
      {year}
    </text>
  );
  return (
    <svg className="wr-year" viewBox={`0 0 ${W} 140`} role="img" aria-label={year} focusable="false">
      <defs>
        <linearGradient id={`${id}f`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="wr-year-f0" />
          <stop offset="0.48" className="wr-year-f1" />
          <stop offset="0.52" className="wr-year-f2" />
          <stop offset="1" className="wr-year-f3" />
        </linearGradient>
        <linearGradient id={`${id}s`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0.85" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <clipPath id={`${id}c`}>{text({})}</clipPath>
      </defs>
      {/* The extrusion: the same digits stacked down and right, darkest at the back. */}
      {depth.map((d) => text({ transform: `translate(${d * 1.2} ${d * 1.5})`, className: "wr-year-text wr-year-side", style: { "--d": d } as React.CSSProperties }, d))}
      {text({ fill: `url(#${id}f)`, className: "wr-year-text wr-year-face" })}
      <g clipPath={`url(#${id}c)`}>
        <rect className="wr-year-sheen" x="-120" y="0" width="90" height="140" fill={`url(#${id}s)`} transform="skewX(-18)" />
      </g>
      {/* Bulbs: round dots of light running along every outline. */}
      {text({ className: "wr-year-text wr-year-bulbs" })}
      {SPARKS.map(([x, y, r, delay], i) => (
        <path key={i} d={star(x, y, r)} className="wr-year-spark" style={{ animationDelay: `${delay}s` }} />
      ))}
    </svg>
  );
}
