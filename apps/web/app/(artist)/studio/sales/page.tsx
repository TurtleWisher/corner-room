"use client";

/* Studio sales (HANDOFF 0.2 step 2): what fans paid for each profile's songs and releases. The API
 * counts, sums and decides who may see it; this page only shows the numbers. Earnings are not
 * worked out here: they come in royalty statements. */

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, FileText } from "lucide-react";

import { Button, ButtonLink, Card, DateTime, EmptyState, ErrorState, Money, Skeleton, StatusChip, Table, TBody, TD, TH, THead, TR } from "@/components/ds";
import { AccountPage } from "@/components/shell/account-page";
import { RetryButton } from "@/components/shell/staff-panel";
import { loadErrorMessage, useAsync } from "@/components/use-async";
import { fetchMyProfiles, fetchProfileSaleLines, fetchProfileSales, type CatalogProfile, type SaleLine, type SalesTotal } from "@/features/studio/api";
import { friendlyError } from "@/lib/error-copy";
import { ORDER_STATUS } from "@/lib/status-maps";
import { money, saleKindLabel, salesCountText } from "@/lib/studio-sales-view";

function Totals({ total }: { total: SalesTotal }) {
  const figures = [
    { label: "Fans paid", value: total.gross_amount_minor },
    { label: "Refunded", value: total.refunded_amount_minor },
    { label: "After refunds", value: total.net_amount_minor },
  ];
  return (
    <Card className="p-5">
      <p className="text-sm text-fg-muted">
        All time · {total.currency_code} · {salesCountText(total.sold_count, total.refunded_count)}
      </p>
      <dl className="mt-3 grid gap-4 sm:grid-cols-3">
        {figures.map((f) => (
          <div key={f.label}>
            <dt className="text-sm text-fg-muted">{f.label}</dt>
            <dd className="mt-1 text-2xl font-bold text-fg">
              <Money value={money(f.value, total.currency_code)} variant="display" minorDigits="always" />
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

function RecentSales({ profile }: { profile: CatalogProfile }) {
  const first = useAsync(() => fetchProfileSaleLines(profile.kind, profile.id), [profile.kind, profile.id]);
  const [more, setMore] = useState<{ items: SaleLine[]; next: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);

  if (first.status === "loading") return <Skeleton className="h-32 w-full" />;
  if (first.status === "error") {
    return <ErrorState title="Recent sales unavailable" message={loadErrorMessage(first.error, "recent sales")} action={<RetryButton onClick={first.reload} />} />;
  }
  const lines = [...first.data.items, ...(more?.items ?? [])];
  const next = more ? more.next : first.data.next_cursor;

  async function loadMore() {
    if (!next) return;
    setBusy(true);
    setMoreError(null);
    try {
      const page = await fetchProfileSaleLines(profile.kind, profile.id, next);
      setMore((m) => ({ items: [...(m?.items ?? []), ...page.items], next: page.next_cursor }));
    } catch (err) {
      setMoreError(friendlyError(err, "More sales couldn't be loaded."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <Table label={`Recent sales for ${profile.display_name}`}>
        <THead>
          <TR>
            <TH>Ordered</TH>
            <TH>What sold</TH>
            <TH>Status</TH>
            <TH numeric>Paid</TH>
            <TH numeric>Refunded</TH>
          </TR>
        </THead>
        <TBody>
          {lines.map((l) => (
            <TR key={l.id}>
              <TD className="whitespace-nowrap">
                <DateTime value={l.ordered_at} format="date" />
              </TD>
              <TD>
                <span className="block min-w-40 font-semibold text-fg">{l.title}</span>
                <span className="block text-sm text-fg-muted">{saleKindLabel(l)}</span>
              </TD>
              <TD>
                <StatusChip value={l.order_status} map={ORDER_STATUS} />
              </TD>
              <TD numeric>
                <Money value={money(l.amount_minor, l.currency_code)} minorDigits="always" />
              </TD>
              <TD numeric>
                {l.refunded_amount_minor > 0 ? <Money value={money(l.refunded_amount_minor, l.currency_code)} minorDigits="always" /> : <span className="text-fg-muted">None</span>}
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
      {next ? (
        <Button variant="secondary" className="mt-4" busy={busy} onClick={loadMore}>
          Show more
        </Button>
      ) : null}
      {moreError ? <p className="mt-2 text-sm text-danger">{moreError}</p> : null}
    </div>
  );
}

function ProfileSales({ profile }: { profile: CatalogProfile }) {
  const sales = useAsync(() => fetchProfileSales(profile.kind, profile.id), [profile.kind, profile.id]);
  return (
    <section aria-labelledby={`sales-${profile.id}`} className="mt-12 first:mt-0">
      <p className="cr-eyebrow text-highlight">{profile.kind === "band" ? "Band" : "Artist"}</p>
      <h2 id={`sales-${profile.id}`} className="mt-1 text-2xl font-bold text-fg">
        {profile.display_name}
      </h2>
      <div className="mt-4">
        {sales.status === "loading" ? (
          <Skeleton className="h-40 w-full" />
        ) : sales.status === "error" ? (
          <ErrorState title="Sales unavailable" message={loadErrorMessage(sales.error, "these sales")} action={<RetryButton onClick={sales.reload} />} />
        ) : sales.data.items.length === 0 ? (
          <EmptyState title="No sales yet" body="When a fan buys one of your songs or releases, it shows here once their payment is confirmed." />
        ) : (
          <>
            <div className="grid gap-4">
              {sales.data.totals.map((t) => (
                <Totals key={t.currency_code} total={t} />
              ))}
            </div>
            <h3 className="mt-8 text-lg font-bold text-fg">By song and release</h3>
            <div className="mt-3">
              <Table label={`Sales by song and release for ${profile.display_name}`}>
                <THead>
                  <TR>
                    <TH>Title</TH>
                    <TH>Sales</TH>
                    <TH>Last sale</TH>
                    <TH numeric>Fans paid</TH>
                    <TH numeric>After refunds</TH>
                  </TR>
                </THead>
                <TBody>
                  {sales.data.items.map((i) => (
                    <TR key={`${i.subject_type}-${i.subject_id}-${i.currency_code}`}>
                      <TD>
                        <span className="block min-w-40 font-semibold text-fg">{i.title}</span>
                        <span className="block text-sm text-fg-muted">{saleKindLabel(i)}</span>
                      </TD>
                      <TD className="whitespace-nowrap">{salesCountText(i.sold_count, i.refunded_count)}</TD>
                      <TD className="whitespace-nowrap">
                        <DateTime value={i.last_sold_at} format="date" />
                      </TD>
                      <TD numeric>
                        <Money value={money(i.gross_amount_minor, i.currency_code)} minorDigits="always" />
                      </TD>
                      <TD numeric>
                        <Money value={money(i.net_amount_minor, i.currency_code)} minorDigits="always" />
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
            <h3 className="mt-8 text-lg font-bold text-fg">Recent sales</h3>
            <div className="mt-3">
              <RecentSales profile={profile} />
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function Sales() {
  const profiles = useAsync(() => fetchMyProfiles(), []);
  if (profiles.status === "loading") return <Skeleton className="h-48 w-full" />;
  if (profiles.status === "error") {
    return <ErrorState title="Sales unavailable" message={loadErrorMessage(profiles.error, "your profiles")} action={<RetryButton onClick={profiles.reload} />} />;
  }
  if (profiles.data.length === 0) {
    return (
      <Card className="max-w-xl p-6">
        <p className="text-lg font-bold text-fg">No artist or band profile yet</p>
        <p className="mt-2 text-sm text-fg">Sales appear here for the artist and band profiles you publish for in Studio.</p>
        <ButtonLink href="/artists/apply" variant="secondary" className="mt-4">
          Apply as an artist
        </ButtonLink>
      </Card>
    );
  }
  return (
    <div>
      <p className="max-w-2xl text-sm text-fg">
        What fans paid for your music, and what was refunded, since your first sale. A sale counts once its payment is confirmed. These are
        sales, not your earnings: your share is worked out in your royalty statements.
      </p>
      <div className="mt-8">
        {profiles.data.map((p) => (
          <ProfileSales key={`${p.kind}-${p.id}`} profile={p} />
        ))}
      </div>
      <Card className="mt-12 max-w-xl p-6">
        <p className="text-lg font-bold text-fg">Royalties</p>
        <p className="mt-2 text-sm text-fg">Your earnings arrive as royalty statements once a period is calculated and issued.</p>
        <Link href="/royalties" className="cr-focus mt-4 inline-flex items-center gap-1 font-semibold text-link underline">
          <FileText aria-hidden="true" className="size-4" /> See royalty statements
        </Link>
      </Card>
    </div>
  );
}

export default function StudioSalesPage() {
  return (
    <AccountPage
      audience="artist"
      eyebrow="Studio"
      title="Sales"
      what="your sales"
      actions={
        <ButtonLink href="/studio" variant="secondary">
          <ArrowLeft aria-hidden="true" /> Your music
        </ButtonLink>
      }
    >
      <Sales />
    </AccountPage>
  );
}
