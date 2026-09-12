"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

import { Protected } from "@/components/protected";
import { useWorkspace } from "@/components/workspace-provider";
import { EmptyState, ErrorState, LoadingState } from "@/components/async-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  ApiError,
  addCampaignChannel,
  addCampaignKpiTarget,
  addCampaignLink,
  createCampaignTask,
  fetchCampaign,
  requestCampaignExpense,
  transitionCampaign,
  transitionCampaignTask,
  type CampaignDetailRecord,
} from "@/lib/api";
import { CAMPAIGN_ACTIONS, campaignAttributionLabel, campaignStatusLabel } from "@/lib/campaigns-view";
import { formatMinor } from "@/lib/finance-view";

function StaffCampaignDetailBody() {
  const params = useParams<{ id: string }>();
  const { currentOrg } = useWorkspace();
  const [row, setRow] = useState<CampaignDetailRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [taskTitle, setTaskTitle] = useState("");
  const [subjectType, setSubjectType] = useState("ARTIST");
  const [subjectId, setSubjectId] = useState("");
  const [metricKey, setMetricKey] = useState("");
  const [metricValue, setMetricValue] = useState("");
  const [expenseCategory, setExpenseCategory] = useState("");
  const [expenseAmount, setExpenseAmount] = useState("");
  const [channel, setChannel] = useState("EMAIL");

  async function reload() {
    if (!currentOrg || !params.id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setRow(await fetchCampaign(params.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to load campaign");
      setRow(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, [currentOrg, params.id]);

  async function onTransition(action: string) {
    if (!row) {
      return;
    }
    setError(null);
    try {
      await transitionCampaign(row.id, action, row.version);
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Transition failed");
    }
  }

  async function onTask(form: FormEvent) {
    form.preventDefault();
    if (!row) {
      return;
    }
    setError(null);
    try {
      await createCampaignTask(row.id, { title: taskTitle });
      setTaskTitle("");
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Task create failed");
    }
  }

  async function onTaskAction(taskId: string, action: string, version: number) {
    if (!row) {
      return;
    }
    setError(null);
    try {
      await transitionCampaignTask(row.id, taskId, action, version);
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Task update failed");
    }
  }

  async function onLink(form: FormEvent) {
    form.preventDefault();
    if (!row) {
      return;
    }
    setError(null);
    try {
      await addCampaignLink(row.id, { subject_type: subjectType, subject_id: subjectId });
      setSubjectId("");
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Link failed");
    }
  }

  async function onKpi(form: FormEvent) {
    form.preventDefault();
    if (!row) {
      return;
    }
    setError(null);
    try {
      await addCampaignKpiTarget(row.id, {
        metric_key: metricKey,
        target_value: Number(metricValue),
      });
      setMetricKey("");
      setMetricValue("");
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "KPI target failed");
    }
  }

  async function onExpense(form: FormEvent) {
    form.preventDefault();
    if (!row) {
      return;
    }
    setError(null);
    try {
      await requestCampaignExpense(row.id, {
        category: expenseCategory,
        amount: {
          amount_minor: Number(expenseAmount),
          currency_code: row.budget?.currency_code ?? "BDT",
        },
      });
      setExpenseAmount("");
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Expense request failed");
    }
  }

  async function onChannel(form: FormEvent) {
    form.preventDefault();
    if (!row) {
      return;
    }
    setError(null);
    try {
      await addCampaignChannel(row.id, channel);
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Channel failed");
    }
  }

  if (!currentOrg) {
    return <EmptyState message="Select a workspace" />;
  }
  if (loading) {
    return <LoadingState />;
  }
  if (error && !row) {
    return <ErrorState message={error} />;
  }
  if (!row) {
    return <EmptyState message="Campaign not found" />;
  }

  return (
    <div className="space-y-8">
      <p className="text-sm">
        <Link href="/staff/campaigns" className="underline">
          All campaigns
        </Link>
      </p>
      <div>
        <h1 className="text-2xl font-semibold">{row.title}</h1>
        <p className="text-sm text-neutral-600">{campaignStatusLabel(row.status)}</p>
        <p className="text-sm text-neutral-600">
          Budget{" "}
          {row.budget ? formatMinor(row.budget.amount_minor, row.budget.currency_code) : "not set"}
        </p>
        <p className="text-sm text-neutral-600">
          Committed spend{" "}
          {row.committed_spend
            ? formatMinor(row.committed_spend.amount_minor, row.committed_spend.currency_code)
            : "none"}
        </p>
        <p className="text-xs text-neutral-500">
          {campaignAttributionLabel(row.attribution_status)}. Actuals are not computed here.
        </p>
        <p className="text-sm">
          <Link href={`/staff/analytics/campaigns/${row.id}`} className="underline">
            Campaign analytics
          </Link>
        </p>
      </div>
      {error ? <ErrorState message={error} /> : null}
      <section className="flex flex-wrap gap-2">
        {CAMPAIGN_ACTIONS.map((action) => (
          <Button key={action} type="button" onClick={() => void onTransition(action)}>
            {action.replaceAll("_", " ")}
          </Button>
        ))}
      </section>
      <section className="space-y-3">
        <h2 className="font-medium">Tasks</h2>
        {row.tasks.length === 0 ? <EmptyState message="No tasks" /> : null}
        {row.tasks.map((task) => (
          <Card key={task.id}>
            <p className="font-medium">{task.title}</p>
            <p className="text-sm text-neutral-600">{task.status}</p>
            {task.status === "TODO" ? (
              <Button type="button" onClick={() => void onTaskAction(task.id, "start", task.version)}>
                Start
              </Button>
            ) : null}
            {task.status === "IN_PROGRESS" ? (
              <Button
                type="button"
                onClick={() => void onTaskAction(task.id, "complete", task.version)}
              >
                Complete
              </Button>
            ) : null}
          </Card>
        ))}
        <form className="space-y-3" onSubmit={(event) => void onTask(event)}>
          <Input
            value={taskTitle}
            onChange={(event) => setTaskTitle(event.target.value)}
            placeholder="Task title"
          />
          <Button type="submit">Add task</Button>
        </form>
      </section>
      <section className="space-y-3">
        <h2 className="font-medium">Links</h2>
        <p className="text-sm text-neutral-600">ARTIST, RELEASE (album), or EVENT (concert) only.</p>
        {row.links.length === 0 ? <EmptyState message="No linked subjects" /> : null}
        {row.links.map((link) => (
          <Card key={link.id}>
            <p className="text-sm">
              {link.subject_type} · {link.subject_id}
            </p>
          </Card>
        ))}
        <form className="space-y-3" onSubmit={(event) => void onLink(event)}>
          <Input
            value={subjectType}
            onChange={(event) => setSubjectType(event.target.value)}
            placeholder="ARTIST | RELEASE | EVENT"
          />
          <Input
            value={subjectId}
            onChange={(event) => setSubjectId(event.target.value)}
            placeholder="Subject id"
          />
          <Button type="submit">Add link</Button>
        </form>
      </section>
      <section className="space-y-3">
        <h2 className="font-medium">Channels</h2>
        {row.channels.length === 0 ? <EmptyState message="No channels" /> : null}
        {row.channels.map((item) => (
          <Card key={item.id}>
            <p className="text-sm">{item.code}</p>
          </Card>
        ))}
        <form className="space-y-3" onSubmit={(event) => void onChannel(event)}>
          <Input
            value={channel}
            onChange={(event) => setChannel(event.target.value)}
            placeholder="IN_APP | EMAIL | SOCIAL | PRESS | OTHER"
          />
          <Button type="submit">Add channel</Button>
        </form>
      </section>
      <section className="space-y-3">
        <h2 className="font-medium">KPI targets</h2>
        <p className="text-sm text-neutral-600">
          Targets only. {campaignAttributionLabel("ATTRIBUTION_UNDEFINED")}.
        </p>
        {row.kpi_targets.length === 0 ? (
          <EmptyState message="No KPI targets. Analytics actuals are disconnected." />
        ) : null}
        {row.kpi_targets.map((target) => (
          <Card key={target.id}>
            <p className="font-medium">
              {target.metric_key}: {target.target_value}
            </p>
            <p className="text-xs text-neutral-500">
              {campaignAttributionLabel(target.attribution_status)}
            </p>
          </Card>
        ))}
        <form className="space-y-3" onSubmit={(event) => void onKpi(event)}>
          <Input
            value={metricKey}
            onChange={(event) => setMetricKey(event.target.value)}
            placeholder="Metric key (not an actual)"
          />
          <Input
            value={metricValue}
            onChange={(event) => setMetricValue(event.target.value)}
            placeholder="Target value"
          />
          <Button type="submit">Add target</Button>
        </form>
      </section>
      <section className="space-y-3">
        <h2 className="font-medium">Expense requests</h2>
        <p className="text-sm text-neutral-600">
          Creates a Finance DRAFT only. Approve and recognize stay on Finance.
        </p>
        {row.expense_requests.length === 0 ? <EmptyState message="No expense requests" /> : null}
        {row.expense_requests.map((expense) => (
          <Card key={expense.id}>
            <p className="font-medium">
              {expense.status} · {formatMinor(expense.amount.amount_minor, expense.amount.currency_code)}
            </p>
            <p className="text-sm text-neutral-600">{expense.category}</p>
          </Card>
        ))}
        <form className="space-y-3" onSubmit={(event) => void onExpense(event)}>
          <Input
            value={expenseCategory}
            onChange={(event) => setExpenseCategory(event.target.value)}
            placeholder="Expense category code"
          />
          <Input
            value={expenseAmount}
            onChange={(event) => setExpenseAmount(event.target.value)}
            placeholder="Amount (minor units)"
          />
          <Button type="submit">Request spend</Button>
        </form>
      </section>
      <section className="space-y-3">
        <h2 className="font-medium">Assets</h2>
        {row.assets.length === 0 ? (
          <EmptyState message="No campaign assets. Upload with storage_class campaign_asset." />
        ) : (
          row.assets.map((asset) => (
            <Card key={asset.id}>
              <p className="text-sm">{asset.media_asset_id}</p>
            </Card>
          ))
        )}
      </section>
    </div>
  );
}

export default function StaffCampaignDetailPage() {
  return (
    <Protected>
      <StaffCampaignDetailBody />
    </Protected>
  );
}
