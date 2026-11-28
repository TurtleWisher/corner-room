/* The Wrap's story picture (owner, 2026-11-28, D-WRAP-01): 1080 x 1920, drawn on the device. The
 * carnival light is dithered into the world's four tones in big square cells (the same field as the
 * moving backdrop), marquee bulbs run round the edge, and one glass card carries the person's
 * music: their top songs with covers, or their numbers with their song of the year. Covers are
 * fetched as bytes so the canvas stays exportable. Sikat only for words, Archivo for numerals. */

import type { MyWrap } from "@/features/wraps/api";
import { DAY_PART_WORDS, WORLD_TONES, backdropLight, bayerAt, hexToRgb, shareTitle, toneAt, type WrapWorld } from "@/lib/wrap-view";
import { formatCount } from "@/lib/format/count";

export const SHARE_W = 1080;
export const SHARE_H = 1920;
export type ShareDesign = "songs" | "numbers";

export type ShareAssets = {
  covers: Map<string, CanvasImageSource>;
  logos: Record<WrapWorld, CanvasImageSource | null>;
  fonts: { display: string; ui: string; bangla: string };
};

const CELL = 12;

let small: HTMLCanvasElement | null = null;
let smallImg: ImageData | null = null;
const TONES: Record<WrapWorld, number[][]> = {
  ember: WORLD_TONES.ember.map(hexToRgb),
  sky: WORLD_TONES.sky.map(hexToRgb),
};

/** The dithered carnival light at time `t`. While `sweep` is under 1 the card's world rises from the
 * bottom over `previous`, each cell flipping on its own threshold: every cell is one world's tone. */
