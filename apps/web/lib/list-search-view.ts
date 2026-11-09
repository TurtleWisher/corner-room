/*
 * One search rule for every list in Studio (owner, 2026-11-09: "a search option everywhere I work
 * among a list or select people"). Case, accents and extra spaces don't matter; every word typed
 * must appear somewhere in the person's fields; a phone number matches by its digits alone, so
 * "01712" finds "+880 1712-345678". Pure helpers; nothing is sent anywhere.
 */

/** Lower case, accents folded away, spaces collapsed. Bangla stays as it is. */
export function fold(text: string | null | undefined): string {
  return (text ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const digits = (text: string) => text.replace(/\D+/g, "");

/** Whether every word of `query` appears in at least one of `fields`. An empty query matches all. */
export function matches(query: string, fields: (string | null | undefined)[]): boolean {
  const words = fold(query).split(" ").filter(Boolean);
  if (!words.length) return true;
  const hay = fields.map(fold).filter(Boolean);
  const hayDigits = fields.map((f) => digits(f ?? "")).filter(Boolean);
  return words.every((w) => {
    if (hay.some((h) => h.includes(w))) return true;
    const d = digits(w);
    // Digits only count as a phone search when the word is mostly digits (3 or more).
    return d.length >= 3 && d.length >= w.replace(/[\s+()-]/g, "").length - 1 && hayDigits.some((h) => h.includes(d));
  });
}

/** The items whose fields match the query, in their order. */
export function searchList<T>(items: T[], query: string, fields: (item: T) => (string | null | undefined)[]): T[] {
  if (!fold(query)) return items;
  return items.filter((item) => matches(query, fields(item)));
}

/** "3 of 120" when filtered, else "120". */
export function shownCount(shown: number, total: number): string {
  return shown === total ? String(total) : `${shown} of ${total}`;
}
