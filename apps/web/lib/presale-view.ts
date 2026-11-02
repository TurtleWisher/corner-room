/*
 * Reading a pre-sale list pasted or uploaded by staff (owner, 2026-10-25, D-PRESALE-01): a CSV
 * export or rows copied from a Notion table (tab-separated). Columns are found by their header
 * (email, name, amount, date, and phone and address since 2026-10-27), so the owner's sheet can
 * keep its own order and extra columns, which are ignored. Phone and address are seen only by
 * staff with customer access. Input checking only: the API validates again and decides everything.
 */

import { parsePriceToMinor } from "@/lib/studio-view";

export type PresaleDraft = {
  email: string;
  buyer_name: string | null;
  amount_minor: number;
  paid_on: string | null;
  phone?: string | null;
  address?: string | null;
};
export type PresaleProblem = { line: number; message: string };
export type ParsedPresales = { rows: PresaleDraft[]; problems: PresaleProblem[] };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const HEADERS: Record<keyof PresaleDraft, RegExp> = {
  email: /e-?mail/i,
  buyer_name: /^(full\s*)?name$|buyer|customer/i,
  // "Paid" alone is an amount; "Paid on" is a date (below).
  amount_minor: /amount|price|^paid$|taka|bdt|total/i,
  paid_on: /date|paid\s*on|when/i,
  phone: /phone|mobile|contact\s*no|whatsapp/i,
  // Notion's sheet calls the address "Place".
  address: /address|place|location/i,
};

/** Split one line on tabs (Notion copy) or commas (CSV), honouring "quoted, fields". */
export function splitLine(line: string): string[] {
  if (line.includes("\t")) return line.split("\t").map((c) => c.trim());
  const out: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(cell.trim());
      cell = "";
    } else cell += ch;
  }
  out.push(cell.trim());
  return out;
}

/** "2026-09-01", "1/9/2026" (day first, as written in Bangladesh) or "September 1, 2026" -> "2026-09-01". */
export function parsePaidOn(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t);
  if (m) return iso(+m[3], +m[2], +m[1]);
  const parsed = Date.parse(t);
  if (Number.isNaN(parsed)) return null;
  const d = new Date(parsed);
  return iso(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

function iso(y: number, mo: number, d: number): string | null {
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function parsePresaleList(text: string): ParsedPresales {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/^﻿/, "")).filter((l) => l.trim());
  const problems: PresaleProblem[] = [];
  if (lines.length < 2) return { rows: [], problems: [{ line: 1, message: "Paste the header row and at least one buyer." }] };
  const header = splitLine(lines[0]);
  const col = (key: keyof PresaleDraft) => header.findIndex((h) => HEADERS[key].test(h));
  const at = {
    email: col("email"),
    buyer_name: col("buyer_name"),
    amount_minor: col("amount_minor"),
    paid_on: col("paid_on"),
    phone: col("phone"),
    address: col("address"),
  };
  if (at.email < 0 || at.amount_minor < 0) {
    return { rows: [], problems: [{ line: 1, message: "The first row needs column names, including Email and Amount." }] };
  }
  const rows: PresaleDraft[] = [];
  const seen = new Set<string>();
  lines.slice(1).forEach((line, i) => {
    const n = i + 2;
    const cells = splitLine(line);
    const email = (cells[at.email] ?? "").trim().toLowerCase();
    if (!EMAIL.test(email)) return problems.push({ line: n, message: `Line ${n}: "${email || "(empty)"}" is not an email address.` });
    if (seen.has(email)) return problems.push({ line: n, message: `Line ${n}: ${email} is already in this list.` });
    const amount = parsePriceToMinor(cells[at.amount_minor] ?? "");
    // 0 is a gift (owner, 2026-10-25): the buyer gets it and it counts as a sale, with no money.
    if (amount === null || amount < 0) return problems.push({ line: n, message: `Line ${n}: the amount for ${email} is not a price.` });
    const rawDate = at.paid_on >= 0 ? (cells[at.paid_on] ?? "") : "";
    const paidOn = parsePaidOn(rawDate);
    if (rawDate.trim() && !paidOn) problems.push({ line: n, message: `Line ${n}: the date "${rawDate}" was not understood, so it is left empty.` });
    seen.add(email);
    const name = at.buyer_name >= 0 ? (cells[at.buyer_name] ?? "").replace(/\s+/g, " ").trim() : "";
    const tidy = (index: number) => (index >= 0 ? (cells[index] ?? "").replace(/\s+/g, " ").trim() : "") || null;
    rows.push({ email, buyer_name: name || null, amount_minor: amount, paid_on: paidOn, phone: tidy(at.phone), address: tidy(at.address) });
  });
  return { rows, problems };
}

