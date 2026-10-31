/*
 * The Studio credits editor (owner, 2026-10-31, D-CREDITS-07): artists and staff pick a person's
 * Corner Room profile by name instead of typing an ID, say which act a musician played in
 * (D-CREDITS-05), and always see where their change goes. Pure helpers; the API checks everything.
 */

import type { StudioCredit } from "@/features/studio/api";

/** A Corner Room profile someone can be credited as: a solo artist or a band (both are artists). */
export type CreditProfile = { id: string; name: string; kind: "SOLO" | "BAND"; picture: string | null };

const norm = (value: string) => value.trim().replace(/\s+/g, " ").toLocaleLowerCase();

/** Solo artists and bands as one list of profiles, each once. */
export function profilesFrom(
  artists: { id: string; stage_name: string; kind?: "SOLO" | "BAND"; portrait_asset_id?: string | null }[],
  bands: { id: string; name: string; portrait_asset_id?: string | null }[],
): CreditProfile[] {
  const out = new Map<string, CreditProfile>();
  for (const a of artists) out.set(a.id, { id: a.id, name: a.stage_name, kind: a.kind ?? "SOLO", picture: a.portrait_asset_id ?? null });
  for (const b of bands) if (!out.has(b.id)) out.set(b.id, { id: b.id, name: b.name, kind: "BAND", picture: b.portrait_asset_id ?? null });
  return [...out.values()];
}

/** Profiles whose stage name matches what was typed: names that start with it first, then names
 * containing it, then by name. Empty for an empty query. */
export function profileMatches(query: string, profiles: CreditProfile[], limit = 6): CreditProfile[] {
  const q = norm(query);
  if (!q) return [];
  const rank = (p: CreditProfile) => {
    const n = norm(p.name);
    if (n === q) return 0;
    if (n.startsWith(q)) return 1;
    if (n.split(" ").some((w) => w.startsWith(q))) return 2;
    return n.includes(q) ? 3 : 9;
  };
  return profiles
    .map((p) => ({ p, r: rank(p) }))
    .filter((x) => x.r < 9)
    .sort((a, b) => a.r - b.r || a.p.name.localeCompare(b.p.name))
    .slice(0, limit)
    .map((x) => x.p);
}

/** The acts on this song a musician can belong to: every credit that is not a musician and names
 * someone, each once, by profile or by typed name. */
export function actOptions(rows: StudioCredit[], profiles: CreditProfile[]): { value: string; label: string }[] {
  const out = new Map<string, string>();
  for (const r of rows) {
    if (r.role_key === "musician") continue;
    if (r.artist_id) {
      const name = profiles.find((p) => p.id === r.artist_id)?.name ?? r.artist_name;
      if (name) out.set(`id:${r.artist_id}`, name);
    } else if (r.display_name?.trim()) {
      const key = `name:${norm(r.display_name)}`;
      // A typed name that is one profile's stage name reads as that stage name, as on the song page.
      const same = profiles.filter((p) => norm(p.name) === norm(r.display_name ?? ""));
      if (!out.has(key)) out.set(key, same.length === 1 ? same[0].name : r.display_name.trim());
    }
  }
  return [...out.entries()].map(([value, label]) => ({ value, label }));
}

/** The act a musician row names, as an option value ("" for none). */
export function partOfValue(row: Pick<StudioCredit, "part_of_artist_id" | "part_of_name">): string {
  if (row.part_of_artist_id) return `id:${row.part_of_artist_id}`;
  return row.part_of_name?.trim() ? `name:${norm(row.part_of_name)}` : "";
}

/** The row fields for a chosen act option. */
export function partOfFields(value: string, options: { value: string; label: string }[]): Pick<StudioCredit, "part_of_artist_id" | "part_of_name"> {
  if (value.startsWith("id:")) return { part_of_artist_id: value.slice(3), part_of_name: null };
  const option = options.find((o) => o.value === value);
  return option ? { part_of_artist_id: null, part_of_name: option.label } : { part_of_artist_id: null, part_of_name: null };
}

/** Drop a musician's act when that act is no longer credited on the song. */
export function keepActsValid<T extends StudioCredit>(rows: T[], profiles: CreditProfile[]): T[] {
  const acts = new Set(actOptions(rows, profiles).map((o) => o.value));
  return rows.map((r) => {
    const v = partOfValue(r);
    return v && (r.role_key !== "musician" || !acts.has(v)) ? { ...r, part_of_artist_id: null, part_of_name: null } : r;
  });
}

export type CreditsStage = "draft" | "live" | "changing" | "locked";

/** Where a change to these credits goes, in plain words, for the note above the editor. */
export function creditsNote(stage: CreditsStage): { title: string; body: string } {
  switch (stage) {
    case "draft":
      return { title: "Draft", body: "Changes save straight to this draft. Corner Room checks the credits when you send the release for review." };
    case "live":
      return {
        title: "Live now",
        body: "Fans see these credits now. Drag a handle to change the order: a new order goes live at once, with no review. To change a name or a role, press Make changes at the top of the page.",
      };
    case "changing":
      return {
        title: "Changing released music",
        body: "Your edits join your list of changes and fans keep seeing the current credits until Corner Room approves them. A new order with no other edits goes live at once.",
      };
    default:
      return { title: "Waiting for review", body: "Corner Room is reviewing these credits. You can change them again after the review." };
  }
}

const rowKey = (c: StudioCredit) =>
  JSON.stringify([c.role_key, c.artist_id || null, (c.display_name ?? "").trim() || null, (c.instrument ?? "").trim() || null, partOfValue(c) || null]);

/** Whether a row is new or edited compared with what fans see now. */
export function isChanged(row: StudioCredit, live: StudioCredit[]): boolean {
  const key = rowKey(row);
  return !live.some((l) => rowKey(l) === key);
}
