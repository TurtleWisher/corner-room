/*
 * Browser crash reports (owner, 2026-10-30, D-ERR-01). Errors a visitor hits are sent to our own
 * API (POST /api/v1/client-errors), which forwards them to Sentry when error tracking is on; the
 * site's security policy needs no outside address. Only the message, stack and page path are
 * sent: no cookies, no form contents, no query strings. At most a few per page load, no repeats.
 */

import { getApiBaseUrl } from "@/lib/api/client";

export type ErrorKind = "error" | "unhandledrejection" | "boundary";
export type ErrorReport = { kind: ErrorKind; message: string; stack: string | null; page: string };

/** Reports per page load; a crash loop must not flood anything. */
export const MAX_REPORTS = 5;

const sent = new Set<string>();
let count = 0;

/** Noise that isn't Corner Room's code: extensions, cross-origin scripts, a harmless browser warning. */
export function isNoise(message: string, stack: string | null): boolean {
  if (!message || message === "Script error." || message === "Script error") return true;
  if (/ResizeObserver loop/i.test(message)) return true;
  return /(chrome|moz|safari|ms-browser)-extension:\/\//.test(stack ?? "");
}

/** The report for an error, or null when it should not be sent. */
export function buildReport(kind: ErrorKind, error: unknown, pathname: string): ErrorReport | null {
  const err = error instanceof Error ? error : null;
  const message = (err?.message || (typeof error === "string" ? error : "") || "Unknown error").slice(0, 1000);
  const stack = err?.stack ? err.stack.slice(0, 8000) : null;
  if (isNoise(message, stack)) return null;
  return { kind, message, stack, page: pathname.split("?")[0].slice(0, 500) };
}

/** Send once per distinct error, up to MAX_REPORTS per page load. Never throws. */
export function reportError(kind: ErrorKind, error: unknown): void {
  try {
    if (typeof window === "undefined") return;
    const report = buildReport(kind, error, window.location.pathname);
    if (!report) return;
    const key = `${report.kind}:${report.message}`;
    if (sent.has(key) || count >= MAX_REPORTS) return;
    sent.add(key);
    count += 1;
    void fetch(`${getApiBaseUrl()}/api/v1/client-errors`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(report),
      credentials: "omit",
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Reporting must never cause an error of its own.
  }
}

/** Test hook. */
export function resetErrorReportsForTest(): void {
  sent.clear();
  count = 0;
}
