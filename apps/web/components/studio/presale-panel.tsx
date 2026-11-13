"use client";

/* The release's pre-sale in Studio (owner, 2026-11-03, D-PRESALE-03, following the pre-sale
 * experience guide): open a pre-sale before the music is finished, see where it stands, preview
 * what fans see, and write the email buyers get on release day. Every state comes from the API. */

import { useState } from "react";
import { CalendarClock, CircleAlert, CircleCheck, Clock, ExternalLink, Mail, Send, ShoppingBag, Undo2 } from "lucide-react";

import { Button, Card, DateTime, Field, Input, Money } from "@/components/ds";
import { Textarea } from "@/components/ds/input";
import { PresaleCover } from "@/components/music/presale-cover";
import { CoverSwitch } from "@/components/studio/cover-reveal";
import {
  requestPresale,
  savePresaleEmail,
  submitPresaleEmail,
  withdrawPresale,
  type StudioReleaseDetail,
} from "@/features/studio/api";
import { coverUrl } from "@/lib/cover-view";
import { friendlyError } from "@/lib/error-copy";
import { fromLocalInput, toLocalInput } from "@/lib/artist-mail-view";
import { preorderLabel, studioPresaleStage } from "@/lib/presale-view";
import { RELEASE_TYPE_LABEL } from "@/lib/studio-view";

type Reload = (next?: StudioReleaseDetail) => void;

function useRun(reload: Reload) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<StudioReleaseDetail>) => {
    setBusy(key);
    setError(null);
    try {
      reload(await fn());
      return true;
    } catch (err) {
      setError(friendlyError(err, "That didn't save. Please try again."));
      return false;
    } finally {
      setBusy(null);
    }
  };
  return { busy, error, run };
}

function Problem({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="mt-3 flex items-start gap-2 text-sm text-danger">
      <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      {message}
    </p>
  );
}

/** Where the pre-sale stands, in words, from the API's answer. */
function PresaleStatus({ detail }: { detail: StudioReleaseDetail }) {
  const p = detail.presale!;
  const stage = studioPresaleStage(p, detail.release.status);
  const date = p.release_at ?? p.requested_release_at;
  if (stage === "live") {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="inline-flex items-center gap-2 font-semibold text-fg">
          <CircleCheck aria-hidden="true" className="size-4 text-success" /> Your pre-sale is live.
        </span>
        <span className="text-fg-muted">
          Fans can pre-book until <DateTime value={p.release_at!} format="datetime" />.
        </span>
        <a href={`/releases/${detail.release.id}`} className="cr-focus inline-flex items-center gap-1 font-semibold text-link underline">
          Open your pre-sale page <ExternalLink aria-hidden="true" className="size-3.5" />
        </a>
      </div>
    );
  }
  if (stage === "closed") {
    return (
      <p className="inline-flex items-start gap-2 text-fg">
        <Clock aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-fg-muted" />
        The release date has passed, so pre-orders are closed. Buyers keep their pre-orders; the music unlocks once the release is finished,
        approved and out.
      </p>
    );
  }
  if (stage === "waiting") {
    return (
      <p className="inline-flex items-start gap-2 text-fg">
        <Clock aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-fg-muted" />
        <span>
          Waiting for Corner Room to check the title, the date{date ? <> (<DateTime value={date} format="datetime" />)</> : null} and the price.
        </span>
      </p>
    );
  }
  if (stage === "returned") {
    return (
      <p className="inline-flex items-start gap-2 text-fg">
        <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-danger" />
        <span>
          Sent back by Corner Room{p.note ? <>: {p.note}</> : null}. Change what they asked and send it again.
        </span>
      </p>
    );
  }
  if (stage === "approved_waiting_price") {
    return (
      <p className="inline-flex items-start gap-2 text-fg">
        <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
        Approved for <DateTime value={p.release_at!} format="datetime" />. Fans can pre-book once Corner Room agrees the pre-sale price.
      </p>
    );
  }
  if (stage === "scheduled") {
    return (
      <p className="text-fg">
        Your release is scheduled{detail.release.release_at ? <> for <DateTime value={detail.release.release_at} format="datetime" /></> : null}.
        Fans can pre-book once a pre-sale price is agreed.
      </p>
    );
  }
  return <p className="text-fg-muted">No pre-sale yet.</p>;
}

