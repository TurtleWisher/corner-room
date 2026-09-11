export type ProblemDetails = {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  code?: string;
  instance?: string;
  request_id?: string;
  correlation_id?: string;
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly correlationId?: string;
  readonly problem: ProblemDetails;

  constructor(problem: ProblemDetails, fallback = "Request failed") {
    super(problem.detail || problem.title || fallback);
    this.name = "ApiError";
    this.status = problem.status ?? 0;
    this.code = problem.code ?? "HTTP_ERROR";
    this.correlationId = problem.correlation_id ?? problem.request_id;
    this.problem = problem;
  }
}

export function getApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
}

export function newCorrelationId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `cr-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

let accessToken: string | null = null;
let refreshInFlight: Promise<string | null> | null = null;
const listeners = new Set<(token: string | null) => void>();

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
  listeners.forEach((listener) => listener(token));
}

export function subscribeAccessToken(listener: (token: string | null) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function clearAccessToken(): void {
  setAccessToken(null);
}

type ApiFetchOptions = RequestInit & {
  timeoutMs?: number;
  retry?: boolean;
  skipAuth?: boolean;
  skipRefresh?: boolean;
};

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return { detail: text, status: response.status };
  }
}

function isAuthPath(path: string): boolean {
  return (
    path.startsWith("/api/v1/auth/login") ||
    path.startsWith("/api/v1/auth/register") ||
    path.startsWith("/api/v1/auth/refresh") ||
    path.startsWith("/api/v1/auth/password/forgot") ||
    path.startsWith("/api/v1/auth/password/reset") ||
    path.startsWith("/api/v1/auth/verification/")
  );
}

async function refreshAccessToken(): Promise<string | null> {
  if (refreshInFlight) {
    return refreshInFlight;
  }
  refreshInFlight = (async () => {
    try {
      const result = await apiFetch<{ access_token: string }>("/api/v1/auth/refresh", {
        method: "POST",
        retry: false,
        skipAuth: true,
        skipRefresh: true,
      });
      setAccessToken(result.access_token);
      return result.access_token;
    } catch {
      clearAccessToken();
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const { timeoutMs = 8000, retry, headers, skipAuth, skipRefresh, ...init } = options;
  const method = (init.method ?? "GET").toUpperCase();
  const correlationId = newCorrelationId();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const token = skipAuth ? null : accessToken;

  const request = async (authToken: string | null): Promise<Response> =>
    fetch(`${getApiBaseUrl()}${path}`, {
      ...init,
      method,
      credentials: init.credentials ?? "include",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "X-Request-ID": correlationId,
        "X-Correlation-ID": correlationId,
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        ...headers,
      },
    });

  try {
    let response: Response;
    try {
      response = await request(token);
    } catch (error) {
      const shouldRetry = retry ?? method === "GET";
      if (!shouldRetry) {
        throw new ApiError({
          status: 0,
          code: "NETWORK_ERROR",
          title: "Network error",
          detail: "The API is not reachable.",
          correlation_id: correlationId,
        });
      }
      try {
        response = await request(token);
      } catch {
        throw new ApiError({
          status: 0,
          code: "NETWORK_ERROR",
          title: "Network error",
          detail: "The API is not reachable.",
          correlation_id: correlationId,
        });
      }
    }

    if (response.status === 401 && !skipRefresh && !isAuthPath(path)) {
      const refreshed = await refreshAccessToken();
      if (refreshed) {
        response = await request(refreshed);
      }
    }

    const body = await parseBody(response);
    if (!response.ok) {
      const problem = (body && typeof body === "object" ? body : {}) as ProblemDetails;
      throw new ApiError(
        {
          ...problem,
          status: response.status,
          correlation_id: problem.correlation_id ?? response.headers.get("x-correlation-id") ?? correlationId,
        },
        "Request failed",
      );
    }
    return body as T;
  } finally {
    clearTimeout(timer);
  }
}

export type HealthResponse = {
  status: string;
  checks?: { database: boolean; redis: boolean };
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

export type EventRecord = {
  id: string;
  organization_id?: string;
  venue_id: string | null;
  title: string;
  description: string | null;
  status: string;
  timezone: string;
  starts_at: string | null;
  ends_at: string | null;
  published_at?: string | null;
  cancelled_at?: string | null;
  postponed_at?: string | null;
  cancellation_reason?: string | null;
  postponement_reason?: string | null;
  previous_starts_at?: string | null;
  previous_ends_at?: string | null;
  version?: number;
};

export type VenueRecord = {
  id: string;
  organization_id: string;
  name: string;
  address: Record<string, unknown> | null;
  capacity: number;
  status: string;
  version: number;
};

export type MilestoneRecord = {
  id: string;
  event_id: string;
  type: string;
  occurred_at: string;
  previous_state: string | null;
  new_state: string | null;
  description: string | null;
};

export async function fetchEvents(): Promise<Page<EventRecord>> {
  return apiFetch<Page<EventRecord>>("/api/v1/events", { retry: false });
}

export async function fetchPublicEvents(): Promise<Page<EventRecord>> {
  return apiFetch<Page<EventRecord>>("/api/v1/events", { retry: false, skipAuth: true, skipRefresh: true });
}

export async function fetchEvent(id: string, opts?: { skipAuth?: boolean }): Promise<EventRecord> {
  return apiFetch<EventRecord>(`/api/v1/events/${id}`, {
    retry: false,
    skipAuth: opts?.skipAuth,
    skipRefresh: opts?.skipAuth,
  });
}

export async function createEvent(body: {
  title: string;
  timezone: string;
  description?: string;
  starts_at?: string;
  ends_at?: string;
}): Promise<EventRecord> {
  return apiFetch<EventRecord>("/api/v1/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    retry: false,
  });
}

export async function updateEvent(
  id: string,
  body: Partial<{
    title: string;
    description: string | null;
    timezone: string;
    starts_at: string | null;
    ends_at: string | null;
    version: number;
  }>,
): Promise<EventRecord> {
  return apiFetch<EventRecord>(`/api/v1/events/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    retry: false,
  });
}

