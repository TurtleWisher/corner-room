"use client";

/* A pre-sale campaign's live numbers (owner, 2026-11-06, D-PRESALE-04). */

import { useParams } from "next/navigation";

import { CampaignNumbersPanel } from "@/components/studio/campaign-numbers";
import { CampaignShell } from "@/components/studio/campaign-shell";

export default function CampaignNumbersPage() {
  const { id } = useParams<{ id: string }>();
  return <CampaignShell releaseId={id}>{() => <CampaignNumbersPanel releaseId={id} initialView="presale" />}</CampaignShell>;
}
