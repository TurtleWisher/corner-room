"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";

import { Protected } from "@/components/protected";
import { useWorkspace } from "@/components/workspace-provider";
import { EmptyState, ErrorState, LoadingState } from "@/components/async-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ApiError, createArtist, fetchArtists, type ArtistRecord } from "@/lib/api";
import { rowsForActiveOrg } from "@/lib/workspace-view";

function ArtistsBody() {
  const { currentOrg } = useWorkspace();
  const [artists, setArtists] = useState<ArtistRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stageName, setStageName] = useState("");
  const [bio, setBio] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setArtists([]);
    if (!currentOrg) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    void fetchArtists()
      .then((page) => {
        if (!cancelled) {
          setArtists(page.items);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Unable to load artists");
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
  }, [currentOrg?.id]);

  const visible = rowsForActiveOrg(currentOrg?.id ?? null, artists);

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    try {
      const created = await createArtist({ stage_name: stageName, bio: bio || undefined });
      setArtists((rows) => [created, ...rows]);
      setStageName("");
      setBio("");
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Unable to create artist");
    }
  }

  if (!currentOrg) {
    return <EmptyState message="Switch to an organization workspace to manage the roster." />;
  }
  if (loading) {
    return <LoadingState label="Loading artists" />;
  }
  if (error) {
    return <ErrorState title="Artists unavailable" message={error} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Artists</h1>
          <p className="mt-1 text-sm text-neutral-600">
            Organization-scoped roster. Switching workspace clears this list before reload. Affiliation is
            not legal ownership.
          </p>
        </div>
        <Link href="/artists/apply" className="text-sm underline">
          Apply
        </Link>
      </div>
      <Card>
        <h2 className="text-sm font-medium">Add artist</h2>
        <form onSubmit={onCreate} className="mt-3 space-y-3">
          <Input
            value={stageName}
            onChange={(e) => setStageName(e.target.value)}
            placeholder="Stage name"
            required
          />
          <Input value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Biography" />
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
      {visible.length === 0 ? (
        <EmptyState message="No artists in this workspace." />
      ) : (
        <ul className="space-y-3">
          {visible.map((row) => (
            <li key={row.id}>
              <Card className="flex items-center justify-between gap-4">
                <div>
                  <p className="font-medium">{row.stage_name}</p>
                  <p className="text-sm text-neutral-600">{row.status}</p>
                </div>
                <Link href={`/artists/${row.id}`} className="text-sm underline">
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

export default function ArtistsPage() {
  return (
    <Protected>
      <ArtistsBody />
    </Protected>
  );
}
