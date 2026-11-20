/*
 * Gift status emails in Studio (owner, 2026-11-07, D-CAMPAIGN-05 and D-CAMPAIGN-06): words for each
 * status and state, which version sends, and the email as one buyer will read it (their own name).
 * Pure helpers; the API keeps the emails, decides what sends and writes the real email.
 * Since owner, 2026-11-20 (D-CAMPAIGN-08) moving a gift emails nobody: the act presses Send update.
 */

import type { GiftRecipientStatus, StatusMail, StatusMailInput, StatusMailPerson, StatusMailSent, StatusMailState, StatusMailStatus } from "@/features/gifts/api";
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
  DISPATCHED: "Sends when you press Send the Dispatched update, never when a gift is just marked dispatched.",
  RETURNED: "Sends when you press Send the Returned update, never when a gift is just marked returned.",
  MISSING: "Sends when you press Send the Missing update, never when a gift is just marked missing.",
};

/** The button that tells buyers (D-CAMPAIGN-08). */
export function updateButtonLabel(status: StatusMailStatus, n?: number): string {
  return `Send the ${STATUS_MAIL_TAB[status]} update${n ? ` to ${n}` : ""}`;
}

/** "3 buyers are marked dispatched and haven't been told yet." */
export function updatesWaitingLine(status: StatusMailStatus, n: number): string {
  const who = `${n} ${n === 1 ? "buyer is" : "buyers are"}`;
  return `${who} marked ${STATUS_MAIL_TAB[status].toLowerCase()} and ${n === 1 ? "hasn't" : "haven't"} been told yet.`;
}

/** After Send update: who was told, and how. */
export function updateSentLine(told: number, emailed: number): string {
  const who = `${told} ${told === 1 ? "buyer" : "buyers"}`;
  if (emailed >= told) return `Told ${who}. Each email shows in the Emails part as On its way, then Sent.`;
  const none = told - emailed;
  return `Told ${who}: ${emailed} by email, ${none} only in their Corner Room account (no email address).`;
}

/** Said after moving gifts into a status that tells the buyer: nobody has been emailed yet. */
export const MOVE_TELLS_NOBODY = "Nobody has been emailed. Send the update when you're ready.";

// --- A buyer's name typed out (owner, 2026-11-20: "Dear Ishmamul" went to every buyer) -----------

// Fill-ins and whole links ([words](https://...)) are never a typed-out name: a link's words can't hold a fill-in.
const FILL_OR_LINK = /\{[a-z_]+\}|\[[^\]\n]*\]\([^)\s]*\)/g;
const WORD = /[\p{L}\p{M}][\p{L}\p{M}\p{N}'_]*/gu;

function cased(w: string): boolean {
  return w[0].toUpperCase() !== w[0].toLowerCase();
}

/**
 * The buyers' names written out in the subject or the greeting line (the first line of the message)
 * instead of the First name fill-in. Mirrors `names_written_out` on the server, which refuses them:
 * a name in a cased script counts only with a capital, words of the act, music and gift never.
 */
export function namesWrittenOut(subject: string, body: string, names: (string | null | undefined)[], ignore: (string | null | undefined)[] = []): string[] {
  const skip = new Set(ignore.flatMap((t) => (t ?? "").match(WORD) ?? []).map((w) => w.toLowerCase()));
  const wanted = new Map<string, string>();
  for (const n of names) {
    for (const w of (n ?? "").match(WORD) ?? []) {
      if ([...w].length >= 3 && !skip.has(w.toLowerCase()) && !wanted.has(w.toLowerCase())) wanted.set(w.toLowerCase(), w[0].toUpperCase() + w.slice(1));
    }
  }
  if (!wanted.size) return [];
  const firstLine = (body ?? "").split("\n").find((l) => l.trim()) ?? "";
  const found: string[] = [];
  for (const part of [subject ?? "", firstLine]) {
    for (const w of part.replace(FILL_OR_LINK, " ").match(WORD) ?? []) {
      const hit = wanted.get(w.toLowerCase());
      if (hit && (!cased(w) || w[0] === w[0].toUpperCase()) && !found.includes(hit)) found.push(hit);
    }
  }
  return found;
}

/** Put the First name fill-in where these names are written out in the subject and greeting line. */
export function firstNameInstead(subject: string, body: string, names: string[]): { subject: string; body: string } {
  if (!names.length) return { subject, body };
  const lower = new Set(names.map((n) => n.toLowerCase()));
  // Fill-ins and link addresses are kept as they are; only plain words are swapped.
  const swap = (text: string) =>
    text
      .split(/(\{[a-z_]+\}|\[[^\]\n]*\]\([^)\s]*\))/)
      .map((piece, i) =>
        i % 2 ? piece : piece.replace(WORD, (w) => (lower.has(w.toLowerCase()) && (!cased(w) || w[0] === w[0].toUpperCase()) ? "{first_name}" : w)),
      )
      .join("");
  const lines = body.split("\n");
  const i = lines.findIndex((l) => l.trim());
  if (i >= 0) lines[i] = swap(lines[i]);
  return { subject: swap(subject), body: lines.join("\n") };
}

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

