"use client";

/* Live numbers for a pre-sale and its release (owner, 2026-11-06, D-PRESALE-04). The API counts and
 * sums everything; this page asks again every 15 seconds while it is open and in view, and shows
 * what came back. Views: the pre-sale on its own, since release, and both together. Unknown is
 * "Not available"; money only for the people the API shows it to. */

import { useCallback, useEffect, useRef, useState } from "react";
import { Eye, Link2, MousePointerClick, Radio, ShoppingBag, Users } from "lucide-react";

import { Card, DateTime, ErrorState, Money, Skeleton } from "@/components/ds";
import { fetchCampaignNumbers, type CampaignNumbers, type CampaignView, type MoneyTotal } from "@/features/presales/api";
import { friendlyError } from "@/lib/error-copy";
import { formatCount } from "@/lib/format/count";
import {
  LIVE_REFRESH_MS,
  barHeights,
  defaultNumbersView,
  fillDays,
  milestoneLabel,
  numbersViews,
  percentFromBps,
  pickView,
  placeLabel,
  siteLabel,
  viewWords,
  type NumbersViewKey,
} from "@/lib/presale-campaign-view";
import { cn } from "@/lib/utils";

export function CampaignNumbersPanel({ releaseId, initialView }: { releaseId: string; initialView?: NumbersViewKey }) {
  const [numbers, setNumbers] = useState<CampaignNumbers | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<NumbersViewKey | null>(initialView ?? null);
  const busy = useRef(false);

  const load = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const next = await fetchCampaignNumbers(releaseId);
      setNumbers(next);
      setError(null);
    } catch (err) {
      setError(friendlyError(err, "The numbers couldn't be loaded."));
    } finally {
      busy.current = false;
    }
  }, [releaseId]);

  useEffect(() => {
    void load();
    const tick = () => {
      if (document.visibilityState === "visible") void load();
    };
    const timer = window.setInterval(tick, LIVE_REFRESH_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [load]);

  if (!numbers) {
    return error ? <ErrorState title="Numbers unavailable" message={error} /> : <Skeleton className="h-96 w-full" />;
  }
  const views = numbersViews(numbers);
  const key = view && views.some((v) => v.key === view) ? view : defaultNumbersView(numbers);
  const shown = pickView(numbers, key);
  const words = viewWords(key);

  return (
    <div className="grid gap-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {views.length > 1 ? (
          <div role="group" aria-label="Which numbers" className="inline-flex border border-line">
            {views.map((v) => (
              <button
                key={v.key}
                type="button"
                aria-pressed={v.key === key}
                onClick={() => setView(v.key)}
                className={cn(
                  "cr-focus px-4 py-2 text-sm font-semibold",
                  v.key === key ? "bg-accent text-on-accent" : "text-fg-muted hover:text-fg",
                )}
              >
                {v.label}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-sm font-semibold text-fg">{views[0].label}</p>
        )}
        <p className="inline-flex items-center gap-2 text-sm text-fg-muted" aria-live="polite">
          <Radio aria-hidden="true" className="cn-live-dot size-4 text-success" />
          Live · updated <DateTime value={numbers.as_of} format="time" />
          {error ? <span className="text-danger">(last refresh failed)</span> : null}
        </p>
      </div>

      <Tiles view={shown} words={words} moneyVisible={numbers.money_visible} />

      {shown.songs ? <Songs songs={shown.songs} moneyVisible={numbers.money_visible} /> : null}

      <section aria-labelledby="numbers-timeline">
        <h2 id="numbers-timeline" className="text-lg font-bold text-fg">
          Day by day
        </h2>
        <p className="mt-1 text-sm text-fg-muted">Bangladesh days. Hover a bar for its number, or open the table for every day.</p>
        <Timeline view={shown} ordersLabel={words.orders} />
      </section>

      <div className="grid gap-8 lg:grid-cols-3">
        <Breakdown
          id="numbers-places"
          title="Where on Corner Room"
          icon={MousePointerClick}
          empty="Nothing counted yet."
          head={["Place", "Opens", "Presses"]}
          rows={shown.places.map((p) => [placeLabel(p.place), formatCount(p.views), formatCount(p.prebook_clicks)])}
        />
        <Breakdown
          id="numbers-links"
          title="Your share links"
          icon={Link2}
          empty="No visits through a share link yet. Make links on the Share page."
          head={["Link", "Opens", "Presses"]}
          rows={shown.links.map((l) => [l.label, formatCount(l.views), formatCount(l.prebook_clicks)])}
        />
        <Breakdown
          id="numbers-sites"
          title="Sites visits came from"
          icon={Eye}
          empty="No visits yet."
          head={["Site", "Opens"]}
          rows={shown.sites.map((s) => [siteLabel(s.host), formatCount(s.views)])}
        />
      </div>

      {numbers.milestones.length ? (
        <section aria-labelledby="numbers-milestones">
          <h2 id="numbers-milestones" className="text-lg font-bold text-fg">
            What happened when
          </h2>
          <ol className="mt-3 grid gap-2 text-sm">
            {numbers.milestones.map((m, i) => (
              <li key={`${m.kind}-${i}`} className="border-l-2 border-line pl-3">
                <span className="font-semibold text-fg">{milestoneLabel(m.kind)}</span>{" "}
                <span className="text-fg-muted">
                  · <DateTime value={m.at} format="datetime" />
                </span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <p className="text-xs text-fg-muted">
        Counted by Corner Room itself, with nothing kept about who visited: page opens (once per browser tab), presses of Pre-book or Buy,
        which share link and which site sent the visit. Link-preview robots and your own team and Corner Room staff aren&apos;t counted.
        Orders, buyers, refunds and money are the same figures as Sales.
      </p>
    </div>
  );
}

function Tile({ label, children, note, icon: Icon }: { label: string; children: React.ReactNode; note?: React.ReactNode; icon?: typeof Eye }) {
  return (
    <Card className="p-4">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-fg-muted">
        {Icon ? <Icon aria-hidden="true" className="size-3.5" /> : null}
        {label}
      </p>
      <p className="cr-num mt-2 text-3xl font-bold text-fg">{children}</p>
      {note ? <p className="mt-1 text-xs text-fg-muted">{note}</p> : null}
    </Card>
  );
}

function NotAvailable() {
  return <span className="text-base font-semibold text-fg-muted">Not available</span>;
}

function MoneyLines({ money }: { money: MoneyTotal[] }) {
  if (money.length === 0) return <span className="text-base font-semibold text-fg-muted">Nothing yet</span>;
  return (
    <>
      {money.map((m) => (
        <span key={m.currency_code} className="block">
          <Money value={{ amount_minor: m.net_amount_minor, currency_code: m.currency_code }} />
        </span>
      ))}
    </>
  );
}

function Tiles({ view, words, moneyVisible }: { view: CampaignView; words: { orders: string; presses: string }; moneyVisible: boolean }) {
  const conversion = percentFromBps(view.conversion_bps);
  const refunded = (view.money ?? []).filter((m) => m.refunded_amount_minor > 0);
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <Tile label="Page opens" icon={Eye}>{formatCount(view.views)}</Tile>
      <Tile label={words.presses} icon={MousePointerClick}>{formatCount(view.prebook_clicks)}</Tile>
      <Tile label="Checkout started" icon={ShoppingBag} note="Orders begun, paid or not">
        {formatCount(view.checkout_started)}
      </Tile>
      <Tile label={words.orders} icon={ShoppingBag} note={view.free_copies ? `${formatCount(view.free_copies)} given free` : undefined}>
        {formatCount(view.orders)}
      </Tile>
      <Tile label="Buyers" icon={Users} note="People who still have it">
        {formatCount(view.buyers)}
      </Tile>
      <Tile label="Orders per page open" note="Orders ÷ page opens">
        {conversion ?? <NotAvailable />}
      </Tile>
      <Tile
        label="Money in"
        note={
          !moneyVisible
            ? "Only the artist's team and finance staff see money."
            : refunded.length
              ? "After refunds, before any share"
              : "What fans paid, before any share"
        }
      >
        {view.money ? <MoneyLines money={view.money} /> : <NotAvailable />}
      </Tile>
      <Tile
        label="Refunded"
        note={
          refunded.length ? (
            <>
              {refunded.map((m) => (
                <Money key={m.currency_code} value={{ amount_minor: m.refunded_amount_minor, currency_code: m.currency_code }} />
              ))}{" "}
              given back
            </>
          ) : (
            "Orders refunded in full"
          )
        }
      >
        {formatCount(view.refunded_orders)}
      </Tile>
    </div>
  );
}

function Songs({ songs, moneyVisible }: { songs: NonNullable<CampaignView["songs"]>; moneyVisible: boolean }) {
  return (
    <Card tone="outline" className="flex flex-wrap items-center gap-x-6 gap-y-2 p-4 text-sm">
      <span className="font-semibold text-fg">Songs bought on their own</span>
      <span className="text-fg">
        <span className="cr-num font-semibold">{formatCount(songs.orders)}</span> {songs.orders === 1 ? "order" : "orders"} ·{" "}
        <span className="cr-num font-semibold">{formatCount(songs.buyers)}</span> {songs.buyers === 1 ? "buyer" : "buyers"}
      </span>
      {moneyVisible && songs.money ? (
        <span className="text-fg">
          <MoneyLines money={songs.money} />
        </span>
      ) : null}
      <span className="text-fg-muted">Not added to the release&apos;s orders.</span>
    </Card>
  );
}

function Timeline({ view, ordersLabel }: { view: CampaignView; ordersLabel: string }) {
  const days = fillDays(view.timeline);
  if (days.length === 0) return <p className="mt-4 text-sm text-fg-muted">Nothing counted yet. Days appear here as visits and orders come in.</p>;
  return (
    <div className="mt-4 grid gap-6">
      <Bars label="Page opens" days={days} values={days.map((d) => d.views)} unit={["open", "opens"]} />
      <Bars label={ordersLabel} days={days} values={days.map((d) => d.orders)} unit={["order", "orders"]} />
      <details className="text-sm">
        <summary className="cr-focus cursor-pointer font-semibold text-link">Show as a table</summary>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[24rem] text-left">
            <thead className="text-fg-muted">
              <tr>
                <th className="py-1 pr-4 font-semibold">Day</th>
                <th className="py-1 pr-4 font-semibold">Page opens</th>
                <th className="py-1 pr-4 font-semibold">Presses</th>
                <th className="py-1 font-semibold">{ordersLabel}</th>
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.day} className="border-t border-line">
                  <td className="py-1 pr-4">
                    <DateTime value={`${d.day}T12:00:00+06:00`} format="date" />
                  </td>
                  <td className="cr-num py-1 pr-4">{formatCount(d.views)}</td>
                  <td className="cr-num py-1 pr-4">{formatCount(d.prebook_clicks)}</td>
                  <td className="cr-num py-1">{formatCount(d.orders)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

/** One measure per chart (never two scales on one), one colour, a number on hover or focus. */
function Bars({ label, days, values, unit }: { label: string; days: { day: string }[]; values: number[]; unit: [string, string] }) {
  const heights = barHeights(values);
  const total = values.reduce((a, b) => a + b, 0);
  return (
    <figure>
      <figcaption className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-semibold text-fg">{label}</span>
        <span className="text-fg-muted">
          <span className="cr-num font-semibold text-fg">{formatCount(total)}</span> in all
        </span>
      </figcaption>
      <div className="cn-bars mt-2" aria-hidden="true">
        {days.map((d, i) => (
          <span key={d.day} className="cn-bar">
            <span className="cn-bar-fill" style={{ height: `${Math.max(heights[i] * 100, values[i] > 0 ? 4 : 0)}%` }} />
            <span className="cn-tip">
              {d.day.slice(5).replace("-", "/")} · {formatCount(values[i])} {values[i] === 1 ? unit[0] : unit[1]}
            </span>
          </span>
        ))}
      </div>
    </figure>
  );
}

function Breakdown({
  id,
  title,
  icon: Icon,
  empty,
  head,
  rows,
}: {
  id: string;
  title: string;
  icon: typeof Eye;
  empty: string;
  head: string[];
  rows: string[][];
}) {
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="flex items-center gap-2 text-base font-bold text-fg">
        <Icon aria-hidden="true" className="size-4 text-highlight" /> {title}
      </h2>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-fg-muted">{empty}</p>
      ) : (
        <table className="mt-2 w-full text-left text-sm">
          <thead className="text-fg-muted">
            <tr>
              {head.map((h, i) => (
                <th key={h} className={cn("py-1 font-semibold", i > 0 && "text-right")}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-line">
                {r.map((cell, j) => (
                  <td key={j} className={cn("py-1.5", j > 0 ? "cr-num text-right" : "pr-3 text-fg")}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
