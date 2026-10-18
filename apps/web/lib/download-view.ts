import type { DownloadOptionRecord } from "@/features/downloads/api";

/*
 * Pure pieces of the download control (AUDIO Phase 8). Sizes and facts come from the API; nothing
 * here decides who may download.
 */

/** "48.2 MB"; null when the size is unknown. Decimal units, as file managers show them. */
export function sizeLabel(bytes: number | null | undefined): string | null {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) return null;
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(0)} KB`;
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
}

/** The detail under a format: "24-bit / 48 kHz · 32.1 MB" or "320 kbps · 9.6 MB". */
export function optionDetail(o: DownloadOptionRecord): string {
  const quality =
    o.format === "flac"
      ? [o.bit_depth ? `${o.bit_depth}-bit` : null, o.sample_rate_hz ? `${o.sample_rate_hz / 1000} kHz` : null].filter(Boolean).join(" / ")
      : o.bitrate_kbps
        ? `${o.bitrate_kbps} kbps`
        : "";
  return [quality || null, o.available ? sizeLabel(o.byte_size) : "Being prepared"].filter(Boolean).join(" · ");
}

/** Whole percent of bytes received; null when the total is unknown. */
export function percent(received: number, total: number | null | undefined): number | null {
  if (!total || total <= 0) return null;
  return Math.min(100, Math.floor((received / total) * 100));
}

/** Files above this are handed to the browser's own download manager instead of being verified in the page. */
export const IN_PAGE_LIMIT_BYTES = 300_000_000;

const ERRORS: Record<string, string> = {
  DOWNLOAD_NOT_OWNED: "Downloads come with buying the song or its release. A plan lets you listen only.",
  DOWNLOAD_PREPARING: "This download is still being prepared. Try again in a few minutes.",
  DOWNLOAD_SUPERSEDED: "This song was just updated. Start the download again.",
  TRACK_TAKEN_DOWN: "This song was removed and can no longer be downloaded.",
  RATE_LIMITED: "Too many downloads in a short time. Try again later.",
  INTEGRITY: "The file did not arrive intact. Try again.",
};

/** Words for a failed download, from the API's code. */
export function downloadErrorText(code: string | null | undefined): string {
  return (code && ERRORS[code]) || "The download could not be completed. Try again.";
}

/** Lowercase hex of a digest, to compare with the API's sha256. */
export function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, "0")).join("");
}
