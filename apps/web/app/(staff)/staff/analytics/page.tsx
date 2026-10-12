"use client";

import { FormEvent, Suspense, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Protected } from "@/components/protected";
import { useWorkspace } from "@/components/workspace-provider";
import {
  AnalyticsSkeleton,
  AnalyticsTimezoneNote,
  DateRangeFields,
  MetricTile,
  PeriodEmptyNote,
} from "@/components/analytics-panel";
import { EmptyState, ErrorState } from "@/components/async-state";
import { Card } from "@/components/ui/card";
import { ApiError, fetchStaffAnalyticsOverview, type StaffAnalyticsOverview } from "@/lib/api";
import {
  WORKSPACE_REQUIRED_COPY,
  analyticsErrorKind,
  attributionDisplay,
  buildAnalyticsHref,
  moneyTileLabel,
  periodHasCounts,
  uniqueListenersLabel,
} from "@/lib/analytics-view";

function StaffAnalyticsBody() {
  const { currentOrg } = useWorkspace();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const fromParam = params.get("from") ?? "";
  const toParam = params.get("to") ?? "";
  const [from, setFrom] = useState(fromParam);
  const [to, setTo] = useState(toParam);
  const [data, setData] = useState<StaffAnalyticsOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorKind, setErrorKind] = useState<"workspace" | "range" | "not_found" | "other" | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setFrom(fromParam);
    setTo(toParam);
  }, [fromParam, toParam]);

  useEffect(() => {
    if (!currentOrg) {
      setData(null);
      setLoading(false);
      setErrorKind("workspace");
      setError(WORKSPACE_REQUIRED_COPY);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setErrorKind(null);
    setData(null);
    void fetchStaffAnalyticsOverview(fromParam || null, toParam || null)
      .then((body) => {
        if (!cancelled) {
          setData(body);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) {
          return;
        }
        if (err instanceof ApiError) {
          setErrorKind(analyticsErrorKind(err.code, err.status));
          setError(err.message);
        } else {
          setErrorKind("other");
          setError("Unable to load analytics");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [currentOrg, fromParam, toParam]);

  function onApply(event: FormEvent) {
    event.preventDefault();
    router.replace(buildAnalyticsHref(pathname, from, to));
  }

  if (!currentOrg || errorKind === "workspace") {
    return <EmptyState message={WORKSPACE_REQUIRED_COPY} />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Analytics</h1>
        <p className="text-sm text-neutral-600">
          Estimates from analytics facts. This is not the ledger and not royalty eligibility.
        </p>
      </div>
      <AnalyticsTimezoneNote />
      <DateRangeFields from={from} to={to} onFrom={setFrom} onTo={setTo} onSubmit={onApply} />
      {errorKind === "range" ? <ErrorState title="Invalid date range" message={error ?? ""} /> : null}
      {errorKind === "not_found" ? <ErrorState title="Not found" message={error ?? "Not found."} /> : null}
      {errorKind === "other" ? <ErrorState message={error ?? ""} /> : null}
      {loading ? <AnalyticsSkeleton /> : null}
      {data && !loading ? (
        <>
          <PeriodEmptyNote
            hasCounts={periodHasCounts([
              data.tracks.play_count,
              data.tracks.completed_play_count,
              data.tracks.listen_duration_ms,
              data.events.ticket_paid_count,
              data.events.ticket_issued_count,
              data.events.ticket_checked_in_count,
              data.campaigns.ingested_event_count,
            ])}
          />
          <section className="grid gap-3 sm:grid-cols-2">
            <MetricTile label="Plays" value={data.tracks.play_count} loading={false} />
            <MetricTile
              label="Completed plays"
              value={data.tracks.completed_play_count}
              loading={false}
            />
            <MetricTile
              label="Listen duration (ms)"
              value={data.tracks.listen_duration_ms}
              loading={false}
            />
            <MetricTile
              label="Unique listeners"
              value={uniqueListenersLabel(data.tracks.unique_listeners)}
              loading={false}
            />
            <MetricTile label="Tickets paid" value={data.events.ticket_paid_count} loading={false} />
            <MetricTile
              label="Tickets issued"
              value={data.events.ticket_issued_count}
              loading={false}
            />
            <MetricTile
              label="Checked in"
              value={data.events.ticket_checked_in_count}
              loading={false}
            />
            <MetricTile
              label="Campaign ingested events"
              value={data.campaigns.ingested_event_count}
              loading={false}
            />
          </section>
          <Card>
            <p className="text-sm text-neutral-600">Campaign attribution</p>
            <p className="mt-2 font-medium">{attributionDisplay(data.campaigns.attribution_status)}</p>
          </Card>
          <Card>
            <p className="text-sm text-neutral-600">Money</p>
            <p className="mt-2 font-medium">{moneyTileLabel(data.money.status)}</p>
          </Card>
        </>
      ) : null}
    </div>
  );
}

export default function StaffAnalyticsPage() {
  return (
    <Protected permission="analytics.read">
      <Suspense fallback={<AnalyticsSkeleton />}>
        <StaffAnalyticsBody />
      </Suspense>
    </Protected>
  );
}
