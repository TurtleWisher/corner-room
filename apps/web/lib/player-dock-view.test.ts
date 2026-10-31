import { describe, expect, it } from "vitest";

import { DOCK_REVEAL_PX, dockStaysUp, movedEnough } from "./player-dock-view";

describe("player bar while browsing (D-MOTION-03)", () => {
  it("tucks away on activity anywhere on the page", () => {
    expect(dockStaysUp({ viewportHeight: 900, engaged: false })).toBe(false);
    expect(dockStaysUp({ pointerY: 300, viewportHeight: 900, engaged: false })).toBe(false);
  });

  it("stays up when the pointer comes near the bottom edge, or the bar is in use", () => {
    expect(dockStaysUp({ pointerY: 900 - DOCK_REVEAL_PX, viewportHeight: 900, engaged: false })).toBe(true);
    expect(dockStaysUp({ pointerY: 895, viewportHeight: 900, engaged: false })).toBe(true);
    expect(dockStaysUp({ pointerY: 100, viewportHeight: 900, engaged: true })).toBe(true);
  });

  it("ignores a pointer tremor and the first sighting", () => {
    expect(movedEnough(null, { x: 10, y: 10 })).toBe(false);
    expect(movedEnough({ x: 10, y: 10 }, { x: 11, y: 11 })).toBe(false);
    expect(movedEnough({ x: 10, y: 10 }, { x: 14, y: 10 })).toBe(true);
  });
});
