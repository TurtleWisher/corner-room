"use client";

/* The act's own collectible status emails for one gift campaign (owner, 2026-11-07, D-CAMPAIGN-05).
 * One card per status that emails the buyer (Dispatched, Returned, Missing): what sends now, the
 * artist-email editor with fill-ins (the gift too), send for review, and back to Corner Room's
 * wording. Staff approve or send back here. They always send, whatever the buyer's email choices:
 * they're about a gift the buyer is owed. Every state comes from the API. */

import { useState } from "react";
import { Check, CircleAlert, PenLine, RotateCcw, Send, Undo2 } from "lucide-react";

import { RichEditor } from "@/components/artist-mail/rich-editor";
import { Button, Card, ErrorState, Skeleton } from "@/components/ds";
import { Textarea } from "@/components/ds/input";
import { RetryButton } from "@/components/shell/staff-panel";
import { loadErrorMessage, useAsync } from "@/components/use-async";
import {
  fetchStatusMails,
  resetStatusMail,
  reviewStatusMail,
  saveStatusMail,
  submitStatusMail,
  type StatusMail,
  type StatusMails,
} from "@/features/gifts/api";
import { ALL_FILL_KEYS, GIFT_UPDATE_FILL_INS, plainText, unfilledMarks, unknownFillIns, type MailValues } from "@/lib/artist-mail-view";
import { friendlyError } from "@/lib/error-copy";
import {
  STATE_LABEL,
  STATUS_MAIL_TITLE,
  STATUS_MAIL_WHEN,
  previewValues,
  sendingLine,
  sendingWords,
  sentCountLine,
  startingWords,
} from "@/lib/gift-status-mail-view";

export function StatusEmails({ campaignId }: { campaignId: string }) {
  const data = useAsync(() => fetchStatusMails(campaignId), [campaignId]);
  const [override, setOverride] = useState<StatusMails | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  if (data.status === "loading") return <Skeleton className="h-64 w-full" />;
  if (data.status === "error") {
    return <ErrorState title="Emails unavailable" message={loadErrorMessage(data.error, "these emails")} action={<RetryButton onClick={data.reload} />} />;
  }
  const mails = override && override.campaign.id === campaignId ? override : data.data;
  const values = previewValues(mails.artist, mails.music, mails.campaign.gift_items);
  return (
    <div className="grid gap-4">
      <p className="text-sm text-fg-muted">
        These go to every buyer of this campaign when their gift moves, from &quot;{mails.artist} via Corner Room&quot;. They always send, even to
        buyers who stopped your other emails, because they&apos;re about a gift the buyer is owed. Corner Room checks your words once before they
        replace ours.
      </p>
      <p role="status" className="text-sm font-semibold text-fg empty:hidden">
        {notice}
      </p>
      {mails.items.map((item) => (
        <StatusMailCard
          key={`${item.status}-${item.state}-${item.subject}`}
          campaignId={campaignId}
          item={item}
          values={values}
          onChanged={(next, message) => {
            setOverride(next);
            setNotice(`${STATUS_MAIL_TITLE[item.status]}: ${message}`);
          }}
        />
      ))}
    </div>
  );
}

