/* The whole Wrap as a story video (owner, 2026-11-28): every card of the person's Wrap in order,
 * 1080 x 1920, each frame a pure function of time so the preview and the recording match. The
 * dithered carnival light moves and flips world card by card (never blended), the bulbs chase,
 * the glass card rises in, numbers count up, bars and clock grow, and the year is the lit mark.
 * Drawn on the device; only real numbers from the API. */

import type { MyWrap, WrapCardKey } from "@/features/wraps/api";
import { formatCount } from "@/lib/format/count";
import { SHARE_H, SHARE_W, backdrop, bulbs, cover, cutRect, drawMixed, fit, glass, type ShareAssets } from "@/lib/wrap-share-draw";
import {
  CARD_WORDS,
  DAY_PART_WORDS,
  barHeights,
  biggestMonth,
  countUp,
  easeOut,
  fillIn,
  headlineFor,
  hourLabel,
  monthLabel,
  segmentAt,
  shareTitle,
  videoTimeline,
  worldFor,
  type FillContext,
  type VideoSegment,
  type WrapWorld,
} from "@/lib/wrap-view";

export type VideoAssets = ShareAssets & { acts: Map<string, CanvasImageSource> };

export type WrapVideoPlan = { segments: VideoSegment[]; total: number; worlds: WrapWorld[] };

/** The cards the video tells: the person's own, in staff's order. */
export function videoPlan(wrap: MyWrap): WrapVideoPlan {
  const keys = (wrap.enough ? wrap.cards : []).map((c) => c.key);
  const { segments, total } = videoTimeline(keys.length ? keys : (["INTRO"] as WrapCardKey[]));
  return { segments, total, worlds: segments.map((_, i) => worldFor(wrap.season.look, i)) };
}

const CX = 90;
const CY = 270;
const CW = SHARE_W - 180;
const CH = SHARE_H - 270 - 250;
const PAD = 70;
const SWEEP_S = 0.55;

type Ctx = {
  ctx: CanvasRenderingContext2D;
  wrap: MyWrap;
  a: VideoAssets;
  world: WrapWorld;
  local: number;
  t: number;
  ink: string;
  muted: string;
  accent: string;
  fill: FillContext;
};

/** How far a part has arrived (0..1), starting `delay` seconds into the card. */
const arrive = (c: Ctx, delay: number, dur = 0.6) => easeOut((c.local - delay) / dur);

function label(c: Ctx, text: string, x: number, y: number, size = 30, color = c.muted): void {
  c.ctx.fillStyle = color;
  c.ctx.font = `600 ${size}px ${c.a.fonts.ui}`;
  c.ctx.textAlign = "left";
  c.ctx.fillText(text, x, y);
}

function big(c: Ctx, value: string, x: number, y: number, size: number): number {
  const { ctx } = c;
  ctx.font = `800 ${size}px ${c.a.fonts.ui}`;
  ctx.textAlign = "left";
  const g = ctx.createLinearGradient(0, y - size, 0, y);
  g.addColorStop(0, "#ffffff");
  g.addColorStop(0.5, c.ink);
  g.addColorStop(1, c.accent);
  ctx.shadowColor = c.accent;
  ctx.shadowBlur = size * 0.18;
  ctx.fillStyle = g;
  ctx.fillText(value, x, y);
  ctx.shadowBlur = 0;
  return ctx.measureText(value).width;
}

function wells(c: Ctx, items: [string, string][], x: number, y: number, w: number, delay: number): void {
  const { ctx } = c;
  const gap = 26;
  const tw = (w - gap * (items.length - 1)) / items.length;
  items.forEach(([v, l], i) => {
    const k = arrive(c, delay + i * 0.12);
    if (k <= 0) return;
    ctx.save();
    ctx.globalAlpha = k;
    const tx = x + i * (tw + gap);
    const ty = y + (1 - k) * 30;
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.fillRect(tx, ty, tw, 170);
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 2;
    ctx.strokeRect(tx + 1, ty + 1, tw - 2, 168);
    ctx.fillStyle = c.ink;
    ctx.font = `800 ${v.length > 8 ? 40 : 62}px ${c.a.fonts.ui}`;
    ctx.fillText(fit(ctx, v, tw - 40), tx + 22, ty + 90);
    label(c, l, tx + 22, ty + 138, 28);
    ctx.restore();
  });
}

