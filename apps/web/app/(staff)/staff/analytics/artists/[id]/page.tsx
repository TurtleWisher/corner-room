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
} from "@/components/analytics-panel";
import { EmptyState, ErrorState } from "@/components/async-state";
import { Card } from "@/components/ui/card";
import { ApiError, fetchArtistModuleAnalytics, type ArtistAnalyticsRecord } from "@/lib/api";
import {
  WORKSPACE_REQUIRED_COPY,
  analyticsErrorKind,
  buildAnalyticsHref,
  uniqueListenersLabel,
} from "@/lib/analytics-view";

function ArtistAnalyticsBody() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { currentOrg } = useWorkspace();
  const fromParam = search.get("from") ?? "";
  const toParam = search.get("to") ?? "";
  const [from, setFrom] = useState(fromParam);
  const [to, setTo] = useState(toParam);
  const [data, setData] = useState<ArtistAnalyticsRecord | null>(null);
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
    void fetchArtistModuleAnalytics(params.id, fromParam || null, toParam || null)
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
          setError("Unable to load artist analytics");
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
        <h1 className="text-2xl font-semibold">Artist analytics</h1>
        <p className="text-sm text-neutral-600">
          Artist grain is not projected in daily metrics. Track totals are not summed here.
        </p>
        <p className="text-sm">
          <Link href={`/artists/${params.id}`} className="underline">
            Open artist
          </Link>
          {" · "}
          <Link href={`/artists/${params.id}/analytics`} className="underline">
            Operational play aggregates
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
          <section className="grid gap-3 sm:grid-cols-2">
            <MetricTile
              label="Unique listeners"
              value={uniqueListenersLabel(data.unique_listeners)}
              loading={false}
            />
          </section>
          <Card>
            <p className="text-sm text-neutral-600">
              Money is not available in analytics. Unique listeners are not calculated.
            </p>
          </Card>
        </>
      ) : null}
    </div>
  );
}

export default function ArtistModuleAnalyticsPage() {
  return (
    <Protected>
      <Suspense fallback={<AnalyticsSkeleton />}>
        <ArtistAnalyticsBody />
      </Suspense>
    </Protected>
  );
}
