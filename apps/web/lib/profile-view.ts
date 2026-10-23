/* Editing your own profile (owner, 2026-10-23): fans change their name and picture; artists and
 * band admins change name, bio and picture, which staff approve before the public sees them.
 * The API decides everything; these only prepare the picture and put its answers into words. */

/** Pictures must be at least this many pixels on each side (owner, 2026-10-23). The API checks
 * again; this only saves an upload that would be turned down. */
export const PHOTO_MIN_PX = 400;
/** Bigger photos are scaled down to this before upload (phone photos are often 4000 px). */
export const PHOTO_MAX_OUT_PX = 2000;

/** The largest square from the middle of a photo. */
export function squareCrop(width: number, height: number): { sx: number; sy: number; side: number } {
  const side = Math.min(width, height);
  return { sx: Math.floor((width - side) / 2), sy: Math.floor((height - side) / 2), side };
}

/** The size the uploaded square will be. */
export function photoOutputSide(side: number): number {
  return Math.min(side, PHOTO_MAX_OUT_PX);
}

/** Why a photo can't be used, before uploading it (null when it can). */
export function photoProblem(width: number, height: number): string | null {
  if (!width || !height) return "This image couldn't be read. Try a JPEG or PNG.";
  if (Math.min(width, height) < PHOTO_MIN_PX) {
    return `This photo is ${width} × ${height} px. Pictures need to be at least ${PHOTO_MIN_PX} × ${PHOTO_MIN_PX} px.`;
  }
  return null;
}

export type ChangeRequest = {
  id: string;
  status: string;
  stage_name: string | null;
  bio: string | null;
  bio_changed: boolean;
  portrait_url: string | null;
  remove_portrait: boolean;
  submitted_at: string | null;
  reviewed_at: string | null;
  review_note: string | null;
};

/** What a waiting request would change, one line each. */
export function changeLines(request: ChangeRequest | null | undefined, noun: "artist" | "band" = "artist"): string[] {
  if (!request) return [];
  const lines: string[] = [];
  if (request.stage_name) lines.push(`${noun === "band" ? "Band name" : "Stage name"}: ${request.stage_name}`);
  if (request.bio_changed) lines.push(request.bio ? "A new bio" : "Remove the bio");
  if (request.portrait_url) lines.push("A new picture");
  else if (request.remove_portrait) lines.push("Remove the picture");
  return lines;
}

/** The last staff decision, for the artist. */
export function decisionLine(request: ChangeRequest | null | undefined): { tone: "good" | "attention"; text: string } | null {
  if (!request) return null;
  if (request.status === "APPROVED") return { tone: "good", text: "Your last changes were approved and are live." };
  if (request.status === "REJECTED") {
    return { tone: "attention", text: request.review_note ? `Your last changes weren't approved: ${request.review_note}` : "Your last changes weren't approved." };
  }
  return null;
}

/** The name field's value: what is waiting, else what is public. */
export function draftName(publicName: string, pending: ChangeRequest | null | undefined): string {
  return pending?.stage_name || publicName;
}

/** The bio field's value: what is waiting, else what is public. */
export function draftBio(publicBio: string | null, pending: ChangeRequest | null | undefined): string {
  if (pending?.bio_changed) return pending.bio ?? "";
  return publicBio ?? "";
}
