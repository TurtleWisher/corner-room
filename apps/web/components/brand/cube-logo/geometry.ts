/**
 * Letter-cube geometry on the master canvas (1920 x 1920 units).
 *
 * Face positions were measured from the official logo (brand/logo/png/
 * corner-room-logo-indigo-on-sky-2000.png, scaled to 1920). The mark is an oblique cube:
 * the front face is flat, the left face is sheared vertically, the top face horizontally.
 * Seams of background separate the faces; no face is ever filled as a panel.
 */
import { glyph, glyphWeight, normalizeWord, isDrawable, type GlyphMetrics, type Poly } from "./glyphs";

export const CANVAS = 1920;

export const FRONT = {
  x0: 790,
  x1: 1499,
  line1: { y: 703, h: 293 },
  line2: { y: 1009, h: 389 },
  gap: 20,
  /** Stroke = 0.13 x line height (38 on line 1, 50 on line 2 in the master). */
  strokeRatio: 0.13,
  unitCap: 0.37,
} as const;

/** Top face: word laid out in a W x D box, then sheared so verticals lean up-left. */
export const TOP = {
  x: 436,
  y: 522,
  w: 714,
  d: 171,
  /** Horizontal shift per unit of depth (337 / 171). */
  shear: 1.971,
  gap: 20,
  /** Lid letters are wide and short: stroke 0.33 x depth, tuned against the official logo. */
  strokeRatio: 0.33,
  unitCap: 0.5,
} as const;

/** Left face: word rotated to read bottom-to-top, letter tops toward the outer edge, then sheared. */
export const LEFT = {
  x: 436,
  bottom: 1398,
  length: 691,
  d: 338,
  /** Vertical rise per unit of depth (177 / 338). */
  shear: 0.5237,
  gap: 20,
  strokeRatio: 0.13,
  unitCap: 0.37,
} as const;

/** Cube bounds, used for the unframed viewBox. */
export const CUBE_BOUNDS = { x0: 436, y0: 522, x1: 1499, y1: 1398 } as const;
export const UNFRAMED_PADDING = 40;

/** SVG matrix(a b c d e f) for each face: glyph-box coordinates to canvas coordinates. */
export const TOP_MATRIX = [1, 0, TOP.shear, 1, TOP.x, TOP.y] as const;
export const LEFT_MATRIX = [0, -1, 1, LEFT.shear, LEFT.x, LEFT.bottom - LEFT.d * LEFT.shear] as const;

/** Minimum letter width as a share of letter height before a word is too long to read. */
export const MIN_ASPECT_FRONT = 0.18;
export const MIN_ASPECT_SIDE = 0.12;

