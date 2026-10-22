"use client";

import Link from "next/link";
import { useParams } from "next/navigation";

import { useAuth } from "@/components/auth-provider";
import { Logo } from "@/components/brand/logo";
import { ButtonLink, DateTime, ErrorState, Money, Skeleton, StatusChip, Table, TBody, TD, TH, THead, TR } from "@/components/ds";
import { RetryButton } from "@/components/shell/staff-panel";
import { loadErrorMessage, useAsync } from "@/components/use-async";
import { fetchRoyaltyStatement, fetchTrack } from "@/lib/api";
import { humanizeStatus } from "@/lib/format/status";
import { STATEMENT_STATUS } from "@/lib/status-maps";


/** "2500" bps -> "25.00%": a display of the stored share, not a calculation. */
function share(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

/**
 * Printed royalty statement (finance.md, Paper world). Every amount and total is the API's own;
 * nothing is added up here (no client money maths).
 */
export default function StatementPage() {
  const { id } = useParams<{ id: string }>();
  const { status } = useAuth();
  const data = useAsync(async () => {
    if (status !== "authenticated") return null;
    const row = await fetchRoyaltyStatement(id);
    const ids = [...new Set(row.lines.map((l) => l.track_id).filter((v): v is string => Boolean(v)))];
    const titles = new Map(await Promise.all(ids.map(async (t) => [t, (await fetchTrack(t, { skipAuth: true }).catch(() => null))?.title ?? null] as const)));
    return { row, titles };
  }, [id, status]);

  return (
    <main id="main" data-theme="artist-studio" className="cr-scope">
      <div className="mx-auto max-w-4xl px-4 py-12 md:px-6">
        <Link href="/royalties" className="cr-focus text-sm font-semibold text-link underline">
          All statements
        </Link>
        {status !== "authenticated" && status !== "loading" ? (
          <div className="mt-6">
            <ButtonLink href={`/studio/sign-in?next=${encodeURIComponent(`/royalties/statements/${id}`)}`}>Sign in to see this statement</ButtonLink>
          </div>
        ) : data.status === "error" ? (
          <div className="mt-6">
            <ErrorState title="Statement unavailable" message={loadErrorMessage(data.error, "this statement")} action={<RetryButton onClick={data.reload} />} />
          </div>
        ) : data.status === "loading" || !data.data ? (
          <Skeleton className="mt-6 h-96 w-full" />
        ) : (
          <article data-theme="paper" aria-labelledby="statement-title" className="cr-scope mt-6 p-6 shadow-lg md:p-10">
            <header className="flex flex-wrap items-start justify-between gap-6 border-b border-line pb-6">
              <div>
                <p className="cr-eyebrow text-[0.6875rem] text-fg-muted">Royalty statement</p>
                <h1 id="statement-title" className="mt-2 text-2xl font-bold text-fg">
                  <DateTime value={data.data.row.period_start} format="date" /> to <DateTime value={data.data.row.period_end} format="date" />
                </h1>
                <p className="mt-1 text-sm text-fg-muted">Version {data.data.row.version_number}</p>
              </div>
              <div className="flex flex-col items-end gap-3">
                <Logo variant="mono-dark" height={48} alt="Corner Room" />
                <StatusChip value={data.data.row.status} map={STATEMENT_STATUS} />
              </div>
            </header>
            <section aria-labelledby="lines" className="mt-8">
              <h2 id="lines" className="mb-3 text-lg font-bold text-fg">
                Lines
              </h2>
              {data.data.row.lines.length === 0 ? (
                <p className="text-sm text-fg-muted">No lines on this statement.</p>
              ) : (
                <Table label="Statement lines">
                  <THead>
                    <TR>
                      <TH>Track</TH>
                      <TH numeric>Units</TH>
                      <TH numeric>Share</TH>
                      <TH numeric>Amount</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {data.data.row.lines.map((l) => (
                      <TR key={l.id}>
                        <TD>
                          {l.track_id ? (data.data!.titles.get(l.track_id) ?? "Track") : "Not attributed"}
                          {l.is_residual ? <span className="ml-2 text-xs text-fg-muted">Residual</span> : null}
                        </TD>
                        <TD numeric>{l.eligible_units.toLocaleString("en-IN")}</TD>
                        <TD numeric>{share(l.share_bps_snapshot)}</TD>
                        <TD numeric>
                          <Money value={{ amount_minor: l.amount_minor, currency_code: l.currency_code }} minorDigits="always" />
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </section>
            {data.data.row.adjustments.length ? (
              <section aria-labelledby="adjustments" className="mt-8">
                <h2 id="adjustments" className="mb-3 text-lg font-bold text-fg">
                  Adjustments
                </h2>
                <Table label="Adjustments">
                  <THead>
                    <TR>
                      <TH>Reason</TH>
                      <TH numeric>Amount</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {data.data.row.adjustments.map((a) => (
                      <TR key={a.id}>
                        <TD>{humanizeStatus(a.reason)}</TD>
                        <TD numeric>
                          <Money value={{ amount_minor: a.amount_minor, currency_code: a.currency_code }} minorDigits="always" />
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </section>
            ) : null}
            <footer className="mt-10 flex items-baseline justify-between border-t-2 border-fg pt-4">
              <span className="text-sm font-semibold text-fg">Statement total</span>
              <Money value={{ amount_minor: data.data.row.total_amount_minor, currency_code: data.data.row.currency_code }} minorDigits="always" variant="display" className="text-3xl text-fg" />
            </footer>
          </article>
        )}
      </div>
    </main>
  );
}
