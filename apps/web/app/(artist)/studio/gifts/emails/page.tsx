"use client";

/* Studio > Gifts > Emails (owner, 2026-11-02, D-MAIL-01): each profile's thank-you email, emails to
 * buyers (Corner Room checks each one before it goes) and saved templates. Buyers are names only. */

import { useState } from "react";
import { ArrowLeft, Mail, PenLine, Plus, Trash2, Undo2 } from "lucide-react";

import { MailComposer, type ComposerStart } from "@/components/artist-mail/mail-composer";
import { ThankYouCard } from "@/components/artist-mail/thank-you-card";
import { Button, ButtonLink, Card, EmptyState, ErrorState, Skeleton } from "@/components/ds";
import { GiftTabs } from "@/components/gifts/gift-tabs";
import { AccountPage } from "@/components/shell/account-page";
import { RetryButton } from "@/components/shell/staff-panel";
import { loadErrorMessage, useAsync } from "@/components/use-async";
import {
  deleteMailTemplate,
  discardMail,
  fetchMailOverview,
  submitMail,
  withdrawMail,
  type ArtistMail,
  type MailOverview,
  type MailProfile,
} from "@/features/artist-mail/api";
import { fetchMyProfiles, type CatalogProfile } from "@/features/studio/api";
import { ApiError } from "@/lib/api/client";
import { audienceLine, MAIL_STATUS_LABEL, sentLine } from "@/lib/artist-mail-view";

