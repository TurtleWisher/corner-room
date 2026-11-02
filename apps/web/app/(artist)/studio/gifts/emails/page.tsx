"use client";

/* Studio > Gifts > Emails (owner, 2026-11-02, D-MAIL-01 and D-MAIL-02): each profile's thank-you
 * emails for each audience, emails to buyers (Corner Room checks each one before it goes, now or at
 * a chosen time), saved templates, files for gifts, and a report. Buyers are names only. */

import { useEffect, useState } from "react";
import { ArrowLeft, ChartNoAxesColumn, Copy, Mail, PenLine, Plus, Trash2, Undo2 } from "lucide-react";

import { MailComposer, type ComposerStart } from "@/components/artist-mail/mail-composer";
import { ActMailReport, OneMailReport } from "@/components/artist-mail/mail-reports";
import { ThankYouSection } from "@/components/artist-mail/thank-you-section";
import { Segmented } from "@/components/artist-mail/audience-builder";
import { Button, ButtonLink, Card, EmptyState, ErrorState, Skeleton } from "@/components/ds";
import { GiftTabs } from "@/components/gifts/gift-tabs";
import { AccountPage } from "@/components/shell/account-page";
import { RetryButton } from "@/components/shell/staff-panel";
import { loadErrorMessage, useAsync } from "@/components/use-async";
import {
  copyMail,
  deleteMailTemplate,
  discardMail,
  fetchMailOverview,
  fullAudience,
  submitMail,
  withdrawMail,
  type ArtistMail,
  type MailFile,
  type MailOverview,
  type MailProfile,
} from "@/features/artist-mail/api";
import { fetchMyProfiles, fetchProfileReleases, type CatalogProfile, type ReleaseCard } from "@/features/studio/api";
import { ApiError } from "@/lib/api/client";
import { OCCASION_LABEL } from "@/lib/artist-mail-starters";
import { audienceLine, MAIL_STATUS_LABEL, sentLine, whenLine } from "@/lib/artist-mail-view";

