"use client";

/*
 * Checkout steps for fan gifts and gift credit (owner, 2026-11-20, D-GIFT-FAN-01).
 * GiftStep: buy this music for people you know, by email, with an email of the giver's own design
 * (D-GIFT-FAN-02, GiftEmailEditor) that Corner Room checks before anyone gets it.
 * CreditStep: pay the whole order with gift credit for this artist's music, when it covers it.
 * The server checks the people and the note again and decides every total.
 */

import { Gift, Wallet } from "lucide-react";

import { Card, Field, Money, Textarea } from "@/components/ds";
import { GiftEmailEditor, NO_DESIGN } from "@/components/fan-gifts/gift-email-editor";
import { useAsync } from "@/components/use-async";
import { fetchOfferCredit, type GiftDesign, type GiftFile, type GiftPerson } from "@/features/fan-gifts/api";
import { giftPromise, MAX_PEOPLE, noteProblem, parsePeople, peopleLine, peopleProblem, subjectProblem } from "@/lib/fan-gift-view";

export type GiftDraft = { on: boolean; peopleText: string; design: GiftDesign };

export const NO_GIFT: GiftDraft = { on: false, peopleText: "", design: NO_DESIGN };

/** The checked people and the email's design, or why the gift can't be placed yet. */
export function readGift(
  draft: GiftDraft,
  ownEmail: string | null | undefined,
): { people: GiftPerson[]; note: string | null; design: GiftDesign; problem: string | null } {
  const people = parsePeople(draft.peopleText);
  const problem = peopleProblem(people, ownEmail) ?? noteProblem(draft.design.note) ?? subjectProblem(draft.design.subject);
  return { people, note: draft.design.note.trim() || null, design: draft.design, problem };
}

const designProblem = (d: GiftDesign) => noteProblem(d.note) ?? subjectProblem(d.subject);

export function GiftStep({
  draft,
  onChange,
  ownEmail,
  each,
  offerId,
  title,
  seedFiles,
  sentAgainFrom,
}: {
  draft: GiftDraft;
  onChange: (next: GiftDraft) => void;
  ownEmail: string | null | undefined;
  /** For the email preview (the server writes it). */
  offerId: string;
  title: string;
  /** The price per person, as the offer states it (the server decides the total). */
  each: { amount_minor: number; currency_code: string } | null;
  /** Files of a gift being sent again (D-GIFT-FAN-03). */
  seedFiles?: GiftFile[];
  /** Set when the form was filled from a gift being sent again. */
  sentAgainFrom?: boolean;
}) {
  const read = readGift(draft, ownEmail);
  const typed = draft.peopleText.trim().length > 0;
  return (
    <Card as="section" aria-labelledby="gift-title" className="p-6">
      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          className="mt-1 size-4 accent-[var(--color-highlight)]"
          checked={draft.on}
          onChange={(e) => onChange({ ...draft, on: e.target.checked })}
        />
        <span>
          <span id="gift-title" className="flex items-center gap-2 text-lg font-bold text-fg">
            <Gift aria-hidden="true" className="size-5 text-highlight" /> Give it as a gift
          </span>
          <span className="mt-1 block text-sm text-fg-muted">Buy it for people you know. You pay now, they get it by email.</span>
        </span>
      </label>
      {draft.on ? (
        <div className="mt-5 grid gap-4">
          {sentAgainFrom ? (
            <p className="text-sm text-fg" role="status">
              Filled in from your earlier gift: the people who didn&apos;t claim it, with your same words, look and files. Change anything before you
              send.
            </p>
          ) : null}
          <Field
            label="Their email addresses"
            hint={`One per line, up to ${MAX_PEOPLE}. Add a name like this: Rumi Das <rumi@example.com>`}
            error={typed && read.problem && read.problem !== designProblem(draft.design) ? read.problem : undefined}
          >
            {(c) => (
              <Textarea
                {...c}
                rows={3}
                value={draft.peopleText}
                autoComplete="off"
                onChange={(e) => onChange({ ...draft, peopleText: e.target.value })}
                placeholder="friend@example.com"
              />
            )}
          </Field>
          <div className="border-t border-line pt-4">
            <h3 className="text-base font-bold text-fg">Their email</h3>
            <p className="mb-4 mt-1 text-sm text-fg-muted">Write it your way and see it as each of them will.</p>
            <GiftEmailEditor
              offerId={offerId}
              title={title}
              people={read.people}
              design={draft.design}
              onChange={(design) => onChange({ ...draft, design })}
              seedFiles={seedFiles}
            />
          </div>
          {read.people.length && !read.problem && each ? (
            <p className="text-sm text-fg" aria-live="polite">
              For {peopleLine(read.people.length)},{" "}
              <Money value={each} minorDigits="always" className="font-semibold" /> each. You see the total before you pay.
            </p>
          ) : null}
          <ul className="grid gap-1 border-l-2 border-line pl-3 text-sm text-fg">
            {giftPromise(Boolean(draft.design.note.trim() || draft.design.subject.trim() || draft.design.file_ids.length)).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}

export function CreditStep({
  offerId,
  on,
  onChange,
  giving = false,
  people = 1,
}: {
  offerId: string;
  on: boolean;
  onChange: (on: boolean) => void;
  /** Giving it as a gift: the credit pays for the gift instead (owner, 2026-11-27, D-GIFT-FAN-03). */
  giving?: boolean;
  people?: number;
}) {
  const credit = useAsync(() => fetchOfferCredit(offerId).catch(() => null), [offerId]);
  const data = credit.status === "ok" ? credit.data : null;
  if (!data?.balance) return null;
  return (
    <Card as="section" aria-labelledby="credit-title" className="p-6">
      <h2 id="credit-title" className="flex items-center gap-2 text-lg font-bold text-fg">
        <Wallet aria-hidden="true" className="size-5 text-highlight" /> Your gift credit
      </h2>
      <p className="mt-1 text-sm text-fg">
        You have <Money value={data.balance} minorDigits="always" className="font-semibold" /> to spend on {data.act_name}&apos;s music.
      </p>
      {data.usable ? (
        <label className="mt-3 flex cursor-pointer items-center gap-3 text-sm font-semibold text-fg">
          <input type="checkbox" className="size-4 accent-[var(--color-highlight)]" checked={on} onChange={(e) => onChange(e.target.checked)} />
          {giving ? "Pay for this gift with my gift credit (nothing to pay now)" : "Pay with my gift credit (nothing to pay now)"}
        </label>
      ) : (
        <p className="mt-2 text-sm text-fg-muted">It doesn&apos;t cover this one, so it stays for something else.</p>
      )}
      {giving && data.usable && people > 1 ? (
        <p className="mt-2 text-sm text-fg-muted">Credit pays for the whole gift, one copy for each person, so it needs to cover all {people} of them.</p>
      ) : null}
    </Card>
  );
}
