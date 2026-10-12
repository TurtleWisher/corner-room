"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

import { Protected } from "@/components/protected";
import { useWorkspace } from "@/components/workspace-provider";
import { EmptyState, ErrorState, LoadingState } from "@/components/async-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  ApiError,
  createCampaign,
  fetchCampaigns,
  type CampaignRecord,
} from "@/lib/api";
import { campaignAttributionLabel, campaignStatusLabel } from "@/lib/campaigns-view";
import { formatMinor } from "@/lib/finance-view";

function StaffCampaignsBody() {
  const { currentOrg } = useWorkspace();
  const [items, setItems] = useState<CampaignRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [budget, setBudget] = useState("");
  const [currency, setCurrency] = useState("BDT");

  async function reload() {
    if (!currentOrg) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const page = await fetchCampaigns();
      setItems(page.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to load campaigns");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, [currentOrg]);

  async function onCreate(form: FormEvent) {
    form.preventDefault();
    setError(null);
    try {
      const amount = budget.trim() ? Number(budget) : null;
      await createCampaign({
        title,
        budget:
          amount === null
            ? null
            : { amount_minor: amount, currency_code: currency.trim().toUpperCase() },
      });
      setTitle("");
      setBudget("");
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Create failed");
    }
  }

  if (!currentOrg) {
    return <EmptyState message="Select a workspace" />;
  }
  if (loading) {
    return <LoadingState />;
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Campaigns</h1>
        <p className="text-sm text-neutral-600">
          Marketing ops board. Budget is a planning cap. Spend is a Finance expense request. KPI
          targets are not attributed.
        </p>
      </div>
      {error ? <ErrorState message={error} /> : null}
      <form className="space-y-3" onSubmit={(event) => void onCreate(event)}>
        <p className="text-sm font-medium">New campaign (starts in PLANNING)</p>
        <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Title" />
        <Input
          value={budget}
          onChange={(event) => setBudget(event.target.value)}
          placeholder="Budget minor units (optional)"
        />
        <Input
          value={currency}
          onChange={(event) => setCurrency(event.target.value)}
          placeholder="Currency"
        />
        <Button type="submit">Create</Button>
      </form>
      <section className="space-y-3">
        {items.length === 0 ? <EmptyState message="No campaigns in this workspace" /> : null}
        {items.map((row) => (
          <Card key={row.id}>
            <p className="font-medium">
              <Link href={`/staff/campaigns/${row.id}`} className="underline">
                {row.title}
              </Link>
            </p>
            <p className="text-sm text-neutral-600">{campaignStatusLabel(row.status)}</p>
            <p className="text-sm text-neutral-600">
              Budget{" "}
              {row.budget
                ? formatMinor(row.budget.amount_minor, row.budget.currency_code)
                : "not set"}
            </p>
            <p className="text-xs text-neutral-500">
              {campaignAttributionLabel(row.attribution_status)}
            </p>
          </Card>
        ))}
      </section>
    </div>
  );
}

export default function StaffCampaignsPage() {
  return (
    <Protected>
      <StaffCampaignsBody />
    </Protected>
  );
}
