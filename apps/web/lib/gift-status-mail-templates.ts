/*
 * Ready-made gift status emails (owner, 2026-11-07, D-CAMPAIGN-06): pick one and the subject,
 * message and button are written; the artist adds a line or changes a word. Written in the act's
 * own voice ("I" for an artist, "we" for a band), greeting each buyer by name. No facts are made up:
 * what only the act knows is marked "[add ...]" and must be written before the email goes to review.
 */

import type { StatusMailStatus } from "@/features/gifts/api";
import type { Voice } from "@/lib/artist-mail-starters";

export type GiftTemplate = {
  id: string;
  label: string;
  subject: string;
  body: string;
  /** A button under the message; the address is filled in when the template knows it. */
  button: { label: string; url: string } | null;
};

function v(voice: Voice) {
  const band = voice === "we";
  return {
    me: band ? "us" : "me",
    im: band ? "we're" : "I'm",
    Im: band ? "We're" : "I'm",
    ill: band ? "we'll" : "I'll",
    Ill: band ? "We'll" : "I'll",
    I: band ? "We" : "I",
  };
}

/** The templates for one status. `web` is Corner Room's own address (for the account page). */
export function giftTemplates(status: StatusMailStatus, voice: Voice, web: string): GiftTemplate[] {
  const w = v(voice);
  const account = `${web.replace(/\/$/, "")}/account`;
  if (status === "DISPATCHED") {
    return [
      {
        id: "warm",
        label: "Warm thank-you",
        subject: "Your {gift} is on its way, {first_name}",
        body:
          `Hi {first_name},\n\nThank you for buying {music}. Your gift ({gift}) has just left ${w.me} and is on its way to you. ` +
          `It should reach you in the next few days.\n\n${w.I} hope you love it.\n\n{artist}`,
        button: null,
      },
      {
        id: "tracking",
        label: "With tracking",
        subject: "Your {gift} is on its way: track it here",
        body:
          `Hi {first_name},\n\nYour {gift} for buying {music} is on its way. It's travelling with [add the courier's name], ` +
          `and you can follow it with the button below.\n\nThanks for being here,\n{artist}`,
        button: { label: "Track your parcel", url: "" },
      },
      {
        id: "short",
        label: "Short and sweet",
        subject: "Your {gift} is on its way",
        body: "Hi {first_name}, your {gift} is on its way to you. Thanks for buying {music}!\n\n{artist}",
        button: null,
      },
    ];
  }
  if (status === "RETURNED") {
    return [
      {
        id: "address",
        label: "Check your address",
        subject: "Your {gift} came back: please check your address",
        body:
          `Hi {first_name},\n\nYour {gift} came back to ${w.me}: the courier couldn't deliver it. Please check that the ` +
          `delivery address on your Corner Room account is right. Once it is, ${w.ill} send it again.\n\nSorry for the wait,\n{artist}`,
        button: { label: "Check my address", url: account },
      },
      {
        id: "resend",
        label: "Sending it again",
        subject: "Your {gift} is coming again",
        body:
          `Hi {first_name},\n\nYour {gift} didn't reach you and came back, so ${w.im} sending it again [add when]. ` +
          `You don't need to do anything.\n\n{artist}`,
        button: null,
      },
    ];
  }
  return [
    {
      id: "looking",
      label: "Looking for it",
      subject: "Your {gift} is taking longer than expected",
      body:
        `Hi {first_name},\n\nYour {gift} hasn't reached you yet, and ${w.im} finding out where it is. ${w.Ill} email you as ` +
        `soon as there's news. If it doesn't turn up, ${w.ill} send you another.\n\nThanks for your patience,\n{artist}`,
      button: null,
    },
    {
      id: "another",
      label: "Sending another",
      subject: "A new {gift} is coming your way",
      body:
        `Hi {first_name},\n\nYour {gift} seems to have been lost on the way, so ${w.im} sending you another one [add when]. ` +
        `Sorry about that, and thank you for buying {music}.\n\n{artist}`,
      button: null,
    },
  ];
}

/** Templates for other gift news, wherever the buyer's gift is (D-CAMPAIGN-07). Nothing made up:
 * the news itself is "[add ...]" for the act to write. */
export function otherTemplates(voice: Voice, web: string): GiftTemplate[] {
  const w = v(voice);
  const account = `${web.replace(/\/$/, "")}/account`;
  return [
    {
      id: "news",
      label: "A quick update",
      subject: "News about your {gift}",
      body: `Hi {first_name},\n\nA quick update about your {gift} for buying {music}: [add the news].\n\nThank you for being here,\n{artist}`,
      button: null,
    },
    {
      id: "confirm-address",
      label: "Confirm your address",
      subject: "Before your {gift} leaves: is your address right?",
      body:
        `Hi {first_name},\n\n${w.Im} getting your {gift} ready. Please check that the delivery address on your Corner Room ` +
        `account is right, so it reaches you the first time.\n\n{artist}`,
      button: { label: "Check my address", url: account },
    },
  ];
}
