/*
 * Smoke lyrics (owner, 2026-11-01): a lyric line drawn as a cloud of soft particles that hold the
 * shape of the words, drift on a slow turbulent wind, and are blown apart by the mouse before
 * they gather back into letters.
 *
 * The wind is a coarse velocity grid laid over the line. The pointer pushes into it along its
 * path, the push spreads to neighbouring cells and dies away, and the particles ride it, so the
 * smoke keeps swirling after the pointer has passed. Each particle is also pulled home to its
 * place in the letters; the more it has been blown loose, the weaker the pull and the more the
 * ambient turbulence (which always rises a little, as smoke does) carries it. Pure maths, no DOM:
 * components/music/smoke-lyric.tsx samples the words and draws the particles.
 */

export type Measure = (text: string) => number;

function greedy(words: string[], measure: Measure, width: number): string[] {
  const rows: string[] = [];
  let row = "";
  for (const word of words) {
    const next = row ? `${row} ${word}` : word;
    if (row && measure(next) > width) {
      rows.push(row);
      row = word;
    } else {
      row = next;
    }
  }
  if (row) rows.push(row);
  return rows;
}

/**
 * The words in rows no wider than `maxWidth` (a single word wider than that keeps its own row),
 * as even in width as they can be for the fewest rows.
 */
export function wrapBalanced(text: string, measure: Measure, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const rows = greedy(words, measure, maxWidth);
  if (rows.length < 2) return rows;
  // The narrowest width that still needs no more rows than the greedy fill at full width.
  let lo = Math.max(...words.map(measure));
  let hi = maxWidth;
  for (let i = 0; i < 18 && hi - lo > 1; i++) {
    const mid = (lo + hi) / 2;
    if (greedy(words, measure, mid).length <= rows.length) hi = mid;
    else lo = mid;
  }
  return greedy(words, measure, hi);
}

/**
 * Particle homes: one per `step` pixels where the drawn words are inked (alpha of an RGBA buffer
 * over `threshold`), as x, y pairs. Each sample is nudged inside its cell so the grid never shows.
 */
export function sampleHomes(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
  step: number,
  threshold = 110,
  jitter: () => number = Math.random,
): Float32Array {
  const out: number[] = [];
  const s = Math.max(1, step);
  for (let y = s / 2; y < height; y += s) {
    for (let x = s / 2; x < width; x += s) {
      const px = Math.min(width - 1, Math.floor(x));
      const py = Math.min(height - 1, Math.floor(y));
      if (rgba[(py * width + px) * 4 + 3] > threshold) {
        out.push(x + (jitter() - 0.5) * s * 0.8, y + (jitter() - 0.5) * s * 0.8);
      }
    }
  }
  return Float32Array.from(out);
}

/** Wind grid cell size, in pixels. */
const CELL = 18;
/** Fastest the wind may blow, in pixels per frame, so a flick never explodes the smoke. */
const MAX_WIND = 26;

export class SmokeField {
  readonly width: number;
  readonly height: number;
  readonly count: number;
  readonly hx: Float32Array;
  readonly hy: Float32Array;
  readonly px: Float32Array;
  readonly py: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  /** How loose each particle has been blown, 0 (held in its letter) to 1 (free smoke). */
  readonly free: Float32Array;
  private readonly cols: number;
  private readonly rows: number;
  private wx: Float32Array;
  private wy: Float32Array;
  private tx: Float32Array;
  private ty: Float32Array;
  private readonly random: () => number;
  /** The whole line's looseness now, and where it is heading (the line's age sets it). */
  loose: number;
  private target: number;

  constructor(homes: Float32Array, width: number, height: number, opts: { loose?: number; random?: () => number } = {}) {
    this.width = width;
    this.height = height;
    this.count = homes.length >> 1;
    this.random = opts.random ?? Math.random;
    this.loose = this.target = opts.loose ?? 0;
    this.hx = new Float32Array(this.count);
    this.hy = new Float32Array(this.count);
    this.px = new Float32Array(this.count);
    this.py = new Float32Array(this.count);
    this.vx = new Float32Array(this.count);
    this.vy = new Float32Array(this.count);
    this.free = new Float32Array(this.count);
    // Loose lines start as a haze around the words and gather in.
    const spread = this.loose * Math.min(width, height) * 0.5;
    for (let i = 0; i < this.count; i++) {
      this.hx[i] = homes[i * 2];
      this.hy[i] = homes[i * 2 + 1];
      this.px[i] = this.hx[i] + (this.random() - 0.5) * spread;
      this.py[i] = this.hy[i] + (this.random() - 0.5) * spread;
      this.free[i] = this.loose;
    }
    this.cols = Math.max(1, Math.ceil(width / CELL));
    this.rows = Math.max(1, Math.ceil(height / CELL));
    const cells = this.cols * this.rows;
    this.wx = new Float32Array(cells);
    this.wy = new Float32Array(cells);
    this.tx = new Float32Array(cells);
    this.ty = new Float32Array(cells);
  }

  /** Where the whole line is heading: 0 the words, 1 all smoke. */
  setDissolve(target: number) {
    this.target = Math.min(1, Math.max(0, target));
  }

