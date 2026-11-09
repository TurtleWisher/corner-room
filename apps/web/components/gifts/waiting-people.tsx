"use client";

/*
 * People the act added by hand, waiting for Corner Room (owner, 2026-11-07, D-CAMPAIGN-04). Staff
 * approve them (they then count like any buyer) or turn them away (they are removed); the act sees
 * them as waiting and can take back a mistake. The API decides who may do what.
 */

import { useState } from "react";
import { Check, CircleAlert, Hourglass, X } from "lucide-react";

import { Button, Card } from "@/components/ds";
import { NoMatch, SearchField } from "@/components/studio-kit";
import { removeGiftPerson, reviewGiftPeople, type GiftCampaignDetail } from "@/features/gifts/api";
import { ApiError } from "@/lib/api/client";
import { searchList } from "@/lib/list-search-view";

export function WaitingPeople({ c, onChange }: { c: GiftCampaignDetail; onChange: (next: GiftCampaignDetail) => void }) {
  const waiting = c.waiting ?? [];
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  if (!waiting.length) return null;
  const listed = searchList(waiting, query, (w) => [w.name, w.email, w.phone, w.address]);
  const staff = Boolean(c.can_review);
  const ids = [...chosen].filter((id) => waiting.some((w) => w.id === id));

  const run = async (key: string, fn: () => Promise<GiftCampaignDetail>) => {
    setBusy(key);
    setError(null);
    try {
      onChange(await fn());
      setChosen(new Set());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That didn't go through. Please try again.");
    } finally {
      setBusy(null);
    }
  };
  const pick = (id: string) => setChosen((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set([...s, id])));

  return (
    <Card className="grid gap-4 p-5" aria-label="People waiting for Corner Room">
      <div>
        <h4 className="flex items-center gap-2 text-base font-bold text-fg">
          <Hourglass aria-hidden="true" className="size-4 text-highlight" /> Waiting for Corner Room ({waiting.length})
        </h4>
        <p className="mt-1 text-sm text-fg-muted">
          {staff
            ? "Added by the artist's team. Approve the ones who really bought, and they count like any buyer."
            : "They count once Corner Room approves them. You can take back anyone added by mistake."}
        </p>
      </div>
      {waiting.length > 4 ? <SearchField value={query} onChange={setQuery} label="Search people waiting" placeholder="Search by name, email, phone or address" /> : null}
      {query && !listed.length ? <NoMatch query={query} onClear={() => setQuery("")} /> : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] table-fixed text-left text-sm">
          <thead className="text-xs text-fg-muted">
            <tr className="border-b border-line">
              {staff ? (
                <th className="w-8 py-2">
                  <input
                    type="checkbox"
                    aria-label="Choose everyone waiting"
                    checked={ids.length === waiting.length}
                    onChange={(e) => setChosen(e.target.checked ? new Set(waiting.map((w) => w.id)) : new Set())}
                  />
                </th>
              ) : null}
              <th className="w-[24%] py-2 pr-3 font-semibold">Name</th>
              <th className="w-[26%] py-2 pr-3 font-semibold">Email</th>
              <th className="w-[18%] py-2 pr-3 font-semibold">Phone</th>
              <th className="py-2 pr-3 font-semibold">Address</th>
              {staff ? null : (
                <th className="w-24 py-2">
                  <span className="sr-only">Take back</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {listed.map((w) => (
              <tr key={w.id} className="border-b border-line align-top">
                {staff ? (
                  <td className="py-2">
                    <input type="checkbox" aria-label={`Choose ${w.name ?? w.email ?? w.phone ?? "this person"}`} checked={chosen.has(w.id)} onChange={() => pick(w.id)} />
                  </td>
                ) : null}
                <td className="py-2 pr-3 text-fg">
                  {w.name ?? <span className="text-fg-muted">No name</span>}
                  {w.has_account ? <span className="block text-xs text-fg-muted">Has a Corner Room account</span> : null}
                </td>
                <td className="py-2 pr-3 text-fg">{w.email ?? <span className="text-fg-muted">None</span>}</td>
                <td className="py-2 pr-3 text-fg">{w.phone ?? <span className="text-fg-muted">None</span>}</td>
                <td className="py-2 pr-3 text-fg">{w.address ?? <span className="text-fg-muted">None</span>}</td>
                {staff ? null : (
                  <td className="py-2">
                    <Button size="sm" variant="ghost" busy={busy === w.id} onClick={() => void run(w.id, () => removeGiftPerson(c.id, w.id))}>
                      Take back
                    </Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {staff ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" busy={busy === "approve"} disabled={!ids.length} onClick={() => void run("approve", () => reviewGiftPeople(c.id, ids, "approve"))}>
            <Check aria-hidden="true" /> Approve {ids.length || ""}
          </Button>
          <Button size="sm" variant="secondary" busy={busy === "reject"} disabled={!ids.length} onClick={() => void run("reject", () => reviewGiftPeople(c.id, ids, "reject"))}>
            <X aria-hidden="true" /> Turn away {ids.length || ""}
          </Button>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="flex items-center gap-2 text-sm text-danger">
          <CircleAlert aria-hidden="true" className="size-4" /> {error}
        </p>
      ) : null}
    </Card>
  );
}
