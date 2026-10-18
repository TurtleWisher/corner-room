import { describe, expect, it } from "vitest";

import {
  downloadCopy,
  factRows,
  findingRows,
  findingText,
  formatDurationMs,
  reportHeadline,
  shouldPoll,
  streamingCopies,
  type MediaReport,
} from "./media-report-view";

const base: MediaReport = { version_id: "v", status: "PROCESSING", processing_detail: "QUEUED", is_current: true, findings: [], renditions: [], jobs: [] };

describe("media report view", () => {
  it("words every finding code and puts blocking ones first", () => {
    const rows = findingRows([
      { code: "TRUE_PEAK_HIGH", severity: "WARN", measured: "-0.3 dBTP", limit: "-1 dBTP" },
      { code: "NOT_STEREO", severity: "BLOCK", measured: "1", limit: "2" },
    ]);
    expect(rows.map((r) => [r.code, r.blocking])).toEqual([["NOT_STEREO", true], ["TRUE_PEAK_HIGH", false]]);
    expect(rows[1].detail).toBe("Measured -0.3 dBTP (limit -1 dBTP)");
    expect(findingText("LOSSY_SOURCE")).toMatch(/lossless/);
    expect(findingText("SOMETHING_NEW")).toMatch(/problem/);
  });

  it("shows only facts the server measured", () => {
    expect(factRows(null)).toEqual([]);
    const rows = factRows({ outcome: "ACCEPTED", container: "wav", sample_rate_hz: 48000, bit_depth: 24, channels: 2, duration_ms: 125400, integrated_lufs: -13.94, true_peak_dbtp: -1.2 });
    expect(rows).toContainEqual({ label: "Sample rate", value: "48.0 kHz" });
    expect(rows).toContainEqual({ label: "Length", value: "2:05" });
    expect(rows).toContainEqual({ label: "Loudness", value: "-13.9 LUFS" });
    expect(rows.find((r) => r.label === "Loudness range")).toBeUndefined();
    expect(formatDurationMs(undefined)).toBeNull();
  });

  it("states the processing step and polls only while work continues", () => {
    expect(reportHeadline(base).text).toMatch(/Checking/);
    expect(reportHeadline({ ...base, processing_detail: "TRANSCODING" }).text).toMatch(/streaming copies/);
    expect(reportHeadline({ ...base, status: "READY" }).tone).toBe("good");
    expect(reportHeadline({ ...base, status: "REJECTED", processing_detail: "QC_REJECTED" }).tone).toBe("attention");
    expect(shouldPoll(base)).toBe(true);
    expect(shouldPoll({ ...base, processing_detail: "PROCESSING_STALLED" })).toBe(false);
    expect(shouldPoll({ ...base, status: "READY" })).toBe(false);
  });
});

describe("copies", () => {
  const copy = (codec: string, purpose: string, extra: Partial<MediaReport["renditions"][number]> = {}) => ({
    profile_key: codec, codec, bitrate_kbps: codec === "opus" ? 160 : 320, duration_ms: 1000, purpose, ...extra,
  });
  it("lists streaming copies apart from the buyer's download copy", () => {
    const all = [copy("opus", "PLAYBACK"), copy("mp3", "PLAYBACK"), copy("flac", "DOWNLOAD", { bit_depth: 24, sample_rate_hz: 48000 })];
    expect(streamingCopies(all)).toBe("OPUS 160 kbps · MP3 320 kbps");
    expect(downloadCopy(all)).toBe("FLAC, 24-bit / 48 kHz");
    expect(downloadCopy([copy("mp3", "PLAYBACK")])).toBeNull();
    expect(streamingCopies([])).toBeNull();
  });
});
