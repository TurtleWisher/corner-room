"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { Protected } from "@/components/protected";
import { EmptyState, ErrorState, LoadingState } from "@/components/async-state";
import { Card } from "@/components/ui/card";
import { ApiError, fetchMyEntitlements, fetchMyOrders, type EntitlementRecord, type OrderRecord } from "@/lib/api";

function PurchasesBody() {
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [ents, setEnts] = useState<EntitlementRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetchMyOrders(), fetchMyEntitlements()])
      .then(([orderPage, entPage]) => {
        setOrders(orderPage.items);
        setEnts(entPage.items);
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : "Unable to load purchases");
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <LoadingState label="Loading purchases" />;
  }
  if (error) {
    return <ErrorState title="Purchases unavailable" message={error} />;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Purchases</h1>
      <p className="text-sm text-neutral-600">
        Your orders and entitlements. Access is decided by the API, not this page.
      </p>
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-neutral-500">Orders</h2>
        {orders.length === 0 ? (
          <EmptyState message="You have no orders." />
        ) : (
          orders.map((row) => (
            <Card key={row.id}>
              <p className="font-medium">
                {row.status} · {row.purpose ?? "ORDER"}
              </p>
              <p className="text-sm text-neutral-600">
                {row.total_amount_minor} {row.currency_code} · payment {row.payment?.status ?? "none"}
              </p>
            </Card>
          ))
        )}
      </section>
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-neutral-500">Entitlements</h2>
        {ents.length === 0 ? (
          <EmptyState message="No entitlements yet." />
        ) : (
          ents.map((row) => (
            <Card key={row.id}>
              <p className="font-medium">
                {row.entitlement_type} · {row.status}
              </p>
              <p className="text-sm text-neutral-600">
                {row.scope}
                {row.expires_at ? ` · expires ${row.expires_at}` : ""}
              </p>
            </Card>
          ))
        )}
      </section>
      <p className="text-sm">
        <Link href="/store" className="underline">
          Store
        </Link>
      </p>
    </div>
  );
}

export default function PurchasesPage() {
  return (
    <Protected>
      <PurchasesBody />
    </Protected>
  );
}
