/*
 * Words and checks for fan gifts and gift credit (owner, 2026-11-20, D-GIFT-FAN-01). The server
 * decides every total, every state and who may see what; this only reads them out. The giver is
 * never told why a gift was declined, or whether someone already owned the music.
 */

import type { GiftPage, GiftPerson, GiverState, MyGift } from "@/features/fan-gifts/api";

/** The most people one gift order can go to (server setting `fan_gift_max_people`, 10). */
export const MAX_PEOPLE = 10;
export const NOTE_MAX = 300;

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** One person per line, or several split by commas: "rumi@example.com" or "Rumi Das <rumi@example.com>". */
export function parsePeople(text: string): GiftPerson[] {
  return text
    .split(/[\n,;]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const angled = /^(.*)<([^>]+)>$/.exec(part);
      if (angled) {
        const name = angled[1].trim().replace(/^"|"$/g, "").trim();
        return { email: angled[2].trim().toLowerCase(), name: name || null };
      }
      return { email: part.toLowerCase(), name: null };
    });
}

/** What stops a gift going to these people, in the words the server uses; null when fine. */
export function peopleProblem(people: GiftPerson[], ownEmail: string | null | undefined, max = MAX_PEOPLE): string | null {
  if (!people.length) return "Add at least one email address.";
  const seen = new Set<string>();
  const own = (ownEmail ?? "").trim().toLowerCase();
  for (const p of people) {
    if (!EMAIL.test(p.email)) return `"${p.email}" isn't a complete email address.`;
    if (own && p.email === own) return "A gift is for someone else, so leave out your own email address.";
    if (seen.has(p.email)) return `${p.email} is on the list twice.`;
    seen.add(p.email);
  }
  if (max > 0 && people.length > max) return `One gift can go to at most ${max} people.`;
  return null;
}

export function noteProblem(note: string): string | null {
  return note.trim().length > NOTE_MAX ? `Keep the note to ${NOTE_MAX} characters.` : null;
}

export function peopleLine(n: number): string {
  return n === 1 ? "1 person" : `${n} people`;
}

/** Said before paying: what happens, honestly, and that the note is checked. */
export function giftPromise(hasNote: boolean): string[] {
  return [
    "Each person is emailed once you've paid" + (hasNote ? " and Corner Room has checked your note." : "."),
    "If they have an account the music is theirs at once; if not, they get it when they sign up with that email.",
    "If a gift isn't claimed in 7 days, or someone says no thanks, you get its amount back as credit to spend on this artist's music.",
  ];
}

export const GIVER_STATE: Record<GiverState, string> = {
  NOT_SENT_YET: "Not sent yet",
  DELIVERED: "Delivered",
  ACCEPTED: "Accepted",
  PASSED_ON: "Passed on",
  DECLINED: "Declined, credit back to you",
  NOT_CLAIMED: "Not claimed, credit back to you",
};

export function giftStatusLine(g: Pick<MyGift, "status" | "note_state">): string {
  if (g.status === "PENDING_PAYMENT") return "Waiting for your payment.";
  if (g.status === "WAITING_NOTE") return "Paid. Corner Room is checking your note, then everyone is emailed.";
  if (g.status === "CANCELLED") return "Cancelled.";
  return g.note_state === "REMOVED" ? "Sent without your note (it couldn't go out as written)." : "Sent.";
}

/** Shown once a gift is paid for. */
export function giftPaidLine(people: number): string {
  return `We email ${peopleLine(people)} now, or as soon as Corner Room has checked your note.`;
}

export function giftHeadline(page: Pick<GiftPage, "giver_name" | "passed_on_by" | "title" | "act_name">): string {
  const who = page.passed_on_by ?? page.giver_name ?? "Someone";
  return `${who} sent you ${page.title} by ${page.act_name}`;
}

/** The recipient's state in words. */
export function recipientLine(page: Pick<GiftPage, "status" | "title" | "act_name">): string {
  switch (page.status) {
    case "GIVEN":
      return `${page.title} is in your library.`;
    case "CHOOSING":
      return `You already own ${page.title}, so choose what to do with this gift.`;
    case "KEPT_CREDIT":
      return `The gift's amount is your credit to spend on ${page.act_name}'s music.`;
    case "PASSED_ON":
      return "You passed this gift on.";
    case "DECLINED":
      return "You said no thanks to this gift.";
    case "EXPIRED":
      return "This gift wasn't claimed in time.";
    case "WAITING_ACCOUNT":
      return "Verify your email to get it.";
    default:
      return "";
  }
}

export const CHOICE_WORDS = {
  KEEP_CREDIT: { label: "Keep it as credit", help: (act: string) => `Spend the amount on any of ${act}'s other music, now or later.` },
  PASS_ON: { label: "Pass it on", help: () => "Send it to someone else's email address instead." },
  DECLINE: { label: "No thanks", help: () => "The amount goes back to the person who sent it, as credit." },
} as const;

/** Where a signed-out viewer goes: sign in, or join with the address the gift is for. */
export function signInHref(token: string, kind: "login" | "register"): string {
  return `/${kind}?next=${encodeURIComponent(`/gift/${token}`)}`;
}
