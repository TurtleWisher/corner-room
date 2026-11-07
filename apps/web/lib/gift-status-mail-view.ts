/*
 * Gift status emails in Studio (owner, 2026-11-07, D-CAMPAIGN-05 and D-CAMPAIGN-06): words for each
 * status and state, which version sends, and the email as one buyer will read it (their own name).
 * Pure helpers; the API keeps the emails, decides what sends and writes the real email.
 */

import type { GiftRecipientStatus, StatusMail, StatusMailInput, StatusMailPerson, StatusMailState, StatusMailStatus } from "@/features/gifts/api";
import { plainText, type MailValues } from "@/lib/artist-mail-view";

export const STATUS_MAIL_TITLE: Record<StatusMailStatus, string> = {
  DISPATCHED: "Gift dispatched",
  RETURNED: "Gift returned",
  MISSING: "Gift missing",
};

export const STATUS_MAIL_TAB: Record<StatusMailStatus, string> = {
  DISPATCHED: "Dispatched",
  RETURNED: "Returned",
  MISSING: "Missing",
};

export const STATUS_MAIL_WHEN: Record<StatusMailStatus, string> = {
  DISPATCHED: "Sends by itself when a gift is dispatched, now or at its set time.",
  RETURNED: "Sends by itself when a gift is marked returned.",
  MISSING: "Sends by itself when a gift is marked missing.",
};

export const STATE_LABEL: Record<StatusMailState, string> = {
  DRAFT: "Your draft, not sent for review",
  IN_REVIEW: "Waiting for Corner Room",
  APPROVED: "Approved",
  RETURNED: "Sent back",
};

/** Said in place of a name only when Corner Room has none (as the server does). */
export const NO_NAME = "there";

/** Which version goes out now, in one line. */
export function sendingLine(item: Pick<StatusMail, "live" | "state">): string {
  if (item.live) {
    return item.state === "APPROVED" ? "Your email sends." : "Your approved email sends until Corner Room approves your changes.";
  }
  return "Corner Room's wording sends until Corner Room approves yours.";
}

/** The version a buyer gets now: the act's approved one, else Corner Room's. */
export function sendingVersion(item: StatusMail): StatusMailInput {
  if (item.live && item.live_subject && item.live_body) {
    return {
      subject: item.live_subject,
      body: item.live_body,
      button_label: item.live_button_label,
      button_url: item.live_button_url,
      file_ids: item.live_file_ids ?? [],
    };
  }
  return { subject: item.default_subject, body: item.default_body, button_label: null, button_url: null, file_ids: [] };
}

/** Where editing starts: the act's own version, else Corner Room's to change. */
export function startingVersion(item: StatusMail): StatusMailInput {
  if (item.subject && item.body) {
    return { subject: item.subject, body: item.body, button_label: item.button_label, button_url: item.button_url, file_ids: item.file_ids ?? [] };
  }
  return sendingVersion(item);
}

/** Whether the version being edited differs from the saved one. */
export function changed(a: StatusMailInput, b: StatusMailInput): boolean {
  return (
    a.subject !== b.subject ||
    a.body !== b.body ||
    (a.button_label ?? "") !== (b.button_label ?? "") ||
    (a.button_url ?? "") !== (b.button_url ?? "") ||
    a.file_ids.join(",") !== b.file_ids.join(",")
  );
}

/** What the button needs before saving, or null when it's fine (both words and an https link, or neither). */
export function buttonProblem(label: string | null, url: string | null): string | null {
  const l = (label ?? "").trim();
  const u = (url ?? "").trim();
  if (!l && !u) return null;
  if (!l) return "Write the words on the button, or clear its link.";
  if (!u) return "Add the web address the button opens, or clear its words.";
  if (!/^https?:\/\/\S+$/.test(u)) return "The button's address must start with https://";
  return null;
}

/** Each fill-in as this buyer reads it: their own name, the act, the music and the gift. */
export function previewValues(person: Pick<StatusMailPerson, "name"> | null, artist: string, music: string, gift: string): MailValues {
  const name = (person?.name ?? "").trim();
  return { first_name: name.split(/\s+/)[0] || NO_NAME, buyer_name: name || NO_NAME, artist, music: music || "your music", gift };
}

/** The buyers whose gift is in this status: the ones a send for this status reaches. */
export function peopleIn<T extends { status: GiftRecipientStatus; reachable: boolean }>(people: T[], status: StatusMailStatus): T[] {
  return people.filter((p) => p.status === status && p.reachable);
}

/** A subject as every buyer reads it: the act, music and gift filled in, names as "(their name)". */
export function subjectForAll(subject: string, artist: string, music: string, gift: string): string {
  return plainText(subject, { first_name: "(their first name)", buyer_name: "(their name)", artist, music: music || "your music", gift });
}

/** "Sent 12 times", for the report line. */
export function sentCountLine(n: number): string {
  if (!n) return "Not sent yet";
  return `Sent ${n} ${n === 1 ? "time" : "times"}`;
}
