"use client";

import { useEffect, useState } from "react";

import { Protected } from "@/components/protected";
import { EmptyState, ErrorState, LoadingState } from "@/components/async-state";
import { Card } from "@/components/ui/card";
import { ApiError, fetchMyTickets, type TicketRecord } from "@/lib/api";

function TicketsBody() {
  const [rows, setRows] = useState<TicketRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetchMyTickets()
      .then((page) => setRows(page.items))
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : "Unable to load tickets");
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <LoadingState label="Loading tickets" />;
  }
  if (error) {
    return <ErrorState title="Tickets unavailable" message={error} />;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">My tickets</h1>
      {rows.length === 0 ? (
        <EmptyState message="You have no tickets." />
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => (
            <li key={row.id}>
              <Card>
                <p className="font-medium">{row.status}</p>
                <p className="mt-1 break-all text-sm text-neutral-600">{row.presentation_token ?? row.id}</p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function TicketsPage() {
  return (
    <Protected>
      <TicketsBody />
    </Protected>
  );
}
