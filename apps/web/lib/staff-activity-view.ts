/*
 * Staff activity in words (owner, 2026-11-28): "which admin has done which thing". The API reads
 * the audit log (every service writes it) for staff accounts only and names each area; this file
 * turns an action code such as `release.approved` into a short sentence, groups rows by Dhaka day
 * and links to the page for the thing it touched where one exists.
 */

import { formatDate, HOUSE_TIME_ZONE } from "@/lib/format/date";

/** Sentences for the actions staff do most; anything else is said from its code. */
const KNOWN: Record<string, string> = {
  "release.approved": "Approved a release",
  "release.rejected": "Sent a release back",
  "release.released": "Released music",
  "release.scheduled": "Scheduled a release",
  "release.taken_down": "Took a release down",
  "release.deleted": "Deleted a release",
  "track.approved": "Approved a song",
  "track.taken_down": "Took a song down",
  "teaser.approved": "Approved a preview",
  "payment.confirmed": "Confirmed a payment",
  "payment.rejected": "Turned down a payment",
  "payment.submission_rejected": "Turned down a payment",
  "refund.requested": "Asked for a refund",
  "refund.approved": "Approved a refund",
  "refund.completed": "Finished a refund",
  "royalty_rate.set": "Set an artist's royalty rate",
  "royalty_rate.ended": "Stopped an artist's royalty rate",
  "staff_account.set": "Changed a staff account",
  "staff_account.removed": "Took someone off the staff",
  "staff_account.invited": "Invited someone to the staff",
  "staff_account.invite_cancelled": "Cancelled a staff invite",
  "staff_account.invite_accepted": "Joined the staff",
  "role.assigned": "Gave a staff role",
  "role.revoked": "Took a staff role away",
  "event.published": "Published an event",
  "event.cancelled": "Cancelled an event",
  "user.suspended": "Suspended an account",
  "customer.viewed": "Looked at a customer",
  "auth.login": "Signed in",
  "auth.login_succeeded": "Signed in",
  "auth.logout": "Signed out",
  "organization.workspace_switched": "Changed workspace",
};

function humanize(code: string): string {
  return code.replace(/[_.]+/g, " ").trim();
}

export function actionWords(action: string): string {
  const known = KNOWN[action];
  if (known) return known;
  const [thing, ...rest] = action.split(".");
  const what = humanize(rest.join(" "));
  const noun = humanize(thing ?? "");
  if (!what) return noun ? noun.charAt(0).toUpperCase() + noun.slice(1) : "Did something";
  const sentence = `${what.charAt(0).toUpperCase()}${what.slice(1)} · ${noun}`;
  return sentence;
}

/** The staff page for the thing an action touched, when there is one. */
export function entityHref(entityType: string, entityId: string, action = ""): string | null {
  const id = encodeURIComponent(entityId);
  if (action.startsWith("royalty_rate.")) return `/staff/royalties?artist=${id}`;
  switch (entityType) {
    case "Release":
      return `/staff/catalog/releases/${id}`;
    case "User":
      return `/staff/users/${id}`;
    case "Event":
      return `/staff/events/${id}`;
    case "Organization":
      return `/staff/organizations/${id}`;
    case "Campaign":
      return `/staff/campaigns/${id}`;
    default:
      return null;
  }
}

function dhakaDayKey(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: HOUSE_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

export function dayHeading(iso: string, now: Date = new Date()): string {
  const key = dhakaDayKey(iso);
  if (key === dhakaDayKey(now.toISOString())) return "Today";
  if (key === dhakaDayKey(new Date(now.getTime() - 86_400_000).toISOString())) return "Yesterday";
  return formatDate(iso) ?? key;
}

export function groupByDay<T extends { occurred_at: string }>(items: T[], now: Date = new Date()): { heading: string; items: T[] }[] {
  const out: { key: string; heading: string; items: T[] }[] = [];
  for (const item of items) {
    const key = dhakaDayKey(item.occurred_at);
    const last = out[out.length - 1];
    if (last && last.key === key) last.items.push(item);
    else out.push({ key, heading: dayHeading(item.occurred_at, now), items: [item] });
  }
  return out.map(({ heading, items: rows }) => ({ heading, items: rows }));
}

/** Short tile numbers: 1234 -> "1,234". */
export function countWords(n: number | null | undefined): string {
  return n === null || n === undefined ? "Not available" : new Intl.NumberFormat("en-US").format(n);
}

/** Bar heights (0 to 1) for a small day chart, from counts only. */
export function barHeights(values: number[]): number[] {
  const max = Math.max(0, ...values);
  return values.map((v) => (max === 0 ? 0 : v / max));
}
