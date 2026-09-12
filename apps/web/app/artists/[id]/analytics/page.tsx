"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

import { Protected } from "@/components/protected";
import { EmptyState, ErrorState, LoadingState } from "@/components/async-state";
import { Card } from "@/components/ui/card";
import { ApiError, fetchArtistPlayAggregates, type ArtistPlayAggregates } from "@/lib/api";

function AggregatesBody() {
  const params = useParams<{ id: string }>();
  const artistId = params.id;
  const [data, setData] = useState<ArtistPlayAggregates | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchArtistPlayAggregates(artistId)
      .then((body) => {
        if (!cancelled) {
          setData(body);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Unable to load aggregates");
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
  }, [artistId]);

  if (loading) {
    return <LoadingState label="Loading play aggregates" />;
  }
  if (error) {
    return <ErrorState title="Aggregates unavailable" message={error} />;
  }
  if (!data || data.tracks.length === 0) {
    return (
      <div className="space-y-3">
        <EmptyState message="Raw playback events are the source of truth. Royalty eligibility is not computed." />
        <p className="text-sm">
          <Link href={`/staff/analytics/artists/${artistId}`} className="underline">
            Open artist analytics
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Play aggregates</h1>
      <p className="text-sm text-neutral-600">
        Operational playback events. This is not the Phase 13 analytics module.
      </p>
      <p className="text-sm text-neutral-600">
        {data.label}. Royalty eligibility is {data.eligibility}. Listener identities are not shown.
      </p>
      <p className="text-sm">
        <Link href={`/staff/analytics/artists/${artistId}`} className="underline">
          Open artist analytics
        </Link>
      </p>
      {data.tracks.map((row) => (
        <Card key={row.track_id}>
          <Link href={`/listen/${row.track_id}`} className="font-medium underline">
            {row.title}
          </Link>
          <p className="text-sm text-neutral-600">
            {row.play_count} plays · {row.unique_listener_count} unique listeners · {row.completed_count}{" "}
            completed · {row.skip_count} skips
          </p>
        </Card>
      ))}
    </div>
  );
}

export default function ArtistAnalyticsPage() {
  return (
    <Protected>
      <AggregatesBody />
    </Protected>
  );
}
