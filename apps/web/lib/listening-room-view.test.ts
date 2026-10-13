import { describe, expect, it } from "vitest";

import {
  carouselWindow,
  edgeZone,
  isVisibleOffset,
  leaveTarget,
  nowPlayingAnnouncement,
  queuePositionLabel,
  swipeDirection,
} from "./listening-room-view";

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
