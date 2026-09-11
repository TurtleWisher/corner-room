"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { useAuth } from "@/components/auth-provider";
import {
  ApiError,
  fetchInvitations,
  fetchMemberships,
  fetchMe,
  fetchOrganizations,
  switchOrganization,
  type Invitation,
  type Membership,
  type Organization,
} from "@/lib/api";
import { invitationsForActiveOrg, membersForActiveOrg } from "@/lib/workspace-view";

type WorkspaceContextValue = {
  organizations: Organization[];
  currentOrg: Organization | null;
  members: Membership[];
  invitations: Invitation[];
  loading: boolean;
  error: string | null;
  switchTo: (orgId: string) => Promise<void>;
  reload: () => Promise<void>;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { status, user } = useAuth();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [currentOrg, setCurrentOrg] = useState<Organization | null>(null);
  const [membersOrgId, setMembersOrgId] = useState<string | null>(null);
  const [members, setMembers] = useState<Membership[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (status !== "authenticated") {
      setOrganizations([]);
      setCurrentOrg(null);
      setMembers([]);
      setInvitations([]);
      setMembersOrgId(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const page = await fetchOrganizations();
      setOrganizations(page.items);
      const me = await fetchMe();
      const active = page.items.find((org) => org.id === me.organization_id) ?? null;
      setCurrentOrg(active);
      if (!active) {
        setMembers([]);
        setInvitations([]);
        setMembersOrgId(null);
        return;
      }
      const [memberPage, invitePage] = await Promise.all([
        fetchMemberships(active.id),
        fetchInvitations(active.id).catch((err: unknown) => {
          if (err instanceof ApiError && err.status === 403) {
            return { items: [] as Invitation[], next_cursor: null };
          }
          throw err;
        }),
      ]);
      setMembersOrgId(active.id);
      setMembers(memberPage.items);
      setInvitations(invitePage.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to load organizations");
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load, user?.id, user?.organization_id]);

  const switchTo = useCallback(
    async (orgId: string) => {
      setMembers([]);
      setInvitations([]);
      setMembersOrgId(null);
      setCurrentOrg(null);
      const result = await switchOrganization(orgId);
      setCurrentOrg(result.organization);
      await load();
    },
    [load],
  );

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      organizations,
      currentOrg,
      members: membersForActiveOrg(currentOrg?.id ?? null, membersOrgId, members),
      invitations: invitationsForActiveOrg(currentOrg?.id ?? null, invitations),
      loading,
      error,
      switchTo,
      reload: load,
    }),
    [organizations, currentOrg, members, membersOrgId, invitations, loading, error, switchTo, load],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error("useWorkspace must be used within WorkspaceProvider");
  }
  return ctx;
}
