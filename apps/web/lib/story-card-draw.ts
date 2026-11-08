/*
 * Draws one story card frame (D-STORY-01) onto a 2D canvas, from `storyFrame` in
 * `story-card-view.ts`. Canvas, not the DOM, because a video needs every frame as pixels and CSS
 * backdrop blur can't be captured; the blur here is the room's own trick (a cover drawn tiny and
 * stretched), so it is cheap and looks the same in every browser.
 *
 * The look is liquid glass in the listening room's Sky colours: a see-through card that frosts and
 * slightly magnifies what is behind it, a lit rim brightest at the top-left, a thick soft inner
 * edge, a slow gloss sweep and a glow that breathes with the music. The card keeps Corner Room's
 * cut top-left corner. The logo is the official file, drawn as it is.
 */

import { STORY_H, STORY_W, type StoryFrame, type StoryInput } from "@/lib/story-card-view";

// Sky world (app/styles/tokens.css [data-theme="sky"]).
const SURFACE = "#120f26";
const FG = "#f6ece6";
const FG_MUTED = "#b9b6d6";
const ICE = "#bbedfe";
const SKY = "#53c8ea";
const INDIGO = "#4f4789";
const ice = (a: number) => `rgba(187, 237, 254, ${a})`;
const sky = (a: number) => `rgba(83, 200, 234, ${a})`;
const white = (a: number) => `rgba(255, 255, 255, ${a})`;
const night = (a: number) => `rgba(18, 15, 38, ${a})`;

// Card geometry, in story pixels. Kept inside the part of a story no app covers with its own buttons.
const CARD_W = 840;
const CARD_H = 1276;
const CARD_X = (STORY_W - CARD_W) / 2;
const CARD_Y = 262;
const CUT = 40;
const PAD = 60;
const COVER = CARD_W - PAD * 2;
const COVER_CUT = 28;
/** Width of the curved edge of the glass. */
const BEVEL = 22;

export type StoryFonts = { display: string; ui: string; bangla: string };

export type StoryAssets = {
  cover: CanvasImageSource | null;
  /** The cover blurred: stretched, it is the soft backdrop. */
  soft: HTMLCanvasElement | null;
  /** Blurred further: stretched, it is the frost inside the glass. */
  frost: HTMLCanvasElement | null;
  logo: CanvasImageSource | null;
  fonts: StoryFonts;
};

const BANGLA = /[ঀ-৿]/;

/**
 * The cover as a soft, tall picture: blurred at a modest size, so stretching it to the story never
 * shows the blocky steps a 40x stretch of a few pixels gives. Uses the canvas blur filter where the
 * browser has one; elsewhere halves down to a few pixels and doubles back up, each step smoothed.
 */
function soft(cover: CanvasImageSource, w: number, h: number, blurPx: number): HTMLCanvasElement | null {
  const make = (cw: number, ch: number) => {
    const c = document.createElement("canvas");
    c.width = cw;
    c.height = ch;
    return c;
  };
  const out = make(w, h);
  const ctx = out.getContext("2d");
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  // The square cover filling a tall frame: centred, sides cropped, a little larger so the blur's
  // edges stay outside the frame.
  const side = h * 1.15;
  if ("filter" in ctx && typeof ctx.filter === "string") {
    ctx.filter = `blur(${blurPx}px) saturate(1.25)`;
    ctx.drawImage(cover, (w - side) / 2, (h - side) / 2, side, side);
    ctx.filter = "none";
    if (ctx.getImageData(w >> 1, h >> 1, 1, 1).data[3] > 0) return out;
  }
  let small = make(Math.max(2, Math.round(w / 16)), Math.max(2, Math.round(h / 16)));
  const sctx = small.getContext("2d");
  if (!sctx) return null;
  sctx.imageSmoothingQuality = "high";
  sctx.drawImage(cover, (small.width - small.height * 1.15) / 2, -small.height * 0.075, small.height * 1.15, small.height * 1.15);
  while (small.width * 2 <= w) {
    const next = make(small.width * 2, small.height * 2);
    const n = next.getContext("2d");
    if (!n) break;
    n.imageSmoothingQuality = "high";
    n.drawImage(small, 0, 0, next.width, next.height);
    small = next;
  }
  ctx.drawImage(small, 0, 0, w, h);
  return out;
}