export interface LineLayout {
  /** Path data for the whole line, in the line's own coordinates (fill-rule evenodd). */
  d: string;
  /** Letter width / letter height of a standard letter. Below the minimum, the word is too long. */
  aspect: number;
  /** Characters dropped because no glyph exists. */
  dropped: string[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

function polyPath(p: Poly, dx: number, dy: number): string {
  return `M${p.map(([x, y]) => `${r2(x + dx)} ${r2(y + dy)}`).join("L")}Z`;
}

/**
 * Force-justify one word (or several words) into a box: the first glyph starts at x and the
 * last glyph ends at x + width. Gaps are fixed; letter widths come from glyph weights.
 */
export function layoutLine(
  text: string,
  x: number,
  y: number,
  width: number,
  height: number,
  opts: { gap: number; strokeRatio: number; unitCap?: number; barCap?: number },
): LineLayout {
  const chars = [...normalizeWord(text)];
  const dropped = chars.filter((c) => !isDrawable(c));
  const drawable = chars.filter(isDrawable);
  if (drawable.length === 0) return { d: "", aspect: 0, dropped };

  const weights = drawable.map(glyphWeight);
  const sum = weights.reduce((a, b) => a + b, 0);
  const unit = (width - opts.gap * (drawable.length - 1)) / sum;
  // Stroke follows the line height, but grows with wide letters so counters stay narrow slots
  // (about a quarter to a third of the letter) and short words keep the logo's weight.
  const s = Math.min(unit * (opts.unitCap ?? 0.37), Math.max(height * opts.strokeRatio, unit * 0.32));
  const metricsFor = (w: number): GlyphMetrics => ({
    w,
    h: height,
    s: Math.min(s, w * 0.42),
    t: Math.min(s * 1.05, height * (opts.barCap ?? 0.16)),
    m: s * 0.7,
    mid: height * 0.565,
  });

  let cx = x;
  const parts: string[] = [];
  drawable.forEach((ch, i) => {
    const w = unit * weights[i];
    const shape = ch === " " ? null : glyph(ch, metricsFor(w));
    if (shape) {
      parts.push(polyPath(shape.outer, cx, y));
      for (const hole of shape.holes) parts.push(polyPath(hole, cx, y));
    }
    cx += w + opts.gap;
  });
  return { d: parts.join(""), aspect: unit / height, dropped };
}

export interface CubeFacesInput {
  front: readonly [string, string];
  left: string;
  top: string;
}

export interface CubeGeometry {
  front: [LineLayout, LineLayout];
  left: LineLayout;
  top: LineLayout;
  warnings: string[];
}

export function buildCube({ front, left, top }: CubeFacesInput): CubeGeometry {
  const W = FRONT.x1 - FRONT.x0;
  const l1 = layoutLine(front[0], FRONT.x0, FRONT.line1.y, W, FRONT.line1.h, FRONT);
  const l2 = layoutLine(front[1], FRONT.x0, FRONT.line2.y, W, FRONT.line2.h, FRONT);
  const lf = layoutLine(left, 0, 0, LEFT.length, LEFT.d, LEFT);
  const tp = layoutLine(top, 0, 0, TOP.w, TOP.d, TOP);

  const warnings: string[] = [];
  const check = (label: string, l: LineLayout, min: number, word: string) => {
    if (l.dropped.length) warnings.push(`${label} "${word}": no glyph for ${JSON.stringify(l.dropped.join(""))}`);
    if (l.aspect > 0 && l.aspect < min) warnings.push(`${label} "${word}" is too long to stay legible (aspect ${l.aspect.toFixed(2)} < ${min})`);
  };
  check("front line 1", l1, MIN_ASPECT_FRONT, front[0]);
  check("front line 2", l2, MIN_ASPECT_FRONT, front[1]);
  check("left face", lf, MIN_ASPECT_SIDE, left);
  check("top face", tp, MIN_ASPECT_SIDE, top);
  return { front: [l1, l2], left: lf, top: tp, warnings };
}

/**
 * Choose the words for each face from real data: an event or release title plus one secondary
 * value (series, artist or city). Nothing is invented; every word comes from the inputs, one
 * word per line as in the logo.
 *
 * - Pool = title words in order, then secondary words not already in the title.
 * - Front line 1: the first pool word that stays legible on line 1.
 * - Front line 2: the next pool word that stays legible on the taller line 2 (else line 1 repeats,
 *   the way CORNER repeats across the logo's faces).
 * - Left face: the first secondary word not already on the front, else the first secondary word,
 *   else the title's first word.
 * - Top face (the lid, which fits long words best): the first title word not yet used, else the
 *   last unused pool word, else the secondary word again (as LOW / TIDE with SESSIONS on both
 *   sides), else front line 2 (as the logo repeats ROOM).
 *
 * Defaults reproduce the logo: ("Corner Room") gives CORNER / ROOM, left CORNER, top ROOM.
 */
export function cubeFaces(title: string, secondary?: string | null): CubeFacesInput {
  const words = normalizeWord(title).split(" ").filter(Boolean);
  const secAll = normalizeWord(secondary ?? "").split(" ").filter(Boolean);
  const sec = secAll.filter((w) => !words.includes(w));
  const pool = [...words, ...sec];
  if (pool.length === 0) return { front: ["", ""], left: "", top: "" };

  const W = FRONT.x1 - FRONT.x0;
  const fits = (word: string, h: number) => layoutLine(word, 0, 0, W, h, FRONT).aspect >= MIN_ASPECT_FRONT;
  // The front face is the title: only title words go there (the secondary word belongs on the
  // side and lid), so "Monsoon Frequencies" + "Dhaka" reads MONSOON / MONSOON, never MONSOON / DHAKA.
  // Secondary words reach the front only when no title word fits at all.
  const frontPool = words.some((w) => fits(w, FRONT.line1.h)) ? words : pool;
  const i1 = Math.max(0, frontPool.findIndex((w) => fits(w, FRONT.line1.h)));
  const rest = frontPool.slice(i1 + 1);
  const j = rest.findIndex((w) => fits(w, FRONT.line2.h));
  const line1 = frontPool[i1];
  const line2 = j >= 0 ? rest[j] : line1;
  const used = new Set([line1, line2]);

  const left = sec.find((w) => !used.has(w)) ?? secAll[0] ?? words[0] ?? line1;
  used.add(left);
  const top =
    words.find((w) => !used.has(w)) ??
    [...pool].reverse().find((w) => !used.has(w)) ??
    (secAll.length ? left : line2);

  return { front: [line1, line2], left, top };
}