export async function transitionEvent(
  id: string,
  body: {
    action: string;
    starts_at?: string;
    ends_at?: string;
    reason?: string;
    resume_status?: string;
    version?: number;
  },
): Promise<EventRecord> {
  return apiFetch<EventRecord>(`/api/v1/events/${id}/lifecycle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    retry: false,
  });
}

export async function assignEventVenue(id: string, venue_id: string | null, version?: number): Promise<EventRecord> {
  return apiFetch<EventRecord>(`/api/v1/events/${id}/venue`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ venue_id, version }),
    retry: false,
  });
}

export async function fetchMilestones(id: string): Promise<Page<MilestoneRecord>> {
  return apiFetch<Page<MilestoneRecord>>(`/api/v1/events/${id}/milestones`, { retry: false });
}

export async function fetchVenues(): Promise<Page<VenueRecord>> {
  return apiFetch<Page<VenueRecord>>("/api/v1/venues", { retry: false });
}

export async function fetchVenue(id: string): Promise<VenueRecord> {
  return apiFetch<VenueRecord>(`/api/v1/venues/${id}`, { retry: false });
}

export async function createVenue(body: {
  name: string;
  capacity?: number;
  address?: Record<string, unknown>;
}): Promise<VenueRecord> {
  return apiFetch<VenueRecord>("/api/v1/venues", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    retry: false,
  });
}

export async function updateVenue(
  id: string,
  body: Partial<{ name: string; capacity: number; address: Record<string, unknown> | null; version: number }>,
): Promise<VenueRecord> {
  return apiFetch<VenueRecord>(`/api/v1/venues/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    retry: false,
  });
}

export async function transitionVenue(id: string, action: string, version?: number): Promise<VenueRecord> {
  return apiFetch<VenueRecord>(`/api/v1/venues/${id}/lifecycle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, version }),
    retry: false,
  });
}

export type TicketTypeRecord = {
  id: string;
  event_id: string;
  name: string;
  status: string;
  price_amount_minor: number;
  currency_code: string;
  quantity_total: number;
  remaining: number;
  sales_starts_at: string | null;
  sales_ends_at: string | null;
  version?: number | null;
};

export type HoldRecord = {
  id: string;
  ticket_type_id: string;
  quantity: number;
  status: string;
  expires_at: string;
};

export type PaymentRecord = {
  id: string;
  order_id: string | null;
  status: string;
  amount_minor: number;
  currency_code: string;
  provider: string;
};

export type OrderRecord = {
  id: string;
  status: string;
  purpose?: string;
  total_amount_minor: number;
  currency_code: string;
  payment: PaymentRecord | null;
};

export type TicketRecord = {
  id: string;
  ticket_type_id: string;
  status: string;
  presentation_token: string | null;
};

export type CheckInRecord = {
  id: string;
  ticket_id: string;
  event_id: string;
  status: string;
  scanned_at: string;
};

export async function fetchEventTicketTypes(eventId: string, opts?: { skipAuth?: boolean }): Promise<Page<TicketTypeRecord>> {
  return apiFetch<Page<TicketTypeRecord>>(`/api/v1/events/${eventId}/ticket-types`, {
    retry: false,
    skipAuth: opts?.skipAuth,
    skipRefresh: opts?.skipAuth,
  });
}

export async function createTicketType(body: {
  event_id: string;
  name: string;
  price_amount_minor: number;
  currency_code: string;
  quantity_total: number;
}): Promise<TicketTypeRecord> {
  return apiFetch<TicketTypeRecord>("/api/v1/ticket-types", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    retry: false,
  });
}

export async function transitionTicketType(
  id: string,
  action: string,
  version?: number,
): Promise<TicketTypeRecord> {
  return apiFetch<TicketTypeRecord>(`/api/v1/ticket-types/${id}/lifecycle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, version }),
    retry: false,
  });
}

