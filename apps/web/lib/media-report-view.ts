/* Plain-language view of a track version's media report (AUDIO_PHASE_1_DESIGN 7.1).
 * The API decides every finding and state; this only words and formats them. */

export type MediaFinding = { code: string; severity: "BLOCK" | "WARN" | string; measured?: string | null; limit?: string | null };

export type MediaInspection = {
  outcome: string;
  container?: string | null;
  codec?: string | null;
  sample_rate_hz?: number | null;
  bit_depth?: number | null;
  sample_format?: string | null;
  channels?: number | null;
  duration_ms?: number | null;
  integrated_lufs?: number | null;
  loudness_range_lu?: number | null;
  true_peak_dbtp?: number | null;
};

export type MediaReport = {
  version_id: string;
  status: string;
  processing_detail?: string | null;
  is_current: boolean;
  asset_status?: string | null;
  inspection?: MediaInspection | null;
  findings: MediaFinding[];
  renditions: {
    profile_key: string;
    codec: string;
    bitrate_kbps: number;
    duration_ms: number;
    sample_rate_hz?: number;
    /** PLAYBACK copies stream; the DOWNLOAD copy (lossless FLAC) is what buyers download. */
    purpose?: string;
    bit_depth?: number | null;
  }[];
  jobs: { kind: string; profile_key?: string | null; status: string; attempts: number; last_error_code?: string | null }[];
};

const FINDING_TEXT: Record<string, string> = {
  FILE_TOO_LARGE: "The file is larger than 2 GB.",
  DURATION_TOO_LONG: "The song is longer than 60 minutes.",
  ZERO_LENGTH: "The file is empty.",
  CHECKSUM_MISMATCH: "The upload was damaged on the way. Upload it again.",
  UNSUPPORTED_FORMAT: "This isn't a FLAC or WAV file. Export the master as FLAC (preferred) or WAV.",
  LOSSY_SOURCE: "MP3, AAC and other compressed files can't be masters. Export a lossless FLAC or WAV.",
  WAV_NOT_PCM: "This WAV isn't plain PCM. Export it as a standard PCM WAV (not \"extensible\" or floating point).",
  WAV_TRAILING_DATA: "The WAV has extra data after the audio. Export it again from your audio software.",
  NOT_STEREO: "Masters must be stereo (2 channels).",
  SAMPLE_RATE_TOO_LOW: "The sample rate is below 44.1 kHz. Export at 44.1 kHz or higher.",
  BIT_DEPTH_UNSUPPORTED: "Use 16-bit or 24-bit. If your session is 32-bit float, export as 24-bit.",
  CORRUPT_AUDIO: "The audio couldn't be read all the way through. Export and upload it again.",
  TRUE_PEAK_HIGH: "Peaks go above -1 dBTP, which can distort in the streaming copies.",
  LOUD_MASTER_PEAK: "The master is louder than -14 LUFS with peaks above -2 dBTP; the streaming copies may distort.",
  DUPLICATE_AUDIO: "This audio matches another track on Corner Room. A reviewer will check it.",
  COVER_FORMAT: "Use a JPEG or PNG image.",
  COVER_UNREADABLE: "The image couldn't be read. Export it again.",
  COVER_NOT_SQUARE: "Cover art must be square.",
  COVER_TOO_SMALL: "The image is smaller than 1400 × 1400 px.",
  COVER_TOO_LARGE: "The image is larger than 6000 × 6000 px.",
  COVER_COLOR_MODE: "Use an RGB image (not CMYK).",
  COVER_BELOW_RECOMMENDED: "Below the recommended 3000 × 3000 px; it may look soft on large screens.",
};

export function findingText(code: string): string {
  return FINDING_TEXT[code] ?? "A check found a problem with this file.";
}

