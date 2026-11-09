/*
 * Emails to buyers the act picks, for one gift campaign (owner, 2026-11-09, D-CAMPAIGN-07).
 *
 * The rule in one line: the words and the people go to Corner Room together; nobody is emailed until
 * Corner Room approves it and someone presses Send. Staff (outside the act's team) send at once.
 * Automatic emails are separate: they go by themselves when a gift is marked Dispatched, Returned or
 * Missing, with words Corner Room already approved (or Corner Room's own).
 *
 * Pure helpers; the API keeps every request, checks the people and sends.
 */

import type { GiftMailSend, GiftRecipientStatus, GiftSendPurpose, GiftSendState, StatusMailStatus } from "@/features/gifts/api";
import type { StatusTone } from "@/lib/format/status";

export const PURPOSES: GiftSendPurpose[] = ["DISPATCHED", "RETURNED", "MISSING", "OTHER"];

export const PURPOSE_LABEL: Record<GiftSendPurpose, string> = {
  DISPATCHED: "Gift on its way",
  RETURNED: "Gift came back",
  MISSING: "Gift is late",
  OTHER: "Other gift news",
};

/** Who a purpose reaches, in one short line. */
export const PURPOSE_HINT: Record<GiftSendPurpose, string> = {
  DISPATCHED: "Only buyers whose gift is marked Dispatched get it.",
  RETURNED: "Only buyers whose gift is marked Returned get it.",
  MISSING: "Only buyers whose gift is marked Missing get it.",
  OTHER: "Everyone you pick gets it, wherever their gift is.",
};

export const SEND_STATE_LABEL: Record<GiftSendState, string> = {
  IN_REVIEW: "With Corner Room",
  RETURNED: "Needs a change",
  APPROVED: "Approved, ready to send",
  SENT: "Sent",
};

export const SEND_STATE_TONE: Record<GiftSendState, StatusTone> = {
  IN_REVIEW: "info",
  RETURNED: "warning",
  APPROVED: "positive",
  SENT: "neutral",
};

const STATUS_PURPOSES = new Set<string>(["DISPATCHED", "RETURNED", "MISSING"]);

/** The purpose that fits the people picked: their shared status when it emails, else other news. */
export function guessPurpose(statuses: GiftRecipientStatus[]): GiftSendPurpose {
  const set = new Set(statuses);
  if (set.size === 1) {
    const only = statuses[0];
    if (STATUS_PURPOSES.has(only)) return only as StatusMailStatus;
  }
  return "OTHER";
}

/** Of the people picked, who this purpose reaches and who it would skip (their gift is elsewhere). */
export function reach<T extends { id: string; status: GiftRecipientStatus; reachable: boolean }>(
  purpose: GiftSendPurpose,
  picked: T[],
): { gets: T[]; skipped: T[] } {
  const gets: T[] = [];
  const skipped: T[] = [];
  for (const p of picked) {
    if (p.reachable && (purpose === "OTHER" || p.status === purpose)) gets.push(p);
    else skipped.push(p);
  }
  return { gets, skipped };
}

/** The main button: what pressing it really does for this person. */
export function sendButtonLabel(atOnce: boolean, n: number): string {
  const who = `${n} ${n === 1 ? "buyer" : "buyers"}`;
  return atOnce ? `Send now to ${who}` : `Send for approval (${who})`;
}

/** The promise under the main button, so nobody wonders what happens next. */
export function sendPromise(atOnce: boolean): string {
  return atOnce
    ? "You're Corner Room staff, so this goes out the moment you press it."
    : "Corner Room checks the words and the people together. Nobody is emailed until it's approved and you press Send.";
}

/** Said after the main button, from what the API came back with. */
export function sentLine(atOnce: boolean, sent: number | null | undefined, skipped: number | null | undefined): string {
  if (!atOnce) return "Sent to Corner Room. You'll find it under Picked-buyer emails; once it's approved, press Send.";
  const s = sent ?? 0;
  const k = skipped ?? 0;
  if (!s) return "Nobody was emailed: none of them still has a gift in that status or an email address.";
  return `Emailed ${s} ${s === 1 ? "buyer" : "buyers"}.${k ? ` ${k} skipped: their gift moved on or they have no email.` : ""}`;
}

/** One line for a request's card, from its state. */
export function sendStatusLine(send: GiftMailSend): string {
  const n = send.recipient_ids.length;
  const people = `${n} ${n === 1 ? "person" : "people"}`;
  if (send.state === "IN_REVIEW") return `${people} picked. Corner Room is checking it; nobody has been emailed.`;
  if (send.state === "RETURNED") return `Corner Room asked for a change: ${send.review_note ?? "see the note"}`;
  if (send.state === "APPROVED") return `Approved for ${people}. Nobody has been emailed yet: press Send when you're ready.`;
  const skipped = send.skipped_count ? `, ${send.skipped_count} skipped` : "";
  return `Emailed ${send.sent_count} of ${people}${skipped}.`;
}

/** What needs the act now across these requests: approved ones to send, sent-back ones to fix. */
export function needsYou(sends: GiftMailSend[] | undefined): { ready: number; fix: number; waiting: number } {
  const list = sends ?? [];
  return {
    ready: list.filter((s) => s.state === "APPROVED").length,
    fix: list.filter((s) => s.state === "RETURNED").length,
    waiting: list.filter((s) => s.state === "IN_REVIEW").length,
  };
}
