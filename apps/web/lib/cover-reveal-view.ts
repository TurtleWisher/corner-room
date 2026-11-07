/*
 * The pre-sale cover switch in Studio (owner, 2026-11-07, D-COVER-03, replacing the timed reveal of
 * D-COVER-02). Off: fans see the cover lightly blurred, or the title screen lightly blurred when
 * there is no cover. On: the cover as it is, or the title screen sharp. Words only; the API keeps
 * the switch and makes the blurred copy, so the sharp cover never reaches fans while it is off.
 */

export type CoverRevealState = {
  revealed?: boolean;
  revealed_at?: string | null;
  can_switch?: boolean;
  /** The cover as fans see it now: the server's blurred copy while off. Null without a cover. */
  preview_url?: string | null;
};

/** What fans see now, in a sentence, for the switch and the previews. */
export function fansSeeLine(revealed: boolean, hasCover: boolean): string {
  if (hasCover) {
    return revealed
      ? "Fans see your cover clearly."
      : "Fans see your cover a little blurred: enough to know it, not enough to see it clearly.";
  }
  return revealed
    ? "No cover yet, so fans see your title on a glowing screen, clearly."
    : "No cover yet, so fans see your title on a glowing screen, a little blurred.";
}

/** The switch's own words, beside it: "On" or "Off". */
export function switchStateText(revealed: boolean): string {
  return revealed ? "On" : "Off";
}
