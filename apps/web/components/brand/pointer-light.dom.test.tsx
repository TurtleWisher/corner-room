// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

import { EASE_MS, PointerLightLayer, easeToward } from "./pointer-light";

afterEach(cleanup);

describe("easeToward", () => {
  it("moves part of the way each frame and never overshoots", () => {
    const one = easeToward(0, 100, 16);
    expect(one).toBeGreaterThan(0);
    expect(one).toBeLessThan(100);
    expect(easeToward(0, 100, 10_000)).toBeCloseTo(100, 5);
    expect(easeToward(50, 50, 16)).toBe(50);
  });

  it("is frame-rate independent: two 8 ms steps equal one 16 ms step", () => {
    const twoSteps = easeToward(easeToward(0, 100, 8), 100, 8);
    expect(twoSteps).toBeCloseTo(easeToward(0, 100, 16), 6);
  });

  it("settles in about a quarter of a second", () => {
    let x = 0;
    for (let t = 0; t < 3 * EASE_MS; t += 16) x = easeToward(x, 100, 16);
    expect(x).toBeGreaterThan(94);
  });
});

describe("PointerLightLayer", () => {
  it("is decorative: hidden from assistive tech, with the grain as a sibling above the light", () => {
    const { container } = render(<PointerLightLayer />);
    const layers = [...container.children] as HTMLElement[];
    expect(layers.map((l) => l.className)).toEqual(["cr-pl cr-pl-clip", "cr-pl cr-pl-grain"]);
    for (const l of layers) expect(l.getAttribute("aria-hidden")).toBe("true");
    expect(layers[0].firstElementChild?.className).toBe("cr-pl-spot");
  });

  it("marks page layers so they are fixed to the viewport", () => {
    const { container } = render(<PointerLightLayer page />);
    for (const l of container.children) expect(l.classList.contains("cr-pl-page")).toBe(true);
  });
});
