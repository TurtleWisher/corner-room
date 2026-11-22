import { describe, expect, it } from "vitest";

import { SPIN_MAX, carouselWindow, edgeZone, isVisibleOffset, leaveTarget, nowPlayingAnnouncement, queuePositionLabel, pointerSpin, roomEyebrow, slotPose, springStep, swipeDirection, titleAtoms } from "./listening-room-view";

describe("carousel", () => {
  const q = ["a", "b", "c", "d", "e", "f", "g", "h"];

  it("puts the playing track in front with earlier tracks on the left and later on the right", () => {
    const w = carouselWindow(q, 3);
    expect(w.map((x) => [x.item, x.offset])).toEqual([
      ["a", -3],
      ["b", -2],
      ["c", -1],
      ["d", 0],
      ["e", 1],
      ["f", 2],
      ["g", 3],
    ]);
    expect(w.filter((x) => isVisibleOffset(x.offset)).map((x) => x.item)).toEqual(["b", "c", "d", "e", "f"]);
  });

  it("keeps earlier tracks reachable on the last track", () => {
    const w = carouselWindow(q, 7);
    expect(w.map((x) => x.offset)).toEqual([-3, -2, -1, 0]);
    expect(w.find((x) => x.offset === -1)?.item).toBe("g");
  });

  it("keys cards by queue position, so Next turns each card one place", () => {
    expect(carouselWindow(q, 0).find((x) => x.item === "b")).toMatchObject({ queueIndex: 1, offset: 1 });
    expect(carouselWindow(q, 1).find((x) => x.item === "b")).toMatchObject({ queueIndex: 1, offset: 0 });
  });

  it("handles a single track and an empty queue", () => {
    expect(carouselWindow(["only"], 0)).toEqual([{ item: "only", queueIndex: 0, offset: 0 }]);
    expect(carouselWindow([], 0)).toEqual([]);
  });
});

describe("edge zones", () => {
  it("names the edge a mouse is near, and nothing in the middle", () => {
    expect(edgeZone(20, 1440)).toBe("left");
    expect(edgeZone(1420, 1440)).toBe("right");
    expect(edgeZone(720, 1440)).toBeNull();
  });

  it("shrinks the zone on narrow rooms so the middle stays free", () => {
    expect(edgeZone(100, 400)).toBe("left");
    expect(edgeZone(301, 400)).toBe("right");
    expect(edgeZone(150, 400)).toBeNull();
  });

  it("ignores nonsense", () => {
    expect(edgeZone(NaN, 1000)).toBeNull();
    expect(edgeZone(10, 0)).toBeNull();
  });
});

describe("room copy and gestures", () => {
  it("names the position only when there is a list", () => {
    expect(queuePositionLabel(1, 5)).toBe("Track 2 of 5");
    expect(queuePositionLabel(0, 1)).toBeNull();
  });

  it("announces track changes with the artist when known", () => {
    expect(nowPlayingAnnouncement("Night Bus", "Kaal Bela")).toBe("Now playing Night Bus by Kaal Bela");
  });

  it("needs a deliberate sideways swipe", () => {
    expect(swipeDirection(-80, 10)).toBe("next");
    expect(swipeDirection(80, 10)).toBe("previous");
    expect(swipeDirection(-30, 0)).toBeNull();
    expect(swipeDirection(-80, 70)).toBeNull();
  });

  it("leaves back to where the listener came from, else to Listen", () => {
    expect(leaveTarget("/releases/abc")).toBe("back");
    expect(leaveTarget(null)).toBe("/listen");
  });
});

describe("roomEyebrow", () => {
  it("names the list it came from, but not a single named after the song", () => {
    expect(roomEyebrow("Night Bus EP", "Low Tide", "2 of 4", 4)).toBe("From Night Bus EP · 2 of 4");
    expect(roomEyebrow("Chaya Pore", "Chaya Pore", null, 1)).toBe("Listening room");
    // A title track on a longer EP still says where it came from.
    expect(roomEyebrow("Night Bus", "Night Bus", "Track 2 of 3", 3)).toBe("From Night Bus · Track 2 of 3");
    expect(roomEyebrow(null, "Chaya Pore", null)).toBe("Listening room");
  });
});

