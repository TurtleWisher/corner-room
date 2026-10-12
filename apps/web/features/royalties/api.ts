/* Royalty statements, rules, revenue pools, runs and rights. Split from lib/api.ts (Phase 16, Stage 5). */

import { type Page } from "@/features/identity/api";
import { apiFetch } from "@/lib/api/client";

export type RoyaltyStatementRecord = {
  id: string;
  payee_type: string;
  payee_id: string;
  period_start: string;
  period_end: string;
  status: string;
  total_amount_minor: number;
  currency_code: string;
  version_number: number;
  lines: Array<{
    id: string;
    payee_type: string;
    track_id: string | null;
    eligible_units: number;
    share_bps_snapshot: number;
    amount_minor: number;
    currency_code: string;
    is_residual: boolean;
  }>;
  adjustments: Array<{ id: string; amount_minor: number; currency_code: string; reason: string }>;
};

export type RoyaltyRuleRecord = {
  id: string;
  key: string;
  version: number;
  status: string;
  definition: Record<string, unknown>;
};

export type RevenuePoolRecord = {
  id: string;
  period_start: string;
  period_end: string;
  source_type: string;
  currency_code: string;
  amount_minor: number;
  status: string;
  rule_id: string;
};

export type RoyaltyRunRecord = {
  id: string;
  revenue_pool_id: string;
  status: string;
  run_kind: string;
  pool_amount_minor_snapshot: number;
  unallocated_minor: number;
};

export async function fetchMyRoyaltyStatements(): Promise<Page<RoyaltyStatementRecord>> {
  return apiFetch<Page<RoyaltyStatementRecord>>("/api/v1/me/royalties/statements", { retry: false });
}

export async function fetchRoyaltyStatement(id: string): Promise<RoyaltyStatementRecord> {
  return apiFetch<RoyaltyStatementRecord>(`/api/v1/statements/${id}`, { retry: false });
}

export async function fetchRoyaltyRules(): Promise<RoyaltyRuleRecord[]> {
  return apiFetch<RoyaltyRuleRecord[]>("/api/v1/royalty-rules", { retry: false });
}

export async function createRoyaltyRule(body: {
  key: string;
  version?: number;
  definition: Record<string, unknown>;
}): Promise<RoyaltyRuleRecord> {
  return apiFetch<RoyaltyRuleRecord>("/api/v1/royalty-rules", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    retry: false,
  });
}

export async function transitionRoyaltyRule(id: string, action: string): Promise<RoyaltyRuleRecord> {
  return apiFetch<RoyaltyRuleRecord>(`/api/v1/royalty-rules/${id}/lifecycle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
    retry: false,
  });
}

export async function fetchRevenuePools(): Promise<RevenuePoolRecord[]> {
  return apiFetch<RevenuePoolRecord[]>("/api/v1/revenue-pools", { retry: false });
}

export async function createRevenuePool(body: {
  period_start: string;
  period_end: string;
  source_type: string;
  currency_code: string;
  rule_id: string;
}): Promise<RevenuePoolRecord> {
  return apiFetch<RevenuePoolRecord>("/api/v1/revenue-pools", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    retry: false,
  });
}

export async function recordRecognizedRevenue(
  body: {
    source_type: string;
    period_start: string;
    period_end: string;
    amount_minor: number;
    currency_code: string;
  },
  idempotencyKey: string,
): Promise<{ id: string; amount_minor: number; currency_code: string }> {
  return apiFetch("/api/v1/recognized-revenue", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(body),
    retry: false,
  });
}

export async function freezeRevenuePool(id: string): Promise<RevenuePoolRecord> {
  return apiFetch<RevenuePoolRecord>(`/api/v1/revenue-pools/${id}/freeze`, {
    method: "POST",
    retry: false,
  });
}

export async function createRoyaltyRun(revenue_pool_id: string): Promise<RoyaltyRunRecord> {
  return apiFetch<RoyaltyRunRecord>("/api/v1/royalty-runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ revenue_pool_id }),
    retry: false,
  });
}

export async function transitionRoyaltyRun(id: string, action: string): Promise<RoyaltyRunRecord> {
  return apiFetch<RoyaltyRunRecord>(`/api/v1/royalty-runs/${id}/lifecycle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
    retry: false,
  });
}

export async function putTrackRights(
  trackId: string,
  body: {
    territory: string;
    residual_payee_type?: string | null;
    residual_payee_id?: string | null;
    shares: Array<{
      right_type: string;
      payee_type: string;
      payee_id: string;
      share_bps: number;
      effective_from: string;
      effective_to?: string | null;
    }>;
  },
): Promise<unknown> {
  return apiFetch(`/api/v1/tracks/${trackId}/rights`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    retry: false,
  });
}

export async function transitionRights(id: string, action: string): Promise<unknown> {
  return apiFetch(`/api/v1/rights/${id}/lifecycle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
    retry: false,
  });
}
