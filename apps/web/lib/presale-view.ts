/*
 * Reading a pre-sale list pasted or uploaded by staff (owner, 2026-10-25, D-PRESALE-01): a CSV
 * export or rows copied from a Notion table (tab-separated). Columns are found by their header
 * (email, name, amount, date), so the owner's sheet can keep its own order and extra columns,
 * which are ignored (phone and address are never sent). Input checking only: the API validates
 * again and decides everything.
 */

import { parsePriceToMinor } from "@/lib/studio-view";

export type PresaleDraft = { email: string; buyer_name: string | null; amount_minor: number; paid_on: string | null };
export type PresaleProblem = { line: number; message: string };
export type ParsedPresales = { rows: PresaleDraft[]; problems: PresaleProblem[] };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const HEADERS: Record<keyof PresaleDraft, RegExp> = {
  email: /e-?mail/i,
  buyer_name: /^(full\s*)?name$|buyer|customer/i,
  // "Paid" alone is an amount; "Paid on" is a date (below).
  amount_minor: /amount|price|^paid$|taka|bdt|total/i,
  paid_on: /date|paid\s*on|when/i,
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
  const at = { email: col("email"), buyer_name: col("buyer_name"), amount_minor: col("amount_minor"), paid_on: col("paid_on") };
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
    if (amount === null || amount <= 0) return problems.push({ line: n, message: `Line ${n}: the amount for ${email} is not a price.` });
    const rawDate = at.paid_on >= 0 ? (cells[at.paid_on] ?? "") : "";
    const paidOn = parsePaidOn(rawDate);
    if (rawDate.trim() && !paidOn) problems.push({ line: n, message: `Line ${n}: the date "${rawDate}" was not understood, so it is left empty.` });
    seen.add(email);
    const name = at.buyer_name >= 0 ? (cells[at.buyer_name] ?? "").replace(/\s+/g, " ").trim() : "";
    rows.push({ email, buyer_name: name || null, amount_minor: amount, paid_on: paidOn });
  });
  return { rows, problems };
}

/** Sum of the parsed amounts (minor units), for the preview line. */
export function presaleTotal(rows: PresaleDraft[]): number {
  return rows.reduce((sum, r) => sum + r.amount_minor, 0);
}
