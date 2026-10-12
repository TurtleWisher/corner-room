/**
 * Corner Room letter-cube glyphs.
 *
 * Every glyph is ONE outer polygon plus counters cut out of it, rendered with fill-rule
 * "evenodd": a solid block with slices removed, which is the stencil quality of the official
 * logo. Only straight lines: no arcs, no curves, no fonts. Reference letterforms (C, O, R, N, E, M)
 * were measured from brand/logo (indigo-on-sky, 2000 px master).
 *
 * Coordinates are in the glyph's own box: x to the right, y down, (0,0) top-left.
 */

export type Pt = readonly [number, number];
export type Poly = readonly Pt[];

export interface GlyphShape {
  outer: Poly;
  holes: Poly[];
}

export interface GlyphMetrics {
  /** Box width and height. */
  w: number;
  h: number;
  /** Stem thickness (vertical strokes). */
  s: number;
  /** Top and bottom bar thickness. */
  t: number;
  /** Middle bar thickness. */
  m: number;
  /** Top of the middle band (R bowl bar, E middle arm), from the top of the box. */
  mid: number;
}

type GlyphFn = (g: GlyphMetrics) => GlyphShape;

const rect = (x0: number, y0: number, x1: number, y1: number): Poly => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

const box = ({ w, h }: GlyphMetrics) => rect(0, 0, w, h);

/** Width weights for force-justified layout (standard letter = 1). */
export const GLYPH_WEIGHT: Record<string, number> = {
  M: 1.66,
  W: 1.66,
  I: 0.45,
  "1": 0.6,
  " ": 0.5,
  "-": 0.6,
  ".": 0.4,
  ",": 0.4,
  "'": 0.4,
  "!": 0.45,
};

export function glyphWeight(ch: string): number {
  return GLYPH_WEIGHT[ch] ?? 1;
}

/* Letters. Proportions follow the reference: counters are slots w - 2s wide, the middle band
   sits at about 56 to 65% of the height, C's notch at 40 to 56%. */
