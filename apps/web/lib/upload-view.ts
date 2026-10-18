/* Pure helpers for resumable uploads and the labels the upload card shows.
 *
 * The server decides everything (limits, checks, states); these helpers only plan which byte
 * ranges to send, recognise a resumable upload, and turn API states into short copy.
 */

export type PartPlan = { number: number; start: number; end: number };

/** Byte ranges for each part: [start, end) with 1-based part numbers. */
export function planParts(byteSize: number, partSize: number): PartPlan[] {
  if (byteSize <= 0 || partSize <= 0) return [];
  const count = Math.ceil(byteSize / partSize);
  return Array.from({ length: count }, (_, i) => ({
    number: i + 1,
    start: i * partSize,
    end: Math.min(byteSize, (i + 1) * partSize),
  }));
}

/** Parts still to send, in order. */
export function partsToSend(plan: PartPlan[], received: number[]): PartPlan[] {
  const have = new Set(received);
  return plan.filter((p) => !have.has(p.number));
}

/** Bytes the server already holds, for an honest progress bar after resuming. */
export function bytesReceived(plan: PartPlan[], received: number[]): number {
  const have = new Set(received);
  return plan.reduce((sum, p) => (have.has(p.number) ? sum + (p.end - p.start) : sum), 0);
}

/** A chosen file continues an open upload only when its name and size match exactly. */
export function matchesOpenUpload(
  file: { name: string; size: number },
  open: { filename: string; byte_size: number; status: string } | null | undefined,
): boolean {
  if (!open || open.status !== "OPEN") return false;
  return open.filename === baseName(file.name) && open.byte_size === file.size;
}

export function baseName(name: string): string {
  return name.replace(/\\/g, "/").split("/").pop()?.trim() || "upload";
}

const AUDIO_EXTENSIONS = [".flac", ".wav", ".wave"];
const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png"];

/** A friendly early hint only; the server inspects the real bytes and has the final word. */
export function preCheckFile(
  file: { name: string; size: number },
  purpose: "AUDIO_MASTER" | "COVER_ART",
  maxBytes: number,
): string | null {
  const lower = file.name.toLowerCase();
  const allowed = purpose === "AUDIO_MASTER" ? AUDIO_EXTENSIONS : IMAGE_EXTENSIONS;
  if (file.size === 0) return "This file is empty.";
  if (file.size > maxBytes) return `This file is larger than ${formatBytes(maxBytes)}.`;
  if (!allowed.some((ext) => lower.endsWith(ext))) {
    return purpose === "AUDIO_MASTER"
      ? "Choose a FLAC or WAV master. MP3 and other compressed files can't be masters."
      : "Choose a JPEG or PNG image.";
  }
  return null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

export function percent(done: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.floor((done / total) * 100)));
}

/** What a track version's state means to the person uploading. */
export function versionAudioLabel(version: { status: string; media_asset_id?: string | null; processing_detail?: string | null }): {
  label: string;
  tone: "neutral" | "progress" | "good" | "attention";
} {
  switch (version.status) {
    case "UPLOADING":
      return version.media_asset_id ? { label: "Uploaded", tone: "progress" } : { label: "Waiting for audio", tone: "neutral" };
    case "PROCESSING":
      return { label: "Checking your audio", tone: "progress" };
    case "READY":
      return { label: "Ready", tone: "good" };
    case "REJECTED":
      return { label: "Needs your attention", tone: "attention" };
    case "SUPERSEDED":
      return { label: "Replaced by a newer version", tone: "neutral" };
    default:
      return { label: version.status, tone: "neutral" };
  }
}

/** Plain-language text for upload API error codes. */
export function uploadErrorText(code: string | undefined, fallback: string): string {
  switch (code) {
    case "UPLOAD_TOO_LARGE":
      return "This file is larger than the limit.";
    case "CHECKSUM_MISMATCH":
    case "SIZE_MISMATCH":
      return "Part of the file was damaged on the way. Upload it again.";
    case "INTENT_EXPIRED":
      return "This upload expired. Start it again.";
    case "PARTS_MISSING":
      return "Some of the file hasn't arrived yet. Resume the upload.";
    case "TOO_MANY_UPLOADS":
      return "You have too many uploads in progress. Finish or cancel one first.";
    case "RESIDENCY_GATE":
    case "STORAGE_NOT_CONFIGURED":
      return "Uploads open once Corner Room's storage is set up on this server.";
    case "INVALID_TRANSITION":
      return "This version can't take audio any more. Start a new version.";
    default:
      return fallback;
  }
}
