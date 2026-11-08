// @vitest-environment jsdom
/* Teasers (owner, 2026-11-07, D-TEASER-00): a teaser plays through the site's player without a
 * listening session or reported plays, as often as the listener likes, and the buy suggestion shows
 * only after a full listen, never on open, pause, a jump to the end or a failed load. */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ pathname: "/teasers/tz1" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname, useRouter: () => ({ push: vi.fn(), back: vi.fn() }) }));

const api = vi.hoisted(() => ({
  openListeningSession: vi.fn(),
  fetchTrackAudio: vi.fn(),
  closeListeningSession: vi.fn(),
  ingestPlaybackEvent: vi.fn(),
  fetchTrack: vi.fn(),
}));
vi.mock("@/lib/api", async (orig) => ({ ...(await orig<typeof import("@/lib/api")>()), ...api }));

const teasers = vi.hoisted(() => ({
  fetchTeaserAudio: vi.fn(async (id: string) => ({ url: `/api/v1/teasers/media/tok-${id}`, expires_at: "", codec: "mp3", alternates: [], duration_ms: 30000 })),
  countTeaser: vi.fn(),
  fetchTrackTeasers: vi.fn(async () => []),
  fetchPublicTeaser: vi.fn(),
}));
vi.mock("@/features/teasers/api", async (orig) => ({ ...(await orig<typeof import("@/features/teasers/api")>()), ...teasers }));
vi.mock("@/components/auth-provider", () => ({ useAuth: () => ({ status: "anonymous", user: null }) }));

import { PlayerBar, PlayerProvider } from "@/components/music/player";
import type { PublicTeaserRecord } from "@/features/teasers/api";

import { TeaserRoom } from "./teaser-room";

const TEASER: PublicTeaserRecord = {
  id: "tz1",
  title: "Chorus",
  track_id: "song1",
  track_title: "Night Song",
  track_released: true,
  release_id: "rel1",
  release_title: "Night Bus",
  release_at: null,
  artist: "Kaal Bela",
  artist_kind: "band",
  artist_id: "b1",
  cover_url: null,
  duration_ms: 30000,
  published_at: null,
  next_step: { kind: "BUY", track_id: "song1", release_id: "rel1" },
  other_teasers: [],
};

const play = vi.fn(async function (this: HTMLMediaElement) {
  Object.defineProperty(this, "paused", { value: false, configurable: true });
  this.dispatchEvent(new Event("play"));
  this.dispatchEvent(new Event("playing"));
});

beforeAll(() => {
  HTMLMediaElement.prototype.play = play;
  HTMLMediaElement.prototype.pause = vi.fn(function (this: HTMLMediaElement) {
    Object.defineProperty(this, "paused", { value: true, configurable: true });
    this.dispatchEvent(new Event("pause"));
  });
  HTMLMediaElement.prototype.load = vi.fn();
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as unknown as HTMLCanvasElement["getContext"];
});

beforeEach(() => {
  nav.pathname = "/teasers/tz1";
  vi.clearAllMocks();
  teasers.fetchPublicTeaser.mockResolvedValue(TEASER);
});
afterEach(cleanup);

function audioEl() {
  return document.querySelector("audio") as HTMLAudioElement;
}

function at(position: number, duration = 30) {
  const a = audioEl();
  Object.defineProperty(a, "duration", { value: duration, configurable: true });
  Object.defineProperty(a, "currentTime", { value: position, configurable: true, writable: true });
  fireEvent.durationChange(a);
  fireEvent.timeUpdate(a);
}

/** Forward listening, a second at a time, then the end of the audio. */
function listenToEnd(duration = 30) {
  const a = audioEl();
  Object.defineProperty(a, "paused", { value: false, configurable: true });
  for (let t = 0; t <= duration; t += 1) at(t, duration);
  fireEvent.ended(a);
}

async function openRoom() {
  render(
    <PlayerProvider>
      <TeaserRoom teaserId="tz1" />
      <PlayerBar />
    </PlayerProvider>,
  );
  await screen.findByRole("heading", { name: "Night Song" }, { timeout: 5000 });
}

