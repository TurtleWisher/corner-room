"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { Protected } from "@/components/protected";
import { EmptyState, ErrorState, LoadingState } from "@/components/async-state";
import { Card } from "@/components/ui/card";
import { ApiError, fetchLibrary, type LibraryRecord } from "@/lib/api";

function LibraryBody() {
  const [items, setItems] = useState<LibraryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchLibrary()
      .then((page) => {
        if (!cancelled) {
          setItems(page.items);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Unable to load library");
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
    return <LoadingState label="Loading library" />;
  }
  if (error) {
    return <ErrorState title="Library unavailable" message={error} />;
  }
  if (items.length === 0) {
    return <EmptyState message="Liked and saved tracks appear here. This is not an entitlement." />;
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Library</h1>
      {items.map((item) => (
        <Card key={item.id}>
          <p className="text-sm uppercase text-neutral-500">{item.kind}</p>
          {item.item_type === "track" ? (
            <Link href={`/listen/${item.item_id}`} className="underline">
              Open track
            </Link>
          ) : (
            <p>{item.item_id}</p>
          )}
        </Card>
      ))}
    </div>
  );
}

export default function LibraryPage() {
  return (
    <Protected>
      <LibraryBody />
    </Protected>
  );
}
