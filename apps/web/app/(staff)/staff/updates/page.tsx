"use client";

/*
 * Feature updates (owner, 2026-11-06, D-UPDATES-01): every Corner Room feature, what it does today
 * and each update to it (new, improved, fixed), newest first. Staff only: the list comes from the
 * API, which answers 404 to anyone without a staff permission. Read only; each change that ships
 * adds its own line on the server.
 */

import { useMemo, useState } from "react";
import { ChevronDown, Search, Sparkles, Wrench, TrendingUp } from "lucide-react";

import { Card, EmptyState, ErrorState, Input, LoadingState, Protected, selectClasses } from "@/components/staff/kit";
import { useAsync } from "@/components/use-async";
import { fetchFeatureUpdates, type Feature, type UpdateKind } from "@/features/feature-updates/api";
import { ApiError } from "@/lib/api/client";
import { areasOf, dayLabel, featureLine, filterFeatures, KIND_LABEL, KINDS, latest, NO_FILTER, totals, type UpdateFilter } from "@/lib/feature-updates-view";

const KIND_ICON: Record<UpdateKind, typeof Sparkles> = { NEW: Sparkles, IMPROVED: TrendingUp, FIXED: Wrench };
const KIND_TONE: Record<UpdateKind, string> = {
  NEW: "border-highlight text-highlight",
  IMPROVED: "border-line-strong text-fg",
  FIXED: "border-line-strong text-fg-muted",
};

