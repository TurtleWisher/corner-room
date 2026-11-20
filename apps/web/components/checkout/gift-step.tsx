"use client";

/*
 * Checkout steps for fan gifts and gift credit (owner, 2026-11-20, D-GIFT-FAN-01).
 * GiftStep: buy this music for people you know, by email, with an optional note Corner Room checks.
 * CreditStep: pay the whole order with gift credit for this artist's music, when it covers it.
 * The server checks the people and the note again and decides every total.
 */

import { Gift, Wallet } from "lucide-react";

import { Card, Field, Money, Textarea } from "@/components/ds";
import { useAsync } from "@/components/use-async";
import { fetchOfferCredit, type GiftPerson } from "@/features/fan-gifts/api";
import { giftPromise, MAX_PEOPLE, NOTE_MAX, noteProblem, parsePeople, peopleLine, peopleProblem } from "@/lib/fan-gift-view";

export type GiftDraft = { on: boolean; peopleText: string; note: string };

export const NO_GIFT: GiftDraft = { on: false, peopleText: "", note: "" };

/** The checked people and note, or why the gift can't be placed yet. */
export function readGift(draft: GiftDraft, ownEmail: string | null | undefined): { people: GiftPerson[]; note: string | null; problem: string | null } {
  const people = parsePeople(draft.peopleText);
  const problem = peopleProblem(people, ownEmail) ?? noteProblem(draft.note);
  return { people, note: draft.note.trim() || null, problem };
}

export function GiftStep({
  draft,
  onChange,
  ownEmail,
  each,
}: {
  draft: GiftDraft;
  onChange: (next: GiftDraft) => void;
  ownEmail: string | null | undefined;
  /** The price per person, as the offer states it (the server decides the total). */
  each: { amount_minor: number; currency_code: string } | null;
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
          <Field
            label="Their email addresses"
            hint={`One per line, up to ${MAX_PEOPLE}. Add a name like this: Rumi Das <rumi@example.com>`}
            error={typed && read.problem && read.problem !== noteProblem(draft.note) ? read.problem : undefined}
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
          <Field label="A note (optional)" hint={`Up to ${NOTE_MAX} characters. Corner Room reads every note before it's sent.`} error={noteProblem(draft.note) ?? undefined}>
            {(c) => <Textarea {...c} rows={2} value={draft.note} onChange={(e) => onChange({ ...draft, note: e.target.value })} />}
          </Field>
          {read.people.length && !read.problem && each ? (
            <p className="text-sm text-fg" aria-live="polite">
              For {peopleLine(read.people.length)},{" "}
              <Money value={each} minorDigits="always" className="font-semibold" /> each. You see the total before you pay.
            </p>
          ) : null}
          <ul className="grid gap-1 border-l-2 border-line pl-3 text-sm text-fg">
            {giftPromise(Boolean(draft.note.trim())).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}

export function CreditStep({ offerId, on, onChange }: { offerId: string; on: boolean; onChange: (on: boolean) => void }) {
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
          Pay with my gift credit (nothing to pay now)
        </label>
      ) : (
        <p className="mt-2 text-sm text-fg-muted">It doesn&apos;t cover this one, so it stays for something else.</p>
      )}
    </Card>
  );
}