function songRow(c: Ctx, i: number, song: MyWrap["stats"]["top_songs"][number], x: number, y: number, w: number, size: number): void {
  const { ctx } = c;
  ctx.fillStyle = c.accent;
  ctx.font = `800 ${Math.round(size * 0.42)}px ${c.a.fonts.ui}`;
  ctx.textAlign = "left";
  ctx.fillText(String(i + 1), x, y + size / 2 + size * 0.15);
  cover(ctx, c.a.covers.get(song.track_id), x + size * 0.5, y, size, song.title ?? "?", c.world, c.a.fonts.ui);
  const tx = x + size * 1.5 + 30;
  const tw = x + w - tx;
  ctx.fillStyle = c.ink;
  ctx.font = `700 ${Math.round(size * 0.3)}px ${c.a.fonts.ui}`;
  ctx.fillText(fit(ctx, song.title ?? "Not available", tw), tx, y + size * 0.45);
  ctx.fillStyle = c.muted;
  ctx.font = `500 ${Math.round(size * 0.22)}px ${c.a.fonts.ui}`;
  ctx.fillText(fit(ctx, song.act ?? "", tw), tx, y + size * 0.8);
}

function circle(c: Ctx, img: CanvasImageSource | undefined, name: string, cx: number, cy: number, r: number): void {
  const { ctx } = c;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  if (img) ctx.drawImage(img, cx - r, cy - r, r * 2, r * 2);
  else {
    ctx.fillStyle = c.world === "ember" ? "#831515" : "#4f4789";
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    ctx.fillStyle = "#f6ece6";
    ctx.font = `700 ${Math.round(r * 0.7)}px ${c.a.fonts.ui}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(name.slice(0, 2).toUpperCase(), cx, cy);
    ctx.textBaseline = "alphabetic";
  }
  ctx.restore();
  ctx.beginPath();
  ctx.arc(cx, cy, r + 4, 0, Math.PI * 2);
  ctx.strokeStyle = c.accent;
  ctx.lineWidth = 6;
  ctx.shadowColor = c.accent;
  ctx.shadowBlur = 30;
  ctx.stroke();
  ctx.shadowBlur = 0;
}

/** Each card's own part, below its headline, from `y` down. */
const BODIES: Record<WrapCardKey, (c: Ctx, y: number) => void> = {
  INTRO: (c, y) => {
    const k = arrive(c, 0.4);
    c.ctx.globalAlpha = k;
    const end = drawMixed(c.ctx, fillIn(c.wrap.season.tagline, c.fill), CX + PAD, y + 90, CW - PAD * 2, 86, {
      display: c.a.fonts.display,
      ui: c.a.fonts.ui,
      world: c.world,
      ink: c.accent,
      t: c.t,
    });
    if (c.wrap.season.intro) {
      c.ctx.fillStyle = c.muted;
      c.ctx.font = `500 40px ${c.a.fonts.ui}`;
      wrapText(c, fillIn(c.wrap.season.intro, c.fill), CX + PAD, end + 110, CW - PAD * 2, 54, 5);
    }
    c.ctx.globalAlpha = 1;
  },
  MINUTES: (c, y) => {
    const s = c.wrap.stats;
    big(c, formatCount(countUp(s.minutes, c.local - 0.3)), CX + PAD, y + 230, 210);
    label(c, "minutes of music", CX + PAD, y + 300, 44);
    wells(c, [[formatCount(s.listens), "listens"], [formatCount(s.songs), "songs"], [formatCount(s.acts), "acts"]], CX + PAD, y + 380, CW - PAD * 2, 0.7);
  },
  TOP_SONG: (c, y) => {
    const song = c.wrap.stats.top_songs[0];
    const { ctx } = c;
    const size = 560;
    const k = arrive(c, 0.2, 0.8);
    // The picture CD sliding out and turning behind the cover.
    const dx = CX + PAD + size * 0.55 + k * size * 0.32;
    const dy = y + 60 + size / 2;
    ctx.save();
    ctx.translate(dx, dy);
    ctx.rotate(c.local * 1.2);
    const r = size * 0.44;
    const g = ctx.createConicGradient(0, 0, 0);
    ["#e9e9ee", "#9ee7ff", "#f6ece6", "#fcf475", "#ffb3ab", "#c9c4ec", "#e9e9ee"].forEach((col, i, arr) => g.addColorStop(i / (arr.length - 1), col));
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.08, 0, Math.PI * 2);
    ctx.fillStyle = "#140707";
    ctx.fill();
    ctx.restore();
    cover(ctx, c.a.covers.get(song.track_id), CX + PAD, y + 60, size, song.title ?? "?", c.world, c.a.fonts.ui);
    const ty = y + 60 + size + 90;
    ctx.globalAlpha = arrive(c, 0.6);
    ctx.fillStyle = c.ink;
    ctx.font = `800 64px ${c.a.fonts.ui}`;
    ctx.fillText(fit(ctx, song.title ?? "Not available", CW - PAD * 2), CX + PAD, ty);
    label(c, song.act ?? "", CX + PAD, ty + 60, 42);
    label(c, `${formatCount(song.listens)} ${song.listens === 1 ? "listen" : "listens"} · ${formatCount(song.minutes)} minutes`, CX + PAD, ty + 120, 34);
    ctx.globalAlpha = 1;
  },
  TOP_SONGS: (c, y) => {
    const rows = c.wrap.stats.top_songs.slice(0, 6);
    rows.forEach((song, i) => {
      const k = arrive(c, 0.2 + i * 0.15);
      if (k <= 0) return;
      c.ctx.save();
      c.ctx.globalAlpha = k;
      songRow(c, i, song, CX + PAD + (1 - k) * 60, y + 40 + i * 175, CW - PAD * 2, 140);
      c.ctx.restore();
    });
  },
  TOP_ACTS: (c, y) => {
    const [first, ...rest] = c.wrap.stats.top_acts;
    const k = arrive(c, 0.2, 0.8);
    c.ctx.globalAlpha = k;
    circle(c, c.a.acts.get(first.act_id), first.name ?? "?", SHARE_W / 2, y + 250, 200 * (0.7 + 0.3 * k));
    c.ctx.fillStyle = c.ink;
    c.ctx.font = `800 62px ${c.a.fonts.ui}`;
    c.ctx.textAlign = "center";
    c.ctx.fillText(fit(c.ctx, first.name ?? "Not available", CW - PAD * 2), SHARE_W / 2, y + 540);
    c.ctx.fillStyle = c.muted;
    c.ctx.font = `500 36px ${c.a.fonts.ui}`;
    c.ctx.fillText(`${formatCount(first.listens)} listens · ${formatCount(first.songs)} songs`, SHARE_W / 2, y + 595);
    c.ctx.textAlign = "left";
    c.ctx.globalAlpha = 1;
    rest.slice(0, 4).forEach((act, i) => {
      const kk = arrive(c, 0.7 + i * 0.12);
      if (kk <= 0) return;
      c.ctx.globalAlpha = kk;
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = CX + PAD + col * ((CW - PAD * 2) / 2);
      const yy = y + 700 + row * 130;
      circle(c, c.a.acts.get(act.act_id), act.name ?? "?", x + 45, yy, 45);
      c.ctx.fillStyle = c.accent;
      c.ctx.font = `800 36px ${c.a.fonts.ui}`;
      c.ctx.fillText(String(i + 2), x + 110, yy + 12);
      c.ctx.fillStyle = c.ink;
      c.ctx.font = `700 34px ${c.a.fonts.ui}`;
      c.ctx.fillText(fit(c.ctx, act.name ?? "", (CW - PAD * 2) / 2 - 170), x + 150, yy + 12);
      c.ctx.globalAlpha = 1;
    });
  },
  FAN_RANK: (c, y) => {
    const r = c.wrap.stats.fan_rank!;
    const { ctx } = c;
    const fill = Math.max(0.06, 1 - (r.top_percent - 1) / 100) * easeOut((c.local - 0.3) / 1.2);
    const tx = CX + PAD;
    const th = 700;
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(tx, y + 60, 120, th);
    const g = ctx.createLinearGradient(0, y + 60 + th, 0, y + 60);
    g.addColorStop(0, c.world === "ember" ? "#b21f24" : "#4f4789");
    g.addColorStop(1, c.accent);
    ctx.fillStyle = g;
    ctx.fillRect(tx, y + 60 + th * (1 - fill), 120, th * fill);
    ctx.beginPath();
    ctx.arc(tx + 60, y + 40, 34, 0, Math.PI * 2);
    ctx.fillStyle = fill > 0.9 ? "#ffffff" : c.accent;
    ctx.shadowColor = c.accent;
    ctx.shadowBlur = fill > 0.9 ? 60 : 20;
    ctx.fill();
    ctx.shadowBlur = 0;
    label(c, "TOP", tx + 180, y + 260, 52, c.ink);
    big(c, `${r.top_percent}%`, tx + 180, y + 470, 220);
    ctx.fillStyle = c.muted;
    ctx.font = `500 38px ${c.a.fonts.ui}`;
    wrapText(c, `of everyone who listened to ${r.act ?? "this act"}. Number ${formatCount(r.rank)} of ${formatCount(r.listeners)} listeners.`, tx + 180, y + 560, CW - PAD * 2 - 180, 52, 5);
  },
  CLOCK: (c, y) => {
    const s = c.wrap.stats;
    const { ctx } = c;
    const cx = SHARE_W / 2;
    const cy = y + 360;
    const hs = barHeights(s.hours);
    ctx.beginPath();
    ctx.arc(cx, cy, 170, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.fill();
    hs.forEach((h, i) => {
      const k = arrive(c, 0.2 + i * 0.03, 0.5);
      const a = (i / 24) * Math.PI * 2 - Math.PI / 2;
      const r1 = 188 + 14 + h * 150 * k;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * 188, cy + Math.sin(a) * 188);
      ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      ctx.lineCap = "round";
      ctx.lineWidth = 20;
      ctx.strokeStyle = i === s.peak_hour ? c.accent : "rgba(246,236,230,0.55)";
      ctx.shadowColor = i === s.peak_hour ? c.accent : "transparent";
      ctx.shadowBlur = i === s.peak_hour ? 30 : 0;
      ctx.stroke();
    });
    ctx.shadowBlur = 0;
    ctx.textAlign = "center";
    ctx.fillStyle = c.ink;
    ctx.font = `800 70px ${c.a.fonts.ui}`;
    ctx.fillText(hourLabel(s.peak_hour ?? 0), cx, cy + 10);
    ctx.fillStyle = c.muted;
    ctx.font = `600 32px ${c.a.fonts.ui}`;
    ctx.fillText("your hour", cx, cy + 60);
    if (s.day_part) {
      ctx.globalAlpha = arrive(c, 0.9);
      ctx.fillStyle = c.ink;
      ctx.font = `800 64px ${c.a.fonts.ui}`;
      ctx.fillText(DAY_PART_WORDS[s.day_part].name, cx, y + 820);
      ctx.fillStyle = c.muted;
      ctx.font = `500 36px ${c.a.fonts.ui}`;
      ctx.fillText(DAY_PART_WORDS[s.day_part].line, cx, y + 880);
      ctx.globalAlpha = 1;
    }
    ctx.textAlign = "left";
  },
  MONTHS: (c, y) => {
    const s = c.wrap.stats;
    const { ctx } = c;
    const hs = barHeights(s.months.map((m) => m.listens));
    const best = biggestMonth(s.months);
    const w = CW - PAD * 2;
    const gap = 10;
    const bw = (w - gap * (hs.length - 1)) / hs.length;
    const h = 620;
    hs.forEach((v, i) => {
      const k = arrive(c, 0.2 + i * 0.06, 0.6);
      const bh = Math.max(8, v * h * k);
      const x = CX + PAD + i * (bw + gap);
      const isBest = best?.month === s.months[i].month;
      for (let yy = y + 60 + h - bh; yy < y + 60 + h; yy += 18) {
        ctx.fillStyle = isBest ? c.accent : "rgba(246,236,230,0.7)";
        ctx.fillRect(x, yy, bw, 12);
      }
      ctx.fillStyle = c.muted;
      ctx.font = `700 28px ${c.a.fonts.ui}`;
      ctx.textAlign = "center";
      ctx.fillText(monthLabel(s.months[i].month).slice(0, 1), x + bw / 2, y + 60 + h + 46);
      ctx.textAlign = "left";
    });
    if (best) {
      ctx.globalAlpha = arrive(c, 1.1);
      ctx.fillStyle = c.muted;
      ctx.font = `500 40px ${c.a.fonts.ui}`;
      wrapText(c, `${monthLabel(best.month)} was your biggest month, with ${formatCount(best.listens)} listens.`, CX + PAD, y + 860, w, 54, 3);
      ctx.globalAlpha = 1;
    }
  },
  STREAK: (c, y) => {
    const s = c.wrap.stats;
    const days = s.streak?.days ?? 0;
    const end = big(c, formatCount(countUp(days, c.local - 0.3)), CX + PAD, y + 240, 230);
    label(c, days === 1 ? "day" : "days", CX + PAD + end + 24, y + 240, 52);
    const n = Math.min(days, 28);
    for (let i = 0; i < n; i++) {
      const k = arrive(c, 0.5 + i * 0.05, 0.3);
      if (k <= 0) continue;
      const x = CX + PAD + (i % 7) * 110 + 30;
      const yy = y + 360 + Math.floor(i / 7) * 100;
      c.ctx.beginPath();
      c.ctx.arc(x, yy, 26 * k, 0, Math.PI * 2);
      c.ctx.fillStyle = c.accent;
      c.ctx.shadowColor = c.accent;
      c.ctx.shadowBlur = 30;
      c.ctx.fill();
    }
    c.ctx.shadowBlur = 0;
    if (s.busiest_day) {
      c.ctx.fillStyle = c.muted;
      c.ctx.font = `500 38px ${c.a.fonts.ui}`;
      const day = new Date(`${s.busiest_day.day}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "long" });
      wrapText(c, `Your busiest day was ${day}, with ${formatCount(s.busiest_day.listens)} listens.`, CX + PAD, y + 820, CW - PAD * 2, 52, 3);
    }
  },
  DISCOVERY: (c, y) => {
    const s = c.wrap.stats;
    big(c, formatCount(countUp(s.new_songs, c.local - 0.3)), CX + PAD, y + 240, 230);
    label(c, s.new_songs === 1 ? "new song" : "new songs", CX + PAD, y + 310, 48);
    if (s.new_acts) {
      c.ctx.globalAlpha = arrive(c, 0.8);
      c.ctx.fillStyle = c.muted;
      c.ctx.font = `500 40px ${c.a.fonts.ui}`;
      const like = s.new_act_names.length ? `, like ${s.new_act_names.join(", ")}` : "";
      wrapText(c, `and ${formatCount(s.new_acts)} ${s.new_acts === 1 ? "act" : "acts"} you heard for the first time${like}.`, CX + PAD, y + 420, CW - PAD * 2, 54, 5);
      c.ctx.globalAlpha = 1;
    }
  },
  COLLECTION: (c, y) => {
    const b = c.wrap.stats.bought;
    const items: [string, string][] = [
      [formatCount(b.songs), b.songs === 1 ? "song" : "songs"],
      [formatCount(b.releases), b.releases === 1 ? "release" : "releases"],
    ];
    if (b.preorders) items.push([formatCount(b.preorders), "pre-orders"]);
    wells(c, items, CX + PAD, y + 80, CW - PAD * 2, 0.3);
    if (b.first?.title) {
      c.ctx.globalAlpha = arrive(c, 0.9);
      c.ctx.fillStyle = c.muted;
      c.ctx.font = `500 40px ${c.a.fonts.ui}`;
      wrapText(c, `It started with ${b.first.title}.`, CX + PAD, y + 360, CW - PAD * 2, 54, 3);
      c.ctx.globalAlpha = 1;
    }
  },
  EVENTS: (c, y) => {
    const e = c.wrap.stats.events;
    wells(
      c,
      [
        [formatCount(e.events), e.events === 1 ? "event" : "events"],
        [formatCount(e.attended), "went to"],
        [formatCount(e.tickets), e.tickets === 1 ? "ticket" : "tickets"],
      ],
      CX + PAD,
      y + 80,
      CW - PAD * 2,
      0.3,
    );
    e.list.slice(0, 4).forEach((ev, i) => {
      const k = arrive(c, 0.8 + i * 0.15);
      if (k <= 0) return;
      c.ctx.globalAlpha = k;
      c.ctx.fillStyle = c.ink;
      c.ctx.font = `700 42px ${c.a.fonts.ui}`;
      c.ctx.fillText(fit(c.ctx, ev.title, CW - PAD * 2), CX + PAD, y + 360 + i * 110);
      label(c, new Date(ev.starts_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "Asia/Dhaka" }), CX + PAD, y + 405 + i * 110, 30);
      c.ctx.globalAlpha = 1;
    });
  },
  GIFTS: (c, y) => {
    const g = c.wrap.stats.gifts;
    wells(
      c,
      [
        [formatCount(g.given), g.given === 1 ? "gift you gave" : "gifts you gave"],
        [formatCount(g.received), g.received === 1 ? "gift to you" : "gifts to you"],
      ],
      CX + PAD,
      y + 80,
      CW - PAD * 2,
      0.3,
    );
  },
  SUMMARY: (c, y) => {
    const s = c.wrap.stats;
    const tiles: [string, string][] = [
      [formatCount(s.minutes), "minutes"],
      [formatCount(s.songs), "songs"],
    ];
    if (s.day_part) tiles.push([DAY_PART_WORDS[s.day_part].name, "listener"]);
    wells(c, tiles, CX + PAD, y + 30, CW - PAD * 2, 0.2);
    s.top_songs.slice(0, 5).forEach((song, i) => {
      const k = arrive(c, 0.6 + i * 0.12);
      if (k <= 0) return;
      c.ctx.save();
      c.ctx.globalAlpha = k;
      songRow(c, i, song, CX + PAD, y + 250 + i * 120, CW - PAD * 2, 96);
      c.ctx.restore();
    });
  },
};

