import { describe, expect, it } from "vitest";

import { downloadErrorText, optionDetail, percent, sizeLabel, toHex } from "./download-view";

describe("download view", () => {
  it("labels sizes", () => {
    expect(sizeLabel(512)).toBe("512 B");
    expect(sizeLabel(48_200_000)).toBe("48.2 MB");
    expect(sizeLabel(2_150_000_000)).toBe("2.15 GB");
    expect(sizeLabel(null)).toBeNull();
  });

  it("describes each format from the API's facts", () => {
    const base = { label: "", available: true, byte_size: 32_100_000, sample_rate_hz: 48000, bit_depth: 24, bitrate_kbps: 1400 };
    expect(optionDetail({ ...base, format: "flac" })).toBe("24-bit / 48 kHz · 32.1 MB");
    expect(optionDetail({ ...base, format: "mp3", bitrate_kbps: 320, byte_size: 9_600_000 })).toBe("320 kbps · 9.6 MB");
    expect(optionDetail({ ...base, format: "flac", available: false })).toBe("24-bit / 48 kHz · Being prepared");
  });

  it("measures progress only when the total is known", () => {
    expect(percent(50, 200)).toBe(25);
    expect(percent(300, 200)).toBe(100);
    expect(percent(50, null)).toBeNull();
  });

  it("explains failures in words", () => {
    expect(downloadErrorText("DOWNLOAD_NOT_OWNED")).toContain("buying");
    expect(downloadErrorText("SOMETHING")).toBe("The download could not be completed. Try again.");
  });

  it("writes digests as lowercase hex", () => {
    expect(toHex(new Uint8Array([0, 15, 255]).buffer)).toBe("000fff");
  });
});
