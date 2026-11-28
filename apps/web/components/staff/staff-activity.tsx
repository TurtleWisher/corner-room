"use client";

/*
 * Staff activity (owner, 2026-11-28; /staff/activity, URL-15): which staff member did which thing.
 * Read from the audit log for staff accounts only (`GET /staff/activity`, `audit.read`). One card per
 * staff member filters by person; area chips filter by part of Corner Room; sign-ins are hidden
 * unless asked for. The home page shows the latest rows through `ActivityFeed`.
 */

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, RefreshCw } from "lucide-react";

import { PersonMark, useNow } from "@/components/staff/customers-kit";
import { ErrorState, Input, LoadingState } from "@/components/staff/kit";
import {
  fetchStaffActivity,
  fetchStaffActivityPeople,
  type ActivityItem,
  type ActivityPerson,
} from "@/features/staff-portal/api";
import { ApiError } from "@/lib/api/client";
import { formatTime } from "@/lib/format/date";
import { LEVEL_WORDS, agoWords } from "@/lib/staff-accounts-view";
import { actionWords, entityHref, groupByDay } from "@/lib/staff-activity-view";

export function ActivityRow({ item, showWho = true }: { item: ActivityItem; showWho?: boolean }) {
  const href = entityHref(item.entity_type, item.entity_id, item.action);
  return (
    <li className="sp-act">
      {showWho ? <PersonMark name={item.actor_name} seed={item.actor_id} src={item.actor_picture_url} size="2rem" /> : <span aria-hidden="true" />}
      <div className="sp-act-what">
        <p className="text-sm text-fg">
          {showWho ? <span className="font-semibold">{item.actor_name} </span> : null}
          <span className={showWho ? "text-fg-muted" : undefined}>{actionWords(item.action).replace(/^./, (c) => (showWho ? c.toLowerCase() : c))}</span>
        </p>
        <p className="text-xs text-fg-muted">
          <span className="sp-area">{item.area}</span> {item.entity_type}
          {href ? (
            <>
              {" · "}
              <Link href={href} className="cr-focus underline">
                Open
              </Link>
            </>
          ) : null}
          {item.reason ? ` · “${item.reason}”` : null}
        </p>
      </div>
      <time className="sp-act-when" dateTime={item.occurred_at}>
        {formatTime(item.occurred_at)}
      </time>
    </li>
  );
}

