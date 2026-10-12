/**
 * Date and time display. Event times are always shown in the event's own IANA timezone (Q-P4-09),
 * never the viewer's. If the API gives no valid timezone, UTC is used and labelled, so the time
 * is never silently shifted.
 */
import { intlDateLocale, type DisplayLocale } from "./locale";

export interface DateTimeOptions {
  timeZone?: string | null;
  locale?: DisplayLocale;
}

export interface ResolvedZone {
  timeZone: string;
  /** "Dhaka time", or "UTC" when the API gave no usable zone. */
  label: string;
  fallback: boolean;
}

export function resolveTimeZone(timeZone: string | null | undefined): ResolvedZone {
  if (timeZone) {
    try {
      new Intl.DateTimeFormat("en", { timeZone }).format(0);
      const city = timeZone.split("/").pop()?.replace(/_/g, " ") ?? timeZone;
      return { timeZone, label: timeZone === "UTC" ? "UTC" : `${city} time`, fallback: false };
    } catch {
      /* fall through */
    }
  }
  return { timeZone: "UTC", label: "UTC", fallback: true };
}

/** Three-letter months in house style: ICU's en-GB gives "Sept"; Corner Room uses "Sep". */
function shortMonth(month: string): string {
  return month.length > 3 ? month.slice(0, 3) : month;
}

function parse(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function fmt(value: string | Date | null | undefined, opts: DateTimeOptions, format: Intl.DateTimeFormatOptions): string | null {
  const d = parse(value);
  if (!d) return null;
  const zone = resolveTimeZone(opts.timeZone);
  return new Intl.DateTimeFormat(intlDateLocale(opts.locale), { ...format, timeZone: zone.timeZone }).format(d);
}

/** "Fri 17 Oct 2025" (house style: no commas) */
export function formatDate(value: string | Date | null | undefined, opts: DateTimeOptions = {}): string | null {
  const d = parse(value);
  if (!d) return null;
  const zone = resolveTimeZone(opts.timeZone);
  const parts = new Intl.DateTimeFormat(intlDateLocale(opts.locale), {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: zone.timeZone,
  }).formatToParts(d);
  if (opts.locale === "bn") return parts.map((p) => p.value).join("");
  return parts
    .filter((p) => p.type !== "literal")
    .map((p) => (p.type === "month" ? shortMonth(p.value) : p.value))
    .join(" ");
}

/** "8:00 PM" */
export function formatTime(value: string | Date | null | undefined, opts: DateTimeOptions = {}): string | null {
  const out = fmt(value, opts, { hour: "numeric", minute: "2-digit", hour12: true });
  return out?.replace(/\s?(am|pm)$/i, (m) => m.toUpperCase()) ?? null;
}

/** "Fri 17 Oct 2025, 8:00 PM" */
export function formatDateTime(value: string | Date | null | undefined, opts: DateTimeOptions = {}): string | null {
  const date = formatDate(value, opts);
  const time = formatTime(value, opts);
  return date && time ? `${date}, ${time}` : null;
}

export interface DateBlock {
  weekday: string;
  day: string;
  month: string;
  year: string;
  /** Machine-readable value for <time dateTime>. */
  iso: string;
}

/** Parts for the large date block on event cards: FRI / 17 / OCT. Uppercased for display. */
export function dateBlock(value: string | Date | null | undefined, opts: DateTimeOptions = {}): DateBlock | null {
  const d = parse(value);
  if (!d) return null;
  const zone = resolveTimeZone(opts.timeZone);
  const parts = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: zone.timeZone,
  }).formatToParts(d);
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    weekday: get("weekday").toUpperCase(),
    day: get("day"),
    month: shortMonth(get("month")).toUpperCase(),
    year: get("year"),
    iso: d.toISOString(),
  };
}
