"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Protected } from "@/components/protected";
import { EmptyState, ErrorState, LoadingState } from "@/components/async-state";
import { Card } from "@/components/ui/card";
import { ApiError, fetchOrganizations, type Organization } from "@/lib/api";
import { adminErrorKind } from "@/lib/admin-view";

function StaffOrganizationsBody() {
  const [items, setItems] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<"workspace" | "forbidden" | "not_found" | "other" | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetchOrganizations()
      .then((page) => {
        if (!cancelled) {
          setItems(page.items);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) {
          return;
        }
        if (err instanceof ApiError) {
          setErrorKind(adminErrorKind(err.code, err.status));
          setError(err.message);
        } else {
          setErrorKind("other");
          setError("Unable to load organizations");
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
  }, []);

  if (loading) {
    return <LoadingState label="Loading organizations" />;
  }
  if (errorKind === "forbidden") {
    return <ErrorState title="Not permitted" message={error ?? "Not permitted"} />;
  }
  if (error) {
    return <ErrorState message={error} />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Organizations</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Inspect existing organizations. Switch workspace on the Organizations page.
        </p>
      </div>
      {items.length === 0 ? <EmptyState message="No organizations visible" /> : null}
      {items.map((row) => (
        <Card key={row.id}>
          <p className="font-medium">{row.name}</p>
          <p className="text-sm text-neutral-600">
            {row.type} · {row.status}
          </p>
          <p className="text-sm">
            <Link href={`/staff/organizations/${row.id}`} className="underline">
              Inspect
            </Link>
          </p>
        </Card>
      ))}
    </div>
  );
}

export default function StaffOrganizationsPage() {
  return (
    <Protected permission="org.admin">
      <StaffOrganizationsBody />
    </Protected>
  );
}
