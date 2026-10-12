import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { contrastRatio } from "./contrast";
import { THEMES, type ThemeName } from "./palette";

/** Reads custom properties per scope straight from tokens.css, so the CSS itself is what is tested. */
function readThemes(): Record<ThemeName, Record<string, string>> {
  const css = readFileSync(path.resolve(__dirname, "../../app/styles/tokens.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const blocks = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  const out = { ember: {}, sky: {}, staff: {}, paper: {} } as Record<ThemeName, Record<string, string>>;
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

describe("contrast maths", () => {
  it("matches the brand guideline figures", () => {
    expect(contrastRatio("#FCF475", "#B21F24")).toBeCloseTo(5.89, 1);
    expect(contrastRatio("#B21F24", "#140707")).toBeLessThan(AA_TEXT); // never red text on dark
  });
});
