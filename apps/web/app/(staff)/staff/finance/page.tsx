"use client";

/*
 * Finance (redesigned 2026-11-27 with Commerce and Customers, D-CUSTOMERS-03): the ledger's
 * journals, payouts and reconciliation for this workspace, in the staff glass panels. Count tiles at
 * the top (counts only, never sums: every amount comes from the ledger and is only formatted here),
 * a dense ledger table, reconciliation with expected and actual side by side ("Not received yet"
 * when there is no actual), and the payout settings folded away at the end.
 */

import { FormEvent, useEffect, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";

import { DateTime, Money, StatusChip } from "@/components/ds";
import { useSpotlight } from "@/components/ds/spotlight";
import { StatTile } from "@/components/staff/customers-kit";
import { Button, EmptyState, ErrorState, Input, LoadingState, Protected } from "@/components/staff/kit";
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
import { journalStatusLabel } from "@/lib/finance-view";
import { formatCount } from "@/lib/format/count";
import { humanizeStatus } from "@/lib/format/status";

/** Payout states still on their way (finance.payouts: PENDING, PROCESSING, PAID, FAILED). */
const PAYOUT_OPEN = new Set(["PENDING", "PROCESSING"]);

function StaffFinanceBody() {
  const { currentOrg } = useWorkspace();
  const spotRef = useSpotlight<HTMLDivElement>();
  const [journals, setJournals] = useState<JournalRecord[]>([]);
  const [payouts, setPayouts] = useState<PayoutRecord[]>([]);
  const [mismatches, setMismatches] = useState<ReconciliationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [minThreshold, setMinThreshold] = useState("");
  const [secondThreshold, setSecondThreshold] = useState("");
  const [schedule, setSchedule] = useState("");
  const [settings, setSettings] = useState(false);

  async function reload() {
    if (!currentOrg) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [ledger, payoutRows, recon] = await Promise.all([fetchLedger(), fetchPayouts(), fetchReconciliations()]);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload reads the workspace
  }, [currentOrg]);

  async function onConfig(form: FormEvent) {
    form.preventDefault();
    setError(null);
    try {
      if (minThreshold.trim()) {
        await upsertFinanceConfig({ key: "payout_minimum_threshold_minor", int_value: Number(minThreshold) });
      }
      if (secondThreshold.trim()) {
        await upsertFinanceConfig({ key: "payout_second_approver_threshold_minor", int_value: Number(secondThreshold) });
      }
      if (schedule.trim()) {
        await upsertFinanceConfig({ key: "payout_schedule", text_value: schedule });
      }
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Config update failed");
    }
  }

  const openPayouts = useMemo(() => payouts.filter((p) => PAYOUT_OPEN.has(p.status)).length, [payouts]);
  const unmatched = useMemo(() => mismatches.filter((m) => m.status !== "MATCHED").length, [mismatches]);

  if (!currentOrg) return <EmptyState message="Select a workspace" />;
  if (loading) return <LoadingState label="Loading finance" />;

  return (
    <div className="cx" data-module="finance" ref={spotRef}>
      <header className="cx-head">
        <div>
          <p className="cx-eyebrow">Money</p>
          <h1 className="cx-title">Finance</h1>
          <p className="cx-lede">Ledger journals, payouts and reconciliation for this workspace. Every amount comes from the ledger; nothing here is added up in the browser.</p>
        </div>
      </header>
      {error ? <ErrorState message={error} /> : null}

      <div className="cx-tiles" style={{ "--cx-cols": 4 } as React.CSSProperties}>
        <StatTile label="Journals" value={formatCount(journals.length)} hint="Posted to the ledger" />
        <StatTile label="Payouts" value={formatCount(payouts.length)} hint={`${formatCount(openPayouts)} still in progress`} tone={openPayouts ? "warning" : undefined} style={{ "--i": 1 } as React.CSSProperties} />
        <StatTile label="Reconciliation" value={formatCount(mismatches.length)} hint={`${formatCount(unmatched)} not matched`} tone={unmatched ? "negative" : undefined} style={{ "--i": 2 } as React.CSSProperties} />
        <StatTile label="Workspace" value={<span className="text-base">{currentOrg.name}</span>} hint="Finance shows this workspace only" style={{ "--i": 3 } as React.CSSProperties} />
      </div>

      <section className="cx-glass cr-cut cx-pad" aria-labelledby="fin-journals" data-spot>
        <h2 id="fin-journals" className="cx-section-title">
          Ledger journals <span className="cx-quiet">{formatCount(journals.length)}</span>
        </h2>
        {journals.length === 0 ? (
          <EmptyState message="No posted journals" />
        ) : (
          <div className="overflow-x-auto" role="region" aria-label="Ledger journals" tabIndex={0}>
            <table className="w-full min-w-[36rem] text-left text-sm">
              <thead className="text-[0.625rem] uppercase tracking-[0.1em] text-fg-muted">
                <tr className="border-b border-line">
                  <th className="py-2 pr-3 font-bold">When</th>
                  <th className="py-2 pr-3 font-bold">Type</th>
                  <th className="py-2 pr-3 font-bold">Currency</th>
                  <th className="py-2 pr-3 font-bold">Status</th>
                  <th className="py-2 font-bold">Journal</th>
                </tr>
              </thead>
              <tbody>
                {journals.map((row) => (
                  <tr key={row.id} className="border-b border-line/60">
                    <td className="py-2 pr-3 tabular-nums">
                      <DateTime value={row.occurred_at} />
                    </td>
                    <td className="py-2 pr-3">{humanizeStatus(row.type)}</td>
                    <td className="py-2 pr-3">{row.currency_code}</td>
                    <td className="py-2 pr-3">{journalStatusLabel(row.status)}</td>
                    <td className="cx-mono py-2 text-fg-muted">{row.id.slice(0, 8)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="cx-grid-2">
        <section className="cx-glass cr-cut cx-pad" aria-labelledby="fin-payouts" data-spot>
          <h2 id="fin-payouts" className="cx-section-title">
            Payouts <span className="cx-quiet">{formatCount(payouts.length)}</span>
          </h2>
          {payouts.length === 0 ? (
            <EmptyState message="No payouts" />
          ) : (
            <ul className="cx-mini">
              {payouts.map((row) => (
                <li key={row.id}>
                  <span className="flex items-center gap-2">
                    <StatusChip value={row.status} />
                    <span className="cx-quiet">{row.provider}</span>
                  </span>
                  <Money value={{ amount_minor: row.amount_minor, currency_code: row.currency_code }} minorDigits="always" className="font-semibold" />
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="cx-glass cr-cut cx-pad" aria-labelledby="fin-recon" data-spot>
          <h2 id="fin-recon" className="cx-section-title">
            Reconciliation <span className="cx-quiet">mismatches are shown, never fixed by themselves</span>
          </h2>
          {mismatches.length === 0 ? (
            <EmptyState message="No reconciliation rows" />
          ) : (
            <ul className="cx-mini">
              {mismatches.map((row) => (
                <li key={row.id} className="flex-wrap">
                  <span className="grid gap-1">
                    <StatusChip value={row.status} />
                    {row.notes ? <span className="cx-quiet">{row.notes}</span> : null}
                  </span>
                  <span className="grid justify-items-end text-right text-xs">
                    <span>
                      Expected <Money value={{ amount_minor: row.expected_amount_minor, currency_code: row.currency_code }} minorDigits="always" className="font-semibold" />
                    </span>
                    <span className="text-fg-muted">
                      Actual{" "}
                      {row.actual_amount_minor !== null ? (
                        <Money value={{ amount_minor: row.actual_amount_minor, currency_code: row.currency_code }} minorDigits="always" />
                      ) : (
                        "Not received yet"
                      )}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="cx-glass cr-cut cx-pad" aria-labelledby="fin-settings">
        <button type="button" className="cx-ghost cr-cut cr-focus" aria-expanded={settings} aria-controls="fin-settings-body" onClick={() => setSettings(!settings)}>
          <ChevronDown aria-hidden="true" className={`size-4 transition-transform ${settings ? "rotate-180" : ""}`} />
          <span id="fin-settings">Payout settings</span>
        </button>
        <div id="fin-settings-body" className="cx-fold" data-open={settings || undefined}>
          <div inert={!settings}>
            <form className="mt-3 grid gap-3 md:grid-cols-3" onSubmit={(event) => void onConfig(event)}>
              <p className="cx-quiet md:col-span-3">Payouts stay blocked until these are set. Amounts in the currency&apos;s smallest unit.</p>
              <Input value={minThreshold} onChange={(event) => setMinThreshold(event.target.value)} placeholder="Minimum threshold (minor units)" />
              <Input value={secondThreshold} onChange={(event) => setSecondThreshold(event.target.value)} placeholder="Second-approver threshold (minor units)" />
              <Input value={schedule} onChange={(event) => setSchedule(event.target.value)} placeholder="Schedule key" />
              <div className="md:col-span-3">
                <Button type="submit">Save settings</Button>
              </div>
            </form>
          </div>
        </div>
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
