// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MAX_REPORTS, buildReport, isNoise, reportError, resetErrorReportsForTest } from "./error-report";

const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));

beforeEach(() => {
  resetErrorReportsForTest();
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("error reports (D-ERR-01)", () => {
  it("sends the message, stack and page path only, without cookies", () => {
    window.history.pushState({}, "", "/releases/r1?token=secret");
    reportError("error", new Error("x is undefined"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/api\/v1\/client-errors$/);
    expect(init.credentials).toBe("omit");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ kind: "error", message: "x is undefined", page: "/releases/r1" });
    expect(String(init.body)).not.toContain("secret");
  });

  it("does not repeat an error and stops after a few per page", () => {
    reportError("error", new Error("same"));
    reportError("error", new Error("same"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 10; i += 1) reportError("error", new Error(`e${i}`));
    expect(fetchMock).toHaveBeenCalledTimes(MAX_REPORTS);
  });

  it("ignores noise that isn't Corner Room's code", () => {
    expect(isNoise("Script error.", null)).toBe(true);
    expect(isNoise("ResizeObserver loop completed with undelivered notifications.", null)).toBe(true);
    expect(isNoise("boom", "at x (chrome-extension://abc/content.js:1:1)")).toBe(true);
    expect(isNoise("boom", "at x (https://www.cornerroom.live/_next/static/chunks/1.js:1:1)")).toBe(false);
    expect(buildReport("unhandledrejection", "Network down", "/listen")).toEqual({ kind: "unhandledrejection", message: "Network down", stack: null, page: "/listen" });
  });

  it("never throws, even when sending fails", () => {
    fetchMock.mockImplementationOnce(() => Promise.reject(new Error("offline")));
    expect(() => reportError("boundary", new Error("crash"))).not.toThrow();
  });
});
