import { describe, expect, it } from "vitest";

import {
  baseName,
  bytesReceived,
  formatBytes,
  matchesOpenUpload,
  partsToSend,
  percent,
  planParts,
  preCheckFile,
  uploadErrorText,
  versionAudioLabel,
} from "./upload-view";

describe("planParts", () => {
  it("splits a file into full parts and a short last part", () => {
    expect(planParts(2500, 1024)).toEqual([
      { number: 1, start: 0, end: 1024 },
      { number: 2, start: 1024, end: 2048 },
      { number: 3, start: 2048, end: 2500 },
    ]);
  });
  it("handles exact multiples and empty input", () => {
    expect(planParts(2048, 1024)).toHaveLength(2);
    expect(planParts(0, 1024)).toEqual([]);
  });
});

describe("resume", () => {
  const plan = planParts(2500, 1024);
  it("sends only what the server lacks and counts what it has", () => {
    expect(partsToSend(plan, [2]).map((p) => p.number)).toEqual([1, 3]);
    expect(bytesReceived(plan, [2, 3])).toBe(1024 + 452);
  });
  it("continues an open upload only for the same name and size", () => {
    const open = { filename: "Song.flac", byte_size: 2500, status: "OPEN" };
    expect(matchesOpenUpload({ name: "C:\\music\\Song.flac", size: 2500 }, open)).toBe(true);
    expect(matchesOpenUpload({ name: "Song.flac", size: 2501 }, open)).toBe(false);
    expect(matchesOpenUpload({ name: "Song.flac", size: 2500 }, { ...open, status: "EXPIRED" })).toBe(false);
    expect(matchesOpenUpload({ name: "Song.flac", size: 2500 }, null)).toBe(false);
  });
  it("uses the bare file name", () => {
    expect(baseName("a/b/c.wav")).toBe("c.wav");
    expect(baseName("")).toBe("upload");
  });
});

describe("preCheckFile", () => {
  it("accepts lossless masters and refuses others early", () => {
    expect(preCheckFile({ name: "mix.FLAC", size: 10 }, "AUDIO_MASTER", 100)).toBeNull();
    expect(preCheckFile({ name: "mix.wav", size: 10 }, "AUDIO_MASTER", 100)).toBeNull();
    expect(preCheckFile({ name: "mix.mp3", size: 10 }, "AUDIO_MASTER", 100)).toMatch(/FLAC or WAV/);
    expect(preCheckFile({ name: "mix.wav", size: 0 }, "AUDIO_MASTER", 100)).toMatch(/empty/);
    expect(preCheckFile({ name: "mix.wav", size: 101 }, "AUDIO_MASTER", 100)).toMatch(/larger/);
    expect(preCheckFile({ name: "cover.png", size: 10 }, "COVER_ART", 100)).toBeNull();
    expect(preCheckFile({ name: "cover.gif", size: 10 }, "COVER_ART", 100)).toMatch(/JPEG or PNG/);
  });
});

describe("labels", () => {
  it("formats sizes and percentages", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(2 * 1024 * 1024 * 1024)).toBe("2.0 GB");
    expect(percent(1, 3)).toBe(33);
    expect(percent(5, 0)).toBe(0);
  });
  it("maps version states to the uploader's words", () => {
    expect(versionAudioLabel({ status: "UPLOADING" }).label).toBe("Waiting for audio");
    expect(versionAudioLabel({ status: "PROCESSING" }).label).toBe("Checking your audio");
    expect(versionAudioLabel({ status: "READY" }).tone).toBe("good");
    expect(versionAudioLabel({ status: "REJECTED" }).label).toBe("Needs your attention");
  });
  it("explains upload errors plainly", () => {
    expect(uploadErrorText("INTENT_EXPIRED", "x")).toMatch(/expired/);
    expect(uploadErrorText("STORAGE_NOT_CONFIGURED", "x")).toMatch(/storage/);
    expect(uploadErrorText(undefined, "fallback")).toBe("fallback");
  });
});
