"use client";

/* A release's numbers (owner, 2026-11-06, D-PRESALE-04): once it is out, a pre-sale's campaign moves
 * here and carries on. Pre-sale only, since release, or all together. */

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { AccountPage } from "@/components/shell/account-page";
import { CampaignNumbersPanel } from "@/components/studio/campaign-numbers";
import { useAsync } from "@/components/use-async";
import { fetchStudioRelease } from "@/features/studio/api";

export default function ReleaseNumbersPage() {
  const { id } = useParams<{ id: string }>();
  const detail = useAsync(() => fetchStudioRelease(id), [id]);
  const title = detail.status === "ok" ? detail.data.release.title : "Release";
  return (
    <AccountPage audience="artist" eyebrow="Studio · Release numbers" title={title} what="this release's numbers">
      <p className="-mt-4 mb-6 flex flex-wrap gap-x-5 gap-y-1">
        <Link href="/studio/releases" className="cr-focus inline-flex items-center gap-1 text-sm font-semibold text-link underline">
          <ArrowLeft aria-hidden="true" className="size-4" /> All releases
        </Link>
        <Link href={`/studio/releases/${id}`} className="cr-focus text-sm font-semibold text-link underline">
          Open the release
        </Link>
      </p>
      <CampaignNumbersPanel releaseId={id} />
    </AccountPage>
  );
}
