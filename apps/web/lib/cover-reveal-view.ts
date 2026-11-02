/*
 * Early cover reveal in Studio (owner, 2026-11-02, D-COVER-02): the cover stays hidden from fans
 * until release unless the artist shows it a chosen time before, or at once with Reveal now.
 * Words and choices only; the API decides whether the cover shows and refuses a time that's gone.
 */

export type CoverRevealState = {
  lead_minutes?: number | null;
  revealed_at?: string | null;
  reveal_at?: string | null;
  revealed?: boolean;
  can_change?: boolean;
  can_reveal_now?: boolean;
};

const HOUR = 60;
const DAY = 24 * HOUR;

/** The ready-made choices; "" means with the release. Any other lead shows as its own choice. */
export const REVEAL_CHOICES: { value: string; label: string }[] = [
  { value: "", label: "With the release" },
  { value: String(2 * HOUR), label: "2 hours before" },
  { value: String(6 * HOUR), label: "6 hours before" },
  { value: String(12 * HOUR), label: "12 hours before" },
  { value: String(DAY), label: "1 day before" },
  { value: String(2 * DAY), label: "2 days before" },
  { value: String(3 * DAY), label: "3 days before" },
  { value: String(7 * DAY), label: "1 week before" },
];

/** "2 hours before", "3 days before", "1 day and 6 hours before". */
export function leadLabel(minutes: number | null | undefined): string {
  if (!minutes) return "With the release";
  const days = Math.floor(minutes / DAY);
  const hours = Math.floor((minutes % DAY) / HOUR);
  const mins = minutes % HOUR;
  const parts = [
    days ? `${days} ${days === 1 ? "day" : "days"}` : "",
    hours ? `${hours} ${hours === 1 ? "hour" : "hours"}` : "",
    mins ? `${mins} ${mins === 1 ? "minute" : "minutes"}` : "",
  ].filter(Boolean);
  return `${parts.join(" and ")} before`;
}

/** The select's options: the ready-made ones, plus the saved lead when it isn't one of them. */
export function revealOptions(saved: number | null | undefined): { value: string; label: string }[] {
  if (!saved || REVEAL_CHOICES.some((c) => c.value === String(saved))) return REVEAL_CHOICES;
  return [...REVEAL_CHOICES, { value: String(saved), label: leadLabel(saved) }].sort((a, b) => Number(a.value || 0) - Number(b.value || 0));
}

/** The select's value for a saved lead. */
export function revealValue(saved: number | null | undefined): string {
  return saved ? String(saved) : "";
}

/** A select value back to the lead the API takes (null: with the release). */
export function leadFromValue(value: string): number | null {
  const n = Number(value);
  return value && Number.isInteger(n) && n > 0 ? n : null;
}

export type RevealStatus = "revealed" | "timed" | "waiting_for_date" | "with_release";

/** Where the cover stands for fans, from the API's answer. */
export function revealStatus(state: CoverRevealState | null | undefined): RevealStatus {
  if (state?.revealed) return "revealed";
  if (state?.lead_minutes && state.reveal_at) return "timed";
  if (state?.lead_minutes) return "waiting_for_date";
  return "with_release";
}
