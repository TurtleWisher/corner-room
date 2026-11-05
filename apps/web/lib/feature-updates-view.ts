/* Staff feature updates log (owner, 2026-11-06, D-UPDATES-01): filtering and words. Pure. */

import type { Feature, FeatureUpdate, UpdateKind } from "@/features/feature-updates/api";

export const KIND_LABEL: Record<UpdateKind, string> = { NEW: "New", IMPROVED: "Improved", FIXED: "Fixed" };
export const KINDS = Object.keys(KIND_LABEL) as UpdateKind[];

export type UpdateFilter = { query: string; area: string | null; kind: UpdateKind | null };
export const NO_FILTER: UpdateFilter = { query: "", area: null, kind: null };

const has = (text: string, words: string[]) => words.every((w) => text.toLowerCase().includes(w));

/**
 * Features that match: the area, then updates of the chosen kind, then every search word somewhere
 * in the feature or its updates. When the search words are in some updates only, those are shown.
 */
export function filterFeatures(features: Feature[], f: UpdateFilter): Feature[] {
  const words = f.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const out: Feature[] = [];
  for (const feature of features) {
    if (f.area && feature.area !== f.area) continue;
    let updates = f.kind ? feature.updates.filter((u) => u.kind === f.kind) : feature.updates;
    if (!updates.length) continue;
    if (words.length) {
      const about = [feature.name, feature.area, feature.summary, feature.description, feature.audience.join(" ")].join(" ");
      if (!has(about + " " + updates.map((u) => `${u.title} ${u.details}`).join(" "), words)) continue;
      if (!has(about, words)) {
        const matching = updates.filter((u) => has(`${about} ${u.title} ${u.details}`, words));
        updates = matching.length ? matching : updates;
      }
    }
    out.push({ ...feature, updates });
  }
  return out;
}

export function areasOf(features: Feature[]): string[] {
  return [...new Set(features.map((f) => f.area))].sort((a, b) => a.localeCompare(b));
}

/** How many updates of each kind, and in all. */
export function totals(features: Feature[]): Record<UpdateKind | "ALL", number> {
  const out = { NEW: 0, IMPROVED: 0, FIXED: 0, ALL: 0 };
  for (const f of features) {
    for (const u of f.updates) {
      out[u.kind] += 1;
      out.ALL += 1;
    }
  }
  return out;
}

/** Every update across features, newest first, with its feature's name. */
export function latest(features: Feature[], limit = 8): (FeatureUpdate & { feature: string; featureId: string })[] {
  return features
    .flatMap((f) => f.updates.map((u) => ({ ...u, feature: f.name, featureId: f.id })))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, limit);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "6 Nov 2026" from "2026-11-06" (a calendar day, not a moment, so no time zone shifts it). */
export function dayLabel(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}

/** "Since 11 Sep 2026 · 8 updates" */
export function featureLine(f: Pick<Feature, "first_date" | "updates">): string {
  const n = f.updates.length;
  return `Since ${dayLabel(f.first_date)} · ${n} ${n === 1 ? "update" : "updates"}`;
}
