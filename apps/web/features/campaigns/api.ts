/* Marketing campaigns, tasks, links, channels, KPI targets and expenses. Split from lib/api.ts (Phase 16, Stage 5). */

import { type MoneyJson } from "@/features/finance/api";
import { type Page } from "@/features/identity/api";
import { apiFetch } from "@/lib/api/client";

export type CampaignRecord = {
  id: string;
  organization_id: string;
  title: string;
  description: string | null;
  status: string;
  starts_at: string | null;
  ends_at: string | null;
  budget: MoneyJson | null;
  committed_spend: MoneyJson | null;
  attribution_status: string;
  cancelled_at: string | null;
  version: number;
};

export type CampaignTaskRecord = {
  id: string;
  campaign_id: string;
  title: string;
  status: string;
  assignee_user_id: string | null;
  due_at: string | null;
  version: number;
};

export type CampaignLinkRecord = {
  id: string;
  campaign_id: string;
  subject_type: string;
  subject_id: string;
};

export type CampaignAssetRecord = {
  id: string;
  campaign_id: string;
  media_asset_id: string;
};

export type CampaignChannelRecord = {
  id: string;
  campaign_id: string;
  code: string;
};

export type CampaignKpiTargetRecord = {
  id: string;
  campaign_id: string;
  metric_key: string;
  target_value: number;
  attribution_status: string;
};

export type CampaignExpenseRecord = {
  id: string;
  status: string;
  category: string;
  amount: MoneyJson;
  campaign_id: string | null;
  source_type: string;
  source_id: string;
};

export type CampaignDetailRecord = CampaignRecord & {
  tasks: CampaignTaskRecord[];
  links: CampaignLinkRecord[];
  assets: CampaignAssetRecord[];
  channels: CampaignChannelRecord[];
  kpi_targets: CampaignKpiTargetRecord[];
  expense_requests: CampaignExpenseRecord[];
};

export async function fetchCampaigns(): Promise<Page<CampaignRecord>> {
  return apiFetch<Page<CampaignRecord>>("/api/v1/campaigns", { retry: false });
}

export async function fetchCampaign(id: string): Promise<CampaignDetailRecord> {
  return apiFetch<CampaignDetailRecord>(`/api/v1/campaigns/${id}`, { retry: false });
}

export async function createCampaign(body: {
  title: string;
  description?: string | null;
  budget?: MoneyJson | null;
}): Promise<CampaignRecord> {
  return apiFetch<CampaignRecord>("/api/v1/campaigns", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    retry: false,
  });
}

export async function transitionCampaign(
  id: string,
  action: string,
  version?: number,
): Promise<CampaignRecord> {
  return apiFetch<CampaignRecord>(`/api/v1/campaigns/${id}/transition`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, version }),
    retry: false,
  });
}

export async function createCampaignTask(
  campaignId: string,
  body: { title: string; assignee_user_id?: string | null },
): Promise<CampaignTaskRecord> {
  return apiFetch<CampaignTaskRecord>(`/api/v1/campaigns/${campaignId}/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    retry: false,
  });
}

export async function transitionCampaignTask(
  campaignId: string,
  taskId: string,
  action: string,
  version?: number,
): Promise<CampaignTaskRecord> {
  return apiFetch<CampaignTaskRecord>(`/api/v1/campaigns/${campaignId}/tasks/${taskId}/transition`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, version }),
    retry: false,
  });
}

export async function addCampaignLink(
  campaignId: string,
  body: { subject_type: string; subject_id: string },
): Promise<CampaignLinkRecord> {
  return apiFetch<CampaignLinkRecord>(`/api/v1/campaigns/${campaignId}/links`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    retry: false,
  });
}

export async function addCampaignKpiTarget(
  campaignId: string,
  body: { metric_key: string; target_value: number },
): Promise<CampaignKpiTargetRecord> {
  return apiFetch<CampaignKpiTargetRecord>(`/api/v1/campaigns/${campaignId}/kpi-targets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    retry: false,
  });
}

export async function requestCampaignExpense(
  campaignId: string,
  body: { category: string; amount: MoneyJson },
): Promise<CampaignExpenseRecord> {
  return apiFetch<CampaignExpenseRecord>(`/api/v1/campaigns/${campaignId}/expense-requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    retry: false,
  });
}

export async function addCampaignChannel(
  campaignId: string,
  code: string,
): Promise<CampaignChannelRecord> {
  return apiFetch<CampaignChannelRecord>(`/api/v1/campaigns/${campaignId}/channels`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
    retry: false,
  });
}
