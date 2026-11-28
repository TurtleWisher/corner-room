"use client";

/*
 * The staff home's one-page view of Corner Room (owner, 2026-11-28). `GET /staff/overview` sends a
 * block only to people whose permissions already read that part; money only to finance readers.
 * Counts are the server's; unknown values read "Not available", never 0.
 */

import * as React from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Money } from "@/components/ds/money";
import { StatTile } from "@/components/staff/customers-kit";
import { fetchStaffOverview, type StaffOverview } from "@/features/staff-portal/api";
import { formatDate } from "@/lib/format/date";
import { barHeights, countWords } from "@/lib/staff-activity-view";

function Block({ title, href, linkLabel, children }: { title: string; href: string; linkLabel: string; children: React.ReactNode }) {
  return (
    <section className="st-panel" aria-label={title}>
      <div className="sp-block-head">
        <h2 className="st-h2">{title}</h2>
        <Link href={href} className="cr-focus text-link underline">
          {linkLabel} <ArrowRight aria-hidden="true" className="inline size-3" />
        </Link>
      </div>
      {children}
    </section>
  );
}

function Tiles({ children, cols }: { children: React.ReactNode; cols: number }) {
  return (
    <div className="cx-tiles" style={{ "--cx-cols": cols } as React.CSSProperties}>
      {children}
    </div>
  );
}

const n = (v: number | undefined) => <span className="cr-num">{countWords(v)}</span>;

export function StaffOverviewBlocks() {
  const [data, setData] = React.useState<StaffOverview | null>(null);
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => {
    let live = true;
    fetchStaffOverview().then(
      (d) => live && setData(d),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, []);

  if (failed) return <p className="st-sub">The numbers couldn&rsquo;t be loaded. The pages below still work.</p>;
  if (!data) {
    return (
      <div className="cx-tiles" aria-busy="true" style={{ "--cx-cols": 4 } as React.CSSProperties}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="cx-tile cr-cut h-24 opacity-50" />
        ))}
      </div>
    );
  }

  const sales = data.sales;
  const heights = sales ? barHeights(sales.series.map((d) => d.music_orders)) : [];
  return (
    <div className="cx space-y-4">
      {sales ? (
        <Block title="Sales" href="/staff/commerce" linkLabel="Commerce">
          <Tiles cols={sales.money ? 5 : 4}>
            <StatTile label="Music sold today" value={n(sales.music_orders_today)} hint="Orders, Dhaka time" />
            <StatTile label="Music, 7 days" value={n(sales.music_orders_7d)} hint="Paid orders" />
            <StatTile label="Music, 30 days" value={n(sales.music_orders_30d)} hint="Paid orders" />
            <StatTile label="Tickets, 7 days" value={n(sales.ticket_orders_7d)} hint="Paid orders" />
            {sales.money ? (
              <StatTile
                label="Taken, 7 days"
                value={
                  sales.money.length === 0 ? (
                    "None"
                  ) : (
                    <span className="grid">
                      {sales.money.map((m) => (
                        <Money key={m.currency_code} value={{ amount_minor: m.amount_7d_minor, currency_code: m.currency_code }} />
                      ))}
                    </span>
                  )
                }
                hint={
                  sales.money.length ? (
                    <>
                      30 days:{" "}
                      {sales.money.map((m, i) => (
                        <React.Fragment key={m.currency_code}>
                          {i ? ", " : ""}
                          <Money value={{ amount_minor: m.amount_30d_minor, currency_code: m.currency_code }} />
                        </React.Fragment>
                      ))}
                    </>
                  ) : (
                    "Finance staff only"
                  )
                }
              />
            ) : null}
          </Tiles>
          <div className="sp-bars" role="img" aria-label={`Music orders per day for the last ${sales.series.length} days`}>
            {sales.series.map((d, i) => (
              <span
                key={d.day}
                className="sp-bar"
                data-zero={d.music_orders === 0 || undefined}
                title={`${formatDate(`${d.day}T12:00:00+06:00`) ?? d.day}: ${d.music_orders}`}
                style={{ "--h": heights[i], "--i": i } as React.CSSProperties}
              />
            ))}
          </div>
        </Block>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2">
        {data.music ? (
          <Block title="Music" href="/staff/catalog" linkLabel="Releases">
            <Tiles cols={2}>
              <StatTile label="Releases out" value={n(data.music.releases_out)} />
              <StatTile label="Songs out" value={n(data.music.songs_out)} />
              <StatTile label="Active artists" value={n(data.music.active_artists)} hint="Solo and bands" />
              <StatTile label="Listens, 7 days" value={n(data.music.listens_7d)} />
            </Tiles>
          </Block>
        ) : null}
        {data.people ? (
          <Block title="People" href="/staff/customers" linkLabel="Customers and users">
            <Tiles cols={3}>
              <StatTile label="Accounts" value={n(data.people.accounts)} />
              <StatTile label="New, 24 h" value={n(data.people.new_24h)} />
              <StatTile label="New, 7 days" value={n(data.people.new_7d)} />
            </Tiles>
          </Block>
        ) : null}
        {data.live ? (
          <Block title="Live" href="/staff/events" linkLabel="Events">
            <Tiles cols={2}>
              <StatTile label="Upcoming events" value={n(data.live.upcoming_events)} hint="Published" />
              <StatTile label="Drafts" value={n(data.live.draft_events)} hint="Not published yet" />
            </Tiles>
          </Block>
        ) : null}
        {data.royalties ? (
          <Block title="Royalties" href="/staff/royalties" linkLabel="Artist rates">
            <Tiles cols={3}>
              <StatTile label="Artists with a rate" value={n(data.royalties.artists_with_rate)} tone="positive" />
              <StatTile label="Need a rate" value={n(data.royalties.artists_waiting_for_rate)} tone={data.royalties.artists_waiting_for_rate ? "warning" : undefined} hint="Have sales without one" />
              <StatTile label="Sales without a rate" value={n(data.royalties.sales_without_rate)} />
            </Tiles>
          </Block>
        ) : null}
        {data.staff ? (
          <Block title="Staff" href="/staff/team" linkLabel="Staff accounts">
            <Tiles cols={4}>
              <StatTile label="Admins" value={n(data.staff.owners + data.staff.admins)} hint={`${data.staff.owners} owner`} />
              <StatTile label="Staff" value={n(data.staff.staff)} />
              <StatTile label="Invited" value={n(data.staff.waiting_invites)} hint="Not signed in yet" />
              <StatTile label="Actions, 24 h" value={n(data.staff.actions_24h)} />
            </Tiles>
          </Block>
        ) : null}
      </div>
    </div>
  );
}
