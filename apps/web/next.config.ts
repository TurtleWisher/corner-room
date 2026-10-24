import type { NextConfig } from "next";

/*
 * Content-Security-Policy for every page (Phase 15 Gate 5; security stage 1, 2026-10-24). The site
 * loads nothing from other hosts, so scripts, styles, fonts and frames come only from itself.
 * Next.js puts small inline scripts in every page, hence 'unsafe-inline' for scripts; injected
 * scripts from anywhere else, plugins, other sites framing the page and form posts elsewhere stay
 * blocked. The API is the same address in production (nginx), or NEXT_PUBLIC_API_URL locally;
 * covers, audio and API calls may come from there. Development adds 'unsafe-eval' for hot reload.
 */
function contentSecurityPolicy(): string {
  // Same rule as getApiBaseUrl (lib/api/client.ts): unset means the local API on :8000; empty
  // means the site's own address (production behind nginx).
  const api = (() => {
    const base = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
    try {
      return base ? new URL(base).origin : "";
    } catch {
      return "";
    }
  })();
  const dev = process.env.NODE_ENV !== "production";
  const self = ["'self'", api].filter(Boolean).join(" ");
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src ${self} data: blob:`,
    `media-src ${self} blob:`,
    `connect-src ${self}${dev ? " ws: wss:" : ""}`,
    "font-src 'self' data:",
    "worker-src 'self' blob:",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    `form-action ${self}`,
  ].join("; ");
}

const nextConfig: NextConfig = {
  output: "standalone",
  // Don't announce the framework in every response (security audit 2026-10-23).
  poweredByHeader: false,
  // A second build (the private staging copy, scripts/staging.ps1) can live beside the normal one.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  async headers() {
    return [{ source: "/:path*", headers: [{ key: "Content-Security-Policy", value: contentSecurityPolicy() }] }];
  },
  // Stage 6 addresses (owner decision D-EV-01, URL-01 and URL-02): the public events live at
  // /events, staff management under /staff. Old addresses keep working.
  async redirects() {
    return [
      { source: "/discover", destination: "/events", permanent: true },
      { source: "/discover/:id", destination: "/events/:id", permanent: true },
      { source: "/events/:id/attendance", destination: "/staff/events/:id/attendance", permanent: true },
      { source: "/venues", destination: "/staff/venues", permanent: true },
      { source: "/venues/:id", destination: "/staff/venues/:id", permanent: true },
    ];
  },
};

export default nextConfig;
