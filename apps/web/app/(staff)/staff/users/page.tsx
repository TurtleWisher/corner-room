"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

import { Protected } from "@/components/protected";
import { useWorkspace } from "@/components/workspace-provider";
import { EmptyState, ErrorState, LoadingState } from "@/components/async-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ApiError, fetchAdminUsers, type AdminUserRecord } from "@/lib/api";
import { WORKSPACE_REQUIRED_COPY, adminErrorKind, userStatusLabel } from "@/lib/admin-view";

function StaffUsersBody() {
  const { currentOrg } = useWorkspace();
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<AdminUserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorKind, setErrorKind] = useState<"workspace" | "forbidden" | "not_found" | "other" | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  async function reload(search?: string) {
    setLoading(true);
    setError(null);
    setErrorKind(null);
    try {
      const page = await fetchAdminUsers(search);
      setItems(page.items);
    } catch (err) {
      if (err instanceof ApiError) {
        setErrorKind(adminErrorKind(err.code, err.status));
        setError(err.message);
      } else {
        setErrorKind("other");
        setError("Unable to load users");
      }
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, [currentOrg]);

  function onSearch(event: FormEvent) {
    event.preventDefault();
    void reload(query.trim() || undefined);
  }

  if (loading) {
    return <LoadingState label="Loading users" />;
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
        <h1 className="text-2xl font-semibold">Users</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Inspect only. Passwords and tokens are never shown. Workspace scopes the list when
          selected.
        </p>
      </div>
      {!currentOrg ? <EmptyState message={WORKSPACE_REQUIRED_COPY} /> : null}
      <form className="flex gap-2" onSubmit={onSearch}>
        <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Email or phone" />
        <Button type="submit">Search</Button>
      </form>
      {items.length === 0 ? <EmptyState message="No users in this page" /> : null}
      {items.map((row) => (
        <Card key={row.id}>
          <p className="font-medium">{row.email ?? row.phone ?? row.id}</p>
          <p className="text-sm text-neutral-600">{userStatusLabel(row.status)}</p>
          <p className="text-sm">
            <Link href={`/staff/users/${row.id}`} className="underline">
              Inspect
            </Link>
          </p>
        </Card>
      ))}
    </div>
  );
}

export default function StaffUsersPage() {
  return (
    <Protected permission="user.admin">
      <StaffUsersBody />
    </Protected>
  );
}