/** What fans will see: title, artist, date and the offer only. Nothing else from the release. */
function FanPreview({ detail, date }: { detail: StudioReleaseDetail; date: string | null }) {
  const p = detail.presale!;
  return (
    <Card tone="outline" className="p-4" aria-labelledby="fan-preview-title">
      <p id="fan-preview-title" className="cr-eyebrow text-[0.6875rem] text-fg-muted">
        What fans see
      </p>
      <div className="mt-3 grid gap-4 border border-line bg-surface-sunken p-4">
        {/* The cover as fans see it now (D-COVER-03): a little blurred until the switch is on. */}
        <PresaleCover
          coverUrl={coverUrl({ signed: detail.cover_reveal?.preview_url }, 480)}
          revealed={Boolean(detail.cover_reveal?.revealed)}
          title={detail.release.title}
          artist={detail.profile.display_name}
          className="w-full max-w-[14rem]"
        />
        <div className="min-w-0">
          <p className="cr-eyebrow text-[0.6875rem] text-highlight">Pre-sale</p>
          <p className="mt-1 break-words text-xl font-bold text-fg">{detail.release.title}</p>
          <p className="text-fg">{detail.profile.display_name}</p>
          <p className="mt-2 inline-flex items-start gap-2 text-sm text-fg">
            <CalendarClock aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {date ? (
              <span>
                Out <DateTime value={date} format="datetime" showZone />
              </span>
            ) : (
              <span className="text-fg-muted">Release date not set yet</span>
            )}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span aria-disabled="true" className="inline-flex h-10 items-center gap-2 bg-brand px-3 text-sm font-semibold text-on-brand opacity-90">
              <ShoppingBag aria-hidden="true" className="size-4" /> {preorderLabel(detail.release.release_type)}
              {p.price ? <Money value={{ amount_minor: p.price.amount_minor, currency_code: p.price.currency_code }} /> : null}
            </span>
            {p.price && p.price.status !== "ACCEPTED" ? <span className="text-xs text-fg-muted">Price shown once Corner Room agrees it</span> : null}
          </div>
        </div>
      </div>
      <p className="mt-3 text-xs text-fg-muted">Fans never see your songs, credits or anything else before release, even when you&apos;ve uploaded them.</p>
    </Card>
  );
}

function ReleaseDayEmail({ detail, reload }: { detail: StudioReleaseDetail; reload: Reload }) {
  const email = detail.presale!.email;
  const [subject, setSubject] = useState(email?.subject ?? "");
  const [body, setBody] = useState(email?.body ?? "");
  const { busy, error, run } = useRun(reload);
  const sent = email?.status === "SENDING" || email?.status === "SENT";
  const changed = subject !== (email?.subject ?? "") || body !== (email?.body ?? "");

  return (
    <div>
      <p className="flex items-start gap-2 text-sm text-fg-muted">
        <Mail aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <span>
        Everyone who pre-orders gets this when the music comes out, as well as Corner Room&apos;s own &ldquo;it&apos;s out&rdquo; email. Corner
        Room checks it before it can go, like every email to buyers, and it carries a link to stop emails from you. Fill-ins: {"{first_name}"},{" "}
        {"{buyer_name}"}, {"{artist}"}.
        </span>
      </p>
      {email ? (
        <p role="status" className="mt-2 text-sm text-fg">
          {email.status === "DRAFT" && email.review_note ? (
            <span className="text-danger">Sent back: {email.review_note}</span>
          ) : email.status === "DRAFT" ? (
            "Saved as a draft. Send it to Corner Room when it's ready."
          ) : email.status === "IN_REVIEW" ? (
            "Waiting for Corner Room to check it."
          ) : email.status === "SCHEDULED" ? (
            "Approved. It goes out when the release does."
          ) : (
            <>Sent{email.recipient_count != null ? ` to ${email.recipient_count} ${email.recipient_count === 1 ? "person" : "people"}` : ""}.</>
          )}
        </p>
      ) : null}
      {!sent ? (
        <form
          className="mt-3 grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void run("save", () => savePresaleEmail(detail.release.id, { subject, body }));
          }}
        >
          <Field label="Subject">
            {(c) => <Input {...c} value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} required placeholder="It's out, {first_name}" />}
          </Field>
          <Field label="Message" hint={email?.status === "SCHEDULED" || email?.status === "IN_REVIEW" ? "Saving a change sends it back to a draft; send it again for checking." : undefined}>
            {(c) => <Textarea {...c} value={body} onChange={(e) => setBody(e.target.value)} rows={6} maxLength={20000} required />}
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="secondary" busy={busy === "save"} disabled={!changed || !subject.trim() || !body.trim()}>
              Save
            </Button>
            {email?.status === "DRAFT" && !changed ? (
              <Button type="button" busy={busy === "submit"} onClick={() => void run("submit", () => submitPresaleEmail(detail.release.id))}>
                <Send aria-hidden="true" /> Send to Corner Room
              </Button>
            ) : null}
          </div>
        </form>
      ) : null}
      <Problem message={error} />
    </div>
  );
}

