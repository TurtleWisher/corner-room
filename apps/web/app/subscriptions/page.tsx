"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { Protected } from "@/components/protected";
import { EmptyState, ErrorState, LoadingState } from "@/components/async-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ApiError, cancelSubscription, fetchMySubscriptions, type SubscriptionRecord } from "@/lib/api";

function SubscriptionsBody() {
  const [rows, setRows] = useState<SubscriptionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    setLoading(true);
    fetchMySubscriptions()
      .then((page) => setRows(page.items))
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : "Unable to load subscriptions");
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    reload();
  }, []);

  async function onCancel(id: string) {
    setError(null);
    try {
      await cancelSubscription(id);
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Cancel failed");
    }
  }

  if (loading) {
    return <LoadingState label="Loading subscriptions" />;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Subscriptions</h1>
      <p className="text-sm text-neutral-600">
        Cancel remains entitled until the current period ends. No card form. No invented grace window.
      </p>
      {error ? <ErrorState title="Subscriptions" message={error} /> : null}
      {rows.length === 0 ? (
        <EmptyState message="You have no subscriptions." />
      ) : (
        rows.map((row) => (
          <Card key={row.id}>
            <p className="font-medium">{row.status}</p>
            <p className="text-sm text-neutral-600">
              Period ends {row.period_ends_at ?? "unknown"}
              {row.cancel_at_period_end ? " · cancels at period end" : ""}
            </p>
            {row.status !== "CANCELLED" && row.status !== "EXPIRED" ? (
              <Button type="button" size="sm" className="mt-3" onClick={() => void onCancel(row.id)}>
                Cancel
              </Button>
            ) : null}
          </Card>
        ))
      )}
      <p className="text-sm">
        <Link href="/store" className="underline">
          Store
        </Link>
      </p>
    </div>
  );
}

export default function SubscriptionsPage() {
  return (
    <Protected>
      <SubscriptionsBody />
    </Protected>
  );
}
