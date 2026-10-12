"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";

import { Protected } from "@/components/protected";
import { useWorkspace } from "@/components/workspace-provider";
import { EmptyState, ErrorState, LoadingState } from "@/components/async-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ApiError, createVenue, fetchVenues, type VenueRecord } from "@/lib/api";
import { rowsForActiveOrg } from "@/lib/workspace-view";

function VenuesBody() {
  const { currentOrg } = useWorkspace();
  const [venues, setVenues] = useState<VenueRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [capacity, setCapacity] = useState("0");
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setVenues([]);
    if (!currentOrg) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    void fetchVenues()
      .then((page) => {
        if (!cancelled) {
          setVenues(page.items);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Unable to load venues");
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

  const visible = rowsForActiveOrg(currentOrg?.id ?? null, venues);

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    try {
      const created = await createVenue({ name, capacity: Number(capacity) || 0 });
      setVenues((rows) => [created, ...rows]);
      setName("");
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Unable to create venue");
    }
  }

  if (!currentOrg) {
    return <EmptyState message="Switch to an organization workspace to manage venues." />;
  }
  if (loading) {
    return <LoadingState label="Loading venues" />;
  }
  if (error) {
    return <ErrorState title="Venues unavailable" message={error} />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Venues</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Capacity is a place property, not ticket inventory. Switching workspace clears this list.
        </p>
      </div>
      <Card>
        <h2 className="text-sm font-medium">Create venue</h2>
        <form onSubmit={onCreate} className="mt-3 space-y-3">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" required />
          <Input
            type="number"
            min={0}
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
            placeholder="Capacity"
          />
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
        <EmptyState message="No venues in this workspace." />
      ) : (
        <ul className="space-y-3">
          {visible.map((row) => (
            <li key={row.id}>
              <Card className="flex items-center justify-between gap-4">
                <div>
                  <p className="font-medium">{row.name}</p>
                  <p className="text-sm text-neutral-600">
                    {row.status} · capacity {row.capacity}
                  </p>
                </div>
                <Link href={`/venues/${row.id}`} className="text-sm underline">
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

export default function VenuesPage() {
  return (
    <Protected>
      <VenuesBody />
    </Protected>
  );
}
