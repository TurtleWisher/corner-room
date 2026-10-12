/* Staff admin: users, ops overview, outbox and audit. Split from lib/api.ts (Phase 16, Stage 5). */

import { type HealthCheck, type Page } from "@/features/identity/api";
import { apiFetch } from "@/lib/api/client";

export type AdminUserRecord = {
  id: string;
  email: string | null;
  phone?: string | null;
  status: string;
  email_verified: boolean;
  security_locked: boolean;
  created_at?: string | null;
};

export type AdminUserInspect = AdminUserRecord & {
  assignments: Array<{
    id: string;
    role_key: string;
    organization_id: string | null;
    status: string;
  }>;
  memberships: Array<{
    id: string;
    organization_id: string;
    status: string;
  }>;
};

export type OpsOverview = {
  health: { status: string; checks: Record<string, HealthCheck> };
  outbox: { counts_by_status: Record<string, number>; failed_count: number };
  jobs: {
    registered: string[];
    worker_process: { status: string };
    source_of_truth: string;
  };
  notifications: {
    count: number;
    deliveries_by_status: Record<string, number>;
    deliveries_by_channel: Record<string, number>;
    channels: Record<string, string>;
    email: { status: string; honesty: string };
    sms: { status: string };
    push: { status: string };
    scope?: string;
  };
  search: {
    document_count: number;
    counts_by_visibility: Record<string, number>;
    default_visibility: string;
    rebuild?: { status: string };
    scope?: string;
  };
  analytics: {
    ingested_event_count: number;
    latest_metric_date?: string | null;
    unique_listeners: string;
    money: { status: string };
    attribution: string;
    scope?: string;
  };
  finance: {
    visibility: string;
    scope: string;
    transactions_by_status: Record<string, number>;
    payouts_by_status: Record<string, number>;
    reconciliation_by_status?: Record<string, number>;
    mutation: string;
    force_payout: string;
    repair?: string;
  };
  security?: {
    source: string;
    record_count: number;
    scope: string;
    impersonation: string;
  };
};

export type OutboxRecord = {
  id: string;
  event_type: string;
  status: string;
  correlation_id: string | null;
  attempts: number;
  last_error: string | null;
  created_at: string;
};

export async function fetchAdminUsers(query?: string): Promise<Page<AdminUserRecord>> {
  const params = new URLSearchParams();
  if (query) {
    params.set("q", query);
  }
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return apiFetch<Page<AdminUserRecord>>(`/api/v1/users${suffix}`, { retry: false });
}

export async function fetchAdminUser(id: string): Promise<AdminUserInspect> {
  return apiFetch<AdminUserInspect>(`/api/v1/users/${id}`, { retry: false });
}

export async function applyUserLifecycle(
  id: string,
  action: "activate" | "suspend" | "unsuspend" | "close" | "lock" | "unlock",
): Promise<AdminUserRecord> {
  return apiFetch<AdminUserRecord>(`/api/v1/users/${id}/lifecycle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
    retry: false,
  });
}

export async function fetchOpsOverview(): Promise<OpsOverview> {
  return apiFetch<OpsOverview>("/api/v1/staff/ops/overview", { retry: false });
}

export async function fetchOpsOutbox(status?: string): Promise<Page<OutboxRecord>> {
  const suffix = status ? `?status=${encodeURIComponent(status)}` : "";
  return apiFetch<Page<OutboxRecord>>(`/api/v1/staff/ops/outbox${suffix}`, { retry: false });
}

export type AuditRecord = {
  id: string;
  occurred_at: string;
  actor_id: string;
  actor_type: string;
  action: string;
  entity_type: string;
  entity_id: string;
  previous_state: Record<string, unknown> | null;
  new_state: Record<string, unknown> | null;
  request_id: string | null;
  organization_id: string | null;
};

export async function fetchAudit(entityType?: string, entityId?: string): Promise<Page<AuditRecord>> {
  const params = new URLSearchParams();
  if (entityType) {
    params.set("entity_type", entityType);
  }
  if (entityId) {
    params.set("entity_id", entityId);
  }
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return apiFetch<Page<AuditRecord>>(`/api/v1/audit${suffix}`, { retry: false });
}
