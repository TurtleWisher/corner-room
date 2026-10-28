"use client";

/*
 * One gift campaign (owner, 2026-10-28, D-CAMPAIGN-02): how many gifts are sent, in process and yet
 * to send; the buyers who earned it; dispatching (each buyer is emailed that it is on its way) and
 * marking sent; pausing, restarting and changing it (changes to a live campaign wait for Corner
 * Room). Who sees buyers' details and who may dispatch is decided by the API.
 */

import { useParams } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, CircleAlert, Pause, Play, Send, Truck, Undo2 } from "lucide-react";

import { Button, ButtonLink, Card, DateTime, ErrorState, Skeleton } from "@/components/ds";
import { CampaignForm } from "@/components/gifts/campaign-form";
import { AccountPage } from "@/components/shell/account-page";
import { RetryButton } from "@/components/shell/staff-panel";
import { loadErrorMessage, useAsync } from "@/components/use-async";
import {
  dispatchGifts,
  fetchGiftCampaign,
  markGiftsSent,
  pauseGiftCampaign,
  resumeGiftCampaign,
  submitGiftCampaign,
  updateGiftCampaign,
  withdrawGiftCampaign,
  type GiftCampaignDetail,
} from "@/features/gifts/api";
import { ApiError } from "@/lib/api/client";
import { actionable, CAMPAIGN_STATUS_LABEL, RECIPIENT_STATUS_LABEL, SENDER_LABEL, worksLine } from "@/lib/gifts-view";

function Tiles({ c }: { c: GiftCampaignDetail }) {
  const tiles = [
    { label: "Yet to send", value: c.counts.YET_TO_SEND },
    { label: "In process", value: c.counts.IN_PROCESS },
    { label: "Sent", value: c.counts.SENT },
    { label: "Everyone who earned it", value: c.counts.TOTAL },
  ];
  return (
    <dl className="grid gap-3 sm:grid-cols-4">
      {tiles.map((t) => (
        <Card key={t.label} className="p-4">
          <dt className="text-sm text-fg-muted">{t.label}</dt>
          <dd className="cr-num mt-1 text-3xl font-bold text-fg">{t.value}</dd>
        </Card>
      ))}
    </dl>
  );
}

