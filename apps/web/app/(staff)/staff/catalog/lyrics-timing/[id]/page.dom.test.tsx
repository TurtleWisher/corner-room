// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The song's own clock, moved by each test (seconds).
const clock = { at: 0 };
const player = {
  isCurrent: () => true,
  status: "playing",
  problem: null,
  exactPosition: () => clock.at,
  play: vi.fn(),
  seek: vi.fn(),
  toggle: vi.fn(),
};
vi.mock("@/components/music/player", () => ({
  usePlayer: () => player,
  usePlayerProgress: () => ({ position: clock.at, duration: 60 }),
}));
vi.mock("next/navigation", () => ({ useParams: () => ({ id: "t1" }) }));
vi.mock("@/components/staff/kit", async (load) => ({
  ...(await load<typeof import("@/components/staff/kit")>()),
  Protected: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
const api = {
  fetchStaffLyrics: vi.fn(),
  saveLyricTimings: vi.fn(),
  saveStaffLyrics: vi.fn(),
  reviewLyrics: vi.fn(),
};
vi.mock("@/features/studio/api", () => ({
  fetchStaffLyrics: (...a: unknown[]) => api.fetchStaffLyrics(...a),
  saveLyricTimings: (...a: unknown[]) => api.saveLyricTimings(...a),
  saveStaffLyrics: (...a: unknown[]) => api.saveStaffLyrics(...a),
  reviewLyrics: (...a: unknown[]) => api.reviewLyrics(...a),
}));

import LyricsTimingPage from "./page";

const SONG = {
  track_id: "t1",
  title: "Last Stop",
  status: "RELEASED",
  profile_name: "Kaal Bela",
  lyrics: "First line\nSecond line",
  lyrics_timings_ms: null,
  lyrics_line_ends_ms: null,
  lyrics_waiting: false,
  lyrics_pending: null,
  waiting_from_me: false,
  approves_at_once: true,
};

function space(type: "keydown" | "keyup", at: number) {
  clock.at = at;
  act(() => {
    window.dispatchEvent(new KeyboardEvent(type, { key: " ", bubbles: true }));
  });
}

beforeEach(() => {
  clock.at = 0;
  Object.values(api).forEach((f) => f.mockReset());
  api.saveLyricTimings.mockImplementation(async (_id: string, times: number[], ends: number[]) => ({
    track_id: "t1",
    lyrics: SONG.lyrics,
    lyrics_timings_ms: times,
    lyrics_line_ends_ms: ends,
  }));
  Element.prototype.scrollTo = function scrollTo() {} as typeof Element.prototype.scrollTo;
  window.matchMedia = ((query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia;
});
afterEach(cleanup);

/** Presses only count once the song is playing: wait for the Hold button to wake (slow under load). */
async function ready() {
  await waitFor(() => expect((document.querySelector(".st-tap") as HTMLButtonElement | null)?.disabled).toBe(false), { timeout: 5000 });
}

describe("lyrics sync, line ends (owner, 2026-11-21, D-LYRICS-05)", () => {
  it("a hold marks a line's start and end; a quick tap runs on to the next press; then it saves both", async () => {
    api.fetchStaffLyrics.mockResolvedValue(SONG);
    render(<LyricsTimingPage />);
    await screen.findByText("Last Stop");
    await ready();

    // Line 1: held from 1.0 s to 2.5 s.
    space("keydown", 1);
    expect(screen.getByText(/Singing line 1/)).toBeTruthy();
    space("keyup", 2.5);
    expect(screen.getByText("to 0:02.50")).toBeTruthy();
    // Line 2: a quick tap at 3.0 s stays open; one more tap at 5.0 s ends it.
    space("keydown", 3);
    space("keyup", 3.05);
    expect(screen.getByText(/tap once more as it ends/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Saved" })).toBeTruthy();
    space("keydown", 5);
    space("keyup", 5.02);
    expect(screen.getByText("to 0:05.00")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Save timings" }));
    await waitFor(() => expect(api.saveLyricTimings).toHaveBeenCalledWith("t1", [1000, 3000], [2500, 5000]));
    expect(await screen.findByText(/lets it go quiet as it ends/)).toBeTruthy();
  });

  it("a song synced with starts only says so, and loads each line ending where the next begins", async () => {
    api.fetchStaffLyrics.mockResolvedValue({ ...SONG, lyrics_timings_ms: [1000, 3000] });
    render(<LyricsTimingPage />);
    expect(await screen.findByText("Needs line ends")).toBeTruthy();
    await ready();
    expect(screen.getByText("to 0:03.00")).toBeTruthy();
    expect(screen.getByText(/synced with start times only/)).toBeTruthy();
    space("keydown", 6);
    space("keyup", 6.01);
    fireEvent.click(screen.getByRole("button", { name: "Save timings" }));
    await waitFor(() => expect(api.saveLyricTimings).toHaveBeenCalledWith("t1", [1000, 3000], [3000, 6000]));
  });
});
