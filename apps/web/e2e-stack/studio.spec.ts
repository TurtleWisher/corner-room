import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { crc32, deflateSync } from "node:zlib";

import { expect, request, test, type Page } from "@playwright/test";

/*
 * AUDIO Phase 4 exit, checked in the browser: an approved artist makes a single and an album in
 * Studio, uploads real masters and a cover, proposes a price and submits, entirely through the UI.
 * Runs only against the private staging copy (scripts/staging.ps1), never development:
 *   E2E_BASE_URL=http://localhost:3010 E2E_API_URL=http://localhost:8010
 *   E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD = staging's bootstrap admin (from var/staging/staging.env)
 */

const API = process.env.E2E_API_URL;
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD;

test.skip(!API || !ADMIN_EMAIL || !ADMIN_PASSWORD, "Studio walkthrough runs against staging only (set E2E_API_URL and the staging admin)");
test.describe.configure({ mode: "serial" });

const run = Math.random().toString(16).slice(2, 10);
const password = `Studio-${run}-pass`;
const files = mkdtempSync(path.join(tmpdir(), "cr-studio-"));

/** A short original tone sequence as 24-bit / 48 kHz stereo WAV (nothing to license). */
function wav(seconds: number, base: number): string {
  const rate = 48000;
  const frames = Math.floor(seconds * rate);
  const data = Buffer.alloc(frames * 6);
  for (let n = 0; n < frames; n++) {
    const t = n / rate;
    const f = base * (1 + Math.floor(t * 2) % 4 * 0.125);
    const env = Math.min(1, t * 4, (seconds - t) * 4);
    const v = Math.round(env * 0.4 * Math.sin(2 * Math.PI * f * t) * 8388607);
    data.writeIntLE(v, n * 6, 3);
    data.writeIntLE(Math.round(v * 0.9), n * 6 + 3, 3);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(2, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 6, 28);
  header.writeUInt16LE(6, 32);
  header.writeUInt16LE(24, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  const file = path.join(files, `master-${base}.wav`);
  writeFileSync(file, Buffer.concat([header, data]));
  return file;
}

/** A plain 1600 x 1600 PNG cover. */
function png(): string {
  const size = 1600;
  const chunk = (type: string, body: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(body.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type), body])) >>> 0);
    return Buffer.concat([len, Buffer.from(type), body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.writeUInt8(8, 8);
  ihdr.writeUInt8(2, 9);
  const row = Buffer.alloc(1 + size * 3);
  for (let x = 0; x < size; x++) row.set([30 + (x % 120), 50, 140], 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  const file = path.join(files, "cover.png");
  writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
  return file;
}

let artistEmail = "";

test.beforeAll(async () => {
  const api = await request.newContext({ baseURL: API });
  const json = async (res: Awaited<ReturnType<typeof api.post>>) => {
    if (!res.ok()) throw new Error(`${res.url()} -> ${res.status()}: ${await res.text()}`);
    return res.json();
  };
  const admin = (await json(await api.post("/api/v1/auth/login", { data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } }))).access_token;
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const orgs = (await json(await api.get("/api/v1/organizations", { headers: auth(admin) }))).items;
  const label = orgs.find((o: { type: string }) => o.type === "LABEL").id;
  const staff = (await json(await api.post(`/api/v1/organizations/${label}/switch`, { headers: auth(admin) }))).access_token;
  artistEmail = `studio-artist-${run}@example.com`;
  const user = (await json(await api.post("/api/v1/auth/register", { data: { email: artistEmail, password, display_name: "Studio Artist" } }))).user;
  await json(await api.post(`/api/v1/users/${user.id}/lifecycle`, { headers: auth(admin), data: { action: "activate" } }));
  const me = (await json(await api.post("/api/v1/auth/login", { data: { email: artistEmail, password } }))).access_token;
  const application = await json(await api.post("/api/v1/artist-applications", { headers: auth(me), data: { stage_name: `Studio Act ${run}` } }));
  for (const action of ["start_review", "approve"]) {
    await json(await api.post(`/api/v1/artist-applications/${application.id}/lifecycle`, { headers: auth(staff), data: { action } }));
  }
  await json(await api.post(`/api/v1/artists/${application.artist_id}/lifecycle`, { headers: auth(staff), data: { action: "activate" } }));
  await api.dispose();
});

async function signIn(page: Page) {
  await page.goto("/login?next=%2Fstudio");
  await page.getByLabel("Email").fill(artistEmail);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/studio$/);
}

