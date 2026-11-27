"use client";

/*
 * Customers and users, the board (owner, 2026-11-27, D-CUSTOMERS-03): tiles and chips by payment
 * state, instant search, more filters, and the people list newest activity first, each row opening
 * the person's page. Used by /staff/customers and the sample board /theme-kit/customers; the page
 * loads the data and draws the "whose list" pickers.
 */

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Download, RefreshCw, Search, SlidersHorizontal } from "lucide-react";

import { DateTime, Field, Money } from "@/components/ds";
import { useSpotlight } from "@/components/ds/spotlight";
import { LiveDot, PersonMark, StatTile, TonePill, useNow } from "@/components/staff/customers-kit";
import { Button, EmptyState, Input, selectClasses } from "@/components/staff/kit";
import type { CustomerList } from "@/features/commerce/api";
import {
  activityOf,
  displayName,
  freshKeys,
  isRecent,
  lastActivityLine,
  matchesChip,
  paymentLabel,
  paymentShort,
  paymentTone,
  profileHref,
  searchRows,
  statusCounts,
  timeAgo,
  type StatusChipKey,
} from "@/lib/customer-profile-view";
import {
  ACCOUNT_TYPE_LABEL,
  customersCsv,
  filterCustomers,
  followersCsv,
  NO_FILTERS,
  PAYMENT_STATUS_LABEL,
  type AccountType,
  type CustomerFilters,
  type CustomerRow,
  type FollowerRow,
  type PaymentStatus,
} from "@/lib/customers-view";
import { formatCount } from "@/lib/format/count";

