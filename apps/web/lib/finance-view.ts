/** Display-only helpers. UI is not the ledger. */

export function formatMinor(amountMinor: number, currencyCode: string): string {
  return `${amountMinor} ${currencyCode}`;
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
