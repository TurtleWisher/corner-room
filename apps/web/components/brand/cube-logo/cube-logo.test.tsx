import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CubeLogo } from "./cube-logo";
import { buildCube, cubeFaces, FRONT, layoutLine } from "./geometry";
import { canDrawWord, glyph, normalizeWord, SUPPORTED_GLYPHS } from "./glyphs";

const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const fills = (svg: string) => new Set([...svg.matchAll(/fill:\s*([^;"]+)/g)].map((m) => m[1].trim()));

/** x extents of a path's coordinates. */
function xExtent(d: string) {
  const xs = [...d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => Number(m[1]));
  return [Math.min(...xs), Math.max(...xs)];
}

describe("acceptance checklist (master prompt section 8)", () => {
  const svg = html(<CubeLogo />);

  it("1. no <text> and no rect except the full-canvas background", () => {
    expect(svg).not.toContain("<text");
    const rects = [...svg.matchAll(/<rect[^>]*>/g)].map((m) => m[0]);
    expect(rects).toHaveLength(1);
    expect(rects[0]).toContain('width="1920" height="1920"');
    expect(html(<CubeLogo framed={false} />)).not.toContain("<rect");
  });

  it("2. only three fill colours", () => {
    expect(fills(svg).size).toBe(3);
    expect(fills(html(<CubeLogo theme="fire" />)).size).toBe(3);
  });

  it("3. both front lines span exactly the front width", () => {
    const geo = buildCube({ front: ["CORNER", "ROOM"], left: "CORNER", top: "ROOM" });
    expect(xExtent(geo.front[0].d)).toEqual([FRONT.x0, FRONT.x1]);
    expect(xExtent(geo.front[1].d)).toEqual([FRONT.x0, FRONT.x1]);
  });

  it("4. line 2 is 1.33x line 1, with a 13 unit gap", () => {
    expect(FRONT.line2.h / FRONT.line1.h).toBeCloseTo(1.33, 2);
    expect(FRONT.line2.y - (FRONT.line1.y + FRONT.line1.h)).toBe(13);
  });

  it("7. LOW / TIDE with SESSIONS uses the same construction", () => {
    expect(cubeFaces("Low Tide", "Sessions")).toEqual({ front: ["LOW", "TIDE"], left: "SESSIONS", top: "SESSIONS" });
    const out = html(<CubeLogo front={["LOW", "TIDE"]} left="SESSIONS" top="SESSIONS" />);
    expect(out.match(/<path /g)).toHaveLength(4);
    expect(out).toContain("matrix(0 -1 1 0.5237");
  });

  it("8. ice and fire share identical geometry", () => {
    const strip = (s: string) => s.replace(/style="[^"]*"/g, "").replace(/data-cr-theme="\w+"/, "");
    expect(strip(html(<CubeLogo theme="ice" />))).toEqual(strip(html(<CubeLogo theme="fire" />)));
  });
});

describe("faces from real data", () => {
  it("reproduces the logo from its own name", () => {
    expect(cubeFaces("Corner Room")).toEqual({ front: ["CORNER", "ROOM"], left: "CORNER", top: "ROOM" });
  });
  it("keeps reading order and never invents words", () => {
    const f = cubeFaces("Night Bus", "Kaal Bela");
    expect(f).toEqual({ front: ["NIGHT", "BUS"], left: "KAAL", top: "BELA" });
  });
  it("moves a word too long for the front onto the lid", () => {
    const f = cubeFaces("Monsoon Frequencies", "Chattogram");
    expect(f.front[0]).toBe("MONSOON");
    expect(f.top).toBe("FREQUENCIES");
    expect(f.left).toBe("CHATTOGRAM");
  });
  it("keeps the front face to the title, even when a short secondary word would fit", () => {
    expect(cubeFaces("Monsoon Frequencies", "Dhaka")).toEqual({
      front: ["MONSOON", "MONSOON"],
      left: "DHAKA",
      top: "FREQUENCIES",
    });
    expect(cubeFaces("Monsoon Frequencies", "Rumi").front).toEqual(["MONSOON", "MONSOON"]);
  });
  it("normalises accents and curly punctuation", () => {
    expect(normalizeWord("Café’s – mix")).toBe("CAFE'S - MIX");
  });
});

describe("glyph library", () => {
  const m = { w: 100, h: 300, s: 38, t: 40, m: 27, mid: 170 };
  it.each(SUPPORTED_GLYPHS)("%s stays inside its box", (ch) => {
    const shape = glyph(ch, m)!;
    expect(shape.outer.length).toBeGreaterThanOrEqual(3);
    for (const [x, y] of [...shape.outer, ...shape.holes.flat()]) {
      expect(x).toBeGreaterThanOrEqual(-0.001);
      expect(x).toBeLessThanOrEqual(m.w + 0.001);
      // The comma's tail may drop just below the baseline.
      expect(y).toBeGreaterThanOrEqual(-0.001);
      expect(y).toBeLessThanOrEqual(ch === "," ? m.h + m.t : m.h + 0.001);
    }
  });
  it("covers A to Z and 0 to 9", () => {
    for (const c of "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789") expect(canDrawWord(c)).toBe(true);
    expect(canDrawWord("শহর")).toBe(false);
  });
  it("flags words too long to read instead of silently squeezing", () => {
    const geo = buildCube({ front: ["FREQUENCIESFREQ", "ROOM"], left: "CORNER", top: "ROOM" });
    expect(geo.warnings.join(" ")).toContain("too long");
    expect(layoutLine("CORNER", 0, 0, 709, 293, FRONT).aspect).toBeGreaterThan(0.3);
  });
});
