import { describe, expect, it, vi, afterEach } from "vitest";

import { ApiError, apiFetch, clearAccessToken, fetchHealth, getAccessToken, login, logout, setAccessToken } from "./api";

afterEach(() => {
  clearAccessToken();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("apiFetch", () => {
  it("returns JSON on success and sends correlation headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "Content-Type": "application/json", "X-Correlation-ID": "server-id" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const body = await apiFetch<{ status: string }>("/health");
    expect(body.status).toBe("ok");
    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers["X-Correlation-ID"]).toBeTruthy();
    expect(headers["X-Request-ID"]).toBeTruthy();
  });

  it("maps problem+json failures to ApiError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            title: "Validation Error",
            detail: "Request failed validation",
            status: 422,
            code: "VALIDATION_ERROR",
            correlation_id: "corr-1",
          }),
          { status: 422, headers: { "Content-Type": "application/problem+json" } },
        ),
      ),
    );

    await expect(apiFetch("/api/v1/auth/login", { method: "POST", retry: false })).rejects.toMatchObject({
      name: "ApiError",
      status: 422,
      code: "VALIDATION_ERROR",
      correlationId: "corr-1",
    });
  });

  it("surfaces a network failure without leaking internals", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    await expect(fetchHealth()).rejects.toBeInstanceOf(ApiError);
    await expect(fetchHealth()).rejects.toMatchObject({
      code: "NETWORK_ERROR",
      message: "The API is not reachable.",
    });
  });

  it("keeps the access token in memory after login and never uses localStorage", async () => {
    const storage: Record<string, string> = {};
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage[key] ?? null,
      setItem: (key: string, value: string) => {
        storage[key] = value;
      },
      removeItem: (key: string) => {
        delete storage[key];
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            access_token: "access-1",
            expires_in: 900,
            expires_at: "2026-09-07T00:00:00Z",
            user: { id: "u1", email: "a@example.com", display_name: "A", status: "ACTIVE" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
    const result = await login("a@example.com", "password12");
    expect(result.access_token).toBe("access-1");
    expect(getAccessToken()).toBe("access-1");
    expect(storage).toEqual({});
  });

  it("maps login failure to ApiError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            title: "Unauthenticated",
            detail: "Invalid email or password",
            status: 401,
            code: "UNAUTHENTICATED",
          }),
          { status: 401, headers: { "Content-Type": "application/problem+json" } },
        ),
      ),
    );
    await expect(login("a@example.com", "nope")).rejects.toMatchObject({
      name: "ApiError",
      status: 401,
      code: "UNAUTHENTICATED",
    });
    expect(getAccessToken()).toBeNull();
  });

  it("refreshes on 401 then retries the original request", async () => {
    setAccessToken("expired");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: "UNAUTHENTICATED", status: 401 }), { status: 401 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "access-2", user: { id: "u1" } }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "u1", status: "ACTIVE" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const me = await apiFetch<{ id: string }>("/api/v1/me", { retry: false });
    expect(me.id).toBe("u1");
    expect(getAccessToken()).toBe("access-2");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("treats a failed refresh as an expired/unauthorized session", async () => {
    setAccessToken("expired");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ status: 401 }), { status: 401 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ status: 401, code: "UNAUTHENTICATED" }), { status: 401 })),
    );
    await expect(apiFetch("/api/v1/me", { retry: false })).rejects.toMatchObject({ status: 401 });
    expect(getAccessToken()).toBeNull();
  });

  it("clears the in-memory token on logout", async () => {
    setAccessToken("access-1");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    await logout();
    expect(getAccessToken()).toBeNull();
  });
});