export async function createHold(ticket_type_id: string, quantity: number): Promise<HoldRecord> {
  return apiFetch<HoldRecord>("/api/v1/ticket-holds", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticket_type_id, quantity }),
    retry: false,
  });
}

export async function createOrder(hold_id: string, idempotencyKey: string): Promise<OrderRecord> {
  return apiFetch<OrderRecord>("/api/v1/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({ hold_id }),
    retry: false,
  });
}

export async function createCatalogOrder(offer_id: string, idempotencyKey: string): Promise<OrderRecord> {
  return apiFetch<OrderRecord>("/api/v1/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({ offer_id }),
    retry: false,
  });
}

export async function sandboxConfirmPayment(paymentId: string): Promise<OrderRecord> {
  return apiFetch<OrderRecord>(`/api/v1/payments/${paymentId}/sandbox-confirm`, {
    method: "POST",
    retry: false,
  });
}

export async function fetchMyTickets(): Promise<Page<TicketRecord>> {
  return apiFetch<Page<TicketRecord>>("/api/v1/me/tickets", { retry: false });
}

export async function fetchMyOrders(): Promise<Page<OrderRecord>> {
  return apiFetch<Page<OrderRecord>>("/api/v1/me/orders", { retry: false });
}

export async function checkInTicket(token: string): Promise<CheckInRecord> {
  return apiFetch<CheckInRecord>("/api/v1/check-in", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
    retry: false,
  });
}

export async function fetchAttendance(eventId: string): Promise<Page<CheckInRecord>> {
  return apiFetch<Page<CheckInRecord>>(`/api/v1/events/${eventId}/attendance`, { retry: false });
}

export type ArtistRecord = {
  id: string;
  stage_name: string;
  legal_name?: string | null;
  bio: string | null;
  status: string;
  primary_org_id?: string | null;
  claimed_user_id?: string | null;
  portrait_asset_id?: string | null;
  metadata?: Record<string, unknown> | null;
  version?: number;
};

export type BandRecord = {
  id: string;
  name: string;
  bio: string | null;
  status: string;
  primary_org_id?: string | null;
  portrait_asset_id?: string | null;
  metadata?: Record<string, unknown> | null;
  version?: number;
};

export type ApplicationRecord = {
  id: string;
  user_id: string;
  artist_id: string | null;
  status: string;
  version?: number;
};

export type BandMemberRecord = {
  id: string;
  band_id: string;
  user_id: string | null;
  artist_id: string | null;
  role_label: string | null;
  status: string;
};

export type LineupRecord = {
  id: string;
  event_id: string;
  artist_id: string | null;
  band_id: string | null;
  billing_order: number;
  status: string;
  contract_id: string | null;
  version?: number;
};

export async function fetchArtists(opts?: { skipAuth?: boolean }): Promise<Page<ArtistRecord>> {
  return apiFetch<Page<ArtistRecord>>("/api/v1/artists", {
    retry: false,
    skipAuth: opts?.skipAuth,
    skipRefresh: opts?.skipAuth,
  });
}

export async function fetchArtist(id: string, opts?: { skipAuth?: boolean }): Promise<ArtistRecord> {
  return apiFetch<ArtistRecord>(`/api/v1/artists/${id}`, {
    retry: false,
    skipAuth: opts?.skipAuth,
    skipRefresh: opts?.skipAuth,
  });
}

export async function createArtist(body: {
  stage_name: string;
  bio?: string;
  legal_name?: string;
}): Promise<ArtistRecord> {
  return apiFetch<ArtistRecord>("/api/v1/artists", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    retry: false,
  });
}

export async function updateArtist(
  id: string,
  body: Partial<{ stage_name: string; bio: string | null; version: number }>,
): Promise<ArtistRecord> {
  return apiFetch<ArtistRecord>(`/api/v1/artists/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    retry: false,
  });
}

export async function transitionArtist(id: string, action: string, version?: number): Promise<ArtistRecord> {
  return apiFetch<ArtistRecord>(`/api/v1/artists/${id}/lifecycle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, version }),
    retry: false,
  });
}

