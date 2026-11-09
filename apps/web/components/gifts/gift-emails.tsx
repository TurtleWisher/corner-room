"use client";

/*
 * Every email of one gift campaign, on the campaign's own page (owner, 2026-11-09, D-CAMPAIGN-07:
 * "I can't manage my gift update emails from the collectible section directly"). Three parts:
 *
 *   - How it works, in two lanes: automatic emails (they go by themselves when a gift moves, with
 *     wording Corner Room approved) and emails to buyers you pick (words and people go to Corner
 *     Room together; once approved you press Send). Staff send at once.
 *   - Emails to buyers you pick: write one (people from Collectibles arrive already picked), and
 *     each request's card says where it is, with the one action that fits (Send, Change, Take back;
 *     staff Approve or Send back).
 *   - Automatic emails: the three statuses, what buyers get now, and the editor for each.
 *   - Sent so far: every gift email of this campaign, searchable.
 *
 * Every state comes from the API; the server checks, writes and sends.
 */

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { BellRing, CheckCheck, ChevronDown, Inbox, Mail, PenLine, Plus, Send, Undo2, Users, Workflow } from "lucide-react";

import { MailPreview } from "@/components/artist-mail/mail-preview";
import { Badge, Button, ErrorState, Skeleton } from "@/components/ds";
import { Textarea } from "@/components/ds/input";
import { RetryButton } from "@/components/shell/staff-panel";
import { FilterChips, NoMatch, SearchField, StatusMark } from "@/components/studio-kit";
import { loadErrorMessage, useAsync } from "@/components/use-async";
import {
  deliverGiftSend,
  fetchStatusMails,
  reviewGiftSend,
  withdrawGiftSend,
  type GiftMailSend,
  type StatusMails,
  type StatusMailSent,
  type StatusMailStatus,
} from "@/features/gifts/api";
import { friendlyError } from "@/lib/error-copy";
import { formatDateTime } from "@/lib/format/date";
import { PURPOSE_LABEL, SEND_STATE_LABEL, SEND_STATE_TONE, needsYou, sendStatusLine } from "@/lib/gift-send-view";
import { DELIVERY_WORD, STATUS_MAIL_TAB, anyOnItsWay, inUseLabel, namesLine, previewValues, sendingVersion, subjectForAll } from "@/lib/gift-status-mail-view";
import { searchList, shownCount } from "@/lib/list-search-view";

import { GiftSendComposer } from "./gift-send-composer";
import { AutomaticEmailEditor, Banner, type Notice } from "./status-emails";

const STATUSES: StatusMailStatus[] = ["DISPATCHED", "RETURNED", "MISSING"];
/** While an email is on its way, ask again this often, this many times. */
const POLL_MS = 4000;
const POLL_TIMES = 15;