const G: Record<string, GlyphFn> = {
  A: (g) => {
    const { w, h, s, t, m, mid } = g;
    return { outer: box(g), holes: [rect(s, t, w - s, mid), rect(s, mid + m, w - s, h)] };
  },
  B: (g) => {
    const { w, h, s, t, m, mid } = g;
    return {
      outer: box(g),
      holes: [rect(s, t, w - s, mid), rect(s, mid + m, w - s, h - t), rect(w - s * 0.45, mid, w, mid + m)],
    };
  },
  C: (g) => {
    const { w, h, s, t } = g;
    return { outer: box(g), holes: [rect(s, t, w - s, h - t), rect(w - s, h * 0.4, w, h * 0.565)] };
  },
  D: (g) => {
    const { w, h, s, t } = g;
    const c = s * 0.9;
    return {
      outer: [
        [0, 0],
        [w - c, 0],
        [w, c],
        [w, h - c],
        [w - c, h],
        [0, h],
      ],
      holes: [rect(s, t, w - s, h - t)],
    };
  },
  E: (g) => {
    const { w, h, s, t, m, mid } = g;
    return {
      outer: box(g),
      holes: [rect(s, t, w, mid), rect(w * 0.73, mid, w, mid + m), rect(s, mid + m, w, h - t)],
    };
  },
  F: (g) => {
    const { w, h, s, t, m, mid } = g;
    return { outer: box(g), holes: [rect(s, t, w, mid), rect(w * 0.73, mid, w, mid + m), rect(s, mid + m, w, h)] };
  },
  G: (g) => {
    const { w, h, s, t, m, mid } = g;
    // Slot, an opening on the upper right, and the inner spur refilled inside the slot.
    return {
      outer: box(g),
      holes: [rect(s, t, w - s, h - t), rect(w - s, h * 0.24, w, mid), rect(w * 0.5, mid, w - s, mid + m)],
    };
  },
  H: (g) => {
    const { w, h, s, m, mid } = g;
    return { outer: box(g), holes: [rect(s, 0, w - s, mid), rect(s, mid + m, w - s, h)] };
  },
  I: (g) => ({ outer: box(g), holes: [] }),
  J: (g) => {
    const { w, h, s, t } = g;
    return {
      outer: box(g),
      holes: [
        [
          [0, 0],
          [w - s, 0],
          [w - s, h - t],
          [s, h - t],
          [s, h * 0.62],
          [0, h * 0.62],
        ],
      ],
    };
  },
  K: (g) => {
    const { w, h, s } = g;
    const a = s * 1.1;
    return {
      outer: box(g),
      holes: [
        [
          [s, 0],
          [w - a, 0],
          [s, h * 0.47],
        ],
        [
          [w, h * 0.06],
          [w, h * 0.94],
          [s + a * 0.9, h * 0.5],
        ],
        [
          [s, h * 0.53],
          [s, h],
          [w - a, h],
        ],
      ],
    };
  },
  L: (g) => {
    const { w, h, s, t } = g;
    return { outer: box(g), holes: [rect(s, 0, w, h - t)] };
  },
  M: (g) => {
    const { w, h, s } = g;
    return {
      outer: box(g),
      holes: [
        [
          [w * 0.355, 0],
          [w * 0.645, 0],
          [w * 0.5, h * 0.56],
        ],
        [
          [s, h * 0.31],
          [s, h],
          [s + w * 0.15, h],
        ],
        [
          [w - s, h * 0.31],
          [w - s - w * 0.15, h],
          [w - s, h],
        ],
      ],
    };
  },
  N: (g) => {
    const { w, h, s } = g;
    return {
      outer: box(g),
      holes: [
        [
          [s, 0],
          [w - s, 0],
          [w - s, h * 0.48],
        ],
        [
          [s, h * 0.53],
          [s, h],
          [w - s, h],
        ],
      ],
    };
  },
  O: (g) => {
    const { w, h, s, t } = g;
    return { outer: box(g), holes: [rect(s, t, w - s, h - t)] };
  },
  P: (g) => {
    const { w, h, s, t, m, mid } = g;
    return { outer: box(g), holes: [rect(s, t, w - s, mid), rect(s, mid + m, w, h)] };
  },
  Q: (g) => {
    const { w, h, s, t } = g;
    return {
      outer: box(g),
      holes: [
        rect(s, t, w - s, h * 0.7),
        [
          [s, h * 0.7],
          [w - s, h * 0.7],
          [w - s, h - t * 0.55],
        ],
      ],
    };
  },
  R: (g) => {
    const { w, h, s, t, m, mid } = g;
    const L = s; // leg width
    const yb = mid + m; // bottom of the bowl bar
    return {
      outer: box(g),
      holes: [
        rect(s, t, w - s, mid),
        [
          [s, yb],
          [w - L, h],
          [s, h],
        ],
        [
          [s + L, yb],
          [w, yb],
          [w, h],
        ],
      ],
    };
  },
  S: (g) => {
    const { w, h, s, t, m, mid } = g;
    return { outer: box(g), holes: [rect(s, t, w, mid), rect(0, mid + m, w - s, h - t)] };
  },
  T: (g) => {
    const { w, h, s, t } = g;
    return { outer: box(g), holes: [rect(0, t, (w - s) / 2, h), rect((w + s) / 2, t, w, h)] };
  },
  U: (g) => {
    const { w, h, s, t } = g;
    return { outer: box(g), holes: [rect(s, 0, w - s, h - t)] };
  },
  V: (g) => {
    const { w, h, s } = g;
    const k = h * 0.58;
    return {
      outer: [
        [0, 0],
        [w, 0],
        [w, k],
        [w / 2 + s * 0.55, h],
        [w / 2 - s * 0.55, h],
        [0, k],
      ],
      holes: [
        [
          [s, 0],
          [w - s, 0],
          [w - s, k],
          [w / 2, h - s * 1.4],
          [s, k],
        ],
      ],
    };
  },
  W: (g) => {
    const { w, h, s } = g;
    return {
      outer: box(g),
      holes: [
        [
          [w * 0.355, h],
          [w * 0.5, h * 0.44],
          [w * 0.645, h],
        ],
        [
          [s, 0],
          [s + w * 0.15, 0],
          [s, h * 0.69],
        ],
        [
          [w - s - w * 0.15, 0],
          [w - s, 0],
          [w - s, h * 0.69],
        ],
      ],
    };
  },
  X: (g) => {
    const { w, h, s } = g;
    const e = s * 0.9;
    return {
      outer: box(g),
      holes: [
        [
          [e, 0],
          [w - e, 0],
          [w / 2, h * 0.44],
        ],
        [
          [e, h],
          [w / 2, h * 0.56],
          [w - e, h],
        ],
        [
          [0, h * 0.1],
          [w / 2 - s * 0.6, h * 0.5],
          [0, h * 0.9],
        ],
        [
          [w, h * 0.1],
          [w, h * 0.9],
          [w / 2 + s * 0.6, h * 0.5],
        ],
      ],
    };
  },
  Y: (g) => {
    const { w, h, s } = g;
    return {
      outer: box(g),
      holes: [
        [
          [s, 0],
          [w - s, 0],
          [w - s, h * 0.34],
          [w / 2, h * 0.5],
          [s, h * 0.34],
        ],
        [
          [0, h * 0.47],
          [w / 2 - s / 2, h * 0.64],
          [w / 2 - s / 2, h],
          [0, h],
        ],
        [
          [w, h * 0.47],
          [w, h],
          [w / 2 + s / 2, h],
          [w / 2 + s / 2, h * 0.64],
        ],
      ],
    };
  },
  Z: (g) => {
    const { w, h, s, t } = g;
    const a = s * 1.4;
    return {
      outer: box(g),
      holes: [
        [
          [0, t],
          [w - a, t],
          [0, h * 0.82],
        ],
        [
          [w, h * 0.18],
          [w, h - t],
          [a, h - t],
        ],
      ],
    };
  },

  /* Digits: built on the same slots and bands. */
  "0": (g) => G.O(g),
  "1": (g) => {
    const { w, h, s } = g;
    return { outer: box(g), holes: [rect(0, h * 0.2, w - s, h)] };
  },
  "2": (g) => {
    const { w, h, s, t, m, mid } = g;
    return { outer: box(g), holes: [rect(0, t, w - s, mid), rect(s, mid + m, w, h - t)] };
  },
  "3": (g) => {
    const { w, h, s, t, m, mid } = g;
    return { outer: box(g), holes: [rect(0, t, w - s, mid), rect(0, mid, w * 0.3, mid + m), rect(0, mid + m, w - s, h - t)] };
  },
  "4": (g) => {
    const { w, h, s, m, mid } = g;
    return { outer: box(g), holes: [rect(s, 0, w - s, mid), rect(0, mid + m, w - s, h)] };
  },
  "5": (g) => G.S(g),
  "6": (g) => {
    const { w, h, s, t, m, mid } = g;
    return { outer: box(g), holes: [rect(s, t, w, mid), rect(s, mid + m, w - s, h - t)] };
  },
  "7": (g) => {
    const { w, h, s, t } = g;
    return { outer: box(g), holes: [rect(0, t, w - s, h)] };
  },
  "8": (g) => {
    const { w, h, s, t, m, mid } = g;
    return { outer: box(g), holes: [rect(s, t, w - s, mid), rect(s, mid + m, w - s, h - t)] };
  },
  "9": (g) => {
    const { w, h, s, t, m, mid } = g;
    return { outer: box(g), holes: [rect(s, t, w - s, mid), rect(0, mid + m, w - s, h - t)] };
  },

  /* Punctuation that appears in real titles. */
  "-": (g) => ({ outer: rect(0, g.mid, g.w, g.mid + g.m), holes: [] }),
  ".": (g) => ({ outer: rect(0, g.h - g.t * 1.2, g.w, g.h), holes: [] }),
  ",": (g) => ({
    outer: [
      [0, g.h - g.t * 1.2],
      [g.w, g.h - g.t * 1.2],
      [g.w, g.h],
      [g.w * 0.4, g.h + g.t * 0.6],
      [g.w * 0.4, g.h],
      [0, g.h],
    ],
    holes: [],
  }),
  "'": (g) => ({ outer: rect(0, 0, g.w, g.h * 0.24), holes: [] }),
  "!": (g) => ({ outer: box(g), holes: [rect(0, g.h * 0.68, g.w, g.h - g.t * 1.1)] }),
};

/** Characters the glyph set can draw. Space is layout only. */
export function isDrawable(ch: string): boolean {
  return ch === " " || ch in G;
}

/** Uppercase, strip diacritics (é becomes E), collapse whitespace. Curly apostrophes become straight. */
export function normalizeWord(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

/** True when every character can be drawn as geometry (Latin letters, digits, basic punctuation). */
export function canDrawWord(word: string): boolean {
  return [...normalizeWord(word)].every(isDrawable);
}

export function glyph(ch: string, g: GlyphMetrics): GlyphShape | null {
  const fn = G[ch];
  return fn ? fn(g) : null;
}

export const SUPPORTED_GLYPHS = Object.keys(G);