export async function submitArtistApplication(body: {
  stage_name: string;
  bio?: string;
}): Promise<ApplicationRecord> {
  return apiFetch<ApplicationRecord>("/api/v1/artist-applications", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    retry: false,
  });
}

export async function fetchArtistApplications(): Promise<Page<ApplicationRecord>> {
  return apiFetch<Page<ApplicationRecord>>("/api/v1/artist-applications", { retry: false });
}

export async function transitionApplication(id: string, action: string, version?: number): Promise<ApplicationRecord> {
  return apiFetch<ApplicationRecord>(`/api/v1/artist-applications/${id}/lifecycle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, version }),
    retry: false,
  });
}

export async function followArtist(id: string): Promise<{ status: string }> {
  return apiFetch(`/api/v1/artists/${id}/follow`, { method: "POST", retry: false });
}

export async function unfollowArtist(id: string): Promise<{ status: string }> {
  return apiFetch(`/api/v1/artists/${id}/follow`, { method: "DELETE", retry: false });
}

export async function fetchBands(opts?: { skipAuth?: boolean }): Promise<Page<BandRecord>> {
  return apiFetch<Page<BandRecord>>("/api/v1/bands", {
    retry: false,
    skipAuth: opts?.skipAuth,
    skipRefresh: opts?.skipAuth,
  });
}

export async function fetchBand(id: string, opts?: { skipAuth?: boolean }): Promise<BandRecord> {
  return apiFetch<BandRecord>(`/api/v1/bands/${id}`, {
    retry: false,
    skipAuth: opts?.skipAuth,
    skipRefresh: opts?.skipAuth,
  });
}

export async function createBand(body: { name: string; bio?: string }): Promise<BandRecord> {
  return apiFetch<BandRecord>("/api/v1/bands", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    retry: false,
  });
}

export async function updateBand(
  id: string,
  body: Partial<{ name: string; bio: string | null; version: number }>,
): Promise<BandRecord> {
  return apiFetch<BandRecord>(`/api/v1/bands/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    retry: false,
  });
}

export async function transitionBand(id: string, action: string, version?: number): Promise<BandRecord> {
  return apiFetch<BandRecord>(`/api/v1/bands/${id}/lifecycle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, version }),
    retry: false,
  });
}

export async function fetchBandMembers(id: string): Promise<{ items: BandMemberRecord[] }> {
  return apiFetch<{ items: BandMemberRecord[] }>(`/api/v1/bands/${id}/members`, { retry: false });
}

export async function inviteBandMember(id: string, user_id: string, role_label?: string): Promise<BandMemberRecord> {
  return apiFetch<BandMemberRecord>(`/api/v1/bands/${id}/members`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id, role_label }),
    retry: false,
  });
}

export async function transitionBandMember(
  bandId: string,
  memberId: string,
  action: string,
): Promise<BandMemberRecord> {
  return apiFetch<BandMemberRecord>(`/api/v1/bands/${bandId}/members/${memberId}/lifecycle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
    retry: false,
  });
}

export async function fetchEventLineup(eventId: string, opts?: { skipAuth?: boolean }): Promise<{ items: LineupRecord[] }> {
  return apiFetch<{ items: LineupRecord[] }>(`/api/v1/events/${eventId}/lineup`, {
    retry: false,
    skipAuth: opts?.skipAuth,
    skipRefresh: opts?.skipAuth,
  });
}

export async function inviteEventLineup(
  eventId: string,
  body: { artist_id?: string; band_id?: string; billing_order?: number },
): Promise<LineupRecord> {
  return apiFetch<LineupRecord>(`/api/v1/events/${eventId}/lineup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    retry: false,
  });
}

export async function transitionEventLineup(
  eventId: string,
  lineupId: string,
  action: string,
  version?: number,
): Promise<LineupRecord> {
  return apiFetch<LineupRecord>(`/api/v1/events/${eventId}/lineup/${lineupId}/lifecycle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, version }),
    retry: false,
  });
}

export type TrackRecord = {
  id: string;
  title: string;
  isrc?: string | null;
  status: string;
  primary_artist_id?: string | null;
  primary_band_id?: string | null;
  primary_org_id?: string | null;
  metadata?: Record<string, unknown> | null;
  version?: number;
};

export type ReleaseRecord = {
  id: string;
  title: string;
  release_type: string;
  status: string;
  primary_artist_id?: string | null;
  primary_band_id?: string | null;
  primary_org_id?: string | null;
  cover_asset_id?: string | null;
  release_at?: string | null;
  metadata?: Record<string, unknown> | null;
  version?: number;
};

export type ReleaseTrackRecord = {
  release_id: string;
  track_id: string;
  position: number;
};

export type CreditRecord = {
  id: string;
  track_id?: string | null;
  release_id?: string | null;
  artist_id?: string | null;
  user_id?: string | null;
  credit_role: string;
};

