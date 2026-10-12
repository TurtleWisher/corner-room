/* Health, auth, current user and organizations (workspace). Split from lib/api.ts (Phase 16, Stage 5). */

import { apiFetch, clearAccessToken, refreshAccessToken, setAccessToken } from "@/lib/api/client";

export type HealthCheck = {
  status: string;
  ok?: boolean;
  honesty?: string;
};

export type HealthResponse = {
  status: string;
  checks?: Record<string, HealthCheck | boolean>;
};

export type AuthUser = {
  id: string;
  email: string | null;
  display_name: string | null;
  status: string;
  locale?: string | null;
  permissions?: string[];
  email_verified?: boolean;
  organization_id?: string | null;
};

export type Organization = {
  id: string;
  name: string;
  type: string;
  status: string;
  share_bps: number | null;
};

export type Membership = {
  id: string;
  organization_id: string;
  user_id: string;
  role_id: string | null;
  status: string;
  ended_at: string | null;
};

export type Invitation = {
  id: string;
  organization_id: string;
  email: string;
  status: string;
  role_id: string | null;
  invited_user_id: string | null;
  expires_at: string | null;
  accepted_at: string | null;
};

export type Page<T> = {
  items: T[];
  next_cursor: string | null;
};

export async function fetchOrganizations(): Promise<Page<Organization>> {
  return apiFetch<Page<Organization>>("/api/v1/organizations", { retry: false });
}

export async function fetchOrganization(orgId: string): Promise<Organization> {
  return apiFetch<Organization>(`/api/v1/organizations/${orgId}`, { retry: false });
}

export async function applyOrganizationLifecycle(
  orgId: string,
  action: "activate" | "suspend" | "unsuspend" | "archive",
): Promise<Organization> {
  return apiFetch<Organization>(`/api/v1/organizations/${orgId}/lifecycle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
    retry: false,
  });
}

export async function fetchMemberships(orgId: string): Promise<Page<Membership>> {
  return apiFetch<Page<Membership>>(`/api/v1/organizations/${orgId}/memberships`, { retry: false });
}

export async function fetchInvitations(orgId: string): Promise<Page<Invitation>> {
  return apiFetch<Page<Invitation>>(`/api/v1/organizations/${orgId}/invitations`, { retry: false });
}

export async function switchOrganization(orgId: string): Promise<{ access_token: string; organization: Organization }> {
  const result = await apiFetch<{ access_token: string; organization: Organization }>(
    `/api/v1/organizations/${orgId}/switch`,
    { method: "POST", retry: false },
  );
  setAccessToken(result.access_token);
  return result;
}

export async function createInvitation(orgId: string, email: string): Promise<Invitation & { token: string }> {
  return apiFetch<Invitation & { token: string }>(`/api/v1/organizations/${orgId}/invites`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
    retry: false,
  });
}

export async function acceptInvitation(token: string): Promise<Membership> {
  return apiFetch<Membership>("/api/v1/organizations/invitations/accept", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
    retry: false,
  });
}

export type TokenResponse = {
  access_token: string;
  expires_in: number;
  expires_at: string;
  user: AuthUser;
};

export async function fetchHealth(): Promise<HealthResponse> {
  return apiFetch<HealthResponse>("/health", { cache: "no-store", skipAuth: true, skipRefresh: true });
}

export async function login(email: string, password: string): Promise<TokenResponse> {
  const result = await apiFetch<TokenResponse>("/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
    retry: false,
    skipAuth: true,
    skipRefresh: true,
  });
  setAccessToken(result.access_token);
  return result;
}

export async function register(email: string, password: string, display_name: string) {
  return apiFetch<{ user: AuthUser; verification_required: boolean }>("/api/v1/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, display_name }),
    retry: false,
    skipAuth: true,
    skipRefresh: true,
  });
}

export async function logout(): Promise<void> {
  try {
    await apiFetch("/api/v1/auth/logout", { method: "POST", retry: false, skipRefresh: true });
  } finally {
    clearAccessToken();
  }
}

export async function fetchMe(): Promise<AuthUser> {
  return apiFetch<AuthUser>("/api/v1/me", { retry: false });
}

export async function restoreSession(): Promise<AuthUser | null> {
  try {
    const refreshed = await refreshAccessToken();
    if (!refreshed) {
      return null;
    }
    return await fetchMe();
  } catch {
    clearAccessToken();
    return null;
  }
}

export type SessionRecord = {
  id: string;
  status: string;
  current: boolean;
  created_at: string;
  last_used_at: string | null;
  expires_at: string;
  user_agent: string | null;
  ip: string | null;
};

/** GET /me/sessions returns a plain list. */
export async function fetchMySessions(): Promise<SessionRecord[]> {
  return apiFetch<SessionRecord[]>("/api/v1/me/sessions", { retry: false });
}

export async function revokeSession(id: string): Promise<void> {
  await apiFetch<null>(`/api/v1/me/sessions/${id}`, { method: "DELETE", retry: false });
}

export async function revokeAllSessions(): Promise<void> {
  await apiFetch<null>("/api/v1/me/sessions/revoke-all", { method: "POST", retry: false });
}
