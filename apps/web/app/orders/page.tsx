"use client";

import { useEffect, useState } from "react";

import { Protected } from "@/components/protected";
import { EmptyState, ErrorState, LoadingState } from "@/components/async-state";
import { Card } from "@/components/ui/card";
import { ApiError, fetchMyOrders, type OrderRecord } from "@/lib/api";

function OrdersBody() {
  const [rows, setRows] = useState<OrderRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetchMyOrders()
      .then((page) => setRows(page.items))
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : "Unable to load orders");
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <LoadingState label="Loading orders" />;
  }
  if (error) {
    return <ErrorState title="Orders unavailable" message={error} />;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">My orders</h1>
      {rows.length === 0 ? (
        <EmptyState message="You have no orders." />
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => (
            <li key={row.id}>
              <Card>
                <p className="font-medium">{row.status}</p>
                <p className="text-sm text-neutral-600">
                  {row.total_amount_minor} {row.currency_code} · payment {row.payment?.status ?? "none"}
                </p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function OrdersPage() {
  return (
    <Protected>
      <OrdersBody />
    </Protected>
  );
}
