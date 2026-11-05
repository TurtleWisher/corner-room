"use client";

/* Sharing a pre-sale (owner, 2026-11-06, D-PRESALE-04): named share links, each with its own counts. */

import { useParams } from "next/navigation";

import { CampaignShell } from "@/components/studio/campaign-shell";
import { ShareLinks } from "@/components/studio/share-links";

export default function CampaignSharePage() {
  const { id } = useParams<{ id: string }>();
  return <CampaignShell releaseId={id}>{(detail) => <ShareLinks releaseId={id} title={detail.release.title} />}</CampaignShell>;
}
