/* The Wrap's story picture (owner, 2026-11-28, D-WRAP-01): 1080 x 1920, drawn on the device. The
 * carnival light is dithered into the world's four tones in big square cells (the same field as the
 * moving backdrop), marquee bulbs run round the edge, and one glass card carries the person's
 * music: their top songs with covers, or their numbers with their song of the year. Covers are
 * fetched as bytes so the canvas stays exportable. Sikat only for words, Archivo for numerals. */

import type { MyWrap } from "@/features/wraps/api";
import { DAY_PART_WORDS, WORLD_TONES, backdropLight, bayerAt, shareTitle, toneAt, type WrapWorld } from "@/lib/wrap-view";
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

function backdrop(ctx: CanvasRenderingContext2D, world: WrapWorld, seed: number): void {
  const cols = SHARE_W / CELL;
  const rows = SHARE_H / CELL;
  const small = document.createElement("canvas");
  small.width = cols;
  small.height = rows;
  const sctx = small.getContext("2d")!;
  const img = sctx.createImageData(cols, rows);
  const tones = WORLD_TONES[world].map((hex) => {
    const n = Number.parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  });
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const v = backdropLight((x + 0.5) / cols, (y + 0.5) / rows, seed, [0.84, 0.12]);
      const c = tones[toneAt(v, bayerAt(x, y))];
      const o = (y * cols + x) * 4;
      img.data[o] = c[0];
      img.data[o + 1] = c[1];
      img.data[o + 2] = c[2];
      img.data[o + 3] = 255;
    }
  }
  sctx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(small, 0, 0, SHARE_W, SHARE_H);
  ctx.imageSmoothingEnabled = true;
}

function bulbs(ctx: CanvasRenderingContext2D, world: WrapWorld): void {
  const glow = world === "ember" ? "#fcf475" : "#bbedfe";
  const inset = 36;
  const gap = 60;
  const at: [number, number][] = [];
  for (let x = inset; x <= SHARE_W - inset; x += gap) at.push([x, inset], [x, SHARE_H - inset]);
  for (let y = inset + gap; y < SHARE_H - inset; y += gap) at.push([inset, y], [SHARE_W - inset, y]);
  at.forEach(([x, y], i) => {
    const on = i % 3 !== 0;
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

function cutRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, cut: number): void {
  ctx.beginPath();
  ctx.moveTo(x + cut, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + cut);
  ctx.closePath();
}

function glass(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, world: WrapWorld): void {
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

function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, max: number, lines: number): string[] {
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

function cover(ctx: CanvasRenderingContext2D, img: CanvasImageSource | undefined, x: number, y: number, s: number, label: string, world: WrapWorld, font: string): void {
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
  ctx.textAlign = "right";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = ink;
  ctx.font = `700 40px ${ui}`;
  ctx.fillText(String(wrap.season.year), SHARE_W - 96, 158);

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
  ctx.font = `400 92px ${display}`;
  const title = shareTitle(wrap.person.first_name, wrap.season.year, wrap.season.sharing.show_name).replace(/\d+/g, "").replace(/\s+/g, " ").trim();
  for (const line of wrapLines(ctx, title, cw - pad * 2, 2)) {
    y += 96;
    // The misregistered print shadow on big display words (brand print detail).
    ctx.fillStyle = world === "ember" ? "#b21f24" : "#4f4789";
    ctx.fillText(line, cx + pad + 3, y + 3);
    ctx.fillStyle = ink;
    ctx.fillText(line, cx + pad, y);
  }
  y += 60;

  if (design === "songs") {
    const rows = s.top_songs.slice(0, 5);
    const size = 150;
    for (const [i, song] of rows.entries()) {
      const top = y + i * (size + 42);
      ctx.fillStyle = accent;
      ctx.font = `800 64px ${ui}`;
      ctx.textAlign = "left";
      ctx.fillText(String(i + 1), cx + pad, top + size / 2 + 22);
      cover(ctx, a.covers.get(song.track_id), cx + pad + 70, top, size, song.title ?? "?", world, ui);
      const tx = cx + pad + 70 + size + 34;
      const tw = cx + cw - pad - tx;
      ctx.fillStyle = ink;
      ctx.font = `700 46px ${ui}`;
      ctx.fillText(fit(ctx, song.title ?? "Not available", tw), tx, top + 66);
      ctx.fillStyle = muted;
      ctx.font = `500 34px ${ui}`;
      ctx.fillText(fit(ctx, song.act ?? "", tw), tx, top + 116);
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
