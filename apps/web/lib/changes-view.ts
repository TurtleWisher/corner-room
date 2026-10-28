/*
 * Changes to approved or released music (owner, 2026-10-28, D-CHANGES-01). Studio edits it as
 * usual; the edits wait in one change request until staff approve. Pure helpers: which mode the
 * editor is in, and the values to show (what is proposed, over what is public).
 */

import type { StudioCredit, StudioReleaseDetail, StudioTrack } from "@/features/studio/api";

export const REVIEWED_STATUSES = new Set(["APPROVED", "SCHEDULED", "RELEASED"]);

/** "none": nothing proposed; "editing": changes being made; "waiting": sent to staff. */
export type ChangeMode = "not_released" | "none" | "editing" | "waiting";

export function changeMode(detail: Pick<StudioReleaseDetail, "release" | "change_request">): ChangeMode {
  if (!REVIEWED_STATUSES.has(detail.release.status)) return "not_released";
  const status = detail.change_request?.status;
  if (status === "OPEN") return "editing";
  if (status === "SUBMITTED") return "waiting";
  return "none";
}

type Changes = {
  release?: Record<string, unknown>;
  tracks?: Record<string, { fields?: Record<string, unknown>; credits?: StudioCredit[] | null; audio_version_id?: string | null }>;
};

function changesOf(detail: Pick<StudioReleaseDetail, "change_request">): Changes {
  return (detail.change_request?.changes ?? {}) as Changes;
}

/** The release's details with any proposed changes on top. */
export function proposedRelease(detail: Pick<StudioReleaseDetail, "release" | "change_request">): StudioReleaseDetail["release"] {
  return { ...detail.release, ...(changesOf(detail).release ?? {}) } as StudioReleaseDetail["release"];
}

/** A song's details and credits with any proposed changes on top. */
export function proposedTrack(detail: Pick<StudioReleaseDetail, "change_request">, track: StudioTrack): StudioTrack {
  const entry = changesOf(detail).tracks?.[track.id];
  if (!entry) return track;
  return {
    ...track,
    ...(entry.fields ?? {}),
    credits: entry.credits ? entry.credits.map((c, i) => ({ ...c, position: i })) : track.credits,
  } as StudioTrack;
}

/** The replacement audio waiting for a song, if any. */
export function pendingAudio(detail: Pick<StudioReleaseDetail, "change_request">, trackId: string): string | null {
  return changesOf(detail).tracks?.[trackId]?.audio_version_id ?? null;
}
