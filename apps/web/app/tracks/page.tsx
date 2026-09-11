"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";

import { useAuth } from "@/components/auth-provider";
import { useWorkspace } from "@/components/workspace-provider";
import { EmptyState, ErrorState, LoadingState } from "@/components/async-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ApiError, createTrack, fetchTracks, type TrackRecord } from "@/lib/api";
import { rowsForActiveOrg } from "@/lib/workspace-view";

export default function TracksPage() {
  const { status } = useAuth();
  const { currentOrg } = useWorkspace();
  const [tracks, setTracks] = useState<TrackRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const staff = status === "authenticated" && Boolean(currentOrg);

  useEffect(() => {
    let cancelled = false;
    setTracks([]);
    setLoading(true);
    setError(null);
    void fetchTracks({ skipAuth: status !== "authenticated" })
      .then((page) => {
        if (!cancelled) {
          setTracks(page.items);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Unable to load tracks");
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
  }, [currentOrg?.id, status]);

  const visible = staff ? rowsForActiveOrg(currentOrg?.id ?? null, tracks) : tracks;

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    try {
      const created = await createTrack({ title });
      setTracks((rows) => [created, ...rows]);
      setTitle("");
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Unable to create track");
    }
  }

  if (loading) {
    return <LoadingState label="Loading tracks" />;
  }
  if (error) {
    return <ErrorState title="Tracks unavailable" message={error} />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Tracks</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Catalog metadata only. Unreleased tracks are hidden from the public. Playback lives on
          Listen — this page is still catalog edit.
        </p>
      </div>
      {staff ? (
        <Card>
          <h2 className="text-sm font-medium">Add track</h2>
          <form onSubmit={onCreate} className="mt-3 space-y-3">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" required />
            <Button type="submit" size="sm">
              Create
            </Button>
          </form>
          {formError ? (
            <p className="mt-2 text-sm text-red-700" role="alert">
              {formError}
            </p>
          ) : null}
        </Card>
      ) : null}
      {visible.length === 0 ? (
        <EmptyState message={staff ? "No tracks in this workspace." : "No released tracks yet."} />
      ) : (
        <ul className="space-y-3">
          {visible.map((row) => (
            <li key={row.id}>
              <Card className="flex items-center justify-between gap-4">
                <div>
                  <p className="font-medium">{row.title}</p>
                  <p className="text-sm text-neutral-600">{row.status}</p>
                </div>
                <Link href={`/tracks/${row.id}`} className="text-sm underline">
                  Open
                </Link>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
