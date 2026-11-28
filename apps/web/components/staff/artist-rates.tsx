"use client";

/*
 * Royalties > Artist rates (owner, 2026-11-28, D-ROYALTY-RATE-01). Staff set each artist's or band's
 * royalty percentage as agreed with them; it is a share of what the fan paid and applies to every
 * sale of their music. Each sale keeps the rate it was made at; sales made before any rate show
 * "No rate yet" and the admin may give them the new rate when saving. The server works out every
 * amount (earned = what was kept paid x rate, rounded down); this page formats what it sends.
 */

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CircleSlash, Percent, Save } from "lucide-react";

import { Button } from "@/components/ds";
import { Dialog } from "@/components/ds/dialog";
import { Money } from "@/components/ds/money";
import { PersonMark, StatTile, TonePill } from "@/components/staff/customers-kit";
import { ErrorState, Input, LoadingState } from "@/components/staff/kit";
import {
  endArtistRate,
  fetchArtistRate,
  fetchArtistRates,
  setArtistRate,
  type ArtistRateDetail,
  type ArtistRateRow,
} from "@/features/staff-portal/api";
import { ApiError } from "@/lib/api/client";
import { formatDate } from "@/lib/format/date";
import {
  RATE_FILTERS,
  bpsToPercent,
  coverEarlierWords,
  howWords,
  matchesRateFilter,
  percentProblem,
  percentToBps,
  rateLabel,
  rateMeaning,
  spanWords,
  type RateFilter,
} from "@/lib/royalty-rate-view";

function kindWord(kind: string): string {
  return kind === "BAND" ? "Band" : "Solo artist";
}

function RateForm({ detail, onSaved }: { detail: ArtistRateDetail; onSaved: (d: ArtistRateDetail, message: string) => void }) {
  const [text, setText] = React.useState(detail.share_bps === null ? "" : bpsToPercent(detail.share_bps));
  const [note, setNote] = React.useState("");
  const [cover, setCover] = React.useState(false);
  const [confirm, setConfirm] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const bps = percentToBps(text);
  const problem = percentProblem(text);
  const earlier = detail.earlier_without_rate.sales;
  const coverText = coverEarlierWords(earlier);
  const same = bps !== null && bps === detail.share_bps && !(cover && earlier > 0);

  async function save() {
    if (bps === null) return;
    setBusy(true);
    setError(null);
    try {
      const next = await setArtistRate(detail.artist_id, { share_bps: bps, note: note.trim() || undefined, cover_earlier: cover && earlier > 0 });
      onSaved(next, `${detail.name}'s rate is now ${bpsToPercent(bps)}%.`);
      setNote("");
      setCover(false);
      setConfirm(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The rate couldn't be saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!problem && !same) setConfirm(true);
      }}
    >
      <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
        <div>
          <label htmlFor="rr-percent" className="st-label">
            Royalty percentage
          </label>
          <div className="relative">
            <Input id="rr-percent" inputMode="decimal" autoComplete="off" value={text} onChange={(e) => setText(e.target.value)} placeholder="70" className="pr-8" />
            <Percent aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-fg-muted" />
          </div>
        </div>
        <div>
          <label htmlFor="rr-note" className="st-label">
            What was agreed (kept with the rate)
          </label>
          <Input id="rr-note" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} placeholder="For example: agreed with the artist on a call, 28 Nov" />
        </div>
      </div>
      <p className="text-sm text-fg-muted">{text.trim() && problem ? <span className="text-danger">{problem}</span> : rateMeaning(bps)}</p>
      {coverText ? (
        <label className="sa-area cr-cut" data-on={cover || undefined}>
          <input type="checkbox" className="sa-check" checked={cover} onChange={(e) => setCover(e.target.checked)} />
          <span>
            <span className="block font-semibold text-fg">{coverText}</span>
            <span className="block text-xs text-fg-muted">
              Leave it unticked to start the rate from now: those sales stay at &ldquo;No rate yet&rdquo;. Sales that already have a rate never change.
            </span>
          </span>
        </label>
      ) : null}
      {error ? <ErrorState title="Not saved" message={error} /> : null}
      <Button type="submit" disabled={Boolean(problem) || same}>
        <Save aria-hidden="true" /> {detail.share_bps === null ? "Set rate" : "Change rate"}
      </Button>
      {same && !problem ? <p className="text-xs text-fg-muted">That is already the rate.</p> : null}
      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title={`Set ${detail.name}'s rate to ${bps === null ? "" : bpsToPercent(bps)}%?`}
        description={
          cover && earlier > 0
            ? `It applies to every sale from now on, and to the ${earlier} earlier ${earlier === 1 ? "sale" : "sales"} with no rate yet.`
            : "It applies to every sale from now on. Earlier sales keep the rate they were made at."
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button onClick={() => void save()} busy={busy}>
              Save rate
            </Button>
          </>
        }
      />
    </form>
  );
}