/** The latest staff actions, for the home page. */
export function ActivityFeed({ limit = 8 }: { limit?: number }) {
  const [items, setItems] = React.useState<ActivityItem[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    let live = true;
    fetchStaffActivity({ limit })
      .then((page) => live && setItems(page.items))
      .catch((err) => live && setError(err instanceof ApiError && err.status === 403 ? "forbidden" : "Staff activity couldn't be loaded."));
    return () => {
      live = false;
    };
  }, [limit]);
  if (error === "forbidden") return null;
  return (
    <section className="st-panel" aria-labelledby="sp-latest">
      <div className="sp-block-head">
        <h2 id="sp-latest" className="st-h2">
          Latest staff actions
        </h2>
        <Link href="/staff/activity" className="cr-focus text-link underline">
          All activity <ArrowRight aria-hidden="true" className="inline size-3" />
        </Link>
      </div>
      {error ? <p className="st-sub">{error}</p> : null}
      {items === null && !error ? <LoadingState label="Loading staff activity" /> : null}
      {items && items.length === 0 ? <p className="st-sub">No staff actions yet.</p> : null}
      {items && items.length > 0 ? (
        <ul className="sp-feed">
          {items.map((item) => (
            <ActivityRow key={item.id} item={item} />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function PeopleStrip({ people, actor, onPick, now }: { people: ActivityPerson[]; actor: string | null; onPick: (id: string | null) => void; now: Date }) {
  return (
    <ul className="sp-people" aria-label="Staff members">
      {people.map((p) => (
        <li key={p.user_id}>
          <button type="button" className="sp-person cr-cut cr-focus w-full" aria-pressed={actor === p.user_id} onClick={() => onPick(actor === p.user_id ? null : p.user_id)}>
            <PersonMark name={p.name} seed={p.user_id} src={p.picture_url} size="2.25rem" />
            <span className="min-w-0">
              <span className="block truncate font-semibold text-fg">{p.name}</span>
              <span className="block truncate text-xs text-fg-muted">
                {LEVEL_WORDS[p.level].label} · {agoWords(p.last_active_at, now)}
              </span>
            </span>
            <span className="sp-person-n">
              <span>
                <strong>{p.actions_today}</strong> today
              </span>
              <span>
                <strong>{p.actions_7d}</strong> this week
              </span>
              <span>
                <strong>{p.actions_30d}</strong> in 30 days
              </span>
            </span>
            {p.top_areas.length > 0 ? <span className="col-span-2 truncate text-xs text-fg-muted">Mostly {p.top_areas.join(", ")}</span> : null}
          </button>
        </li>
      ))}
    </ul>
  );
}

export function StaffActivityPage() {
  const params = useSearchParams();
  const router = useRouter();
  const actor = params.get("actor");
  const [area, setArea] = React.useState<string>("");
  const [query, setQuery] = React.useState("");
  const [typed, setTyped] = React.useState("");
  const [signIns, setSignIns] = React.useState(false);
  const [people, setPeople] = React.useState<ActivityPerson[] | null>(null);
  const [items, setItems] = React.useState<ActivityItem[] | null>(null);
  const [areas, setAreas] = React.useState<string[]>([]);
  const [next, setNext] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const now = useNow();

  // Search waits for a short pause in typing.
  React.useEffect(() => {
    const t = setTimeout(() => setQuery(typed), 250);
    return () => clearTimeout(t);
  }, [typed]);

  const load = React.useCallback(
    async (before?: string) => {
      setBusy(true);
      try {
        const page = await fetchStaffActivity({ actor: actor ?? undefined, area: area || undefined, q: query || undefined, before, signIns });
        setItems((old) => (before && old ? [...old, ...page.items] : page.items));
        setAreas(page.areas);
        setNext(page.next_before);
        setError(null);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Staff activity couldn't be loaded.");
      } finally {
        setBusy(false);
      }
    },
    [actor, area, query, signIns],
  );

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    fetchStaffActivityPeople().then(setPeople, () => setPeople([]));
  }, []);

  function pick(id: string | null) {
    router.replace(id ? `/staff/activity?actor=${encodeURIComponent(id)}` : "/staff/activity", { scroll: false });
  }

  const who = actor ? people?.find((p) => p.user_id === actor) : null;

  return (
    <div className="cx space-y-6">
      <div className="st-pagehead">
        <div>
          <h1 className="st-h1">Staff activity</h1>
          <p className="st-sub">Everything staff did on Corner Room, newest first. Press a person to see only what they did.</p>
        </div>
        <button type="button" className="st-ghost cr-focus" onClick={() => void load()} disabled={busy}>
          <RefreshCw aria-hidden="true" className="size-3.5" /> Refresh
        </button>
      </div>

      {people === null ? <LoadingState label="Loading staff" /> : people.length > 0 ? <PeopleStrip people={people} actor={actor} onPick={pick} now={now} /> : null}

      <section className="st-panel space-y-4" aria-labelledby="sp-feed-title">
        <div className="st-panel-head">
          <h2 id="sp-feed-title" className="st-h2">
            {who ? `What ${who.name} did` : "What staff did"}
          </h2>
          <label className="sr-only" htmlFor="sp-search">
            Search activity
          </label>
          <Input id="sp-search" type="search" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Search actions" className="max-w-xs" />
        </div>
        <div className="cx-chips flex flex-wrap gap-2" role="group" aria-label="Area">
          {["", ...areas.filter((a) => a !== "Sign-ins")].map((a) => (
            <button key={a || "all"} type="button" className="cx-chip cr-cut cr-focus" aria-pressed={area === a} onClick={() => setArea(a)}>
              {a || "Every area"}
            </button>
          ))}
          <label className="ml-auto inline-flex items-center gap-2 text-xs text-fg-muted">
            <input type="checkbox" className="sa-check !mt-0" checked={signIns} onChange={(e) => setSignIns(e.target.checked)} /> Show sign-ins
          </label>
        </div>
        {who ? (
          <p className="text-xs text-fg-muted">
            Only {who.name}.{" "}
            <button type="button" className="cr-focus underline" onClick={() => pick(null)}>
              Show everyone
            </button>
          </p>
        ) : null}
        {error ? <ErrorState message={error} /> : null}
        {items === null && !error ? <LoadingState label="Loading activity" /> : null}
        {items && items.length === 0 ? <p className="st-sub">Nothing matches.</p> : null}
        {items && items.length > 0
          ? groupByDay(items, now).map((day) => (
              <div key={day.heading}>
                <h3 className="sp-day">{day.heading}</h3>
                <ul className="sp-feed">
                  {day.items.map((item) => (
                    <ActivityRow key={item.id} item={item} showWho={!actor} />
                  ))}
                </ul>
              </div>
            ))
          : null}
        {next ? (
          <button type="button" className="st-ghost cr-focus" onClick={() => void load(next)} disabled={busy}>
            Show older
          </button>
        ) : null}
      </section>
    </div>
  );
}
