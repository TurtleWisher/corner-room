/*
 * The act's own collectible status emails in Studio (owner, 2026-11-07, D-CAMPAIGN-05): words for
 * each status and state, and the email as a buyer will read it. Pure helpers; the API keeps the
 * emails, decides what sends and writes the real email.
 */

import type { StatusMail, StatusMailState, StatusMailStatus } from "@/features/gifts/api";
import { NO_NAME, type MailValues } from "@/lib/artist-mail-view";

export const STATUS_MAIL_TITLE: Record<StatusMailStatus, string> = {
  DISPATCHED: "Gift dispatched",
  RETURNED: "Gift returned",
  MISSING: "Gift missing",
};

export const STATUS_MAIL_WHEN: Record<StatusMailStatus, string> = {
  DISPATCHED: "Sends when a gift is dispatched, now or at its set time.",
  RETURNED: "Sends when a gift is marked returned.",
  MISSING: "Sends when a gift is marked missing.",
};

export const STATE_LABEL: Record<StatusMailState, string> = {
  DRAFT: "Your draft, not sent for review",
  IN_REVIEW: "Waiting for Corner Room",
  APPROVED: "Approved",
  RETURNED: "Sent back",
};

/** Which words go out now, in one line. */
export function sendingLine(item: Pick<StatusMail, "live" | "state">): string {
  if (item.live) {
    return item.state === "APPROVED" ? "Your words send." : "Your approved words send until Corner Room approves your changes.";
  }
  return "Corner Room's wording sends until Corner Room approves yours.";
}

/** The words a buyer would get now: the act's approved ones, else Corner Room's. */
export function sendingWords(item: StatusMail): { subject: string; body: string } {
  return item.live && item.live_subject && item.live_body
    ? { subject: item.live_subject, body: item.live_body }
    : { subject: item.default_subject, body: item.default_body };
}

/** The words to start editing from: the act's own, else Corner Room's to change. */
export function startingWords(item: StatusMail): { subject: string; body: string } {
  return item.subject && item.body ? { subject: item.subject, body: item.body } : { subject: item.default_subject, body: item.default_body };
}

/** The fill-ins as a buyer without a name on file would read them (the server says "friend"). */
export function previewValues(artist: string, music: string, gift: string): MailValues {
  return { first_name: NO_NAME, buyer_name: NO_NAME, artist, music: music || "your music", gift };
}

/** "Sent 12 times", for the report line. */
export function sentCountLine(n: number): string {
  if (!n) return "Not sent yet";
  return `Sent ${n} ${n === 1 ? "time" : "times"}`;
}
