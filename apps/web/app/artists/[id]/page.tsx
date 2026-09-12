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
  fetchArtist,
  followArtist,
  transitionArtist,
  unfollowArtist,
  updateArtist,
  type ArtistRecord,
} from "@/lib/api";

function ArtistDetailBody() {
  const params = useParams<{ id: string }>();
  const artistId = params.id;
  const { status } = useAuth();
  const [artist, setArtist] = useState<ArtistRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [stageName, setStageName] = useState("");
  const [bio, setBio] = useState("");

  async function reload() {
    const row = await fetchArtist(artistId, { skipAuth: status !== "authenticated" });
    setArtist(row);
    setStageName(row.stage_name);
    setBio(row.bio ?? "");
  }

  useEffect(() => {
    let cancelled = false;
    setArtist(null);
    (async () => {
      setLoading(true);
      setError(null);
      try {
        await reload();
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Unable to load artist");
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
  }, [artistId, status]);

  async function run(fn: () => Promise<ArtistRecord>) {
    setActionError(null);
    try {
      const row = await fn();
      setArtist(row);
      setStageName(row.stage_name);
      setBio(row.bio ?? "");
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Action failed");
    }
  }

  if (loading) {
    return <LoadingState label="Loading artist" />;
  }
  if (error) {
    return <ErrorState title="Artist unavailable" message={error} />;
  }
  if (!artist) {
    return <EmptyState message="Artist not found." />;
  }

  const canManage = Boolean(artist.version);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">{artist.stage_name}</h1>
        <p className="mt-1 text-sm text-neutral-600">{artist.status}</p>
        <p className="mt-2 text-sm">
          <Link href={`/artists/${artist.id}/analytics`} className="underline">
            Operational play aggregates
          </Link>
          {" · "}
          <Link href={`/staff/analytics/artists/${artist.id}`} className="underline">
            Artist analytics
          </Link>
        </p>
      </div>
      {actionError ? <ErrorState title="Action failed" message={actionError} /> : null}
      {canManage ? (
        <Card>
          <form
            className="space-y-3"
            onSubmit={(form: FormEvent) => {
              form.preventDefault();
              if (!artist.version) {
                return;
              }
              void run(() => updateArtist(artist.id, { stage_name: stageName, bio, version: artist.version }));
            }}
          >
            <Input value={stageName} onChange={(e) => setStageName(e.target.value)} />
            <Input value={bio} onChange={(e) => setBio(e.target.value)} />
            <Button type="submit" size="sm">
              Save
            </Button>
          </form>
        </Card>
      ) : (
        <Card>
          <p className="text-sm">{artist.bio ?? "No biography."}</p>
        </Card>
      )}
      {canManage ? (
        <Card>
          <h2 className="text-sm font-medium">Lifecycle</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {["start_review", "approve", "activate", "begin_contract", "mark_signed", "suspend", "terminate"].map(
              (action) => (
                <Button
                  key={action}
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void run(() => transitionArtist(artist.id, action, artist.version))}
                >
                  {action}
                </Button>
              ),
            )}
          </div>
        </Card>
      ) : status === "authenticated" && artist.status === "ACTIVE" ? (
        <Card>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => {
                void followArtist(artist.id).catch((err: unknown) => {
                  setActionError(err instanceof ApiError ? err.message : "Follow failed");
                });
              }}
            >
              Follow
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                void unfollowArtist(artist.id).catch((err: unknown) => {
                  setActionError(err instanceof ApiError ? err.message : "Unfollow failed");
                });
              }}
            >
              Unfollow
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

export default function ArtistDetailPage() {
  return <ArtistDetailBody />;
}
