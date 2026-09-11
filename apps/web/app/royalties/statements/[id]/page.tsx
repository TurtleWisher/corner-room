"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

import { Protected } from "@/components/protected";
import { EmptyState, ErrorState, LoadingState } from "@/components/async-state";
import { Card } from "@/components/ui/card";
import { ApiError, fetchRoyaltyStatement, type RoyaltyStatementRecord } from "@/lib/api";

function StatementBody() {
  const params = useParams<{ id: string }>();
  const [row, setRow] = useState<RoyaltyStatementRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!params.id) {
      return;
    }
    fetchRoyaltyStatement(params.id)
      .then(setRow)
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : "Unable to load statement");
      })
      .finally(() => setLoading(false));
  }, [params.id]);

  if (loading) {
    return <LoadingState label="Loading statement" />;
  }
  if (error) {
    return <ErrorState title="Statement unavailable" message={error} />;
  }
  if (!row) {
    return <EmptyState message="Statement not found." />;
  }

  const adjustmentTotal = row.adjustments.reduce((sum, adj) => sum + adj.amount_minor, 0);

  return (
    <div className="space-y-6">
      <p className="text-sm">
        <Link href="/royalties" className="underline">
          All statements
        </Link>
      </p>
      <h1 className="text-xl font-semibold">Statement {row.status}</h1>
      <p className="text-sm text-neutral-600">
        {row.period_start} → {row.period_end} · version {row.version_number}
      </p>
      <Card>
        <p className="font-medium">
          {row.total_amount_minor} {row.currency_code}
        </p>
        <p className="text-sm text-neutral-600">
          Adjustments {adjustmentTotal} {row.currency_code} (API totals; not calculated here)
        </p>
      </Card>
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-neutral-500">Lines</h2>
        {row.lines.length === 0 ? (
          <EmptyState message="No lines on this statement." />
        ) : (
          row.lines.map((line) => (
            <Card key={line.id}>
              <p className="font-medium">
                {line.amount_minor} {line.currency_code}
              </p>
              <p className="text-sm text-neutral-600">
                {line.share_bps_snapshot} bps · {line.eligible_units} units
                {line.is_residual ? " · residual" : ""}
              </p>
            </Card>
          ))
        )}
      </section>
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-neutral-500">Adjustments</h2>
        {row.adjustments.length === 0 ? (
          <EmptyState message="No adjustments." />
        ) : (
          row.adjustments.map((adj) => (
            <Card key={adj.id}>
              <p className="font-medium">
                {adj.amount_minor} {adj.currency_code}
              </p>
              <p className="text-sm text-neutral-600">{adj.reason}</p>
            </Card>
          ))
        )}
      </section>
    </div>
  );
}

export default function StatementPage() {
  return (
    <Protected>
      <StatementBody />
    </Protected>
  );
}
