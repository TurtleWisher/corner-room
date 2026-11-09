/*
 * Gift campaigns in Studio and for staff (owner, 2026-10-28, D-CAMPAIGN-01, D-CAMPAIGN-02), and the
 * tracking of each collectible (owner, 2026-11-06, D-CAMPAIGN-03): words for each state, and which
 * gifts an action applies to. Pure helpers; the API decides the rules and the moves allowed.
 */

import type { GiftCampaign, GiftCampaignStatus, GiftRecipient, GiftRecipientStatus } from "@/features/gifts/api";

export const CAMPAIGN_STATUS_LABEL: Record<GiftCampaignStatus, string> = {
  DRAFT: "Draft",
  IN_REVIEW: "Waiting for Corner Room",
  ACTIVE: "Live",
  PAUSED: "Paused",
  ENDED: "Ended",
};

/** Tracking order, as the tiles and summaries show it. */
export const RECIPIENT_STATUSES: GiftRecipientStatus[] = ["YET_TO_SEND", "PREPARED", "DISPATCHED", "RECEIVED", "RETURNED", "MISSING"];

export const RECIPIENT_STATUS_LABEL: Record<GiftRecipientStatus, string> = {
  YET_TO_SEND: "Not prepared",
  PREPARED: "Prepared",
  DISPATCHED: "Dispatched",
  RECEIVED: "Received",
  RETURNED: "Returned",
  MISSING: "Missing",
};

/** The button that moves chosen gifts to a status. */
export const MOVE_LABEL: Record<GiftRecipientStatus, string> = {
  YET_TO_SEND: "Mark not prepared",
  PREPARED: "Mark prepared",
  DISPATCHED: "Dispatch",
  RECEIVED: "Mark received",
  RETURNED: "Mark returned",
  MISSING: "Mark missing",
};

/** Moves that email the buyer (owner, 2026-11-06), said beside the buttons before they are pressed. */
export const MOVE_TELLS_BUYER: Partial<Record<GiftRecipientStatus, string>> = {
  DISPATCHED: "Dispatching emails each buyer that their gift is on its way and should reach them in the next few days.",
  RETURNED:
    "Marking returned emails each buyer that the gift came back, asks them to check their delivery address and says it will be sent again.",
  MISSING: "Marking missing emails each buyer that the gift hasn't arrived yet and that another will be sent if it doesn't turn up.",
};

export const SENDER_LABEL = { ARTIST: "You send the gifts", CORNER_ROOM: "Corner Room sends the gifts" } as const;

/** "12 gifts: 3 not prepared, 4 prepared, 5 received" (statuses with none are left out). */
export function countsLine(c: GiftCampaign["counts"]): string {
  if (!c.TOTAL) return "No one has earned this gift yet";
  const parts = RECIPIENT_STATUSES.filter((s) => (c[s] ?? 0) > 0).map((s) => `${c[s]} ${RECIPIENT_STATUS_LABEL[s].toLowerCase()}`);
  return `${c.TOTAL} ${c.TOTAL === 1 ? "gift" : "gifts"}: ${parts.join(", ")}`;
}

/** What the campaign covers, for a list: "Chaya Pore" or "Chaya Pore and 2 more". */
export function worksLine(works: { title?: string }[]): string {
  if (works.length === 0) return "No music chosen";
  const first = works[0].title ?? "Not available";
  return works.length === 1 ? first : `${first} and ${works.length - 1} more`;
}

export type GiftTransitions = Partial<Record<GiftRecipientStatus, GiftRecipientStatus[]>>;

/** Whether a gift in `from` may move to `to`, by the API's own list. */
export function canMove(transitions: GiftTransitions, from: GiftRecipientStatus, to: GiftRecipientStatus): boolean {
  return (transitions[from] ?? []).includes(to);
}

/** The chosen gifts that can move to `to` (others are left as they are). */
export function actionable(recipients: GiftRecipient[], chosen: Set<string>, to: GiftRecipientStatus, transitions: GiftTransitions): string[] {
  return recipients.filter((r) => chosen.has(r.id) && canMove(transitions, r.status, to)).map((r) => r.id);
}

/** The moves the chosen gifts allow, in tracking order, each with the gifts it applies to. */
export function movesFor(recipients: GiftRecipient[], chosen: Set<string>, transitions: GiftTransitions): { to: GiftRecipientStatus; ids: string[] }[] {
  return RECIPIENT_STATUSES.map((to) => ({ to, ids: actionable(recipients, chosen, to, transitions) })).filter((m) => m.ids.length > 0);
}

/** Whether a dispatch time is still to come. */
export function isLater(iso: string | null, now: Date): boolean {
  return iso !== null && new Date(iso).getTime() > now.getTime();
}

/** The date a row shows beside its status: when it ended, left, will leave or was prepared. */
export function trackedSince(r: GiftRecipient): { label: string; at: string } | null {
  if (r.outcome_at && (r.status === "RECEIVED" || r.status === "RETURNED" || r.status === "MISSING")) {
    return { label: RECIPIENT_STATUS_LABEL[r.status], at: r.outcome_at };
  }
  if (r.status === "DISPATCHED" && r.dispatched_at) return { label: "Left", at: r.dispatched_at };
  if (r.status === "PREPARED" && r.dispatch_at) return { label: "Leaves", at: r.dispatch_at };
  if (r.status === "PREPARED" && r.prepared_at) return { label: "Prepared", at: r.prepared_at };
  return null;
}

/** Whether staff are looking at a new campaign or a change to a live one. */
export function reviewKind(c: Pick<GiftCampaign, "status" | "pending">): "new" | "change" | null {
  if (c.status === "IN_REVIEW") return "new";
  if (c.pending && Object.keys(c.pending).length) return "change";
  return null;
}

/** The act's emails waiting for staff, as staff read it in the queue: its own automatic wording
 * (D-CAMPAIGN-05) and emails to buyers it picked, words and people together (D-CAMPAIGN-07). */
export function emailsLine(c: Pick<GiftCampaign, "emails_waiting" | "sends_waiting">): string | null {
  const words = c.emails_waiting ?? 0;
  const sends = c.sends_waiting ?? 0;
  const parts: string[] = [];
  if (words) parts.push(`${words} gift ${words === 1 ? "email" : "emails"} written by the artist ${words === 1 ? "waits" : "wait"} for approval`);
  if (sends) parts.push(`${sends} ${sends === 1 ? "email" : "emails"} to buyers the artist picked ${sends === 1 ? "waits" : "wait"} for approval`);
  return parts.length ? parts.join("; ") : null;
}

/** What a campaign waits for in the staff queue when it isn't a new campaign or a change. */
export function waitingKindLabel(c: Pick<GiftCampaign, "counts" | "emails_waiting" | "sends_waiting">): string {
  const people = (c.counts.WAITING ?? 0) > 0;
  const emails = (c.emails_waiting ?? 0) + (c.sends_waiting ?? 0) > 0;
  if (people && emails) return "People and emails waiting";
  return emails ? "Emails waiting" : "People waiting";
}

/** People the act added by hand, waiting for staff (D-CAMPAIGN-04), as staff read it in the queue. */
export function waitingLine(c: Pick<GiftCampaign, "counts">): string | null {
  const n = c.counts.WAITING ?? 0;
  if (!n) return null;
  return `${n} ${n === 1 ? "person" : "people"} added by the artist ${n === 1 ? "waits" : "wait"} for approval`;
}