function StopRate({ detail, onSaved }: { detail: ArtistRateDetail; onSaved: (d: ArtistRateDetail, message: string) => void }) {
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  if (detail.share_bps === null) return null;
  async function stop() {
    setBusy(true);
    try {
      onSaved(await endArtistRate(detail.artist_id), `${detail.name} has no rate from now on.`);
      setOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The rate couldn't be stopped.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button type="button" className="st-ghost cr-focus" onClick={() => setOpen(true)}>
        <CircleSlash aria-hidden="true" className="size-3.5" /> Stop this rate
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Stop ${detail.name}'s rate?`}
        description="Sales from now on will show No rate yet until a new rate is set. Earlier sales keep their rate."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Keep it
            </Button>
            <Button variant="danger" onClick={() => void stop()} busy={busy}>
              Stop rate
            </Button>
          </>
        }
      >
        {error ? <ErrorState message={error} /> : null}
      </Dialog>
    </>
  );
}

function Detail({ artistId, onChanged }: { artistId: string; onChanged: () => void }) {
  const [detail, setDetail] = React.useState<ArtistRateDetail | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  React.useEffect(() => {
    let live = true;
    setDetail(null);
    setNotice(null);
    fetchArtistRate(artistId).then(
      (d) => live && setDetail(d),
      (err) => live && setError(err instanceof ApiError ? err.message : "This artist couldn't be loaded."),
    );
    return () => {
      live = false;
    };
  }, [artistId]);

  if (error) return <ErrorState message={error} />;
  if (!detail) return <LoadingState label="Loading the artist's rate" />;

  function saved(next: ArtistRateDetail, message: string) {
    setDetail(next);
    setNotice(message);
    onChanged();
  }

  const current = detail.history.find((h) => h.effective_to === null);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <PersonMark name={detail.name} seed={detail.artist_id} size="3rem" />
          <div>
            <h2 className="st-h2">{detail.name}</h2>
            <p className="st-sub">{kindWord(detail.kind)}</p>
          </div>
        </div>
        <div className="text-right">
          <p className="rr-big">{detail.share_bps === null ? <small>No rate yet</small> : <>{bpsToPercent(detail.share_bps)}<small>%</small></>}</p>
          <p className="text-xs text-fg-muted">{current ? spanWords(current.effective_from, null) : "Sales wait for a rate"}</p>
        </div>
      </div>

      {notice ? (
        <p role="status" className="st-callout text-sm">
          {notice}
        </p>
      ) : null}

      <div className="rr-well cr-cut space-y-2">
        <h3 className="st-eyebrow">What this artist has earned</h3>
        {detail.totals.by_currency.length === 0 ? (
          <p className="st-sub">No sales yet.</p>
        ) : (
          <table className="rr-table">
            <thead>
              <tr>
                <th scope="col">Sales</th>
                <th scope="col" className="rr-num">
                  Fans paid
                </th>
                <th scope="col" className="rr-num">
                  Refunded
                </th>
                <th scope="col" className="rr-num">
                  Artist earned
                </th>
                <th scope="col" className="rr-num">
                  Waiting for a rate
                </th>
              </tr>
            </thead>
            <tbody>
              {detail.totals.by_currency.map((m) => (
                <tr key={m.currency_code}>
                  <td className="cr-num">{m.sales}</td>
                  <td className="rr-num">
                    <Money value={{ amount_minor: m.paid_minor, currency_code: m.currency_code }} minorDigits="always" />
                  </td>
                  <td className="rr-num">
                    <Money value={{ amount_minor: m.refunded_minor, currency_code: m.currency_code }} minorDigits="always" />
                  </td>
                  <td className="rr-num font-semibold text-fg">
                    <Money value={{ amount_minor: m.earned_minor, currency_code: m.currency_code }} minorDigits="always" />
                  </td>
                  <td className="rr-num">
                    {m.no_rate_sales > 0 ? (
                      <>
                        {m.no_rate_sales} · <Money value={{ amount_minor: m.no_rate_paid_minor, currency_code: m.currency_code }} minorDigits="always" />
                      </>
                    ) : (
                      "None"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="text-xs text-fg-muted">Earned is the rate of each sale times what the fan paid and kept paid, rounded down. Nothing here pays the artist: payouts still go through statements.</p>
      </div>

      {detail.can_set ? (
        <section aria-labelledby="rr-set" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 id="rr-set" className="st-h2">
              {detail.share_bps === null ? "Set a rate" : "Change the rate"}
            </h3>
            <StopRate detail={detail} onSaved={saved} />
          </div>
          <RateForm key={`${detail.artist_id}-${detail.share_bps}-${detail.history.length}`} detail={detail} onSaved={saved} />
        </section>
      ) : (
        <p className="st-sub">Only staff with the royalty rights can set a rate.</p>
      )}

      {detail.history.length > 0 ? (
        <section aria-labelledby="rr-hist">
          <h3 id="rr-hist" className="st-eyebrow mb-2">
            Rate history
          </h3>
          <ol className="rr-history">
            {detail.history.map((h) => (
              <li key={h.id} data-current={h.effective_to === null || undefined} className="text-sm">
                <p>
                  <span className="rr-dot" aria-hidden="true" />
                  <span className="font-semibold text-fg">{bpsToPercent(h.share_bps)}%</span> · {spanWords(h.effective_from, h.effective_to)}
                  {h.covers_earlier ? " · given to earlier sales" : ""}
                </p>
                <p className="text-xs text-fg-muted">
                  Set {formatDate(h.set_at)}
                  {h.set_by ? ` by ${h.set_by}` : ""}
                  {h.ended_by ? ` · ended by ${h.ended_by}` : ""}
                  {h.note ? ` · “${h.note}”` : ""}
                </p>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {detail.sales.length > 0 ? (
        <section aria-labelledby="rr-sales">
          <h3 id="rr-sales" className="st-eyebrow mb-2">
            Sales, newest first
          </h3>
          <div className="overflow-x-auto">
            <table className="rr-table">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">What</th>
                  <th scope="col" className="rr-num">
                    Paid
                  </th>
                  <th scope="col" className="rr-num">
                    Rate
                  </th>
                  <th scope="col" className="rr-num">
                    Earned
                  </th>
                </tr>
              </thead>
              <tbody>
                {detail.sales.map((s) => (
                  <tr key={s.id}>
                    <td className="whitespace-nowrap">{formatDate(s.made_at)}</td>
                    <td>
                      <span className="text-fg">{s.title ?? (s.kind === "TRACK" ? "A song" : "A release")}</span>
                      {howWords(s.how) ? <span className="block text-xs text-fg-muted">{howWords(s.how)}</span> : null}
                      {s.refunded_minor > 0 ? (
                        <span className="block text-xs text-fg-muted">
                          Refunded <Money value={{ amount_minor: s.refunded_minor, currency_code: s.currency_code }} minorDigits="always" />
                        </span>
                      ) : null}
                    </td>
                    <td className="rr-num">
                      <Money value={{ amount_minor: s.paid_minor, currency_code: s.currency_code }} minorDigits="always" />
                    </td>
                    <td className="rr-num">{s.share_bps === null ? <TonePill tone="warning">No rate yet</TonePill> : rateLabel(s.share_bps)}</td>
                    <td className="rr-num">
                      {s.earned_minor === null ? "Not available" : <Money value={{ amount_minor: s.earned_minor, currency_code: s.currency_code }} minorDigits="always" />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function ArtistItem({ row, current, onPick }: { row: ArtistRateRow; current: boolean; onPick: () => void }) {
  const first = row.by_currency[0];
  return (
    <li>
      <button type="button" className="rr-item cr-cut cr-focus" aria-current={current || undefined} onClick={onPick}>
        <PersonMark name={row.name} seed={row.artist_id} size="2.25rem" />
        <span className="min-w-0">
          <span className="block truncate font-semibold text-fg">{row.name}</span>
          <span className="block truncate text-xs text-fg-muted">
            {kindWord(row.kind)} · {row.sales} {row.sales === 1 ? "sale" : "sales"}
            {first && first.earned_minor > 0 ? (
              <>
                {" · earned "}
                <Money value={{ amount_minor: first.earned_minor, currency_code: first.currency_code }} />
              </>
            ) : null}
            {row.no_rate_sales > 0 ? ` · ${row.no_rate_sales} without a rate` : ""}
          </span>
        </span>
        <span className="rr-rate" data-none={row.share_bps === null || undefined}>
          {rateLabel(row.share_bps)}
        </span>
      </button>
    </li>
  );
}

export function ArtistRates() {
  const params = useSearchParams();
  const router = useRouter();
  const picked = params.get("artist");
  const [rows, setRows] = React.useState<ArtistRateRow[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [typed, setTyped] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [filter, setFilter] = React.useState<RateFilter>("all");

  React.useEffect(() => {
    const t = setTimeout(() => setQuery(typed), 250);
    return () => clearTimeout(t);
  }, [typed]);

  const load = React.useCallback(async () => {
    try {
      setRows((await fetchArtistRates(query)).items);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Artist rates couldn't be loaded.");
    }
  }, [query]);

  React.useEffect(() => {
    void load();
  }, [load]);

  function pick(id: string) {
    router.replace(`/staff/royalties?artist=${encodeURIComponent(id)}`, { scroll: false });
  }

  if (error && !rows) return <ErrorState message={error} />;
  if (!rows) return <LoadingState label="Loading artist rates" />;

  const shown = rows.filter((r) => matchesRateFilter(r, filter));
  const withRate = rows.filter((r) => r.share_bps !== null).length;
  const needs = rows.filter((r) => matchesRateFilter(r, "no-rate") && r.sales > 0).length;
  const waitingSales = rows.reduce((n, r) => n + r.no_rate_sales, 0);
  const selected = picked ?? shown[0]?.artist_id ?? null;

  return (
    <div className="cx space-y-5">
      <div className="cx-tiles" style={{ "--cx-cols": 3 } as React.CSSProperties}>
        <StatTile label="Artists with a rate" value={<span className="cr-num">{withRate}</span>} hint="Solo artists and bands" tone="positive" pressed={filter === "with-rate"} onPress={() => setFilter(filter === "with-rate" ? "all" : "with-rate")} />
        <StatTile label="Selling, needs a rate" value={<span className="cr-num">{needs}</span>} hint="Has sales no rate covers" tone={needs > 0 ? "warning" : undefined} pressed={filter === "no-rate"} onPress={() => setFilter(filter === "no-rate" ? "all" : "no-rate")} />
        <StatTile label="Sales waiting for a rate" value={<span className="cr-num">{waitingSales}</span>} hint="Earn once a rate covers them" />
      </div>
      <div className="rr-layout">
        <section className="st-panel space-y-3" aria-labelledby="rr-artists">
          <div className="st-panel-head">
            <h2 id="rr-artists" className="st-h2">
              Artists and bands
            </h2>
            <label htmlFor="rr-search" className="sr-only">
              Search artists
            </label>
            <Input id="rr-search" type="search" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Search by name" className="max-w-[14rem]" />
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Show">
            {RATE_FILTERS.map((f) => (
              <button key={f.id} type="button" className="cx-chip cr-cut cr-focus" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
                {f.label}
              </button>
            ))}
          </div>
          {shown.length === 0 ? (
            <p className="st-sub">Nobody matches.</p>
          ) : (
            <ul className="rr-list">
              {shown.map((row) => (
                <ArtistItem key={row.artist_id} row={row} current={row.artist_id === selected} onPick={() => pick(row.artist_id)} />
              ))}
            </ul>
          )}
        </section>
        <section className="st-panel rr-detail" aria-label="Artist's rate">
          {selected ? <Detail artistId={selected} onChanged={() => void load()} /> : <p className="st-sub">Pick an artist or band.</p>}
        </section>
      </div>
    </div>
  );
}
