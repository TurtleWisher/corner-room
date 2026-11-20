/*
 * Words and checks for fan gifts and gift credit (owner, 2026-11-20, D-GIFT-FAN-01). The server
 * decides every total, every state and who may see what; this only reads them out. The giver is
 * never told why a gift was declined, or whether someone already owned the music.
 */

import type { OfferRecord } from "@/features/commerce/api";
import type { GiftPage, GiftPerson, GiverState, MyGift } from "@/features/fan-gifts/api";

/** The most people one gift order can go to (server setting `fan_gift_max_people`, 10). */
export const MAX_PEOPLE = 10;
/** D-GIFT-FAN-02: the giver's own email. */
export const NOTE_MAX = 2000;
export const SUBJECT_MAX = 150;
export const FILES_MAX = 5;
export const FILE_ACCEPT = "image/jpeg,image/png,image/webp,image/gif,application/pdf";

export const LOOKS: { key: "SKY" | "EMBER" | "NIGHT"; label: string; swatch: [string, string] }[] = [
  { key: "SKY", label: "Sky", swatch: ["#53c8ea", "#ffffff"] },
  { key: "EMBER", label: "Ember", swatch: ["#ff8a4c", "#fffaf6"] },
  { key: "NIGHT", label: "Night", swatch: ["#53c8ea", "#17142e"] },
];

/** The fill-ins a giver can use: each becomes that person's own words (as the server does). */
export const GIFT_FILL_INS = [
  { key: "first_name" as const, label: "Their first name", hint: "Each person's first name, as you typed it" },
  { key: "music" as const, label: "The music", hint: "The song or release you're giving" },
];

export function subjectProblem(subject: string): string | null {
  const line = subject.trim();
  if (line.length > SUBJECT_MAX) return `Keep the subject to ${SUBJECT_MAX} characters.`;
  if (/\]\(|https?:\/\//i.test(line)) return "A subject can't have a link in it.";
  return null;
}

/** Links in the message need a full https address, as the server checks. */
export function linksProblem(message: string): string | null {
  for (const m of message.matchAll(/\[[^\]\n]*\]\(([^)\s]*)\)/g)) {
    if (!/^https:\/\/.+/i.test(m[1])) return "Links need a full web address starting with https://";
  }
  return null;
}

export function fileProblem(file: { type: string; size: number }, count: number, maxBytes = 20 * 1024 * 1024): string | null {
  if (count >= FILES_MAX) return `Attach at most ${FILES_MAX} files.`;
  if (!FILE_ACCEPT.split(",").includes(file.type)) return "Attach a picture (JPG, PNG, WebP or GIF) or a PDF.";
  if (file.size > maxBytes) return "That file is too large.";
  return null;
}

/** Previews carry pictures as `cid:file-<id>`; the page swaps in the copies it has. */
export function withPictures(html: string, urls: Record<string, string>): string {
  return html.replace(/cid:file-([0-9a-f-]{36})/gi, (whole, id: string) => urls[id] ?? whole);
}

/** The inside of a written email's <body>, to draw it in the page (no frames are allowed). */
export function emailBody(html: string): string {
  const m = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html);
  return m ? m[1] : html;
}

/** Whose name the preview shows: each typed person, by name or email. */
export function previewPeople(people: { email: string; name?: string | null }[]): { label: string; name: string | null }[] {
  return people.length ? people.map((p) => ({ label: p.name || p.email, name: p.name ?? null })) : [{ label: "Someone without a name", name: null }];
}

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
  return note.trim().length > NOTE_MAX ? `Keep the message to ${NOTE_MAX.toLocaleString("en-US")} characters.` : (linksProblem(note) ?? null);
}

export function peopleLine(n: number): string {
  return n === 1 ? "1 person" : `${n} people`;
}

/** Said before paying: what happens, honestly, and that the note is checked. */
export function giftPromise(hasNote: boolean): string[] {
  return [
    "Each person is emailed once you've paid" + (hasNote ? " and Corner Room has checked your email." : "."),
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
export function recipientLine(page: Pick<GiftPage, "status" | "title" | "act_name"> & { preorder?: boolean }): string {
  switch (page.status) {
    case "GIVEN":
      return page.preorder ? `${page.title} is yours. It unlocks in your library the day it comes out.` : `${page.title} is in your library.`;
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

/**
 * The price a gift of this music is bought at: its normal everyone price, whether or not the giver
 * owns it (owner, 2026-11-20: owning a song must not stop you giving it), or the pre-sale price
 * while a release is on pre-sale. A song sold only as part of a release is given as that release.
 * Never the owners' price.
 */
export function giftOffer(
  offers: readonly OfferRecord[],
  kind: "TRACK" | "RELEASE",
  id: string,
  releaseIds: readonly string[] = [],
): OfferRecord | null {
  const everyone = (o: OfferRecord) => o.status === "ACTIVE" && (o.audience ?? "EVERYONE") === "EVERYONE";
  // Owner, 2026-11-20: a pre-order can be a gift the same way, at the pre-sale price.
  const presale = (o: OfferRecord) => o.status === "ACTIVE" && o.audience === "PRESALE";
  const own =
    offers.find((o) => everyone(o) && o.product_type === kind && o.subject_id === id) ??
    (kind === "RELEASE" ? offers.find((o) => presale(o) && o.product_type === "RELEASE" && o.subject_id === id) : undefined);
  if (own || kind === "RELEASE") return own ?? null;
  return offers.find((o) => everyone(o) && o.product_type === "RELEASE" && releaseIds.includes(o.subject_id ?? "")) ?? null;
}

/** Checkout with Give it as a gift already ticked. */
export function giftHref(offerId: string): string {
  return `/checkout?offer=${offerId}&gift=1`;
}

/** A message as plain words on the gift page: links keep their words, fill-ins are left out
 * (the email filled them in; the page shows the giver's text as written). */
export function noteText(note: string): string {
  return note
    .replace(/\[([^\]\n]*)\]\([^)\s]*\)/g, "$1")
    .replace(/\{(first_name|music)\}/g, "")
    .replace(/[ \t]+([,.!?])/g, "$1");
}

/** The owner's "Give it to someone" card beside the artist's gift card (owner, 2026-11-21). */
export function giftCornerWords(title: string): { title: string; body: string; label: string } {
  return {
    title: "Give it to someone",
    body: `Send ${title} to a friend by email. You pay, they keep it.`,
    label: `Give ${title} as a gift`,
  };
}