export function GiftEmails({
  campaignId,
  pick,
  onPicked,
  onCounts,
}: {
  campaignId: string;
  /** People ticked in Collectibles to email: opens the writer with them picked. */
  pick?: { ids: string[]; at: number } | null;
  onPicked?: () => void;
  /** What needs the viewer here, for the page's tab badge. */
  onCounts?: (n: number) => void;
}) {
  const data = useAsync(() => fetchStatusMails(campaignId), [campaignId]);
  const [override, setOverride] = useState<StatusMails | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [writing, setWriting] = useState<{ send?: GiftMailSend; picked?: string[]; key: number } | null>(null);
  const [open, setOpen] = useState<StatusMailStatus | null>(null);
  const polls = useRef(0);
  const mails = override && override.campaign.id === campaignId ? override : data.status === "ok" ? data.data : null;

  useEffect(() => {
    if (!pick?.ids.length) return;
    setWriting({ picked: pick.ids, key: pick.at });
    setNotice(null);
    onPicked?.();
  }, [pick, onPicked]);

  const needs = needsYou(mails?.sends);
  const staffReview = (mails?.sends ?? []).filter((s) => s.can_review).length;
  useEffect(() => {
    onCounts?.(needs.ready + needs.fix + staffReview);
  }, [needs.ready, needs.fix, staffReview, onCounts]);

  // Emails just queued show On its way; ask again until they are Sent (or a minute has passed).
  useEffect(() => {
    if (!mails || !anyOnItsWay(mails.history) || polls.current >= POLL_TIMES) return;
    const timer = window.setTimeout(() => {
      polls.current += 1;
      fetchStatusMails(campaignId)
        .then((next) => setOverride(next))
        .catch(() => undefined);
    }, POLL_MS);
    return () => window.clearTimeout(timer);
  }, [mails, campaignId]);

  if (data.status === "loading" && !mails) return <Skeleton className="h-64 w-full" />;
  if (data.status === "error" && !mails) {
    return <ErrorState title="Emails unavailable" message={loadErrorMessage(data.error, "these emails")} action={<RetryButton onClick={data.reload} />} />;
  }
  if (!mails) return null;
  const live = ["ACTIVE", "PAUSED", "ENDED"].includes(mails.campaign.status);
  const atOnce = Boolean(mails.approves_at_once);
  const changed = (next: StatusMails, n: Notice | null) => {
    polls.current = 0;
    setOverride(next);
    setNotice(n);
  };

  return (
    <div className="grid gap-8">
      <Banner notice={notice} onClose={() => setNotice(null)} />

      {/* How it works, so nobody has to guess what goes where. */}
      <section aria-labelledby="ge-how" className="grid gap-3">
        <h3 id="ge-how" className="sr-only">
          How gift emails work
        </h3>
        <div className="sk-lanes">
          <div className="sk-lane cr-cut">
            <span className="sk-lane-icon cr-cut" aria-hidden="true">
              <Workflow className="size-4" />
            </span>
            <p className="mt-3 font-bold text-fg">Automatic emails</p>
            <p className="mt-1 text-sm text-fg-muted">
              Go by themselves when you mark a gift Dispatched, Returned or Missing. You only write the wording once;{" "}
              {atOnce ? "yours is used at once." : "Corner Room approves it once."}
            </p>
          </div>
          <div className="sk-lane cr-cut">
            <span className="sk-lane-icon cr-cut" aria-hidden="true">
              <Users className="size-4" />
            </span>
            <p className="mt-3 font-bold text-fg">Emails to buyers you pick</p>
            <p className="mt-1 text-sm text-fg-muted">
              {atOnce
                ? "Write it, pick people, press Send. As staff, it goes out at once."
                : "Write it and pick people. Corner Room checks both together; once approved, you press Send."}
            </p>
          </div>
        </div>
      </section>

      {/* Emails to buyers you pick. */}
      <section aria-labelledby="ge-picked" className="grid gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="sk-kicker">To buyers you pick</p>
            <h3 id="ge-picked" className="mt-1 text-xl font-bold text-fg">
              Picked-buyer emails
            </h3>
            {needs.ready || needs.fix ? (
              <p className="mt-1 flex items-center gap-2 text-sm font-semibold text-fg">
                <BellRing aria-hidden="true" className="size-4 text-highlight" />
                {[needs.ready ? `${needs.ready} approved, ready to send` : null, needs.fix ? `${needs.fix} sent back to change` : null].filter(Boolean).join(" · ")}
              </p>
            ) : null}
          </div>
          {live && !writing ? (
            <Button className="sk-gloss cr-cut" onClick={() => setWriting({ key: Date.now() })}>
              <Plus aria-hidden="true" /> Write an email
            </Button>
          ) : null}
        </div>
        {!live ? <p className="text-sm text-fg-muted">You can email buyers once the campaign has been live.</p> : null}
        {writing ? (
          <GiftSendComposer
            key={writing.key}
            mails={mails}
            start={writing}
            onCancel={() => setWriting(null)}
            onDone={(next, n) => {
              if (next !== mails) setWriting(null);
              changed(next, n);
            }}
          />
        ) : null}
        {(mails.sends ?? []).length ? (
          <ul className="grid gap-3">
            {(mails.sends ?? []).map((s) => (
              <SendCard
                key={`${s.id}-${s.state}`}
                mails={mails}
                send={s}
                onEdit={() => setWriting({ send: s, key: Date.now() })}
                onChanged={changed}
                onNotice={setNotice}
              />
            ))}
          </ul>
        ) : !writing && live ? (
          <p className="text-sm text-fg-muted">No emails to picked buyers yet. Tick people in Collectibles and press Email them, or write one here.</p>
        ) : null}
      </section>

      {/* Automatic emails. */}
      <section aria-labelledby="ge-auto" className="grid gap-3">
        <div>
          <p className="sk-kicker">Sent by themselves</p>
          <h3 id="ge-auto" className="mt-1 text-xl font-bold text-fg">
            Automatic emails
          </h3>
        </div>
        <ul className="grid gap-2">
          {STATUSES.map((status) => {
            const item = mails.items.find((i) => i.status === status);
            if (!item) return null;
            const version = sendingVersion(item);
            const isOpen = open === status;
            return (
              <li key={status} className="cr-cut cr-glass-card p-0">
                <button
                  type="button"
                  className="cr-focus flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left"
                  aria-expanded={isOpen}
                  onClick={() => setOpen(isOpen ? null : status)}
                >
                  <span className="min-w-[8rem] font-bold text-fg">When {STATUS_MAIL_TAB[status].toLowerCase()}</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-fg-muted">
                    &ldquo;{subjectForAll(version.subject, mails.artist, mails.music, mails.campaign.gift_items)}&rdquo;
                  </span>
                  <span className="flex items-center gap-2">
                    <Badge tone={item.live ? "positive" : "neutral"}>{inUseLabel(item)}</Badge>
                    {item.state === "IN_REVIEW" ? <Badge tone="info">Changes with Corner Room</Badge> : null}
                    {item.state === "RETURNED" ? <Badge tone="warning">Sent back</Badge> : null}
                    {item.can_review ? <Badge tone="accent">Needs your review</Badge> : null}
                    <ChevronDown aria-hidden="true" className={`size-4 text-fg-muted transition-transform ${isOpen ? "rotate-180" : ""}`} />
                  </span>
                </button>
                {isOpen ? (
                  <div className="sk-appear border-t border-line p-4">
                    <AutomaticEmailEditor
                      key={`${item.status}-${item.state}-${item.subject}-${item.live_subject}`}
                      campaignId={campaignId}
                      mails={mails}
                      item={item}
                      onChanged={(next, n) => changed(next, n ? { ...n, text: `When ${STATUS_MAIL_TAB[status].toLowerCase()}: ${n.text}` } : null)}
                      onNotice={setNotice}
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>

      <SentSoFar mails={mails} />
    </div>
  );
}

function SendCard({
  mails,
  send,
  onEdit,
  onChanged,
  onNotice,
}: {
  mails: StatusMails;
  send: GiftMailSend;
  onEdit: () => void;
  onChanged: (next: StatusMails, notice: Notice | null) => void;
  onNotice: (n: Notice | null) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [showEmail, setShowEmail] = useState(false);
  const [note, setNote] = useState("");
  const campaignId = mails.campaign.id;
  const names = send.recipient_ids.map((id) => mails.people.find((p) => p.id === id)?.name ?? "");
  const first = mails.people.find((p) => p.id === send.recipient_ids[0]) ?? null;
  const staff = mails.viewer_role === "staff";

  async function run(key: string, job: () => Promise<StatusMails>, done: (next: StatusMails) => Notice) {
    setBusy(key);
    onNotice(null);
    try {
      const next = await job();
      onChanged(next, done(next));
    } catch (err) {
      onNotice({ tone: "problem", text: friendlyError(err, "That didn't go through. Nobody was emailed. Please try again.") });
      setBusy(null);
    }
  }

  return (
    <li className="gs-card cr-cut cr-glass-card" data-state={send.state}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
            <StatusMark tone={SEND_STATE_TONE[send.state]}>{SEND_STATE_LABEL[send.state]}</StatusMark>
            <span aria-hidden="true">·</span>
            <span>{PURPOSE_LABEL[send.purpose]}</span>
            {send.sent_at ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{formatDateTime(send.sent_at)}</span>
              </>
            ) : send.submitted_at ? (
              <>
                <span aria-hidden="true">·</span>
                <span>Asked {formatDateTime(send.submitted_at)}</span>
              </>
            ) : null}
          </p>
          <p className="mt-1 truncate text-base font-bold text-fg">
            {subjectForAll(send.subject, mails.artist, mails.music, mails.campaign.gift_items)}
          </p>
          <p className="mt-1 text-sm text-fg">To {namesLine(names)}</p>
          <p className="mt-1 text-sm text-fg-muted">{sendStatusLine(send)}</p>
        </div>
        <button type="button" className="cr-focus text-sm font-semibold text-link underline" aria-expanded={showEmail} onClick={() => setShowEmail((v) => !v)}>
          {showEmail ? "Hide the email" : "See the email"}
        </button>
      </div>

      {showEmail ? (
        <div className="sk-appear mt-3 max-w-2xl">
          <MailPreview
            artist={mails.artist}
            subject={send.subject}
            body={send.body}
            values={previewValues(first, mails.artist, mails.music, mails.campaign.gift_items)}
            kind="GIFT_UPDATE"
            button={send.button_label && send.button_url ? { label: send.button_label, url: send.button_url } : null}
            files={[]}
          />
          {send.file_ids.length ? <p className="mt-2 text-sm text-fg-muted">With {send.file_ids.length} {send.file_ids.length === 1 ? "file" : "files"}.</p> : null}
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {send.state === "APPROVED" ? (
          confirming ? (
            <div className="sk-appear flex flex-wrap items-center gap-2" role="group" aria-label="Check before sending">
              <span className="text-sm font-semibold text-fg">Email {namesLine(names)} now? It can&apos;t be taken back.</span>
              <Button
                size="sm"
                className="sk-gloss cr-cut"
                busy={busy === "send"}
                onClick={() =>
                  void run("send", () => deliverGiftSend(campaignId, send.id), (next) => {
                    const sent = next.sent ?? 0;
                    const skipped = next.skipped ?? 0;
                    return {
                      tone: sent ? "success" : "problem",
                      text: sent
                        ? `Emailed ${sent} ${sent === 1 ? "buyer" : "buyers"}.${skipped ? ` ${skipped} skipped: their gift moved on or they have no email.` : ""}`
                        : "Nobody was emailed: none of them still has a gift in that status or an email address.",
                    };
                  })
                }
              >
                <Send aria-hidden="true" /> Yes, send
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)} disabled={busy !== null}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button size="sm" className="sk-gloss cr-cut" onClick={() => setConfirming(true)}>
              <Send aria-hidden="true" /> Send to {send.recipient_ids.length} {send.recipient_ids.length === 1 ? "buyer" : "buyers"}
            </Button>
          )
        ) : null}
        {send.state === "RETURNED" || (send.state === "IN_REVIEW" && !send.can_review) ? (
          <Button size="sm" variant="secondary" onClick={onEdit} disabled={busy !== null}>
            <PenLine aria-hidden="true" /> Change
          </Button>
        ) : null}
        {send.state !== "SENT" && !send.can_review ? (
          <Button
            size="sm"
            variant="ghost"
            busy={busy === "withdraw"}
            onClick={() => void run("withdraw", () => withdrawGiftSend(campaignId, send.id), () => ({ tone: "info", text: "Taken back. Nobody was emailed." }))}
          >
            <Undo2 aria-hidden="true" /> Take back
          </Button>
        ) : null}
        {send.state === "SENT" && !staff ? (
          <Link href="/studio/mailbox?box=sent" className="cr-focus inline-flex items-center gap-1.5 text-sm font-semibold text-link underline">
            <Inbox aria-hidden="true" className="size-4" /> See each person in your Mailbox
          </Link>
        ) : null}
      </div>

      {send.can_review ? (
        <div className="mt-4 grid gap-2 border-t border-line pt-4">
          <p className="text-sm font-semibold text-fg">Corner Room review: the words and these {send.recipient_ids.length} people together</p>
          <div className="flex flex-wrap items-end gap-2">
            <Button
              size="sm"
              busy={busy === "approve"}
              onClick={() =>
                void run("approve", () => reviewGiftSend(campaignId, send.id, "approve"), () => ({
                  tone: "success",
                  text: "Approved. The artist can send it now. Nobody was emailed yet.",
                }))
              }
            >
              <CheckCheck aria-hidden="true" /> Approve
            </Button>
            <div className="min-w-[14rem] flex-1">
              <Textarea aria-label="What to change" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What to change (needed to send back)" />
            </div>
            <Button
              size="sm"
              variant="secondary"
              busy={busy === "reject"}
              disabled={!note.trim()}
              onClick={() => void run("reject", () => reviewGiftSend(campaignId, send.id, "reject", note), () => ({ tone: "info", text: "Sent back to the artist with your note." }))}
            >
              <Undo2 aria-hidden="true" /> Send back
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

type SentFilter = StatusMailStatus | "OTHER" | "ALL";

/** Every gift email of this campaign to its buyers, newest first, searchable by name. */
function SentSoFar({ mails }: { mails: StatusMails }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<SentFilter>("ALL");
  const history = mails.history ?? [];
  const nameOf = (h: StatusMailSent) => mails.people.find((p) => p.id === h.recipient_id)?.name ?? null;
  const byPurpose = filter === "ALL" ? history : history.filter((h) => h.gift_status === filter);
  const shown = useMemo(() => searchList(byPurpose, query, (h) => [nameOf(h), h.subject]), [byPurpose, query]); // eslint-disable-line react-hooks/exhaustive-deps
  const count = (k: SentFilter) => (k === "ALL" ? history.length : history.filter((h) => h.gift_status === k).length);
  const options = (["ALL", "DISPATCHED", "RETURNED", "MISSING", "OTHER"] as SentFilter[])
    .filter((k) => k === "ALL" || count(k) > 0)
    .map((k) => ({ key: k, label: k === "ALL" ? "All" : k === "OTHER" ? "Other news" : STATUS_MAIL_TAB[k], count: count(k) }));
  return (
    <section aria-labelledby="ge-sent" className="grid gap-3">
      <div>
        <p className="sk-kicker">History</p>
        <h3 id="ge-sent" className="mt-1 flex items-center gap-2 text-xl font-bold text-fg">
          <Mail aria-hidden="true" className="size-5 text-highlight" /> Sent so far
        </h3>
      </div>
      {history.length === 0 ? (
        <p className="text-sm text-fg-muted">No gift emails yet.</p>
      ) : (
        <>
          <FilterChips<SentFilter> label="Show sent emails by kind" options={options} value={filter} onChange={setFilter} />
          <div className="flex flex-wrap items-center gap-3">
            <SearchField className="min-w-[12rem] flex-1" value={query} onChange={setQuery} label="Search sent gift emails" placeholder="Search by buyer or subject" />
            <span className="text-sm text-fg-muted">{shownCount(shown.length, byPurpose.length)}</span>
          </div>
          {query && !shown.length ? (
            <NoMatch query={query} onClear={() => setQuery("")} />
          ) : (
            <ul className="grid">
              {shown.slice(0, 200).map((h, i) => (
                <li key={`${h.recipient_id}-${h.queued_at}-${i}`} className="cr-row flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-line py-2.5 text-sm">
                  <span className="min-w-0">
                    <span className="font-semibold text-fg">{nameOf(h) || "A buyer with no name on file"}</span>
                    <span className="block text-xs text-fg-muted">
                      {h.gift_status === "OTHER" ? "Other news" : STATUS_MAIL_TAB[h.gift_status as StatusMailStatus] ?? h.gift_status}
                      {" · "}
                      {h.send_id ? "picked by you" : "sent by itself"}
                    </span>
                  </span>
                  <span className="flex items-center gap-3 text-xs text-fg-muted">
                    <StatusMark tone={h.state === "SENT" ? "positive" : h.state === "PENDING" ? "info" : "negative"}>{DELIVERY_WORD[h.state]}</StatusMark>
                    <span>{formatDateTime(h.sent_at ?? h.queued_at)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
