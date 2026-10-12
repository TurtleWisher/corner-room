// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", async (orig) => {
  const real = await orig<typeof import("@/lib/api")>();
  return {
    ...real,
    openListeningSession: vi.fn(async (track_id: string) => ({ id: "s1", user_id: "u", status: "OPEN", version: 1, audio_deliverable: true, track_id })),
    fetchTrackAudio: vi.fn(async (track_id: string) => ({ url: `/api/v1/playback/media/tok-${track_id}`, expires_at: "", track_id, track_version_id: "v", media_asset_id: "m" })),
    closeListeningSession: vi.fn(async () => ({})),
    ingestPlaybackEvent: vi.fn(async () => ({})),
    fetchTrack: vi.fn(async (id: string) => ({ id, title: "Last Stop", status: "RELEASED" })),
  };
});

import { PlayerBar, PlayerProvider, usePlayer } from "./player";

beforeAll(() => {
  // jsdom has no media playback.
  HTMLMediaElement.prototype.play = vi.fn(async function (this: HTMLMediaElement) {
    this.dispatchEvent(new Event("play"));
  });
  HTMLMediaElement.prototype.pause = vi.fn();
});
afterEach(cleanup);

function PlayButton() {
  const p = usePlayer();
  return (
    <button onClick={() => void p.play({ id: "t1", title: "Last Stop", artist: "Kaal Bela" })}>
      start
    </button>
  );
}

describe("PlayerProvider", () => {
  it("plays a track and follows media events without crashing", async () => {
    render(
      <PlayerProvider>
        <PlayButton />
        <PlayerBar />
      </PlayerProvider>,
    );
    await act(async () => {
      screen.getByText("start").click();
    });
    const audio = document.querySelector("audio") as HTMLAudioElement;
    expect(audio.src).toContain("/api/v1/playback/media/tok-t1");
    Object.defineProperty(audio, "duration", { value: 20, configurable: true });
    Object.defineProperty(audio, "currentTime", { value: 5, configurable: true, writable: true });
    await act(async () => {
      fireEvent.loadedMetadata(audio);
      fireEvent.timeUpdate(audio);
    });
    expect(screen.getByLabelText("Seek in Last Stop").getAttribute("aria-valuetext")).toBe("0:05 of 0:20");
    expect(screen.getByRole("button", { name: "Pause Last Stop" })).toBeTruthy();
  });
});