/** Sum of the parsed amounts (minor units), for the preview line. */
export function presaleTotal(rows: PresaleDraft[]): number {
  return rows.reduce((sum, r) => sum + r.amount_minor, 0);
}

/* Pre-orders on Corner Room (D-PRESALE-02), apart from the imported list above. Display only: the
 * API decides when pre-orders open, what they cost, and when the music unlocks. */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** How long until a pre-ordered release is out, in words ("Out in 3 days"). */
export function presaleCountdown(releaseAt: string, now: Date = new Date()): string {
  const left = new Date(releaseAt).getTime() - now.getTime();
  if (!Number.isFinite(left) || left <= 0) return "Out now";
  if (left < HOUR) return "Out within the hour";
  if (left < DAY) {
    const hours = Math.floor(left / HOUR);
    return `Out in ${hours} ${hours === 1 ? "hour" : "hours"}`;
  }
  const days = Math.floor(left / DAY);
  return `Out in ${days} ${days === 1 ? "day" : "days"}`;
}

/** "single", "EP", "album" or "release", for a release type. */
export function releaseNoun(releaseType: string | null | undefined): string {
  return releaseType === "SINGLE" ? "single" : releaseType === "EP" ? "EP" : releaseType === "ALBUM" ? "album" : "release";
}

/** The pre-sale button's words for a release type (owner, 2026-11-03: "Pre-book"). */
export function preorderLabel(releaseType: string | null | undefined): string {
  return `Pre-book the ${releaseNoun(releaseType)}`;
}

/**
 * What a pre-order promises, shown before paying (D-PRESALE-02 as decided, 2026-10-28): the music
 * unlocks on release day; a new date keeps the pre-order (a refund on request goes through the
 * normal refund approval); a cancelled pre-sale is refunded in full.
 */
export const PRESALE_PROMISE = {
  unlock: "Pay now. It unlocks for you on release day. We'll email you when it's ready to play.",
  dateChange: "If the date changes, your pre-order stays in place and we'll email you the new date. You can ask for a refund.",
  cancelled: "If the pre-sale is cancelled, you get a full refund.",
} as const;

export type StudioPresaleStage = "none" | "price_needed" | "ready_to_send" | "waiting" | "returned" | "approved_waiting_price" | "live" | "closed" | "scheduled";

/**
 * Where an early pre-sale stands in Studio (D-PRESALE-03), from the API's answer only: the API
 * decides who may send it, what staff decided and whether fans can see it.
 */
export function studioPresaleStage(
  p: { status?: string | null; price?: { status: string } | null; price_live?: boolean; listed?: boolean; open?: boolean; can_request?: boolean } | null | undefined,
  releaseStatus: string,
): StudioPresaleStage {
  if (!p) return "none";
  if (p.listed) return p.open ? "live" : "closed";
  if (releaseStatus === "SCHEDULED") return "scheduled";
  if (p.status === "APPROVED") return "approved_waiting_price";
  if (p.status === "REQUESTED") return "waiting";
  if (p.status === "RETURNED") return "returned";
  if (!p.can_request) return "none";
  return p.price && ["PROPOSED", "ACCEPTED"].includes(p.price.status) ? "ready_to_send" : "price_needed";
}

/** What an order line says when it was a pre-order: locked until release day, then just music. */
export function preorderNote(order: { is_presale?: boolean | null }): string | null {
  return order.is_presale ? "Pre-order · unlocks on release day" : null;
}

/*
 * The release-day opening (pre-sale experience guide): a visitor who saw a release on pre-sale
 * gets a one-time opening of the cover the first time the API serves it as released. Only a
 * per-browser memory; the release page shows the same music either way.
 */
const SEEN_PREFIX = "cr-presale-seen:";

/** Remember that this browser saw the release while it was on pre-sale. */
export function rememberPresaleSeen(releaseId: string, store: Pick<Storage, "setItem"> | null = safeStorage()): void {
  try {
    store?.setItem(SEEN_PREFIX + releaseId, "1");
  } catch {
    /* private mode or storage off: no opening, nothing else changes */
  }
}

/** True once, the first time the released page is shown after the pre-sale was seen. */
export function takePresaleSeen(releaseId: string, store: Pick<Storage, "getItem" | "removeItem"> | null = safeStorage()): boolean {
  try {
    if (!store?.getItem(SEEN_PREFIX + releaseId)) return false;
    store.removeItem(SEEN_PREFIX + releaseId);
    return true;
  } catch {
    return false;
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
