import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // A second build (the private staging copy, scripts/staging.ps1) can live beside the normal one.
  distDir: process.env.NEXT_DIST_DIR || ".next",
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
