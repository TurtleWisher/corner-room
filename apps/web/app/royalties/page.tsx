"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { Protected } from "@/components/protected";
import { EmptyState, ErrorState, LoadingState } from "@/components/async-state";
import { Card } from "@/components/ui/card";
import { ApiError, fetchMyRoyaltyStatements, type RoyaltyStatementRecord } from "@/lib/api";

function RoyaltiesBody() {
  const [rows, setRows] = useState<RoyaltyStatementRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchMyRoyaltyStatements()
      .then((page) => setRows(page.items))
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : "Unable to load statements");
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <LoadingState label="Loading statements" />;
  }
  if (error) {
    return <ErrorState title="Statements unavailable" message={error} />;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Royalty statements</h1>
      <p className="text-sm text-neutral-600">
        Amounts come from the API. This page does not calculate royalties.
      </p>
      {rows.length === 0 ? (
        <EmptyState message="No statements yet." />
      ) : (
        rows.map((row) => (
          <Card key={row.id}>
            <p className="font-medium">
              {row.status} · {row.total_amount_minor} {row.currency_code}
            </p>
            <p className="text-sm text-neutral-600">
              {row.period_start} → {row.period_end} · version {row.version_number}
            </p>
            <p className="text-sm">
              <Link href={`/royalties/statements/${row.id}`} className="underline">
                View
              </Link>
            </p>
          </Card>
        ))
      )}
    </div>
  );
}

export default function RoyaltiesPage() {
  return (
    <Protected>
      <RoyaltiesBody />
    </Protected>
  );
}