describe("Preview Room", () => {
  it("says it is a teaser and offers nothing before a listen", async () => {
    await openRoom();
    expect(screen.getByText("Preview Room · Teaser · Chorus")).toBeTruthy();
    expect(screen.getByText(/not the full song/)).toBeTruthy();
    expect(screen.queryByText("Enjoying this teaser?")).toBeNull();
  });

  it("plays the teaser's own audio with no listening session and no reported plays", async () => {
    await openRoom();
    await act(async () => screen.getByRole("button", { name: "Play the teaser" }).click());
    expect(teasers.fetchTeaserAudio).toHaveBeenCalledWith("tz1", expect.anything());
    expect(audioEl().src).toContain("/api/v1/teasers/media/tok-tz1");
    expect(teasers.countTeaser).toHaveBeenCalledWith("tz1", "start");
    await act(async () => listenToEnd());
    expect(api.openListeningSession).not.toHaveBeenCalled();
    expect(api.fetchTrackAudio).not.toHaveBeenCalled();
    expect(api.ingestPlaybackEvent).not.toHaveBeenCalled();
    // The room draws its own controls: the bar steps aside for this teaser.
    expect(screen.queryByRole("region", { name: "Player" })).toBeNull();
  });

  it("suggests buying after a full listen; dismiss, replay and the next full listen shows it again", async () => {
    await openRoom();
    await act(async () => screen.getByRole("button", { name: "Play the teaser" }).click());
    await act(async () => listenToEnd());
    expect(teasers.countTeaser).toHaveBeenCalledWith("tz1", "complete");
    expect(screen.getByText("Enjoying this teaser?")).toBeTruthy();
    const buy = screen.getByRole("link", { name: "Buy the song" });
    expect(buy.getAttribute("href")).toBe("/tracks/song1");
    await act(async () => fireEvent.keyDown(window, { key: "Escape" }));
    expect(screen.queryByText("Enjoying this teaser?")).toBeNull();
    await act(async () => screen.getByRole("button", { name: "Play the teaser again from the start" }).click());
    expect(screen.queryByText("Enjoying this teaser?")).toBeNull();
    await act(async () => listenToEnd());
    expect(screen.getByText("Enjoying this teaser?")).toBeTruthy();
    await act(async () => screen.getByRole("button", { name: "Not now" }).click());
    expect(screen.queryByText("Enjoying this teaser?")).toBeNull();
  });

  it("never suggests on pause or a jump to the end", async () => {
    await openRoom();
    await act(async () => screen.getByRole("button", { name: "Play the teaser" }).click());
    await act(async () => {
      at(0);
      at(1);
      fireEvent.pause(audioEl());
    });
    expect(screen.queryByText("Enjoying this teaser?")).toBeNull();
    await act(async () => {
      fireEvent.seeking(audioEl());
      at(29.5);
      fireEvent.ended(audioEl());
    });
    expect(screen.queryByText("Enjoying this teaser?")).toBeNull();
    expect(teasers.countTeaser).not.toHaveBeenCalledWith("tz1", "complete");
  });

  it("never suggests buying to someone who owns the song", async () => {
    teasers.fetchPublicTeaser.mockResolvedValue({ ...TEASER, next_step: { kind: "OWNED", track_id: "song1", release_id: "rel1" } });
    await openRoom();
    expect(screen.getByRole("link", { name: "Play the full song" }).getAttribute("href")).toBe("/listen/song1");
    await act(async () => screen.getByRole("button", { name: "Play the teaser" }).click());
    await act(async () => listenToEnd());
    expect(screen.queryByText("Enjoying this teaser?")).toBeNull();
  });

  it("shows nothing broken when the audio can't load, and no suggestion", async () => {
    teasers.fetchTeaserAudio.mockRejectedValueOnce(new Error("offline"));
    await openRoom();
    await act(async () => screen.getByRole("button", { name: "Play the teaser" }).click());
    expect(screen.getByRole("status").textContent).toMatch(/stopped|try again/i);
    expect(screen.queryByText("Enjoying this teaser?")).toBeNull();
  });
});
