"use client";

/*
 * One gift campaign (owner, 2026-10-28, D-CAMPAIGN-02), for the artist and for Corner Room staff.
 * Since 2026-11-09 (D-CAMPAIGN-07) everything about it lives here, in two parts kept in the #hash:
 *   - Collectibles: where every gift is (D-CAMPAIGN-03), adding people (D-CAMPAIGN-04);
 *   - Emails: automatic gift emails, emails to buyers you pick (words and people go to Corner Room
 *     together), and every gift email sent so far.
 * Ticking people in Collectibles and pressing "Email them" opens the Emails part with them picked.
 * Pausing, restarting and changing the campaign stay in the header. Who sees buyers' details and
 * who may update the gifts is decided by the API.
 */

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, CircleAlert, Gift, Inbox, Mail, Package, Pause, PenLine, Play, Send, Undo2, X } from "lucide-react";

import { Button, ButtonLink, Card, ErrorState, Skeleton } from "@/components/ds";
import { Tabs } from "@/components/ds/tabs";
import { CampaignForm } from "@/components/gifts/campaign-form";
import { CollectibleTracking } from "@/components/gifts/collectible-tracking";
import { GiftEmails } from "@/components/gifts/gift-emails";
import { AccountPage } from "@/components/shell/account-page";
import { RetryButton } from "@/components/shell/staff-panel";
import { StatusMark } from "@/components/studio-kit";
import { loadErrorMessage, useAsync } from "@/components/use-async";
import {
  fetchGiftCampaign,
  pauseGiftCampaign,
  resumeGiftCampaign,
  submitGiftCampaign,
  updateGiftCampaign,
  withdrawGiftCampaign,
  type GiftCampaignDetail,
} from "@/features/gifts/api";
import { ApiError } from "@/lib/api/client";
import type { StatusTone } from "@/lib/format/status";
import { CAMPAIGN_STATUS_LABEL, SENDER_LABEL, worksLine } from "@/lib/gifts-view";

type Part = "collectibles" | "emails";
const STATUS_TONE: Record<string, StatusTone> = { DRAFT: "neutral", IN_REVIEW: "info", ACTIVE: "positive", PAUSED: "warning", ENDED: "neutral" };

