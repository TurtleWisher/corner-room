"use client";

import { FormEvent, useEffect, useState } from "react";

import { useWorkspace } from "@/components/workspace-provider";
import {
  ApiError,
  fetchLedger,
  fetchPayouts,
  fetchReconciliations,
  upsertFinanceConfig,
  type JournalRecord,
  type PayoutRecord,
  type ReconciliationRecord,
} from "@/lib/api";
import { formatMinor, journalStatusLabel } from "@/lib/finance-view";
import { Button, Card, EmptyState, ErrorState, Input, LoadingState, Protected } from "@/components/staff/kit";
import { StatusChip } from "@/components/ds";

function StaffFinanceBody() {
  const { currentOrg } = useWorkspace();
  const [journals, setJournals] = useState<JournalRecord[]>([]);
  const [payouts, setPayouts] = useState<PayoutRecord[]>([]);
  const [mismatches, setMismatches] = useState<ReconciliationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [minThreshold, setMinThreshold] = useState("");
  const [secondThreshold, setSecondThreshold] = useState("");
  const [schedule, setSchedule] = useState("");

  async function reload() {
    if (!currentOrg) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [ledger, payoutRows, recon] = await Promise.all([
        fetchLedger(),
        fetchPayouts(),
        fetchReconciliations(),
      ]);
      setJournals(ledger.items);
      setPayouts(payoutRows);
      setMismatches(recon);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to load finance");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, [currentOrg]);

  async function onConfig(form: FormEvent) {
    form.preventDefault();
    setError(null);
    try {
      if (minThreshold.trim()) {
        await upsertFinanceConfig({
          key: "payout_minimum_threshold_minor",
          int_value: Number(minThreshold),
        });
      }
      if (secondThreshold.trim()) {
        await upsertFinanceConfig({
          key: "payout_second_approver_threshold_minor",
          int_value: Number(secondThreshold),
        });
      }
      if (schedule.trim()) {
        await upsertFinanceConfig({ key: "payout_schedule", text_value: schedule });
      }
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Config update failed");
    }
  }

  if (!currentOrg) {
    return <EmptyState message="Select a workspace" />;
  }
  if (loading) {
    return <LoadingState />;
  }
  if (error) {
    return <ErrorState message={error} />;
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Finance</h1>
        <p className="text-sm text-fg-muted">
          Ledger journals, payouts and reconciliation for this workspace. Every amount comes from the ledger.
        </p>
      </div>
      <form className="space-y-3" onSubmit={(event) => void onConfig(event)}>
        <p className="text-sm font-medium">Payout settings (payouts stay blocked until these are set)</p>
        <Input
          value={minThreshold}
          onChange={(event) => setMinThreshold(event.target.value)}
          placeholder="Minimum threshold (minor units)"
        />
        <Input
          value={secondThreshold}
          onChange={(event) => setSecondThreshold(event.target.value)}
          placeholder="Second-approver threshold (minor units)"
        />
        <Input
          value={schedule}
          onChange={(event) => setSchedule(event.target.value)}
          placeholder="Schedule key"
        />
        <Button type="submit">Save config</Button>
      </form>
      <section className="space-y-3">
        <h2 className="font-medium">Journals</h2>
        {journals.length === 0 ? <EmptyState message="No posted journals" /> : null}
        {journals.map((row) => (
          <Card key={row.id}>
            <p className="font-medium">
              {row.type} · {journalStatusLabel(row.status)}
            </p>
            <p className="text-sm text-fg-muted">{row.currency_code}</p>
            <p className="text-xs text-fg-muted">{row.id}</p>
          </Card>
        ))}
      </section>
      <section className="space-y-3">
        <h2 className="font-medium">Payouts</h2>
        {payouts.length === 0 ? <EmptyState message="No payouts" /> : null}
        {payouts.map((row) => (
          <Card key={row.id}>
            <p className="font-medium">
              <StatusChip value={row.status} /> · {formatMinor(row.amount_minor, row.currency_code)}
            </p>
            <p className="text-sm text-fg-muted">{row.provider}</p>
          </Card>
        ))}
      </section>
      <section className="space-y-3">
        <h2 className="font-medium">Reconciliation</h2>
        <p className="text-sm text-fg-muted">Mismatches are visible. They are not auto-fixed.</p>
        {mismatches.length === 0 ? <EmptyState message="No reconciliation rows" /> : null}
        {mismatches.map((row) => (
          <Card key={row.id}>
            <p className="font-medium"><StatusChip value={row.status} /></p>
            <p className="text-sm text-fg-muted">
              expected {formatMinor(row.expected_amount_minor, row.currency_code)}
              {row.actual_amount_minor !== null
                ? ` · actual ${formatMinor(row.actual_amount_minor, row.currency_code)}`
                : ""}
            </p>
            {row.notes ? <p className="text-xs text-fg-muted">{row.notes}</p> : null}
          </Card>
        ))}
      </section>
    </div>
  );
}

export default function StaffFinancePage() {
  return (
    <Protected>
      <StaffFinanceBody />
    </Protected>
  );
}
