"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { Protected } from "@/components/protected";
import { useWorkspace } from "@/components/workspace-provider";
import { EmptyState, ErrorState, LoadingState } from "@/components/async-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ApiError, applyUserLifecycle, fetchAdminUser, type AdminUserInspect } from "@/lib/api";
import { adminErrorKind, canSuspend, canUnsuspend, userStatusLabel } from "@/lib/admin-view";

function StaffUserDetailBody() {
  const params = useParams<{ id: string }>();
  const { currentOrg } = useWorkspace();
  const [row, setRow] = useState<AdminUserInspect | null>(null);
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
      setRow(await fetchAdminUser(params.id));
    } catch (err) {
      if (err instanceof ApiError) {
        setErrorKind(adminErrorKind(err.code, err.status));
        setError(err.message);
      } else {
        setErrorKind("other");
        setError("Unable to load user");
      }
      setRow(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, [currentOrg, params.id]);

  async function onLifecycle(action: "suspend" | "unsuspend" | "activate") {
    if (!row) {
      return;
    }
    setError(null);
    try {
      await applyUserLifecycle(row.id, action);
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Lifecycle failed");
    }
  }

  if (loading) {
    return <LoadingState label="Loading user" />;
  }
  if (errorKind === "not_found") {
    return <ErrorState title="Not found" message={error ?? "User not found"} />;
  }
  if (error && !row) {
    return <ErrorState message={error} />;
  }
  if (!row) {
    return <EmptyState message="User not found" />;
  }

  return (
    <div className="space-y-6">
      <p className="text-sm">
        <Link href="/staff/users" className="underline">
          All users
        </Link>
      </p>
      <div>
        <h1 className="text-2xl font-semibold">{row.email ?? row.phone ?? row.id}</h1>
        <p className="text-sm text-neutral-600">{userStatusLabel(row.status)}</p>
        <p className="text-sm text-neutral-600">
          Verified {row.email_verified ? "yes" : "no"} · Locked {row.security_locked ? "yes" : "no"}
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
        {row.status === "PENDING_VERIFICATION" ? (
          <Button type="button" onClick={() => void onLifecycle("activate")}>
            Activate
          </Button>
        ) : null}
      </section>
      <Card>
        <h2 className="font-medium">Assignments</h2>
        {row.assignments.length === 0 ? <EmptyState message="No role assignments" /> : null}
        {row.assignments.map((item) => (
          <p key={item.id} className="mt-2 text-sm">
            {item.role_key} · {item.status}
          </p>
        ))}
      </Card>
      <Card>
        <h2 className="font-medium">Memberships</h2>
        {row.memberships.length === 0 ? <EmptyState message="No memberships" /> : null}
        {row.memberships.map((item) => (
          <p key={item.id} className="mt-2 text-sm">
            {item.organization_id} · {item.status}
          </p>
        ))}
      </Card>
    </div>
  );
}

export default function StaffUserDetailPage() {
  return (
    <Protected permission="user.admin">
      <StaffUserDetailBody />
    </Protected>
  );
}
