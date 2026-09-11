"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

import { EmptyState, ErrorState, LoadingState } from "@/components/async-state";
import { Card } from "@/components/ui/card";
import {
  ApiError,
  fetchEvent,
  fetchEventTicketTypes,
  type EventRecord,
  type TicketTypeRecord,
} from "@/lib/api";

export default function PublicEventPage() {
  const params = useParams<{ id: string }>();
  const eventId = params.id;
  const [event, setEvent] = useState<EventRecord | null>(null);
  const [types, setTypes] = useState<TicketTypeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [row, typePage] = await Promise.all([
          fetchEvent(eventId, { skipAuth: true }),
          fetchEventTicketTypes(eventId, { skipAuth: true }),
        ]);
        if (!cancelled) {
          setEvent(row);
          setTypes(typePage.items);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Unable to load event");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  if (loading) {
    return <LoadingState label="Loading event" />;
  }
  if (error) {
    return <ErrorState title="Event unavailable" message={error} />;
  }
  if (!event) {
    return <EmptyState message="Event not found." />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">{event.title}</h1>
        <p className="mt-1 text-sm text-neutral-600">
          {event.status} · {event.timezone}
        </p>
        {event.description ? <p className="mt-2 text-sm">{event.description}</p> : null}
      </div>
      {types.length === 0 ? (
        <EmptyState message="No ticket types on sale." />
      ) : (
        <ul className="space-y-3">
          {types.map((row) => (
            <li key={row.id}>
              <Card>
                <p className="font-medium">{row.name}</p>
                <p className="text-sm text-neutral-600">
                  {row.price_amount_minor} {row.currency_code} · remaining {row.remaining}
                </p>
                <Link href={`/checkout?ticketTypeId=${row.id}`} className="mt-3 inline-block text-sm underline">
                  Checkout
                </Link>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
