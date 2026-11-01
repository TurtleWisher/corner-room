// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ pathname: "/listen" }));
const router = vi.hoisted(() => ({ back: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname, useRouter: () => router }));

const api = vi.hoisted(() => ({
  openListeningSession: vi.fn(),
  fetchTrackAudio: vi.fn(),
  closeListeningSession: vi.fn(async (id: string) => ({ closed: Boolean(id) })),
  ingestPlaybackEvent: vi.fn(async (body: { track_id: string }) => ({ track_id: body.track_id })),
  fetchTrack: vi.fn(async (id: string) => ({ id, title: "Last Stop", status: "RELEASED" })),
}));
vi.mock("@/lib/api", async (orig) => ({ ...(await orig<typeof import("@/lib/api")>()), ...api }));

import { ListeningRoom } from "./listening-room";
import { PlayerBar, PlayerProvider, usePlayer, type PlayerTrack } from "./player";

const QUEUE: PlayerTrack[] = [
  { id: "t1", title: "Last Stop", artist: "Kaal Bela" },
  { id: "t2", title: "Night Bus", artist: "Kaal Bela" },
  { id: "t3", title: "Home Late", artist: "Kaal Bela" },
];

const play = vi.fn(async function (this: HTMLMediaElement) {
  Object.defineProperty(this, "paused", { value: false, configurable: true });
  this.dispatchEvent(new Event("play"));
});

beforeAll(() => {
  // jsdom has no media playback: the element's methods only report what a browser would.
  HTMLMediaElement.prototype.play = play;
  HTMLMediaElement.prototype.pause = vi.fn(function (this: HTMLMediaElement) {
    Object.defineProperty(this, "paused", { value: true, configurable: true });
    this.dispatchEvent(new Event("pause"));
  });
  HTMLMediaElement.prototype.load = vi.fn();
  // jsdom draws nothing: the room's backdrop simply stays empty.
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as unknown as HTMLCanvasElement["getContext"];
});
beforeEach(() => {
  nav.pathname = "/listen";
  play.mockClear();
  api.ingestPlaybackEvent.mockClear();
  api.openListeningSession.mockImplementation(async (track_id: string) => ({
    id: `s-${track_id}`,
    user_id: "u",
    status: "OPEN",
    version: 1,
    audio_deliverable: true,
    track_id,
  }));
  api.fetchTrackAudio.mockImplementation(async (track_id: string) => ({
    url: `/api/v1/playback/media/tok-${track_id}`,
    expires_at: "",
    track_id,
    track_version_id: "v",
    media_asset_id: "m",
  }));
});
afterEach(cleanup);

function Start({ track = QUEUE[0], queue }: { track?: PlayerTrack; queue?: PlayerTrack[] }) {
  const p = usePlayer();
  return <button onClick={() => void p.play(track, queue ? { queue, source: "Night Bus" } : undefined)}>start {track.id}</button>;
}

/** jsdom has no PointerEvent: build one with the pointer type the room checks. */
function pointerMove(el: Element, clientX: number, pointerType: "mouse" | "touch") {
  const ev = new MouseEvent("pointermove", { bubbles: true, clientX });
  Object.defineProperty(ev, "pointerType", { value: pointerType });
  fireEvent(el, ev);
}

function audioEl() {
  return document.querySelector("audio") as HTMLAudioElement;
}

function setMedia(position: number, duration: number) {
  const a = audioEl();
  Object.defineProperty(a, "duration", { value: duration, configurable: true });
  Object.defineProperty(a, "currentTime", { value: position, configurable: true, writable: true });
  fireEvent.durationChange(a);
  fireEvent.timeUpdate(a);
}

/** Real listening: the playhead moves forward a second at a time while playing (D-LISTEN-01). */
function listen(seconds: number, duration = 200) {
  const a = audioEl();
  Object.defineProperty(a, "paused", { value: false, configurable: true });
  for (let t = 0; t <= seconds; t += 1) setMedia(t, duration);
}

