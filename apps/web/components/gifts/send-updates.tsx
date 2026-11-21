"use client";

/*
 * Send update (owner, 2026-11-20, D-CAMPAIGN-08). Marking a gift Dispatched, Returned or Missing
 * emails nobody. This panel says how many buyers in each of those statuses haven't been told yet,
 * and its button opens a check first: the email in use (the act's approved words or Corner Room's)
 * as the first of them will read it, and how many will get it. Only "Email them now" sends. Words
 * that greet one buyer by a typed-out name are stopped here and on the server.
 */

import { useEffect, useState } from "react";
import { CircleAlert, Send } from "lucide-react";

import { MailPreview } from "@/components/artist-mail/mail-preview";
import { Button, Card } from "@/components/ds";
import { Dialog } from "@/components/ds/dialog";
import { fetchStatusMails, sendStatusUpdate, type GiftCampaignDetail, type StatusMails, type StatusMailStatus } from "@/features/gifts/api";
import { ApiError } from "@/lib/api/client";
import {
  inUseLabel,
  namesLine,
  namesWrittenOut,
  previewValues,
  sendingVersion,
  STATUS_MAIL_TAB,
  updateButtonLabel,
  updateSentLine,
  updatesWaitingLine,
} from "@/lib/gift-status-mail-view";

export const UPDATE_STATUSES: StatusMailStatus[] = ["DISPATCHED", "RETURNED", "MISSING"];

export type UpdateAsk = { status: StatusMailStatus; ids?: string[] };

/** The buyers an update reaches: waiting to be told, in this status, and among the chosen ones if any. */
export function waitingFor(c: GiftCampaignDetail, ask: UpdateAsk) {
  return c.recipients.filter((r) => r.update_waiting && r.status === ask.status && (!ask.ids || ask.ids.includes(r.id)));
}

export function SendUpdates({
  c,
  onChange,
  ask,
  onAsk,
  onWording,
}: {
  c: GiftCampaignDetail;
  onChange: (next: GiftCampaignDetail) => void;
  /** The update being checked before it sends (opened here or from the chosen-gifts bar). */
  ask: UpdateAsk | null;
  onAsk: (next: UpdateAsk | null) => void;
  /** Open the campaign's Emails part to change the wording. */
  onWording?: () => void;
}) {
  const [mails, setMails] = useState<StatusMails | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!ask) return;
    let live = true;
    setLoadError(null);
    fetchStatusMails(c.id)
      .then((m) => live && setMails(m))
      .catch(() => live && setLoadError("The email couldn't be loaded. Please try again."));
    return () => {
      live = false;
    };
  }, [ask, c.id]);

  if (!c.can_dispatch) return null;
  const waiting = UPDATE_STATUSES.map((s) => ({ status: s, n: c.updates_waiting?.[s] ?? 0 })).filter((w) => w.n > 0);

  const people = ask ? waitingFor(c, ask) : [];
  const item = ask && mails ? mails.items.find((i) => i.status === ask.status) : undefined;
  const version = item ? sendingVersion(item) : null;
  const first = people[0] ?? null;
  const named =
    version && mails
      ? namesWrittenOut(
          version.subject,
          version.body,
          people.map((p) => p.name),
          [mails.artist, mails.campaign.gift_items, mails.music],
        )
      : [];

  async function send() {
    if (!ask) return;
    setBusy(true);
    setMessage(null);
    try {
      const next = await sendStatusUpdate(c.id, ask.status, ask.ids);
      onChange(next);
      setMessage({ ok: true, text: updateSentLine(next.told ?? 0, next.emailed ?? 0) });
      onAsk(null);
    } catch (err) {
      setMessage({ ok: false, text: err instanceof ApiError ? err.message : "That didn't go through. Please try again." });
      onAsk(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {waiting.length ? (
        <Card as="section" aria-labelledby="updates-title" className="grid gap-3 p-5">
          <div>
            <h4 id="updates-title" className="text-base font-bold text-fg">
              Updates to send
            </h4>
            <p className="mt-1 text-sm text-fg-muted">
              Marking a collectible emails nobody. When you&apos;re ready, send each update: you see the email before anyone gets it.
            </p>
          </div>
          <ul className="grid gap-2">
            {waiting.map((w) => (
              <li key={w.status} className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm text-fg">{updatesWaitingLine(w.status, w.n)}</span>
                <Button size="sm" className="sk-gloss cr-cut" onClick={() => onAsk({ status: w.status })}>
                  <Send aria-hidden="true" /> {updateButtonLabel(w.status)}
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {message ? (
        <p role={message.ok ? "status" : "alert"} className="gm-banner" data-tone={message.ok ? "success" : "problem"}>
          {message.ok ? null : <CircleAlert aria-hidden="true" className="size-4" />} {message.text}
        </p>
      ) : null}
      <Dialog
        open={ask !== null}
        onClose={() => onAsk(null)}
        title={ask ? updateButtonLabel(ask.status) : ""}
        description={
          ask
            ? people.length
              ? `${people.length} ${people.length === 1 ? "buyer gets" : "buyers get"} this email now${people.length <= 3 ? `: ${namesLine(people.map((p) => p.name ?? ""))}` : ""}. Each reads their own name.`
              : `Nobody marked ${STATUS_MAIL_TAB[ask.status].toLowerCase()} is waiting to be told.`
            : null
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => onAsk(null)}>
              Not now
            </Button>
            <Button className="sk-gloss cr-cut" busy={busy} disabled={!version || named.length > 0 || people.length === 0} onClick={() => void send()}>
              <Send aria-hidden="true" /> Email {people.length === 1 ? "them" : `these ${people.length}`} now
            </Button>
          </>
        }
      >
        {loadError ? (
          <p role="alert" className="text-sm text-danger">
            {loadError}
          </p>
        ) : !item || !version || !mails ? (
          <p className="text-sm text-fg-muted">Loading the email…</p>
        ) : (
          <div className="grid gap-3">
            <p className="text-sm text-fg-muted">
              {inUseLabel(item)}
              {first?.name ? `, as ${first.name} will read it` : ""}.
            </p>
            {named.length ? (
              <p role="alert" className="gm-banner" data-tone="problem">
                <CircleAlert aria-hidden="true" className="size-4" /> This email greets {namesLine(named)} by name, so every buyer would read
                that name. Change it to the First name fill-in in the Emails part, or go back to Corner Room&apos;s wording, then send.
              </p>
            ) : null}
            <MailPreview
              artist={mails.artist}
              subject={version.subject}
              body={version.body}
              values={previewValues(first ? { name: first.name ?? null } : null, mails.artist, mails.music)}
              kind="GIFT_UPDATE"
              button={version.button_label && version.button_url ? { label: version.button_label, url: version.button_url } : null}
            />
            {onWording ? (
              <button
                type="button"
                className="cr-focus justify-self-start text-sm font-semibold text-link underline"
                onClick={() => {
                  onAsk(null);
                  onWording();
                }}
              >
                Change the wording first
              </button>
            ) : null}
          </div>
        )}
      </Dialog>
    </>
  );
}