export type TrackVersionRecord = {
  id: string;
  track_id: string;
  version_type: string;
  media_asset_id?: string | null;
  duration_ms?: number | null;
  status: string;
  is_current: boolean;
  version: number;
};

export async function fetchTracks(opts?: { skipAuth?: boolean }): Promise<Page<TrackRecord>> {
  return apiFetch<Page<TrackRecord>>("/api/v1/tracks", {
    retry: false,
    skipAuth: opts?.skipAuth,
    skipRefresh: opts?.skipAuth,
  });
}

export async function fetchTrack(id: string, opts?: { skipAuth?: boolean }): Promise<TrackRecord> {
  return apiFetch<TrackRecord>(`/api/v1/tracks/${id}`, {
    retry: false,
    skipAuth: opts?.skipAuth,
    skipRefresh: opts?.skipAuth,
  });
}

export async function createTrack(body: { title: string; isrc?: string }): Promise<TrackRecord> {
  return apiFetch<TrackRecord>("/api/v1/tracks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    retry: false,
  });
}

export async function transitionTrack(id: string, action: string, version?: number): Promise<TrackRecord> {
  return apiFetch<TrackRecord>(`/api/v1/tracks/${id}/transition`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, version }),
    retry: false,
  });
}

export async function createTrackVersion(id: string): Promise<TrackVersionRecord> {
  return apiFetch<TrackVersionRecord>(`/api/v1/tracks/${id}/versions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ version_type: "MASTER" }),
    retry: false,
  });
}

export async function transitionTrackVersion(
  trackId: string,
  versionId: string,
  action: string,
  version?: number,
): Promise<TrackVersionRecord> {
  return apiFetch<TrackVersionRecord>(`/api/v1/tracks/${trackId}/versions/${versionId}/transition`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, version }),
    retry: false,
  });
}

export async function addTrackCredit(id: string, credit_role: string, artist_id?: string): Promise<CreditRecord> {
  return apiFetch<CreditRecord>(`/api/v1/tracks/${id}/credits`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ credit_role, artist_id }),
    retry: false,
  });
}

export async function fetchTrackCredits(id: string, opts?: { skipAuth?: boolean }): Promise<{ items: CreditRecord[] }> {
  return apiFetch<{ items: CreditRecord[] }>(`/api/v1/tracks/${id}/credits`, {
    retry: false,
    skipAuth: opts?.skipAuth,
    skipRefresh: opts?.skipAuth,
  });
}

export async function fetchReleases(opts?: { skipAuth?: boolean }): Promise<Page<ReleaseRecord>> {
  return apiFetch<Page<ReleaseRecord>>("/api/v1/releases", {
    retry: false,
    skipAuth: opts?.skipAuth,
    skipRefresh: opts?.skipAuth,
  });
}

export async function fetchRelease(id: string, opts?: { skipAuth?: boolean }): Promise<ReleaseRecord> {
  return apiFetch<ReleaseRecord>(`/api/v1/releases/${id}`, {
    retry: false,
    skipAuth: opts?.skipAuth,
    skipRefresh: opts?.skipAuth,
  });
}

export async function createRelease(body: { title: string; release_type: string }): Promise<ReleaseRecord> {
  return apiFetch<ReleaseRecord>("/api/v1/releases", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    retry: false,
  });
}

export async function transitionRelease(id: string, action: string, version?: number): Promise<ReleaseRecord> {
  return apiFetch<ReleaseRecord>(`/api/v1/releases/${id}/transition`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, version }),
    retry: false,
  });
}

export async function fetchReleaseTracks(
  id: string,
  opts?: { skipAuth?: boolean },
): Promise<{ items: ReleaseTrackRecord[] }> {
  return apiFetch<{ items: ReleaseTrackRecord[] }>(`/api/v1/releases/${id}/tracks`, {
    retry: false,
    skipAuth: opts?.skipAuth,
    skipRefresh: opts?.skipAuth,
  });
}

export async function addReleaseTrack(id: string, track_id: string, position: number): Promise<ReleaseTrackRecord> {
  return apiFetch<ReleaseTrackRecord>(`/api/v1/releases/${id}/tracks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ track_id, position }),
    retry: false,
  });
}

export type PlayableTrackRecord = {
  id: string;
  title: string;
  status: string;
  primary_artist_id?: string | null;
  primary_band_id?: string | null;
  catalog_playable: boolean;
  audio_deliverable: boolean;
  track_version_id?: string | null;
  duration_ms?: number | null;
  reason?: string | null;
};

