// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TrendingItem } from "@/features/trending/api";

const auth = vi.hoisted(() => ({ status: "anonymous" as "anonymous" | "authenticated" }));
const player = vi.hoisted(() => ({
  play: vi.fn(),
  playTeaser: vi.fn(),
  toggle: vi.fn(),
}));

vi.mock("@/components/auth-provider", () => ({ useAuth: () => ({ status: auth.status, user: null }) }));
vi.mock("@/components/music/credits", () => ({
  useCredits: () => ({ artists: [], bands: [{ id: "band-1", name: "MIZULS" }] }),
}));
vi.mock("@/components/music/commerce", () => ({
  useCustomerCommerce: () => ({
    offers: [],
    entitlements: auth.status === "authenticated" ? [{ scope: "RELEASE", ref_id: "rel-1", status: "ACTIVE" }] : [],
    streamable: new Set(),
    ready: true,
    reload: () => {},
  }),
}));
vi.mock("@/components/music/player", () => ({
  useOptionalPlayer: () => ({ ...player, track: null, status: "idle" }),
  usePlayerProgress: () => ({ position: 0, duration: 0 }),
}));

import { TrendingCorner } from "./trending-corner";

function item(n: number, over: Partial<TrendingItem> = {}): TrendingItem {
  return {
    id: `pick-${n}`,
    kind: "RELEASE",
    title: `Song ${n}`,
    track_id: null,
    release_id: `rel-${n}`,
    release_title: `Song ${n}`,
    release_type: "SINGLE",
    released_at: null,
    has_cover: false,
    primary_artist_id: null,
    primary_band_id: "band-1",
    listens: 641,
    tracks: [{ id: `trk-${n}`, title: `Song ${n}`, duration_ms: 225_000, release_ids: [`rel-${n}`], teaser_id: `tz-${n}`, listens: 641 }],
    ...over,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  auth.status = "anonymous";
  player.play.mockReset();
  player.playTeaser.mockReset();
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function room() {
  return screen.getByText("Trending", { selector: "span" }).closest(".tc-room") as HTMLElement;
}

describe("TrendingCorner (owner, 2026-11-08, D-TRENDING-01)", () => {
  it("shows one disc per pick with its name and artist, the first in front", () => {
    render(<TrendingCorner items={[item(1), item(2), item(3)]} />);
    const discs = screen.getAllByRole("button", { name: /Song \d/ }).filter((b) => b.classList.contains("tc-item"));
    expect(discs).toHaveLength(3);
    expect(discs[0].getAttribute("aria-current")).toBe("true");
    expect(within(room()).getByText("Song 1", { selector: "a" })).toBeTruthy();
    expect(within(room()).getByText("MIZULS")).toBeTruthy();
    expect(within(room()).getByText("1 of 3")).toBeTruthy();
  });

  it("brings a clicked disc to the front and the mini player follows at once", () => {
    render(<TrendingCorner items={[item(1), item(2), item(3)]} />);
    fireEvent.click(screen.getByRole("button", { name: "Bring Song 3 by MIZULS to the front" }));
    expect(within(room()).getByText("Song 3", { selector: "a" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Song 3 by MIZULS, in front" }).getAttribute("aria-current")).toBe("true");
  });

  it("steps with the player's arrows and the keyboard", () => {
    render(<TrendingCorner items={[item(1), item(2), item(3)]} />);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(within(room()).getByText("Song 2", { selector: "a" })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("group", { name: "Trending Corner" }), { key: "ArrowLeft" });
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(within(room()).getByText("Song 1", { selector: "a" })).toBeTruthy();
  });

  it("turns by itself, and stays still while pointed at", () => {
    const { container } = render(<TrendingCorner items={[item(1), item(2), item(3)]} />);
    act(() => {
      vi.advanceTimersByTime(5300);
    });
    expect(within(room()).getByText("Song 2", { selector: "a" })).toBeTruthy();
    fireEvent.pointerEnter(container.querySelector(".tc")!, { pointerType: "mouse" });
    act(() => {
      vi.advanceTimersByTime(20000);
    });
    expect(within(room()).getByText("Song 2", { selector: "a" })).toBeTruthy();
  });

  it("plays the teaser for visitors, with no sign of owning it", () => {
    render(<TrendingCorner items={[item(1)]} />);
    expect((screen.getByRole("button", { name: "Previous" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Play the teaser: Song 1" }));
    expect(player.playTeaser).toHaveBeenCalledWith(expect.objectContaining({ teaserId: "tz-1", trackId: "trk-1" }));
    expect(player.play).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: /Sign in to buy/ })).toBeTruthy();
  });

  it("plays the whole release for owners", () => {
    auth.status = "authenticated";
    render(<TrendingCorner items={[item(1)]} />);
    fireEvent.click(screen.getByRole("button", { name: "Play: Song 1" }));
    expect(player.play).toHaveBeenCalledWith(expect.objectContaining({ id: "trk-1" }), expect.objectContaining({ source: "Song 1" }));
    expect(screen.getByText("In your library")).toBeTruthy();
  });
});
