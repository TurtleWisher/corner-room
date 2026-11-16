/* Open price (owner, 2026-11-15, D-OPEN-PRICE-01): the artist's agreed price is the lowest amount
 * and each buyer chooses what to pay from there up. Nothing here decides a price: the page reads
 * what the buyer typed and the server checks it again before any order exists. */

import { parsePriceToMinor } from "@/lib/studio-view";

export type OpenOffer = { amount_minor: number; open_price?: boolean; open_price_max_minor?: number | null; open_price_min_minor?: number | null };

/** The range every open-price amount must fall in (owner, 2026-11-17: ৳10 to ৳100,000), as the
 * server sends it; a missing end is open. */
export type OpenRange = { min_minor?: number | null; max_minor?: number | null };

/** The least a buyer can pay: the server's floor for this offer, else the artist's lowest. */
export function lowestFor(offer: OpenOffer): number {
  return Math.max(offer.amount_minor, offer.open_price_min_minor ?? 0);
}

/** Whether an artist's lowest amount fits the range; the server checks again. */
export function rangeProblem(minor: number, range: OpenRange | null | undefined): "TOO_LOW" | "TOO_HIGH" | null {
  if (range?.min_minor && minor < range.min_minor) return "TOO_LOW";
  if (range?.max_minor && minor > range.max_minor) return "TOO_HIGH";
  return null;
}

/** The lowest amount as the buyer would type it: 10000 minor units reads "100", 12050 reads "120.50". */
export function amountAsTyped(minor: number): string {
  const whole = Math.trunc(minor / 100);
  const part = minor % 100;
  return part === 0 ? String(whole) : `${whole}.${String(part).padStart(2, "0")}`;
}

export type ChosenAmount = { minor: number; problem: null } | { minor: null; problem: "EMPTY" | "NOT_A_NUMBER" | "TOO_LOW" | "TOO_HIGH" };

/** What the buyer typed, checked against the offer the way the server will check it. */
export function readChosenAmount(text: string, offer: OpenOffer): ChosenAmount {
  if (!text.trim()) return { minor: null, problem: "EMPTY" };
  const minor = parsePriceToMinor(text);
  if (minor === null) return { minor: null, problem: "NOT_A_NUMBER" };
  if (minor < lowestFor(offer)) return { minor: null, problem: "TOO_LOW" };
  if (offer.open_price_max_minor && minor > offer.open_price_max_minor) return { minor: null, problem: "TOO_HIGH" };
  return { minor, problem: null };
}

/** Plain words for each problem. `lowest` and `highest` arrive already formatted as money. */
export function amountProblemWords(problem: NonNullable<ChosenAmount["problem"]>, lowest: string, highest: string | null): string {
  switch (problem) {
    case "EMPTY":
      return `Type what you'd like to pay, ${lowest} or more.`;
    case "NOT_A_NUMBER":
      return "Type an amount like 150 or 150.50.";
    case "TOO_LOW":
      return `The lowest amount for this music is ${lowest}.`;
    case "TOO_HIGH":
      return highest ? `The most you can pay for this music is ${highest}.` : "That is more than one payment can be.";
  }
}

/** The word before an open price wherever it is listed: "From ৳100". */
export function priceLead(offer: Pick<OpenOffer, "open_price">): string | null {
  return offer.open_price ? "From" : null;
}