describe("PlayerProvider", () => {
  it("plays a track and follows media events", async () => {
    render(
      <PlayerProvider>
        <Start />
        <PlayerBar />
      </PlayerProvider>,
    );
    await act(async () => screen.getByText("start t1").click());
    expect(audioEl().src).toContain("/api/v1/playback/media/tok-t1");
    await act(async () => setMedia(5, 20));
    expect(screen.getByLabelText("Seek in Last Stop").getAttribute("aria-valuetext")).toBe("0:05 of 0:20");
    expect(screen.getByRole("button", { name: "Pause Last Stop" })).toBeTruthy();
  });

  it("says when the browser refuses to start without a click, instead of claiming to play", async () => {
    play.mockImplementationOnce(async () => {
      throw new DOMException("blocked", "NotAllowedError");
    });
    render(
      <PlayerProvider>
        <Start />
        <PlayerBar />
      </PlayerProvider>,
    );
    await act(async () => screen.getByText("start t1").click());
    expect(screen.getByText("Ready")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Play Last Stop" })).toBeTruthy();
    // The song's length is read meanwhile, so the scrubber is ready when play is pressed.
    const audio = document.querySelector("audio")!;
    expect(audio.preload).toBe("metadata");
    expect(HTMLMediaElement.prototype.load).toHaveBeenCalled();
  });

  it("shows an unknown length as --:-- and does not offer seeking yet", async () => {
    render(
      <PlayerProvider>
        <Start />
        <PlayerBar />
      </PlayerProvider>,
    );
    await act(async () => screen.getByText("start t1").click());
    const seek = screen.getByLabelText("Seek in Last Stop") as HTMLInputElement;
    expect(seek.disabled).toBe(true);
    expect(screen.getByText("--:--")).toBeTruthy();
  });

  it("ignores an older, slower load when a newer track was chosen", async () => {
    let release: (() => void) | null = null;
    api.openListeningSession.mockImplementationOnce(
      (track_id: string) =>
        new Promise((resolve) => {
          release = () => resolve({ id: `s-${track_id}`, user_id: "u", status: "OPEN", version: 1, audio_deliverable: true, track_id });
        }),
    );
    render(
      <PlayerProvider>
        <Start track={QUEUE[0]} />
        <Start track={QUEUE[1]} />
        <PlayerBar />
      </PlayerProvider>,
    );
    await act(async () => {
      screen.getByText("start t1").click();
    });
    await act(async () => screen.getByText("start t2").click());
    await act(async () => release?.());
    expect(audioEl().src).toContain("tok-t2");
    expect(screen.getByRole("button", { name: "Pause Night Bus" })).toBeTruthy();
  });

  it("reports a listen once when a paused track is replaced", async () => {
    render(
      <PlayerProvider>
        <Start track={QUEUE[0]} />
        <Start track={QUEUE[1]} />
      </PlayerProvider>,
    );
    await act(async () => screen.getByText("start t1").click());
    await act(async () => {
      listen(8, 20);
      audioEl().pause();
    });
    await act(async () => screen.getByText("start t2").click());
    const t1Reports = api.ingestPlaybackEvent.mock.calls.filter(([body]) => body.track_id === "t1");
    expect(t1Reports).toHaveLength(1);
  });
});

describe("listen counting (D-LISTEN-01)", () => {
  it("reports what was actually heard, at the 30-second mark, and a skip ahead adds nothing", async () => {
    render(
      <PlayerProvider>
        <Start track={QUEUE[0]} />
      </PlayerProvider>,
    );
    await act(async () => screen.getByText("start t1").click());
    // Jumping straight to 3:00 is not listening: no report, nothing heard.
    await act(async () => setMedia(180, 200));
    expect(api.ingestPlaybackEvent).not.toHaveBeenCalled();
    // Thirty real seconds: one report goes out while the song is still playing.
    await act(async () => listen(31));
    expect(api.ingestPlaybackEvent).toHaveBeenCalledTimes(1);
    expect((api.ingestPlaybackEvent.mock.calls[0][0] as { duration_ms?: number }).duration_ms).toBe(30_000);
  });
});

describe("listening sessions", () => {
  it("closes the old session only after its playback report has landed", async () => {
    const order: string[] = [];
    let land: (() => void) | null = null;
    api.ingestPlaybackEvent.mockImplementationOnce(
      (body: { track_id: string }) =>
        new Promise((resolve) => {
          order.push(`report ${body.track_id}`);
          land = () => {
            order.push(`landed ${body.track_id}`);
            resolve({ track_id: body.track_id });
          };
        }),
    );
    api.closeListeningSession.mockImplementation(async (id: string) => {
      order.push(`close ${id}`);
      return { closed: true };
    });
    render(
      <PlayerProvider>
        <Start track={QUEUE[0]} />
        <Start track={QUEUE[1]} />
      </PlayerProvider>,
    );
    await act(async () => screen.getByText("start t1").click());
    await act(async () => listen(8, 20));
    await act(async () => screen.getByText("start t2").click());
    expect(order).toEqual(["report t1"]);
    await act(async () => land?.());
    expect(order).toEqual(["report t1", "landed t1", "close s-t1"]);
  });
});

describe("Up next", () => {
  function renderQueue() {
    return render(
      <PlayerProvider>
        <Start track={QUEUE[0]} queue={QUEUE} />
        <PlayerBar />
      </PlayerProvider>,
    );
  }

  it("moves to the next track, and back with Previous; Previous restarts only the first track", async () => {
    renderQueue();
    await act(async () => screen.getByText("start t1").click());
    await act(async () => screen.getByRole("button", { name: "Next track" }).click());
    expect(audioEl().src).toContain("tok-t2");
    await act(async () => setMedia(10, 20));
    await act(async () => screen.getByRole("button", { name: "Previous track" }).click());
    expect(audioEl().src).toContain("tok-t1");
    await act(async () => setMedia(10, 20));
    await act(async () => screen.getByRole("button", { name: "Previous track" }).click());
    expect(audioEl().src).toContain("tok-t1");
    expect(audioEl().currentTime).toBe(0);
  });

  it("plays the next track when one ends, and stops after the last", async () => {
    renderQueue();
    await act(async () => screen.getByText("start t1").click());
    await act(async () => fireEvent.ended(audioEl()));
    expect(audioEl().src).toContain("tok-t2");
    await act(async () => fireEvent.ended(audioEl()));
    expect(audioEl().src).toContain("tok-t3");
    expect(screen.queryByRole("button", { name: "Next track" })).toBeNull();
    await act(async () => fireEvent.ended(audioEl()));
    expect(audioEl().src).toContain("tok-t3");
    expect(screen.getByRole("button", { name: "Play Home Late" })).toBeTruthy();
  });

  it("stops honestly when the next track cannot be played", async () => {
    api.openListeningSession.mockImplementation(async (track_id: string) => {
      if (track_id === "t2") {
        const { ApiError } = await import("@/lib/api");
        throw new ApiError({ status: 403, code: "ENTITLEMENT_REQUIRED" });
      }
      return { id: `s-${track_id}`, user_id: "u", status: "OPEN", version: 1, audio_deliverable: true, track_id };
    });
    renderQueue();
    await act(async () => screen.getByText("start t1").click());
    await act(async () => screen.getByRole("button", { name: "Next track" }).click());
    expect(screen.getByText(/Buy this song, or the release it is on/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Pause/ })).toBeNull();
  });
});

