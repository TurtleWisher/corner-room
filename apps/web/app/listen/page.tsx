"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Protected } from "@/components/protected";
import { EmptyState, ErrorState, LoadingState } from "@/components/async-state";
import { Card } from "@/components/ui/card";
import { ApiError, fetchPlayableCatalog, type PlayableTrackRecord } from "@/lib/api";

function ListenBody() {
  const [tracks, setTracks] = useState<PlayableTrackRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetchPlayableCatalog()
      .then((page) => {
        if (!cancelled) {
          setTracks(page.items);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Unable to load listen catalog");
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
  }, []);

  if (loading) {
    return <LoadingState label="Loading listen catalog" />;
  }
  if (error) {
    return <ErrorState title="Listen unavailable" message={error} />;
  }
  if (tracks.length === 0) {
    return <EmptyState message="Released tracks with a READY version appear here." />;
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Listen</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Listener player. Catalog editing stays on Tracks and Releases. Audio requires a stored
          master (Q-P0-12).
        </p>
      </div>
      {tracks.map((track) => (
        <Card key={track.id}>
          <div className="flex items-center justify-between gap-4">
            <div>
              <Link href={`/listen/${track.id}`} className="font-medium underline">
                {track.title}
              </Link>
              <p className="text-sm text-neutral-600">
                {track.audio_deliverable ? "Audio available" : "Catalog playable — audio not stored"}
              </p>
            </div>
            <Link href={`/listen/${track.id}`} className="text-sm underline">
              Open player
            </Link>
          </div>
        </Card>
      ))}
    </div>
  );
}

export default function ListenPage() {
  return (
    <Protected>
      <ListenBody />
    </Protected>
  );
}
