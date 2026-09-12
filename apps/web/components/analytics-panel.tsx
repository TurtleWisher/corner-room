"use client";

import { FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  ANALYTICS_TIMEZONE_NOTE,
  NO_DATA_PERIOD,
  countDisplay,
} from "@/lib/analytics-view";

export function AnalyticsSkeleton({ label = "Loading analytics" }: { label?: string }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2" aria-busy="true" aria-label={label}>
      {[0, 1, 2, 3].map((slot) => (
        <div key={slot} className="h-24 animate-pulse rounded-xl bg-neutral-100" />
      ))}
    </div>
  );
}

export function AnalyticsTimezoneNote() {
  return <p className="text-sm text-neutral-600">{ANALYTICS_TIMEZONE_NOTE}</p>;
}

export function MetricTile({
  label,
  value,
  loading,
}: {
  label: string;
  value: number | string;
  loading: boolean;
}) {
  return (
    <Card>
      <p className="text-sm text-neutral-600">{label}</p>
      {loading ? (
        <div className="mt-3 h-7 w-20 animate-pulse rounded bg-neutral-100" aria-hidden="true" />
      ) : (
        <p className="mt-2 text-xl font-semibold">
          {typeof value === "number" ? countDisplay(value, false).text : String(value)}
        </p>
      )}
    </Card>
  );
}

export function PeriodEmptyNote({ hasCounts }: { hasCounts: boolean }) {
  if (hasCounts) {
    return null;
  }
  return <p className="text-sm text-neutral-600">{NO_DATA_PERIOD}</p>;
}

export function DateRangeFields({
  from,
  to,
  onFrom,
  onTo,
  onSubmit,
}: {
  from: string;
  to: string;
  onFrom: (value: string) => void;
  onTo: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={onSubmit}>
      <label className="block text-sm">
        <span className="mb-1 block text-neutral-600">From</span>
        <Input type="date" value={from} onChange={(event) => onFrom(event.target.value)} />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block text-neutral-600">To</span>
        <Input type="date" value={to} onChange={(event) => onTo(event.target.value)} />
      </label>
      <Button type="submit">Apply dates</Button>
    </form>
  );
}
