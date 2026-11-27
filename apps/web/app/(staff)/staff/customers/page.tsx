"use client";

/*
 * Customers and users (owner, 2026-10-27, D-CUSTOMERS-01; 2026-10-28, D-CUSTOMERS-02; redesigned
 * 2026-11-27, D-CUSTOMERS-03): every Corner Room account and pre-sale buyer, newest activity first,
 * so whoever just opened the payment page or paid is at the top, with what they did in plain words.
 * Each person opens on their own page with their whole history. Raised tiles and chips filter by
 * payment state, search is instant, and the CSV downloads exactly what is shown. The server decides
 * who may see the list, counts every number and logs every view; nothing here changes anything.
 */

import { useEffect, useState } from "react";

import { CustomersBoard } from "@/components/staff/customer-list";
import { EmptyState, ErrorState, LoadingState, Protected, selectClasses } from "@/components/staff/kit";
import { useAsync } from "@/components/use-async";
import { fetchCustomers, fetchFollowers, type CustomerList, type CustomerScope } from "@/features/commerce/api";
import { fetchArtists, fetchBands, fetchPlayableCatalog, fetchPublicEvents, fetchReleases } from "@/lib/api";
import { ApiError } from "@/lib/api/client";
import { csvFileName, type FollowerRow } from "@/lib/customers-view";

type Mode = "all" | "artist" | "band" | "track" | "release" | "event" | "followers";

const MODES: { value: Mode; label: string }[] = [
  { value: "all", label: "Everyone" },
  { value: "artist", label: "Buyers of an artist" },
  { value: "band", label: "Buyers of a band" },
  { value: "release", label: "Buyers of a release" },
  { value: "track", label: "Buyers of a song" },
  { value: "event", label: "Ticket buyers of an event" },
  { value: "followers", label: "Followers of an artist or band" },
];

type Option = { id: string; label: string };

async function optionsFor(mode: Mode): Promise<Option[]> {
  if (mode === "artist") return (await fetchArtists()).items.map((a) => ({ id: a.id, label: a.stage_name }));
  if (mode === "band") return (await fetchBands()).items.map((b) => ({ id: b.id, label: b.name }));
  if (mode === "followers") {
    const [artists, bands] = await Promise.all([fetchArtists(), fetchBands()]);
    return [
      ...artists.items.map((a) => ({ id: `artist:${a.id}`, label: `${a.stage_name} (artist)` })),
      ...bands.items.map((b) => ({ id: `band:${b.id}`, label: `${b.name} (band)` })),
    ];
  }
  if (mode === "release") return (await fetchReleases()).items.map((r) => ({ id: r.id, label: r.title }));
  if (mode === "track") return (await fetchPlayableCatalog()).items.map((t) => ({ id: t.id, label: t.title }));
  if (mode === "event") return (await fetchPublicEvents()).items.map((e) => ({ id: e.id, label: e.title }));
  return [];
}

const today = () => new Date().toISOString().slice(0, 10);

function Customers() {
  const [mode, setMode] = useState<Mode>("all");
  const [target, setTarget] = useState("");
  const options = useAsync(() => optionsFor(mode), [mode]);
  useEffect(() => setTarget(""), [mode]);

  const ready = mode === "all" || target !== "";
  const list = useAsync(async (): Promise<{ customers: CustomerList | null; followers: FollowerRow[] | null }> => {
    if (!ready) return { customers: null, followers: null };
    if (mode === "followers") {
      const [kind, id] = target.split(":") as ["artist" | "band", string];
      return { customers: null, followers: (await fetchFollowers(kind, id)).items };
    }
    const scope: CustomerScope = mode === "all" ? { kind: "all" } : { kind: mode, id: target };
    return { customers: await fetchCustomers(scope), followers: null };
  }, [mode, target, ready]);

  // Coming back to the tab brings the list up to date (the newest payer moves to the top).
  const { reload } = list;
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") reload();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [reload]);

  const targetLabel = options.status === "ok" ? options.data.find((o) => o.id === target)?.label : undefined;
  const scope = (
    <>
      <label className="sr-only" htmlFor="cx-mode">
        Whose list
      </label>
      <select id="cx-mode" className={`${selectClasses} min-w-0 flex-1 sm:w-56`} value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
        {MODES.map((m) => (
          <option key={m.value} value={m.value}>
            {m.label}
          </option>
        ))}
      </select>
      {mode !== "all" ? (
        <>
          <label className="sr-only" htmlFor="cx-target">
            Choose
          </label>
          <select
            id="cx-target"
            className={`${selectClasses} min-w-0 flex-1 sm:w-56`}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            disabled={options.status !== "ok"}
          >
            <option value="">{options.status === "loading" ? "Loading…" : "Choose…"}</option>
            {options.status === "ok"
              ? options.data.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))
              : null}
          </select>
        </>
      ) : null}
    </>
  );
  const data = list.status === "ok" ? list.data : { customers: null, followers: null };
  return (
    <div className="grid gap-5">
      <CustomersBoard
        customers={data.customers}
        followers={data.followers}
        scope={scope}
        onRefresh={reload}
        refreshing={list.status === "loading"}
        csvName={csvFileName([mode === "followers" ? "followers" : "customers", mode === "all" ? "all" : targetLabel], today())}
      />
      {!ready ? <EmptyState message="Choose whose list to show." /> : null}
      {ready && list.status === "loading" ? <LoadingState label="Loading people" /> : null}
      {list.status === "error" ? (
        <ErrorState title="Customers" message={list.error instanceof ApiError ? list.error.message : "The list could not be loaded."} />
      ) : null}
    </div>
  );
}

export default function StaffCustomersPage() {
  return (
    <Protected>
      <Customers />
    </Protected>
  );
}
