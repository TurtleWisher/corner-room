"use client";

/*
 * A fan gift, opened from its email (owner, 2026-11-20, D-GIFT-FAN-01). Anyone with the link sees
 * what it is and who it's from; only the person it's for, signed in with that email, sees where it
 * stands and chooses. Someone who already owned the music keeps the amount as credit for the
 * artist's music, passes it on, or says no thanks (the giver then gets the credit).
 */

import { useParams } from "next/navigation";
import { useState } from "react";
import { CircleAlert, FileText, Gift, Headphones, LogIn, Send, UserPlus, Wallet } from "lucide-react";

import { useAuth } from "@/components/auth-provider";
import { LitSurface } from "@/components/brand/corner-light";
import { CoverArt } from "@/components/brand/cover-art";
import { RoomCube } from "@/components/brand/room-cube";
import { Button, ButtonLink, Card, DateTime, ErrorState, Field, Input, Money, Skeleton } from "@/components/ds";
import { RetryButton } from "@/components/shell/staff-panel";
import { loadErrorMessage, useAsync } from "@/components/use-async";
import { chooseGift, giftFileUrl, openGift, type GiftChoice, type GiftPage } from "@/features/fan-gifts/api";
import { maybeCoverUrl, offerCoverSource } from "@/lib/cover-view";
import { friendlyError } from "@/lib/error-copy";
import { CHOICE_WORDS, giftHeadline, noteText, peopleProblem, recipientLine, signInHref } from "@/lib/fan-gift-view";

function listenHref(page: GiftPage): string {
  return page.work_type === "RELEASE" ? `/releases/${page.work_id}` : `/tracks/${page.work_id}`;
}

