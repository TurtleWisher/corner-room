/*
 * People added to a gift campaign by hand or from a sheet (owner, 2026-11-07, D-CAMPAIGN-04): the
 * list an artist or staff paste or import, read into name, email, phone and address. The server
 * checks everything again and decides who is already in the campaign; this only reads and previews.
 */

import type { GiftPersonInput } from "@/features/gifts/api";

const EMAIL = /^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$/;

export type PersonRow = GiftPersonInput & { problem: string | null };

/** Digits only, to spot the same phone written two ways. */
export function phoneKey(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits || null;
}

function looksLikePhone(cell: string): boolean {
  return /^[+()\d\s.-]+$/.test(cell) && (phoneKey(cell)?.length ?? 0) >= 6;
}

/** Split one line of a sheet: tabs from a spreadsheet, else commas or semicolons (CSV quotes kept). */
export function splitCells(line: string): string[] {
  if (line.includes("\t")) return line.split("\t").map((c) => c.trim());
  const sep = line.includes(";") && !line.includes(",") ? ";" : ",";
  const out: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === sep && !quoted) {
      out.push(cell.trim());
      cell = "";
    } else cell += ch;
  }
  out.push(cell.trim());
  return out;
}

type Column = "name" | "email" | "phone" | "address";
const HEADERS: Record<Column, RegExp> = {
  name: /^(full\s*)?name|buyer|customer|recipient/i,
  email: /e-?mail/i,
  phone: /phone|mobile|cell|contact\s*(no|number)|whats\s*app/i,
  address: /address|location|delivery|street/i,
};

/** The column each header names, when the first line is a header row. */
export function headerColumns(cells: string[]): Partial<Record<Column, number>> | null {
  const found: Partial<Record<Column, number>> = {};
  cells.forEach((cell, i) => {
    if (cell.includes("@") || looksLikePhone(cell)) return;
    for (const col of Object.keys(HEADERS) as Column[]) {
      if (found[col] === undefined && HEADERS[col].test(cell.trim())) {
        found[col] = i;
        return;
      }
    }
  });
  return found.email !== undefined || found.phone !== undefined ? found : null;
}

function clean(value: string | undefined): string | null {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  return text || null;
}

/** One row from its cells: by the header's columns, or by guessing each cell. */
function fromCells(cells: string[], columns: Partial<Record<Column, number>> | null): GiftPersonInput {
  if (columns) {
    const at = (c: Column) => (columns[c] === undefined ? undefined : cells[columns[c]!]);
    return { name: clean(at("name")), email: clean(at("email"))?.toLowerCase() ?? null, phone: clean(at("phone")), address: clean(at("address")) };
  }
  let email: string | null = null;
  let phone: string | null = null;
  const rest: string[] = [];
  for (const cell of cells.map((c) => c.trim()).filter(Boolean)) {
    if (!email && cell.includes("@")) email = cell.toLowerCase().replace(/^mailto:/, "");
    else if (!phone && looksLikePhone(cell)) phone = cell;
    else rest.push(cell);
  }
  // The first other cell is the name; the rest is the address (its commas put back).
  return { name: clean(rest[0]), email, phone, address: clean(rest.slice(1).join(", ")) };
}

/** Why a row can't be added, in plain words (the server checks again). */
export function rowProblem(p: GiftPersonInput): string | null {
  if (p.email && !EMAIL.test(p.email)) return `${p.email} isn't an email address`;
  if (p.phone && (phoneKey(p.phone)?.length ?? 0) < 6) return `${p.phone} isn't a phone number`;
  if (!p.email && !p.phone) return "Needs an email or a phone";
  return null;
}

/**
 * People from pasted text or an imported .csv / .tsv file: one person per line. A first line of
 * headers (Name, Email, Phone, Address, in any order) is followed; without one, the email is the
 * cell with an @, the phone the one that is mostly digits, the first other cell the name and the
 * rest the address. The same email or phone twice in the list is kept once.
 */
export function parsePeopleSheet(text: string): PersonRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return [];
  const columns = headerColumns(splitCells(lines[0]));
  const body = columns ? lines.slice(1) : lines;
  const rows: PersonRow[] = [];
  const emails = new Set<string>();
  const phones = new Set<string>();
  for (const line of body) {
    const person = fromCells(splitCells(line), columns);
    if (!person.name && !person.email && !person.phone && !person.address) continue;
    const key = phoneKey(person.phone);
    if ((person.email && emails.has(person.email)) || (key && phones.has(key))) continue;
    if (person.email) emails.add(person.email);
    if (key) phones.add(key);
    rows.push({ ...person, problem: rowProblem(person) });
  }
  return rows;
}

/** The people to send: rows without a problem, problem field dropped. */
export function sendable(rows: PersonRow[]): GiftPersonInput[] {
  return rows.filter((r) => !r.problem).map(({ name, email, phone, address }) => ({ name, email, phone, address }));
}

/** The message after adding, in plain words. */
export function addedMessage(added: number, skipped: number, waiting: boolean): string {
  const people = (n: number) => `${n} ${n === 1 ? "person" : "people"}`;
  const parts = [`${people(added)} added.`];
  if (skipped) parts.push(`${people(skipped)} already on the list, so left as they were.`);
  if (added && waiting) parts.push("They count once Corner Room approves them.");
  return parts.join(" ");
}