function wrapText(c: Ctx, text: string, x: number, y: number, maxW: number, lh: number, lines: number): number {
  const { ctx } = c;
  const words = text.split(/\s+/);
  let line = "";
  let n = 0;
  let yy = y;
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width > maxW && line) {
      ctx.fillText(line, x, yy);
      yy += lh;
      n += 1;
      line = w;
      if (n >= lines) return yy;
    } else line = next;
  }
  if (line) ctx.fillText(n === lines - 1 ? fit(ctx, line, maxW) : line, x, yy);
  return yy;
}

/** One frame of the video at `t` seconds. */
export function drawWrapVideoFrame(ctx: CanvasRenderingContext2D, wrap: MyWrap, plan: WrapVideoPlan, a: VideoAssets, t: number, host: string | null): void {
  const { index, local } = segmentAt(plan.segments, t);
  const seg = plan.segments[index];
  const world = plan.worlds[index];
  const previous = plan.worlds[Math.max(0, index - 1)];
  backdrop(ctx, world, t, index === 0 ? world : previous, index === 0 ? 1 : Math.min(1, local / SWEEP_S));
  bulbs(ctx, world, Math.floor(t * 4) % 3);

  const ink = "#f6ece6";
  const muted = world === "ember" ? "#e9c9bd" : "#c9c4ec";
  const accent = world === "ember" ? "#fcf475" : "#53c8ea";
  const fill: FillContext = { firstName: wrap.person.first_name, name: wrap.person.name, year: wrap.season.year, stats: wrap.stats };
  const c: Ctx = { ctx, wrap, a, world, local, t, ink, muted, accent, fill };

  const logo = a.logos[world];
  if (logo) ctx.drawImage(logo, 90, 70, 132, 110);
  // Progress, like the story on the site.
  const bw = (SHARE_W - 260 - 90) / plan.segments.length;
  plan.segments.forEach((s, i) => {
    const x = 260 + i * bw;
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.fillRect(x, 120, bw - 8, 8);
    const p = i < index ? 1 : i > index ? 0 : Math.min(1, local / (s.end - s.start));
    ctx.fillStyle = accent;
    ctx.fillRect(x, 120, (bw - 8) * p, 8);
  });
  ctx.fillStyle = muted;
  ctx.font = `700 30px ${a.fonts.ui}`;
  ctx.textAlign = "left";
  ctx.fillText(fit(ctx, shareTitle(wrap.person.first_name, wrap.season.year, wrap.season.sharing.show_name).toUpperCase(), SHARE_W - 350), 260, 176);

  // The card rises in, a little later than the world change.
  const k = easeOut((local - 0.15) / 0.6);
  ctx.save();
  ctx.globalAlpha = k;
  ctx.translate(0, (1 - k) * 80);
  glass(ctx, CX, CY, CW, CH, world);
  ctx.save();
  cutRect(ctx, CX, CY, CW, CH, 44);
  ctx.clip();
  ctx.fillStyle = accent;
  ctx.font = `700 32px ${a.fonts.ui}`;
  ctx.fillText(CARD_WORDS[seg.key].name.toUpperCase(), CX + PAD, CY + 110);
  const card = wrap.cards.find((x) => x.key === seg.key);
  const headline = seg.key === "SUMMARY" ? shareTitle(wrap.person.first_name, wrap.season.year, wrap.season.sharing.show_name) : headlineFor(seg.key, card?.title ?? null, fill);
  const end = drawMixed(ctx, headline, CX + PAD, CY + 210, CW - PAD * 2, 80, {
    display: a.fonts.display,
    ui: a.fonts.ui,
    world,
    ink,
    shadow: world === "ember" ? "#b21f24" : "#4f4789",
    t,
  });
  if (wrap.enough && wrap.cards.length) {
    // One card's drawing going wrong never stops the rest of the video.
    try {
      ctx.save();
      BODIES[seg.key](c, end + 20);
    } catch {
      /* this card shows its headline only */
    } finally {
      ctx.restore();
    }
  }
  ctx.restore();
  ctx.restore();

  if (wrap.season.sharing.show_link && host) {
    ctx.textAlign = "center";
    ctx.fillStyle = ink;
    ctx.font = `700 38px ${a.fonts.ui}`;
    ctx.fillText(`${host}/wrap`, SHARE_W / 2, SHARE_H - 140);
    ctx.fillStyle = muted;
    ctx.font = `500 28px ${a.fonts.ui}`;
    ctx.fillText("Get your own Corner Room Wrap", SHARE_W / 2, SHARE_H - 96);
    ctx.textAlign = "left";
  }
}
