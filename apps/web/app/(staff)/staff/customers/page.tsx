"use client";

/*
 * Customers and users (owner, 2026-10-27, D-CUSTOMERS-01; 2026-10-28, D-CUSTOMERS-02): every
 * Corner Room account (fans, artists, staff) and every pre-sale buyer, for admins and finance staff.
 * Everyone who tried to pay is here too, with their payment status and what they typed when paying.
 * Choose whose list (all, an artist or band, a song, a release, an event, or an artist's
 * followers), narrow it with filters, then download exactly what is shown as CSV. The server
 * decides who may see the list and logs every view; nothing here changes an account, an order or a
 * payment.
 */

import { useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";

import { DateTime, Field, Money } from "@/components/ds";
import { Button, Card, EmptyState, ErrorState, Input, LoadingState, Protected, selectClasses } from "@/components/staff/kit";
import { useAsync } from "@/components/use-async";
import { fetchCustomers, fetchFollowers, type CustomerList, type CustomerScope } from "@/features/commerce/api";
import { fetchArtists, fetchBands, fetchPlayableCatalog, fetchPublicEvents, fetchReleases } from "@/lib/api";
import { ApiError } from "@/lib/api/client";
import {
  ACCOUNT_TYPE_LABEL,
  csvFileName,
  customersCsv,
  filterCustomers,
  followersCsv,
  NO_FILTERS,
  PAYMENT_STATUS_LABEL,
  paymentLine,
  type AccountType,
  type CustomerFilters,
  type FollowerRow,
  type PaymentStatus,
} from "@/lib/customers-view";
import { formatCount } from "@/lib/format/count";

type Mode = "all" | "artist" | "band" | "track" | "release" | "event" | "followers";

const MODES: { value: Mode; label: string }[] = [
  { value: "all", label: "Everyone (all users and pre-sale buyers)" },
  { value: "artist", label: "Customers of an artist" },
  { value: "band", label: "Customers of a band" },
  { value: "release", label: "Customers of a release (single, EP, album)" },
  { value: "track", label: "Customers of a song" },
  { value: "event", label: "Customers of an event (ticket buyers)" },
  { value: "followers", label: "Followers of an artist or band" },
];

type Option = { id: string; label: string };

/** The choices for the second picker, loaded from the public lists. */
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

function save(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const today = () => new Date().toISOString().slice(0, 10);

function Filters({ value, onChange }: { value: CustomerFilters; onChange: (f: CustomerFilters) => void }) {
  const set = (patch: Partial<CustomerFilters>) => onChange({ ...value, ...patch });
  return (
    <fieldset className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <legend className="mb-2 text-sm font-semibold text-fg">Filters (applied before download)</legend>
      <Field label="Who">
        {(c) => (
          <select {...c} className={selectClasses} value={value.source} onChange={(e) => set({ source: e.target.value as CustomerFilters["source"] })}>
            <option value="any">Everyone</option>
            <option value="website">Has a Corner Room account</option>
            <option value="presale">Pre-sale buyers</option>
            <option value="both">Pre-sale buyers who signed up</option>
          </select>
        )}
      </Field>
      <Field label="Payment">
        {(c) => (
          <select {...c} className={selectClasses} value={value.payment} onChange={(e) => set({ payment: e.target.value as CustomerFilters["payment"] })}>
            <option value="any">Any</option>
            {(Object.keys(PAYMENT_STATUS_LABEL) as PaymentStatus[]).map((s) => (
              <option key={s} value={s}>
                {PAYMENT_STATUS_LABEL[s]}
              </option>
            ))}
            <option value="none">Never ordered</option>
          </select>
        )}
      </Field>
      <Field label="Account type">
        {(c) => (
          <select {...c} className={selectClasses} value={value.accountType} onChange={(e) => set({ accountType: e.target.value as CustomerFilters["accountType"] })}>
            <option value="any">Any</option>
            {(Object.keys(ACCOUNT_TYPE_LABEL) as AccountType[]).map((t) => (
              <option key={t} value={t}>
                {ACCOUNT_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Email verified">
        {(c) => (
          <select {...c} className={selectClasses} value={value.verified} onChange={(e) => set({ verified: e.target.value as CustomerFilters["verified"] })}>
            <option value="any">Any</option>
            <option value="yes">Verified</option>
            <option value="no">Not verified</option>
          </select>
        )}
      </Field>
      <Field label="Joined from">{(c) => <Input {...c} type="date" value={value.joinedFrom} onChange={(e) => set({ joinedFrom: e.target.value })} />}</Field>
      <Field label="Joined until">{(c) => <Input {...c} type="date" value={value.joinedTo} onChange={(e) => set({ joinedTo: e.target.value })} />}</Field>
      <Field label="At least this many orders">
        {(c) => (
          <Input {...c} type="number" min={0} inputMode="numeric" value={value.minOrders} onChange={(e) => set({ minOrders: Math.max(0, Number(e.target.value) || 0) })} />
        )}
      </Field>
      <label className="flex items-center gap-2 self-end pb-3 text-sm text-fg">
        <input type="checkbox" checked={value.hasPhone} onChange={(e) => set({ hasPhone: e.target.checked })} /> Has a phone number
      </label>
      <label className="flex items-center gap-2 self-end pb-3 text-sm text-fg">
        <input type="checkbox" checked={value.hasAddress} onChange={(e) => set({ hasAddress: e.target.checked })} /> Has an address
      </label>
      <div className="self-end pb-1">
        <Button type="button" size="sm" variant="ghost" onClick={() => onChange(NO_FILTERS)}>
          Clear filters
        </Button>
      </div>
    </fieldset>
  );
}

function Customers() {
  const [mode, setMode] = useState<Mode>("all");
  const [target, setTarget] = useState("");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<CustomerFilters>(NO_FILTERS);
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
    return { customers: await fetchCustomers(scope, query), followers: null };
  }, [mode, target, query, ready]);

  const shown = useMemo(
    () => (list.status === "ok" && list.data.customers ? filterCustomers(list.data.customers.items, filters) : []),
    [list, filters],
  );
  const targetLabel = options.status === "ok" ? options.data.find((o) => o.id === target)?.label : undefined;

  return (
    <section aria-labelledby="customers-title" className="space-y-5">
      <div>
        <h1 id="customers-title" className="text-xl font-semibold text-fg">
          Customers and users
        </h1>
        <p className="mt-1 text-sm text-fg-muted">
          Every account and pre-sale buyer in one list, including people whose payment is waiting, rejected or expired. Personal details:
          handle with care. Every view is recorded in the audit log.
        </p>
      </div>
      <Card className="space-y-4">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Field label="Whose list">
            {(c) => (
              <select {...c} className={selectClasses} value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
                {MODES.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
          {mode !== "all" ? (
            <Field label="Choose">
              {(c) => (
                <select {...c} className={selectClasses} value={target} onChange={(e) => setTarget(e.target.value)} disabled={options.status !== "ok"}>
                  <option value="">{options.status === "loading" ? "Loading…" : "Choose…"}</option>
                  {options.status === "ok"
                    ? options.data.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.label}
                        </option>
                      ))
                    : null}
                </select>
              )}
            </Field>
          ) : null}
        </div>
        {mode !== "followers" ? (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setQuery(q);
            }}
          >
            <div className="min-w-56 flex-1">
              <Field label="Search name, email, phone, address, artist, transaction ID or paid-from number">{(c) => <Input {...c} value={q} onChange={(e) => setQ(e.target.value)} maxLength={200} />}</Field>
            </div>
            <Button type="submit">Search</Button>
          </form>
        ) : null}
        {mode !== "followers" ? <Filters value={filters} onChange={setFilters} /> : null}
      </Card>

      {!ready ? <EmptyState message="Choose whose list to show." /> : null}
      {ready && list.status === "loading" ? <LoadingState label="Loading the list" /> : null}
      {list.status === "error" ? (
        <ErrorState title="Customers" message={list.error instanceof ApiError ? list.error.message : "The list could not be loaded."} />
      ) : null}

      {list.status === "ok" && list.data.followers ? (
        <Card className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-fg">
              <span className="font-semibold">{formatCount(list.data.followers.length)}</span> followers
            </p>
            <Button
              type="button"
              size="sm"
              disabled={list.data.followers.length === 0}
              onClick={() => save(followersCsv(list.data.followers ?? []), csvFileName(["followers", targetLabel], today()))}
            >
              <Download aria-hidden="true" className="size-4" /> Download CSV
            </Button>
          </div>
          {list.data.followers.length === 0 ? (
            <EmptyState message="No followers yet." />
          ) : (
            <ul className="divide-y divide-line">
              {list.data.followers.map((f) => (
                <li key={f.user_id} className="flex flex-wrap justify-between gap-3 py-2 text-sm">
                  <span className="font-semibold text-fg">{f.name ?? "No name"}</span>
                  <span className="text-fg-muted">{f.email}</span>
                  <span className="text-fg-muted">{f.followed_at ? <DateTime value={f.followed_at} format="date" /> : null}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}

      {list.status === "ok" && list.data.customers ? (
        <Card className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-fg">
              Showing <span className="font-semibold">{formatCount(shown.length)}</span> of {formatCount(list.data.customers.total)} ·{" "}
              {formatCount(list.data.customers.website_customers)} with an account · {formatCount(list.data.customers.presale_buyers)} pre-sale buyers
              {list.data.customers.truncated ? " · the list is long: narrow it to see everyone" : ""}
            </p>
            <Button
              type="button"
              size="sm"
              disabled={shown.length === 0}
              onClick={() => save(customersCsv(shown), csvFileName(["customers", mode === "all" ? "all" : targetLabel], today()))}
            >
              <Download aria-hidden="true" className="size-4" /> Download CSV ({formatCount(shown.length)})
            </Button>
          </div>
          {shown.length === 0 ? (
            <EmptyState message="Nobody matches." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[72rem] text-left text-sm">
                <thead className="text-xs text-fg-muted">
                  <tr className="border-b border-line">
                    <th className="py-2 pr-3 font-semibold">Name</th>
                    <th className="py-2 pr-3 font-semibold">Email</th>
                    <th className="py-2 pr-3 font-semibold">Phone</th>
                    <th className="py-2 pr-3 font-semibold">Address</th>
                    <th className="py-2 pr-3 font-semibold">Type</th>
                    <th className="py-2 pr-3 font-semibold">Payment</th>
                    <th className="py-2 pr-3 font-semibold">Source</th>
                    <th className="py-2 pr-3 font-semibold">Orders</th>
                    <th className="py-2 pr-3 font-semibold">Spent</th>
                    <th className="py-2 font-semibold">Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.key} className="border-b border-line align-top">
                      <td className="py-2 pr-3 font-semibold text-fg">
                        {r.name ?? "No name"}
                        {r.manages?.length ? <span className="block text-xs font-normal text-fg-muted">{r.manages.join(", ")}</span> : null}
                      </td>
                      <td className="py-2 pr-3 text-fg">
                        {r.email}
                        {r.user_id && !r.email_verified ? <span className="block text-xs text-fg-muted">not verified</span> : null}
                      </td>
                      <td className="py-2 pr-3 text-fg">{r.phone ?? <span className="text-fg-muted">None</span>}</td>
                      <td className="max-w-64 py-2 pr-3 text-fg">{r.address ?? <span className="text-fg-muted">None</span>}</td>
                      <td className="py-2 pr-3 text-fg">
                        {r.user_id ? (r.account_types ?? []).map((t) => ACCOUNT_TYPE_LABEL[t] ?? t).join(", ") : <span className="text-fg-muted">No account</span>}
                      </td>
                      <td className="max-w-80 py-2 pr-3 text-fg">
                        {r.payment_status ? <span className="font-semibold">{PAYMENT_STATUS_LABEL[r.payment_status]}</span> : <span className="text-fg-muted">Never ordered</span>}
                        {(r.payments ?? [])
                          .filter((p) => p.status !== "PAID" || p.transaction_ref)
                          .slice(0, 3)
                          .map((p) => (
                            <span key={p.order_id} className="block text-xs text-fg-muted">
                              {paymentLine(p)}
                            </span>
                          ))}
                      </td>
                      <td className="py-2 pr-3 text-fg">{r.sources.map((s) => (s === "PRESALE" ? "Pre-sale" : "Website")).join(" + ")}</td>
                      <td className="py-2 pr-3 text-fg">{r.orders}</td>
                      <td className="py-2 pr-3 text-fg">
                        {Object.entries(r.spent).length
                          ? Object.entries(r.spent).map(([code, amount]) => (
                              <Money key={code} value={{ amount_minor: amount, currency_code: code }} minorDigits="always" className="block" />
                            ))
                          : "None"}
                      </td>
                      <td className="py-2 text-fg">{r.joined_at ? <DateTime value={r.joined_at} format="date" /> : <span className="text-fg-muted">Not signed up</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}
    </section>
  );
}

export default function StaffCustomersPage() {
  return (
    <Protected>
      <Customers />
    </Protected>
  );
}
