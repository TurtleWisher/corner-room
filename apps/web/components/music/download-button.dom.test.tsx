// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ fetchDownloadOptions: vi.fn(), startDownload: vi.fn() }));
vi.mock("@/features/downloads/api", () => api);

import { ApiError } from "@/lib/api/client";
import { DownloadButton } from "./download-button";

const BYTES = new Uint8Array([1, 2, 3, 4, 5, 6]);
const OPTIONS = [
  { format: "flac", label: "FLAC (lossless)", available: true, byte_size: 6, sample_rate_hz: 48000, bit_depth: 24, bitrate_kbps: 1400 },
  { format: "mp3", label: "MP3 320 kbps", available: false, byte_size: null, sample_rate_hz: 44100, bit_depth: null, bitrate_kbps: 320 },
];

function bodyStream(bytes: Uint8Array) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.slice(0, 3));
      controller.enqueue(bytes.slice(3));
      controller.close();
    },
  });
}

let saved: string[] = [];
beforeEach(() => {
  saved = [];
  api.fetchDownloadOptions.mockResolvedValue(OPTIONS);
  api.startDownload.mockResolvedValue({
    url: "/api/v1/downloads/tok",
    expires_at: "",
    filename: "Rumi - Low Tide.flac",
    format: "flac",
    content_type: "audio/flac",
    byte_size: 6,
    sha256: "aa".repeat(32),
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, body: bodyStream(BYTES), headers: new Headers({ "Content-Length": "6" }) })),
  );
  vi.stubGlobal("crypto", { subtle: { digest: vi.fn(async () => new Uint8Array(32).fill(0xaa).buffer) } });
  URL.createObjectURL = vi.fn(() => "blob:x");
  URL.revokeObjectURL = vi.fn();
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    saved.push(this.download);
  };
  // jsdom's Blob has no arrayBuffer.
  if (!Blob.prototype.arrayBuffer) Blob.prototype.arrayBuffer = async () => new ArrayBuffer(6);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("DownloadButton", () => {
  it("offers the formats the API reports, with unready ones disabled", async () => {
    render(<DownloadButton trackId="t1" title="Low Tide" />);
    await act(async () => screen.getByRole("button", { name: "Download Low Tide" }).click());
    expect(screen.getByText("24-bit / 48 kHz · 6 B")).toBeTruthy();
    expect((screen.getByRole("button", { name: /MP3 320 kbps/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("downloads, checks the file against the API's SHA-256, then saves it under its name", async () => {
    render(<DownloadButton trackId="t1" title="Low Tide" />);
    await act(async () => screen.getByRole("button", { name: "Download Low Tide" }).click());
    await act(async () => screen.getByRole("button", { name: /FLAC \(lossless\)/ }).click());
    expect(api.startDownload).toHaveBeenCalledWith("t1", "flac");
    expect(saved).toEqual(["Rumi - Low Tide.flac"]);
    expect(screen.getByText("Saved, file checked")).toBeTruthy();
  });

  it("refuses to save a file that does not match, and offers to try again", async () => {
    vi.stubGlobal("crypto", { subtle: { digest: vi.fn(async () => new Uint8Array(32).fill(0x01).buffer) } });
    render(<DownloadButton trackId="t1" title="Low Tide" />);
    await act(async () => screen.getByRole("button", { name: "Download Low Tide" }).click());
    await act(async () => screen.getByRole("button", { name: /FLAC \(lossless\)/ }).click());
    expect(saved).toEqual([]);
    expect(screen.getByRole("alert").textContent).toContain("did not arrive intact");
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("explains why someone listening through a plan cannot download", async () => {
    api.fetchDownloadOptions.mockRejectedValueOnce(new ApiError({ status: 403, code: "DOWNLOAD_NOT_OWNED" }));
    render(<DownloadButton trackId="t1" title="Low Tide" />);
    await act(async () => screen.getByRole("button", { name: "Download Low Tide" }).click());
    expect(screen.getByRole("alert").textContent).toContain("A plan lets you listen only");
  });

  it("closes the format list with Escape", async () => {
    render(<DownloadButton trackId="t1" title="Low Tide" />);
    const open = screen.getByRole("button", { name: "Download Low Tide" });
    await act(async () => open.click());
    expect(open.getAttribute("aria-expanded")).toBe("true");
    await act(async () => fireEvent.keyDown(window, { key: "Escape" }));
    expect(open.getAttribute("aria-expanded")).toBe("false");
  });
});
