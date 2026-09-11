"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { EmptyState, ErrorState, LoadingState } from "@/components/async-state";
import { Card } from "@/components/ui/card";
import { ApiError, fetchPublicEvents, type EventRecord } from "@/lib/api";

export default function DiscoverPage() {
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetchPublicEvents()
      .then((page) => setEvents(page.items))
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : "Unable to load public events");
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <LoadingState label="Loading published events" />;
  }
  if (error) {
    return <ErrorState title="Events unavailable" message={error} />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Published events</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Public discovery. Unpublished events are hidden. Ticket types are listed on each event.
        </p>
      </div>
      {events.length === 0 ? (
        <EmptyState message="No published events yet." />
      ) : (
        <ul className="space-y-3">
          {events.map((row) => (
            <li key={row.id}>
              <Card>
                <p className="font-medium">
                  <Link href={`/discover/${row.id}`} className="underline">
                    {row.title}
                  </Link>
                </p>
                <p className="text-sm text-neutral-600">
                  {row.status} · {row.timezone}
                </p>
                {row.description ? <p className="mt-2 text-sm">{row.description}</p> : null}
              </Card>
            </li>
          ))}
        </ul>
      )}
      <p className="text-sm">
        <Link href="/login" className="underline">
          Staff sign in
        </Link>
      </p>
    </div>
  );
}