  /** The wind at a point, for tests and drawing. */
  windAt(x: number, y: number): [number, number] {
    const c = this.cell(x, y);
    return [this.wx[c], this.wy[c]];
  }

  private cell(x: number, y: number): number {
    const cx = Math.min(this.cols - 1, Math.max(0, Math.floor(x / CELL)));
    const cy = Math.min(this.rows - 1, Math.max(0, Math.floor(y / CELL)));
    return cy * this.cols + cx;
  }

  /**
   * The pointer moved from (x0, y0) to (x1, y1) in this line's pixels during one frame: push the
   * wind along the path within `radius`, strongest at its centre.
   */
  stir(x0: number, y0: number, x1: number, y1: number, radius: number) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.01) return;
    const r2 = radius * radius;
    // Splat along the path so a fast stroke leaves no gaps.
    const steps = Math.max(1, Math.ceil(dist / (radius * 0.5)));
    const per = 0.9 / steps;
    for (let s = 1; s <= steps; s++) {
      const sx = x0 + (dx * s) / steps;
      const sy = y0 + (dy * s) / steps;
      if (sx < -radius || sy < -radius || sx > this.width + radius || sy > this.height + radius) continue;
      const c0 = Math.max(0, Math.floor((sx - radius) / CELL));
      const c1 = Math.min(this.cols - 1, Math.floor((sx + radius) / CELL));
      const r0 = Math.max(0, Math.floor((sy - radius) / CELL));
      const r1 = Math.min(this.rows - 1, Math.floor((sy + radius) / CELL));
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const ox = (c + 0.5) * CELL - sx;
          const oy = (r + 0.5) * CELL - sy;
          const d2 = (ox * ox + oy * oy) / r2;
          if (d2 >= 1) continue;
          const w = (1 - d2) * (1 - d2) * per;
          const i = r * this.cols + c;
          // The push, plus a little curl around the stroke so it eddies rather than shoves.
          this.wx[i] = clamp(this.wx[i] + dx * w - oy * 0.02 * w * dist, MAX_WIND);
          this.wy[i] = clamp(this.wy[i] + dy * w + ox * 0.02 * w * dist, MAX_WIND);
        }
      }
    }
  }

  /** Advance `dt` frames (1 at 60 per second) at time `t` seconds. */
  step(dt: number, t: number) {
    this.loose += (this.target - this.loose) * (1 - Math.pow(0.975, dt));
    this.flowWind(dt);
    const decayFree = Math.pow(0.986, dt);
    const drag = Math.pow(0.9, dt);
    const wisp = 0.0012 * dt;
    for (let i = 0; i < this.count; i++) {
      let x = this.px[i];
      let y = this.py[i];
      const c = this.cell(x, y);
      const gx = this.wx[c];
      const gy = this.wy[c];
      // Strong wind tears particles loose; held ones slowly settle back.
      let free = this.free[i] * decayFree + (gx * gx + gy * gy) * 0.006 * dt;
      // Now and then a wisp curls up off the letters, as smoke does.
      if (this.random() < wisp) free = 1;
      free = Math.min(1, free);
      this.free[i] = free;
      const f = Math.max(free, this.loose);
      // Ambient turbulence: smooth, swirling, always rising a little.
      const ax = Math.sin(y * 0.045 + t * 0.9) * Math.cos(x * 0.021 - t * 0.5);
      const ay = Math.cos(x * 0.04 + t * 0.7) * Math.sin(y * 0.03 - t * 0.6) - 0.45;
      const amp = 0.04 + f * 0.32;
      const k = 0.045 * (1 - f) * (1 - f) + 0.0016;
      this.vx[i] = (this.vx[i] + (gx * 0.16 + ax * amp + (this.hx[i] - x) * k) * dt) * drag;
      this.vy[i] = (this.vy[i] + (gy * 0.16 + ay * amp + (this.hy[i] - y) * k) * dt) * drag;
      x += this.vx[i] * dt;
      y += this.vy[i] * dt;
      this.px[i] = x;
      this.py[i] = y;
    }
  }

  /** The wind spreads to its neighbours and dies away. */
  private flowWind(dt: number) {
    const { cols, rows, wx, wy, tx, ty } = this;
    const keep = Math.pow(0.93, dt);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const l = c > 0 ? i - 1 : i;
        const rt = c < cols - 1 ? i + 1 : i;
        const u = r > 0 ? i - cols : i;
        const d = r < rows - 1 ? i + cols : i;
        tx[i] = (wx[i] * 0.6 + (wx[l] + wx[rt] + wx[u] + wx[d]) * 0.1) * keep;
        ty[i] = (wy[i] * 0.6 + (wy[l] + wy[rt] + wy[u] + wy[d]) * 0.1) * keep;
      }
    }
    this.wx = tx;
    this.wy = ty;
    this.tx = wx;
    this.ty = wy;
  }

  /** How far the particles are, on average, from their places in the letters. */
  spread(): number {
    let sum = 0;
    for (let i = 0; i < this.count; i++) sum += Math.hypot(this.px[i] - this.hx[i], this.py[i] - this.hy[i]);
    return this.count ? sum / this.count : 0;
  }
}

function clamp(v: number, max: number): number {
  return v > max ? max : v < -max ? -max : v;
}
