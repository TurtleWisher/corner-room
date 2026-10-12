"use client";

import { FormEvent, useEffect, useState } from "react";

import { Protected } from "@/components/protected";
import { useWorkspace } from "@/components/workspace-provider";
import { EmptyState, ErrorState, LoadingState } from "@/components/async-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  ApiError,
  createRevenuePool,
  createRoyaltyRule,
  createRoyaltyRun,
  fetchRevenuePools,
  fetchRoyaltyRules,
  freezeRevenuePool,
  recordRecognizedRevenue,
  transitionRoyaltyRule,
  transitionRoyaltyRun,
  type RevenuePoolRecord,
  type RoyaltyRuleRecord,
} from "@/lib/api";

function StaffRoyaltiesBody() {
  const { currentOrg } = useWorkspace();
  const [rules, setRules] = useState<RoyaltyRuleRecord[]>([]);
  const [pools, setPools] = useState<RevenuePoolRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState("PRO_RATA_BY_ELIGIBLE_PLAY");
  const [rightType, setRightType] = useState("MASTER");
  const [minMs, setMinMs] = useState("");
  const [sourceType, setSourceType] = useState("STREAMING_SUB");
  const [currency, setCurrency] = useState("USD");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [ruleId, setRuleId] = useState("");
  const [amount, setAmount] = useState("");

  async function reload() {
    if (!currentOrg) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [ruleRows, poolRows] = await Promise.all([fetchRoyaltyRules(), fetchRevenuePools()]);
      setRules(ruleRows);
      setPools(poolRows);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to load royalty ops");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, [currentOrg]);

  async function onRule(form: FormEvent) {
    form.preventDefault();
    setError(null);
    const eligibility: Record<string, unknown> = {};
    if (minMs.trim()) {
      eligibility.min_duration_ms = Number(minMs);
    }
    try {
      await createRoyaltyRule({
        key,
        definition: {
          pool_type: key,
          right_type: rightType,
          share_effective: "PLAY_TIME",
          ...(Object.keys(eligibility).length ? { eligibility } : {}),
        },
      });
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Rule create failed");
    }
  }

  async function onPool(form: FormEvent) {
    form.preventDefault();
    setError(null);
    try {
      const amountMinor = Number(amount);
      await recordRecognizedRevenue(
        {
          source_type: sourceType,
          period_start: periodStart,
          period_end: periodEnd,
          amount_minor: amountMinor,
          currency_code: currency,
        },
        `rr-${Date.now()}`,
      );
      await createRevenuePool({
        period_start: periodStart,
        period_end: periodEnd,
        source_type: sourceType,
        currency_code: currency,
        rule_id: ruleId,
      });
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Pool create failed");
    }
  }

  if (!currentOrg) {
    return <EmptyState message="Switch to an organization workspace to operate royalties." />;
  }
  if (loading) {
    return <LoadingState label="Loading royalty ops" />;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Royalty operations</h1>
      <p className="text-sm text-neutral-600">
        Shares, rates, and eligibility are staff-entered data. The UI does not invent splits or stream rates.
      </p>
      {error ? <ErrorState title="Royalty ops error" message={error} /> : null}
      <form className="space-y-3" onSubmit={(event) => void onRule(event)}>
        <h2 className="text-sm font-medium">Create rule</h2>
        <Input value={key} onChange={(event) => setKey(event.target.value)} placeholder="pool_type / key" />
        <Input value={rightType} onChange={(event) => setRightType(event.target.value)} placeholder="right_type" />
        <Input
          value={minMs}
          onChange={(event) => setMinMs(event.target.value)}
          placeholder="eligibility min_duration_ms (optional data)"
        />
        <Button type="submit">Save draft rule</Button>
      </form>
      <form className="space-y-3" onSubmit={(event) => void onPool(event)}>
        <h2 className="text-sm font-medium">Recognized revenue + pool</h2>
        <Input value={sourceType} onChange={(event) => setSourceType(event.target.value)} placeholder="source_type" />
        <Input value={currency} onChange={(event) => setCurrency(event.target.value)} placeholder="currency" />
        <Input value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} placeholder="period_start ISO" />
        <Input value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} placeholder="period_end ISO" />
        <Input value={ruleId} onChange={(event) => setRuleId(event.target.value)} placeholder="rule id" />
        <Input value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="recognized amount_minor" />
        <Button type="submit">Record intake and open pool</Button>
      </form>
      <section className="space-y-3">
        {rules.map((row) => (
          <Card key={row.id}>
            <p className="font-medium">
              {row.key} v{row.version} · {row.status}
            </p>
            <p className="text-xs text-neutral-500">{row.id}</p>
            {row.status === "DRAFT" ? (
              <Button className="mt-3" onClick={() => void transitionRoyaltyRule(row.id, "activate").then(() => reload())}>
                Activate
              </Button>
            ) : null}
          </Card>
        ))}
        {pools.map((row) => (
          <Card key={row.id}>
            <p className="font-medium">
              {row.status} · {row.amount_minor} {row.currency_code}
            </p>
            <p className="text-sm text-neutral-600">{row.source_type}</p>
            {row.status === "OPEN" ? (
              <Button className="mt-3" onClick={() => void freezeRevenuePool(row.id).then(() => reload())}>
                Freeze from recognized revenue
              </Button>
            ) : null}
            {row.status === "FROZEN" ? (
              <Button
                className="mt-3"
                onClick={() =>
                  void createRoyaltyRun(row.id).then((run) => transitionRoyaltyRun(run.id, "approve")).then(() => reload())
                }
              >
                Run calculation
              </Button>
            ) : null}
          </Card>
        ))}
      </section>
    </div>
  );
}

export default function StaffRoyaltiesPage() {
  return (
    <Protected>
      <StaffRoyaltiesBody />
    </Protected>
  );
}
