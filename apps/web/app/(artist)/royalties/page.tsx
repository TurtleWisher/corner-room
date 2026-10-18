"use client";

import Link from "next/link";
import { FileText } from "lucide-react";

import { DateTime, EmptyState, ErrorState, Money, Skeleton, StatusChip, Table, TBody, TD, TH, THead, TR } from "@/components/ds";
import { AccountPage } from "@/components/shell/account-page";
import { RetryButton } from "@/components/shell/staff-panel";
import { loadErrorMessage, useAsync } from "@/components/use-async";
import { fetchMyRoyaltyStatements } from "@/lib/api";
import { STATEMENT_STATUS } from "@/lib/status-maps";


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
      <Statements />
    </AccountPage>
  );
}