/** The pictures every frame reuses, made once. */
export function storyAssets(cover: CanvasImageSource | null, logo: CanvasImageSource | null, fonts: StoryFonts): StoryAssets {
  return {
    cover,
    soft: cover ? soft(cover, 270, 480, 9) : null,
    frost: cover ? soft(cover, 135, 240, 10) : null,
    logo,
    fonts,
  };
}

/** The faces the page already loaded (next/font gives each a generated family name). */
export function pageFonts(): StoryFonts {
  const css = typeof document === "undefined" ? null : getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) => (css?.getPropertyValue(name).trim() || "") || fallback;
  return {
    display: read("--font-sikat", "'Arial Narrow', sans-serif"),
    ui: read("--font-archivo", "system-ui, sans-serif"),
    bangla: read("--font-anek", "sans-serif"),
  };
}

function cutPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, cut: number): void {
  ctx.beginPath();
  ctx.moveTo(x + cut, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + cut);
  ctx.closePath();
}

/** The same shape, added to the current path (for the bevel's ring). */
function cutPath2(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, cut: number): void {
  ctx.moveTo(x + cut, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + cut);
  ctx.closePath();
}

function faceFor(text: string, fonts: StoryFonts, latin: string): string {
  return BANGLA.test(text) ? `${fonts.bangla}, ${latin}` : latin;
}

/** Sets a font that fits `text` in `width`, shrinking down to `min`; returns the text (ellipsis if still too long). */
function fit(ctx: CanvasRenderingContext2D, text: string, width: number, size: number, min: number, font: (px: number) => string): string {
  let px = size;
  ctx.font = font(px);
  while (ctx.measureText(text).width > width && px > min) {
    px -= 2;
    ctx.font = font(px);
  }
  if (ctx.measureText(text).width <= width) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > width) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

function backdrop(ctx: CanvasRenderingContext2D, a: StoryAssets, t: number, glow: number): void {
  ctx.fillStyle = SURFACE;
  ctx.fillRect(0, 0, STORY_W, STORY_H);
  if (a.soft) {
    // Slow drift, like the room's backdrop.
    const s = 1.22 + 0.04 * Math.sin(t * 0.21);
    const dx = Math.sin(t * 0.13) * 30;
    const dy = Math.cos(t * 0.11) * 40;
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.translate(STORY_W / 2 + dx, STORY_H / 2 + dy);
    ctx.scale(s, s);
    ctx.drawImage(a.soft, -STORY_W / 2, -STORY_H / 2, STORY_W, STORY_H);
    ctx.restore();
  } else {
    const g = ctx.createLinearGradient(0, 0, STORY_W, STORY_H);
    g.addColorStop(0, "#2e2860");
    g.addColorStop(0.55, SURFACE);
    g.addColorStop(1, "#1b1838");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, STORY_W, STORY_H);
  }
  // The room's corner light: Ice at the core, Sky, falling to Indigo; brighter with the music.
  const pool = ctx.createRadialGradient(STORY_W * 0.18, STORY_H * 0.08, 0, STORY_W * 0.18, STORY_H * 0.08, STORY_H * 0.8);
  pool.addColorStop(0, ice(0.16 + glow * 0.1));
  pool.addColorStop(0.35, sky(0.22 + glow * 0.12));
  pool.addColorStop(1, "rgba(79, 71, 137, 0)");
  ctx.fillStyle = pool;
  ctx.fillRect(0, 0, STORY_W, STORY_H);
  const shade = ctx.createLinearGradient(0, 0, 0, STORY_H);
  shade.addColorStop(0, night(0.25));
  shade.addColorStop(0.6, night(0.45));
  shade.addColorStop(1, night(0.78));
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, STORY_W, STORY_H);
}

