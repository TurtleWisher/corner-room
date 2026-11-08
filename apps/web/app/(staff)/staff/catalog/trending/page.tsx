"use client";

/* Trending Corner (owner, 2026-11-08, D-TRENDING-01): catalog staff choose the music shown in the
 * home page's turning carousel, with each one's sales and listens beside it to help. Nothing is
 * ranked by a formula. Only released music shows on the home page, in the order set here. */

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, CircleAlert, Plus, Search, Trash2 } from "lucide-react";

import { CoverArt } from "@/components/brand/cover-art";
import { Button, Card, EmptyState, ErrorState, Input, LoadingState, Protected } from "@/components/staff/kit";
import { useCredits } from "@/components/music/credits";
import {
  addTrendingPick,
  fetchStaffTrending,
  orderTrendingPicks,
  removeTrendingPick,
  type StaffTrending,
  type StaffTrendingEntry,
} from "@/features/trending/api";
import { coverUrl } from "@/lib/cover-view";
import { friendlyError } from "@/lib/error-copy";
import { formatCount } from "@/lib/format/count";
import { creditName } from "@/lib/music-view";
import { kindLabel, movePick } from "@/lib/trending-view";

function Thumb({ entry }: { entry: StaffTrendingEntry }) {
  const src = entry.release_id ? coverUrl({ release: entry.release_id, hasCover: entry.has_cover }, 160) : null;
  return (
    <CoverArt
      src={src}
      fallback={<span className="grid size-full place-items-center bg-muted text-xs font-bold text-muted-foreground">{entry.title.slice(0, 2)}</span>}
      className="size-12 shrink-0 overflow-hidden rounded-full"
    />
  );
}

function Numbers({ entry }: { entry: StaffTrendingEntry }) {
  return (
    <span className="text-sm tabular-nums text-muted-foreground">
      {formatCount(entry.sold)} sold
      {entry.refunded > 0 ? ` (${formatCount(entry.refunded)} refunded)` : ""} · {formatCount(entry.listens)} {entry.listens === 1 ? "listen" : "listens"}
    </span>
  );
}

export default function TrendingPicksPage() {
  const credits = useCredits();
  const [data, setData] = useState<StaffTrending | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");

  const load = useCallback(() => {
    setError(null);
    fetchStaffTrending(search)
      .then(setData)
      .catch((err) => setError(friendlyError(err, "Trending Corner couldn't be loaded. It needs the right to approve music in this workspace.")));
  }, [search]);

  useEffect(() => load(), [load]);

  async function run(action: () => Promise<StaffTrending | void>) {
    setBusy(true);
    setError(null);
    try {
      const next = await action();
      if (next) setData(next);
      else load();
    } catch (err) {
      setError(friendlyError(err, "That didn't work. Reload and try again."));
      load();
    } finally {
      setBusy(false);
    }
  }

  const who = (e: StaffTrendingEntry) => creditName(e, credits.artists, credits.bands);
  const picks = data?.picks ?? [];
  const full = data ? picks.length >= data.max_picks : false;
  const candidates = useMemo(() => data?.candidates ?? [], [data]);

  return (
    <Protected>
      <div className="grid gap-6">
        <div>
          <h1 className="text-2xl font-bold">Trending Corner</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Choose the music selling and being heard the most. It turns in the carousel on the home page in this order, first in front. Only released music shows there.
          </p>
        </div>

        {error ? <ErrorState message={error} /> : null}

        <Card className="p-5">
          <h2 className="text-lg font-semibold">On the home page</h2>
          {data === null && !error ? (
            <LoadingState />
          ) : picks.length === 0 ? (
            <EmptyState message="Nothing picked yet. While it is empty, the home page leaves the section out." />
          ) : (
            <ol className="mt-3 divide-y">
              {picks.map((p, i) => (
                <li key={p.pick_id} className="flex flex-wrap items-center gap-3 py-3">
                  <span className="w-6 text-right text-sm font-semibold tabular-nums">{i + 1}</span>
                  <Thumb entry={p} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{p.title}</span>
                    <span className="block text-sm text-muted-foreground">
                      {kindLabel(p)}
                      {who(p) ? ` · ${who(p)}` : ""}
                    </span>
                    <Numbers entry={p} />
                    {!p.is_out ? (
                      <span className="mt-1 flex items-center gap-1 text-sm font-semibold text-red-600">
                        <CircleAlert aria-hidden="true" className="size-4" /> Not out any more: hidden from the home page
                      </span>
                    ) : null}
                  </span>
                  <span className="flex gap-1">
                    <Button size="sm" variant="outline" aria-label={`Move ${p.title} up`} disabled={busy || i === 0} onClick={() => void run(() => orderTrendingPicks(movePick(picks.map((x) => x.pick_id), i, -1)))}>
                      <ArrowUp aria-hidden="true" className="size-4" />
                    </Button>
                    <Button size="sm" variant="outline" aria-label={`Move ${p.title} down`} disabled={busy || i === picks.length - 1} onClick={() => void run(() => orderTrendingPicks(movePick(picks.map((x) => x.pick_id), i, 1)))}>
                      <ArrowDown aria-hidden="true" className="size-4" />
                    </Button>
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => removeTrendingPick(p.pick_id))}>
                      <Trash2 aria-hidden="true" className="size-4" /> Take out
                    </Button>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="text-lg font-semibold">Released music in this workspace</h2>
          <p className="mt-1 text-sm text-muted-foreground">Most sold first, then most heard.</p>
          <form
            className="mt-3 flex max-w-md gap-2"
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              setSearch(query);
            }}
          >
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a song or release" aria-label="Find a song or release" />
            <Button type="submit" variant="outline">
              <Search aria-hidden="true" className="size-4" /> Find
            </Button>
          </form>
          {data === null && !error ? (
            <LoadingState />
          ) : candidates.length === 0 ? (
            <EmptyState message={search ? "Nothing released matches that." : "No released music in this workspace yet."} />
          ) : (
            <ul className="mt-3 divide-y">
              {candidates.map((c) => (
                <li key={`${c.kind}-${c.id}`} className="flex flex-wrap items-center gap-3 py-3">
                  <Thumb entry={c} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{c.title}</span>
                    <span className="block text-sm text-muted-foreground">
                      {kindLabel(c)}
                      {who(c) ? ` · ${who(c)}` : ""}
                    </span>
                    <Numbers entry={c} />
                  </span>
                  {c.picked ? (
                    <span className="text-sm font-semibold text-muted-foreground">On the home page</span>
                  ) : (
                    <Button size="sm" disabled={busy || full} title={full ? `Trending Corner holds ${data?.max_picks} at most` : undefined} onClick={() => void run(() => addTrendingPick(c.kind, c.id))}>
                      <Plus aria-hidden="true" className="size-4" /> Add
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </Protected>
  );
}
