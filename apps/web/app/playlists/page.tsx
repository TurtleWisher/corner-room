"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";

import { Protected } from "@/components/protected";
import { EmptyState, ErrorState, LoadingState } from "@/components/async-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ApiError, createPlaylist, fetchPlaylists, type PlaylistRecord } from "@/lib/api";

function PlaylistsBody() {
  const [rows, setRows] = useState<PlaylistRecord[]>([]);
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchPlaylists()
      .then((page) => {
        if (!cancelled) {
          setRows(page.items);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Unable to load playlists");
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

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    try {
      const created = await createPlaylist(title);
      setRows((current) => [created, ...current]);
      setTitle("");
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Unable to create playlist");
    }
  }

  if (loading) {
    return <LoadingState label="Loading playlists" />;
  }
  if (error) {
    return <ErrorState title="Playlists unavailable" message={error} />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Playlists</h1>
        <p className="mt-1 text-sm text-neutral-600">A playlist does not grant playback entitlement.</p>
      </div>
      <form className="flex gap-2" onSubmit={(event) => void onCreate(event)}>
        <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Playlist title" />
        <Button type="submit">Create</Button>
      </form>
      {formError ? <p className="text-sm text-red-700">{formError}</p> : null}
      {rows.length === 0 ? (
        <EmptyState message="Create a playlist to collect released tracks." />
      ) : (
        rows.map((row) => (
          <Card key={row.id}>
            <Link href={`/playlists/${row.id}`} className="font-medium underline">
              {row.title}
            </Link>
            <p className="text-sm text-neutral-600">
              {row.kind} · {row.status}
            </p>
          </Card>
        ))
      )}
    </div>
  );
}

export default function PlaylistsPage() {
  return (
    <Protected>
      <PlaylistsBody />
    </Protected>
  );
}