function StatusMailCard({
  campaignId,
  item,
  values,
  onChanged,
}: {
  campaignId: string;
  item: StatusMail;
  values: MailValues;
  onChanged: (next: StatusMails, message: string) => void;
}) {
  const start = startingWords(item);
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState(start.subject);
  const [body, setBody] = useState(start.body);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(key: string, job: () => Promise<StatusMails>, message: string) {
    setBusy(key);
    setError(null);
    try {
      const next = await job();
      setEditing(false);
      onChanged(next, message);
    } catch (err) {
      setError(friendlyError(err, "That didn't go through. Please try again."));
    } finally {
      setBusy(null);
    }
  }

  const words = sendingWords(item);
  const marks = unfilledMarks(subject + "\n" + body);
  const unknown = unknownFillIns(subject + "\n" + body, ALL_FILL_KEYS);
  const canSubmit = item.state === "DRAFT" || item.state === "RETURNED";

  return (
    <Card tone="solid" className="p-5" aria-labelledby={`sm-${item.status}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id={`sm-${item.status}`} className="text-base font-bold text-fg">
            {STATUS_MAIL_TITLE[item.status]}
          </h3>
          <p className="mt-1 text-sm text-fg-muted">{STATUS_MAIL_WHEN[item.status]}</p>
        </div>
        <div className="text-right text-sm">
          <p className="font-semibold text-highlight">{item.state ? STATE_LABEL[item.state] : "Corner Room's wording"}</p>
          <p className="text-fg-muted">{sentCountLine(item.sent_count)}</p>
        </div>
      </div>

      {item.state === "RETURNED" && item.review_note ? (
        <p className="mt-3 flex items-start gap-2 text-sm text-fg">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-danger" />
          <span>Corner Room asked: {item.review_note}</span>
        </p>
      ) : null}

      {editing ? (
        <div className="mt-4 grid gap-3">
          <RichEditor label="Subject" singleLine value={subject} onChange={setSubject} values={values} fillIns={GIFT_UPDATE_FILL_INS} />
          <RichEditor label="Message" value={body} onChange={setBody} values={values} fillIns={GIFT_UPDATE_FILL_INS} />
          {marks.length ? <p className="text-sm text-fg">Write these parts before sending for review: {marks.join(", ")}</p> : null}
          {unknown.length ? <p className="text-sm text-danger">Not a fill-in: {unknown.join(", ")}</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button
              busy={busy === "save"}
              disabled={!subject.trim() || !body.trim() || unknown.length > 0}
              onClick={() => void run("save", () => saveStatusMail(campaignId, item.status, { subject, body }), "Saved.")}
            >
              <Check aria-hidden="true" /> Save
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setEditing(false);
                setSubject(start.subject);
                setBody(start.body);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-4 border border-line bg-surface-sunken p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-fg-muted">{sendingLine(item)}</p>
          <p className="mt-2 font-semibold text-fg">{plainText(words.subject, values)}</p>
          <p className="mt-1 whitespace-pre-line text-sm text-fg">{plainText(words.body, values)}</p>
          {item.state && item.state !== "APPROVED" && item.subject && item.body ? (
            <div className="mt-4 border-t border-line pt-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Your new words</p>
              <p className="mt-2 font-semibold text-fg">{plainText(item.subject, values)}</p>
              <p className="mt-1 whitespace-pre-line text-sm text-fg">{plainText(item.body, values)}</p>
            </div>
          ) : null}
        </div>
      )}

      {!editing ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {item.state !== "IN_REVIEW" ? (
            <Button variant="secondary" onClick={() => setEditing(true)}>
              <PenLine aria-hidden="true" /> {item.state ? "Edit" : "Write your own"}
            </Button>
          ) : null}
          {canSubmit ? (
            <Button
              busy={busy === "submit"}
              disabled={unfilledMarks((item.subject ?? "") + "\n" + (item.body ?? "")).length > 0}
              onClick={() => void run("submit", () => submitStatusMail(campaignId, item.status), "Sent to Corner Room for review.")}
            >
              <Send aria-hidden="true" /> Send for review
            </Button>
          ) : null}
          {item.state ? (
            <Button
              variant="ghost"
              busy={busy === "reset"}
              onClick={() => void run("reset", () => resetStatusMail(campaignId, item.status), "Back to Corner Room's wording.")}
            >
              <RotateCcw aria-hidden="true" /> Use Corner Room&apos;s wording
            </Button>
          ) : null}
        </div>
      ) : null}

      {item.can_review && !editing ? (
        <div className="mt-5 border-t border-line pt-4">
          <p className="text-sm font-semibold text-fg">Corner Room review</p>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <Button
              busy={busy === "approve"}
              onClick={() => void run("approve", () => reviewStatusMail(campaignId, item.status, "approve"), "Approved. These words send from now on.")}
            >
              <Check aria-hidden="true" /> Approve
            </Button>
            <div className="min-w-[16rem] flex-1">
              <Textarea aria-label="What to change" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What to change" />
            </div>
            <Button
              variant="secondary"
              busy={busy === "reject"}
              disabled={!note.trim()}
              onClick={() => void run("reject", () => reviewStatusMail(campaignId, item.status, "reject", note), "Sent back to the artist.")}
            >
              <Undo2 aria-hidden="true" /> Send back
            </Button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="mt-3 flex items-start gap-2 text-sm text-danger">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      ) : null}
    </Card>
  );
}
