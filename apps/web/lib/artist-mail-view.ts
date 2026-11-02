/*
 * Artist emails in Studio, for staff and on /account (owner, 2026-11-02, D-MAIL-01 and D-MAIL-02):
 * words for each state, the audience in a line, picking people, and the email as one buyer will
 * read it. Pure helpers; the API writes the real emails and works out who gets them. The fill-in
 * and link rules here mirror `artist_mail_render.py`.
 */

import type { BuyerType, MailAudience, MailCounts, MailPerson, MailPick, MailStatus, MailWho, Rate, Reach, ThankYouAudience } from "@/features/artist-mail/api";

export const MAIL_STATUS_LABEL: Record<MailStatus, string> = {
  DRAFT: "Draft",
  IN_REVIEW: "Waiting for Corner Room",
  SCHEDULED: "Approved, scheduled",
  SENDING: "Sending",
  SENT: "Sent",
};

export const WHO_LABEL: Record<MailWho, string> = {
  ALL: "Everyone who bought it",
  PRESALE: "Pre-sale buyers only",
};

export const BUYER_TYPE_LABEL: Record<BuyerType, string> = {
  ANY: "Anyone",
  FIRST_TIME: "First-time buyers",
  RETURNING: "Returning buyers",
};

export type FillKey = "first_name" | "buyer_name" | "music" | "artist";

/** The fill-ins an email can use: each becomes that buyer's own words when it goes. */
export const FILL_INS: { key: FillKey; label: string; hint: string }[] = [
  { key: "first_name", label: "First name", hint: "Each buyer's own first name" },
  { key: "buyer_name", label: "Full name", hint: "Each buyer's own name" },
  { key: "music", label: "What they bought", hint: "The music each buyer bought" },
  { key: "artist", label: "Your name", hint: "Your artist or band name" },
];

export const FILL_KEYS = FILL_INS.map((f) => f.key);

export type MailValues = Record<FillKey, string>;

/** Said in place of a buyer's name when Corner Room doesn't have one (as the server does). */
export const NO_NAME = "friend";

export type RichToken = { kind: "text"; text: string } | { kind: "fill"; key: FillKey } | { kind: "link"; label: string; url: string };