type StepTone = "done" | "now" | "waiting" | "problem" | "todo";

const TONE_TEXT: Record<StepTone, string> = {
  done: "text-success",
  now: "text-highlight",
  waiting: "text-info",
  problem: "text-danger",
  todo: "text-fg-muted",
};

/** One numbered step of the pre-sale, with where it stands in words (never colour alone). */
function PresaleStep({ n, title, state, label, children }: { n: number; title: string; state: StepTone; label: string; children: React.ReactNode }) {
  const Icon = state === "done" ? CircleCheck : state === "problem" ? CircleAlert : state === "waiting" ? Clock : CalendarClock;
  return (
    <Card as="section" tone="solid" className="p-5" aria-labelledby={`presale-step-${n}`} data-state={state}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`presale-step-${n}`} className="flex items-center gap-3 text-base font-bold text-fg">
          <span className="cr-num inline-flex size-7 items-center justify-center border border-line-strong text-sm">{n}</span>
          {title}
        </h3>
        <span className={`inline-flex items-center gap-1.5 text-sm font-semibold ${TONE_TEXT[state]}`}>
          <Icon aria-hidden="true" className="size-4" /> {label}
        </span>
      </div>
      <div className="mt-3">{children}</div>
    </Card>
  );
}

type Presale = NonNullable<StudioReleaseDetail["presale"]>;

function priceStep(p: Presale): [StepTone, string] {
  if (p.price?.status === "ACCEPTED") return ["done", "Agreed"];
  if (p.price?.status === "PROPOSED") return ["waiting", "Proposed"];
  if (p.price?.status === "COUNTERED") return ["problem", "Corner Room replied"];
  return ["now", "To do"];
}

function dateStep(p: Presale, stage: string): [StepTone, string] {
  if (stage === "live") return ["done", "Live"];
  if (stage === "closed") return ["done", "Date passed"];
  if (stage === "approved_waiting_price" || p.status === "APPROVED") return ["done", "Approved"];
  if (stage === "scheduled") return ["done", "Set by Corner Room"];
  if (stage === "waiting") return ["waiting", "With Corner Room"];
  if (stage === "returned") return ["problem", "Sent back"];
  if (stage === "ready_to_send") return ["now", "To do"];
  return ["todo", "After the price"];
}

function emailStep(p: Presale): [StepTone, string] {
  const e = p.email;
  if (!e) return ["todo", "Optional"];
  if (e.status === "SENDING" || e.status === "SENT") return ["done", "Sent"];
  if (e.status === "SCHEDULED") return ["done", "Approved"];
  if (e.status === "IN_REVIEW") return ["waiting", "With Corner Room"];
  if (e.review_note) return ["problem", "Sent back"];
  return ["now", "Draft"];
}

