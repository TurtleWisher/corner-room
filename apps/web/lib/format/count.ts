import { intlLocale, type DisplayLocale } from "./locale";

/**
 * Whole counts (followers, listens) with the same lakh grouping as money (D-P16-03): 1,23,456.
 * Never estimated or rounded to "1.2K", so the number is exactly what the API counted.
 */
export function formatCount(value: number | null | undefined, locale: DisplayLocale = "en"): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "Not available";
  return new Intl.NumberFormat(intlLocale(locale), { maximumFractionDigits: 0 }).format(Math.max(0, Math.trunc(value)));
}