export type ListeningSessionRecord = {
  id: string;
  user_id: string;
  status: string;
  version: number;
  catalog_playable?: boolean | null;
  audio_deliverable?: boolean | null;
  availability_reason?: string | null;
  track_id?: string | null;
  track_version_id?: string | null;
};

export type AudioDeliveryRecord = {
  url: string;
  expires_at: string;
  track_id: string;
  track_version_id: string;
  media_asset_id: string;
};

export type LibraryRecord = {
  id: string;
  item_type: string;
  item_id: string;
  kind: string;
};

export type PlaylistRecord = {
  id: string;
  owner_user_id?: string | null;
  kind: string;
  status: string;
  title: string;
  version: number;
};

export type PlaybackEventRecord = {
  id: string;
  track_id: string;
  track_version_id: string;
  duration_ms: number;
  completed: boolean;
  started_at: string;
  eligible_hint?: boolean | null;
};

export type ArtistPlayAggregates = {
  artist_id: string;
  label: string;
  eligibility: string;
  tracks: Array<{
    track_id: string;
    title: string;
    play_count: number;
    unique_listener_count: number;
    total_duration_ms: number;
    completed_count: number;
    skip_count: number;
  }>;
};

export async function fetchPlayableCatalog(): Promise<Page<PlayableTrackRecord>> {
  return apiFetch<Page<PlayableTrackRecord>>("/api/v1/playback/catalog", { retry: false });
}

export async function openListeningSession(track_id: string): Promise<ListeningSessionRecord> {
  return apiFetch<ListeningSessionRecord>("/api/v1/playback/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ track_id, device: "web" }),
    retry: false,
  });
}

export async function closeListeningSession(id: string, version?: number): Promise<ListeningSessionRecord> {
  return apiFetch<ListeningSessionRecord>(`/api/v1/playback/sessions/${id}/close`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ version }),
    retry: false,
  });
}

export async function fetchTrackAudio(trackId: string): Promise<AudioDeliveryRecord> {
  return apiFetch<AudioDeliveryRecord>(`/api/v1/playback/tracks/${trackId}/audio`, { retry: false });
}

export async function ingestPlaybackEvent(body: {
  client_event_id: string;
  track_id: string;
  session_id: string;
  duration_ms: number;
  completed: boolean;
}): Promise<PlaybackEventRecord> {
  return apiFetch<PlaybackEventRecord>("/api/v1/playback/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    retry: false,
  });
}

export async function fetchLibrary(): Promise<Page<LibraryRecord>> {
  return apiFetch<Page<LibraryRecord>>("/api/v1/me/library", { retry: false });
}

export async function addLibraryItem(item_id: string, kind: "LIKE" | "SAVE"): Promise<LibraryRecord> {
  return apiFetch<LibraryRecord>("/api/v1/me/library", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ item_type: "track", item_id, kind }),
    retry: false,
  });
}

export async function fetchPlaylists(): Promise<Page<PlaylistRecord>> {
  return apiFetch<Page<PlaylistRecord>>("/api/v1/playlists", { retry: false });
}

export async function createPlaylist(title: string): Promise<PlaylistRecord> {
  return apiFetch<PlaylistRecord>("/api/v1/playlists", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, kind: "USER" }),
    retry: false,
  });
}

export async function fetchPlaylist(id: string): Promise<PlaylistRecord> {
  return apiFetch<PlaylistRecord>(`/api/v1/playlists/${id}`, { retry: false });
}

export async function addPlaylistItem(id: string, track_id: string, position: number): Promise<{ track_id: string }> {
  return apiFetch<{ track_id: string }>(`/api/v1/playlists/${id}/items`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ track_id, position }),
    retry: false,
  });
}

export async function fetchListeningHistory(): Promise<Page<PlaybackEventRecord>> {
  return apiFetch<Page<PlaybackEventRecord>>("/api/v1/me/listening-history", { retry: false });
}

export async function fetchArtistPlayAggregates(artistId: string): Promise<ArtistPlayAggregates> {
  return apiFetch<ArtistPlayAggregates>(`/api/v1/artists/${artistId}/play-aggregates`, { retry: false });
}

export function resolveMediaUrl(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  return `${getApiBaseUrl()}${path}`;
}

export type OfferRecord = {
  id: string;
  organization_id: string;
  product_id: string;
  product_type: string | null;
  name: string | null;
  amount_minor: number;
  currency_code: string;
  status: string;
  version: number | null;
};

export type ProductRecord = {
  id: string;
  organization_id: string;
  product_type: string;
  subject_id: string;
  name: string;
  status: string;
  version: number;
};

export type PlanRecord = {
  id: string;
  key: string;
  status: string;
  price_amount_minor: number;
  currency_code: string;
  interval: string;
  interval_count: number;
  trial_days: number | null;
  version_number: number | null;
};