describe("title pieces (D-ROOM-03)", () => {
  it("splits Latin titles into letters, keeping spaces as gaps", () => {
    const atoms = titleAtoms("Chaya Pore");
    expect(atoms.map((a) => a.text).join("")).toBe("Chaya Pore");
    expect(atoms.filter((a) => a.space)).toHaveLength(1);
    expect(atoms[0].delayMs).toBe(0);
    expect(atoms[6].delayMs).toBe(5 * 28);
  });

  it("keeps Bangla words whole so joined letters stay joined", () => {
    expect(titleAtoms("ছায়া পড়ে").map((a) => a.text)).toEqual(["ছায়া", " ", "পড়ে"]);
  });

  it("scatters the same way every time, a little", () => {
    const a = titleAtoms("Night Bus");
    expect(titleAtoms("Night Bus")).toEqual(a);
    for (const atom of a) {
      expect(Math.abs(atom.dx)).toBeLessThanOrEqual(0.12);
      expect(Math.abs(atom.dy)).toBeLessThanOrEqual(0.22);
      expect(Math.abs(atom.turn)).toBeLessThanOrEqual(14);
    }
  });
});

describe("the spinning carousel (owner, 2026-11-22: it spins toward the mouse)", () => {
  it("places cards exactly where the stylesheet does at whole places", () => {
    expect(slotPose(0, true)).toEqual({ tx: 0, tz: 0, ry: 0, s: 1, o: 1, dim: 0 });
    expect(slotPose(1, true)).toEqual({ tx: 0.6, tz: -120, ry: -16, s: 0.84, o: 1, dim: 0.3 });
    expect(slotPose(-1, true)).toEqual({ tx: -0.6, tz: -120, ry: 16, s: 0.84, o: 1, dim: 0.3 });
    expect(slotPose(-2, true)).toEqual({ tx: -1.05, tz: -240, ry: 24, s: 0.7, o: 1, dim: 0.55 });
    expect(slotPose(3, true).o).toBe(0);
    // Narrow rooms never show the second card a side.
    expect(slotPose(2, false).o).toBe(0);
    expect(slotPose(1, false).o).toBe(1);
  });

  it("glides between places and holds beyond the last one", () => {
    const half = slotPose(0.5, true);
    expect(half.tx).toBeCloseTo(0.3);
    expect(half.tz).toBeCloseTo(-60);
    expect(half.ry).toBeCloseTo(-8);
    expect(slotPose(-1.5, false).o).toBeCloseTo(0.5);
    expect(slotPose(9, true)).toEqual(slotPose(3, true));
    expect(slotPose(Number.NaN, true)).toEqual(slotPose(3, true));
  });

  it("spins toward the side the mouse is on, eased, never past SPIN_MAX", () => {
    expect(pointerSpin(500, 500, 300)).toBe(0);
    // Over the middle of the front card it stays still.
    expect(pointerSpin(500 + 0.3 * 300, 500, 300)).toBe(0);
    const near = pointerSpin(500 + 0.6 * 300, 500, 300);
    expect(near).toBeGreaterThan(0);
    expect(near).toBeLessThan(SPIN_MAX);
    expect(pointerSpin(500 + 1.3 * 300, 500, 300)).toBe(SPIN_MAX);
    expect(pointerSpin(5000, 500, 300)).toBe(SPIN_MAX);
    expect(pointerSpin(-5000, 500, 300)).toBe(-SPIN_MAX);
    expect(pointerSpin(500, 500, 0)).toBe(0);
  });

  it("springs to its target smoothly and comes to rest exactly on it", () => {
    let state = { x: 0, v: 0 };
    let peak = 0;
    let frames = 0;
    let rest = false;
    while (!rest && frames < 600) {
      ({ rest, ...state } = springStep(state, 1, 1 / 60));
      peak = Math.max(peak, state.x);
      frames += 1;
    }
    expect(rest).toBe(true);
    expect(state).toEqual({ x: 1, v: 0 });
    // Flows in within about a second, with at most a hair of overshoot.
    expect(frames).toBeLessThan(70);
    expect(peak).toBeLessThan(1.02);
    // A long stalled frame never throws it past the target.
    expect(springStep({ x: 0, v: 0 }, 1, 2).x).toBeLessThan(1);
  });
});
