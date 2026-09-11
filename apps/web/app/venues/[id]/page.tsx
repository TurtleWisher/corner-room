"use client";

import { FormEvent, useEffect, useState } from "react";
import { useParams } from "next/navigation";

import { Protected } from "@/components/protected";
import { EmptyState, ErrorState, LoadingState } from "@/components/async-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ApiError, fetchVenue, transitionVenue, updateVenue, type VenueRecord } from "@/lib/api";

function VenueDetailBody() {
  const params = useParams<{ id: string }>();
  const venueId = params.id;
  const [venue, setVenue] = useState<VenueRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [capacity, setCapacity] = useState("0");
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setVenue(null);
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const row = await fetchVenue(venueId);
        if (!cancelled) {
          setVenue(row);
          setName(row.name);
          setCapacity(String(row.capacity));
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Unable to load venue");
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
  }, [venueId]);

  async function onSave(form: FormEvent) {
    form.preventDefault();
    if (!venue) {
      return;
    }
    setActionError(null);
    try {
      const row = await updateVenue(venue.id, {
        name,
        capacity: Number(capacity),
        version: venue.version,
      });
      setVenue(row);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Unable to save venue");
    }
  }

  async function onLifecycle(action: string) {
    if (!venue) {
      return;
    }
    setActionError(null);
    try {
      const row = await transitionVenue(venue.id, action, venue.version);
      setVenue(row);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Lifecycle failed");
    }
  }

  if (loading) {
    return <LoadingState label="Loading venue" />;
  }
  if (error) {
    return <ErrorState title="Venue unavailable" message={error} />;
  }
  if (!venue) {
    return <EmptyState message="Venue not found." />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">{venue.name}</h1>
        <p className="mt-1 text-sm text-neutral-600">
          {venue.status} · capacity {venue.capacity} (not ticket inventory)
        </p>
      </div>
      {actionError ? <ErrorState title="Action failed" message={actionError} /> : null}
      <Card>
        <form onSubmit={onSave} className="space-y-3">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
          <Input type="number" min={0} value={capacity} onChange={(e) => setCapacity(e.target.value)} />
          <Button type="submit" size="sm">
            Save
          </Button>
        </form>
      </Card>
      <Card>
        <h2 className="text-sm font-medium">Lifecycle</h2>
        <div className="mt-3 flex gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => void onLifecycle("activate")}>
            Activate
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => void onLifecycle("deactivate")}>
            Deactivate
          </Button>
        </div>
      </Card>
    </div>
  );
}

export default function VenueDetailPage() {
  return (
    <Protected>
      <VenueDetailBody />
    </Protected>
  );
}
