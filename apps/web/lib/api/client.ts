/* Shared HTTP client: apiFetch, ApiError, in-memory access token, single-flight refresh. Split from lib/api.ts (Phase 16, Stage 5). */

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

/**
 * Run the refresh exclusively across this browser's tabs (Web Locks API), so two tabs never send
 * the same refresh cookie at once: the API treats a reused refresh token as a replay and revokes
 * the whole session family. A tab that waited simply refreshes with the newer cookie afterwards.
 */
async function withRefreshLock<T>(run: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== "undefined" ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
  if (!locks?.request) return run();
  return locks.request("cornerroom-refresh", run) as Promise<T>;
}

/** Internal to the API layer (used by restoreSession). Not re-exported from "@/lib/api". */
export async function refreshAccessToken(): Promise<string | null> {
  if (refreshInFlight) {
    return refreshInFlight;
  }
  refreshInFlight = withRefreshLock(async () => {
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
  });
  return refreshInFlight;
}

export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const { timeoutMs = 8000, retry, headers, skipAuth, skipRefresh, ...init } = options;
  const method = (init.method ?? "GET").toUpperCase();
  const correlationId = newCorrelationId();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // A request that starts while a refresh is running waits for its token instead of going out
  // without one (which would 401 and start a second rotation that invalidates the first token).
  if (!skipAuth && !accessToken && refreshInFlight && !isAuthPath(path)) {
    await refreshInFlight;
  }
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
      // If another call already refreshed since this one was sent, retry with that token rather
      // than rotating the session again (each rotation revokes the previous access token).
      const current = accessToken;
      const refreshed = current && current !== token ? current : await refreshAccessToken();
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