/** Blocking findings first; each with its words and the measured value when there is one. */
export function findingRows(findings: MediaFinding[]): { code: string; blocking: boolean; text: string; detail: string | null }[] {
  return [...findings]
    .sort((a, b) => (a.severity === "BLOCK" ? 0 : 1) - (b.severity === "BLOCK" ? 0 : 1))
    .map((f) => ({
      code: f.code,
      blocking: f.severity === "BLOCK",
      text: findingText(f.code),
      detail: f.measured ? (f.limit ? `Measured ${f.measured} (limit ${f.limit})` : `Measured ${f.measured}`) : null,
    }));
}

export function formatDurationMs(ms: number | null | undefined): string | null {
  if (ms == null) return null;
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** Technical facts as label/value pairs; unknown values are left out rather than guessed. */
export function factRows(i: MediaInspection | null | undefined): { label: string; value: string }[] {
  if (!i) return [];
  const rows: { label: string; value: string }[] = [];
  if (i.container) rows.push({ label: "Format", value: i.container.toUpperCase() });
  if (i.sample_rate_hz) rows.push({ label: "Sample rate", value: `${(i.sample_rate_hz / 1000).toFixed(1)} kHz` });
  if (i.bit_depth) rows.push({ label: "Bit depth", value: `${i.bit_depth}-bit${i.sample_format === "float" ? " float" : ""}` });
  if (i.channels) rows.push({ label: "Channels", value: i.channels === 2 ? "Stereo" : i.channels === 1 ? "Mono" : String(i.channels) });
  const length = formatDurationMs(i.duration_ms);
  if (length) rows.push({ label: "Length", value: length });
  if (i.integrated_lufs != null) rows.push({ label: "Loudness", value: `${i.integrated_lufs.toFixed(1)} LUFS` });
  if (i.true_peak_dbtp != null) rows.push({ label: "True peak", value: `${i.true_peak_dbtp.toFixed(1)} dBTP` });
  if (i.loudness_range_lu != null) rows.push({ label: "Loudness range", value: `${i.loudness_range_lu.toFixed(1)} LU` });
  return rows;
}

/** One-line status for the person who uploaded, from the authoritative states. */
export function reportHeadline(r: MediaReport): { text: string; tone: "progress" | "good" | "attention" | "neutral" } {
  if (r.status === "READY") return { text: "Ready to play", tone: "good" };
  if (r.status === "REJECTED") {
    return r.processing_detail === "PROCESSING_FAILED"
      ? { text: "Processing failed. Upload the master again.", tone: "attention" }
      : { text: "Needs your attention", tone: "attention" };
  }
  if (r.status === "PROCESSING") {
    if (r.processing_detail === "PROCESSING_STALLED") return { text: "Processing is delayed. Corner Room has been alerted.", tone: "attention" };
    if (r.processing_detail === "TRANSCODING") return { text: "Checks passed. Making the streaming copies…", tone: "progress" };
    return { text: "Checking your audio…", tone: "progress" };
  }
  return { text: "Waiting for audio", tone: "neutral" };
}

/** Poll while the server is still working on this version. */
export function shouldPoll(r: MediaReport | null | undefined): boolean {
  return !!r && r.status === "PROCESSING" && r.processing_detail !== "PROCESSING_STALLED";
}

type Copy = MediaReport["renditions"][number];

/** "OPUS 160 kbps · MP3 320 kbps" for the copies that stream; null when there are none yet. */
export function streamingCopies(copies: Copy[]): string | null {
  const list = copies.filter((c) => (c.purpose ?? "PLAYBACK") === "PLAYBACK").map((c) => `${c.codec.toUpperCase()} ${c.bitrate_kbps} kbps`);
  return list.length > 0 ? list.join(" · ") : null;
}

/** "FLAC, 24-bit / 48 kHz" for the buyer's lossless copy; null until it exists. */
export function downloadCopy(copies: Copy[]): string | null {
  const c = copies.find((r) => r.purpose === "DOWNLOAD");
  if (!c) return null;
  const parts = [c.bit_depth ? `${c.bit_depth}-bit` : null, c.sample_rate_hz ? `${c.sample_rate_hz / 1000} kHz` : null].filter(Boolean);
  return parts.length > 0 ? `${c.codec.toUpperCase()}, ${parts.join(" / ")}` : c.codec.toUpperCase();
}
