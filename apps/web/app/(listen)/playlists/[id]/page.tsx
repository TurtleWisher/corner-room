"use client";

import { useParams } from "next/navigation";
import { FormEvent, useState } from "react";
import { X } from "lucide-react";

import { Button, Card, EmptyState, ErrorState, Field, IconButton, Select, Skeleton } from "@/components/ds";
import { usePlayableCatalog, useCustomerCommerce } from "@/components/music/commerce";
import { useCredits } from "@/components/music/credits";
import { ListenPage } from "@/components/music/listen-page";
import { TrackRows } from "@/components/music/track-rows";
import { RetryButton } from "@/components/shell/staff-panel";
import { loadErrorMessage, useAsync } from "@/components/use-async";
import { addPlaylistItem, fetchPlaylist, fetchPlaylistItems, removePlaylistItem } from "@/lib/api";
import { friendlyError } from "@/lib/error-copy";

export default function PlaylistPage() {
  const { id } = useParams<{ id: string }>();
  const people = useCredits();
  const commerce = useCustomerCommerce();
  const catalog = usePlayableCatalog();
  const data = useAsync(
    () => Promise.all([fetchPlaylist(id), fetchPlaylistItems(id)]).then(([playlist, items]) => ({ playlist, items: [...items].sort((a, b) => a.position - b.position) })),
    [id],
  );
  const [trackId, setTrackId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    if (data.status !== "ok" || !trackId) return;
    setBusy(true);
    setError(null);
    try {
      await addPlaylistItem(id, trackId, data.data.items.length + 1);
      setTrackId("");
      data.reload();
    } catch (err) {
      setError(friendlyError(err, "The track could not be added."));
    } finally {
      setBusy(false);
    }
  }

  const title = data.status === "ok" ? data.data.playlist.title : "Playlist";
  const inList = new Set(data.status === "ok" ? data.data.items.map((i) => i.track_id) : []);
  return (
    <ListenPage eyebrow="Playlist" title={title} what="this playlist">
      {data.status === "loading" || !catalog.ready ? (
        <Skeleton className="h-48 w-full" />
      ) : data.status === "error" ? (
        <ErrorState title="Playlist unavailable" message={loadErrorMessage(data.error, "this playlist")} action={<RetryButton onClick={data.reload} />} />
      ) : (
        <div className="space-y-8">
          <Card className="p-5">
            <form onSubmit={onAdd} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
              <Field label="Add a track">
                {(c) => (
                  <Select {...c} value={trackId} onChange={(e) => setTrackId(e.target.value)} required>
                    <option value="">Choose a track</option>
                    {catalog.list
                      .filter((t) => !inList.has(t.id))
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.title}
                        </option>
                      ))}
                  </Select>
                )}
              </Field>
              <Button type="submit" busy={busy} disabled={!trackId}>
                Add to playlist
              </Button>
            </form>
            {error ? (
              <p role="alert" className="mt-3 text-sm text-danger">
                {error}
              </p>
            ) : null}
          </Card>
          {data.data.items.length === 0 ? (
            <EmptyState title="This playlist is empty" body="Add a track above." />
          ) : (
            <TrackRows
              label={title}
              playable={catalog.map}
              people={people}
              commerce={commerce}
              items={data.data.items.map((item) => ({
                key: item.track_id,
                trackId: item.track_id,
                extra: (
                  <IconButton label="Remove from playlist" size="sm" onClick={() => void removePlaylistItem(id, item.track_id).then(data.reload).catch(() => undefined)}>
                    <X aria-hidden="true" />
                  </IconButton>
                ),
              }))}
            />
          )}
        </div>
      )}
    </ListenPage>
  );
}
