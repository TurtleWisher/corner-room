/* Pure helpers for the Studio sales page. The API counts and sums every sale; these only word
 * the results and shape API amounts for the Money component. */

import type { MoneyValue } from "@/lib/format/money";
import { RELEASE_TYPE_LABEL } from "@/lib/studio-view";

/** "Song" for a song sold on its own; the release type for a whole release. */
export function saleKindLabel(item: { subject_type: string; release_type: string | null }): string {
  if (item.subject_type === "TRACK") return "Song";
  return (item.release_type && RELEASE_TYPE_LABEL[item.release_type]) || "Release";
}

/** "1 sale", "3 sales · 1 refunded". */
export function salesCountText(sold: number, refunded: number): string {
  const base = `${sold} ${sold === 1 ? "sale" : "sales"}`;
  return refunded > 0 ? `${base} · ${refunded} refunded` : base;
}

export function money(amount_minor: number, currency_code: string): MoneyValue {
  return { amount_minor, currency_code };
}
