import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

/*
 * Accessibility and layout on the real app (AUDIO Phase 9; owner spec section 10: keyboard,
 * screen-reader labels, focus order, contrast, reduced motion, phone and desktop). axe-core checks
 * WCAG 2.1 A/AA rules, contrast included; serious and critical findings fail the test.
 */

// Run from apps/web (as npm scripts and npx do).
const AXE = path.resolve(process.cwd(), "node_modules", "axe-core", "axe.min.js");

type Violation = { id: string; impact: string | null; help: string; nodes: { target: string[] }[] };

async function axe(page: Page): Promise<Violation[]> {
  await page.addScriptTag({ path: AXE });
  return page.evaluate(async () => {
    // @ts-expect-error axe is injected above
    const result = await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] });
    return result.violations.map((v: Violation) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 3).map((n) => ({ target: n.target })) }));
  });
}

function serious(list: Violation[]): string[] {
  return list.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id} (${v.impact}): ${v.help} at ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

async function settle(page: Page) {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.waitForTimeout(500);
}

const PUBLIC = ["/", "/events", "/tracks", "/releases", "/artists", "/store", "/login"];

for (const path of PUBLIC) {
  test(`${path} has no serious accessibility problems and no sideways scroll`, async ({ page }) => {
    await page.goto(path);
    await settle(page);
    expect(serious(await axe(page)), path).toEqual([]);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `${path} scrolls sideways`).toBeLessThanOrEqual(0);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  });
}

test("a release page is accessible", async ({ page }) => {
  await page.goto("/releases");
  await settle(page);
  const first = page.locator('a[href^="/releases/"]').first();
  test.skip((await first.count()) === 0, "no releases on this stack");
  await first.click();
  await settle(page);
  expect(serious(await axe(page))).toEqual([]);
});

test("the first Tab reaches Skip to content, which moves focus to the page", async ({ page, isMobile }) => {
  test.skip(isMobile, "keyboard check runs on desktop");
  await page.goto("/tracks");
  await settle(page);
  await page.keyboard.press("Tab");
  await expect(page.locator(":focus")).toHaveText(/skip to content/i);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main$/);
});

test("with reduced motion, nothing keeps animating", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const path of ["/", "/tracks"]) {
    await page.goto(path);
    await settle(page);
    const looping = await page.evaluate(() =>
      document
        .getAnimations()
        .filter((a) => a.playState === "running" && a.effect?.getComputedTiming().iterations === Infinity)
        .map((a) => (a.effect as KeyframeEffect | null)?.target?.className?.toString() ?? "?"),
    );
    expect(looping, `${path} loops animations under reduced motion`).toEqual([]);
  }
});

test.describe("signed in", () => {
  const email = process.env.E2E_FAN_EMAIL;
  const password = process.env.E2E_FAN_PASSWORD;
  test.skip(!email || !password, "set E2E_FAN_EMAIL and E2E_FAN_PASSWORD for a listener on this stack");

  async function signIn(page: Page) {
    await page.goto("/login?next=%2Ftracks");
    await page.getByLabel("Email").fill(email!);
    await page.getByLabel("Password").fill(password!);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/tracks/);
    await settle(page);
  }

  test("the player works from the keyboard and every control is named", async ({ page, isMobile }) => {
    await signIn(page);
    const play = page.getByRole("button", { name: /^Play / }).first();
    await play.focus();
    await page.keyboard.press("Enter");
    const player = page.getByRole("region", { name: "Player" });
    await expect(player).toBeVisible();
    await expect(player.getByRole("button", { name: /^Pause / })).toBeVisible({ timeout: 15_000 });
    if (!isMobile) {
      const shuffle = player.getByRole("button", { name: /^Shuffle:/ });
      await shuffle.focus();
      await page.keyboard.press("Space");
      await expect(player.getByRole("button", { name: "Shuffle: on" })).toHaveAttribute("aria-pressed", "true");
      await page.keyboard.press("Space");
      await expect(player.getByRole("button", { name: "Shuffle: off" })).toBeVisible();
    }
    expect(serious(await axe(page))).toEqual([]);
    // Leave the player paused for whoever uses this account next.
    await player.getByRole("button", { name: /^Pause / }).click();
  });

  test("the listening room is accessible and its controls say their state", async ({ page }) => {
    await signIn(page);
    await page.getByRole("button", { name: /^Play / }).first().click();
    const open = page.getByRole("link", { name: /Open the listening room/ });
    await expect(open).toBeVisible({ timeout: 15_000 });
    await open.click();
    await settle(page);
    await expect(page.getByRole("button", { name: /^Normalise volume:/ })).toHaveAttribute("aria-pressed", /true|false/);
    await expect(page.getByRole("button", { name: /^Repeat:/ }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /to your library|in your library/ }).first()).toBeVisible();
    expect(serious(await axe(page))).toEqual([]);
    const pause = page.getByRole("button", { name: /^Pause / }).first();
    if (await pause.isVisible()) await pause.click();
  });
});
