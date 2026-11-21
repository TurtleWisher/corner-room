// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/components/workspace-provider", () => ({ useWorkspace: () => ({ currentOrg: { id: "org1" } }) }));
const searchLyricSongs = vi.fn();
vi.mock("@/features/studio/api", () => ({ searchLyricSongs: (q: string) => searchLyricSongs(q) }));

import { LyricsSyncFinder } from "./lyrics-sync-finder";

const SONGS = [
  { track_id: "t1", title: "Last Stop", profile_name: "Kaal Bela", release_title: "Night Bus", lines: 12, timed: false, lyrics_waiting: false },
  { track_id: "t2", title: "Low Tide", profile_name: "Rumi", release_title: null, lines: 8, timed: true, lyrics_waiting: false },
];

beforeEach(() => {
  vi.useFakeTimers();
  push.mockReset();
  searchLyricSongs.mockReset();
  searchLyricSongs.mockResolvedValue(SONGS);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400);
  });
}

describe("LyricsSyncFinder (owner, 2026-11-21)", () => {
  it("lists nothing until something is typed, then unfolds with the typed words lit", async () => {
    const { container } = render(<LyricsSyncFinder />);
    await settle();
    // One quiet check of the right to sync; its songs are never listed.
    expect(searchLyricSongs).toHaveBeenCalledWith("");
    expect(screen.queryByRole("option")).toBeNull();
    expect(container.querySelector(".st-fold")?.hasAttribute("data-open")).toBe(false);

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "  stop " } });
    await settle();
    expect(searchLyricSongs).toHaveBeenLastCalledWith("stop");
    expect(container.querySelector(".st-fold")?.hasAttribute("data-open")).toBe(true);
    expect(screen.getAllByRole("option")).toHaveLength(2);
    expect(container.querySelector("mark.st-hit")?.textContent).toBe("Stop");
    expect(screen.getByText("2 songs")).toBeTruthy();
  });

  it("opens the chosen song with Enter and folds away on Escape", async () => {
    const { container } = render(<LyricsSyncFinder />);
    await settle();
    const field = screen.getByRole("combobox");
    fireEvent.change(field, { target: { value: "rumi" } });
    await settle();
    fireEvent.keyDown(field, { key: "ArrowDown" });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(push).toHaveBeenCalledWith("/staff/catalog/lyrics-timing/t2");
    fireEvent.keyDown(field, { key: "Escape" });
    await settle();
    expect((field as HTMLInputElement).value).toBe("");
    expect(container.querySelector(".st-fold")?.hasAttribute("data-open")).toBe(false);
  });

  it("hides for people who can't sync", async () => {
    const { ApiError } = await import("@/lib/api/client");
    searchLyricSongs.mockRejectedValue(new ApiError({ status: 404, code: "NOT_FOUND" }));
    const { container } = render(<LyricsSyncFinder />);
    await settle();
    expect(container.textContent).toBe("");
  });
});
