import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { contrastRatio, hexToRgb } from "./contrast";
import { THEMES, palette, type ThemeName } from "./palette";

/** Reads custom properties per scope straight from tokens.css, so the CSS itself is what is tested. */
function readThemes(): Record<ThemeName, Record<string, string>> {
  const css = readFileSync(path.resolve(__dirname, "../../app/styles/tokens.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const blocks = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  const out = Object.fromEntries(THEMES.map((t) => [t, {}])) as Record<ThemeName, Record<string, string>>;
  for (const [, selector, body] of blocks) {
    const sel = selector.trim();
    const vars = Object.fromEntries(
      [...body.matchAll(/(--cr-[\w-]+)\s*:\s*([^;]+);/g)].map(([, k, v]) => [k, v.trim()]),
    );
    for (const theme of THEMES) {
      const applies =
        sel.includes(`[data-theme="${theme}"]`) ||
        (sel.includes("[data-theme]") && !sel.includes("=")) ||
        (theme === "ember" && /(^|,)\s*:root\s*(,|$)/.test(sel) && !sel.includes("@media"));
      if (applies) Object.assign(out[theme], vars);
    }
  }
  return out;
}

const THEME_VARS = readThemes();
const AA_TEXT = 4.5;
const NON_TEXT = 3;

const TEXT_PAIRS: [string, string][] = [
  ["--cr-fg", "--cr-surface"],
  ["--cr-fg", "--cr-surface-raised"],
  ["--cr-fg", "--cr-surface-sunken"],
  ["--cr-fg-muted", "--cr-surface"],
  ["--cr-fg-muted", "--cr-surface-raised"],
  ["--cr-on-accent", "--cr-accent"],
  ["--cr-on-brand", "--cr-brand"],
  ["--cr-highlight", "--cr-surface"],
  ["--cr-link", "--cr-surface-raised"],
  ["--cr-danger", "--cr-surface-raised"],
  ["--cr-success", "--cr-surface-raised"],
  ["--cr-warning", "--cr-surface-raised"],
  ["--cr-info", "--cr-surface-raised"],
  ["--cr-on-danger-fill", "--cr-danger-fill"],
];

const NON_TEXT_PAIRS: [string, string][] = [
  ["--cr-focus", "--cr-surface"],
  ["--cr-focus", "--cr-surface-raised"],
  ["--cr-accent", "--cr-surface"],
];

describe.each(THEMES)("theme %s", (theme) => {
  const v = THEME_VARS[theme];

  it("defines every semantic role", () => {
    for (const [a, b] of [...TEXT_PAIRS, ...NON_TEXT_PAIRS]) {
      expect(v[a], `${theme} ${a}`).toMatch(/^#/);
      expect(v[b], `${theme} ${b}`).toMatch(/^#/);
    }
  });

  it.each(TEXT_PAIRS)("text %s on %s meets AA", (fg, bg) => {
    expect(contrastRatio(v[fg], v[bg])).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it.each(NON_TEXT_PAIRS)("%s against %s meets 3:1", (fg, bg) => {
    expect(contrastRatio(v[fg], v[bg])).toBeGreaterThanOrEqual(NON_TEXT);
  });
});

/** "rgb(44 187 118 / 0.28)" -> its colour and alpha. */
function rgba(value: string): { hex: string; alpha: number } {
  const m = value.match(/^rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\)$/);
  if (!m) throw new Error(`Not an rgb() colour: ${value}`);
  const hex = `#${[m[1], m[2], m[3]].map((c) => Number(c).toString(16).padStart(2, "0")).join("")}`;
  return { hex, alpha: Number(m[4]) };
}

/** Paints `top` at `alpha` over the opaque `bottom`. */
function over(top: string, alpha: number, bottom: string): string {
  const [t, b] = [hexToRgb(top), hexToRgb(bottom)];
  return `#${t.map((c, i) => Math.round(c * alpha + b[i] * (1 - alpha)).toString(16).padStart(2, "0")).join("")}`;
}

describe("artist studio world (D-THEME-02)", () => {
  const v = THEME_VARS["artist-studio"];

  it("uses the mint logo's colours", () => {
    expect(v["--cr-brand"]).toBe(palette.signalMint.toLowerCase());
    expect(v["--cr-cube-field"]).toBe(palette.signalMint.toLowerCase());
    expect(v["--cr-cube-face"]).toBe(palette.paleMint.toLowerCase());
    expect(v["--cr-cube-shadow"]).toBe(palette.forest.toLowerCase());
  });

  // Text sits in the brightest spot of the corner light: the pool and the bulb over the base.
  it.each(["--cr-fg", "--cr-fg-muted", "--cr-highlight"])("%s stays AA in the lit corner", (fg) => {
    const pool = rgba(v["--cr-light-pool"]);
    const bulb = rgba(v["--cr-light-bulb"]);
    const lit = over(bulb.hex, bulb.alpha, over(pool.hex, pool.alpha, v["--cr-surface"]));
    expect(contrastRatio(v[fg], lit)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it("never puts small text in Forest on Signal Mint", () => {
    expect(contrastRatio(palette.forest, palette.signalMint)).toBeLessThan(AA_TEXT);
    expect(v["--cr-on-brand"]).not.toBe(palette.forest.toLowerCase());
    expect(v["--cr-on-accent"]).not.toBe(palette.forest.toLowerCase());
  });
});

describe("contrast maths", () => {
  it("matches the brand guideline figures", () => {
    expect(contrastRatio("#FCF475", "#B21F24")).toBeCloseTo(5.89, 1);
    expect(contrastRatio("#B21F24", "#140707")).toBeLessThan(AA_TEXT); // never red text on dark
  });
});
