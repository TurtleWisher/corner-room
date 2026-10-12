/**
 * Display locales. English ships first (OD-14); Bangla is designed in from the start.
 * "en" uses South Asian (lakh) grouping with Latin digits, per D-P16-03.
 */
export type DisplayLocale = "en" | "bn";

const INTL_LOCALE: Record<DisplayLocale, string> = {
  en: "en-IN",
  bn: "bn-BD",
};

export function intlLocale(locale: DisplayLocale = "en"): string {
  return INTL_LOCALE[locale] ?? INTL_LOCALE.en;
}

/** Dates read day-month-year in Bangladesh: "Fri 17 Oct 2025". */
const DATE_LOCALE: Record<DisplayLocale, string> = {
  en: "en-GB",
  bn: "bn-BD",
};

export function intlDateLocale(locale: DisplayLocale = "en"): string {
  return DATE_LOCALE[locale] ?? DATE_LOCALE.en;
}

/** Copy for values the API did not provide. Never render 0 for unknown. */
export const UNAVAILABLE = "Not available";
export const NOT_ATTRIBUTED = "Not attributed";
