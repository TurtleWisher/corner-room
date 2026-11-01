import { describe, expect, it } from "vitest";

import { DOCK_END_PX, DOCK_REVEAL_PX, atPageEdge, dockLook, dockTravel, pointerWantsDock, settleDock, stepDock } from "./player-dock-view";

describe("player bar follows the scroll (D-MOTION-04)", () => {
  const travel = 100;
  const step = (offset: number, delta: number, extra: Partial<Parameters<typeof stepDock>[0]> = {}) =>
    stepDock({ offset, delta, travel, atEdge: false, engaged: false, ...extra });

  it("goes away in step with reading down, and comes back in step with scrolling up", () => {
    expect(step(0, 30)).toBe(30);
    expect(step(30, 30)).toBe(60);
    expect(step(60, -45)).toBe(15);
  });

  it("never goes past fully shown or fully hidden", () => {
    expect(step(90, 400)).toBe(travel);
    expect(step(10, -400)).toBe(0);
  });

  it("shows at the top or end of the page, and whenever the bar is in use", () => {
    expect(step(80, 20, { atEdge: true })).toBe(0);
    expect(step(80, 20, { engaged: true })).toBe(0);
  });

  it("settles to whichever end is nearer once the scroll stops", () => {
    expect(settleDock(49, travel)).toBe(0);
    expect(settleDock(50, travel)).toBe(travel);
    expect(settleDock(0, 0)).toBe(0);
  });

  it("fades over about the bar's own height", () => {
    expect(dockTravel(80)).toBe(100);
  });

  it("knows the top, the end and a page too short to scroll", () => {
    expect(atPageEdge(0, 600, 3000)).toBe(true);
    expect(atPageEdge(1200, 600, 3000)).toBe(false);
    expect(atPageEdge(3000 - 600 - DOCK_END_PX, 600, 3000)).toBe(true);
    expect(atPageEdge(0, 600, 500)).toBe(true);
  });

  it("slides and fades together, and only fades under reduced motion", () => {
    expect(dockLook(0, travel, 88, false)).toEqual({ y: 0, opacity: 1, hidden: false });
    expect(dockLook(50, travel, 88, false)).toEqual({ y: 44, opacity: 0.5, hidden: false });
    expect(dockLook(100, travel, 88, false)).toEqual({ y: 88, opacity: 0, hidden: true });
    expect(dockLook(50, travel, 88, true)).toEqual({ y: 0, opacity: 0.5, hidden: false });
  });

  it("comes back when a mouse nears the bottom edge", () => {
    expect(pointerWantsDock(900 - DOCK_REVEAL_PX, 900)).toBe(true);
    expect(pointerWantsDock(300, 900)).toBe(false);
  });
});
