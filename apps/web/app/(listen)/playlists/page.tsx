"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

import { RoomCube } from "@/components/brand/room-cube";
import { Button, Card, EmptyState, ErrorState, Field, Input, Skeleton } from "@/components/ds";
import { ListenPage } from "@/components/music/listen-page";
import { RetryButton } from "@/components/shell/staff-panel";
import { loadErrorMessage, useAsync } from "@/components/use-async";
import { createPlaylist, fetchPlaylists } from "@/lib/api";
import { friendlyError } from "@/lib/error-copy";

function Playlists() {
  const lists = useAsync(() => fetchPlaylists().then((p) => p.items), []);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createPlaylist(title.trim());
      setTitle("");
      lists.reload();
    } catch (err) {
      setError(friendlyError(err, "The playlist could not be created."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-10">
      <Card className="p-5">
        <form onSubmit={onCreate} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <Field label="New playlist">{(c) => <Input {...c} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} required />}</Field>
          <Button type="submit" busy={busy}>
            Create playlist
          </Button>
        </form>
        {error ? (
          <p role="alert" className="mt-3 text-sm text-danger">
            {error}
          </p>
        ) : null}
      </Card>
      {lists.status === "loading" ? (
        <Skeleton className="h-40 w-full" />
      ) : lists.status === "error" ? (
        <ErrorState title="Playlists unavailable" message={loadErrorMessage(lists.error, "your playlists")} action={<RetryButton onClick={lists.reload} />} />
      ) : lists.data.length === 0 ? (
        <EmptyState title="No playlists yet" body="Create one above, then add tracks from its page." />
      ) : (
        <ul className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-5">
          {lists.data.map((p) => (
            <li key={p.id}>
              <Link href={`/playlists/${p.id}`} className="cr-focus group block">
                <RoomCube front={p.title} side="Playlist" tone="sky" label="" className="w-full" />
                <p className="mt-3 truncate font-bold text-fg group-hover:text-highlight">{p.title}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function PlaylistsPage() {
  return (
    <ListenPage title="Playlists" lede="Your own running orders." what="your playlists">
      <Playlists />
    </ListenPage>
  );
}
