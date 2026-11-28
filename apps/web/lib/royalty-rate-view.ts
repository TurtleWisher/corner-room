/*
 * Each artist's royalty rate, in words (owner, 2026-11-28, D-ROYALTY-RATE-01). The percentage is a
 * share of what the fan paid, set by staff as agreed with the artist. The server stores it in basis
 * points (7000 = 70 %) and works out every amount; this file only turns a typed percentage into
 * basis points and back, with string arithmetic (never floats), and words for the screens.
 */

import { formatDate } from "@/lib/format/date";

export const MAX_BPS = 10_000;

/** "70" -> 7000, "12.5" -> 1250, "0.05" -> 5. Null when it isn't 0 to 100 with at most two decimals. */
export function percentToBps(text: string): number | null {
  const clean = text.trim().replace(/\s*%$/, "").replace(",", ".");
  const match = /^(\d{1,3})(?:\.(\d{0,2}))?$/.exec(clean);
  if (!match) return null;
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? "").padEnd(2, "0") || "0");
  const bps = whole * 100 + fraction;
  return bps <= MAX_BPS ? bps : null;
}

/** 7000 -> "70", 1250 -> "12.5", 1255 -> "12.55", 5 -> "0.05". */
export function bpsToPercent(bps: number): string {
  const whole = Math.floor(bps / 100);
  const rest = bps % 100;
  if (rest === 0) return String(whole);
  return `${whole}.${String(rest).padStart(2, "0").replace(/0$/, "")}`;
}

export function rateLabel(bps: number | null | undefined): string {
  return bps === null || bps === undefined ? "No rate yet" : `${bpsToPercent(bps)}%`;
}

/** What the rate means, said once on the setting form. */
export function rateMeaning(bps: number | null): string {
  if (bps === null) return "Type the percentage agreed with the artist.";
  if (bps === 0) return "The artist earns nothing from sales while this rate applies.";
  return `The artist earns ${bpsToPercent(bps)} of every 100 a fan pays for their music.`;
}

export function percentProblem(text: string): string | null {
  if (!text.trim()) return "Type a percentage.";
  return percentToBps(text) === null ? "Use a number from 0 to 100, with at most two decimals (for example 70 or 12.5)." : null;
}

/** "From the start", "28 Nov 2026 to 30 Nov 2026", "Since 28 Nov 2026". */
export function spanWords(from: string | null, to: string | null): string {
  const start = from ? formatDate(from) : null;
  const end = to ? formatDate(to) : null;
  if (!start && !end) return "From the start, still in use";
  if (!start) return `From the start until ${end}`;
  if (!end) return `Since ${start}`;
  return `${start} until ${end}`;
}

export function howWords(how: "GIFT" | "CREDIT" | "PRESALE" | null): string | null {
  if (how === "GIFT") return "Bought as a gift";
  if (how === "CREDIT") return "Paid with gift credit";
  if (how === "PRESALE") return "Pre-order";
  return null;
}

/** The tick box's words when saving a rate: how many earlier sales it would cover. */
export function coverEarlierWords(sales: number): string | null {
  if (sales <= 0) return null;
  return `Also give this rate to the ${sales} earlier ${sales === 1 ? "sale" : "sales"} with no rate yet`;
}

export type RateFilter = "all" | "no-rate" | "with-rate";

export const RATE_FILTERS: { id: RateFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "no-rate", label: "Needs a rate" },
  { id: "with-rate", label: "Has a rate" },
];

/** "Needs a rate" means sales no rate covers yet, or no rate at all on an act that sells. */
export function matchesRateFilter(row: { share_bps: number | null; no_rate_sales: number }, filter: RateFilter): boolean {
  if (filter === "no-rate") return row.share_bps === null || row.no_rate_sales > 0;
  if (filter === "with-rate") return row.share_bps !== null;
  return true;
}
