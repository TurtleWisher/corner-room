/*
 * Gift campaigns in Studio and for staff (owner, 2026-10-28, D-CAMPAIGN-01, D-CAMPAIGN-02): words
 * for each state, and which gifts an action applies to. Pure helpers; the API decides the rules.
 */

import type { GiftCampaign, GiftCampaignStatus, GiftRecipient, GiftRecipientStatus } from "@/features/gifts/api";

export const CAMPAIGN_STATUS_LABEL: Record<GiftCampaignStatus, string> = {
  DRAFT: "Draft",
  IN_REVIEW: "Waiting for Corner Room",
  ACTIVE: "Live",
  PAUSED: "Paused",
  ENDED: "Ended",
};

export const RECIPIENT_STATUS_LABEL: Record<GiftRecipientStatus, string> = {
  YET_TO_SEND: "Yet to send",
  IN_PROCESS: "In process",
  SENT: "Sent",
};

export const SENDER_LABEL = { ARTIST: "You send the gifts", CORNER_ROOM: "Corner Room sends the gifts" } as const;

/** "12 gifts: 5 sent, 3 in process, 4 yet to send". */
export function countsLine(c: GiftCampaign["counts"]): string {
  if (!c.TOTAL) return "No one has earned this gift yet";
  return `${c.TOTAL} ${c.TOTAL === 1 ? "gift" : "gifts"}: ${c.SENT} sent, ${c.IN_PROCESS} in process, ${c.YET_TO_SEND} yet to send`;
}

/** What the campaign covers, for a list: "Chaya Pore" or "Chaya Pore and 2 more". */
export function worksLine(works: { title?: string }[]): string {
  if (works.length === 0) return "No music chosen";
  const first = works[0].title ?? "Not available";
  return works.length === 1 ? first : `${first} and ${works.length - 1} more`;
}

/** The chosen gifts an action can apply to: dispatch takes those yet to send, "sent" takes the rest. */
export function actionable(recipients: GiftRecipient[], chosen: Set<string>, action: "dispatch" | "sent"): string[] {
  return recipients
    .filter((r) => chosen.has(r.id) && (action === "dispatch" ? r.status === "YET_TO_SEND" : r.status !== "SENT"))
    .map((r) => r.id);
}

/** Whether staff are looking at a new campaign or a change to a live one. */
export function reviewKind(c: Pick<GiftCampaign, "status" | "pending">): "new" | "change" | null {
  if (c.status === "IN_REVIEW") return "new";
  if (c.pending && Object.keys(c.pending).length) return "change";
  return null;
}
