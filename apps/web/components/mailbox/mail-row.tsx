"use client";

/* One email to buyers in the Mailbox (owner, 2026-11-02, D-MAIL-01; moved 2026-11-09, D-MAILBOX-01):
 * its state, who it goes to, and the one or two things that can be done with it now (edit, send for
 * review, take back, results, copy). Corner Room checks every email to buyers before it goes. */

import { useState } from "react";
import { ChartNoAxesColumn, Copy, PenLine, SendHorizontal, Trash2, Undo2 } from "lucide-react";

import { OneMailReport } from "@/components/artist-mail/mail-reports";
import { Button } from "@/components/ds";
import { StatusMark } from "@/components/studio-kit";
import { copyMail, discardMail, fullAudience, submitMail, withdrawMail, type ArtistMail } from "@/features/artist-mail/api";
import { ApiError } from "@/lib/api/client";
import { OCCASION_LABEL } from "@/lib/artist-mail-starters";
import { audienceLine, MAIL_STATUS_LABEL, sentLine, whenLine } from "@/lib/artist-mail-view";
import type { StatusTone } from "@/lib/format/status";

const TONE: Record<string, StatusTone> = { DRAFT: "neutral", IN_REVIEW: "info", SCHEDULED: "accent", SENDING: "info", SENT: "positive" };

export function MailRow({ mail, onEdit, onChanged }: { mail: ArtistMail; onEdit: () => void; onChanged: (note: string) => void }) {
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
    <li className="gs-card cr-cut cr-glass-card">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-base font-bold text-fg">{mail.subject}</span>
        <span className="text-sm"><StatusMark tone={TONE[mail.status] ?? "neutral"}>{MAIL_STATUS_LABEL[mail.status] ?? mail.status}</StatusMark></span>
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
              <SendHorizontal aria-hidden="true" /> Send for review
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