function Campaign({ id }: { id: string }) {
  const data = useAsync(() => fetchGiftCampaign(id), [id]);
  const [override, setOverride] = useState<GiftCampaignDetail | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  if (data.status === "loading") return <Skeleton className="h-64 w-full" />;
  if (data.status === "error") {
    return <ErrorState title="Campaign unavailable" message={loadErrorMessage(data.error, "this campaign")} action={<RetryButton onClick={data.reload} />} />;
  }
  const c = override ?? data.data;

  async function run(key: string, fn: () => Promise<GiftCampaignDetail>) {
    setBusy(key);
    setError(null);
    try {
      setOverride(await fn());
      setChosen(new Set());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That didn't go through. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  const toDispatch = actionable(c.recipients, chosen, "dispatch");
  const toSend = actionable(c.recipients, chosen, "sent");
  const allIds = c.recipients.map((r) => r.id);
  const pick = (rid: string) => setChosen((s) => (s.has(rid) ? new Set([...s].filter((x) => x !== rid)) : new Set([...s, rid])));

  return (
    <div className="grid gap-6">
      <div>
        <p className="text-sm font-semibold text-highlight">{CAMPAIGN_STATUS_LABEL[c.status] ?? c.status}</p>
        <h2 className="mt-1 text-2xl font-bold text-fg">{c.title}</h2>
        <p className="mt-1 text-sm text-fg">
          {c.gift_items} · {worksLine(c.works)} · {SENDER_LABEL[c.sender]}
          {c.include_presale ? " · pre-sale buyers included" : ""}
        </p>
        {c.description ? <p className="mt-2 max-w-2xl text-sm text-fg-muted">{c.description}</p> : null}
      </div>

      {c.review_note ? (
        <p className="flex items-start gap-2 text-sm text-danger">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" /> Corner Room asked for changes: {c.review_note}
        </p>
      ) : null}
      {c.status === "IN_REVIEW" ? <p className="text-sm text-fg">Waiting for Corner Room to check this campaign. Fans don&apos;t see it yet.</p> : null}
      {c.pending ? <p className="text-sm text-fg">Your changes are waiting for Corner Room. The campaign keeps running as it was until then.</p> : null}

      <div className="flex flex-wrap gap-2">
        {c.status === "DRAFT" ? (
          <Button size="sm" busy={busy === "submit"} onClick={() => void run("submit", () => submitGiftCampaign(c.id))}>
            <Send aria-hidden="true" /> Send to Corner Room to go live
          </Button>
        ) : null}
        {c.status === "ACTIVE" ? (
          <Button size="sm" variant="secondary" busy={busy === "pause"} onClick={() => void run("pause", () => pauseGiftCampaign(c.id))}>
            <Pause aria-hidden="true" /> Pause
          </Button>
        ) : null}
        {c.status === "PAUSED" ? (
          <Button size="sm" variant="secondary" busy={busy === "resume"} onClick={() => void run("resume", () => resumeGiftCampaign(c.id))}>
            <Play aria-hidden="true" /> Restart
          </Button>
        ) : null}
        {c.status === "IN_REVIEW" || c.pending ? (
          <Button size="sm" variant="ghost" busy={busy === "withdraw"} onClick={() => void run("withdraw", () => withdrawGiftCampaign(c.id))}>
            <Undo2 aria-hidden="true" /> Take back
          </Button>
        ) : null}
        {c.status !== "IN_REVIEW" && c.status !== "ENDED" ? (
          <Button size="sm" variant="ghost" onClick={() => setEditing(!editing)}>
            {editing ? "Close" : c.status === "DRAFT" ? "Edit" : "Change (Corner Room checks it)"}
          </Button>
        ) : null}
      </div>
      {editing ? (
        <Card className="p-5">
          <CampaignForm
            profile={{ kind: c.profile.kind, id: c.profile.id }}
            initial={c}
            submitLabel={c.status === "DRAFT" ? "Save" : "Send changes for review"}
            onSave={async (body) => {
              setOverride(await updateGiftCampaign(c.id, body));
              setEditing(false);
            }}
          />
        </Card>
      ) : null}

      {c.status !== "DRAFT" && c.status !== "IN_REVIEW" ? (
        <>
          <Tiles c={c} />
          <section aria-labelledby="recipients-title">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 id="recipients-title" className="text-lg font-bold text-fg">
                Who gets it
              </h3>
              {c.can_dispatch ? (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" disabled={!toDispatch.length} busy={busy === "dispatch"} onClick={() => void run("dispatch", () => dispatchGifts(c.id, toDispatch))}>
                    <Truck aria-hidden="true" /> Dispatch {toDispatch.length || ""} and email them
                  </Button>
                  <Button size="sm" variant="secondary" disabled={!toSend.length} busy={busy === "sent"} onClick={() => void run("sent", () => markGiftsSent(c.id, toSend))}>
                    Mark {toSend.length || ""} as sent
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-fg-muted">Corner Room&apos;s team sends these gifts and keeps this list up to date.</p>
              )}
            </div>
            {c.can_dispatch ? (
              <p className="mt-1 text-sm text-fg-muted">
                Dispatching tells each buyer by email that their gift is on its way and should reach them in the next few days.
              </p>
            ) : null}
            {c.recipients.length === 0 ? (
              <p className="mt-3 text-sm text-fg">No one has earned this gift yet. Buyers appear here once their payment is confirmed.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[40rem] text-left text-sm">
                  <thead className="text-xs text-fg-muted">
                    <tr className="border-b border-line">
                      {c.can_dispatch ? (
                        <th className="py-2 pr-3">
                          <input
                            type="checkbox"
                            aria-label="Choose everyone"
                            checked={chosen.size === allIds.length && allIds.length > 0}
                            onChange={(e) => setChosen(e.target.checked ? new Set(allIds) : new Set())}
                          />
                        </th>
                      ) : null}
                      <th className="py-2 pr-3 font-semibold">Buyer</th>
                      {c.shows_contact ? <th className="py-2 pr-3 font-semibold">Phone</th> : null}
                      {c.shows_contact ? <th className="py-2 pr-3 font-semibold">Address</th> : null}
                      <th className="py-2 pr-3 font-semibold">Gift</th>
                      <th className="py-2 font-semibold">Since</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.recipients.map((r, i) => (
                      <tr key={r.id} className="border-b border-line align-top">
                        {c.can_dispatch ? (
                          <td className="py-2 pr-3">
                            <input type="checkbox" aria-label={`Choose ${r.name ?? `buyer ${i + 1}`}`} checked={chosen.has(r.id)} onChange={() => pick(r.id)} />
                          </td>
                        ) : null}
                        <td className="py-2 pr-3 text-fg">
                          {r.name ?? (c.shows_contact ? "No name given" : `Buyer ${i + 1}`)}
                          {r.email ? <span className="block text-xs text-fg-muted">{r.email}</span> : null}
                          {!r.has_account ? <span className="block text-xs text-fg-muted">Pre-sale, no account yet</span> : null}
                        </td>
                        {c.shows_contact ? <td className="py-2 pr-3 text-fg">{r.phone ?? <span className="text-fg-muted">None</span>}</td> : null}
                        {c.shows_contact ? <td className="max-w-72 py-2 pr-3 text-fg">{r.address ?? <span className="text-fg-muted">None</span>}</td> : null}
                        <td className="py-2 pr-3 font-semibold text-fg">{RECIPIENT_STATUS_LABEL[r.status]}</td>
                        <td className="py-2 text-fg-muted">
                          {r.sent_at ? <DateTime value={r.sent_at} format="date" /> : r.dispatched_at ? <DateTime value={r.dispatched_at} format="date" /> : "Not yet"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : null}
      {error ? (
        <p role="alert" className="flex items-center gap-2 text-sm text-danger">
          <CircleAlert aria-hidden="true" className="size-4" /> {error}
        </p>
      ) : null}
    </div>
  );
}

export default function StudioGiftCampaignPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <AccountPage
      audience="artist"
      eyebrow="Studio"
      title="Gift campaign"
      what="this gift campaign"
      actions={
        <ButtonLink href="/studio/gifts" variant="secondary">
          <ArrowLeft aria-hidden="true" /> All gifts
        </ButtonLink>
      }
    >
      <Campaign id={id} />
    </AccountPage>
  );
}
