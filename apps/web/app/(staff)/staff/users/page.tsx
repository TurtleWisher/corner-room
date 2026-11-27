"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

import { useWorkspace } from "@/components/workspace-provider";
import { ApiError, fetchAdminUsers, type AdminUserRecord } from "@/lib/api";
import { WORKSPACE_REQUIRED_COPY, adminErrorKind, userStatusLabel } from "@/lib/admin-view";
import { PersonMark } from "@/components/staff/customers-kit";
import { Button, EmptyState, ErrorState, Input, LoadingState, Protected } from "@/components/staff/kit";
import { profileHref } from "@/lib/customer-profile-view";

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
        <p className="mt-1 text-sm text-fg-muted">
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
      {items.length ? (
        <div className="cx">
          <div className="cx-glass cr-cut cx-list">
            {items.map((row) => (
              <div key={row.id} className="cx-person cx-person-plain">
                <div className="cx-who">
                  <PersonMark name={row.email ?? row.phone ?? "?"} seed={row.id} src={row.picture_url} />
                  <div className="cx-who-text">
                    <span className="cx-name">{row.email ?? row.phone ?? row.id}</span>
                    <span className="cx-sub">{userStatusLabel(row.status)}</span>
                  </div>
                </div>
                <span className="flex flex-wrap justify-end gap-3 text-xs font-semibold">
                  <Link href={profileHref(row.id)} className="cr-focus text-link underline-offset-2 hover:underline">
                    History
                  </Link>
                  <Link href={`/staff/users/${row.id}`} className="cr-focus text-link underline-offset-2 hover:underline">
                    Roles and controls
                  </Link>
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
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
