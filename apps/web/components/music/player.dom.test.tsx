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
    expect(screen.getByText("Press play to start")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Play Last Stop" })).toBeTruthy();
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
      setMedia(8, 20);
      audioEl().pause();
    });
    await act(async () => screen.getByText("start t2").click());
    const t1Reports = api.ingestPlaybackEvent.mock.calls.filter(([body]) => body.track_id === "t1");
    expect(t1Reports).toHaveLength(1);
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
    await act(async () => setMedia(8, 20));
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
    expect(screen.getByText(/Subscription required/)).toBeTruthy();
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

  it("offers normalise volume, on by default, and remembers the choice on this device", async () => {
    render(
      <PlayerProvider>
        <Start />
        <ListeningRoom />
      </PlayerProvider>,
    );
    await act(async () => screen.getByText("start t1").click());
    const toggle = screen.getByRole("button", { name: "Normalise volume: on" });
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    await act(async () => toggle.click());
    expect(screen.getByRole("button", { name: "Normalise volume: off" })).toBeTruthy();
    expect(JSON.parse(window.localStorage.getItem("cr.player.prefs") ?? "{}").normalise).toBe(false);
  });
});
