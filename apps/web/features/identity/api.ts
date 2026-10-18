/* Health, auth, current user and organizations (workspace). Split from lib/api.ts (Phase 16, Stage 5). */

import { apiFetch, clearAccessToken, getApiBaseUrl, refreshAccessToken, setAccessToken } from "@/lib/api/client";
import { safeNextPath } from "@/lib/auth-view";

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
  /** Menus only (the API still decides every page): an approved artist, or a band admin. */
  is_artist?: boolean;
  /** Menus only: belongs to a workspace (staff). */
  has_workspace?: boolean;
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
  /** Shared with workspace admins only; null for everyone else. */
  display_name?: string | null;
  email?: string | null;
  role_key?: string | null;
  role_name?: string | null;
};

/** A role this workspace admin may give (never more than they hold themselves). */
export type GrantableRole = { id: string; key: string; name: string };

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

export async function createInvitation(orgId: string, email: string, roleId?: string | null): Promise<Invitation & { token: string }> {
  return apiFetch<Invitation & { token: string }>(`/api/v1/organizations/${orgId}/invites`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(roleId ? { email, role_id: roleId } : { email }),
    retry: false,
  });
}

export async function fetchGrantableRoles(orgId: string): Promise<GrantableRole[]> {
  return apiFetch<GrantableRole[]>(`/api/v1/organizations/${orgId}/grantable-roles`, { retry: false });
}

/** Public: which workspace and role an invitation is for (the email only as a hint). */
export async function checkInvitation(token: string): Promise<{ organization_name: string; role_name: string | null; email_hint: string }> {
  return apiFetch<{ organization_name: string; role_name: string | null; email_hint: string }>("/api/v1/organizations/invitations/check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
    retry: false,
    skipAuth: true,
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

/** How a verification link reaches the person. "not_configured" until an email provider exists (OD-08). */
export type VerificationDelivery = "dev_mailbox" | "email" | "not_configured";

export interface VerificationOffer {
  verification_delivery: VerificationDelivery;
  /** Local and test servers only: the link that verifies the account. Always null elsewhere. */
  dev_verification_url?: string | null;
}

export async function register(email: string, password: string, display_name: string) {
  return apiFetch<{ user: AuthUser; verification_required: boolean } & VerificationOffer>("/api/v1/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, display_name }),
    retry: false,
    skipAuth: true,
    skipRefresh: true,
  });
}

/** Ask for a new verification link. The answer is the same whether or not the address exists. */
export async function requestVerification(email: string) {
  return apiFetch<{ status: string } & VerificationOffer>("/api/v1/auth/verification/request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
    retry: false,
    skipAuth: true,
    skipRefresh: true,
  });
}

export async function completeVerification(token: string): Promise<void> {
  await apiFetch<void>("/api/v1/auth/verification/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
    retry: false,
    skipAuth: true,
    skipRefresh: true,
  });
}

/**
 * Turn a dev verification link into a same-site path. The token stays in the `#` fragment, so it
 * is never sent to a server or written to access logs. Anything unexpected gives null.
 */
export function verifyPathFromLink(link: string | null | undefined): string | null {
  if (!link) return null;
  const hash = link.indexOf("#");
  if (hash < 0) return null;
  const token = new URLSearchParams(link.slice(hash + 1)).get("token");
  return token && /^[A-Za-z0-9_-]+$/.test(token) ? `/verify#token=${token}` : null;
}

/** Which outside sign-in options the API has switched on. */
export async function fetchAuthProviders(): Promise<{ google: boolean }> {
  return apiFetch<{ google: boolean }>("/api/v1/auth/providers", { retry: false, skipAuth: true, skipRefresh: true });
}

/**
 * Where "Continue with Google" sends the browser: a top-level navigation to the API, which runs
 * the whole Google exchange server-side and returns to /auth/continue. No token passes through
 * the browser or the URL.
 */
export function googleSignInUrl(next: string | null | undefined): string {
  const query = new URLSearchParams({ next: safeNextPath(next) });
  return `${getApiBaseUrl()}/api/v1/auth/google/start?${query.toString()}`;
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


// --- Delivery address for gifts (D-ADDR-01). Personal data: only the owner reads it. ---

export type DeliveryAddress = {
  recipient_name: string;
  phone: string;
  division: string;
  district: string;
  upazila: string;
  area: string;
  house_road: string;
  postcode: string | null;
  landmark: string | null;
  updated_at?: string | null;
};

export type DeliveryAddressDraft = Omit<DeliveryAddress, "updated_at">;

export type AddressOptions = { country: string; divisions: Array<{ name: string; districts: string[] }> };

export async function fetchAddressOptions(): Promise<AddressOptions> {
  return apiFetch<AddressOptions>("/api/v1/address-options", { skipAuth: true });
}

/** The saved address, or null when the user has not added one yet. */
export async function fetchMyDeliveryAddress(): Promise<DeliveryAddress | null> {
  try {
    return await apiFetch<DeliveryAddress>("/api/v1/me/delivery-address", { retry: false });
  } catch (err) {
    if (err instanceof Error && "status" in err && (err as { status: number }).status === 404) return null;
    throw err;
  }
}

export async function saveMyDeliveryAddress(address: DeliveryAddressDraft): Promise<DeliveryAddress> {
  return apiFetch<DeliveryAddress>("/api/v1/me/delivery-address", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(address),
    retry: false,
  });
}