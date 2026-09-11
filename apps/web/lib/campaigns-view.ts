/** Display-only campaign helpers. UI is not analytics or finance. */

export function campaignAttributionLabel(status: string): string {
  if (status === "ATTRIBUTION_UNDEFINED") {
    return "Not attributed";
  }
  return status;
}

export function campaignStatusLabel(status: string): string {
  return status.replaceAll("_", " ");
}

export const CAMPAIGN_ACTIONS = [
  "prepare_content",
  "schedule",
  "activate",
  "optimize",
  "complete",
  "report",
  "cancel",
] as const;
