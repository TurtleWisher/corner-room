"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";

import { Protected } from "@/components/protected";
import { useWorkspace } from "@/components/workspace-provider";
import { EmptyState, ErrorState, LoadingState } from "@/components/async-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ApiError, createEvent, fetchEvents, type EventRecord } from "@/lib/api";
import { rowsForActiveOrg } from "@/lib/workspace-view";

function EventsBody() {
  const { currentOrg } = useWorkspace();
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  const [description, setDescription] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setEvents([]);
    if (!currentOrg) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    void fetchEvents()
      .then((page) => {
        if (!cancelled) {
          setEvents(page.items);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Unable to load events");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [currentOrg?.id]);

  const visible = rowsForActiveOrg(currentOrg?.id ?? null, events);

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    try {
      const created = await createEvent({
        title,
        timezone,
        description: description || undefined,
        starts_at: startsAt ? new Date(startsAt).toISOString() : undefined,
        ends_at: endsAt ? new Date(endsAt).toISOString() : undefined,
      });
      setEvents((rows) => [created, ...rows]);
      setTitle("");
      setDescription("");
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Unable to create event");
    }
  }

  if (!currentOrg) {
    return <EmptyState message="Switch to an organization workspace to manage events." />;
  }
  if (loading) {
    return <LoadingState label="Loading events" />;
  }
  if (error) {
    return <ErrorState title="Events unavailable" message={error} />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Events</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Organization-scoped. Switching workspace clears this list before reload.
        </p>
      </div>
      <Card>
        <h2 className="text-sm font-medium">Create event</h2>
        <form onSubmit={onCreate} className="mt-3 space-y-3">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" required />
          <Input value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="IANA timezone" required />
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Public description"
          />
          <Input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
          <Input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
          <Button type="submit" size="sm">
            Create
          </Button>
        </form>
        {formError ? (
          <p className="mt-2 text-sm text-red-700" role="alert">
            {formError}
          </p>
        ) : null}
      </Card>
      {visible.length === 0 ? (
        <EmptyState message="No events in this workspace." />
      ) : (
        <ul className="space-y-3">
          {visible.map((row) => (
            <li key={row.id}>
              <Card className="flex items-center justify-between gap-4">
                <div>
                  <p className="font-medium">{row.title}</p>
                  <p className="text-sm text-neutral-600">
                    {row.status} · {row.timezone}
                  </p>
                </div>
                <Link href={`/events/${row.id}`} className="text-sm underline">
                  Open
                </Link>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function EventsPage() {
  return (
    <Protected>
      <EventsBody />
    </Protected>
  );
}
