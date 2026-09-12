"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { Protected } from "@/components/protected";
import { EmptyState, ErrorState, LoadingState } from "@/components/async-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  ApiError,
  applyOrganizationLifecycle,
  fetchMemberships,
  fetchOrganization,
  type Membership,
  type Organization,
} from "@/lib/api";
import { adminErrorKind, canSuspend, canUnsuspend } from "@/lib/admin-view";

function StaffOrganizationDetailBody() {
  const params = useParams<{ id: string }>();
  const [row, setRow] = useState<Organization | null>(null);
  const [members, setMembers] = useState<Membership[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<"workspace" | "forbidden" | "not_found" | "other" | null>(
    null,
  );

  async function reload() {
    if (!params.id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    setErrorKind(null);
    try {
      const [org, memberships] = await Promise.all([
        fetchOrganization(params.id),
        fetchMemberships(params.id),
      ]);
      setRow(org);
      setMembers(memberships.items);
    } catch (err) {
      if (err instanceof ApiError) {
        setErrorKind(adminErrorKind(err.code, err.status));
        setError(err.message);
      } else {
        setErrorKind("other");
        setError("Unable to load organization");
      }
      setRow(null);
      setMembers([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, [params.id]);

  async function onLifecycle(action: "suspend" | "unsuspend" | "activate") {
    if (!row) {
      return;
    }
    setError(null);
    try {
      await applyOrganizationLifecycle(row.id, action);
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Lifecycle failed");
    }
  }

  if (loading) {
    return <LoadingState label="Loading organization" />;
  }
  if (errorKind === "not_found" || errorKind === "forbidden") {
    return <ErrorState title="Not found" message={error ?? "Organization not found"} />;
  }
  if (error && !row) {
    return <ErrorState message={error} />;
  }
  if (!row) {
    return <EmptyState message="Organization not found" />;
  }

  return (
    <div className="space-y-6">
      <p className="text-sm">
        <Link href="/staff/organizations" className="underline">
          All organizations
        </Link>
      </p>
      <div>
        <h1 className="text-2xl font-semibold">{row.name}</h1>
        <p className="text-sm text-neutral-600">
          {row.type} · {row.status}
        </p>
      </div>
      {error ? <ErrorState message={error} /> : null}
      <section className="flex flex-wrap gap-2">
        {canSuspend(row.status) ? (
          <Button type="button" onClick={() => void onLifecycle("suspend")}>
            Suspend
          </Button>
        ) : null}
        {canUnsuspend(row.status) ? (
          <Button type="button" onClick={() => void onLifecycle("unsuspend")}>
            Reactivate
          </Button>
        ) : null}
        {row.status === "PENDING" ? (
          <Button type="button" onClick={() => void onLifecycle("activate")}>
            Activate
          </Button>
        ) : null}
      </section>
      <Card>
        <h2 className="font-medium">Memberships</h2>
        {members.length === 0 ? <EmptyState message="No memberships" /> : null}
        {members.map((item) => (
          <p key={item.id} className="mt-2 text-sm">
            {item.user_id} · {item.status}
          </p>
        ))}
      </Card>
    </div>
  );
}

export default function StaffOrganizationDetailPage() {
  return (
    <Protected permission="org.admin">
      <StaffOrganizationDetailBody />
    </Protected>
  );
}
