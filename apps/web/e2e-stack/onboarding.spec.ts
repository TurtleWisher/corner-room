import { expect, request, test, type Browser, type Page } from "@playwright/test";

/*
 * Joining Corner Room through the dedicated pages (owner, 2026-10-17), in the browser, on the
 * private staging copy (never development):
 *   1. The owner invites a Label Manager from the workspace page and copies the /staff/join link.
 *   2. The invitee opens it, creates an account there, signs in on /staff/sign-in and accepts.
 *   3. The owner makes an artist join link on the Artist applications page.
 *   4. An artist opens /studio/join, creates an account there, signs in on /studio/sign-in, applies.
 *   5. The new staff member reviews, approves and activates the artist.
 *   6. The artist signs in on the artist page and lands in Studio; fans see no artist places.
 * Staging has no email provider (OD-08) and no dev "Verify now" shortcut, so new accounts are
 * activated by the admin through the API, as an operator would until email is set up.
 *   E2E_BASE_URL=http://localhost:3010 E2E_API_URL=http://localhost:8010 E2E_ADMIN_EMAIL/PASSWORD
 */

const API = process.env.E2E_API_URL;
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD;

test.skip(!API || !ADMIN_EMAIL || !ADMIN_PASSWORD, "Onboarding walkthrough runs against staging only");
test.describe.configure({ mode: "serial" });

const run = Math.random().toString(16).slice(2, 8);
const password = `Join-${run}-pass!`;
const staffEmail = `staff-${run}@example.com`;
const artistEmail = `artist-${run}@example.com`;
const fanEmail = `fan-${run}@example.com`;
const stageName = `Joiner ${run}`;
let inviteUrl = "";
let joinUrl = "";

async function activate(email: string) {
  const api = await request.newContext({ baseURL: API });
  const admin = (await (await api.post("/api/v1/auth/login", { data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } })).json()).access_token;
  const users = await (await api.get(`/api/v1/users?q=${encodeURIComponent(email)}`, { headers: { Authorization: `Bearer ${admin}` } })).json();
  const user = (users.items ?? users).find((u: { email: string }) => u.email === email);
  if (!user) throw new Error(`no user ${email}`);
  const res = await api.post(`/api/v1/users/${user.id}/lifecycle`, { headers: { Authorization: `Bearer ${admin}` }, data: { action: "activate" } });
  if (!res.ok()) throw new Error(`activate ${email}: ${res.status()} ${await res.text()}`);
  await api.dispose();
}

async function signIn(page: Page, email: string, pass: string) {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(pass);
  await page.getByRole("button", { name: "Sign in" }).click();
}

