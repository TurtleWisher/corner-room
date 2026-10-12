/* Ledger, payouts, reconciliations and finance config. Split from lib/api.ts (Phase 16, Stage 5). */

import { type Page } from "@/features/identity/api";
import { apiFetch } from "@/lib/api/client";

export type JournalRecord = {
  id: string;
  type: string;
  status: string;
  currency_code: string;
  occurred_at: string;
};

export type PayoutRecord = {
  id: string;
  settlement_id: string | null;
  status: string;
  amount_minor: number;
  currency_code: string;
  provider: string;
};

export type ReconciliationRecord = {
  id: string;
  status: string;
  expected_amount_minor: number;
  actual_amount_minor: number | null;
  currency_code: string;
  notes: string | null;
};

export async function fetchLedger(): Promise<Page<JournalRecord>> {
  return apiFetch<Page<JournalRecord>>("/api/v1/ledger", { retry: false });
}

export async function fetchPayouts(): Promise<PayoutRecord[]> {
  return apiFetch<PayoutRecord[]>("/api/v1/payouts", { retry: false });
}

export async function fetchReconciliations(): Promise<ReconciliationRecord[]> {
  return apiFetch<ReconciliationRecord[]>("/api/v1/reconciliations", { retry: false });
}

export async function upsertFinanceConfig(body: {
  key: string;
  int_value?: number | null;
  text_value?: string | null;
}): Promise<unknown> {
  return apiFetch("/api/v1/finance-config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    retry: false,
  });
}

export type MoneyJson = {
  amount_minor: number;
  currency_code: string;
};
