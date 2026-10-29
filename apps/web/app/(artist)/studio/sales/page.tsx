"use client";

/* Studio sales (HANDOFF 0.2 step 2): what fans paid for each profile's songs and releases, and who
 * bought them by name only (owner, 2026-10-30, D-BUYERS-01). The API counts, sums and decides who
 * may see it; this page only shows the results. Earnings are not worked out here: they come in
 * royalty statements. */

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, FileText, ListMusic, ReceiptText, ShieldCheck, UsersRound, Wallet } from "lucide-react";

import { Button, ButtonLink, Card, DateTime, EmptyState, ErrorState, Money, Skeleton, StatusChip, Table, TBody, TD, TH, THead, TR } from "@/components/ds";
import { AccountPage } from "@/components/shell/account-page";
import { RetryButton } from "@/components/shell/staff-panel";
import { loadErrorMessage, useAsync } from "@/components/use-async";
import {
  fetchMyProfiles,
  fetchProfileBuyers,
  fetchProfileSaleLines,
  fetchProfileSales,
  type BuyerGroup,
  type CatalogProfile,
  type SaleLine,
  type SalesTotal,
} from "@/features/studio/api";
import { friendlyError } from "@/lib/error-copy";
import { ORDER_STATUS } from "@/lib/status-maps";
import { buyersSummary, money, namesToShow, saleKindLabel, salesCountText } from "@/lib/studio-sales-view";

function Totals({ total }: { total: SalesTotal }) {
  return (
    <Card className="p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-5">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold text-fg">
            <Wallet aria-hidden="true" className="size-4 text-highlight" /> After refunds
          </p>
          <p className="mt-1 text-3xl font-bold text-fg sm:text-4xl">
            <Money value={money(total.net_amount_minor, total.currency_code)} variant="display" minorDigits="always" />
          </p>
          <p className="mt-1 text-sm text-fg-muted">
            All time · {total.currency_code} · {salesCountText(total.sold_count, total.refunded_count)}
          </p>
        </div>
        <dl className="grid grid-cols-2 gap-x-8 gap-y-2">
          <div>
            <dt className="text-sm text-fg-muted">Fans paid</dt>
            <dd className="mt-0.5 text-lg font-semibold text-fg">
              <Money value={money(total.gross_amount_minor, total.currency_code)} minorDigits="always" />
            </dd>
          </div>
          <div>
            <dt className="text-sm text-fg-muted">Refunded</dt>
            <dd className="mt-0.5 text-lg font-semibold text-fg">
              <Money value={money(total.refunded_amount_minor, total.currency_code)} minorDigits="always" />
            </dd>
          </div>
        </dl>
      </div>
    </Card>
  );
}

function SectionHeading({ icon: Icon, children, hint }: { icon: typeof Wallet; children: React.ReactNode; hint?: string }) {
  return (
    <div className="mt-10">
      <h3 className="flex items-center gap-2 text-lg font-bold text-fg">
        <Icon aria-hidden="true" className="size-5 text-highlight" /> {children}
      </h3>
      {hint ? <p className="mt-1 text-sm text-fg-muted">{hint}</p> : null}
    </div>
  );
}

function BuyerCard({ group }: { group: BuyerGroup }) {
  const [open, setOpen] = useState(false);
  const { shown, hidden } = namesToShow(group.names, open);
  const id = `buyers-${group.subject_type}-${group.subject_id}`;
  return (
    <Card as="section" aria-labelledby={id} className="p-5">
      <h4 id={id} className="break-words font-semibold text-fg">
        {group.title}
      </h4>
      <p className="text-sm text-fg-muted">{buyersSummary(group)}</p>
      <ul className="mt-3 flex flex-wrap gap-2" aria-label={`People who bought ${group.title}`}>
        {shown.map((name, i) => (
          <li key={`${name}-${i}`} className="border border-line bg-surface-sunken px-2.5 py-1 text-sm text-fg">
            {name}
          </li>
        ))}
      </ul>
      {hidden > 0 || open ? (
        <Button variant="ghost" size="sm" className="mt-2" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? "Show fewer" : `Show all ${group.names.length} names`}
        </Button>
      ) : null}
    </Card>
  );
}

function Buyers({ profile }: { profile: CatalogProfile }) {
  const buyers = useAsync(() => fetchProfileBuyers(profile.kind, profile.id), [profile.kind, profile.id]);
  if (buyers.status === "loading") return <Skeleton className="h-28 w-full" />;
  if (buyers.status === "error") {
    return <ErrorState title="Buyers unavailable" message={loadErrorMessage(buyers.error, "your buyers")} action={<RetryButton onClick={buyers.reload} />} />;
  }
  if (buyers.data.items.length === 0) {
    return <p className="text-sm text-fg-muted">Buyers&apos; names show here once their payment is confirmed.</p>;
  }
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {buyers.data.items.map((g) => (
        <BuyerCard key={`${g.subject_type}-${g.subject_id}`} group={g} />
      ))}
    </div>
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
            <SectionHeading icon={UsersRound} hint="Names only. Corner Room never shares a buyer's email, phone or address.">
              Who bought your music
            </SectionHeading>
            <div className="mt-4">
              <Buyers profile={profile} />
            </div>
            <SectionHeading icon={ListMusic}>By song and release</SectionHeading>
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
            <SectionHeading icon={ReceiptText}>Recent sales</SectionHeading>
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
      <p className="max-w-2xl text-fg">
        What fans paid for your music and who bought it, since your first sale. A sale counts once its payment is confirmed.
      </p>
      <p className="mt-2 flex max-w-2xl items-start gap-2 text-sm text-fg-muted">
        <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        These are sales, not your earnings: your share is worked out in your royalty statements.
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
      title="Sales and buyers"
      what="your sales"
      actions={
        <ButtonLink href="/studio" variant="secondary">
          <ArrowLeft aria-hidden="true" /> Studio home
        </ButtonLink>
      }
    >
      <Sales />
    </AccountPage>
  );
}