const TOKEN = /\[([^\]\n]{1,300})\]\((https?:\/\/[^\s()<>"']{1,2000})\)|\{(first_name|buyer_name|music|artist)\}/g;

/** Text, fill-ins and links (`[words](https://address)`) in order, as the server reads them. */
export function parseRich(text: string): RichToken[] {
  const out: RichToken[] = [];
  let pos = 0;
  for (const m of text.matchAll(TOKEN)) {
    const at = m.index ?? 0;
    if (at > pos) out.push({ kind: "text", text: text.slice(pos, at) });
    if (m[3]) out.push({ kind: "fill", key: m[3] as FillKey });
    else out.push({ kind: "link", label: m[1], url: m[2] });
    pos = at + m[0].length;
  }
  if (pos < text.length) out.push({ kind: "text", text: text.slice(pos) });
  return out;
}

/** "Chaya Pore and Low Tide", "A, B, C and 2 more"; "your music" with none (the server's words). */
export function musicLine(titles: string[], none = "your music"): string {
  const t = titles.filter(Boolean);
  if (t.length === 0) return none;
  if (t.length === 1) return t[0];
  if (t.length <= 3) return `${t.slice(0, -1).join(", ")} and ${t[t.length - 1]}`;
  return `${t.slice(0, 3).join(", ")} and ${t.length - 3} more`;
}

/** What each fill-in becomes for one buyer. */
export function valuesFor(name: string | null | undefined, titles: string[], artist: string): MailValues {
  const clean = (name ?? "").trim();
  return { first_name: clean.split(/\s+/)[0] || NO_NAME, buyer_name: clean || NO_NAME, music: musicLine(titles), artist };
}

/** The values for previewing as one person, or as a buyer without a name when there's nobody yet. */
export function previewValues(person: Pick<MailPerson, "name" | "has_name" | "bought"> | null, chosenTitles: string[], artist: string): MailValues {
  if (!person) return valuesFor(null, chosenTitles, artist);
  return valuesFor(person.has_name ? person.name : null, person.bought.length ? person.bought : chosenTitles, artist);
}

/** Text with fill-ins replaced and links kept as their words (for a subject line or a list). */
export function plainText(text: string, values: MailValues): string {
  return parseRich(text)
    .map((t) => (t.kind === "text" ? t.text : t.kind === "fill" ? values[t.key] : t.label))
    .join("");
}

/** Places left to complete, written "[add ...]" in the starting words. */
export function unfilledMarks(text: string): string[] {
  return [...text.matchAll(/\[(add [^\]\n]{1,200})\](?!\()/gi)].map((m) => m[0]);
}

/** Braced words that aren't fill-ins, so the writer can catch a typo like {name}. */
export function unknownFillIns(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/\{([^{}\s]{1,40})\}/g)) {
    if (!FILL_KEYS.includes(m[1] as FillKey)) found.add(`{${m[1]}}`);
  }
  return [...found];
}

/** Whether a person is ticked under this pick. */
export function isPicked(pick: MailPick, ref: string): boolean {
  return pick.mode === "ONLY" ? pick.refs.includes(ref) : !pick.refs.includes(ref);
}

/** Tick or untick one person, keeping the pick's mode. */
export function togglePick(pick: MailPick, ref: string): MailPick {
  const has = pick.refs.includes(ref);
  return { mode: pick.mode, refs: has ? pick.refs.filter((r) => r !== ref) : [...pick.refs, ref] };
}

export const TICK_ALL: MailPick = { mode: "ALL_BUT", refs: [] };
export const UNTICK_ALL: MailPick = { mode: "ONLY", refs: [] };

/** How many ticked people it reaches, and how many ticked people stopped the act's emails. */
export function reachOf(people: Pick<MailPerson, "ref" | "stopped">[], pick: MailPick): Reach {
  let count = 0;
  let stopped = 0;
  for (const p of people) {
    if (!isPicked(pick, p.ref)) continue;
    if (p.stopped) stopped += 1;
    else count += 1;
  }
  return { count, stopped };
}

const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Dhaka" }).format(new Date(`${iso}T12:00:00+06:00`));

/** "Pre-sale buyers of Chaya Pore · returning buyers · bought 1 Nov 2026 to 2 Nov 2026 · 3 left out by name". */
export function audienceLine(a: Pick<MailAudience, "works" | "who"> & Partial<MailAudience>): string {
  const music = musicLine(a.works.map((w) => w.title ?? "Not available"), "No music chosen");
  const parts = [a.who === "PRESALE" ? `Pre-sale buyers of ${music}` : `Everyone who bought ${music}`];
  if (a.buyer_type && a.buyer_type !== "ANY") parts.push(BUYER_TYPE_LABEL[a.buyer_type].toLowerCase());
  if (a.bought_from && a.bought_to) parts.push(`bought ${day(a.bought_from)} to ${day(a.bought_to)}`);
  else if (a.bought_from) parts.push(`bought from ${day(a.bought_from)}`);
  else if (a.bought_to) parts.push(`bought by ${day(a.bought_to)}`);
  if (a.min_owned) parts.push(`own ${a.min_owned} or more of your songs and releases`);
  if (a.exclude_works?.length) parts.push(`leaving out buyers of ${musicLine(a.exclude_works.map((w) => w.title ?? "Not available"))}`);
  if (a.pick?.mode === "ONLY") parts.push(`only ${a.pick.refs.length} picked by name`);
  else if (a.pick?.refs.length) parts.push(`${a.pick.refs.length} left out by name`);
  return parts.join(" · ");
}

/** "Everyone · any of your music", "Pre-sale buyers · Chaya Pore". */
export function thankYouLabel(a: ThankYouAudience): string {
  const who = a.who === "PRESALE" ? "Pre-sale buyers" : "Everyone";
  return `${who} · ${a.works.length ? musicLine(a.works.map((w) => w.title ?? "Not available")) : "any of your music"}`;
}

/** "Goes to 12 people (2 stopped your emails)". */
export function reachLine(r: Reach | null | undefined): string {
  if (!r) return "Working out who gets it";
  const people = r.count === 0 ? "Nobody yet" : `Goes to ${r.count} ${r.count === 1 ? "person" : "people"}`;
  return r.stopped ? `${people} (${r.stopped} stopped your emails)` : people;
}

/** "Sent to 12 people", "8 of 12 sent", with any stopped or failed. */
export function sentLine(m: { status: MailStatus; recipient_count?: number | null; counts: Partial<MailCounts> }): string | null {
  if (m.status !== "SENDING" && m.status !== "SENT") return null;
  const c = { PENDING: 0, SENT: 0, SUPPRESSED: 0, FAILED: 0, ...m.counts };
  const total = m.recipient_count ?? c.PENDING + c.SENT + c.SUPPRESSED + c.FAILED;
  const extra = [c.SUPPRESSED ? `${c.SUPPRESSED} stopped your emails first` : "", c.FAILED ? `${c.FAILED} couldn't be delivered` : ""].filter(Boolean);
  const tail = extra.length ? `, ${extra.join(", ")}` : "";
  if (m.status === "SENDING") return `${c.SENT} of ${total} sent${tail}`;
  return `Sent to ${c.SENT} ${c.SENT === 1 ? "person" : "people"}${tail}`;
}

/** "Mon 3 Nov 2026, 8:00 pm" in Bangladesh time. */
export function whenLine(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Dhaka",
  }).format(new Date(iso));
}

/** A datetime-local value ("2026-11-03T20:00", Bangladesh time) as an ISO time, and back. */
export function fromLocalInput(value: string): string | null {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ? `${value}:00+06:00` : null;
}

export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const local = new Date(new Date(iso).getTime() + 6 * 3600 * 1000);
  return local.toISOString().slice(0, 16);
}

/** "12%" or "Not available" when nothing was sent yet (analytics honesty: never a made-up 0). */
export function percent(rate: Rate): string {
  if (rate === null || rate === undefined) return "Not available";
  const p = rate * 100;
  return `${p >= 10 || p === 0 ? Math.round(p) : p.toFixed(1)}%`;
}

/** "1.4 MB". */
export function fileSize(bytes: number | null | undefined): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Whether an email can be sent for review as it stands (the API checks again). */
export function readyToSend(m: { subject: string; body: string; audience: Pick<MailAudience, "works" | "pick"> }): boolean {
  if (!m.subject.trim() || !m.body.trim() || m.audience.works.length === 0) return false;
  return m.audience.pick.mode !== "ONLY" || m.audience.pick.refs.length > 0;
}