export type SubscriptionRecord = {
  id: string;
  plan_id: string;
  plan_version_id: string;
  status: string;
  cancel_at_period_end: boolean;
  period_ends_at: string | null;
};

export type EntitlementRecord = {
  id: string;
  entitlement_type: string;
  ref_id: string;
  scope: string;
  status: string;
  expires_at: string | null;
};

export async function fetchOffers(): Promise<Page<OfferRecord>> {
  return apiFetch<Page<OfferRecord>>("/api/v1/offers", { retry: false, skipAuth: true, skipRefresh: true });
}

export async function fetchSubscriptionPlans(): Promise<Page<PlanRecord>> {
  return apiFetch<Page<PlanRecord>>("/api/v1/subscription-plans", {
    retry: false,
    skipAuth: true,
    skipRefresh: true,
  });
}

export async function createSubscriptionOrder(plan_id: string, idempotencyKey: string): Promise<OrderRecord> {
  return apiFetch<OrderRecord>("/api/v1/subscriptions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({ plan_id }),
    retry: false,
  });
}

export async function fetchMySubscription(): Promise<SubscriptionRecord> {
  return apiFetch<SubscriptionRecord>("/api/v1/me/subscription", { retry: false });
}

export async function fetchMySubscriptions(): Promise<Page<SubscriptionRecord>> {
  return apiFetch<Page<SubscriptionRecord>>("/api/v1/me/subscriptions", { retry: false });
}

export async function cancelSubscription(id: string): Promise<SubscriptionRecord> {
  return apiFetch<SubscriptionRecord>(`/api/v1/subscriptions/${id}/cancel`, {
    method: "POST",
    retry: false,
  });
}

export async function fetchMyEntitlements(): Promise<Page<EntitlementRecord>> {
  return apiFetch<Page<EntitlementRecord>>("/api/v1/me/entitlements", { retry: false });
}

export async function fetchStaffProducts(): Promise<Page<ProductRecord>> {
  return apiFetch<Page<ProductRecord>>("/api/v1/products", { retry: false });
}

export async function fetchStaffPlans(): Promise<Page<PlanRecord>> {
  return apiFetch<Page<PlanRecord>>("/api/v1/staff/subscription-plans", { retry: false });
}

export async function createProduct(body: {
  product_type: string;
  subject_id: string;
  name: string;
}): Promise<ProductRecord> {
  return apiFetch<ProductRecord>("/api/v1/products", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    retry: false,
  });
}

export async function transitionProduct(id: string, action: string, version?: number): Promise<ProductRecord> {
  return apiFetch<ProductRecord>(`/api/v1/products/${id}/lifecycle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, version }),
    retry: false,
  });
}

export async function createOffer(body: {
  product_id: string;
  amount_minor: number;
  currency_code: string;
}): Promise<OfferRecord> {
  return apiFetch<OfferRecord>("/api/v1/offers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    retry: false,
  });
}

export async function transitionOffer(id: string, action: string, version?: number): Promise<OfferRecord> {
  return apiFetch<OfferRecord>(`/api/v1/offers/${id}/lifecycle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, version }),
    retry: false,
  });
}

export async function createPlan(body: {
  key: string;
  price_amount_minor: number;
  currency_code: string;
  interval: string;
  interval_count: number;
  trial_days?: number | null;
}): Promise<PlanRecord> {
  return apiFetch<PlanRecord>("/api/v1/subscription-plans", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    retry: false,
  });
}

export async function transitionPlan(id: string, action: string): Promise<PlanRecord> {
  return apiFetch<PlanRecord>(`/api/v1/subscription-plans/${id}/lifecycle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
    retry: false,
  });
}

export type RoyaltyStatementRecord = {
  id: string;
  payee_type: string;
  payee_id: string;
  period_start: string;
  period_end: string;
  status: string;
  total_amount_minor: number;
  currency_code: string;
  version_number: number;
  lines: Array<{
    id: string;
    payee_type: string;
    track_id: string | null;
    eligible_units: number;
    share_bps_snapshot: number;
    amount_minor: number;
    currency_code: string;
    is_residual: boolean;
  }>;
  adjustments: Array<{ id: string; amount_minor: number; currency_code: string; reason: string }>;
};

export type RoyaltyRuleRecord = {
  id: string;
  key: string;
  version: number;
  status: string;
  definition: Record<string, unknown>;
};

export type RevenuePoolRecord = {
  id: string;
  period_start: string;
  period_end: string;
  source_type: string;
  currency_code: string;
  amount_minor: number;
  status: string;
  rule_id: string;
};

export type RoyaltyRunRecord = {
  id: string;
  revenue_pool_id: string;
  status: string;
  run_kind: string;
  pool_amount_minor_snapshot: number;
  unallocated_minor: number;
};

export async function fetchMyRoyaltyStatements(): Promise<Page<RoyaltyStatementRecord>> {
  return apiFetch<Page<RoyaltyStatementRecord>>("/api/v1/me/royalties/statements", { retry: false });
}

export async function fetchRoyaltyStatement(id: string): Promise<RoyaltyStatementRecord> {
  return apiFetch<RoyaltyStatementRecord>(`/api/v1/statements/${id}`, { retry: false });
}

export async function fetchRoyaltyRules(): Promise<RoyaltyRuleRecord[]> {
  return apiFetch<RoyaltyRuleRecord[]>("/api/v1/royalty-rules", { retry: false });
}

export async function createRoyaltyRule(body: {
  key: string;
  version?: number;
  definition: Record<string, unknown>;
}): Promise<RoyaltyRuleRecord> {
  return apiFetch<RoyaltyRuleRecord>("/api/v1/royalty-rules", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    retry: false,
  });
}

export async function transitionRoyaltyRule(id: string, action: string): Promise<RoyaltyRuleRecord> {
  return apiFetch<RoyaltyRuleRecord>(`/api/v1/royalty-rules/${id}/lifecycle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
    retry: false,
  });
}

