/*
 * The artist's Mailbox (owner, 2026-11-09, D-MAILBOX-01, /studio/mailbox): one corner for every
 * email Corner Room sends for an act. Folders, words for each kind and state, why each person got
 * an email, and the day groups of the Sent list. Pure helpers; the API keeps the history (names
 * only, never addresses) and writes and sends every email.
 */

import type { MailboxItem, MailboxKind, MailboxState, MailboxWhy } from "@/features/artist-mail/api";
import type { StatusTone } from "@/lib/format/status";

export type MailboxBox = "sent" | "write" | "outbox" | "automatic" | "templates" | "report";

export const BOXES: { key: MailboxBox; label: string; hint: string }[] = [
  { key: "sent", label: "Sent", hint: "Every email, to whom, when and why" },
  { key: "outbox", label: "Waiting", hint: "Drafts, approvals and scheduled emails" },
  { key: "write", label: "Write", hint: "A new email to your buyers" },
  { key: "automatic", label: "Automatic", hint: "Thank-yous and gift updates that send by themselves" },
  { key: "templates", label: "Templates", hint: "Saved emails to start from" },
  { key: "report", label: "Report", hint: "Reach and link presses" },
];

const BOX_KEYS = new Set(BOXES.map((b) => b.key));

/** The folder in `?box=`, else Sent. */
export function boxFrom(search: string): MailboxBox {
  const box = new URLSearchParams(search).get("box");
  return box && BOX_KEYS.has(box as MailboxBox) ? (box as MailboxBox) : "sent";
}

export const KIND_LABEL: Record<MailboxKind, string> = {
  THANK_YOU: "Thank-you",
  MANUAL: "Email to buyers",
  GIFT: "Music gift",
  GIFT_UPDATE: "Gift update",
  TEST: "Test to you",
};

/** Filter chips for the Sent list, in order. */
export const KIND_FILTERS: { key: MailboxKind | "ALL"; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "MANUAL", label: "To buyers" },
  { key: "GIFT_UPDATE", label: "Gift updates" },
  { key: "THANK_YOU", label: "Thank-yous" },
  { key: "GIFT", label: "Music gifts" },
  { key: "TEST", label: "Tests" },
];

export const STATE_LABEL: Record<MailboxState, string> = {
  PENDING: "On its way",
  SENT: "Sent",
  SUPPRESSED: "Not sent",
  FAILED: "Couldn't send",
};

export const STATE_TONE: Record<MailboxState, StatusTone> = {
  PENDING: "info",
  SENT: "positive",
  SUPPRESSED: "neutral",
  FAILED: "negative",
};

/** What a state means, for the reading pane. */
export const STATE_MEANING: Record<MailboxState, string> = {
  PENDING: "Corner Room is sending it now.",
  SENT: "Delivered to their email provider.",
  SUPPRESSED: "Not sent: they had stopped emails from you.",
  FAILED: "Their email provider didn't take it. Corner Room tried more than once.",
};

const GIFT_STATUS_WORD: Record<string, string> = {
  DISPATCHED: "on its way",
  RETURNED: "came back",
  MISSING: "is late",
  OTHER: "other news",
};

/** Why this person got this email, in one line, from what the API says it was part of. */
export function whyLine(why: MailboxWhy): string {
  switch (why.kind) {
    case "GIFT_UPDATE": {
      const what = GIFT_STATUS_WORD[why.gift_status ?? ""] ?? "update";
      const campaign = why.campaign ? `${why.campaign}: ` : "";
      return why.picked ? `${campaign}gift ${what}, to buyers you picked` : `${campaign}gift ${what}, sent by itself`;
    }
    case "MANUAL":
      return why.mail_subject ? `Your email "${why.mail_subject}"` : "Your email to buyers";
    case "GIFT":
      return why.gift_title ? `Music gift: ${why.gift_title}` : "Music gift";
    case "THANK_YOU":
      return "Thank-you after a purchase, sent by itself";
    default:
      return "A test you sent yourself";
  }
}

/** Initials for a person's circle: two letters, or "?" with no name. */
export function initials(name: string | null | undefined): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  const first = Array.from(words[0])[0] ?? "";
  const last = words.length > 1 ? (Array.from(words[words.length - 1])[0] ?? "") : "";
  return (first + last).toUpperCase();
}

/** The person line: their name, or a plain stand-in (never an address). */
export function toLine(item: Pick<MailboxItem, "to_name" | "kind">): string {
  if (item.kind === "TEST") return "You";
  return item.to_name?.trim() || "A buyer with no name on file";
}

const DAY = 86_400_000;

/** Day group for the Sent list, in Bangladesh time: Today, Yesterday, This week, else month and year. */
export function dayGroup(iso: string, now: Date): string {
  const shift = 6 * 3_600_000;
  const day = (d: Date) => Math.floor((d.getTime() + shift) / DAY);
  const at = new Date(iso);
  const diff = day(now) - day(at);
  if (diff <= 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff < 7) return "This week";
  return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "Asia/Dhaka" }).format(at);
}

/** Items grouped by day, in their order. */
export function groupByDay<T extends { queued_at: string }>(items: T[], now: Date): { label: string; items: T[] }[] {
  const out: { label: string; items: T[] }[] = [];
  for (const item of items) {
    const label = dayGroup(item.queued_at, now);
    const last = out[out.length - 1];
    if (last && last.label === label) last.items.push(item);
    else out.push({ label, items: [item] });
  }
  return out;
}

/** "3 link presses" for a row, or null when none. */
export function clicksLine(n: number): string | null {
  if (!n) return null;
  return `${n} link ${n === 1 ? "press" : "presses"}`;
}

/** Where an old Gifts > Emails link goes now (D-MAILBOX-01): a campaign's Emails part, or the Mailbox. */
export function oldEmailsTarget(search: string): string {
  const params = new URLSearchParams(search);
  const campaign = params.get("campaign");
  if (campaign && /^[0-9a-f-]{8,64}$/i.test(campaign)) return `/studio/gifts/${campaign}#emails`;
  if (params.get("view") === "report") return "/studio/mailbox?box=report";
  return "/studio/mailbox";
}
