import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ReleasePlanBoard } from "./board";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Release plan · Corner Room", robots: { index: false, follow: false } };

/* The release plan in both portals (D-RELEASE-PLAN-01). Developer reference only (hidden in
 * production unless CR_THEME_KIT=1). Every value is SAMPLE CONTENT. */
export default function ReleasePlanKitPage() {
  if (process.env.NODE_ENV === "production" && process.env.CR_THEME_KIT !== "1") notFound();
  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <ReleasePlanBoard />
    </main>
  );
}