describe("ListeningRoom", () => {
  function renderRoom() {
    nav.pathname = "/listen/t1";
    return render(
      <PlayerProvider>
        <Start track={QUEUE[1]} queue={QUEUE} />
        <PlayerBar />
        <ListeningRoom />
      </PlayerProvider>,
    );
  }

  it("is a carousel: earlier tracks on the left, later on the right, side cards play", async () => {
    renderRoom();
    await act(async () => screen.getByText("start t2").click());
    // The bar steps aside inside the room; the room has its own controls.
    expect(screen.queryByRole("region", { name: "Player" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Night Bus" })).toBeTruthy();
    // The title is the way to the song page (D-ROOM-03); no separate "Track page" link.
    expect(screen.getByRole("link", { name: "Night Bus" }).getAttribute("href")).toBe("/tracks/t2");
    expect(screen.queryByRole("link", { name: "Track page" })).toBeNull();
    expect(screen.getByText("From Night Bus · Track 2 of 3")).toBeTruthy();
    const slots = [...document.querySelectorAll<HTMLElement>(".lr-slot")].map((s) => [s.dataset.offset, s.textContent?.includes("Last Stop") ? "t1" : s.textContent?.includes("Home Late") ? "t3" : "t2"]);
    expect(slots).toEqual([
      ["-1", "t1"],
      ["0", "t2"],
      ["1", "t3"],
    ]);
    await act(async () => screen.getByRole("button", { name: "Play Last Stop by Kaal Bela" }).click());
    expect(audioEl().src).toContain("tok-t1");
    expect(screen.getByRole("heading", { name: "Last Stop" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Now playing Last Stop by Kaal Bela");
  });

  it("opens one song in focus from the front card, and Escape returns to the carousel", async () => {
    renderRoom();
    await act(async () => screen.getByText("start t2").click());
    await act(async () => screen.getByRole("button", { name: "Open Night Bus in focus" }).click());
    expect(document.querySelector(".lr")?.getAttribute("data-mode")).toBe("focus");
    expect(document.querySelector(".lr-slot")).toBeNull();
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Pause Night Bus");
    await act(async () => fireEvent.keyDown(window, { key: "Escape" }));
    expect(document.querySelector(".lr")?.getAttribute("data-mode")).toBe("carousel");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Open Night Bus in focus");
  });

  it("in focus, shows a neighbour only when a mouse nears that edge", async () => {
    renderRoom();
    await act(async () => screen.getByText("start t2").click());
    await act(async () => screen.getByRole("button", { name: "Open Night Bus in focus" }).click());
    const room = document.querySelector(".lr") as HTMLElement;
    Object.defineProperty(room, "clientWidth", { value: 1440, configurable: true });
    const left = () => document.querySelector(".lr-peek[data-side=left]") as HTMLElement;
    const right = () => document.querySelector(".lr-peek[data-side=right]") as HTMLElement;
    expect(left().hasAttribute("data-shown") || right().hasAttribute("data-shown")).toBe(false);
    await act(async () => pointerMove(room, 20, "mouse"));
    expect(left().hasAttribute("data-shown")).toBe(true);
    expect(right().hasAttribute("data-shown")).toBe(false);
    await act(async () => pointerMove(room, 1420, "mouse"));
    expect(right().hasAttribute("data-shown")).toBe(true);
    await act(async () => pointerMove(room, 1420, "touch"));
    await act(async () => pointerMove(room, 700, "mouse"));
    expect(left().hasAttribute("data-shown") || right().hasAttribute("data-shown")).toBe(false);
    await act(async () => {
      pointerMove(room, 1420, "mouse");
    });
    await act(async () => right().click());
    expect(audioEl().src).toContain("tok-t3");
  });

  /** Two animation frames: the lyric ring moves its lines once a frame. */
  async function frames() {
    await act(async () => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
  }

  /** The room with a song no earlier test has played (the room keeps lyrics per page view). */
  async function renderSung(id: string) {
    api.fetchTrack.mockImplementation(async (trackId: string) => ({
      id: trackId,
      title: "Night Bus",
      status: "RELEASED",
      lyrics: "one\ntwo\n\nthree\nfour\nfive",
    }));
    const sung = { id, title: "Night Bus", artist: "Kaal Bela" };
    nav.pathname = `/listen/${id}`;
    render(
      <PlayerProvider>
        <Start track={sung} queue={[QUEUE[0], sung, QUEUE[2]]} />
        <ListeningRoom />
      </PlayerProvider>,
    );
    await act(async () => screen.getByText(`start ${id}`).click());
    await act(async () => setMedia(10, 20));
  }

  afterEach(() => {
    api.fetchTrack.mockImplementation(async (id: string) => ({ id, title: "Last Stop", status: "RELEASED" }));
    window.localStorage.removeItem("cr.room.lyrics");
  });

  it("floats the lyrics round the front cover, in its own 3D space, in the carousel and in focus", async () => {
    await renderSung("t-sung");
    // Off until the listener turns them on.
    expect(document.querySelector(".lr-lyric")).toBeNull();
    await act(async () => (await screen.findByRole("button", { name: "Lyrics" })).click());
    // The ring floats with the front card: both sit in the card's float wrapper.
    const orbit = document.querySelector('.lr-slot[data-offset="0"] .lr-bob > .lr-orbit') as HTMLElement;
    expect(orbit.getAttribute("aria-hidden")).toBe("true");
    expect(orbit.previousElementSibling?.classList.contains("lr-card")).toBe(true);
    expect(document.querySelectorAll(".lr-slot:not([data-offset='0']) .lr-orbit")).toHaveLength(0);
    // Two lines leaving, the line now, the next arriving: at most four elements, never the song.
    const lines = [...orbit.querySelectorAll<HTMLElement>(".lr-lyric")];
    expect(lines.map((l) => l.dataset.index)).toEqual(["0", "1", "2", "3"]);
    await frames();
    // The line now is in front of the cover and shown.
    const depth = (el: HTMLElement) => Number(/translate3d\([^,]+,[^,]+, (-?[\d.]+)px\)/.exec(el.style.transform)?.[1]);
    expect(depth(lines[2])).toBeGreaterThan(0);
    expect(lines[2].dataset.plane).toBe("front");
    expect(Number(lines[2].style.opacity)).toBeGreaterThan(0.9);
    // Half a line early, the next line is still coming round from behind.
    expect(depth(lines[3])).toBeLessThan(0);
    expect(lines[3].dataset.plane).not.toBe("front");
    await act(async () => screen.getByRole("button", { name: "Open Night Bus in focus" }).click());
    expect(document.querySelector(".lr-focus-cover .lr-orbit[data-axis=over] .lr-lyric")).toBeTruthy();
  });

  it("holds and lights a pointed line, and turning lyrics off takes every line away", async () => {
    await renderSung("t-held");
    await act(async () => (await screen.findByRole("button", { name: "Lyrics" })).click());
    await frames();
    const now = document.querySelector<HTMLElement>('.lr-lyric[data-index="2"]')!;
    const enter = new MouseEvent("pointerover", { bubbles: true });
    Object.defineProperty(enter, "pointerType", { value: "mouse" });
    await act(async () => fireEvent(now, enter));
    expect(now.hasAttribute("data-focus")).toBe(true);
    const leave = new MouseEvent("pointerout", { bubbles: true });
    Object.defineProperty(leave, "pointerType", { value: "mouse" });
    await act(async () => fireEvent(now, leave));
    expect(now.hasAttribute("data-focus")).toBe(false);
    await act(async () => screen.getByRole("button", { name: "Lyrics" }).click());
    expect(document.querySelector(".lr-orbit")).toBeNull();
  });

  it("under reduced motion shows only the line now, still", async () => {
    const before = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query.includes("reduce"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
    try {
      await renderSung("t-still");
      await act(async () => (await screen.findByRole("button", { name: "Lyrics" })).click());
      await frames();
      const shown = [...document.querySelectorAll<HTMLElement>(".lr-lyric")].filter((l) => Number(l.style.opacity) > 0);
      expect(shown.map((l) => l.dataset.index)).toEqual(["2"]);
    } finally {
      window.matchMedia = before;
    }
  });

  it("seeks from the keyboard in 5 second steps", async () => {
    renderRoom();
    await act(async () => screen.getByText("start t2").click());
    await act(async () => setMedia(6, 20));
    fireEvent.keyDown(screen.getByLabelText("Seek in Night Bus"), { key: "ArrowRight" });
    expect(audioEl().currentTime).toBe(11);
    fireEvent.keyDown(screen.getByLabelText("Seek in Night Bus"), { key: "End" });
    expect(audioEl().currentTime).toBe(20);
  });

  it("leaves to Listen when there is nowhere to go back to", async () => {
    renderRoom();
    await act(async () => screen.getByText("start t2").click());
    await act(async () => screen.getByRole("button", { name: "Leave the listening room" }).click());
    expect(router.push).toHaveBeenCalledWith("/listen");
  });
});

describe("Phase 8 controls", () => {
  beforeEach(() => window.localStorage.clear());

  it("asks the API for the codecs the browser reports, MP3 always included", async () => {
    render(
      <PlayerProvider>
        <Start />
      </PlayerProvider>,
    );
    await act(async () => screen.getByText("start t1").click());
    const accept = api.fetchTrackAudio.mock.calls.at(-1)?.[1] as string[];
    expect(accept.at(-1)).toBe("mp3");
  });

  it("repeat one plays the same track again at its end, as a new listen", async () => {
    render(
      <PlayerProvider>
        <Start queue={QUEUE} />
        <PlayerBar />
      </PlayerProvider>,
    );
    await act(async () => screen.getByText("start t1").click());
    const repeat = screen.getByRole("button", { name: "Repeat: off" });
    await act(async () => repeat.click());
    await act(async () => screen.getByRole("button", { name: "Repeat: all tracks" }).click());
    expect(screen.getByRole("button", { name: "Repeat: this track" })).toBeTruthy();
    const opened = api.openListeningSession.mock.calls.length;
    await act(async () => fireEvent.ended(audioEl()));
    expect(api.openListeningSession.mock.calls.length).toBe(opened + 1);
    expect(api.openListeningSession.mock.calls.at(-1)?.[0]).toBe("t1");
  });

  it("repeat all goes from the last track back to the first", async () => {
    render(
      <PlayerProvider>
        <Start track={QUEUE[2]} queue={QUEUE} />
        <PlayerBar />
      </PlayerProvider>,
    );
    await act(async () => screen.getByText("start t3").click());
    expect(screen.queryByRole("button", { name: "Next track" })).toBeNull();
    await act(async () => screen.getByRole("button", { name: "Repeat: off" }).click());
    await act(async () => screen.getByRole("button", { name: "Next track" }).click());
    expect(api.openListeningSession.mock.calls.at(-1)?.[0]).toBe("t1");
  });

  it("shuffle keeps the playing track and restores the list order when turned off", async () => {
    let seen: string[] = [];
    function Queue() {
      const p = usePlayer();
      seen = p.queue.map((t) => t.id);
      return <p data-testid="index">{p.index}</p>;
    }
    render(
      <PlayerProvider>
        <Start track={QUEUE[1]} queue={QUEUE} />
        <PlayerBar />
        <Queue />
      </PlayerProvider>,
    );
    await act(async () => screen.getByText("start t2").click());
    await act(async () => screen.getByRole("button", { name: "Shuffle: off" }).click());
    expect(screen.getByRole("button", { name: "Shuffle: on" }).getAttribute("aria-pressed")).toBe("true");
    expect(seen[0]).toBe("t2");
    expect([...seen].sort()).toEqual(["t1", "t2", "t3"]);
    await act(async () => screen.getByRole("button", { name: "Shuffle: on" }).click());
    expect(seen).toEqual(["t1", "t2", "t3"]);
    expect(screen.getByTestId("index").textContent).toBe("1");
  });

  it("falls back to the other verified copy when the first will not decode", async () => {
    api.fetchTrackAudio.mockImplementationOnce(async (track_id: string) => ({
      url: `/api/v1/playback/media/opus-${track_id}`,
      expires_at: "",
      track_id,
      track_version_id: "v",
      media_asset_id: "m",
      codec: "opus",
      bitrate_kbps: 160,
      alternates: [{ codec: "mp3", url: `/api/v1/playback/media/mp3-${track_id}` }],
    }));
    render(
      <PlayerProvider>
        <Start />
      </PlayerProvider>,
    );
    await act(async () => screen.getByText("start t1").click());
    const a = audioEl();
    expect(a.src).toContain("opus-t1");
    a.removeAttribute("crossorigin");
    Object.defineProperty(a, "error", { value: { code: 4 }, configurable: true });
    const fetched = api.fetchTrackAudio.mock.calls.length;
    await act(async () => fireEvent.error(a));
    expect(a.src).toContain("mp3-t1");
    // The fallback needed no new permission round-trip.
    expect(api.fetchTrackAudio.mock.calls.length).toBe(fetched);
  });

  it("refreshes an expired link each time during one long song, but stops when a fresh link fails at once", async () => {
    render(
      <PlayerProvider>
        <Start />
        <PlayerBar />
      </PlayerProvider>,
    );
    await act(async () => screen.getByText("start t1").click());
    const a = audioEl();
    a.removeAttribute("crossorigin");
    Object.defineProperty(a, "error", { value: { code: 2 }, configurable: true }); // network: the link expired
    const before = api.fetchTrackAudio.mock.calls.length;
    await act(async () => fireEvent.error(a));
    expect(api.fetchTrackAudio.mock.calls.length).toBe(before + 1);
    await act(async () => fireEvent.playing(a)); // audio flows again
    await act(async () => fireEvent.error(a)); // the next link expires later in the same song
    expect(api.fetchTrackAudio.mock.calls.length).toBe(before + 2);
    // This time the fresh link fails straight away: no endless refreshing, an honest stop.
    await act(async () => fireEvent.error(a));
    expect(api.fetchTrackAudio.mock.calls.length).toBe(before + 2);
    expect(screen.getByText(/stopped|couldn't|could not/i)).toBeTruthy();
  });

  it("offers normalise volume, off by default, and remembers the choice on this device", async () => {
    // The old automatic "on" (saved with shuffle and repeat) no longer turns it on (owner, 2026-10-28).
    window.localStorage.setItem("cr.player.prefs", JSON.stringify({ shuffle: false, repeat: "off", normalise: true }));
    render(
      <PlayerProvider>
        <Start />
        <ListeningRoom />
      </PlayerProvider>,
    );
    await act(async () => screen.getByText("start t1").click());
    const toggle = screen.getByRole("button", { name: "Normalise volume: off" });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    await act(async () => toggle.click());
    expect(screen.getByRole("button", { name: "Normalise volume: on" })).toBeTruthy();
    expect(JSON.parse(window.localStorage.getItem("cr.player.prefs") ?? "{}").levelling).toBe(true);
  });
});