function glass(ctx: CanvasRenderingContext2D, a: StoryAssets, f: StoryFrame, t: number): void {
  const x = CARD_X;
  const y = CARD_Y;
  // A halo behind the card that breathes with the music.
  const halo = ctx.createRadialGradient(STORY_W / 2, y + CARD_H * 0.42, 60, STORY_W / 2, y + CARD_H * 0.42, 760);
  halo.addColorStop(0, sky(0.1 + f.glow * 0.22));
  halo.addColorStop(1, sky(0));
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, STORY_W, STORY_H);

  // Lift.
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.5)";
  ctx.shadowBlur = 90;
  ctx.shadowOffsetY = 44;
  cutPath(ctx, x, y, CARD_W, CARD_H, CUT);
  ctx.fillStyle = night(0.55);
  ctx.fill();
  ctx.restore();

  ctx.save();
  cutPath(ctx, x, y, CARD_W, CARD_H, CUT);
  ctx.clip();
  // Frost: what is behind, much softer and a little magnified (the glass bends light).
  if (a.frost) {
    const s = 1.3 + 0.04 * Math.sin(t * 0.21);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.save();
    ctx.translate(STORY_W / 2, y + CARD_H / 2);
    ctx.scale(s, s);
    ctx.globalAlpha *= 0.85;
    ctx.drawImage(a.frost, -STORY_W / 2, -STORY_H / 2, STORY_W, STORY_H);
    ctx.restore();
  }
  // Tint, lit from the top-left (the Sky glass fill).
  const tint = ctx.createLinearGradient(x, y, x + CARD_W, y + CARD_H);
  tint.addColorStop(0, ice(0.2));
  tint.addColorStop(0.55, ice(0.05));
  tint.addColorStop(1, "rgba(27, 24, 56, 0.42)");
  ctx.fillStyle = tint;
  ctx.fillRect(x, y, CARD_W, CARD_H);
  // Glossy depth: a broad light across the top, darker toward the bottom edge.
  const top = ctx.createRadialGradient(x + CARD_W * 0.35, y - CARD_H * 0.1, 40, x + CARD_W * 0.35, y - CARD_H * 0.1, CARD_W * 0.95);
  top.addColorStop(0, white(0.2));
  top.addColorStop(1, white(0));
  ctx.fillStyle = top;
  ctx.fillRect(x, y, CARD_W, CARD_H);
  const bottom = ctx.createLinearGradient(0, y + CARD_H * 0.7, 0, y + CARD_H);
  bottom.addColorStop(0, "rgba(0, 0, 0, 0)");
  bottom.addColorStop(1, "rgba(0, 0, 0, 0.22)");
  ctx.fillStyle = bottom;
  ctx.fillRect(x, y, CARD_W, CARD_H);
  // Thick soft inner edge: the rounded body of liquid glass (only the inner half shows, clipped).
  cutPath(ctx, x, y, CARD_W, CARD_H, CUT);
  ctx.lineWidth = 34;
  ctx.strokeStyle = ice(0.07);
  ctx.stroke();
  ctx.lineWidth = 12;
  ctx.strokeStyle = white(0.07);
  ctx.stroke();
  // The bevel: a band along the edge where the glass curves, bending what is behind more strongly
  // and catching light on the top-left, shade on the bottom-right. This is what reads as liquid.
  ctx.save();
  cutPath(ctx, x, y, CARD_W, CARD_H, CUT);
  cutPath2(ctx, x + BEVEL, y + BEVEL, CARD_W - BEVEL * 2, CARD_H - BEVEL * 2, CUT - BEVEL * 0.4);
  ctx.clip("evenodd");
  if (a.soft) {
    const s = 1.55 + 0.04 * Math.sin(t * 0.21);
    ctx.save();
    ctx.translate(STORY_W / 2, y + CARD_H / 2);
    ctx.scale(-s, s);
    ctx.globalAlpha *= 0.55;
    ctx.drawImage(a.soft, -STORY_W / 2, -STORY_H / 2, STORY_W, STORY_H);
    ctx.restore();
  }
  const bevel = ctx.createLinearGradient(x, y, x + CARD_W, y + CARD_H);
  bevel.addColorStop(0, white(0.34));
  bevel.addColorStop(0.3, ice(0.1));
  bevel.addColorStop(0.7, "rgba(0, 0, 0, 0.06)");
  bevel.addColorStop(1, white(0.16));
  ctx.fillStyle = bevel;
  ctx.fillRect(x, y, CARD_W, CARD_H);
  ctx.restore();
  // Gloss sweep, slow, along the diagonal.
  if (f.sheen > -0.3 && f.sheen < 1.3) {
    const cx = x + f.sheen * (CARD_W + CARD_H * 0.6) - CARD_H * 0.3;
    const band = ctx.createLinearGradient(cx - 160, y, cx + 160, y + 220);
    band.addColorStop(0, white(0));
    band.addColorStop(0.5, white(0.12));
    band.addColorStop(1, white(0));
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = band;
    ctx.fillRect(x, y, CARD_W, CARD_H);
    ctx.globalCompositeOperation = "source-over";
  }
  ctx.restore();

  // Lit rim, brightest at the top-left, with a faint colour fringe like real glass.
  cutPath(ctx, x, y, CARD_W, CARD_H, CUT);
  const rim = ctx.createLinearGradient(x, y, x + CARD_W, y + CARD_H);
  rim.addColorStop(0, white(0.9));
  rim.addColorStop(0.28, ice(0.38));
  rim.addColorStop(0.62, ice(0.1));
  rim.addColorStop(1, white(0.5));
  ctx.lineWidth = 3;
  ctx.strokeStyle = rim;
  ctx.stroke();
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.translate(1.5, 1.5);
  cutPath(ctx, x, y, CARD_W, CARD_H, CUT);
  const fringe = ctx.createLinearGradient(x, y + CARD_H, x + CARD_W, y);
  fringe.addColorStop(0, sky(0.22));
  fringe.addColorStop(0.5, "rgba(160, 120, 255, 0.08)");
  fringe.addColorStop(1, sky(0.18));
  ctx.lineWidth = 2;
  ctx.strokeStyle = fringe;
  ctx.stroke();
  ctx.restore();
}

