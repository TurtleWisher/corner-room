"use client";

import { FormEvent, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

import { useAuth } from "@/components/auth-provider";
import { EmptyState, ErrorState, LoadingState } from "@/components/async-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  ApiError,
  addTrackCredit,
  createTrackVersion,
  fetchTrack,
  fetchTrackCredits,
  transitionTrack,
  transitionTrackVersion,
  type CreditRecord,
  type TrackRecord,
} from "@/lib/api";

export default function TrackDetailPage() {
  const params = useParams<{ id: string }>();
  const trackId = params.id;
  const { status } = useAuth();
  const [track, setTrack] = useState<TrackRecord | null>(null);
  const [credits, setCredits] = useState<CreditRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [creditRole, setCreditRole] = useState("");
  const [creditArtistId, setCreditArtistId] = useState("");

  async function reload() {
    const row = await fetchTrack(trackId, { skipAuth: status !== "authenticated" });
    setTrack(row);
    const creditPage = await fetchTrackCredits(trackId, { skipAuth: status !== "authenticated" });
    setCredits(creditPage.items);
  }

  useEffect(() => {
    let cancelled = false;
    setTrack(null);
    (async () => {
      setLoading(true);
      setError(null);
      try {
        await reload();
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Unable to load track");
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
  }, [trackId, status]);

  async function run(fn: () => Promise<TrackRecord>) {
    setActionError(null);
    try {
      const row = await fn();
      setTrack(row);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Action failed");
    }
  }

  if (loading) {
    return <LoadingState label="Loading track" />;
  }
  if (error) {
    return <ErrorState title="Track unavailable" message={error} />;
  }
  if (!track) {
    return <EmptyState message="Track not found." />;
  }

  const canStaff = status === "authenticated" && typeof track.version === "number";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">{track.title}</h1>
        <p className="mt-1 text-sm text-neutral-600">
          {track.status}
          {track.isrc ? ` · ${track.isrc}` : ""}
        </p>
        <p className="mt-2 text-sm text-neutral-600">
          Catalog edit. Playback is on the listener player, not this form.
        </p>
        {track.status === "RELEASED" ? (
          <p className="mt-2 text-sm">
            <Link href={`/listen/${track.id}`} className="underline">
              Open listener player
            </Link>
          </p>
        ) : null}
      </div>
      {canStaff ? (
        <Card>
          <h2 className="text-sm font-medium">Lifecycle</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {["submit", "start_review", "approve", "reject", "schedule", "release", "takedown", "archive"].map(
              (action) => (
                <Button
                  key={action}
                  type="button"
                  size="sm"
                  onClick={() => void run(() => transitionTrack(track.id, action, track.version))}
                >
                  {action}
                </Button>
              ),
            )}
            <Button
              type="button"
              size="sm"
              onClick={() =>
                void (async () => {
                  setActionError(null);
                  try {
                    const version = await createTrackVersion(track.id);
                    await transitionTrackVersion(track.id, version.id, "mark_ready", version.version);
                    await reload();
                  } catch (err) {
                    setActionError(err instanceof ApiError ? err.message : "Version failed");
                  }
                })()
              }
            >
              Add READY version (no audio)
            </Button>
          </div>
        </Card>
      ) : null}
      <Card>
        <h2 className="text-sm font-medium">Credits</h2>
        {credits.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-600">No credits. Attribution is not ownership.</p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm">
            {credits.map((row) => (
              <li key={row.id}>
                {row.credit_role}
                {row.artist_id ? ` · artist ${row.artist_id}` : ""}
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
                  await addTrackCredit(track.id, creditRole, creditArtistId || undefined);
                  setCreditRole("");
                  setCreditArtistId("");
                  await reload();
                } catch (err) {
                  setActionError(err instanceof ApiError ? err.message : "Credit failed");
                }
              })();
            }}
          >
            <Input
              value={creditArtistId}
              onChange={(e) => setCreditArtistId(e.target.value)}
              placeholder="Artist id (required unless a user party is used later)"
              required
            />
            <Input
              value={creditRole}
              onChange={(e) => setCreditRole(e.target.value)}
              placeholder="Credit role (not a royalty share)"
              required
            />
            <Button type="submit" size="sm">
              Add credit
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