export function PresalePanel({
  detail,
  reload,
  priceRow,
  campaignLink,
}: {
  detail: StudioReleaseDetail;
  reload: Reload;
  priceRow: React.ReactNode;
  campaignLink?: React.ReactNode;
}) {
  const p = detail.presale;
  const [when, setWhen] = useState(toLocalInput(p?.requested_release_at ?? p?.release_at ?? null));
  const { busy, error, run } = useRun(reload);
  if (!p) return null;
  const stage = studioPresaleStage(p, detail.release.status);
  const type = RELEASE_TYPE_LABEL[detail.release.release_type]?.toLowerCase() ?? "release";
  const shownDate = p.release_at ?? p.requested_release_at ?? (when ? fromLocalInput(when) : null);
  const [priceTone, priceLabel] = priceStep(p);
  const [dateTone, dateLabel] = dateStep(p, stage);
  const [mailTone, mailLabel] = emailStep(p);
  const canSwitch = Boolean(detail.cover_reveal?.can_switch);
  const revealed = Boolean(detail.cover_reveal?.revealed);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_19rem] lg:items-start">
      <div className="grid min-w-0 gap-4">
        <Card tone="solid" className="p-5">
          <p className="text-sm text-fg">
            Take pre-orders before your {type} is finished. Fans see only the title, your name, the release date and the pre-sale price, and
            pay now.
          </p>
          <ol className="mt-3 grid list-decimal gap-1.5 pl-5 text-sm text-fg-muted">
            <li>
              <span className="font-semibold text-fg">Pre-sale.</span> Corner Room checks the price and the date below, then it goes live.
            </li>
            <li>
              <span className="font-semibold text-fg">The music.</span> Keep adding songs, audio, cover and details, then send it in from Review.
              It is checked separately.
            </li>
            <li>
              <span className="font-semibold text-fg">Release day.</span> Once the music is approved, it goes out by itself on the pre-sale date.
              Nobody has to press anything.
            </li>
          </ol>
          <div role="status" className="mt-4 border-l-2 border-line pl-3 text-sm">
            <PresaleStatus detail={detail} />
          </div>
        </Card>

        <PresaleStep n={1} title="Pre-sale price" state={priceTone} label={priceLabel}>
          {priceRow}
        </PresaleStep>

        <PresaleStep n={2} title="Release date" state={dateTone} label={dateLabel}>
          {p.can_request ? (
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const iso = fromLocalInput(when);
                if (iso) void run("request", () => requestPresale(detail.release.id, iso));
              }}
            >
              <Field label="When it comes out" hint="Dhaka time. At least a day from now, so Corner Room can check it." className="min-w-56 flex-1">
                {(c) => <Input {...c} type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} required />}
              </Field>
              <Button type="submit" busy={busy === "request"} disabled={!when || stage === "price_needed"}>
                <Send aria-hidden="true" /> {p.status === "RETURNED" ? "Send the pre-sale again" : "Send pre-sale for review"}
              </Button>
            </form>
          ) : (
            <p className="text-sm text-fg">
              {p.release_at ?? p.requested_release_at ? (
                <>
                  Out <DateTime value={(p.release_at ?? p.requested_release_at)!} format="datetime" showZone />.
                </>
              ) : (
                "Corner Room sets the date when it approves the music."
              )}{" "}
              <span className="text-fg-muted">To change the date or cancel the pre-sale, ask Corner Room. If it&apos;s cancelled, every buyer gets a full refund.</span>
            </p>
          )}
          {stage === "price_needed" && p.can_request ? <p className="mt-2 text-sm text-fg-muted">Propose a pre-sale price in step 1 first.</p> : null}
          {p.can_withdraw ? (
            <Button variant="ghost" size="sm" className="mt-3" busy={busy === "withdraw"} onClick={() => void run("withdraw", () => withdrawPresale(detail.release.id))}>
              <Undo2 aria-hidden="true" /> Take the pre-sale back
            </Button>
          ) : null}
          <Problem message={error} />
        </PresaleStep>

        {canSwitch ? (
          <PresaleStep n={3} title="Cover for fans" state={revealed ? "done" : "todo"} label={revealed ? "Showing" : "Blurred for now"}>
            <CoverSwitch detail={detail} reload={reload} />
          </PresaleStep>
        ) : null}

        <PresaleStep n={canSwitch ? 4 : 3} title="Email on release day" state={mailTone} label={mailLabel}>
          <ReleaseDayEmail key={`${p.email?.id ?? "new"}-${p.email?.status ?? ""}`} detail={detail} reload={reload} />
        </PresaleStep>
      </div>

      <aside className="grid gap-3 lg:sticky lg:top-24" aria-label="Fan preview">
        <FanPreview detail={detail} date={shownDate} />
        {campaignLink}
      </aside>
    </div>
  );
}
