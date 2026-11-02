/*
 * Artist emails in Studio, for staff and on /account (owner, 2026-11-02, D-MAIL-01): words for each
 * state, the audience in a line, and a preview of the fill-ins. Pure helpers; the API writes the real
 * emails and works out who gets them.
 */

import type { MailAudience, MailStatus, MailWho, Reach } from "@/features/artist-mail/api";

export const MAIL_STATUS_LABEL: Record<MailStatus, string> = {
  DRAFT: "Draft",
  IN_REVIEW: "Waiting for Corner Room",
  SENDING: "Sending",
  SENT: "Sent",
};

export const WHO_LABEL: Record<MailWho, string> = {
  ALL: "Everyone who bought it",
  PRESALE: "Pre-sale buyers only",
  PICKED: "People I pick",
};

/** The fill-ins an email can use, with what each becomes. */
export const FILL_INS = [
  { key: "buyer_name", label: "Buyer's name" },
  { key: "music", label: "The music they bought" },
  { key: "artist", label: "Your artist or band name" },
] as const;

const FILL_IN = /\{(buyer_name|music|artist)\}/g;

/** The email as one buyer would read it (the server's fill-in rule: other braces stay as written). */
export function previewFill(text: string, values: { buyer_name: string; music: string; artist: string }): string {
  return text.replace(FILL_IN, (_m, key: keyof typeof values) => values[key]);
}

/** Braced words that aren't fill-ins, so the writer can catch a typo like {name}. */
export function unknownFillIns(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/\{([^{}\s]{1,40})\}/g)) {
    if (!["buyer_name", "music", "artist"].includes(m[1])) found.add(`{${m[1]}}`);
  }
  return [...found];
}

/** "Chaya Pore and Low Tide", "A, B and 2 more": the music an email is about, for a list. */
export function musicLine(titles: string[]): string {
  const t = titles.filter(Boolean);
  if (t.length === 0) return "No music chosen";
  if (t.length === 1) return t[0];
  if (t.length <= 3) return `${t.slice(0, -1).join(", ")} and ${t[t.length - 1]}`;
  return `${t.slice(0, 3).join(", ")} and ${t.length - 3} more`;
}

/** "Pre-sale buyers only of Chaya Pore", "3 picked people who bought Chaya Pore". */
export function audienceLine(a: Pick<MailAudience, "works" | "who" | "picked">): string {
  const music = musicLine(a.works.map((w) => w.title ?? "Not available"));
  if (a.who === "PICKED") return `${a.picked.length} picked ${a.picked.length === 1 ? "person" : "people"} who bought ${music}`;
  if (a.who === "PRESALE") return `Pre-sale buyers of ${music}`;
  return `Everyone who bought ${music}`;
}

/** "Goes to 12 people (2 stopped your emails)". */
export function reachLine(r: Reach | null | undefined): string {
  if (!r) return "Working out who gets it";
  const people = r.count === 0 ? "Nobody yet" : `Goes to ${r.count} ${r.count === 1 ? "person" : "people"}`;
  return r.stopped ? `${people} (${r.stopped} stopped your emails)` : people;
}

/** "Sent to 12 people", "8 of 12 sent". */
export function sentLine(m: { status: MailStatus; recipient_count?: number | null; counts: { PENDING: number; SENT: number; SUPPRESSED: number } }): string | null {
  if (m.status !== "SENDING" && m.status !== "SENT") return null;
  const total = m.recipient_count ?? m.counts.PENDING + m.counts.SENT + m.counts.SUPPRESSED;
  if (m.status === "SENDING") return `${m.counts.SENT} of ${total} sent`;
  const stopped = m.counts.SUPPRESSED ? `, ${m.counts.SUPPRESSED} stopped your emails first` : "";
  return `Sent to ${m.counts.SENT} ${m.counts.SENT === 1 ? "person" : "people"}${stopped}`;
}

/** Picked names: add or take away one reference. */
export function togglePicked(picked: string[], ref: string): string[] {
  return picked.includes(ref) ? picked.filter((r) => r !== ref) : [...picked, ref];
}

/** Whether an email can be sent for review as it stands (the API checks again). */
export function readyToSend(m: { subject: string; body: string; audience: Pick<MailAudience, "works" | "who" | "picked"> }): boolean {
  if (!m.subject.trim() || !m.body.trim() || m.audience.works.length === 0) return false;
  return m.audience.who !== "PICKED" || m.audience.picked.length > 0;
}