function partFromHash(hash: string): Part {
  return hash.replace(/^#/, "") === "emails" ? "emails" : "collectibles";
}

function Campaign({ id }: { id: string }) {
  const data = useAsync(() => fetchGiftCampaign(id), [id]);
  const [override, setOverride] = useState<GiftCampaignDetail | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [part, setPart] = useState<Part>("collectibles");
  const [pick, setPick] = useState<{ ids: string[]; at: number } | null>(null);
  const [emailsBadge, setEmailsBadge] = useState(0);

  useEffect(() => {
    setPart(partFromHash(window.location.hash));
    const onHash = () => setPart(partFromHash(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const go = useCallback((next: Part) => {
    setPart(next);
    window.history.replaceState(null, "", next === "emails" ? "#emails" : window.location.pathname + window.location.search);
  }, []);
  const clearPick = useCallback(() => setPick(null), []);

  if (data.status === "loading") return <Skeleton className="h-64 w-full" />;
  if (data.status === "error") {
    return <ErrorState title="Campaign unavailable" message={loadErrorMessage(data.error, "this campaign")} action={<RetryButton onClick={data.reload} />} />;
  }
  const c = override ?? data.data;
  const tracking = c.status !== "DRAFT" && c.status !== "IN_REVIEW";

  async function run(key: string, fn: () => Promise<GiftCampaignDetail>) {
    setBusy(key);
    setError(null);
    try {
      setOverride(await fn());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That didn't go through. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-8">
      <header className="cr-cut cr-glass-card grid gap-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 text-sm">
              <StatusMark tone={STATUS_TONE[c.status] ?? "neutral"}>{CAMPAIGN_STATUS_LABEL[c.status] ?? c.status}</StatusMark>
              <span className="text-fg-muted">· {c.profile.display_name}</span>
            </p>
            <h2 className="mt-2 text-2xl font-bold text-fg sm:text-3xl">{c.title}</h2>
            <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-muted">
              <span className="inline-flex items-center gap-1.5 text-fg">
                <Gift aria-hidden="true" className="size-4 text-highlight" /> {c.gift_items}
              </span>
              <span>{worksLine(c.works)}</span>
              <span>{SENDER_LABEL[c.sender]}</span>
              {c.include_presale ? <span>Pre-sale buyers included</span> : null}
            </p>
            {c.description ? <p className="mt-2 max-w-2xl text-sm text-fg-muted">{c.description}</p> : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {c.status === "DRAFT" ? (
              <Button size="sm" className="sk-gloss cr-cut" busy={busy === "submit"} onClick={() => void run("submit", () => submitGiftCampaign(c.id))}>
                <Send aria-hidden="true" /> {c.viewer_role === "staff" ? "Make it live" : "Send to Corner Room to go live"}
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
              <Button size="sm" variant="ghost" onClick={() => setEditing(!editing)} aria-expanded={editing}>
                {editing ? <X aria-hidden="true" /> : <PenLine aria-hidden="true" />}{" "}
                {editing ? "Close" : c.status === "DRAFT" ? "Edit" : c.viewer_role === "staff" ? "Change" : "Change (Corner Room checks it)"}
              </Button>
            ) : null}
          </div>
        </div>

        {c.review_note ? (
          <p className="flex items-start gap-2 text-sm text-danger">
            <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" /> Corner Room asked for changes: {c.review_note}
          </p>
        ) : null}
        {c.status === "IN_REVIEW" ? <p className="text-sm text-fg">Waiting for Corner Room to check this campaign. Fans don&apos;t see it yet.</p> : null}
        {c.pending ? <p className="text-sm text-fg">Your changes are waiting for Corner Room. The campaign keeps running as it was until then.</p> : null}
        {error ? (
          <p role="alert" className="flex items-center gap-2 text-sm text-danger">
            <CircleAlert aria-hidden="true" className="size-4" /> {error}
          </p>
        ) : null}
      </header>

      {editing ? (
        <Card className="sk-appear p-5">
          <CampaignForm
            profile={{ kind: c.profile.kind, id: c.profile.id }}
            initial={c}
            submitLabel={c.status === "DRAFT" ? "Save" : c.viewer_role === "staff" ? "Save changes" : "Send changes for review"}
            onSave={async (body) => {
              setOverride(await updateGiftCampaign(c.id, body));
              setEditing(false);
            }}
          />
        </Card>
      ) : null}

      {tracking ? (
        <Tabs
          label="This campaign"
          value={part}
          onValueChange={(v) => go(v as Part)}
          keepMounted
          items={[
            {
              id: "collectibles",
              label: (
                <span className="inline-flex items-center gap-2">
                  <Package aria-hidden="true" className="size-4" /> Collectibles
                  <span className="sk-count">{c.counts.TOTAL}</span>
                </span>
              ),
              content: (
                <div className="pt-6">
                  <CollectibleTracking
                    c={c}
                    onChange={setOverride}
                    onEmail={(ids) => {
                      setPick({ ids, at: Date.now() });
                      go("emails");
                    }}
                  />
                </div>
              ),
            },
            {
              id: "emails",
              label: (
                <span className="inline-flex items-center gap-2">
                  <Mail aria-hidden="true" className="size-4" /> Emails
                  {emailsBadge ? <span className="sk-count">{emailsBadge}</span> : null}
                </span>
              ),
              content: (
                <div className="pt-6">
                  <GiftEmails campaignId={c.id} pick={pick} onPicked={clearPick} onCounts={setEmailsBadge} />
                </div>
              ),
            },
          ]}
        />
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
        <div className="flex flex-wrap gap-2">
          <ButtonLink href="/studio/mailbox" variant="ghost">
            <Inbox aria-hidden="true" /> Mailbox
          </ButtonLink>
          <ButtonLink href="/studio/gifts" variant="secondary">
            <ArrowLeft aria-hidden="true" /> All gifts
          </ButtonLink>
        </div>
      }
    >
      <Campaign id={id} />
    </AccountPage>
  );
}
