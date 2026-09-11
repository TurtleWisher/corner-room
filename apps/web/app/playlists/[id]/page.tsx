"use client";

import { FormEvent, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

import { Protected } from "@/components/protected";
import { ErrorState, LoadingState } from "@/components/async-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ApiError, addPlaylistItem, apiFetch, fetchPlaylist, type PlaylistRecord } from "@/lib/api";

function PlaylistDetailBody() {
  const params = useParams<{ id: string }>();
  const playlistId = params.id;
  const [playlist, setPlaylist] = useState<PlaylistRecord | null>(null);
  const [items, setItems] = useState<Array<{ track_id: string; position: number }>>([]);
  const [trackId, setTrackId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  async function reload() {
    const row = await fetchPlaylist(playlistId);
    setPlaylist(row);
    const listed = await apiFetch<Array<{ track_id: string; position: number }>>(
      `/api/v1/playlists/${playlistId}/items`,
      { retry: false },
    );
    setItems(listed);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await reload();
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Unable to load playlist");
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
  }, [playlistId]);

  async function onAdd(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    try {
      await addPlaylistItem(playlistId, trackId, items.length + 1);
      setTrackId("");
      await reload();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Unable to add track");
    }
  }

  if (loading) {
    return <LoadingState label="Loading playlist" />;
  }
  if (error) {
    return <ErrorState title="Playlist unavailable" message={error} />;
  }
  if (!playlist) {
    return <ErrorState title="Playlist unavailable" message="Not found" />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">{playlist.title}</h1>
        <p className="mt-1 text-sm text-neutral-600">
          {playlist.kind} · {playlist.status}. Items still must be independently playable.
        </p>
      </div>
      <form className="flex gap-2" onSubmit={(event) => void onAdd(event)}>
        <Input value={trackId} onChange={(event) => setTrackId(event.target.value)} placeholder="Track id" />
        <Button type="submit">Add track</Button>
      </form>
      {formError ? <p className="text-sm text-red-700">{formError}</p> : null}
      {items.map((item) => (
        <Card key={`${item.track_id}-${item.position}`}>
          <p className="text-sm text-neutral-500">Position {item.position}</p>
          <Link href={`/listen/${item.track_id}`} className="underline">
            Listen
          </Link>
        </Card>
      ))}
    </div>
  );
}

export default function PlaylistDetailPage() {
  return (
    <Protected>
      <PlaylistDetailBody />
    </Protected>
  );
}
