/* Music gifts (owner, 2026-11-06, D-GIFT-MUSIC-01): words and list handling for Studio. Pure; the
 * server checks every address again and decides who gets what. */

import type { MusicGiftCounts, MusicGiftPerson, MusicGiftStatus, PersonInput } from "@/features/music-gifts/api";
import { FILL_INS } from "@/lib/artist-mail-view";
import type { Voice } from "@/lib/artist-mail-starters";

export const GIFT_STATUS_LABEL: Record<MusicGiftStatus, string> = {
  DRAFT: "Draft",
  IN_REVIEW: "Waiting for Corner Room",
  SCHEDULED: "Approved, waiting for its time",
  SENT: "Given",
};

export const PERSON_STATUS_LABEL: Record<MusicGiftPerson["status"], string> = {
  WAITING: "Not given yet",
  GIVEN: "Has it now",
  WAITING_ACCOUNT: "Emailed, gets it when they sign up",
  ALREADY_OWNED: "Already had it",
};

export const EMAIL_STATUS_LABEL: Record<NonNullable<MusicGiftPerson["email_status"]>, string> = {
  PENDING: "Sending",
  SENT: "Email sent",
  SUPPRESSED: "Not emailed: they stopped your emails",
  FAILED: "Email didn't send",
};

/** The fill-in buttons for a gift's email: {music} is the music being given. */
export const GIFT_FILL_INS = FILL_INS.map((f) =>
  f.key === "first_name"
    ? { ...f, hint: "Each person's first name, if you gave one" }
    : f.key === "buyer_name"
      ? { ...f, hint: "Each person's name, if you gave one" }
      : f.key === "music"
        ? { ...f, label: "The music", hint: "The songs and releases you're giving" }
        : f,
);

const EMAIL = /^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$/;
const ANGLE = /^(.*?)<\s*([^<>\s]+@[^<>\s]+)\s*>(.*)$/;

export function isEmail(value: string): boolean {
  return EMAIL.test(value.trim()) && value.trim().length <= 320;
}

/**
 * People from pasted text: one per line, or several on a line split by commas or semicolons. Each
 * may be "email", "Name <email>", "email, Name" or sheet columns (tabs) with the email in any
 * column, then a name and a personal note. Addresses are lower-cased and listed once.
 */
export function parsePeople(text: string): { people: PersonInput[]; invalid: string[] } {
  const people: PersonInput[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  const add = (email: string, name: string | null, note: string | null) => {
    const clean = email.trim().replace(/^mailto:/i, "").toLowerCase();
    if (!isEmail(clean)) {
      invalid.push(email.trim());
      return;
    }
    if (seen.has(clean)) return;
    seen.add(clean);
    people.push({ email: clean, name: name?.trim().replace(/\s+/g, " ") || null, note: note?.trim() || null });
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.includes("\t")) {
      const cols = line.split("\t").map((c) => c.trim());
      const at = cols.findIndex((c) => c.includes("@"));
      if (at < 0) {
        invalid.push(line);
        continue;
      }
      const rest = cols.filter((_, i) => i !== at);
      add(cols[at], rest[0] || null, rest.slice(1).filter(Boolean).join(" ") || null);
      continue;
    }
    const angled = line.match(ANGLE);
    if (angled) {
      add(angled[2], angled[1].replace(/["',;]/g, "").trim() || null, null);
      continue;
    }
    const parts = line.split(/[;,]/).map((p) => p.trim()).filter(Boolean);
    const emails = parts.filter((p) => p.includes("@"));
    if (emails.length > 1) {
      for (const e of emails) add(e, null, null);
      for (const p of parts.filter((p) => !p.includes("@"))) invalid.push(p);
      continue;
    }
    if (emails.length === 1) {
      const words = parts.filter((p) => !p.includes("@"));
      // "email Name" with no comma: the email is the first word.
      const [first, ...after] = emails[0].split(/\s+/);
      add(first, [after.join(" "), ...words].filter(Boolean).join(" ") || null, null);
      continue;
    }
    invalid.push(line);
  }
  return { people, invalid };
}

/** The list with new people added after it, each address once (earlier rows win). */
export function mergePeople(current: PersonInput[], added: PersonInput[]): PersonInput[] {
  const seen = new Set(current.map((p) => p.email.toLowerCase()));
  const out = [...current];
  for (const p of added) {
    const key = p.email.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(p);
    }
  }
  return out;
}

/** "3 people" before it goes; "2 have it · 1 to sign up" after. */
export function countsLine(counts: MusicGiftCounts, status: MusicGiftStatus): string {
  const people = `${counts.TOTAL} ${counts.TOTAL === 1 ? "person" : "people"}`;
  if (status !== "SENT") return people;
  const parts = [
    counts.GIVEN ? `${counts.GIVEN} ${counts.GIVEN === 1 ? "has" : "have"} it now` : null,
    counts.WAITING_ACCOUNT ? `${counts.WAITING_ACCOUNT} to sign up` : null,
    counts.ALREADY_OWNED ? `${counts.ALREADY_OWNED} already had it` : null,
  ].filter(Boolean);
  return parts.length ? `${people}: ${parts.join(" · ")}` : people;
}

/** What still has to be added before the gift can go for review (as the server checks). */
export function missingParts(g: { works: unknown[]; people: unknown[]; subject: string; body: string }): string[] {
  const missing: string[] = [];
  if (!g.works.length) missing.push("the music");
  if (!g.people.length) missing.push("who it is for");
  if (!g.subject.trim()) missing.push("a subject");
  if (!g.body.trim()) missing.push("a message");
  return missing;
}

/** The starting words, in the act's own voice ("I" for an artist, "we" for a band). */
export function giftStarter(voice: Voice): { subject: string; body: string } {
  const me = voice === "we" ? "us" : "me";
  const I = voice === "we" ? "We" : "I";
  return {
    subject: "A gift for you, {first_name}",
    body:
      `Hi {first_name},\n\n${I}'d love you to have {music}, as a gift from ${me}. ` +
      "It's yours to keep on Corner Room: play it any time and save it to listen offline.\n\n" +
      `Thank you for being part of this.\n\n{artist}`,
  };
}

/** The report as a CSV the act can keep (the people it typed, and what happened). */
export function reportCsv(people: MusicGiftPerson[]): string {
  const cell = (v: string | number | null | undefined) => {
    const text = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const rows = [["Email", "Name", "Note", "Status", "Email status", "Link clicks"]];
  for (const p of people) {
    rows.push([
      p.email,
      p.name ?? "",
      p.note ?? "",
      PERSON_STATUS_LABEL[p.status],
      p.email_status ? EMAIL_STATUS_LABEL[p.email_status] : "",
      String(p.clicks),
    ]);
  }
  return rows.map((r) => r.map(cell).join(",")).join("\n") + "\n";
}
