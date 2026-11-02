/**
 * Listens counted in millions behind the song page (owner, 2026-11-02): 500 listens reads
 * 0.0005, 753 reads 0.000753. Built from the digits, not by dividing, so the figure is exact
 * (a whole count over a million has at most six decimals) and matches the API count, as
 * `formatCount` does. Shown by `components/music/listens-in-millions.tsx`.
 */
export function inMillions(count: number): string {
  const whole = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
  const digits = String(whole).padStart(7, "0");
  const millions = digits.slice(0, -6).replace(/^0+(?=\d)/, "");
  const fraction = digits.slice(-6).replace(/0+$/, "");
  return fraction ? `${millions}.${fraction}` : millions;
}

/** One place per character, left to right; a digit rolls, the point stays still. */
export type CounterPlace = { kind: "digit"; value: number; turns: number } | { kind: "point" };

/**
 * How each place rolls in from 0. Places further right turn round more times before they land,
 * like a counter running up: the last digit makes `maxTurns` full turns, each place to its left
 * one fewer, never below none.
 */
export function counterPlaces(text: string, maxTurns = 3): CounterPlace[] {
  const digitsAfter = (i: number) => text.slice(i + 1).replace(/\D/g, "").length;
  return Array.from(text).map((ch, i) =>
    ch === "."
      ? { kind: "point" as const }
      : { kind: "digit" as const, value: Number(ch), turns: Math.max(0, maxTurns - digitsAfter(i)) },
  );
}