async function startRelease(page: Page, type: "Single" | "Album", title: string) {
  await page.getByRole("link", { name: "New release" }).first().click();
  await page.getByRole("radio", { name: new RegExp(`^${type}`) }).check();
  await page.getByLabel("Release title").fill(title);
  await page.getByRole("button", { name: "Start the draft" }).click();
  await page.waitForURL(/\/studio\/releases\/[0-9a-f-]+$/);
}

async function details(page: Page) {
  await page.getByLabel("Language", { exact: true }).selectOption("bn");
  await page.getByLabel("Main genre").selectOption("adhunik");
  await page.getByLabel("℗ line").fill("℗ 2026 Studio Act");
  await page.getByLabel("© line").fill("© 2026 Studio Act");
  await page.getByRole("button", { name: "Save details" }).click();
  await expect(page.getByRole("button", { name: "Save details" })).toBeEnabled();
}

async function addSongWithMaster(page: Page, title: string, master: string) {
  await page.getByLabel("New song title").fill(title);
  await page.getByRole("button", { name: "Add song" }).click();
  const song = page.getByRole("listitem").filter({ hasText: title }).first();
  await song.getByRole("button", { name: "Upload the master" }).click();
  await song.getByRole("region", { name: "Upload master" }).locator('input[type="file"]').setInputFiles(master);
}

async function propose(page: Page, label: RegExp, amount: string) {
  const row = page.locator("div").filter({ has: page.getByText(label) }).filter({ has: page.getByRole("button", { name: "Propose" }) }).last();
  await row.getByLabel("Price (৳)").fill(amount);
  await row.getByRole("button", { name: "Propose" }).click();
  await expect(row.getByText(/You proposed/)).toBeVisible();
}

/** The worker checks masters and the cover in the background; reload until nothing is missing. */
async function waitUntilReady(page: Page) {
  await expect(async () => {
    await page.reload();
    await expect(page.getByText(/items? (is|are) still missing/)).toHaveCount(0, { timeout: 3_000 });
    await expect(page.getByRole("button", { name: "Submit for review" })).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 180_000, intervals: [5_000] });
}

async function submit(page: Page) {
  await page.getByRole("checkbox", { name: /I confirm I own or have permission/ }).check();
  await page.getByRole("button", { name: "Submit for review" }).click();
  await expect(page.getByRole("button", { name: "Withdraw from review" })).toBeVisible({ timeout: 15_000 });
}

test("an artist makes and submits a single in the browser", async ({ page }) => {
  test.setTimeout(300_000);
  await signIn(page);
  await startRelease(page, "Single", `Studio Single ${run}`);
  await details(page);
  await page.getByRole("region", { name: "Upload cover art" }).locator('input[type="file"]').setInputFiles(png());
  await addSongWithMaster(page, `Studio Song ${run}`, wav(4, 330));
  await propose(page, /^The whole single$/, "40");
  await waitUntilReady(page);
  await submit(page);
});

test("an artist makes and submits an album in the browser", async ({ page }) => {
  test.setTimeout(420_000);
  await signIn(page);
  await startRelease(page, "Album", `Studio Album ${run}`);
  await details(page);
  await page.getByRole("region", { name: "Upload cover art" }).locator('input[type="file"]').setInputFiles(png());
  await addSongWithMaster(page, `Album Opener ${run}`, wav(4, 262));
  await addSongWithMaster(page, `Album Closer ${run}`, wav(4, 392));
  await propose(page, /^The whole album$/, "120");
  await waitUntilReady(page);
  await submit(page);
});