function cover(ctx: CanvasRenderingContext2D, a: StoryAssets, input: StoryInput): void {
  const x = CARD_X + PAD;
  const y = CARD_Y + PAD;
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
  ctx.shadowBlur = 50;
  ctx.shadowOffsetY = 24;
  cutPath(ctx, x, y, COVER, COVER, COVER_CUT);
  ctx.fillStyle = INDIGO;
  ctx.fill();
  ctx.restore();
  ctx.save();
  cutPath(ctx, x, y, COVER, COVER, COVER_CUT);
  ctx.clip();
  if (a.cover) {
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(a.cover, x, y, COVER, COVER);
  } else {
    // No cover: the title on the Sky field, as the room's cube face.
    const g = ctx.createLinearGradient(x, y, x + COVER, y + COVER);
    g.addColorStop(0, SKY);
    g.addColorStop(1, INDIGO);
    ctx.fillStyle = g;
    ctx.fillRect(x, y, COVER, COVER);
    ctx.fillStyle = ICE;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const text = fit(ctx, input.title, COVER - 80, 120, 56, (px) => `${px}px ${faceFor(input.title, a.fonts, a.fonts.display)}`);
    ctx.fillText(text, x + COVER / 2, y + COVER / 2);
  }
  // A thin light on the cover's own edge.
  ctx.restore();
  cutPath(ctx, x, y, COVER, COVER, COVER_CUT);
  ctx.lineWidth = 2;
  ctx.strokeStyle = ice(0.3);
  ctx.stroke();
}

function words(ctx: CanvasRenderingContext2D, a: StoryAssets, input: StoryInput): number {
  const x = CARD_X + PAD;
  let y = CARD_Y + PAD + COVER + 92;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  const title = fit(ctx, input.title, COVER, 76, 44, (px) =>
    BANGLA.test(input.title) ? `700 ${px}px ${a.fonts.bangla}, ${a.fonts.ui}` : `${px}px ${a.fonts.display}`,
  );
  // The display shadow the room's big titles carry (Indigo, offset).
  ctx.fillStyle = INDIGO;
  ctx.fillText(title, x + 4, y + 4);
  ctx.fillStyle = FG;
  ctx.fillText(title, x, y);
  y += 54;
  const artist = fit(ctx, input.artist || "", COVER, 36, 26, (px) => `600 ${px}px ${faceFor(input.artist, a.fonts, a.fonts.ui)}`);
  ctx.fillStyle = FG_MUTED;
  ctx.fillText(artist, x, y);
  return y;
}

const LYRIC_ZONE = 196;
const LINE_GAP = 74;

