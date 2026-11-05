"use client";

/* One pre-sale campaign's pages (owner, 2026-11-06, D-PRESALE-04): live numbers, setup, the fans'
 * page and sharing, under one header with the campaign's state and tabs. The release's own Studio
 * detail is loaded once here; every state comes from the API. */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, CircleAlert, ExternalLink, PencilLine, Radio } from "lucide-react";

import { ButtonLink, Card, DateTime, ErrorState, Skeleton } from "@/components/ds";
import { AccountPage } from "@/components/shell/account-page";
import { fetchStudioRelease, type StudioReleaseDetail } from "@/features/studio/api";
import { friendlyError } from "@/lib/error-copy";
import {
  PRESALES_HOME,
  campaignStateLabel,
  campaignTabs,
  presaleStageState,
  releaseNumbersHref,
} from "@/lib/presale-campaign-view";
import { studioPresaleStage } from "@/lib/presale-view";
import { RELEASE_TYPE_LABEL } from "@/lib/studio-view";
import { cn } from "@/lib/utils";

const TONE = {
  live: "text-success",
  waiting: "text-fg",
  neutral: "text-fg-muted",
  attention: "text-danger",
  done: "text-highlight",
} as const;

export function CampaignStateChip({ state }: { state: string }) {
  const s = campaignStateLabel(state);
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm font-semibold ${TONE[s.tone]}`}>
      {s.tone === "live" ? <Radio aria-hidden="true" className="size-4" /> : null}
      {s.tone === "attention" ? <CircleAlert aria-hidden="true" className="size-4" /> : null}
      {s.label}
    </span>
  );
}

export type Reload = (next?: StudioReleaseDetail) => void;

export function CampaignShell({
  releaseId,
  children,
}: {
  releaseId: string;
  children: (detail: StudioReleaseDetail, reload: Reload) => React.ReactNode;
}) {
  const [detail, setDetail] = useState<StudioReleaseDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback<Reload>(
    (next) => {
      if (next) {
        setDetail(next);
        return;
      }
      fetchStudioRelease(releaseId)
        .then((d) => {
          setDetail(d);
          setError(null);
        })
        .catch((err) => setError(friendlyError(err, "This pre-sale couldn't be loaded.")));
    },
    [releaseId],
  );
  useEffect(() => reload(), [reload]);

  return (
    <AccountPage audience="artist" eyebrow="Studio · Pre-sale" title={detail?.release.title ?? "Pre-sale"} what="this pre-sale">
      <p className="-mt-4 mb-6">
        <Link href={PRESALES_HOME} className="cr-focus inline-flex items-center gap-1 text-sm font-semibold text-link underline">
          <ArrowLeft aria-hidden="true" className="size-4" /> All pre-sales
        </Link>
      </p>
      {error && !detail ? (
        <ErrorState title="Pre-sale unavailable" message={error} />
      ) : !detail ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <>
          <CampaignHeader detail={detail} />
          <CampaignTabs id={detail.release.id} />
          <div className="mt-8">{children(detail, reload)}</div>
        </>
      )}
    </AccountPage>
  );
}

function CampaignHeader({ detail }: { detail: StudioReleaseDetail }) {
  const r = detail.release;
  const state = presaleStageState(studioPresaleStage(detail.presale, r.status), r.status);
  const s = campaignStateLabel(state);
  const date = detail.presale?.release_at ?? detail.presale?.requested_release_at ?? r.release_at;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <CampaignStateChip state={state} />
        <span className="text-sm text-fg-muted">
          {detail.profile.display_name} · {RELEASE_TYPE_LABEL[r.release_type] ?? r.release_type}
          {date ? (
            <>
              {" "}
              · Out <DateTime value={date} format="datetime" />
            </>
          ) : null}
        </span>
      </div>
      {s.hint ? <p className="mt-1 text-sm text-fg-muted">{s.hint}</p> : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <ButtonLink href={`/releases/${r.id}`} variant="secondary" size="sm" target="_blank" rel="noopener">
          <ExternalLink aria-hidden="true" /> Open the fans&apos; page
        </ButtonLink>
        <ButtonLink href={`/studio/releases/${r.id}`} variant="ghost" size="sm">
          <PencilLine aria-hidden="true" /> Edit the release
        </ButtonLink>
      </div>
      {r.status === "RELEASED" ? (
        <Card tone="solid" className="mt-5 flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="text-sm text-fg">It&apos;s out. This campaign moved to the release, where its numbers carry on with everything sold since.</p>
          <ButtonLink href={releaseNumbersHref(r.id)} size="sm">
            Release numbers <ArrowRight aria-hidden="true" />
          </ButtonLink>
        </Card>
      ) : null}
    </div>
  );
}

function CampaignTabs({ id }: { id: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Pre-sale" className="mt-6 flex gap-1 overflow-x-auto border-b border-line">
      {campaignTabs(id).map((t) => {
        const current = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={current ? "page" : undefined}
            className={cn(
              "cr-focus -mb-px shrink-0 border-b-2 px-4 py-2.5 text-sm font-semibold",
              current ? "border-highlight text-fg" : "border-transparent text-fg-muted hover:text-fg",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