export function backdrop(ctx: CanvasRenderingContext2D, world: WrapWorld, t: number, previous: WrapWorld = world, sweep = 1): void {
  const cols = SHARE_W / CELL;
  const rows = SHARE_H / CELL;
  if (!small || !smallImg) {
    small = document.createElement("canvas");
    small.width = cols;
    small.height = rows;
    smallImg = small.getContext("2d")!.createImageData(cols, rows);
  }
  const data = smallImg.data;
  const pointer: [number, number] = [0.84 - 0.08 * Math.sin(t * 0.3), 0.12 + 0.05 * Math.cos(t * 0.23)];
  for (let y = 0; y < rows; y++) {
    const v = (y + 0.5) / rows;
    const reach = Math.max(0, Math.min(1, sweep * 1.6 - (1 - v) * 0.6));
    for (let x = 0; x < cols; x++) {
      const th = bayerAt(x, y);
      const tones = reach > th ? TONES[world] : TONES[previous];
      const c = tones[toneAt(backdropLight((x + 0.5) / cols, v, t, pointer), th)];
      const o = (y * cols + x) * 4;
      data[o] = c[0];
      data[o + 1] = c[1];
      data[o + 2] = c[2];
      data[o + 3] = 255;
    }
  }
  small.getContext("2d")!.putImageData(smallImg, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(small, 0, 0, SHARE_W, SHARE_H);
  ctx.imageSmoothingEnabled = true;
}

/** Marquee bulbs round the edge; `phase` steps the chase (the video moves it, the picture doesn't). */
export function bulbs(ctx: CanvasRenderingContext2D, world: WrapWorld, phase = 0): void {
  const glow = world === "ember" ? "#fcf475" : "#bbedfe";
  const inset = 36;
  const gap = 60;
  const at: [number, number][] = [];
  for (let x = inset; x <= SHARE_W - inset; x += gap) at.push([x, inset]);
  for (let y = inset + gap; y < SHARE_H - inset; y += gap) at.push([SHARE_W - inset, y]);
  for (let x = SHARE_W - inset; x >= inset; x -= gap) at.push([x, SHARE_H - inset]);
  for (let y = SHARE_H - inset - gap; y > inset; y -= gap) at.push([inset, y]);
  at.forEach(([x, y], i) => {
    const on = (i + phase) % 3 !== 0;
    ctx.beginPath();
    ctx.arc(x, y, on ? 9 : 7, 0, Math.PI * 2);
    ctx.fillStyle = on ? glow : "rgba(255,255,255,0.18)";
    ctx.shadowColor = on ? glow : "transparent";
    ctx.shadowBlur = on ? 24 : 0;
    ctx.fill();
  });
  ctx.shadowBlur = 0;
  ctx.shadowColor = "transparent";
}

const YEAR_RE = /^(19|20)\d{2}$/;
const YEAR_FACE: Record<WrapWorld, [string, string, string, string]> = {
  ember: ["#ffffff", "#fcf475", "#ffd24a", "#ff5a4e"],
  sky: ["#ffffff", "#bbedfe", "#8fe0f7", "#53c8ea"],
};
const YEAR_SIDE: Record<WrapWorld, [string, string]> = { ember: ["#b21f24", "#831515"], sky: ["#4f4789", "#2e2860"] };

function setStretch(ctx: CanvasRenderingContext2D, stretch: CanvasFontStretch): void {
  // Canvas font stretch (Chrome, Edge, Safari 17+); elsewhere the digits are simply narrower.
  try {
    ctx.fontStretch = stretch;
  } catch {
    /* not supported */
  }
}

/** The year lit like a fairground sign (owner, 2026-11-28), the same treatment as YearMark: wide
 * heavy Archivo, a stacked extrusion, a face of light, bulbs chasing round the outlines, a sheen
 * and sparkles. Draws with its left edge at x on the baseline y; returns its width. */
export function drawYear(ctx: CanvasRenderingContext2D, year: string, x: number, y: number, size: number, world: WrapWorld, ui: string, t = 0): number {
  ctx.save();
  setStretch(ctx, "ultra-expanded");
  ctx.font = `900 ${size}px ${ui}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  const w = ctx.measureText(year).width;
  const depth = Math.max(4, Math.round(size / 18));
  const [front, back] = YEAR_SIDE[world];
  for (let d = depth; d >= 1; d--) {
    ctx.fillStyle = d > depth / 2 ? back : front;
    ctx.fillText(year, x + d * 1.1, y + d * 1.4);
  }
  const f = YEAR_FACE[world];
  const face = ctx.createLinearGradient(0, y - size * 0.75, 0, y);
  face.addColorStop(0, f[0]);
  face.addColorStop(0.48, f[1]);
  face.addColorStop(0.52, f[2]);
  face.addColorStop(1, f[3]);
  ctx.shadowColor = f[1];
  ctx.shadowBlur = size * 0.25;
  ctx.fillStyle = face;
  ctx.fillText(year, x, y);
  ctx.shadowBlur = 0;
  // A sheen sweeping across every few seconds, only over the digits' face.
  const p = (t % 3.6) / 1.6;
  if (p <= 1) {
    const sx = x - size + p * (w + size * 2);
    const sheen = ctx.createLinearGradient(sx - size * 0.4, 0, sx + size * 0.4, 0);
    sheen.addColorStop(0, "rgba(255,255,255,0)");
    sheen.addColorStop(0.5, "rgba(255,255,255,0.75)");
    sheen.addColorStop(1, "rgba(255,255,255,0)");
    ctx.save();
    ctx.beginPath();
    ctx.rect(sx - size * 0.4, y - size, size * 0.8, size * 1.2);
    ctx.clip();
    ctx.fillStyle = sheen;
    ctx.fillText(year, x, y);
    ctx.restore();
  }
  // Bulbs: round dots of light running along the outlines.
  const gap = size * 0.1;
  ctx.setLineDash([0.01, gap]);
  ctx.lineDashOffset = -(t * gap * 1.2);
  ctx.lineCap = "round";
  ctx.lineWidth = size * 0.04;
  ctx.strokeStyle = f[0];
  ctx.shadowColor = f[1];
  ctx.shadowBlur = size * 0.06;
  ctx.strokeText(year, x, y);
  ctx.setLineDash([]);
  ctx.shadowBlur = 0;
  // Sparkles twinkling round it.
  const sparks: [number, number, number, number][] = [
    [-0.04, -0.82, 0.13, 0],
    [1.02, -0.88, 0.16, 0.6],
    [0.95, 0.12, 0.1, 1.1],
    [0.06, 0.14, 0.09, 1.6],
    [0.5, -1.0, 0.08, 0.9],
  ];
  for (const [sx, sy, r, delay] of sparks) {
    const k = 0.5 + 0.5 * Math.sin((t - delay) * 2.6);
    const rr = size * r * (0.4 + 0.7 * k);
    const cx = x + sx * w;
    const cy = y + sy * size;
    ctx.globalAlpha = 0.15 + 0.85 * k;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + t * 0.8;
      const rad = i % 2 === 0 ? rr : rr * 0.28;
      ctx.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
    }
    ctx.closePath();
    ctx.fillStyle = f[0];
    ctx.fill();
  }
  ctx.restore();
  return w + depth * 1.1;
}

export type MixedStyle = { display: string; ui: string; world: WrapWorld; ink: string; shadow?: string; t?: number; lineGap?: number };

function isYear(w: string): boolean {
  return YEAR_RE.test(w);
}

/** Display words in Sikat, numbers in Archivo and a year as the lit mark, wrapped to `maxW`.
 * Returns the baseline of the last line. With `shadow` set, words get the misregistered print
 * shadow (brand print detail). */
export function drawMixed(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, size: number, o: MixedStyle): number {
  const space = size * 0.28;
  // The year stands on its own line, about twice the words' size (owner, 2026-11-28).
  const yearSize = size * 1.9;
  const words = text.split(/\s+/).filter(Boolean);
  const font = (w: string) => (/\d/.test(w) ? `800 ${size * 0.92}px ${o.ui}` : `400 ${size}px ${o.display}`);
  const measure = (w: string): number => {
    if (isYear(w)) {
      ctx.save();
      setStretch(ctx, "ultra-expanded");
      ctx.font = `900 ${yearSize}px ${o.ui}`;
      const m = ctx.measureText(w).width + yearSize * 0.12;
      ctx.restore();
      return m;
    }
    ctx.font = font(w);
    return ctx.measureText(w).width;
  };
  const lines: string[][] = [[]];
  let width = 0;
  for (const w of words) {
    const mw = measure(w);
    const line = lines[lines.length - 1];
    if (isYear(w)) {
      if (line.length) lines.push([w]);
      else line.push(w);
      lines.push([]);
      width = 0;
      continue;
    }
    if (line.length && width + space + mw > maxW) {
      lines.push([w]);
      width = mw;
    } else {
      width += (line.length ? space : 0) + mw;
      line.push(w);
    }
  }
  let base = y;
  const kept = lines.filter((l) => l.length);
  kept.forEach((line, li) => {
    const yearLine = line.length === 1 && isYear(line[0]);
    const prevYear = li > 0 && kept[li - 1].length === 1 && isYear(kept[li - 1][0]);
    if (li > 0) base += yearLine ? yearSize * 0.98 : prevYear ? size * 1.25 : size * (o.lineGap ?? 1.08);
    else if (yearLine) base += yearSize * 0.4;
    let cx = x;
    for (const w of line) {
      if (isYear(w)) {
        cx += drawYear(ctx, w, cx, base, yearSize, o.world, o.ui, o.t ?? 0) + space;
        continue;
      }
      ctx.font = font(w);
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      if (o.shadow) {
        ctx.fillStyle = o.shadow;
        ctx.fillText(w, cx + 3, base + 3);
      }
      ctx.fillStyle = o.ink;
      ctx.fillText(w, cx, base);
      cx += ctx.measureText(w).width + space;
    }
  });
  return base;
}

export function cutRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, cut: number): void {
  ctx.beginPath();
  ctx.moveTo(x + cut, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + cut);
  ctx.closePath();
}

export function glass(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, world: WrapWorld): void {
  ctx.save();
  // A lift under the card (offset down, so nothing shows at the cut corner).
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = 80;
  ctx.shadowOffsetY = 40;
  cutRect(ctx, x, y, w, h, 44);
  ctx.fillStyle = world === "ember" ? "rgba(20,7,7,0.62)" : "rgba(18,15,38,0.62)";
  ctx.fill();
  ctx.restore();
  // Liquid glass: a light from the top-left edge fading down, and a bright rim.
  ctx.save();
  cutRect(ctx, x, y, w, h, 44);
  ctx.clip();
  const sheen = ctx.createLinearGradient(x, y, x + w * 0.6, y + h * 0.5);
  sheen.addColorStop(0, "rgba(255,255,255,0.16)");
  sheen.addColorStop(0.45, "rgba(255,255,255,0.03)");
  sheen.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = sheen;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
  const rim = ctx.createLinearGradient(x, y, x + w, y + h);
  rim.addColorStop(0, "rgba(255,255,255,0.55)");
  rim.addColorStop(0.5, "rgba(255,255,255,0.12)");
  rim.addColorStop(1, "rgba(255,255,255,0.3)");
  cutRect(ctx, x + 1, y + 1, w - 2, h - 2, 44);
  ctx.strokeStyle = rim;
  ctx.lineWidth = 2;
  ctx.stroke();
}

export function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

export function wrapLines(ctx: CanvasRenderingContext2D, text: string, max: number, lines: number): string[] {
  const words = text.split(/\s+/);
  const out: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width <= max || !line) line = next;
    else {
      out.push(line);
      line = w;
    }
  }
  if (line) out.push(line);
  if (out.length > lines) {
    const kept = out.slice(0, lines);
    kept[lines - 1] = fit(ctx, `${kept[lines - 1]} ${out.slice(lines).join(" ")}`, max);
    return kept;
  }
  return out;
}

export function cover(ctx: CanvasRenderingContext2D, img: CanvasImageSource | undefined, x: number, y: number, s: number, label: string, world: WrapWorld, font: string): void {
  ctx.save();
  cutRect(ctx, x, y, s, s, Math.round(s * 0.09));
  ctx.clip();
  if (img) ctx.drawImage(img, x, y, s, s);
  else {
    ctx.fillStyle = world === "ember" ? "#831515" : "#4f4789";
    ctx.fillRect(x, y, s, s);
    ctx.fillStyle = "#f6ece6";
    ctx.font = `700 ${Math.round(s * 0.36)}px ${font}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label.slice(0, 2).toUpperCase(), x + s / 2, y + s / 2);
  }
  ctx.restore();
}

