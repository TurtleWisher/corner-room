"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";

import { Protected } from "@/components/protected";
import { useWorkspace } from "@/components/workspace-provider";
import { EmptyState, ErrorState, LoadingState } from "@/components/async-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ApiError, createBand, fetchBands, type BandRecord } from "@/lib/api";
import { rowsForActiveOrg } from "@/lib/workspace-view";

function BandsBody() {
  const { currentOrg } = useWorkspace();
  const [bands, setBands] = useState<BandRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setBands([]);
    if (!currentOrg) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    void fetchBands()
      .then((page) => {
        if (!cancelled) {
          setBands(page.items);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Unable to load bands");
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

  const visible = rowsForActiveOrg(currentOrg?.id ?? null, bands);

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    try {
      const created = await createBand({ name });
      setBands((rows) => [created, ...rows]);
      setName("");
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Unable to create band");
    }
  }

  if (!currentOrg) {
    return <EmptyState message="Switch to an organization workspace to manage bands." />;
  }
  if (loading) {
    return <LoadingState label="Loading bands" />;
  }
  if (error) {
    return <ErrorState title="Bands unavailable" message={error} />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Bands</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Organization-scoped. Switching workspace clears this list before reload.
        </p>
      </div>
      <Card>
        <h2 className="text-sm font-medium">Create band</h2>
        <form onSubmit={onCreate} className="mt-3 space-y-3">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" required />
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
        <EmptyState message="No bands in this workspace." />
      ) : (
        <ul className="space-y-3">
          {visible.map((row) => (
            <li key={row.id}>
              <Card className="flex items-center justify-between gap-4">
                <div>
                  <p className="font-medium">{row.name}</p>
                  <p className="text-sm text-neutral-600">{row.status}</p>
                </div>
                <Link href={`/bands/${row.id}`} className="text-sm underline">
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

export default function BandsPage() {
  return (
    <Protected>
      <BandsBody />
    </Protected>
  );
}
