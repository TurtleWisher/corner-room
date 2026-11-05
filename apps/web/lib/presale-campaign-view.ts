/*
 * Pre-sale campaigns in Studio (owner, 2026-11-06, D-PRESALE-04): words, tabs and small view
 * helpers for the campaign pages and the release numbers. The API counts, sums and decides; these
 * only choose words and shapes for what it returned. Unknown is "Not available", never 0.
 */

import type { CampaignNumbers, CampaignState, CampaignView, PresalePlace } from "@/features/presales/api";
import type { StudioPresaleStage } from "@/lib/presale-view";

/** How often the open campaign page asks for fresh numbers. */
export const LIVE_REFRESH_MS = 15_000;

export const PRESALES_HOME = "/studio/releases/presales";

export function campaignHref(id: string): string {
  return `${PRESALES_HOME}/${id}`;
}

export function releaseNumbersHref(id: string): string {
  return `/studio/releases/${id}/numbers`;
}

/** The campaign's own pages (URLs approved by the owner, 2026-11-06). */
export function campaignTabs(id: string): { href: string; label: string }[] {
  const base = campaignHref(id);
  return [
    { href: base, label: "Live numbers" },
    { href: `${base}/setup`, label: "Setup" },
    { href: `${base}/page`, label: "Fans' page" },
    { href: `${base}/share`, label: "Share" },
  ];
}

export type StateTone = "live" | "waiting" | "neutral" | "attention" | "done";

const STATES: Record<CampaignState, { label: string; tone: StateTone; hint: string }> = {
  DRAFT: { label: "Draft", tone: "neutral", hint: "Set the price and date, then send it to Corner Room." },
  IN_REVIEW: { label: "With Corner Room", tone: "waiting", hint: "Staff are checking the title, date and price." },
  RETURNED: { label: "Sent back", tone: "attention", hint: "Read the note, change what's needed and send it again." },
  APPROVED: { label: "Approved", tone: "waiting", hint: "Goes live once the pre-sale price is agreed." },
  LIVE: { label: "Live", tone: "live", hint: "Fans can pre-book now." },
  WAITING: { label: "Date passed", tone: "attention", hint: "Pre-orders are closed until the music is finished and out." },
  RELEASED: { label: "Released", tone: "done", hint: "The campaign moved to the release. Its pre-sale numbers stay here." },
  ENDED: { label: "Ended", tone: "neutral", hint: "This pre-sale closed before release." },
};

export function campaignStateLabel(state: string): { label: string; tone: StateTone; hint: string } {
  return STATES[state as CampaignState] ?? { label: state, tone: "neutral", hint: "" };
}

/** The campaign word for a release's pre-sale stage as the release detail reports it (the list
 * endpoint gives the same word directly). */
export function presaleStageState(stage: StudioPresaleStage, releaseStatus: string): CampaignState {
  if (releaseStatus === "RELEASED") return "RELEASED";
  switch (stage) {
    case "live":
      return "LIVE";
    case "closed":
      return "WAITING";
    case "waiting":
      return "IN_REVIEW";
    case "returned":
      return "RETURNED";
    case "approved_waiting_price":
    case "scheduled":
      return "APPROVED";
    default:
      return "DRAFT";
  }
}

/** "1.5%" from basis points; null when the API said it isn't available. */
export function percentFromBps(bps: number | null | undefined): string | null {
  if (bps === null || bps === undefined || !Number.isFinite(bps)) return null;
  const pct = bps / 100;
  const text = pct >= 10 || Number.isInteger(pct) ? pct.toFixed(0) : pct.toFixed(1);
  return `${text}%`;
}

const PLACES: Record<PresalePlace, string> = {
  PAGE: "Release page",
  STORE: "Store",
  HOME: "Home page",
  RELEASES: "Releases",
  PROFILE: "Artist profile",
};

export function placeLabel(place: string): string {
  return PLACES[place as PresalePlace] ?? "Somewhere else";
}

/** A referring site's name, or what a visit without one means. */
export function siteLabel(host: string | null | undefined): string {
  return host ? host : "No site named (typed in, saved or from an app)";
}

const MILESTONES: Record<string, string> = {
  request_presale: "Sent for review",
  approve_presale: "Approved by Corner Room",
  return_presale: "Sent back with a note",
  move_presale_date: "Release date moved",
  schedule: "Release scheduled",
  release: "Released",
  cancel_presale: "Pre-sale cancelled",
  cover_revealed: "Cover shown to fans",
  first_preorder: "First pre-order",
};

export function milestoneLabel(kind: string): string {
  return MILESTONES[kind] ?? kind;
}

export type NumbersViewKey = "presale" | "since" | "all";

/** Which views a release has: the pre-sale on its own if it had one, since release once it is out,
 * and both together once both exist. The default is the widest one available. */
