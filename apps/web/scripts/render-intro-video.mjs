#!/usr/bin/env node
/*
 * Renders the Corner Room intro film frame by frame from /theme-kit/intro-video?render=1.
 *
 *   1. Start the web app with the theme kit on:  CR_THEME_KIT=1 npm run dev   (or build + start)
 *   2. node scripts/render-intro-video.mjs [--url http://localhost:3000] [--out ../../var/promo] [--fps 30] [--from 0] [--to 40]
 *
 * Needs Playwright's Chromium (npx playwright install chromium) and ffmpeg on PATH.
 * Every frame is seeked, not recorded, so the result is identical on any machine.
 * Output: corner-room-intro.mp4 (H.264, 1920 x 1080, yuv420p) plus a poster frame.
 */
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { chromium } from "@playwright/test";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const url = args.url ?? "http://localhost:3000";
const outDir = resolve(args.out ?? "../../var/promo");
const fps = Number(args.fps ?? 30);
const from = Number(args.from ?? 0);
const to = Number(args.to ?? 40);
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, reducedMotion: "no-preference" });
await page.goto(`${url}/theme-kit/intro-video?render=1`, { waitUntil: "networkidle" });
await page.waitForFunction(() => Boolean(window.__crIntro));
await page.evaluate(() => document.fonts.ready);

const out = resolve(outDir, "corner-room-intro.mp4");
const ffmpeg = spawn(
  "ffmpeg",
  ["-y", "-f", "image2pipe", "-framerate", String(fps), "-c:v", "png", "-i", "-", "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out],
  { stdio: ["pipe", "inherit", "inherit"] },
);

const frames = Math.round((to - from) * fps);
for (let f = 0; f < frames; f += 1) {
  const t = from + f / fps;
  await page.evaluate((time) => window.__crIntro.seek(time), t);
  const png = await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: 1920, height: 1080 } });
  if (!ffmpeg.stdin.write(png)) await new Promise((r) => ffmpeg.stdin.once("drain", r));
  if (f % fps === 0) process.stdout.write(`\r${t.toFixed(0)} s / ${to} s`);
}
ffmpeg.stdin.end();
await new Promise((r) => ffmpeg.on("close", r));

await page.evaluate((time) => window.__crIntro.seek(time), 38.5);
await page.screenshot({ path: resolve(outDir, "corner-room-intro-poster.png"), clip: { x: 0, y: 0, width: 1920, height: 1080 } });
await browser.close();
console.log(`\nWrote ${out}`);

// Sound: build the original score (scripts/build-intro-soundtrack.mjs) and lay it under the
// picture, normalised to -14 LUFS with -1 dBTP headroom. --silent skips this step.
if (args.silent === undefined && from === 0 && to === 40) {
  const score = resolve(outDir, "corner-room-intro-score.wav");
  const withSound = resolve(outDir, "corner-room-intro-sound.mp4");
  const run = (cmd, argv) =>
    new Promise((ok, fail) => spawn(cmd, argv, { stdio: "inherit" }).on("close", (code) => (code === 0 ? ok() : fail(new Error(`${cmd} exited ${code}`)))));
  await run(process.execPath, [resolve(import.meta.dirname, "build-intro-soundtrack.mjs"), "--out", score]);
  await run("ffmpeg", ["-y", "-loglevel", "error", "-i", out, "-i", score, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-af", "loudnorm=I=-14:TP=-1.0:LRA=9", "-ar", "48000", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", withSound]);
  console.log(`Wrote ${withSound}`);
}
