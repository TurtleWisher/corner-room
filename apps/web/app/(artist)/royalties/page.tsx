"use client";

import Link from "next/link";
import { FileText } from "lucide-react";

import { DateTime, EmptyState, ErrorState, Money, Skeleton, StatusChip, Table, TBody, TD, TH, THead, TR } from "@/components/ds";
import { AccountPage } from "@/components/shell/account-page";
import { RetryButton } from "@/components/shell/staff-panel";
import { loadErrorMessage, useAsync } from "@/components/use-async";
import { fetchMyRoyaltyStatements } from "@/lib/api";
import { STATEMENT_STATUS } from "@/lib/status-maps";
import { fetchMyRoyaltyRates } from "@/features/staff-portal/api";
import { howWords, rateLabel, spanWords } from "@/lib/royalty-rate-view";

/*
 * Each act's royalty rate (owner, 2026-11-28, D-ROYALTY-RATE-01): the percentage Corner Room's staff
 * set as agreed with the act, and what it has earned on every sale so far. Amounts come from the
 * server; nothing is worked out here. Statements below are the period royalty runs.
 */
function Rates() {
  const data = useAsync(() => fetchMyRoyaltyRates(), []);
  if (data.status === "loading") return <Skeleton className="h-32 w-full" />;
  if (data.status === "error") {
    return <ErrorState title="Your rate is unavailable" message={loadErrorMessage(data.error, "your royalty rate")} action={<RetryButton onClick={data.reload} />} />;
  }
  if (data.data.length === 0) return null;
  return (
    <section aria-labelledby="my-rates" className="space-y-4">
      <h2 id="my-rates" className="text-lg font-bold text-fg">
        Your royalty rate
      </h2>
      {data.data.map((act) => (
        <div key={act.artist_id} className="space-y-3">
          <p className="text-fg">
            <span className="font-semibold">{act.name}</span>:{" "}
            {act.share_bps === null ? (
              <span className="text-fg-muted">no rate set yet. Corner Room&rsquo;s team sets it once it is agreed with you.</span>
            ) : (
              <>
                <span className="font-semibold">{rateLabel(act.share_bps)}</span> of what fans pay for your music{" "}
                <span className="text-fg-muted">({spanWords(act.rate_since, null).toLowerCase()})</span>
              </>
            )}
          </p>
          {act.by_currency.length > 0 ? (
            <Table label={`What ${act.name} earned`}>
              <THead>
                <TR>
                  <TH numeric>Sales</TH>
                  <TH numeric>Fans paid</TH>
                  <TH numeric>You earned</TH>
                  <TH numeric>Waiting for a rate</TH>
                </TR>
              </THead>
              <TBody>
                {act.by_currency.map((m) => (
                  <TR key={m.currency_code}>
                    <TD numeric>{m.sales}</TD>
                    <TD numeric>
                      <Money value={{ amount_minor: m.paid_minor, currency_code: m.currency_code }} minorDigits="always" />
                    </TD>
                    <TD numeric>
                      <Money value={{ amount_minor: m.earned_minor, currency_code: m.currency_code }} minorDigits="always" />
                    </TD>
                    <TD numeric>{m.no_rate_sales > 0 ? `${m.no_rate_sales} ${m.no_rate_sales === 1 ? "sale" : "sales"}` : "None"}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          ) : (
            <p className="text-sm text-fg-muted">No sales yet.</p>
          )}
          {act.sales_lines.length > 0 ? (
            <details className="text-sm">
              <summary className="cr-focus cursor-pointer font-semibold text-link">Latest sales and what each earned</summary>
              <ul className="mt-2 space-y-1">
                {act.sales_lines.map((line) => (
                  <li key={line.id} className="flex flex-wrap justify-between gap-2 text-fg-muted">
                    <span>
                      <DateTime value={line.made_at} format="date" /> · {line.title ?? "Music"}
                      {howWords(line.how) ? ` · ${howWords(line.how)}` : ""}
                    </span>
                    <span>
                      {rateLabel(line.share_bps)} ·{" "}
                      {line.earned_minor === null ? "Not available" : <Money value={{ amount_minor: line.earned_minor, currency_code: line.currency_code }} minorDigits="always" />}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ))}
      <p className="text-xs text-fg-muted">Earnings here are worked out from each sale and its rate. Payments to you still come through your statements.</p>
    </section>
  );
}


function Statements() {
  const data = useAsync(() => fetchMyRoyaltyStatements().then((p) => p.items), []);
  if (data.status === "loading") return <Skeleton className="h-40 w-full" />;
  if (data.status === "error") {
    return <ErrorState title="Statements unavailable" message={loadErrorMessage(data.error, "your royalty statements")} action={<RetryButton onClick={data.reload} />} />;
  }
  if (data.data.length === 0) {
    return <EmptyState title="No statements yet" body="Royalty statements appear here once a period is calculated and issued." />;
  }
  return (
    <Table label="Royalty statements">
      <THead>
        <TR>
          <TH>Period</TH>
          <TH>Status</TH>
          <TH numeric>Total</TH>
          <TH>
            <span className="sr-only">Open</span>
          </TH>
        </TR>
      </THead>
      <TBody>
        {data.data.map((s) => (
          <TR key={s.id}>
            <TD>
              <DateTime value={s.period_start} format="date" /> to <DateTime value={s.period_end} format="date" />
            </TD>
            <TD>
              <StatusChip value={s.status} map={STATEMENT_STATUS} />
            </TD>
            <TD numeric>
              <Money value={{ amount_minor: s.total_amount_minor, currency_code: s.currency_code }} minorDigits="always" />
            </TD>
            <TD>
              <Link href={`/royalties/statements/${s.id}`} className="cr-focus inline-flex items-center gap-1 font-semibold text-link underline">
                <FileText aria-hidden="true" className="size-4" /> View
              </Link>
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

export default function RoyaltiesPage() {
  return (
    <AccountPage audience="artist" eyebrow="Artist" title="Royalties" what="your royalty statements">
      <div className="space-y-8">
        <Rates />
        <section aria-labelledby="my-statements" className="space-y-3">
          <h2 id="my-statements" className="text-lg font-bold text-fg">
            Statements
          </h2>
          <Statements />
        </section>
      </div>
    </AccountPage>
  );
}
