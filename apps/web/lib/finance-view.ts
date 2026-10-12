import { formatMoney } from "@/lib/format/money";

/** Display-only helpers. UI is not the ledger. */

/** Finance views show the full minor-unit precision (D-P16-03); unknown currency says so. */
export function formatMinor(amountMinor: number, currencyCode: string): string {
  return formatMoney({ amount_minor: amountMinor, currency_code: currencyCode }, { minorDigits: "always" }) ?? "Not available";
}

export function journalStatusLabel(status: string): string {
  if (status === "POSTED") {
    return "Posted";
  }
  if (status === "REVERSED") {
    return "Reversed";
  }
  return status;
}

export function payoutNeedsSecondApprover(
  amountMinor: number,
  thresholdMinor: number | null,
): boolean {
  if (thresholdMinor === null) {
    return true;
  }
  return amountMinor >= thresholdMinor;
}
