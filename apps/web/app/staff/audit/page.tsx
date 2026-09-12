"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Protected } from "@/components/protected";
import { useWorkspace } from "@/components/workspace-provider";
import { EmptyState, ErrorState, LoadingState } from "@/components/async-state";
import { Card } from "@/components/ui/card";
import { ApiError, fetchAudit, type AuditRecord } from "@/lib/api";
import { opsErrorKind } from "@/lib/ops-view";

function StaffAuditBody() {
  const { currentOrg } = useWorkspace();
  const [items, setItems] = useState<AuditRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorKind, setErrorKind] = useState<"workspace" | "forbidden" | "not_found" | "other" | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setErrorKind(null);
    void fetchAudit()
      .then((page) => {
        if (cancelled) {
          return;
        }
        setItems(page.items);
      })
      .catch((err: unknown) => {
        if (cancelled) {
          return;
        }
        if (err instanceof ApiError) {
          setErrorKind(opsErrorKind(err.code, err.status));
          setError(err.message);
        } else {
          setErrorKind("other");
          setError("Unable to load audit");
        }
        setItems([]);
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [currentOrg]);

  if (loading) {
    return <LoadingState label="Loading audit" />;
  }
  if (errorKind === "forbidden") {
    return <ErrorState title="Not permitted" message={error ?? "Not permitted"} />;
  }
  if (error && items.length === 0) {
    return <ErrorState message={error} />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Audit</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Append-only inspection. Secrets are scrubbed at write. Hide is not authorization.
        </p>
        <p className="mt-1 text-sm">
          <Link href="/staff/ops" className="underline">
            Operations
          </Link>
        </p>
      </div>
      {items.length === 0 ? <EmptyState message="No audit rows in this page" /> : null}
      {items.map((row) => (
        <Card key={row.id}>
          <p className="font-medium">{row.action}</p>
          <p className="text-sm text-neutral-600">
            {row.entity_type} · {row.entity_id} · {row.occurred_at}
          </p>
          <p className="text-sm">
            Actor {row.actor_id} · request {row.request_id ?? "none"}
          </p>
        </Card>
      ))}
    </div>
  );
}

export default function StaffAuditPage() {
  return (
    <Protected permission="audit.read">
      <StaffAuditBody />
    </Protected>
  );
}
