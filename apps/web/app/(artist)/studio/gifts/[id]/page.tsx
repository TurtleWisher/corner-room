"use client";

/*
 * One gift campaign (owner, 2026-10-28, D-CAMPAIGN-02), for the artist and for Corner Room staff:
 * the buyers who earned it and the tracking of each collectible (owner, 2026-11-06, D-CAMPAIGN-03:
 * not prepared, prepared, dispatched now or at a time, received, returned, missing); pausing,
 * restarting and changing it (changes to a live campaign wait for Corner Room). Who sees buyers'
 * details and who may update the gifts is decided by the API.
 */

import { useParams } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, CircleAlert, Pause, Play, Send, Undo2 } from "lucide-react";

import { Button, ButtonLink, Card, ErrorState, Skeleton } from "@/components/ds";
import { CampaignForm } from "@/components/gifts/campaign-form";
import { CollectibleTracking } from "@/components/gifts/collectible-tracking";
import { AccountPage } from "@/components/shell/account-page";
import { RetryButton } from "@/components/shell/staff-panel";
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
import { CAMPAIGN_STATUS_LABEL, SENDER_LABEL, worksLine } from "@/lib/gifts-view";

function Campaign({ id }: { id: string }) {
  const data = useAsync(() => fetchGiftCampaign(id), [id]);
  const [override, setOverride] = useState<GiftCampaignDetail | null>(null);
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
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That didn't go through. Please try again.");
    } finally {
      setBusy(null);
    }
  }

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

      {c.status !== "DRAFT" && c.status !== "IN_REVIEW" ? <CollectibleTracking c={c} onChange={setOverride} /> : null}
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