function MailRow({ mail, onEdit, onChanged }: { mail: ArtistMail; onEdit: () => void; onChanged: (note: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState(false);

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
  const sent = mail.status === "SENDING" || mail.status === "SENT";
  return (
    <li className="cr-glass-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-base font-bold text-fg">{mail.subject}</span>
        <span className="text-sm font-semibold text-highlight">{MAIL_STATUS_LABEL[mail.status] ?? mail.status}</span>
      </div>
      <p className="mt-1 text-sm text-fg-muted">
        {[mail.occasion ? OCCASION_LABEL[mail.occasion] : null, audienceLine(fullAudience(mail.audience))].filter(Boolean).join(" · ")}
      </p>
      {mail.send_at && !sent ? <p className="mt-1 text-sm text-fg">Goes out {whenLine(mail.send_at)} once approved.</p> : null}
      {mail.status === "SCHEDULED" && mail.send_at ? <p className="mt-1 text-sm text-fg">Approved. Goes out {whenLine(mail.send_at)}.</p> : null}
      {mail.send_with_release_id && !sent ? (
        <p className="mt-1 text-sm text-fg">
          {mail.status === "SCHEDULED" ? "Approved. " : ""}Goes to pre-order buyers when the release comes out. Change it in the release&apos;s Pre-sale section.
        </p>
      ) : null}
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
        ) : null}
        {mail.status === "IN_REVIEW" || mail.status === "SCHEDULED" ? (
          <Button size="sm" variant="secondary" busy={busy} onClick={() => void act(() => withdrawMail(mail.id), "Taken back. It is a draft again.")}>
            <Undo2 aria-hidden="true" /> Take back
          </Button>
        ) : null}
        {sent ? (
          <Button size="sm" variant="secondary" onClick={() => setReport(!report)} aria-expanded={report}>
            <ChartNoAxesColumn aria-hidden="true" /> {report ? "Hide results" : "Results"}
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act(() => copyMail(mail.id), "Copied into a new draft.")}>
          <Copy aria-hidden="true" /> Copy
        </Button>
      </div>
      {report ? <OneMailReport mailId={mail.id} /> : null}
    </li>
  );
}

function ProfileMailBody({ data, reload, releases, view }: { data: MailOverview; reload: () => void; releases: ReleaseCard[]; view: "write" | "report" }) {
  const profile: MailProfile = { kind: data.profile.kind, id: data.profile.id };
  const artist = data.profile.display_name;
  const voice = profile.kind === "band" ? "we" : "I";
  // undefined: the composer is closed; null: a new email.
  const [composing, setComposing] = useState<ComposerStart | undefined>(undefined);
  const [note, setNote] = useState<string | null>(null);
  const [files, setFiles] = useState<MailFile[]>(data.files);
  useEffect(() => setFiles(data.files), [data.files]);

  const done = (text: string) => {
    setComposing(undefined);
    setNote(text);
    reload();
  };
  const shared = { profile, artist, voice, releases, files, onFiles: setFiles, fileMaxBytes: data.file_max_bytes } as const;

  if (view === "report") {
    return (
      <Card as="section" aria-label={`Email report for ${artist}`} className="mt-4 p-5">
        <ActMailReport profile={profile} />
      </Card>
    );
  }

  return (
    <div className="mt-4 grid gap-6">
      <ThankYouSection {...shared} thankYous={data.thank_yous} onChanged={reload} />

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
            <MailComposer key={composing?.draft?.id ?? composing?.template?.id ?? "new"} {...shared} start={composing} onDone={done} />
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
          <p className="mt-2 text-sm text-fg-muted">Write an email and give it a template name to keep it, with who it goes to and its files, for next time.</p>
        ) : (
          <ul className="mt-3 grid gap-2">
            {data.templates.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-2">
                <span>
                  <span className="block font-semibold text-fg">{t.name}</span>
                  <span className="block text-sm text-fg-muted">
                    {t.subject} · {audienceLine(fullAudience(t.audience))}
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

function ProfileMail({ profile, view }: { profile: CatalogProfile; view: "write" | "report" }) {
  const kind = profile.kind as "artist" | "band";
  const overview = useAsync(() => fetchMailOverview({ kind, id: profile.id }), [kind, profile.id]);
  const releases = useAsync(() => fetchProfileReleases(kind, profile.id), [kind, profile.id]);
  return (
    <section aria-labelledby={`mail-${profile.id}`} className="mt-12 first:mt-0">
      <p className="cr-eyebrow text-highlight">{kind === "band" ? "Band" : "Artist"}</p>
      <h2 id={`mail-${profile.id}`} className="mt-1 text-2xl font-bold text-fg">
        {profile.display_name}
      </h2>
      {overview.status === "loading" || releases.status === "loading" ? (
        <Skeleton className="mt-4 h-48 w-full" />
      ) : overview.status === "error" ? (
        <div className="mt-4">
          <ErrorState title="Emails unavailable" message={loadErrorMessage(overview.error, "your emails")} action={<RetryButton onClick={overview.reload} />} />
        </div>
      ) : (
        <ProfileMailBody data={overview.data} reload={overview.reload} releases={releases.status === "ok" ? releases.data : []} view={view} />
      )}
    </section>
  );
}

function Emails() {
  const profiles = useAsync(() => fetchMyProfiles(), []);
  const [view, setView] = useState<"write" | "report">("write");
  if (profiles.status === "loading") return <Skeleton className="h-48 w-full" />;
  if (profiles.status === "error") {
    return <ErrorState title="Emails unavailable" message={loadErrorMessage(profiles.error, "your profiles")} action={<RetryButton onClick={profiles.reload} />} />;
  }
  if (profiles.data.length === 0) {
    return <EmptyState title="No artist or band profile yet" body="Emails are for the artist and band profiles you publish for in Studio." />;
  }
  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <p className="flex max-w-2xl items-start gap-2 text-sm text-fg">
          <Mail aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-highlight" />
          Thank the people who buy your music and tell them what&apos;s new. Corner Room sends every email from &quot;your name via Corner Room&quot;. You see
          buyers&apos; names, never their email addresses.
        </p>
        <Segmented<"write" | "report">
          label="Show"
          value={view}
          options={{ write: "Write and send", report: "Report" }}
          onChange={setView}
        />
      </div>
      <div className="mt-8">
        {profiles.data.map((p) => (
          <ProfileMail key={`${p.kind}-${p.id}`} profile={p} view={view} />
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