export function numbersViews(n: Pick<CampaignNumbers, "had_presale" | "since_release">): { key: NumbersViewKey; label: string }[] {
  const out: { key: NumbersViewKey; label: string }[] = [];
  if (n.had_presale) out.push({ key: "presale", label: "Pre-sale only" });
  if (n.since_release) out.push({ key: "since", label: "Since release" });
  if (n.had_presale && n.since_release) out.push({ key: "all", label: "All together" });
  if (out.length === 0) out.push({ key: "all", label: "All" });
  return out;
}

export function defaultNumbersView(n: Pick<CampaignNumbers, "had_presale" | "since_release">): NumbersViewKey {
  const views = numbersViews(n);
  return views[views.length - 1].key;
}

export function pickView(n: CampaignNumbers, key: NumbersViewKey): CampaignView {
  if (key === "presale") return n.presale;
  if (key === "since") return n.since_release ?? n.all;
  return n.all;
}

/** The words a view uses: before release it's pre-orders and Pre-book, after it's orders and Buy. */
export function viewWords(key: NumbersViewKey): { orders: string; presses: string } {
  if (key === "presale") return { orders: "Pre-orders", presses: "Pre-book presses" };
  if (key === "since") return { orders: "Orders since release", presses: "Buy presses" };
  return { orders: "Orders, all together", presses: "Pre-book and Buy presses" };
}

/** A day-by-day row for the timeline: every day from the first to the last, gaps as zero days. */
export function fillDays(
  timeline: CampaignView["timeline"],
): { day: string; views: number; prebook_clicks: number; orders: number }[] {
  if (timeline.length === 0) return [];
  const byDay = new Map(timeline.map((d) => [d.day, d]));
  const out: { day: string; views: number; prebook_clicks: number; orders: number }[] = [];
  const first = Date.parse(`${timeline[0].day}T00:00:00Z`);
  const last = Date.parse(`${timeline[timeline.length - 1].day}T00:00:00Z`);
  if (!Number.isFinite(first) || !Number.isFinite(last) || last < first) return timeline.slice();
  // At most a year of days on one chart.
  for (let t = Math.max(first, last - 365 * 86_400_000); t <= last; t += 86_400_000) {
    const day = new Date(t).toISOString().slice(0, 10);
    out.push(byDay.get(day) ?? { day, views: 0, prebook_clicks: 0, orders: 0 });
  }
  return out;
}

/** Bar heights between 0 and 1 for one measure; all-zero stays all-zero. */
export function barHeights(values: number[]): number[] {
  const max = Math.max(0, ...values);
  return values.map((v) => (max > 0 ? v / max : 0));
}

/* --- counting on fan pages --------------------------------------------------------------------- */

const COUNTED_PREFIX = "cr-presale-counted:";

/**
 * A page open is sent once per browser tab and release, so reloading doesn't add to the artist's
 * numbers. Session storage only; nothing identifies the visitor. True when this one should be sent.
 */
export function firstOpenInTab(releaseId: string, store: Pick<Storage, "getItem" | "setItem"> | null = sessionStore()): boolean {
  try {
    if (!store) return true;
    if (store.getItem(COUNTED_PREFIX + releaseId)) return false;
    store.setItem(COUNTED_PREFIX + releaseId, "1");
    return true;
  } catch {
    return true;
  }
}

const PLACE_PREFIX = "cr-presale-place:";
const PLACE_VALUES = new Set(["PAGE", "STORE", "HOME", "RELEASES", "PROFILE"]);

/** A card on Corner Room was opened: remember where, for the page's own count (this tab only). */
export function notePlace(releaseId: string, place: PresalePlace, store: Pick<Storage, "setItem"> | null = sessionStore()): void {
  try {
    store?.setItem(PLACE_PREFIX + releaseId, place);
  } catch {
    /* storage off: the open counts as the release page */
  }
}

/** Where the visitor came from on Corner Room, once; the release page itself otherwise. */
export function takePlace(releaseId: string, store: Pick<Storage, "getItem" | "removeItem"> | null = sessionStore()): PresalePlace {
  try {
    const value = store?.getItem(PLACE_PREFIX + releaseId) ?? "";
    store?.removeItem(PLACE_PREFIX + releaseId);
    return (PLACE_VALUES.has(value) ? value : "PAGE") as PresalePlace;
  } catch {
    return "PAGE";
  }
}

/** The share link's code from the address bar (`?from=`), or null. */
export function shareSource(search: string | URLSearchParams | null | undefined): string | null {
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  const code = params?.get("from")?.trim().toLowerCase() ?? "";
  return /^[a-z0-9]{4,16}$/.test(code) ? code : null;
}

/** Only the referring site's host goes to the server, never the page it was on. */
export function referrerSite(referrer: string | null | undefined): string | null {
  if (!referrer) return null;
  try {
    const host = new URL(referrer).host;
    return host || null;
  } catch {
    return null;
  }
}

function sessionStore(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}
