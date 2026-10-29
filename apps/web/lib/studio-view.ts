/* Pure helpers for the artist Studio. The API decides states, readiness and permissions; these
 * only word them and prepare form values. */

import type { ReadinessItem, StudioTrack } from "@/features/studio/api";

export const DISPLAY_STATE_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  UPLOADING: "Uploading",
  CHECKING_AUDIO: "Checking your audio",
  NEEDS_ATTENTION: "Needs your attention",
  IN_REVIEW: "In review",
  APPROVED: "Approved",
  SCHEDULED: "Scheduled",
  RELEASED: "Released",
  TAKEN_DOWN: "Taken down",
  ARCHIVED: "Archived",
};

export function displayStateLabel(state: string): string {
  return DISPLAY_STATE_LABEL[state] ?? state;
}

export function displayStateTone(state: string): "neutral" | "progress" | "good" | "attention" {
  if (state === "NEEDS_ATTENTION" || state === "TAKEN_DOWN") return "attention";
  if (state === "UPLOADING" || state === "CHECKING_AUDIO" || state === "IN_REVIEW") return "progress";
  if (state === "APPROVED" || state === "SCHEDULED" || state === "RELEASED") return "good";
  return "neutral";
}

/** Display states that wait on the artist (not on Corner Room or the audio checks). */
const ARTIST_TURN = new Set(["DRAFT", "NEEDS_ATTENTION"]);

/**
 * The release to pick up next on Studio home: the most recently changed one that waits on the
 * artist. None when nothing does, so the page never invents a next step (design guide 7.1).
 */
export function releaseToContinue<T extends { display_state: string; updated_at: string }>(releases: T[]): T | null {
  let best: T | null = null;
  for (const r of releases) {
    if (ARTIST_TURN.has(r.display_state) && (!best || r.updated_at > best.updated_at)) best = r;
  }
  return best;
}

/** "3 releases · 1 out now · 2 in progress", from the releases the API returned (nothing guessed). */
export function releasesGlance(releases: { display_state: string }[]): string {
  const n = releases.length;
  if (n === 0) return "No releases yet";
  const out = releases.filter((r) => r.display_state === "RELEASED").length;
  const working = releases.filter((r) => r.display_state !== "RELEASED" && r.display_state !== "TAKEN_DOWN" && r.display_state !== "ARCHIVED").length;
  const parts = [`${n} ${n === 1 ? "release" : "releases"}`];
  if (out > 0) parts.push(`${out} out now`);
  if (working > 0) parts.push(`${working} in progress`);
  return parts.join(" · ");
}

export const RELEASE_TYPE_LABEL: Record<string, string> = {
  SINGLE: "Single",
  EP: "EP",
  ALBUM: "Album",
  COMPILATION: "Compilation",
  LIVE: "Live",
};

export function profileReasonText(reason: string | null | undefined): string | null {
  if (reason === "PROFILE_NOT_ACTIVE") return "Corner Room hasn't activated this profile yet, so it can't publish music.";
  if (reason === "CATALOG_AFFILIATION_REQUIRED") return "Corner Room still needs to finish setting this profile up for releases.";
  return null;
}

const READINESS_TEXT: Record<string, string> = {
  TITLE: "Release title",
  LANGUAGE: "Language",
  GENRE: "Main genre",
  P_LINE: "Sound recording copyright (℗ line)",
  C_LINE: "Copyright (© line)",
  COVER: "Cover art that passed its checks",
  TRACKS: "At least one song (add it under Tracks)",
  TRACK_ORDER: "Track order",
  PRICE: "A proposed price for the release",
  TRACK_TITLE: "Track title",
  TRACK_AUDIO: "Master audio that passed its checks",
  TRACK_PRICE: "A proposed price for this song",
};

/** Checklist rows in the order the API sent them, with the track named where it applies. */
export function readinessRows(items: ReadinessItem[], tracks: Pick<StudioTrack, "id" | "title" | "position">[]): { key: string; ok: boolean; text: string }[] {
  const byId = new Map(tracks.map((t) => [t.id, t]));
  return items.map((item, index) => {
    const track = item.track_id ? byId.get(item.track_id) : undefined;
    const base = READINESS_TEXT[item.code] ?? item.code;
    return {
      key: `${item.code}-${item.track_id ?? index}`,
      ok: item.ok,
      text: track ? `${track.position}. ${track.title || "Untitled"}: ${base.toLowerCase()}` : base,
    };
  });
}

