/**
 * Money display (D-P16-03, audit OD-09).
 *
 * The API sends amount_minor (integer) + currency_code. This module only shifts the decimal point
 * by the currency's ISO 4217 minor-unit exponent and formats with Intl. It never adds, rounds,
 * converts or computes. Invalid or missing input returns null so the UI can say "Not available".
 */
import { intlLocale, type DisplayLocale } from "./locale";

export type MinorAmount = number | string | bigint;

export interface MoneyValue {
  amount_minor: MinorAmount | null | undefined;
  currency_code: string | null | undefined;
}

export interface MoneyFormatOptions {
  locale?: DisplayLocale;
  /**
   * "auto": drop a zero minor part on consumer surfaces (৳1,500).
   * "always": show the full exponent; use in tables and finance views (৳1,500.00).
   */
  minorDigits?: "auto" | "always";
  signDisplay?: "auto" | "always" | "exceptZero" | "negative";
}

export interface FormattedMoney {
  /** Display string, e.g. "৳1,50,000". */
  text: string;
  /** Intl parts, so components can style the currency symbol separately. */
  parts: Intl.NumberFormatPart[];
  /** Screen-reader text with the ISO code, e.g. "BDT 1,50,000". */
  accessibleText: string;
  currency: string;
  isNegative: boolean;
}

const INTEGER = /^-?\d+$/;
const ZERO = BigInt(0);
const TEN = BigInt(10);
const ISO_CODE = /^[A-Z]{3}$/;

function toBigInt(value: MinorAmount): bigint | null {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return Number.isSafeInteger(value) ? BigInt(value) : null;
  if (typeof value === "string" && INTEGER.test(value.trim())) return BigInt(value.trim());
  return null;
}

/** ISO 4217 minor-unit exponent as known to Intl (BDT 2, JPY 0, KWD 3). Null for an unknown code. */
export function currencyExponent(currencyCode: string): number | null {
  if (!ISO_CODE.test(currencyCode)) return null;
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency: currencyCode }).resolvedOptions()
      .maximumFractionDigits ?? null;
  } catch {
    return null;
  }
}

/** Exact decimal string for a minor amount: (150050n, 2) -> "1500.50". No floating point. */
export function minorToDecimalString(amountMinor: bigint, exponent: number): string {
  const negative = amountMinor < ZERO;
  const digits = (negative ? -amountMinor : amountMinor).toString();
  if (exponent === 0) return (negative ? "-" : "") + digits;
  const padded = digits.padStart(exponent + 1, "0");
  const whole = padded.slice(0, padded.length - exponent);
  const minor = padded.slice(padded.length - exponent);
  return `${negative ? "-" : ""}${whole}.${minor}`;
}

export function formatMoneyParts(value: MoneyValue | null | undefined, options: MoneyFormatOptions = {}): FormattedMoney | null {
  if (!value || value.amount_minor === null || value.amount_minor === undefined) return null;
  const currency = (value.currency_code ?? "").trim().toUpperCase();
  const exponent = currencyExponent(currency);
  const minor = toBigInt(value.amount_minor);
  if (exponent === null || minor === null) return null;

  const decimal = minorToDecimalString(minor, exponent);
  const minorIsZero = exponent === 0 || minor % TEN ** BigInt(exponent) === ZERO;
  const digits = options.minorDigits === "always" || !minorIsZero ? exponent : 0;
  const locale = intlLocale(options.locale);
  const base: Intl.NumberFormatOptions = {
    style: "currency",
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    signDisplay: options.signDisplay ?? "auto",
  };

  // Intl accepts exact decimal strings (ES2023); the cast keeps older lib typings happy.
  const exact = decimal as unknown as number;
  const display = new Intl.NumberFormat(locale, { ...base, currencyDisplay: "narrowSymbol" });
  const parts = display.formatToParts(exact);
  const accessibleText = new Intl.NumberFormat(locale, { ...base, currencyDisplay: "code" })
    .format(exact)
    .replace(/ /g, " ");

  return {
    text: parts.map((p) => p.value).join(""),
    parts,
    accessibleText,
    currency,
    isNegative: minor < ZERO,
  };
}

/** Display string or null when the value is missing or malformed. */
export function formatMoney(value: MoneyValue | null | undefined, options?: MoneyFormatOptions): string | null {
  return formatMoneyParts(value, options)?.text ?? null;
}
