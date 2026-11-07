"use client";

/*
 * Staff review of a gift campaign's extras, inside the staff console (owner, 2026-11-08: staff
 * links must never open the artist's Studio). Two panels the staff gift queue opens in place:
 *   - the act's own gift status emails waiting for approval (D-CAMPAIGN-05), each shown as the
 *     buyer will read it, with Approve or Send back;
 *   - people the act added by hand, waiting (D-CAMPAIGN-04), through the same panel Studio uses.
 * The API decides who may approve; this only shows and asks.
 */

import { useState } from "react";
import { Check, Undo2 } from "lucide-react";

import { MailPreview } from "@/components/artist-mail/mail-preview";
import { Banner, type Notice } from "@/components/gifts/status-emails";
import { WaitingPeople } from "@/components/gifts/waiting-people";
import { Button } from "@/components/staff/kit";
import { ErrorState, Skeleton } from "@/components/ds";
import { Textarea } from "@/components/ds/input";
import { loadErrorMessage, useAsync } from "@/components/use-async";
import { fetchGiftCampaign, fetchStatusMails, reviewStatusMail, type StatusMail, type StatusMails } from "@/features/gifts/api";
import { friendlyError } from "@/lib/error-copy";
import { STATUS_MAIL_TITLE, previewValues, startingVersion } from "@/lib/gift-status-mail-view";

/** The act's gift status emails waiting for approval, each as a buyer will read it. */
export function StatusMailsReview({ campaignId, onDone }: { campaignId: string; onDone: () => void }) {
  const data = useAsync(() => fetchStatusMails(campaignId), [campaignId]);
  const [override, setOverride] = useState<StatusMails | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  if (data.status === "loading") return <Skeleton className="h-40 w-full" />;
  if (data.status === "error") return <ErrorState title="Emails unavailable" message={loadErrorMessage(data.error, "these emails")} />;
  const mails = override ?? data.data;
  const waiting = mails.items.filter((i) => i.state === "IN_REVIEW");
  return (
    <div className="mt-3 grid gap-4">
      <Banner notice={notice} onClose={() => setNotice(null)} />
      {waiting.length === 0 ? <p className="text-sm text-muted-foreground">No email is waiting for approval now.</p> : null}
      {waiting.map((item) => (
        <WaitingMail
          key={`${item.status}-${item.subject}`}
          campaignId={campaignId}
          mails={mails}
          item={item}
          onReviewed={(next, n) => {
            setOverride(next);
            setNotice(n);
            onDone();
          }}
        />
      ))}
    </div>
  );
}

function WaitingMail({
  campaignId,
  mails,
  item,
  onReviewed,
}: {
  campaignId: string;
  mails: StatusMails;
  item: StatusMail;
  onReviewed: (next: StatusMails, notice: Notice) => void;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const version = startingVersion(item);
  const person = mails.people.find((p) => p.status === item.status && p.reachable) ?? mails.people[0] ?? null;

  async function act(action: "approve" | "reject") {
    setBusy(action);
    setError(null);
    try {
      const next = await reviewStatusMail(campaignId, item.status, action, action === "reject" ? note : undefined);
      onReviewed(next, {
        tone: action === "approve" ? "success" : "info",
        text:
          action === "approve"
            ? `${STATUS_MAIL_TITLE[item.status]}: approved. Buyers get this email from now on. Nobody was emailed just now.`
            : `${STATUS_MAIL_TITLE[item.status]}: sent back to ${mails.artist} with your note.`,
      });
    } catch (err) {
      setError(friendlyError(err, "That review didn't go through."));
      setBusy(null);
    }
  }

  return (
    <section className="rounded border p-4" aria-label={`${STATUS_MAIL_TITLE[item.status]} email waiting for approval`}>
      <p className="font-medium">{STATUS_MAIL_TITLE[item.status]} email, waiting for approval</p>
      <p className="mt-1 text-sm text-muted-foreground">Sent to buyers when their gift is marked {item.status.toLowerCase()}, once approved.</p>
      <div className="mt-3 max-w-2xl">
        <MailPreview
          artist={mails.artist}
          subject={version.subject}
          body={version.body}
          values={previewValues(person, mails.artist, mails.music, mails.campaign.gift_items)}
          kind="GIFT_UPDATE"
          button={version.button_label && version.button_url ? { label: version.button_label, url: version.button_url } : null}
        />
        {version.file_ids.length ? <p className="mt-2 text-sm">With {version.file_ids.length} {version.file_ids.length === 1 ? "file" : "files"} attached.</p> : null}
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <Button disabled={busy !== null} onClick={() => void act("approve")}>
          <Check aria-hidden="true" className="size-4" /> Approve
        </Button>
        <div className="min-w-[16rem] flex-1">
          <Textarea aria-label={`What to change in the ${STATUS_MAIL_TITLE[item.status].toLowerCase()} email`} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What to change (needed to send back)" />
        </div>
        <Button variant="outline" disabled={busy !== null || !note.trim()} onClick={() => void act("reject")}>
          <Undo2 aria-hidden="true" className="size-4" /> Send back
        </Button>
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </section>
  );
}

/** People the act added by hand, waiting: the same panel Studio shows, opened here. */
export function WaitingPeopleReview({ campaignId, onDone }: { campaignId: string; onDone: () => void }) {
  const data = useAsync(() => fetchGiftCampaign(campaignId), [campaignId]);
  const [override, setOverride] = useState<Awaited<ReturnType<typeof fetchGiftCampaign>> | null>(null);
  if (data.status === "loading") return <Skeleton className="h-32 w-full" />;
  if (data.status === "error") return <ErrorState title="People unavailable" message={loadErrorMessage(data.error, "these people")} />;
  const detail = override ?? data.data;
  if (!(detail.waiting ?? []).length) return <p className="mt-3 text-sm text-muted-foreground">Nobody is waiting now.</p>;
  return (
    <div className="mt-3">
      <WaitingPeople
        c={detail}
        onChange={(next) => {
          setOverride(next);
          onDone();
        }}
      />
    </div>
  );
}
