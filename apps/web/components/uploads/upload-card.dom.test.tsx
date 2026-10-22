// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/client";

const findOpenUpload = vi.fn();
const createUploadIntent = vi.fn();
const putUploadPart = vi.fn();
const completeUpload = vi.fn();
const cancelUpload = vi.fn();
vi.mock("@/features/uploads/api", () => ({
  findOpenUpload: (...a: unknown[]) => findOpenUpload(...a),
  createUploadIntent: (...a: unknown[]) => createUploadIntent(...a),
  putUploadPart: (...a: unknown[]) => putUploadPart(...a),
  completeUpload: (...a: unknown[]) => completeUpload(...a),
  cancelUpload: (...a: unknown[]) => cancelUpload(...a),
}));

import { UploadCard } from "./upload-card";

function intent(over: Record<string, unknown> = {}) {
  return {
    id: "intent-1",
    media_asset_id: "asset-1",
    purpose: "AUDIO_MASTER",
    target_type: "track_version",
    target_id: "v-1",
    filename: "song.flac",
    byte_size: 2500,
    part_size: 1024,
    part_count: 3,
    parts_received: [],
    status: "OPEN",
    expires_at: "2026-10-18T00:00:00Z",
    mode: "api_parts",
    ...over,
  };
}

function pick(file: File) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  fireEvent.change(input);
}

function audioFile(size = 2500, name = "song.flac") {
  return new File([new Uint8Array(size).map((_, i) => i % 251)], name, { type: "audio/flac" });
}

beforeEach(() => {
  // jsdom ArrayBuffers come from another realm, which Node's webcrypto refuses; a fixed digest is enough here.
  Object.defineProperty(globalThis, "crypto", {
    value: { subtle: { digest: async () => new Uint8Array(32).fill(0xab).buffer } },
    configurable: true,
  });
  findOpenUpload.mockResolvedValue(null);
  putUploadPart.mockResolvedValue({ parts_received: [] });
  completeUpload.mockResolvedValue({ intent: intent({ status: "COMPLETED" }), media_asset_id: "asset-1", asset_status: "QUARANTINED", byte_size: 2500, sha256: "x" });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("UploadCard", () => {
  it("sends every part with its hash, then completes and reports the server state", async () => {
    createUploadIntent.mockResolvedValue(intent());
    const done = vi.fn();
    render(<UploadCard purpose="AUDIO_MASTER" targetType="track_version" targetId="v-1" onCompleted={done} />);
    pick(audioFile());
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(createUploadIntent).toHaveBeenCalledWith(expect.objectContaining({ byte_size: 2500, filename: "song.flac", purpose: "AUDIO_MASTER" }));
    expect(putUploadPart.mock.calls.map((c) => c[1])).toEqual([1, 2, 3]);
    const [, , firstData, firstSha] = putUploadPart.mock.calls[0];
    expect((firstData as ArrayBuffer).byteLength).toBe(1024);
    expect(firstSha).toMatch(/^[0-9a-f]{64}$/);
    expect((putUploadPart.mock.calls[2][2] as ArrayBuffer).byteLength).toBe(452);
    expect(await screen.findByText(/Checking your audio next/)).toBeTruthy();
  });

  it("offers to continue an open upload and skips the parts the server has", async () => {
    findOpenUpload.mockResolvedValue(intent({ parts_received: [1, 2] }));
    createUploadIntent.mockResolvedValue(intent({ parts_received: [1, 2], resumed: true }));
    render(<UploadCard purpose="AUDIO_MASTER" targetType="track_version" targetId="v-1" />);
    expect(await screen.findByText(/81% done/)).toBeTruthy();
    expect(screen.getByText("Choose the file to continue")).toBeTruthy();
    pick(audioFile());
    await waitFor(() => expect(completeUpload).toHaveBeenCalled());
    expect(putUploadPart.mock.calls.map((c) => c[1])).toEqual([3]);
  });

  it("refuses a lossy file before uploading and explains server errors plainly", async () => {
    render(<UploadCard purpose="AUDIO_MASTER" targetType="track_version" targetId="v-1" />);
    pick(audioFile(100, "demo.mp3"));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringMatching(/FLAC or WAV/));
    expect(createUploadIntent).not.toHaveBeenCalled();

    createUploadIntent.mockRejectedValue(new ApiError({ status: 503, code: "STORAGE_NOT_CONFIGURED", title: "x", detail: "x" }));
    pick(audioFile());
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/storage is set up/));
  });

  it("takes a dropped file the same way as a chosen one", async () => {
    createUploadIntent.mockResolvedValue(intent());
    const done = vi.fn();
    render(<UploadCard purpose="AUDIO_MASTER" targetType="track_version" targetId="v-1" onCompleted={done} />);
    const card = screen.getByRole("region", { name: "Upload master" });
    fireEvent.drop(card, { dataTransfer: { files: [audioFile()], types: ["Files"] } });
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(createUploadIntent).toHaveBeenCalledWith(expect.objectContaining({ filename: "song.flac" }));
  });
});
