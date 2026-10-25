"use client";

/*
 * Pre-sales on Staff -> Commerce (owner, 2026-10-25, D-PRESALE-01). Finance staff paste or upload
 * the list of people who paid before launch (a Notion CSV, or rows copied from the table: email,
 * name, amount, date; other columns are ignored). Each buyer gets the song when their email
 * becomes a verified Corner Room account, and from then it counts as a normal sale. The server
 * checks finance.post in the product's label and records everything; nothing here decides money.
 */

import { useState } from "react";

import { DateTime, Field, Money, StatusChip } from "@/components/ds";
import { Button, Card, EmptyState, ErrorState, LoadingState, selectClasses } from "@/components/staff/kit";
import { useAsync } from "@/components/use-async";
import { cancelPresale, fetchPresales, uploadPresales, type PresaleRecord, type ProductRecord } from "@/features/commerce/api";
import { ApiError } from "@/lib/api/client";
import { defineStatusMap } from "@/lib/format/status";
import { parsePresaleList, presaleTotal, type ParsedPresales } from "@/lib/presale-view";

const PRESALE_STATUS = defineStatusMap({
  WAITING: { label: "Waiting for sign-up", tone: "warning" },
  CLAIMED: { label: "Has the song", tone: "positive" },
  CANCELLED: { label: "Removed", tone: "neutral" },
});

function PresaleRows({ productId, refreshKey }: { productId: string; refreshKey: number }) {
  const list = useAsync(() => fetchPresales(productId), [productId, refreshKey]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function remove(row: PresaleRecord) {
    setBusy(row.id);
    setError(null);
    try {
      await cancelPresale(row.id);
      list.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That could not be removed.");
    } finally {
      setBusy(null);
    }
  }

  if (list.status === "loading") return <LoadingState label="Loading the pre-sale list" />;
  if (list.status === "error") {
    return <ErrorState title="Pre-sales" message={list.error instanceof ApiError ? list.error.message : "The pre-sale list could not be loaded."} />;
  }
  const { items, totals } = list.data;
  if (items.length === 0) return <EmptyState message="No pre-sale buyers listed for this yet." />;
  return (
    <div className="space-y-3">
      {Object.entries(totals).map(([currency, t]) => (
        <p key={currency} className="text-sm text-fg">
          <span className="font-semibold">{t.claimed}</span> of <span className="font-semibold">{t.buyers}</span> buyers have the song ·{" "}
          <Money value={{ amount_minor: t.claimed_amount_minor, currency_code: currency }} minorDigits="always" /> of{" "}
          <Money value={{ amount_minor: t.amount_minor, currency_code: currency }} minorDigits="always" /> counted as sales
        </p>
      ))}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <ul>
        {items.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-line py-3 first:border-t-0">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-fg">{row.buyer_name ?? row.email}</p>
              <p className="truncate text-xs text-fg-muted">
                {row.email}
                {row.paid_on ? (
                  <>
                    {" · paid "}
                    <DateTime value={row.paid_on} format="date" />
                  </>
                ) : null}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Money value={{ amount_minor: row.amount_minor, currency_code: row.currency_code }} minorDigits="always" className="text-sm text-fg" />
              <StatusChip value={row.status} map={PRESALE_STATUS} />
              {row.status === "WAITING" ? (
                <Button type="button" size="sm" variant="ghost" disabled={busy !== null} onClick={() => void remove(row)}>
                  {busy === row.id ? "Removing" : "Remove"}
                </Button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Presales({ products }: { products: ProductRecord[] }) {
  const music = products.filter((p) => (p.product_type === "TRACK" || p.product_type === "RELEASE") && p.status !== "RETIRED");
  const [productId, setProductId] = useState("");
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<ParsedPresales | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  function read(next: string) {
    setText(next);
    setMessage(null);
    setParsed(next.trim() ? parsePresaleList(next) : null);
  }

  async function readFile(file: File | undefined) {
    if (file) read(await file.text());
  }

  async function send() {
    if (!parsed || !productId) return;
    setBusy(true);
    setError(null);
    try {
      const result = await uploadPresales(productId, parsed.rows);
      setMessage(
        `Added ${result.added} buyer${result.added === 1 ? "" : "s"}` +
          (result.claimed_now ? `; ${result.claimed_now} already had an account and now have the song` : "") +
          (result.skipped.length ? `; ${result.skipped.length} were already listed and were skipped` : "") +
          ".",
      );
      setText("");
      setParsed(null);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The list could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="presales-title" className="space-y-3">
      <h2 id="presales-title" className="text-lg font-semibold text-fg">
        Pre-sales
      </h2>
      <p className="text-sm text-fg-muted">
        People who paid before launch. Each buyer gets the song when they sign up and verify with the same email (or continue with Google), and it then counts as
        a sale. Only email, name, amount and date are read; leave phone numbers and addresses out.
      </p>
      <Card className="space-y-4">
        <Field label="Song or release">
          {(c) => (
            <select {...c} className={selectClasses} value={productId} onChange={(e) => setProductId(e.target.value)}>
              <option value="">Choose…</option>
              {music.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.product_type === "RELEASE" ? "release" : "song"})
                </option>
              ))}
            </select>
          )}
        </Field>
        {productId ? (
          <>
            <Field label="Paste the list (first row: column names such as Email, Name, Amount, Date)">
              {(c) => (
                <textarea
                  {...c}
                  rows={6}
                  value={text}
                  onChange={(e) => read(e.target.value)}
                  className="w-full border border-line bg-transparent p-3 font-mono text-xs text-fg"
                  placeholder={"Email,Name,Amount,Date\nbuyer@example.com,Buyer Name,250,2026-09-01"}
                />
              )}
            </Field>
            <label className="block text-sm text-fg">
              Or upload a CSV file{" "}
              <input type="file" accept=".csv,text/csv,text/plain" className="text-sm" onChange={(e) => void readFile(e.target.files?.[0])} />
            </label>
            {parsed ? (
              <div className="space-y-2 text-sm">
                <p className="text-fg">
                  Ready to add <span className="font-semibold">{parsed.rows.length}</span> buyer{parsed.rows.length === 1 ? "" : "s"}, total{" "}
                  <Money value={{ amount_minor: presaleTotal(parsed.rows), currency_code: "BDT" }} minorDigits="always" />.
                </p>
                {parsed.problems.length ? (
                  <ul className="space-y-1 text-danger" role="alert">
                    {parsed.problems.map((p) => (
                      <li key={`${p.line}-${p.message}`}>{p.message}</li>
                    ))}
                  </ul>
                ) : null}
                <Button type="button" disabled={busy || parsed.rows.length === 0} onClick={() => void send()}>
                  {busy ? "Adding" : `Add ${parsed.rows.length} buyer${parsed.rows.length === 1 ? "" : "s"}`}
                </Button>
              </div>
            ) : null}
            {message ? (
              <p role="status" className="text-sm text-success">
                {message}
              </p>
            ) : null}
            {error ? (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            ) : null}
            <PresaleRows productId={productId} refreshKey={refreshKey} />
          </>
        ) : null}
      </Card>
    </section>
  );
}