function lyrics(ctx: CanvasRenderingContext2D, a: StoryAssets, f: StoryFrame, top: number, t: number): void {
  const x = CARD_X + PAD;
  ctx.save();
  ctx.beginPath();
  ctx.rect(CARD_X + 10, top, CARD_W - 20, LYRIC_ZONE);
  ctx.clip();
  if (f.lines.length === 0) {
    // No lyrics: the room's equaliser, as glass bars that move with the music.
    const bars = 28;
    const gap = 10;
    const w = (COVER - gap * (bars - 1)) / bars;
    for (let i = 0; i < bars; i++) {
      const wave = 0.5 + 0.5 * Math.sin(i * 0.82 + t * 5.2) * Math.cos(i * 0.31 - t * 2.1);
      const h = 18 + (LYRIC_ZONE - 60) * (0.15 + 0.85 * f.glow) * wave;
      const bx = x + i * (w + gap);
      const by = top + LYRIC_ZONE / 2 - h / 2;
      const g = ctx.createLinearGradient(0, by, 0, by + h);
      g.addColorStop(0, ice(0.85));
      g.addColorStop(1, sky(0.35));
      ctx.fillStyle = g;
      ctx.fillRect(bx, by, w, h);
    }
    ctx.restore();
    return;
  }
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const base = ctx.globalAlpha;
  for (const line of f.lines) {
    const away = Math.abs(line.age);
    if (away >= 1.6) continue;
    const y = top + 62 + line.age * LINE_GAP;
    const size = 54 - 14 * Math.min(1, away);
    // The line now is full white; the next waits dimmer; the last one fades as it rises.
    const alpha = line.age < 0 ? Math.max(0, 1 - away * 0.85) * 0.75 : 1 - Math.min(1, away) * 0.55;
    const text = fit(ctx, line.text, COVER, size, 30, (px) => `700 ${px}px ${faceFor(line.text, a.fonts, a.fonts.ui)}`);
    ctx.globalAlpha = base * alpha;
    const now = away < 0.5;
    ctx.fillStyle = now && f.sung !== null ? ice(0.55) : FG;
    if (now) {
      ctx.shadowColor = sky(0.6);
      ctx.shadowBlur = 24 + f.glow * 20;
    }
    ctx.fillText(text, x, y);
    ctx.shadowBlur = 0;
    // Timed lyrics: the line lights up as it is sung.
    if (now && f.sung !== null) {
      const wide = ctx.measureText(text).width;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x - 4, y - size, wide * f.sung + 4, size * 2);
      ctx.clip();
      ctx.fillStyle = FG;
      ctx.fillText(text, x, y);
      ctx.restore();
    }
  }
  ctx.restore();
}

function progress(ctx: CanvasRenderingContext2D, f: StoryFrame): void {
  const x = CARD_X + PAD;
  const y = CARD_Y + CARD_H - PAD - 4;
  ctx.fillStyle = ice(0.18);
  ctx.fillRect(x, y - 3, COVER, 6);
  const w = COVER * Math.min(1, Math.max(0, f.progress));
  const g = ctx.createLinearGradient(x, 0, x + COVER, 0);
  g.addColorStop(0, ICE);
  g.addColorStop(1, SKY);
  ctx.fillStyle = g;
  ctx.fillRect(x, y - 3, w, 6);
  ctx.save();
  ctx.shadowColor = sky(0.9);
  ctx.shadowBlur = 18;
  ctx.fillStyle = white(0.95);
  ctx.beginPath();
  ctx.arc(x + w, y, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function footer(ctx: CanvasRenderingContext2D, a: StoryAssets): void {
  const y = CARD_Y + CARD_H + 80;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `600 30px ${a.fonts.ui}`;
  ctx.fillStyle = FG_MUTED;
  const label = "cornerroom.live";
  if (a.logo) {
    const h = 58;
    const w = (h * 279) / 232; // the official mark's own proportions
    const textW = ctx.measureText(label).width;
    const total = w + 20 + textW;
    const left = STORY_W / 2 - total / 2;
    ctx.drawImage(a.logo, left, y - h / 2, w, h);
    ctx.textAlign = "left";
    ctx.fillText(label, left + w + 20, y + 2);
  } else {
    ctx.fillText(label, STORY_W / 2, y);
  }
}

/** One frame at `t` seconds. `scale` draws a smaller copy for the live preview. */
export function drawStory(ctx: CanvasRenderingContext2D, input: StoryInput, f: StoryFrame, a: StoryAssets, t: number, scale = 1): void {
  ctx.save();
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  backdrop(ctx, a, t, f.glow);
  ctx.save();
  // Arrive: rise and settle; then float and lean a little, as the room's front card does.
  const cx = STORY_W / 2;
  const cy = CARD_Y + CARD_H / 2;
  const lift = (1 - f.arrive) * 90 + f.floatY;
  const s = 0.94 + 0.06 * f.arrive;
  ctx.translate(cx, cy + lift);
  ctx.rotate((f.lean * Math.PI) / 180 / 3);
  ctx.scale(s, s);
  ctx.translate(-cx, -cy);
  ctx.globalAlpha = f.arrive;
  glass(ctx, a, f, t);
  cover(ctx, a, input);
  const artistLine = words(ctx, a, input);
  lyrics(ctx, a, f, artistLine + 30, t);
  progress(ctx, f);
  ctx.restore();
  ctx.globalAlpha = f.arrive;
  footer(ctx, a);
  ctx.restore();
}
