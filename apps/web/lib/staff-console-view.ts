/*
 * Staff console helpers (owner, 2026-11-15: "production-grade admin panel", no placeholder-only
 * fields, nothing oversized). Pure, tested.
 */

import type { NavItem, NavSection } from "@/lib/nav-view";

export type FieldWords = { label: string; hint: string | null; example: string | null };

/**
 * A field that was named only by its grey placeholder gets a real label from those same words.
 * "Amount (minor units)" becomes the label "Amount" with a hint that explains minor units; a
 * placeholder that is an example ("e.g. 120", an email address) stays an example under no label.
 */
export function fieldWords(placeholder: string | undefined | null): FieldWords | null {
  const text = (placeholder ?? "").trim();
  if (!text) return null;
  if (/^e\.g\.|@|^https?:/i.test(text)) return null;
  const minor = /\s*\((in )?minor units\)\s*/i;
  if (minor.test(text)) {
    return { label: text.replace(minor, " ").trim(), hint: "In the smallest unit of the currency: for BDT, 15000 means ৳150.00.", example: null };
  }
  const note = text.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (note && note[1]) return { label: note[1].trim(), hint: sentence(note[2]), example: null };
  return { label: text, hint: null, example: null };
}

function sentence(words: string): string {
  const s = words.trim();
  return s ? `${s.charAt(0).toUpperCase()}${s.slice(1)}${/[.!?]$/.test(s) ? "" : "."}` : s;
}

/** "ARTIST | RELEASE | EVENT" typed as a placeholder is really a list to pick from. */
export function choicesFrom(placeholder: string | undefined | null): string[] | null {
  const text = (placeholder ?? "").trim();
  if (!/^[A-Z][A-Z_]*(\s*\|\s*[A-Z][A-Z_]*)+$/.test(text)) return null;
  return text.split("|").map((s) => s.trim());
}

/** "IN_APP" reads "In app". */
export function choiceLabel(value: string): string {
  const s = value.replace(/_/g, " ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export type PageHit = NavItem & { section: string };

/** Every staff page this person can open, for the page finder; the query matches any word. */
export function findPages(sections: readonly NavSection[], query: string): PageHit[] {
  const all = sections.flatMap((s) => s.items.map((item) => ({ ...item, section: s.label })));
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return all;
  return all.filter((p) => {
    const hay = `${p.label} ${p.section}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** Wrap-around step through a list with the arrow keys. */
export function stepIndex(current: number, delta: number, length: number): number {
  if (length <= 0) return 0;
  return (((current + delta) % length) + length) % length;
}

export type QueueCount = { key: string; label: string; href: string; count: number | null };

/** Queues with something waiting first (largest first), then the empty ones; unknown counts last. */
export function sortQueues(queues: readonly QueueCount[]): QueueCount[] {
  const rank = (q: QueueCount) => (q.count === null ? 2 : q.count > 0 ? 0 : 1);
  return [...queues].sort((a, b) => rank(a) - rank(b) || (b.count ?? 0) - (a.count ?? 0) || a.label.localeCompare(b.label));
}

export function waitingTotal(queues: readonly QueueCount[]): number {
  return queues.reduce((sum, q) => sum + (q.count ?? 0), 0);
}
