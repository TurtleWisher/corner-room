"use client";

import { FormEvent, Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";

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
import { ApiError, fetchCampaignAnalytics, type CampaignAnalyticsRecord } from "@/lib/api";
import {
  WORKSPACE_REQUIRED_COPY,
  analyticsErrorKind,
  attributionDisplay,
  buildAnalyticsHref,
  periodHasCounts,
} from "@/lib/analytics-view";

function CampaignAnalyticsBody() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { currentOrg } = useWorkspace();
  const fromParam = search.get("from") ?? "";
  const toParam = search.get("to") ?? "";
  const [from, setFrom] = useState(fromParam);
  const [to, setTo] = useState(toParam);
  const [data, setData] = useState<CampaignAnalyticsRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorKind, setErrorKind] = useState<"workspace" | "range" | "not_found" | "other" | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setFrom(fromParam);
    setTo(toParam);
  }, [fromParam, toParam]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setErrorKind(null);
    setData(null);
    void fetchCampaignAnalytics(params.id, fromParam || null, toParam || null)
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
          setError("Unable to load campaign analytics");
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
  }, [params.id, fromParam, toParam, currentOrg?.id]);

  if (errorKind === "workspace") {
    return <EmptyState message={WORKSPACE_REQUIRED_COPY} />;
  }
  if (errorKind === "not_found") {
    return <ErrorState title="Not found" message={error ?? "Not found."} />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Campaign analytics</h1>
        <p className="text-sm text-neutral-600">
          Ingested campaign facts only. Attribution actuals, CAC, and ROAS are not computed.
        </p>
        <p className="text-sm">
          <Link href={`/staff/campaigns/${params.id}`} className="underline">
            Open campaign
          </Link>
        </p>
      </div>
      <AnalyticsTimezoneNote />
      <DateRangeFields
        from={from}
        to={to}
        onFrom={setFrom}
        onTo={setTo}
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          router.replace(buildAnalyticsHref(pathname, from, to));
        }}
      />
      {errorKind === "range" ? <ErrorState title="Invalid date range" message={error ?? ""} /> : null}
      {errorKind === "other" ? <ErrorState message={error ?? ""} /> : null}
      {loading ? <AnalyticsSkeleton /> : null}
      {data && !loading ? (
        <>
          <PeriodEmptyNote hasCounts={periodHasCounts([data.ingested_event_count])} />
          <section className="grid gap-3 sm:grid-cols-2">
            <MetricTile
              label="Ingested events"
              value={data.ingested_event_count}
              loading={false}
            />
          </section>
          <Card>
            <p className="text-sm text-neutral-600">Attribution</p>
            <p className="mt-2 font-medium">{attributionDisplay(data.attribution_status)}</p>
          </Card>
        </>
      ) : null}
    </div>
  );
}

export default function CampaignAnalyticsPage() {
  return (
    <Protected>
      <Suspense fallback={<AnalyticsSkeleton />}>
        <CampaignAnalyticsBody />
      </Suspense>
    </Protected>
  );
}