function save(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const PAGE = 60;

/** The six raised tiles; the rest of the states are chips under the search. */
const TILES: { key: StatusChipKey; label: string; hint: string }[] = [
  { key: "all", label: "Everyone", hint: "Accounts and pre-sale buyers" },
  { key: "active_now", label: "Active now", hint: "Did something in the last 30 min" },
  { key: "PAID", label: "Paid", hint: "At least one paid order" },
  { key: "WAITING", label: "Waiting for check", hint: "Sent a payment, not checked yet" },
  { key: "NOT_SENT", label: "Opened, didn't pay", hint: "On the payment page, nothing sent" },
  { key: "REJECTED", label: "Rejected", hint: "A payment staff turned down" },
];
const CHIPS: StatusChipKey[] = ["EXPIRED", "REFUNDED", "none"];
const CHIP_LABEL: Record<string, string> = { EXPIRED: "Expired unpaid", REFUNDED: "Refunded", none: "Never ordered" };
const TILE_TONE: Partial<Record<StatusChipKey, "positive" | "warning" | "negative" | "neutral" | "info">> = {
  active_now: "positive",
  PAID: "positive",
  WAITING: "warning",
  NOT_SENT: "neutral",
  REJECTED: "negative",
};

function Filters({ value, onChange }: { value: CustomerFilters; onChange: (f: CustomerFilters) => void }) {
  const set = (patch: Partial<CustomerFilters>) => onChange({ ...value, ...patch });
  return (
    <fieldset className="grid gap-3 pt-3 sm:grid-cols-2 lg:grid-cols-4">
      <legend className="sr-only">More filters</legend>
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
      <Field label="Email confirmed">
        {(c) => (
          <select {...c} className={selectClasses} value={value.verified} onChange={(e) => set({ verified: e.target.value as CustomerFilters["verified"] })}>
            <option value="any">Any</option>
            <option value="yes">Confirmed</option>
            <option value="no">Not confirmed</option>
          </select>
        )}
      </Field>
      <Field label="Joined from">{(c) => <Input {...c} type="date" value={value.joinedFrom} onChange={(e) => set({ joinedFrom: e.target.value })} />}</Field>
      <Field label="Joined until">{(c) => <Input {...c} type="date" value={value.joinedTo} onChange={(e) => set({ joinedTo: e.target.value })} />}</Field>
      <Field label="At least this many paid orders">
        {(c) => (
          <Input {...c} type="number" min={0} inputMode="numeric" value={value.minOrders} onChange={(e) => set({ minOrders: Math.max(0, Number(e.target.value) || 0) })} />
        )}
      </Field>
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2 pb-1 text-sm text-fg">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={value.hasPhone} onChange={(e) => set({ hasPhone: e.target.checked })} /> Has a phone
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={value.hasAddress} onChange={(e) => set({ hasAddress: e.target.checked })} /> Has an address
        </label>
        <Button type="button" size="sm" variant="ghost" onClick={() => onChange(NO_FILTERS)}>
          Clear filters
        </Button>
      </div>
    </fieldset>
  );
}

function activeFilterCount(f: CustomerFilters): number {
  return (Object.keys(NO_FILTERS) as (keyof CustomerFilters)[]).filter((k) => f[k] !== NO_FILTERS[k]).length;
}

function PersonRow({ row, now, fresh, i }: { row: CustomerRow; now: Date; fresh: boolean; i: number }) {
  const name = displayName(row);
  const recent = isRecent(row.last_activity_at, now);
  const ago = timeAgo(row.last_activity_at, now);
  const tone = activityOf(row.last_activity)?.tone ?? "neutral";
  const spent = Object.entries(row.spent);
  const when = row.last_activity_at ? (ago ?? <DateTime value={row.last_activity_at} format="date" />) : null;
  return (
    <Link
      href={profileHref(row.key)}
      className="cx-person"
      data-new={fresh || undefined}
      style={{ "--i": Math.min(i, 12) } as React.CSSProperties}
      aria-label={`${name}: ${lastActivityLine(row.last_activity, row.last_activity_items)}`}
    >
      <div className="cx-who">
        <PersonMark name={name} seed={row.key} src={row.picture_url} />
        <div className="cx-who-text">
          <span className="cx-name">
            {name}
            {row.manages?.length ? <span className="font-normal text-fg-muted"> · {row.manages.join(", ")}</span> : null}
          </span>
          <span className="cx-sub">
            {row.email ?? "No email"}
            {row.user_id && !row.email_verified ? " · not confirmed" : ""}
            {!row.user_id ? " · no account yet" : ""}
          </span>
        </div>
      </div>
      <div className="cx-col">
        <TonePill tone={paymentTone(row.payment_status)} title={paymentLabel(row.payment_status)}>
          {paymentShort(row.payment_status)}
        </TonePill>
        <span className="cx-sub">
          {row.user_id ? (row.account_types ?? []).map((t) => ACCOUNT_TYPE_LABEL[t] ?? t).join(", ") : "Pre-sale sheet"}
        </span>
      </div>
      <div className="cx-col">
        <span className="cx-activity">{lastActivityLine(row.last_activity, row.last_activity_items)}</span>
        {when ? (
          <span className="cx-when">
            {recent ? <LiveDot /> : <span className="cx-dot" data-tone={tone} aria-hidden="true" />}
            {when}
          </span>
        ) : null}
      </div>
      <div className="cx-col cx-num">
        <span>
          {formatCount(row.orders)} paid {row.orders === 1 ? "order" : "orders"}
        </span>
        <span className="cx-sub">
          {spent.length
            ? spent.map(([code, amount]) => <Money key={code} value={{ amount_minor: amount, currency_code: code }} minorDigits="always" className="block" />)
            : "Nothing spent"}
        </span>
      </div>
      <ChevronRight aria-hidden="true" className="cx-chev hidden md:block" />
      <div className="cx-mobile-meta">
        <TonePill tone={paymentTone(row.payment_status)} title={paymentLabel(row.payment_status)}>
          {paymentShort(row.payment_status)}
        </TonePill>
        <span>{lastActivityLine(row.last_activity, row.last_activity_items)}</span>
        {when ? (
          <span className="cx-when">
            {recent ? <LiveDot /> : null}
            {when}
          </span>
        ) : null}
      </div>
    </Link>
  );
}

export function CustomersBoard({
  customers,
  followers,
  scope,
  onRefresh,
  refreshing = false,
  csvName,
  now: fixedNow,
}: {
  customers: CustomerList | null;
  followers: FollowerRow[] | null;
  /** The "whose list" pickers, drawn beside the search. */
  scope: React.ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
  csvName: string;
  /** A fixed clock for the sample board; the page lets it tick. */
  now?: Date;
}) {
  const [q, setQ] = useState("");
  const [chip, setChip] = useState<StatusChipKey>("all");
  const [filters, setFilters] = useState<CustomerFilters>(NO_FILTERS);
  const [more, setMore] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const previous = useRef<CustomerRow[] | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const spotRef = useSpotlight<HTMLDivElement>();
  const ticking = useNow();
  const now = fixedNow ?? ticking;
  const isFollowers = followers !== null;

  // Light up whoever did something new since the last load; remember when it was loaded.
  const rows = customers?.items ?? null;
  useEffect(() => {
    if (!rows) return;
    setFresh(freshKeys(previous.current, rows));
    previous.current = rows;
    setLoadedAt(new Date());
  }, [rows]);

  // "/" jumps to the search, like the rest of the staff console.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key !== "/" || (t && (t.closest("input, textarea, select") || t.isContentEditable))) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const filtered = useMemo(() => (rows ? searchRows(filterCustomers(rows, filters), q) : []), [rows, filters, q]);
  const counts = useMemo(() => statusCounts(filtered, now), [filtered, now]);
  const shown = useMemo(() => filtered.filter((r) => matchesChip(r, chip, now)), [filtered, chip, now]);
  useEffect(() => setLimit(PAGE), [chip, q, filters, customers]);
  const nFilters = activeFilterCount(filters);
  const updated = loadedAt ? timeAgo(loadedAt.toISOString(), fixedNow ? loadedAt : now) : null;

  return (
    <div className="cx" data-module="customers" ref={spotRef}>
      <header className="cx-head">
        <div>
          <p className="cx-eyebrow">Money · People</p>
          <h1 className="cx-title">Customers and users</h1>
          <p className="cx-lede">
            Everyone with a Corner Room account and every pre-sale buyer. Whoever did something last is at the top: opened the payment page,
            sent a payment, paid, or joined. Open anyone to see their whole history. Personal details: handle with care; every view is recorded in
            the audit log.
          </p>
        </div>
        <div className="cx-toolbar">
          {onRefresh ? (
            <button type="button" className="cx-ghost cr-cut cr-focus" onClick={onRefresh} disabled={refreshing}>
              <RefreshCw aria-hidden="true" className="size-4" />
              Refresh
            </button>
          ) : null}
          {customers ? (
            <button
              type="button"
              className="cx-lamp cr-cut cr-focus"
              disabled={shown.length === 0}
              onClick={() => save(customersCsv(shown), csvName)}
            >
              <Download aria-hidden="true" className="size-4" /> Download CSV ({formatCount(shown.length)})
            </button>
          ) : null}
          {followers ? (
            <button
              type="button"
              className="cx-lamp cr-cut cr-focus"
              disabled={followers.length === 0}
              onClick={() => save(followersCsv(followers), csvName)}
            >
              <Download aria-hidden="true" className="size-4" /> Download CSV
            </button>
          ) : null}
        </div>
      </header>

      {!isFollowers && rows ? (
        <div className="cx-tiles" role="group" aria-label="Show people by payment state">
          {TILES.map((t, i) => (
            <StatTile
              key={t.key}
              label={t.label}
              value={formatCount(counts[t.key])}
              hint={t.hint}
              tone={TILE_TONE[t.key]}
              pressed={chip === t.key}
              onPress={() => setChip(chip === t.key && t.key !== "all" ? "all" : t.key)}
              style={{ "--i": i } as React.CSSProperties}
            />
          ))}
        </div>
      ) : null}

      <section className="cx-glass cr-cut cx-pad" data-spot aria-label="Find people">
        <div className="cx-toolbar">
          {!isFollowers ? (
            <label className="cx-search cr-cut">
              <Search aria-hidden="true" />
              <span className="sr-only">Search people</span>
              <input
                ref={searchRef}
                type="search"
                value={q}
                maxLength={200}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setQ("");
                }}
                placeholder="Name, email, phone, address, act, song, transaction ID or paid-from number"
              />
              {q ? null : <kbd className="cx-kbd">/</kbd>}
            </label>
          ) : null}
          <div className="flex min-w-0 flex-1 basis-full flex-wrap gap-2 sm:flex-none sm:basis-auto">{scope}</div>
          {!isFollowers ? (
            <button type="button" className="cx-ghost cr-cut cr-focus" aria-expanded={more} aria-controls="cx-more" onClick={() => setMore(!more)}>
              <SlidersHorizontal aria-hidden="true" className="size-4" />
              More filters{nFilters ? ` (${nFilters})` : ""}
            </button>
          ) : null}
        </div>
        {!isFollowers ? (
          <div id="cx-more" className="cx-fold" data-open={more || undefined}>
            <div inert={!more}>
              <Filters value={filters} onChange={setFilters} />
            </div>
          </div>
        ) : null}
        {!isFollowers && rows ? (
          <div className="cx-chips mt-3" role="group" aria-label="More payment states">
            {CHIPS.map((k) => (
              <button key={k} type="button" className="cx-chip cr-cut cr-focus" aria-pressed={chip === k} onClick={() => setChip(chip === k ? "all" : k)}>
                {CHIP_LABEL[k]} <span className="cx-chip-count">{formatCount(counts[k])}</span>
              </button>
            ))}
          </div>
        ) : null}
      </section>

      {followers ? (
        <section className="cx-glass cr-cut" aria-label="Followers">
          <p className="cx-pad text-sm">
            <span className="font-semibold">{formatCount(followers.length)}</span> followers
          </p>
          {followers.length === 0 ? (
            <div className="cx-pad">
              <EmptyState message="No followers yet." />
            </div>
          ) : (
            <div className="cx-list">
              {followers.map((f) => (
                <Link key={f.user_id} href={profileHref(f.user_id)} className="cx-person">
                  <div className="cx-who">
                    <PersonMark name={f.name ?? f.email ?? "?"} seed={f.user_id} src={f.picture_url} />
                    <div className="cx-who-text">
                      <span className="cx-name">{f.name ?? "No name"}</span>
                      <span className="cx-sub">{f.email}</span>
                    </div>
                  </div>
                  <div className="cx-col">
                    <span className="cx-sub">Followed</span>
                  </div>
                  <div className="cx-col">{f.followed_at ? <DateTime value={f.followed_at} format="date" /> : null}</div>
                  <div className="cx-col" />
                  <ChevronRight aria-hidden="true" className="cx-chev hidden md:block" />
                </Link>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {customers ? (
        <section className="cx-glass cr-cut" aria-labelledby="cx-people-title">
          <div className="cx-pad flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="cx-people-title" className="text-sm font-semibold">
              {formatCount(shown.length)} {shown.length === 1 ? "person" : "people"}
              <span className="font-normal text-fg-muted">
                {" "}
                of {formatCount(customers.total)} · {formatCount(customers.website_customers)} with an account ·{" "}
                {formatCount(customers.presale_buyers)} pre-sale buyers
              </span>
            </h2>
            <span className="cx-quiet" aria-live="polite">
              {updated ? `Updated ${updated}` : null}
              {customers.truncated ? " · the list is long: narrow it to see everyone" : ""}
            </span>
          </div>
          {shown.length === 0 ? (
            <div className="cx-pad">
              <EmptyState message={q ? `Nobody matches “${q}”.` : "Nobody here."} />
            </div>
          ) : (
            <>
              <div className="cx-list-head" aria-hidden="true">
                <span>Person</span>
                <span>Payment</span>
                <span>Last activity</span>
                <span className="text-right">Bought</span>
                <span />
              </div>
              <div className="cx-list">
                {shown.slice(0, limit).map((r, i) => (
                  <PersonRow key={r.key} row={r} now={now} fresh={fresh.has(r.key)} i={i} />
                ))}
              </div>
              {shown.length > limit ? (
                <div className="cx-more">
                  <button type="button" className="cx-ghost cr-cut cr-focus" onClick={() => setLimit(limit + PAGE)}>
                    Show {formatCount(Math.min(PAGE, shown.length - limit))} more
                  </button>
                </div>
              ) : null}
            </>
          )}
        </section>
      ) : null}
    </div>
  );
}