function MailRow({ mail, onEdit, onChanged }: { mail: ArtistMail; onEdit: () => void; onChanged: (note: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(job: () => Promise<unknown>, note: string) {
    setBusy(true);
    setError(null);
    try {
      await job();
      onChanged(note);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That didn't go through. Try again.");
      setBusy(false);
    }
  }

  const progress = sentLine(mail);
  return (
    <li className="cr-glass-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-base font-bold text-fg">{mail.subject}</span>
        <span className="text-sm font-semibold text-highlight">{MAIL_STATUS_LABEL[mail.status] ?? mail.status}</span>
      </div>
      <p className="mt-1 text-sm text-fg-muted">{audienceLine(mail.audience)}</p>
      {progress ? <p className="mt-1 text-sm text-fg">{progress}</p> : null}
      {mail.review_note ? (
        <p className="mt-2 text-sm text-fg">
          <span className="font-semibold">Corner Room asked for a change:</span> {mail.review_note}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
      {mail.status === "DRAFT" || mail.status === "IN_REVIEW" ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {mail.status === "DRAFT" ? (
            <>
              <Button size="sm" variant="secondary" onClick={onEdit} disabled={busy}>
                <PenLine aria-hidden="true" /> Edit
              </Button>
              <Button size="sm" busy={busy} onClick={() => void act(() => submitMail(mail.id), "Sent to Corner Room. It goes out once it is approved.")}>
                Send for review
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act(() => discardMail(mail.id), "Draft thrown away.")}>
                <Trash2 aria-hidden="true" /> Throw away
              </Button>
            </>
          ) : (
            <Button size="sm" variant="secondary" busy={busy} onClick={() => void act(() => withdrawMail(mail.id), "Taken back. It is a draft again.")}>
              <Undo2 aria-hidden="true" /> Take back
            </Button>
          )}
        </div>
      ) : null}
    </li>
  );
}

function ProfileMailBody({ data, reload }: { data: MailOverview; reload: () => void }) {
  const profile: MailProfile = { kind: data.profile.kind, id: data.profile.id };
  const artist = data.profile.display_name;
  // undefined: the composer is closed; null: a new email.
  const [composing, setComposing] = useState<ComposerStart | undefined>(undefined);
  const [note, setNote] = useState<string | null>(null);

  const done = (text: string) => {
    setComposing(undefined);
    setNote(text);
    reload();
  };

  return (
    <div className="mt-4 grid gap-6">
      <ThankYouCard profile={profile} artist={artist} initial={data.thank_you} />

      <Card as="section" aria-labelledby={`write-${profile.id}`} className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 id={`write-${profile.id}`} className="flex items-center gap-2 text-lg font-bold text-fg">
              <Mail aria-hidden="true" className="size-5 text-highlight" /> Emails to buyers
            </h3>
            <p className="mt-1 max-w-2xl text-sm text-fg-muted">
              Corner Room checks each email before it goes. Every one has a link to stop your emails
              {data.stopped_count ? `; ${data.stopped_count} ${data.stopped_count === 1 ? "buyer has" : "buyers have"} used it` : ""}.
              {data.weekly_limit ? ` You can send ${data.weekly_limit} in 7 days.` : ""}
            </p>
          </div>
          {composing === undefined ? (
            <Button size="sm" onClick={() => setComposing(null)}>
              <Plus aria-hidden="true" /> Write an email
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setComposing(undefined)}>
              Close
            </Button>
          )}
        </div>
        {note ? (
          <p role="status" className="mt-3 text-sm text-fg">
            {note}
          </p>
        ) : null}
        {composing !== undefined ? (
          <div className="mt-5 border-t border-line pt-5">
            <MailComposer
              key={composing?.draft?.id ?? composing?.template?.id ?? "new"}
              profile={profile}
              artist={artist}
              start={composing}
              onDone={done}
            />
          </div>
        ) : null}
        {data.mails.length ? (
          <ul className="mt-5 grid gap-3">
            {data.mails.map((m) => (
              <MailRow key={`${m.id}|${m.status}`} mail={m} onEdit={() => setComposing({ draft: m })} onChanged={done} />
            ))}
          </ul>
        ) : composing === undefined ? (
          <p className="mt-4 text-sm text-fg">No emails yet.</p>
        ) : null}
      </Card>

      <Card as="section" aria-labelledby={`templates-${profile.id}`} className="p-5">
        <h3 id={`templates-${profile.id}`} className="text-lg font-bold text-fg">
          Saved templates
        </h3>
        {data.templates.length === 0 ? (
          <p className="mt-2 text-sm text-fg-muted">Write an email and give it a template name to keep it, with who it goes to, for next time.</p>
        ) : (
          <ul className="mt-3 grid gap-2">
            {data.templates.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-2">
                <span>
                  <span className="block font-semibold text-fg">{t.name}</span>
                  <span className="block text-sm text-fg-muted">
                    {t.subject} · {audienceLine(t.audience)}
                  </span>
                </span>
                <span className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setComposing({ template: t })}>
                    Use
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Delete template ${t.name}`}
                    onClick={() =>
                      void deleteMailTemplate(t.id)
                        .then(() => done(`Template "${t.name}" deleted.`))
                        .catch(() => setNote(`Template "${t.name}" couldn't be deleted. Try again.`))
                    }
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function ProfileMail({ profile }: { profile: CatalogProfile }) {
  const kind = profile.kind as "artist" | "band";
  const overview = useAsync(() => fetchMailOverview({ kind, id: profile.id }), [kind, profile.id]);
  return (
    <section aria-labelledby={`mail-${profile.id}`} className="mt-12 first:mt-0">
      <p className="cr-eyebrow text-highlight">{kind === "band" ? "Band" : "Artist"}</p>
      <h2 id={`mail-${profile.id}`} className="mt-1 text-2xl font-bold text-fg">
        {profile.display_name}
      </h2>
      {overview.status === "loading" ? (
        <Skeleton className="mt-4 h-48 w-full" />
      ) : overview.status === "error" ? (
        <div className="mt-4">
          <ErrorState title="Emails unavailable" message={loadErrorMessage(overview.error, "your emails")} action={<RetryButton onClick={overview.reload} />} />
        </div>
      ) : (
        <ProfileMailBody data={overview.data} reload={overview.reload} />
      )}
    </section>
  );
}

function Emails() {
  const profiles = useAsync(() => fetchMyProfiles(), []);
  if (profiles.status === "loading") return <Skeleton className="h-48 w-full" />;
  if (profiles.status === "error") {
    return <ErrorState title="Emails unavailable" message={loadErrorMessage(profiles.error, "your profiles")} action={<RetryButton onClick={profiles.reload} />} />;
  }
  if (profiles.data.length === 0) {
    return <EmptyState title="No artist or band profile yet" body="Emails are for the artist and band profiles you publish for in Studio." />;
  }
  return (
    <div>
      <p className="flex max-w-2xl items-start gap-2 text-sm text-fg">
        <Mail aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-highlight" />
        Thank the people who buy your music and tell them what&apos;s new. Corner Room sends every email from &quot;your name via Corner Room&quot;. You
        see buyers&apos; names, never their email addresses.
      </p>
      <div className="mt-8">
        {profiles.data.map((p) => (
          <ProfileMail key={`${p.kind}-${p.id}`} profile={p} />
        ))}
      </div>
    </div>
  );
}

export default function StudioEmailsPage() {
  return (
    <AccountPage
      audience="artist"
      eyebrow="Studio"
      title="Gifts"
      what="your emails"
      actions={
        <ButtonLink href="/studio" variant="secondary">
          <ArrowLeft aria-hidden="true" /> Studio home
        </ButtonLink>
      }
    >
      <GiftTabs current="emails" />
      <Emails />
    </AccountPage>
  );
}
