"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";

import { useAuth } from "@/components/auth-provider";
import { useWorkspace } from "@/components/workspace-provider";
import { EmptyState, ErrorState, LoadingState } from "@/components/async-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ApiError, createRelease, fetchReleases, type ReleaseRecord } from "@/lib/api";
import { rowsForActiveOrg } from "@/lib/workspace-view";

export default function ReleasesPage() {
  const { status } = useAuth();
  const { currentOrg } = useWorkspace();
  const [releases, setReleases] = useState<ReleaseRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [releaseType, setReleaseType] = useState("SINGLE");
  const [formError, setFormError] = useState<string | null>(null);
  const staff = status === "authenticated" && Boolean(currentOrg);

  useEffect(() => {
    let cancelled = false;
    setReleases([]);
    setLoading(true);
    setError(null);
    void fetchReleases({ skipAuth: status !== "authenticated" })
      .then((page) => {
        if (!cancelled) {
          setReleases(page.items);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Unable to load releases");
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

  const visible = staff ? rowsForActiveOrg(currentOrg?.id ?? null, releases) : releases;

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    try {
      const created = await createRelease({ title, release_type: releaseType });
      setReleases((rows) => [created, ...rows]);
      setTitle("");
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Unable to create release");
    }
  }

  if (loading) {
    return <LoadingState label="Loading releases" />;
  }
  if (error) {
    return <ErrorState title="Releases unavailable" message={error} />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Releases</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Album, EP, and Single are release types — not separate catalogs. RELEASED is catalog state
          only. No streaming or storefront checkout here.
        </p>
      </div>
      {staff ? (
        <Card>
          <h2 className="text-sm font-medium">Add release</h2>
          <form onSubmit={onCreate} className="mt-3 space-y-3">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" required />
            <select
              className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm"
              value={releaseType}
              onChange={(e) => setReleaseType(e.target.value)}
            >
              <option value="SINGLE">Single</option>
              <option value="EP">EP</option>
              <option value="ALBUM">Album</option>
              <option value="COMPILATION">Compilation</option>
              <option value="LIVE">Live</option>
            </select>
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
        <EmptyState message={staff ? "No releases in this workspace." : "No released catalog yet."} />
      ) : (
        <ul className="space-y-3">
          {visible.map((row) => (
            <li key={row.id}>
              <Card className="flex items-center justify-between gap-4">
                <div>
                  <p className="font-medium">{row.title}</p>
                  <p className="text-sm text-neutral-600">
                    {row.release_type} · {row.status}
                  </p>
                </div>
                <Link href={`/releases/${row.id}`} className="text-sm underline">
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