export function missingCount(items: ReadinessItem[]): number {
  return items.filter((i) => !i.ok).length;
}

/** Move one item up or down in a list of ids; out-of-range moves return the list unchanged. */
export function moveItem(ids: string[], index: number, delta: -1 | 1): string[] {
  const target = index + delta;
  if (index < 0 || index >= ids.length || target < 0 || target >= ids.length) return ids;
  const next = [...ids];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** Turn a typed price ("120", "120.50", "1,200") into minor units, or null if it isn't a price.
 * Formatting only: the server stores what was typed and staff decide the final price. */
export function parsePriceToMinor(text: string): number | null {
  const clean = text.replace(/[,\s৳]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  const [whole, frac = ""] = clean.split(".");
  return Number(whole) * 100 + Number((frac + "00").slice(0, 2));
}

/** The latest audio version worth showing for a track: in progress first, else the current one. */
export function currentAudio(track: Pick<StudioTrack, "audio">) {
  return track.audio.find((a) => a.status === "UPLOADING" || a.status === "PROCESSING") ?? track.audio.find((a) => a.is_current) ?? track.audio[0] ?? null;
}

export const EDITABLE_STATUSES = new Set(["IDEA", "DEMO", "IN_PRODUCTION", "QC"]);

const REVIEW_TEXT: Record<string, string> = {
  start_review: "Review started",
  approve: "Approved",
  request_changes: "Changes requested",
  schedule: "Scheduled",
  release: "Released",
  takedown: "Taken down",
  cancel_presale: "Pre-sale cancelled",
};

/** Words for one review event; the reviewer's identity is never part of it. */
/**
 * What the Review and submit panel offers (2026-10-23: an approved release still showed "Submit for
 * review", and pressing it failed). Submitting only while the release is still being prepared;
 * in review, a withdraw; after that, only the state the API reports.
 */
export function submitPanelMode(status: string): "submit" | "in_review" | "past_review" {
  if (status === "METADATA_REVIEW") return "in_review";
  return EDITABLE_STATUSES.has(status) ? "submit" : "past_review";
}

export function reviewEventText(action: string): string {
  return REVIEW_TEXT[action] ?? action;
}

/** What a price proposal is for, and who may buy at it (D-AUDIO-11). */
export function proposalWords(p: { subject_type: string; subject_title?: string | null; audience: string }): { subject: string; audience: string } {
  return {
    subject: p.subject_type === "RELEASE" ? "Whole release" : `Track: ${p.subject_title?.trim() || "untitled"}`,
    audience:
      p.audience === "OWNS_PART_OF_RELEASE"
        ? "Fans who already own some of its songs"
        : p.audience === "PRESALE"
          ? "Pre-orders before release day"
          : "Everyone",
  };
}

/** A pre-sale price can be proposed until the release is out (D-PRESALE-02). */
export function canProposePresale(status: string): boolean {
  return !["RELEASED", "TAKEN_DOWN", "ARCHIVED"].includes(status);
}

/** What the pre-sale price row tells the artist about when pre-orders open. */
export function presaleHint(status: string, releaseAt: string | null | undefined): string {
  if (status === "SCHEDULED" && releaseAt) {
    return "Pre-orders are open at this price until release day. Fans who pre-order can play the music from release day.";
  }
  return "Fans can pre-order at this price once Corner Room sets the release date. The music unlocks for them on release day.";
}
/** Asset states after a cover upload: still being checked, usable, or turned down. */
const COVER_ACCEPTED = new Set(["ACCEPTED", "READY"]);

/**
 * How a cover upload stands, from the cover report (2026-10-22: a rejected cover used to show only
 * "Checking your artwork next"). Words only; the server decides.
 */
export function coverReportState(
  r: { asset_status: string | null } | null | undefined,
  noun: "cover" | "poster" | "picture" = "cover",
): {
  state: "none" | "checking" | "accepted" | "rejected";
  text: string;
} {
  if (!r) return { state: "none", text: `No ${noun} uploaded yet.` };
  if (r.asset_status === "REJECTED") return { state: "rejected", text: `This ${noun} wasn't accepted. Fix what's listed below, then upload it again.` };
  if (r.asset_status && COVER_ACCEPTED.has(r.asset_status)) return { state: "accepted", text: `${noun.charAt(0).toUpperCase()}${noun.slice(1)} accepted.` };
  return { state: "checking", text: "Checking your artwork…" };
}
