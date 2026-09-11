"use client";

import { FormEvent, useEffect, useState } from "react";
import { useParams } from "next/navigation";

import { useAuth } from "@/components/auth-provider";
import { EmptyState, ErrorState, LoadingState } from "@/components/async-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  ApiError,
  addReleaseTrack,
  fetchRelease,
  fetchReleaseTracks,
  transitionRelease,
  type ReleaseRecord,
  type ReleaseTrackRecord,
} from "@/lib/api";

export default function ReleaseDetailPage() {
  const params = useParams<{ id: string }>();
  const releaseId = params.id;
  const { status } = useAuth();
  const [release, setRelease] = useState<ReleaseRecord | null>(null);
  const [tracks, setTracks] = useState<ReleaseTrackRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [trackId, setTrackId] = useState("");
  const [position, setPosition] = useState("1");

  async function reload() {
    const row = await fetchRelease(releaseId, { skipAuth: status !== "authenticated" });
    setRelease(row);
    const composed = await fetchReleaseTracks(releaseId, { skipAuth: status !== "authenticated" });
    setTracks(composed.items);
  }

  useEffect(() => {
    let cancelled = false;
    setRelease(null);
    (async () => {
      setLoading(true);
      setError(null);
      try {
        await reload();
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Unable to load release");
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
  }, [releaseId, status]);

  async function run(fn: () => Promise<ReleaseRecord>) {
    setActionError(null);
    try {
      const row = await fn();
      setRelease(row);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Action failed");
    }
  }

  if (loading) {
    return <LoadingState label="Loading release" />;
  }
  if (error) {
    return <ErrorState title="Release unavailable" message={error} />;
  }
  if (!release) {
    return <EmptyState message="Release not found." />;
  }

  const canStaff = status === "authenticated" && typeof release.version === "number";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">{release.title}</h1>
        <p className="mt-1 text-sm text-neutral-600">
          {release.release_type} · {release.status}
        </p>
        <p className="mt-2 text-sm text-neutral-600">
          Releasing this catalog item does not stream, sell, or calculate royalties.
        </p>
      </div>
      {canStaff ? (
        <Card>
          <h2 className="text-sm font-medium">Lifecycle</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {[
              "start_demo",
              "start_production",
              "start_qc",
              "start_metadata_review",
              "approve",
              "schedule",
              "release",
              "takedown",
              "archive",
            ].map((action) => (
              <Button
                key={action}
                type="button"
                size="sm"
                onClick={() => void run(() => transitionRelease(release.id, action, release.version))}
              >
                {action}
              </Button>
            ))}
          </div>
        </Card>
      ) : null}
      <Card>
        <h2 className="text-sm font-medium">Tracks</h2>
        {tracks.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-600">No tracks on this release yet.</p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm">
            {tracks.map((row) => (
              <li key={`${row.release_id}-${row.track_id}`}>
                {row.position}. {row.track_id}
              </li>
            ))}
          </ul>
        )}
        {canStaff ? (
          <form
            className="mt-3 space-y-2"
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              void (async () => {
                setActionError(null);
                try {
                  await addReleaseTrack(release.id, trackId, Number(position));
                  setTrackId("");
                  await reload();
                } catch (err) {
                  setActionError(err instanceof ApiError ? err.message : "Attach failed");
                }
              })();
            }}
          >
            <Input
              value={trackId}
              onChange={(e) => setTrackId(e.target.value)}
              placeholder="Track id"
              required
            />
            <Input value={position} onChange={(e) => setPosition(e.target.value)} placeholder="Position" />
            <Button type="submit" size="sm">
              Add track
            </Button>
          </form>
        ) : null}
      </Card>
      {actionError ? (
        <p className="text-sm text-red-700" role="alert">
          {actionError}
        </p>
      ) : null}
    </div>
  );
}