function Choices({ token, page, onPage }: { token: string; page: GiftPage; onPage: (next: GiftPage) => void }) {
  const { user } = useAuth();
  const [passing, setPassing] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<GiftChoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const problem = passing && email.trim() ? peopleProblem([{ email: email.trim().toLowerCase() }], user?.email) : null;

  async function choose(choice: GiftChoice) {
    setBusy(choice);
    setError(null);
    try {
      onPage(await chooseGift(token, choice, choice === "PASS_ON" ? { email: email.trim(), name: name.trim() || null } : undefined));
    } catch (err) {
      setError(friendlyError(err, "That didn't go through. Please try again."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-5 grid gap-3">
      {(["KEEP_CREDIT", "PASS_ON", "DECLINE"] as const).map((choice) => (
        <Card key={choice} className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="font-semibold text-fg">{CHOICE_WORDS[choice].label}</p>
              <p className="text-sm text-fg-muted">{CHOICE_WORDS[choice].help(page.act_name)}</p>
            </div>
            {choice === "PASS_ON" ? (
              <Button size="sm" variant="secondary" aria-expanded={passing} onClick={() => setPassing(!passing)}>
                <Send aria-hidden="true" /> {passing ? "Close" : "Pass it on"}
              </Button>
            ) : (
              <Button size="sm" variant={choice === "KEEP_CREDIT" ? "primary" : "ghost"} busy={busy === choice} disabled={busy !== null} onClick={() => void choose(choice)}>
                {choice === "KEEP_CREDIT" ? <Wallet aria-hidden="true" /> : null} {CHOICE_WORDS[choice].label}
              </Button>
            )}
          </div>
          {choice === "PASS_ON" && passing ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Field label="Their email address" error={problem ?? undefined}>
                {(c) => <Input {...c} type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />}
              </Field>
              <Field label="Their name (optional)">{(c) => <Input {...c} autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />}</Field>
              <Button className="justify-self-start" busy={busy === "PASS_ON"} disabled={!email.trim() || Boolean(problem) || busy !== null} onClick={() => void choose("PASS_ON")}>
                <Send aria-hidden="true" /> Send it to them
              </Button>
            </div>
          ) : null}
        </Card>
      ))}
      {error ? (
        <p role="alert" className="flex items-center gap-2 text-sm text-danger">
          <CircleAlert aria-hidden="true" className="size-4" /> {error}
        </p>
      ) : null}
    </div>
  );
}

function SpendCredit({ page }: { page: GiftPage }) {
  if (!page.credit) return null;
  return (
    <section aria-labelledby="spend-title" className="mt-6">
      <h2 id="spend-title" className="text-lg font-bold text-fg">
        Spend your credit
      </h2>
      <p className="mt-1 text-sm text-fg">
        You have <Money value={page.credit} minorDigits="always" className="font-semibold" /> to spend on {page.act_name}&apos;s music. It keeps until you use it.
      </p>
      {page.spend_on.length ? (
        <ul className="mt-3 grid gap-2">
          {page.spend_on.map((o) => (
            <li key={o.offer_id} className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-2">
              <span className="min-w-0 truncate text-fg">
                {o.title} <span className="text-xs text-fg-muted">{o.kind === "RELEASE" ? "Release" : "Song"}</span>
              </span>
              <span className="flex items-center gap-3">
                <Money value={o.price} minorDigits="always" className="text-sm" />
                <ButtonLink href={`/checkout?offer=${o.offer_id}`} size="sm" variant="secondary">
                  Get it with credit
                </ButtonLink>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-fg-muted">Nothing of theirs fits it right now. It stays for their next release.</p>
      )}
    </section>
  );
}

function GiftBody({ token }: { token: string }) {
  const { status } = useAuth();
  const loaded = useAsync(() => openGift(token), [token, status]);
  const [page, setPage] = useState<GiftPage | null>(null);
  if (status === "loading" || loaded.status === "loading") return <Skeleton className="h-64 w-full" />;
  if (loaded.status === "error") {
    return <ErrorState title="Gift not found" message={loadErrorMessage(loaded.error, "this gift")} action={<RetryButton onClick={loaded.reload} />} />;
  }
  const g = page ?? loaded.data;
  return (
    <div className="grid gap-6 sm:grid-cols-[10rem_1fr]">
      <CoverArt
        src={maybeCoverUrl(offerCoverSource(g.work_type, g.work_id), 480)}
        fallback={<RoomCube front={g.title} side={g.act_name} tone="sky" label="" className="w-40" />}
        className="w-40"
      />
      <div className="min-w-0">
        <p className="cr-eyebrow flex items-center gap-2 text-highlight">
          <Gift aria-hidden="true" className="size-4" /> A gift for you
        </p>
        <h1 id="gift-title" className="mt-2 text-2xl font-bold text-fg md:text-3xl">
          {giftHeadline(g)}
        </h1>
        {g.note ? (
          <blockquote className="mt-4 border-l-2 border-highlight pl-3 whitespace-pre-wrap text-fg">{noteText(g.note)}</blockquote>
        ) : null}
        {g.files?.length ? (
          // D-GIFT-FAN-02: the giver's pictures and PDFs, through this person's own gift link.
          <div className="mt-4 grid gap-3">
            {g.files.map((f) =>
              f.kind === "IMAGE" ? (
                // eslint-disable-next-line @next/next/no-img-element -- served by the API through the gift link
                <img key={f.id} src={giftFileUrl(token, f.id)} alt={f.name} className="max-h-[28rem] w-auto max-w-full border border-line" />
              ) : (
                <a key={f.id} href={giftFileUrl(token, f.id)} className="cr-focus inline-flex items-center gap-2 font-semibold text-link underline">
                  <FileText aria-hidden="true" className="size-4" /> Download {f.name}
                </a>
              ),
            )}
          </div>
        ) : null}

        {g.viewer === "RECIPIENT" ? (
          <>
            <p className="mt-4 font-semibold text-fg" role="status">
              {recipientLine(g)}
            </p>
            {g.expires_at && (g.status === "CHOOSING" || g.status === "WAITING_ACCOUNT") ? (
              <p className="mt-1 text-sm text-fg-muted">
                Choose by <DateTime value={g.expires_at} format="date" />, or it goes back to the person who sent it.
              </p>
            ) : null}
            {g.status === "GIVEN" ? (
              <ButtonLink href={listenHref(g)} className="mt-4">
                <Headphones aria-hidden="true" /> {g.preorder ? "See the release" : "Listen now"}
              </ButtonLink>
            ) : null}
            {g.status === "CHOOSING" ? <Choices token={token} page={g} onPage={setPage} /> : null}
            {g.status === "KEPT_CREDIT" ? <SpendCredit page={g} /> : null}
          </>
        ) : (
          <Card className="mt-5 p-5">
            <p className="text-fg">
              This gift is for <span className="font-semibold">{g.for_email}</span>.{" "}
              {g.viewer === "SIGNED_IN" ? "Sign in with that email address to open it." : "Sign in or join with that email address to get it. It's free."}
            </p>
            {g.viewer === "SIGNED_OUT" ? (
              <div className="mt-4 flex flex-wrap gap-3">
                <ButtonLink href={signInHref(token, "login")}>
                  <LogIn aria-hidden="true" /> Sign in
                </ButtonLink>
                <ButtonLink href={signInHref(token, "register")} variant="secondary">
                  <UserPlus aria-hidden="true" /> Join Corner Room
                </ButtonLink>
              </div>
            ) : null}
          </Card>
        )}
      </div>
    </div>
  );
}

export default function GiftPageRoute() {
  const params = useParams<{ token: string }>();
  const token = typeof params?.token === "string" ? params.token : "";
  return (
    <main id="main" data-theme="sky" className="cr-scope">
      <LitSurface as="section" theme="sky" aria-labelledby="gift-title" className="min-h-[70dvh]">
        <div className="mx-auto max-w-[56rem] px-4 py-12 md:px-6 md:py-14">
          <GiftBody token={token} />
        </div>
      </LitSurface>
    </main>
  );
}