async function signUp(page: Page, name: string, email: string) {
  await page.getByLabel("Your name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText(/Account created|Check your email/)).toBeVisible();
}

async function fresh(browser: Browser) {
  return (await browser.newContext()).newPage();
}

function pathOf(url: string): string {
  const u = new URL(url);
  return u.pathname + u.search;
}

async function menuLinks(page: Page): Promise<string[]> {
  await page.getByRole("button", { name: /Open menu for/ }).click();
  const hrefs = await page.getByRole("dialog").getByRole("link").evaluateAll((els) => els.map((e) => e.getAttribute("href") ?? ""));
  await page.keyboard.press("Escape");
  return hrefs;
}

test("the owner signs in on the staff page and invites a Label Manager", async ({ page }) => {
  await page.goto("/staff/sign-in?next=%2Forganizations");
  await expect(page.getByRole("heading", { name: "Staff sign-in" })).toBeVisible();
  await expect(page.getByRole("main").getByRole("link", { name: /Create an account/ })).toHaveCount(0);
  await signIn(page, ADMIN_EMAIL!, ADMIN_PASSWORD!);
  await page.waitForURL(/\/organizations$/);
  await page.getByRole("listitem").filter({ hasText: "Corner Room Label" }).getByRole("link", { name: "Open" }).click();
  await page.waitForURL(/\/organizations\/[0-9a-f-]+$/);
  await page.getByLabel("Their email").fill(staffEmail);
  await page.getByLabel("Role").selectOption({ label: "Label Manager" });
  await page.getByRole("button", { name: "Invite" }).click();
  const link = page.getByLabel("Invitation link");
  await expect(link).toHaveValue(/\/staff\/join\?invite=/);
  inviteUrl = await link.inputValue();
});

test("the invitee joins from the staff join page", async ({ browser }) => {
  const page = await fresh(browser);
  await page.goto(pathOf(inviteUrl));
  await expect(page.getByRole("heading", { name: "Join Corner Room Label" })).toBeVisible();
  await expect(page.getByText(/invited as Label Manager/)).toBeVisible();
  await signUp(page, "New Staff", staffEmail);
  await activate(staffEmail);
  await page.getByRole("link", { name: "Go to sign in" }).click();
  await page.waitForURL(/\/staff\/sign-in\?next=/);
  await signIn(page, staffEmail, password);
  await page.waitForURL(/\/staff\/join\?invite=/);
  await page.getByRole("button", { name: "Accept and join" }).click();
  await expect(page.getByRole("heading", { name: "Welcome to Corner Room Label" })).toBeVisible({ timeout: 20_000 });
  await page.context().close();
});

test("the owner makes an artist join link", async ({ browser }) => {
  const page = await fresh(browser);
  await page.goto("/staff/sign-in?next=%2Fstaff%2Fcatalog%2Fartists");
  await signIn(page, ADMIN_EMAIL!, ADMIN_PASSWORD!);
  await page.waitForURL(/\/staff\/catalog\/artists/);
  await page.getByRole("main").getByRole("button", { name: "Corner Room Label" }).click();
  await page.getByLabel("Name (only staff see it)").fill(`Pilot ${run}`);
  await page.getByRole("button", { name: "Make a join link" }).click();
  const item = page.getByRole("listitem").filter({ hasText: `Pilot ${run}` });
  await expect(item).toContainText("Active");
  joinUrl = await item.getByLabel("Join link").inputValue();
  expect(joinUrl).toMatch(/\/studio\/join\?code=/);
  await page.context().close();
});

test("an artist joins from the label's link and applies", async ({ browser }) => {
  const page = await fresh(browser);
  await page.goto(pathOf(joinUrl));
  await expect(page.getByRole("heading", { name: "Join Corner Room Label as an artist" })).toBeVisible();
  await signUp(page, "New Artist", artistEmail);
  await activate(artistEmail);
  await page.getByRole("link", { name: "Go to sign in" }).click();
  await page.waitForURL(/\/studio\/sign-in\?next=/);
  await expect(page.getByRole("heading", { name: "Artist sign-in" })).toBeVisible();
  await signIn(page, artistEmail, password);
  await page.waitForURL(/\/studio\/join\?code=/);
  await page.getByLabel("Stage name").fill(stageName);
  await page.getByLabel("About you").fill("Rooftop pop from Mirpur.");
  await page.getByRole("button", { name: "Send application" }).click();
  await expect(page.getByRole("status")).toContainText("Sent");
  await expect(page.getByRole("status")).toContainText("Corner Room Label team");
  await page.context().close();
});

test("the new staff member approves and activates the artist", async ({ browser }) => {
  const page = await fresh(browser);
  await page.goto("/staff/sign-in?next=%2Fstaff%2Fcatalog%2Fartists");
  await signIn(page, staffEmail, password);
  await page.waitForURL(/\/staff\/catalog\/artists/);
  await page.getByRole("main").getByRole("button", { name: "Corner Room Label" }).click();
  const card = () => page.getByRole("listitem").filter({ hasText: stageName });
  await expect(card()).toContainText("Rooftop pop from Mirpur.");
  await card().getByRole("button", { name: "Start review" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Review started" })).toBeVisible();
  await card().getByRole("button", { name: "Approve" }).click();
  await expect(page.getByRole("status").filter({ hasText: "is approved into Corner Room Label" })).toBeVisible();
  await card().getByRole("button", { name: "Activate the artist" }).click();
  await expect(page.getByRole("status").filter({ hasText: "can publish from Studio" })).toBeVisible();
  await page.context().close();
});

test("the artist signs in on the artist page and lands in Studio", async ({ browser }) => {
  const page = await fresh(browser);
  await page.goto("/studio/sign-in");
  await signIn(page, artistEmail, password);
  await page.waitForURL(/\/studio$/);
  await expect(page.getByText(stageName).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "New release" }).first()).toBeVisible();
  const links = await menuLinks(page);
  expect(links).toContain("/studio");
  expect(links).not.toContain("/artists/apply");
  await page.context().close();
});

test("a fan sees no artist or staff places, only how to apply", async ({ browser }) => {
  const page = await fresh(browser);
  await page.goto("/register");
  await signUp(page, "Plain Fan", fanEmail);
  await activate(fanEmail);
  await page.goto("/login");
  await signIn(page, fanEmail, password);
  await page.waitForURL(/\/account/);
  const links = await menuLinks(page);
  expect(links).toContain("/artists/apply");
  for (const hidden of ["/studio", "/royalties", "/organizations"]) expect(links).not.toContain(hidden);
  await page.goto("/artists");
  await expect(page.getByText("Are you an artist? Apply")).toHaveCount(0);
  await page.context().close();
});