// --- The workflow in plain words (owner, 2026-11-08: "did the email send or not") -----------------

export type StepTone = "done" | "now" | "waiting" | "problem" | "skip";
export type Step = { title: string; line: string; tone: StepTone };

/** What happens to the act's words: write, approval, buyers get it. One line each, from the API's state. */
export function workflowSteps(item: StatusMail, approvesAtOnce: boolean): Step[] {
  const status = STATUS_MAIL_TAB[item.status].toLowerCase();
  const write: Step =
    item.state === null
      ? { title: "Write your email", line: "Optional. Until you use your own, buyers get Corner Room's wording.", tone: "now" }
      : item.state === "DRAFT"
        ? { title: "Write your email", line: "Saved as a draft. Buyers don't get it yet.", tone: "now" }
        : item.state === "RETURNED"
          ? { title: "Write your email", line: "Corner Room asked for a change. Edit it and send it again.", tone: "problem" }
          : { title: "Write your email", line: "Written.", tone: "done" };
  let approval: Step;
  if (item.state === null) approval = { title: "Approval", line: "Not needed for Corner Room's wording.", tone: "skip" };
  else if (item.state === "IN_REVIEW") approval = { title: "Approval", line: "Waiting for Corner Room. Buyers get the email in use until then.", tone: "waiting" };
  else if (item.state === "APPROVED") approval = { title: "Approval", line: "Approved. Your email is in use.", tone: "done" };
  else if (item.state === "RETURNED") approval = { title: "Approval", line: `Sent back: ${item.review_note ?? "see the note"}`, tone: "problem" };
  else if (approvesAtOnce) approval = { title: "Approval", line: "You can approve your own emails, so Use this email puts it in use at once.", tone: "now" };
  else approval = { title: "Approval", line: "Press Send for approval when it's ready. Corner Room checks it once.", tone: "now" };
  const sent = item.sent_count;
  const deliver: Step = {
    title: "Buyers get it",
    line: `When you press Send the ${STATUS_MAIL_TAB[item.status]} update on Collectibles, after marking gifts ${status}.${sent ? ` ${sentCountLine(sent)} so far.` : ""}`,
    tone: sent ? "done" : "skip",
  };
  return [write, approval, deliver];
}

/** Whose words buyers get now. */
export function inUseLabel(item: StatusMail): string {
  return item.live ? "Your approved email" : "Corner Room's wording";
}

/** The act's newer words that are not what buyers get yet, in one line, or null when there are none. */
export function notInUseLine(item: StatusMail): string | null {
  if (item.state === "DRAFT") return "Your newer changes are saved but not in use yet.";
  if (item.state === "IN_REVIEW") return "Your newer changes are waiting for Corner Room and not in use yet.";
  if (item.state === "RETURNED") return "Corner Room sent your changes back, so they're not in use.";
  return null;
}

/** The main button: what pressing it really does for this person. */
export function submitLabel(approvesAtOnce: boolean): string {
  return approvesAtOnce ? "Use this email" : "Send for approval";
}

/** Said after the main button, from the state the API came back with. */
export function submitDoneLine(next: StatusMail | undefined): string {
  const status = next ? STATUS_MAIL_TAB[next.status].toLowerCase() : "";
  if (next?.state === "APPROVED") return `Approved and in use. Send the ${next ? STATUS_MAIL_TAB[next.status] : ""} update sends this email to buyers whose gift is marked ${status}. Nobody was emailed just now.`;
  return "Sent to Corner Room for approval. Nobody was emailed. Until it's approved, buyers get the email in use now.";
}

export const DELIVERY_WORD: Record<StatusMailSent["state"], string> = {
  PENDING: "On its way",
  SENT: "Sent",
  FAILED: "Couldn't send",
  SUPPRESSED: "Not sent",
};

/** The newest email of this status to this buyer, if any. */
export function lastEmail(history: StatusMailSent[], recipientId: string, status: StatusMailStatus): StatusMailSent | null {
  return history.find((h) => h.recipient_id === recipientId && h.gift_status === status) ?? null;
}

/** Whether any email is still on its way (the page then asks again shortly). */
export function anyOnItsWay(history: StatusMailSent[] | undefined): boolean {
  return (history ?? []).some((h) => h.state === "PENDING");
}

/** "Samiul, Rumi and 3 others" */
export function namesLine(names: string[]): string {
  const shown = names.map((n) => n || "a buyer with no name");
  if (shown.length <= 3) return shown.length < 2 ? (shown[0] ?? "") : `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
  return `${shown.slice(0, 2).join(", ")} and ${shown.length - 2} others`;
}

/** After sending now: who it went to, and who it skipped. */
export function sentNowLine(sent: number, skipped: number, names: string[]): string {
  if (!sent) return "Nobody was emailed: none of the people you picked still has a gift in this status, or has an email address.";
  const who = `${sent} ${sent === 1 ? "buyer" : "buyers"}${names.length ? ` (${namesLine(names)})` : ""}`;
  return `Emailed ${who}. Each one's line below shows On its way, then Sent.${skipped ? ` ${skipped} skipped: their gift moved on or they have no email.` : ""}`;
}
