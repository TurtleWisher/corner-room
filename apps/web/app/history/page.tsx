"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { Protected } from "@/components/protected";
import { EmptyState, ErrorState, LoadingState } from "@/components/async-state";
import { Card } from "@/components/ui/card";
import { ApiError, fetchListeningHistory, type PlaybackEventRecord } from "@/lib/api";

function HistoryBody() {
  const [items, setItems] = useState<PlaybackEventRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchListeningHistory()
      .then((page) => {
        if (!cancelled) {
          setItems(page.items);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Unable to load history");
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
    return <LoadingState label="Loading history" />;
  }
  if (error) {
    return <ErrorState title="History unavailable" message={error} />;
  }
  if (items.length === 0) {
    return <EmptyState message="Completed and skipped listens are facts, not royalties." />;
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Listening history</h1>
      {items.map((item) => (
        <Card key={item.id}>
          <Link href={`/listen/${item.track_id}`} className="underline">
            Track
          </Link>
          <p className="text-sm text-neutral-600">
            {item.duration_ms} ms · {item.completed ? "completed" : "incomplete"} · eligibility not
            computed
          </p>
        </Card>
      ))}
    </div>
  );
}

export default function HistoryPage() {
  return (
    <Protected>
      <HistoryBody />
    </Protected>
  );
}
