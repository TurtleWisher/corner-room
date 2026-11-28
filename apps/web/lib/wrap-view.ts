/* Corner Room Wrap (owner, 2026-11-28, D-WRAP-01): the pure rules of the story. The API decides
 * every number and which cards a person gets; these only word, order, time and colour them. */

import type { WrapCardKey, WrapCardSetting, WrapDayPart, WrapLook, WrapStats, WrapStatus } from "@/features/wraps/api";
import { formatCount } from "@/lib/format/count";

export type WrapWorld = "ember" | "sky";

/** One world per card, never blended (brand D1): Marquee is all Ember, Carousel all Sky, and the
 * Fairground takes turns, card by card. */
export function worldFor(look: WrapLook, index: number): WrapWorld {
  if (look === "MARQUEE") return "ember";
  if (look === "CAROUSEL") return "sky";
  return index % 2 === 0 ? "ember" : "sky";
}

/** The dither's four tones per world, darkest first. Only brand colours, never mixed across worlds. */
export const WORLD_TONES: Record<WrapWorld, [string, string, string, string]> = {
  ember: ["#140707", "#831515", "#b21f24", "#fcf475"],
  sky: ["#120f26", "#2e2860", "#4f4789", "#53c8ea"],
};

export function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const LOOK_WORDS: Record<WrapLook, { name: string; line: string }> = {
  MARQUEE: { name: "Marquee", line: "Every card in the red room, lit like a fairground sign." },
  CAROUSEL: { name: "Carousel", line: "Every card in the blue night, like a carousel after dark." },
  FAIRGROUND: { name: "Fairground", line: "Red and blue take turns, one card each." },
};

export const CARD_WORDS: Record<WrapCardKey, { name: string; headline: string; about: string }> = {
  INTRO: { name: "Opening", headline: "{first_name}, step right up", about: "The Wrap's name, tagline and opening words." },
  MINUTES: { name: "Minutes", headline: "You played {minutes} minutes of music", about: "Minutes heard, listens, songs and acts." },
  TOP_SONG: { name: "Top song", headline: "Your song of the year", about: "The song they heard most, ready to play." },
  TOP_SONGS: { name: "Top songs", headline: "Your top songs", about: "Their most played songs, ranked." },
  TOP_ACTS: { name: "Top acts", headline: "The acts on your stage", about: "The artists and bands they heard most." },
  FAN_RANK: { name: "Fan rank", headline: "You're a top fan of {top_act}", about: "Their place among an act's listeners, as a share." },
  CLOCK: { name: "Listening clock", headline: "Your hour on the clock", about: "The hours they listen most and the listener that makes them." },
  MONTHS: { name: "Months", headline: "Your year, month by month", about: "Listens per month and the biggest one." },
  STREAK: { name: "Streak", headline: "Days in a row", about: "Their longest run of days and busiest day." },
  DISCOVERY: { name: "Discoveries", headline: "New to your ears", about: "Songs and acts they heard for the first time." },
  COLLECTION: { name: "Collection", headline: "Yours to keep", about: "Songs and releases they bought, and pre-orders." },
  EVENTS: { name: "Events", headline: "Nights out", about: "Events they had tickets for, and went to." },
  GIFTS: { name: "Gifts", headline: "Music you passed on", about: "Gifts given and received." },
  SUMMARY: { name: "Your Wrap", headline: "{first_name}'s {year} Wrap", about: "Everything on one card, ready to share." },
};

export type FillContext = {
  firstName: string | null;
  name: string | null;
  year: number;
  stats: Pick<WrapStats, "top_songs" | "top_acts" | "minutes"> | null;
};

/** Replace staff's fill-ins with the person's own words. A name Corner Room doesn't have reads as a
 * friendly "you" so no headline ever shows a blank or a brace. */
