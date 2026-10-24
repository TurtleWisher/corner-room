// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ fetchDownloadOptions: vi.fn(), startDownload: vi.fn() }));
vi.mock("@/features/downloads/api", () => api);
const store = vi.hoisted(() => ({
  offlineSupported: () => true,
  getOfflineSong: vi.fn(),
  saveOfflineSong: vi.fn(),
  removeOfflineSong: vi.fn(),
  askToKeepStorage: vi.fn(),
}));
vi.mock("@/lib/offline-store", () => store);
vi.mock("@/components/auth-provider", () => ({ useAuth: () => ({ user: { id: "u1" }, status: "authenticated" }) }));

import { ApiError } from "@/lib/api/client";
import { SaveOfflineButton } from "./save-offline-button";

const BYTES = new Uint8Array([1, 2, 3, 4, 5, 6]);

// jsdom has no Blob.arrayBuffer and its buffers don't cross into Node's WebCrypto, so the digest is
// stubbed (as in download-button.dom.test.tsx): 0xaa bytes, i.e. "aa" x 32 in hex.
const GOOD_SHA = "aa".repeat(32);

function stream(bytes: Uint8Array) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.slice(0, 3));
      controller.enqueue(bytes.slice(3));
      controller.close();
    },
  });
}

beforeEach(() => {
  api.startDownload.mockReset();
  store.getOfflineSong.mockReset();
  store.saveOfflineSong.mockReset();
  store.removeOfflineSong.mockReset();
  store.getOfflineSong.mockResolvedValue(null);
  store.saveOfflineSong.mockResolvedValue(undefined);
  store.removeOfflineSong.mockResolvedValue(undefined);
  api.startDownload.mockResolvedValue({
    url: "/api/v1/downloads/tok",
    expires_at: "",
    filename: "Low Tide.mp3",
    format: "mp3",
    content_type: "audio/mpeg",
    byte_size: 6,
    sha256: GOOD_SHA,
  });
  vi.stubGlobal("crypto", { subtle: { digest: vi.fn(async () => new Uint8Array(32).fill(0xaa).buffer) } });
  if (!Blob.prototype.arrayBuffer) Blob.prototype.arrayBuffer = async () => new ArrayBuffer(6);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      String(url).includes("/covers/")
        ? { ok: false, body: null, headers: new Headers() }
        : { ok: true, body: stream(BYTES), headers: new Headers({ "Content-Length": "6" }) },
    ),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SaveOfflineButton (DOM)", () => {
  it("saves the checked MP3 in the app for the signed-in account", async () => {
    render(<SaveOfflineButton trackId="t1" title="Low Tide" releaseIds={["r1"]} />);
    fireEvent.click(await screen.findByRole("button", { name: "Save Low Tide for offline listening" }));
    await waitFor(() => expect(screen.getByText("Saved offline")).toBeTruthy());
    expect(api.startDownload).toHaveBeenCalledWith("t1", "mp3");
    const song = store.saveOfflineSong.mock.calls[0][0];
    expect(song).toMatchObject({ trackId: "t1", title: "Low Tide", releaseIds: ["r1"], userId: "u1", mime: "audio/mpeg", byteSize: 6 });
    expect(screen.getByRole("link", { name: /Saved offline/ }).getAttribute("href")).toBe("/offline.html");
  });

  it("refuses a file that doesn't match the API's checksum", async () => {
    vi.stubGlobal("crypto", { subtle: { digest: vi.fn(async () => new Uint8Array(32).fill(0x01).buffer) } });
    render(<SaveOfflineButton trackId="t1" title="Low Tide" />);
    fireEvent.click(await screen.findByRole("button", { name: "Save Low Tide for offline listening" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("did not arrive intact"));
    expect(store.saveOfflineSong).not.toHaveBeenCalled();
  });

  it("says why when the account may not save it", async () => {
    api.startDownload.mockRejectedValue(new ApiError({ status: 403, code: "DOWNLOAD_NOT_OWNED" }));
    render(<SaveOfflineButton trackId="t1" title="Low Tide" />);
    fireEvent.click(await screen.findByRole("button", { name: "Save Low Tide for offline listening" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("buying the song"));
  });

  it("shows songs already saved and removes them from the device", async () => {
    store.getOfflineSong.mockResolvedValue({ trackId: "t1", userId: "u1", byteSize: 6 });
    render(<SaveOfflineButton trackId="t1" title="Low Tide" />);
    fireEvent.click(await screen.findByRole("button", { name: "Remove Low Tide from this device" }));
    await waitFor(() => expect(store.removeOfflineSong).toHaveBeenCalledWith("t1"));
    expect(await screen.findByRole("button", { name: "Save Low Tide for offline listening" })).toBeTruthy();
  });
});
