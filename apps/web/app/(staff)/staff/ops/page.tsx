"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Protected } from "@/components/protected";
import { useWorkspace } from "@/components/workspace-provider";
import { EmptyState, ErrorState, LoadingState } from "@/components/async-state";
import { Card } from "@/components/ui/card";
import { ApiError, fetchOpsOutbox, fetchOpsOverview, type OpsOverview, type OutboxRecord } from "@/lib/api";
import {
  EMAIL_STUB_COPY,
  MONEY_NOT_AVAILABLE_COPY,
  UNIQUE_LISTENERS_COPY,
  WORKSPACE_REQUIRED_COPY,
  checkLabel,
  healthLabel,
  opsErrorKind,
} from "@/lib/ops-view";

function StaffOpsBody() {
  const { currentOrg } = useWorkspace();
  const [data, setData] = useState<OpsOverview | null>(null);
  const [outbox, setOutbox] = useState<OutboxRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorKind, setErrorKind] = useState<"workspace" | "forbidden" | "not_found" | "other" | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setErrorKind(null);
    void Promise.all([fetchOpsOverview(), fetchOpsOutbox()])
      .then(([overview, page]) => {
        if (cancelled) {
          return;
        }
        setData(overview);
        setOutbox(page.items);
      })
      .catch((err: unknown) => {
        if (cancelled) {
          return;
        }
        if (err instanceof ApiError) {
          setErrorKind(opsErrorKind(err.code, err.status));
          setError(err.message);
        } else {
          setErrorKind("other");
          setError("Unable to load operations");
        }
        setData(null);
        setOutbox([]);
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [currentOrg]);

  if (loading) {
    return <LoadingState label="Loading operations" />;
  }
  if (errorKind === "forbidden") {
    return <ErrorState title="Not permitted" message={error ?? "Not permitted"} />;
  }
  if (error && !data) {
    return <ErrorState message={error} />;
  }
  if (!data) {
    return <EmptyState message="No operations data" />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Operations</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Visibility only. Finance mutations and force payout are forbidden. Hide is not
          authorization.
        </p>
      </div>
      {!currentOrg ? <EmptyState message={WORKSPACE_REQUIRED_COPY} /> : null}
      <Card>
        <h2 className="font-medium">Health</h2>
        <p className="mt-2 text-sm">Overall {healthLabel(data.health.status)}</p>
        <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <dt>Database</dt>
          <dd>{checkLabel(data.health.checks.database)}</dd>
          <dt>Redis</dt>
          <dd>{checkLabel(data.health.checks.redis)}</dd>
          <dt>Email</dt>
          <dd>{checkLabel(data.health.checks.email)}</dd>
          <dt>SMS</dt>
          <dd>{checkLabel(data.health.checks.sms)}</dd>
          <dt>Push</dt>
          <dd>{checkLabel(data.health.checks.push)}</dd>
        </dl>
        <p className="mt-2 text-xs text-neutral-500">
          Stub email is not production-healthy. {EMAIL_STUB_COPY}.
        </p>
      </Card>
      <Card>
        <h2 className="font-medium">Jobs</h2>
        <p className="mt-2 text-sm">Worker {data.jobs.worker_process.status}</p>
        <p className="text-sm text-neutral-600">Source of truth: {data.jobs.source_of_truth}</p>
        <ul className="mt-2 list-disc pl-5 text-sm">
          {data.jobs.registered.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
      </Card>
      <Card>
        <h2 className="font-medium">Notifications</h2>
        <p className="mt-2 text-sm">Count {data.notifications.count}</p>
        <p className="text-sm">Email {data.notifications.email.honesty}</p>
        <p className="text-sm">SMS {data.notifications.sms.status}</p>
        <p className="text-sm">Push {data.notifications.push.status}</p>
      </Card>
      <Card>
        <h2 className="font-medium">Search / analytics / finance / security</h2>
        <p className="mt-2 text-sm">Search documents {data.search.document_count}</p>
        <p className="text-sm">Search rebuild {data.search.rebuild?.status ?? "NOT_CONFIGURED"}</p>
        <p className="text-sm">
          Unique listeners {UNIQUE_LISTENERS_COPY} ({data.analytics.unique_listeners})
        </p>
        <p className="text-sm">
          Money {MONEY_NOT_AVAILABLE_COPY} ({data.analytics.money.status})
        </p>
        <p className="text-sm">Attribution {data.analytics.attribution}</p>
        <p className="text-sm">
          Latest metric date {data.analytics.latest_metric_date ?? "NOT_AVAILABLE"}
        </p>
        <p className="text-sm">Finance visibility {data.finance.visibility}</p>
        <p className="text-sm">Force payout {data.finance.force_payout}</p>
        <p className="text-sm">Repair {data.finance.repair ?? "forbidden"}</p>
        <p className="text-sm">
          Security source {data.security?.source ?? "audit"} · impersonation{" "}
          {data.security?.impersonation ?? "not_implemented"}
        </p>
        <p className="mt-2 text-sm">
          <Link href="/staff/audit" className="underline">
            Open audit
          </Link>
        </p>
      </Card>
      <section className="space-y-3">
        <h2 className="font-medium">Outbox</h2>
        <p className="text-sm text-neutral-600">Failed {data.outbox.failed_count}</p>
        {outbox.length === 0 ? <EmptyState message="No outbox rows in this page" /> : null}
        {outbox.map((row) => (
          <Card key={row.id}>
            <p className="font-medium">{row.event_type}</p>
            <p className="text-sm text-neutral-600">
              {row.status} · attempts {row.attempts}
            </p>
          </Card>
        ))}
      </section>
    </div>
  );
}

export default function StaffOpsPage() {
  return (
    <Protected permission="audit.read">
      <StaffOpsBody />
    </Protected>
  );
}