/** Draws the whole picture. `world` is the card's world (one only). */
export function drawWrapShare(ctx: CanvasRenderingContext2D, wrap: MyWrap, design: ShareDesign, world: WrapWorld, a: ShareAssets, host: string | null): void {
  const s = wrap.stats;
  const { display, ui } = a.fonts;
  const ink = "#f6ece6";
  const muted = world === "ember" ? "#e9c9bd" : "#c9c4ec";
  const accent = world === "ember" ? "#fcf475" : "#53c8ea";
  backdrop(ctx, world, design === "songs" ? 2.1 : 5.3);
  bulbs(ctx, world);

  const logo = a.logos[world];
  if (logo) ctx.drawImage(logo, 90, 78, 144, 120);

  const cx = 90;
  const cy = 260;
  const cw = SHARE_W - 180;
  const ch = SHARE_H - 260 - 250;
  glass(ctx, cx, cy, cw, ch, world);

  const pad = 70;
  let y = cy + 120;
  ctx.textAlign = "left";
  ctx.fillStyle = accent;
  ctx.font = `700 32px ${ui}`;
  ctx.fillText(design === "songs" ? "MY TOP SONGS" : "MY YEAR IN MUSIC", cx + pad, y);
  y += 30;
  // "Samiul's 2026 Corner Room Wrap": the person's own name, the year as the lit mark.
  const title = shareTitle(wrap.person.first_name, wrap.season.year, wrap.season.sharing.show_name);
  y = drawMixed(ctx, title, cx + pad, y + 96, cw - pad * 2, 72, {
    display,
    ui,
    world,
    ink,
    shadow: world === "ember" ? "#b21f24" : "#4f4789",
    t: 0.8,
  });
  y += 56;

  if (design === "songs") {
    const rows = s.top_songs.slice(0, 5);
    const size = 128;
    for (const [i, song] of rows.entries()) {
      const top = y + i * (size + 40);
      ctx.fillStyle = accent;
      ctx.font = `800 64px ${ui}`;
      ctx.textAlign = "left";
      ctx.fillText(String(i + 1), cx + pad, top + size / 2 + 22);
      cover(ctx, a.covers.get(song.track_id), cx + pad + 70, top, size, song.title ?? "?", world, ui);
      const tx = cx + pad + 70 + size + 34;
      const tw = cx + cw - pad - tx;
      ctx.fillStyle = ink;
      ctx.font = `700 46px ${ui}`;
      ctx.fillText(fit(ctx, song.title ?? "Not available", tw), tx, top + 58);
      ctx.fillStyle = muted;
      ctx.font = `500 34px ${ui}`;
      ctx.fillText(fit(ctx, song.act ?? "", tw), tx, top + 104);
    }
    if (!rows.length) {
      ctx.fillStyle = muted;
      ctx.font = `500 40px ${ui}`;
      ctx.fillText("No songs heard yet", cx + pad, y + 60);
    }
  } else {
    ctx.fillStyle = ink;
    ctx.font = `800 200px ${ui}`;
    ctx.fillText(formatCount(s.minutes), cx + pad, y + 170);
    ctx.fillStyle = muted;
    ctx.font = `600 44px ${ui}`;
    ctx.fillText("minutes of music", cx + pad, y + 236);
    const tiles: [string, string][] = [
      [formatCount(s.songs), s.songs === 1 ? "song" : "songs"],
      [formatCount(s.acts), s.acts === 1 ? "act" : "acts"],
    ];
    if (s.day_part) tiles.push([DAY_PART_WORDS[s.day_part].name, "listener"]);
    const tw = (cw - pad * 2 - 30 * (tiles.length - 1)) / tiles.length;
    tiles.forEach(([v, l], i) => {
      const tx = cx + pad + i * (tw + 30);
      const ty = y + 300;
      // A sunken well.
      ctx.fillStyle = "rgba(0,0,0,0.28)";
      ctx.fillRect(tx, ty, tw, 170);
      ctx.strokeStyle = "rgba(255,255,255,0.12)";
      ctx.lineWidth = 2;
      ctx.strokeRect(tx + 1, ty + 1, tw - 2, 168);
      ctx.fillStyle = ink;
      ctx.font = `800 ${v.length > 8 ? 40 : 64}px ${ui}`;
      ctx.fillText(fit(ctx, v, tw - 40), tx + 22, ty + 90);
      ctx.fillStyle = muted;
      ctx.font = `600 30px ${ui}`;
      ctx.fillText(l, tx + 22, ty + 140);
    });
    const top = s.top_songs[0];
    if (top) {
      const size = 300;
      const ty = y + 540;
      cover(ctx, a.covers.get(top.track_id), cx + pad, ty, size, top.title ?? "?", world, ui);
      const tx = cx + pad + size + 40;
      const tww = cx + cw - pad - tx;
      ctx.fillStyle = accent;
      ctx.font = `700 30px ${ui}`;
      ctx.fillText("SONG OF THE YEAR", tx, ty + 60);
      ctx.fillStyle = ink;
      ctx.font = `700 50px ${ui}`;
      wrapLines(ctx, top.title ?? "Not available", tww, 2).forEach((line, i) => ctx.fillText(line, tx, ty + 130 + i * 58));
      ctx.fillStyle = muted;
      ctx.font = `500 36px ${ui}`;
      ctx.fillText(fit(ctx, top.act ?? "", tww), tx, ty + 270);
    }
  }

  if (wrap.season.sharing.show_link && host) {
    ctx.textAlign = "center";
    ctx.fillStyle = ink;
    ctx.font = `700 38px ${ui}`;
    ctx.fillText(`${host}/wrap`, SHARE_W / 2, SHARE_H - 150);
    ctx.fillStyle = muted;
    ctx.font = `500 28px ${ui}`;
    ctx.fillText("Get your own Corner Room Wrap", SHARE_W / 2, SHARE_H - 104);
  }
}

/** The covers the picture needs, as pixels the canvas may export. */
export async function loadShareCovers(trackIds: string[], url: (id: string) => string | null): Promise<Map<string, CanvasImageSource>> {
  const out = new Map<string, CanvasImageSource>();
  await Promise.all(
    trackIds.map(async (id) => {
      const src = url(id);
      if (!src) return;
      try {
        const res = await fetch(src);
        if (res.ok) out.set(id, await createImageBitmap(await res.blob()));
      } catch {
        /* the letter tile stands in */
      }
    }),
  );
  return out;
}