function KindTag({ kind }: { kind: UpdateKind }) {
  const Icon = KIND_ICON[kind];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 border px-1.5 py-0.5 text-[0.6875rem] font-bold uppercase tracking-[0.08em] ${KIND_TONE[kind]}`}>
      <Icon aria-hidden="true" className="size-3" /> {KIND_LABEL[kind]}
    </span>
  );
}

function FeatureCard({ f, open, onToggle }: { f: Feature; open: boolean; onToggle: () => void }) {
  return (
    <Card id={`feature-${f.id}`} className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-fg-muted">
            {f.area} · for {f.audience.join(", ").toLowerCase()}
          </p>
          <h2 className="mt-1 text-lg font-semibold text-fg">{f.name}</h2>
          <p className="mt-1 text-sm text-fg">{f.summary}</p>
        </div>
        <p className="text-sm text-fg-muted">Last changed {dayLabel(f.last_date)}</p>
      </div>
      <p className="mt-3 max-w-3xl text-sm leading-relaxed text-fg-muted">{f.description}</p>
      <button
        type="button"
        className="cr-focus mt-3 inline-flex items-center gap-1 text-sm font-semibold text-link"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={`updates-${f.id}`}
      >
        {open ? "Hide" : "Show"} updates · {featureLine(f)}
        <ChevronDown aria-hidden="true" className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <ol id={`updates-${f.id}`} className="mt-3 border-l border-line pl-4">
          {f.updates.map((u, i) => (
            <li key={`${u.date}-${i}`} className="relative pb-4 last:pb-0">
              <span aria-hidden="true" className="absolute -left-[1.3rem] top-1.5 size-2 rounded-full bg-line-strong" />
              <div className="flex flex-wrap items-center gap-2">
                <time dateTime={u.date} className="cr-num text-sm font-semibold text-fg">
                  {dayLabel(u.date)}
                </time>
                <KindTag kind={u.kind} />
                <span className="text-sm font-semibold text-fg">{u.title}</span>
              </div>
              <p className="mt-1 text-sm text-fg-muted">{u.details}</p>
            </li>
          ))}
        </ol>
      ) : null}
    </Card>
  );
}

function UpdatesBody() {
  const data = useAsync(() => fetchFeatureUpdates(), []);
  const [filter, setFilter] = useState<UpdateFilter>(NO_FILTER);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const all = useMemo(() => (data.status === "ok" ? data.data : []), [data.status, data.data]);
  const shown = useMemo(() => filterFeatures(all, filter), [all, filter]);
  const count = totals(shown);
  const recent = useMemo(() => latest(all, 6), [all]);
  const filtering = Boolean(filter.query.trim() || filter.area || filter.kind);

  if (data.status === "loading") return <LoadingState label="Loading feature updates" />;
  if (data.status === "error") {
    const gone = data.error instanceof ApiError && data.error.status === 404;
    return <ErrorState title={gone ? "Staff only" : "Feature updates unavailable"} message={gone ? "This page is for Corner Room staff." : data.error.message} />;
  }

  const toggle = (id: string) => setOpen((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set([...s, id])));
  const expandAll = () => setOpen(new Set(shown.map((f) => f.id)));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Feature updates</h1>
        <p className="mt-1 max-w-3xl text-sm text-fg-muted">
          Every Corner Room feature, what it does today, and each update to it: when it came, when it got better and every fix. For staff only. Newest
          changes first.
        </p>
      </div>

      <section aria-labelledby="latest-updates">
        <h2 id="latest-updates" className="text-sm font-semibold uppercase tracking-[0.08em] text-fg-muted">
          Latest
        </h2>
        <ul className="mt-2 grid gap-2 md:grid-cols-2">
          {recent.map((u, i) => (
            <li key={`${u.featureId}-${u.date}-${i}`}>
              <a
                href={`#feature-${u.featureId}`}
                className="cr-focus block border border-line p-3 hover:border-line-strong"
                onClick={() => setOpen((s) => new Set([...s, u.featureId]))}
              >
                <span className="flex flex-wrap items-center gap-2">
                  <time dateTime={u.date} className="cr-num text-xs font-semibold text-fg-muted">
                    {dayLabel(u.date)}
                  </time>
                  <KindTag kind={u.kind} />
                </span>
                <span className="mt-1 block text-sm font-semibold text-fg">
                  {u.feature}: {u.title}
                </span>
              </a>
            </li>
          ))}
        </ul>
      </section>

      <fieldset className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end">
        <legend className="sr-only">Find updates</legend>
        <label className="grid gap-1 text-sm font-semibold text-fg">
          Search
          <span className="relative">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-muted" />
            <Input
              className="pl-9"
              value={filter.query}
              onChange={(e) => setFilter({ ...filter, query: e.target.value })}
              placeholder="A feature, a fix, a word"
            />
          </span>
        </label>
        <label className="grid gap-1 text-sm font-semibold text-fg">
          Area
          <select className={selectClasses} value={filter.area ?? ""} onChange={(e) => setFilter({ ...filter, area: e.target.value || null })}>
            <option value="">Every area</option>
            {areasOf(all).map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm font-semibold text-fg">
          Kind
          <select
            className={selectClasses}
            value={filter.kind ?? ""}
            onChange={(e) => setFilter({ ...filter, kind: (e.target.value || null) as UpdateKind | null })}
          >
            <option value="">New, improved and fixed</option>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]} only
              </option>
            ))}
          </select>
        </label>
      </fieldset>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p role="status" className="text-sm text-fg">
          {shown.length} {shown.length === 1 ? "feature" : "features"} · {count.NEW} new · {count.IMPROVED} improved · {count.FIXED} fixed
        </p>
        <div className="flex gap-3 text-sm">
          <button type="button" className="cr-focus font-semibold text-link" onClick={expandAll}>
            Show every update
          </button>
          <button type="button" className="cr-focus font-semibold text-link" onClick={() => setOpen(new Set())}>
            Hide all
          </button>
          {filtering ? (
            <button type="button" className="cr-focus font-semibold text-link" onClick={() => setFilter(NO_FILTER)}>
              Clear filters
            </button>
          ) : null}
        </div>
      </div>

      {shown.length === 0 ? <EmptyState message="No feature matches" /> : null}
      <div className="grid gap-4">
        {shown.map((f) => (
          <FeatureCard key={f.id} f={f} open={open.has(f.id)} onToggle={() => toggle(f.id)} />
        ))}
      </div>
    </div>
  );
}

export default function StaffFeatureUpdatesPage() {
  return (
    <Protected>
      <UpdatesBody />
    </Protected>
  );
}