export function fillIn(text: string, ctx: FillContext): string {
  const top = ctx.stats?.top_songs?.[0];
  const act = ctx.stats?.top_acts?.[0];
  const values: Record<string, string> = {
    "{first_name}": ctx.firstName || "You",
    "{name}": ctx.name || ctx.firstName || "You",
    "{year}": String(ctx.year),
    "{top_song}": top?.title || "your top song",
    "{top_act}": act?.name || "your top act",
    "{minutes}": formatCount(ctx.stats?.minutes ?? 0),
  };
  let out = text.replace(/\{[a-z_]+\}/g, (m) => values[m] ?? m);
  // "You's" reads wrong: a missing name in a possessive becomes "Your".
  out = out.replace(/\bYou's\b/g, "Your");
  return out;
}

export function headlineFor(key: WrapCardKey, title: string | null, ctx: FillContext): string {
  return fillIn(title?.trim() ? title : CARD_WORDS[key].headline, ctx);
}

export const DAY_PART_WORDS: Record<WrapDayPart, { name: string; line: string }> = {
  EARLY_BIRD: { name: "Early bird", line: "Your music starts with the morning tea." },
  DAYTIME: { name: "Daylight listener", line: "Music carries you through the middle of the day." },
  SUNDOWN: { name: "Sundown dreamer", line: "Evenings are when you press play." },
  NIGHT_OWL: { name: "Night owl", line: "Your best listening happens after dark." },
};

/** A Dhaka hour as people say it: 0 is 12 AM, 13 is 1 PM. */
export function hourLabel(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve} ${h < 12 ? "AM" : "PM"}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-03" as "Mar". */
export function monthLabel(month: string): string {
  const m = Number(month.slice(5, 7));
  return MONTHS[m - 1] ?? month;
}

export function biggestMonth(months: WrapStats["months"]): { month: string; listens: number } | null {
  let best: { month: string; listens: number } | null = null;
  for (const m of months) if (m.listens > 0 && (!best || m.listens > best.listens)) best = m;
  return best;
}

/** Heights 0..1 for a row of bars, the biggest at 1 (all 0 when nothing). */
export function barHeights(values: number[]): number[] {
  const max = Math.max(0, ...values);
  return values.map((v) => (max > 0 ? v / max : 0));
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${formatCount(n)} ${n === 1 ? one : many}`;
}

// --- the story's timing ---------------------------------------------------------------------------

export type StoryClock = { index: number; elapsedMs: number };

/** Move the story on by `dt` ms; past the last card it stays on the last card, full. */
export function advance(clock: StoryClock, dt: number, slideMs: number, count: number): StoryClock {
  if (count <= 0) return { index: 0, elapsedMs: 0 };
  let { index, elapsedMs } = clock;
  elapsedMs += Math.max(0, dt);
  while (elapsedMs >= slideMs && index < count - 1) {
    elapsedMs -= slideMs;
    index += 1;
  }
  if (index >= count - 1) elapsedMs = Math.min(elapsedMs, slideMs);
  return { index, elapsedMs };
}

/** How full each progress bar is (0..1). */
export function progressBars(clock: StoryClock, slideMs: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => (i < clock.index ? 1 : i > clock.index ? 0 : Math.min(1, clock.elapsedMs / slideMs)));
}

/** A tap on the left third goes back, anywhere else goes on (as story apps do). */
export function tapStep(x: number, width: number): -1 | 1 {
  return width > 0 && x < width / 3 ? -1 : 1;
}

export function stepTo(index: number, step: number, count: number): number {
  return Math.max(0, Math.min(count - 1, index + step));
}

// --- share ------------------------------------------------------------------------------------------

export function shareTitle(firstName: string | null, year: number, showName: boolean): string {
  return showName && firstName ? `${firstName}'s ${year} Corner Room Wrap` : `My ${year} Corner Room Wrap`;
}

export function shareFileName(year: number, design: string): string {
  return `corner-room-wrap-${year}-${design}.png`;
}

/** The classic 8 x 8 ordered-dither (Bayer) matrix, the same one the shader uses. */
export const BAYER8 = [
  0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22, 3, 35, 11, 43, 1,
  33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21,
] as const;

/** The Bayer threshold (0..1) for a cell. */
export function bayerAt(x: number, y: number): number {
  return (BAYER8[(y & 7) * 8 + (x & 7)] + 0.5) / 64;
}

/** Which of the four tones a light value (0..1) dithers to at a threshold. */
export function toneAt(value: number, threshold: number): 0 | 1 | 2 | 3 {
  const scaled = Math.max(0, Math.min(0.9999, value)) * 3;
  const base = Math.floor(scaled);
  const step = scaled - base > threshold ? 1 : 0;
  return Math.min(3, base + step) as 0 | 1 | 2 | 3;
}

/** The light of the carnival backdrop at a point (0..1 across and down), time in seconds: a pool
 * from a corner, slow sunburst rays like a fairground tent and a soft drifting swirl. The shader
 * and the share picture draw the same field. */
export function backdropLight(u: number, v: number, t: number, pointer: [number, number] = [0.85, 0.15]): number {
  const dx = u - pointer[0];
  const dy = v - pointer[1];
  const pool = Math.exp(-(dx * dx + dy * dy) * 2.6);
  const cx = u - 0.5;
  const cy = v - 1.05;
  const angle = Math.atan2(cy, cx);
  const rays = 0.5 + 0.5 * Math.cos(angle * 14 + t * 0.25);
  const dist = Math.sqrt(cx * cx + cy * cy);
  const swirl = 0.5 + 0.5 * Math.sin(u * 5.0 + Math.sin(v * 4.0 + t * 0.4) * 1.6 + t * 0.3);
  const fall = Math.max(0, 1 - dist * 0.85);
  return Math.max(0, Math.min(1, pool * 0.78 + rays * fall * 0.28 + swirl * 0.14 - 0.08));
}

// --- staff ------------------------------------------------------------------------------------------

export const STATUS_WORDS: Record<WrapStatus, string> = { DRAFT: "Draft", LIVE: "Live", ENDED: "Ended" };

export function transitionWords(from: WrapStatus, to: WrapStatus): { label: string; confirm: string } {
  if (to === "LIVE" && from === "DRAFT") return { label: "Go live", confirm: "Fans can open it as soon as its opening time comes (at once if none is set)." };
  if (to === "LIVE") return { label: "Open again", confirm: "Fans can open it again. Their numbers stay as they were." };
  if (to === "DRAFT") return { label: "Back to draft", confirm: "Fans can't open it until it goes live again. Their numbers are kept." };
  return { label: "End it", confirm: "Fans can't open it any more. Its counts stay here." };
}

export function moveCard(cards: WrapCardSetting[], index: number, step: -1 | 1): WrapCardSetting[] {
  const to = index + step;
  if (to < 0 || to >= cards.length) return cards;
  const next = [...cards];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

/** "When fans can open it" in words, for the staff list. */
export function windowWords(fanState: string, opensAt: string | null, closesAt: string | null, fmt: (iso: string) => string): string {
  if (fanState === "OPEN") return closesAt ? `Open until ${fmt(closesAt)}` : "Open now";
  if (fanState === "SOON" && opensAt) return `Opens ${fmt(opensAt)}`;
  return "Fans can't open it";
}

/** A local datetime-local value ("2026-12-01T18:00") as an ISO time in Dhaka (UTC+6, no DST). */
export function dhakaInputToIso(value: string): string | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const utc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]) - 6, Number(m[5]));
  return new Date(utc).toISOString();
}

/** An ISO time as a datetime-local value in Dhaka. */
export function isoToDhakaInput(iso: string | null): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const d = new Date(t + 6 * 3600_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
