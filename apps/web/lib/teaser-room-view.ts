/*
 * Words and small rules for teasers on fan pages (owner, 2026-11-07, D-TEASER-00 to D-TEASER-04).
 *
 * A preview is the free, permanent way to hear a song for anyone who hasn't bought it: as often as
 * they like, for as long as the song is on Corner Room. After each full listen a gentle suggestion
 * appears; it never stops a replay and never moves the page. The API decides what can be offered
 * (`next_step`); this file only turns it into words and links.
 */

import type { NextStepKind, PublicTeaserRecord } from "@/features/teasers/api";

/** The player keys a preview apart from its song, so the song's own Play button never lights up. */
export const TEASER_KEY_PREFIX = "teaser:";

export function teaserKey(teaserId: string): string {
  return `${TEASER_KEY_PREFIX}${teaserId}`;
}

export function isTeaserKey(id: string | null | undefined): boolean {
  return Boolean(id && id.startsWith(TEASER_KEY_PREFIX));
}

export function teaserPath(teaserId: string): string {
  return `/previews/${teaserId}`;
}

/** Share of the preview that must really be heard (forward play, not seeking) to count as a full listen. */
export const COMPLETION_SHARE = 0.9;

/**
 * A full listen: the audio reached its end and most of it was actually heard. Opening the room,
 * pressing play, pausing, dragging to the end or a failed load never count.
 */
export function isCompletion(heardMs: number, durationSeconds: number): boolean {
  if (!Number.isFinite(heardMs) || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return false;
  return heardMs >= durationSeconds * 1000 * COMPLETION_SHARE;
}

export type Suggestion = {
  eyebrow: string;
  heading: string;
  body: string;
  action: { label: string; href: string } | null;
};

/**
 * The suggestion after a full listen, from what the API says can be done. Owners get none. With
 * nothing on sale the listener is still thanked, with no link to a checkout that would refuse.
 */
export function suggestionFor(teaser: Pick<PublicTeaserRecord, "next_step" | "track_title" | "release_title" | "release_at" | "track_released">): Suggestion | null {
  const step = teaser.next_step;
  switch (step.kind as NextStepKind) {
    case "OWNED":
      return null;
    case "PREBOOK":
      return {
        eyebrow: "Before release",
        heading: "Enjoying this preview?",
        body: `Pre-book ${teaser.release_title} and it's yours the moment it comes out.`,
        action: { label: "Pre-book", href: `/releases/${step.release_id}` },
      };
    case "BUY":
      return {
        eyebrow: "Full song available",
        heading: "Enjoying this preview?",
        body: `Get the whole of ${teaser.track_title} and support the artist.`,
        action: { label: "Buy the song", href: `/tracks/${step.track_id}` },
      };
    case "BUY_RELEASE":
      return {
        eyebrow: "Full song available",
        heading: "Enjoying this preview?",
        body: `${teaser.track_title} comes with ${teaser.release_title}. Get it and support the artist.`,
        action: { label: "Get the release", href: `/releases/${step.release_id}` },
      };
    default:
      return {
        eyebrow: teaser.track_released ? "Thanks for listening" : "Coming soon",
        heading: "Enjoying this preview?",
        body: teaser.track_released
          ? "The full song isn't on sale right now. Come back to this preview any time."
          : "The full song isn't out yet. Come back to this preview any time.",
        action: null,
      };
  }
}

/** The line above the title: the preview's own name when the artist gave it one, and whether the
 * song is out yet. The room already says "Preview Room", so the word is not repeated. */
export function teaserLabel(teaser: Pick<PublicTeaserRecord, "title" | "track_released">): string {
  const kind = teaser.title?.trim() || "Preview";
  return teaser.track_released ? kind : `${kind} · before release`;
}

/** What a preview is, as three short facts beside the player (D-TEASER-00 to D-TEASER-02). */
export const PREVIEW_FACTS: readonly { title: string; body: string }[] = [
  { title: "Free to hear", body: "As often as you like, for as long as the song is on Corner Room." },
  { title: "No account needed", body: "Anyone with the link can listen." },
  { title: "A short part", body: "Cut from the song's own master. The full song is longer." },
];

/** The preview's link for sharing: this page, without any query or hash. */
export function shareLink(origin: string, teaserId: string): string {
  return `${origin.replace(/\/+$/, "")}${teaserPath(teaserId)}`;
}

/** Where the main action of the room points for someone who owns the song. */
export function ownedLink(teaser: Pick<PublicTeaserRecord, "track_id">): { label: string; href: string } {
  return { label: "Play the full song", href: `/listen/${teaser.track_id}` };
}

/** "0:45" for a preview length in milliseconds; empty when unknown. */
export function teaserLength(ms: number | null | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return "";
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