export async function fetchRevenuePools(): Promise<RevenuePoolRecord[]> {
  return apiFetch<RevenuePoolRecord[]>("/api/v1/revenue-pools", { retry: false });
}

export async function createRevenuePool(body: {
  period_start: string;
  period_end: string;
  source_type: string;
  currency_code: string;
  rule_id: string;
}): Promise<RevenuePoolRecord> {
  return apiFetch<RevenuePoolRecord>("/api/v1/revenue-pools", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    retry: false,
  });
}

export async function recordRecognizedRevenue(
  body: {
    source_type: string;
    period_start: string;
    period_end: string;
    amount_minor: number;
    currency_code: string;
  },
  idempotencyKey: string,
): Promise<{ id: string; amount_minor: number; currency_code: string }> {
  return apiFetch("/api/v1/recognized-revenue", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(body),
    retry: false,
  });
}

export async function freezeRevenuePool(id: string): Promise<RevenuePoolRecord> {
  return apiFetch<RevenuePoolRecord>(`/api/v1/revenue-pools/${id}/freeze`, {
    method: "POST",
    retry: false,
  });
}

export async function createRoyaltyRun(revenue_pool_id: string): Promise<RoyaltyRunRecord> {
  return apiFetch<RoyaltyRunRecord>("/api/v1/royalty-runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ revenue_pool_id }),
    retry: false,
  });
}

export async function transitionRoyaltyRun(id: string, action: string): Promise<RoyaltyRunRecord> {
  return apiFetch<RoyaltyRunRecord>(`/api/v1/royalty-runs/${id}/lifecycle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
    retry: false,
  });
}

export async function putTrackRights(
  trackId: string,
  body: {
    territory: string;
    residual_payee_type?: string | null;
    residual_payee_id?: string | null;
    shares: Array<{
      right_type: string;
      payee_type: string;
      payee_id: string;
      share_bps: number;
      effective_from: string;
      effective_to?: string | null;
    }>;
  },
): Promise<unknown> {
  return apiFetch(`/api/v1/tracks/${trackId}/rights`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    retry: false,
  });
}

export async function transitionRights(id: string, action: string): Promise<unknown> {
  return apiFetch(`/api/v1/rights/${id}/lifecycle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
    retry: false,
  });
}

export type JournalRecord = {
  id: string;
  type: string;
  status: string;
  currency_code: string;
  occurred_at: string;
};

export type PayoutRecord = {
  id: string;
  settlement_id: string | null;
  status: string;
  amount_minor: number;
  currency_code: string;
  provider: string;
};

export type ReconciliationRecord = {
  id: string;
  status: string;
  expected_amount_minor: number;
  actual_amount_minor: number | null;
  currency_code: string;
  notes: string | null;
};

export async function fetchLedger(): Promise<Page<JournalRecord>> {
  return apiFetch<Page<JournalRecord>>("/api/v1/ledger", { retry: false });
}

export async function fetchPayouts(): Promise<PayoutRecord[]> {
  return apiFetch<PayoutRecord[]>("/api/v1/payouts", { retry: false });
}

export async function fetchReconciliations(): Promise<ReconciliationRecord[]> {
  return apiFetch<ReconciliationRecord[]>("/api/v1/reconciliations", { retry: false });
}

export async function upsertFinanceConfig(body: {
  key: string;
  int_value?: number | null;
  text_value?: string | null;
}): Promise<unknown> {
  return apiFetch("/api/v1/finance-config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    retry: false,
  });
}