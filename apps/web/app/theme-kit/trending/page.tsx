import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { TrendingBoard } from "./board";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Trending Corner · Corner Room", robots: { index: false, follow: false } };

/* Trending Corner as one card with the front disc's listens in millions behind the ring
 * (D-TRENDING-01, D-TRENDING-02). Developer reference only (hidden in production unless
 * CR_THEME_KIT=1). Every title and count is SAMPLE CONTENT. */
export default function TrendingKitPage() {
  if (process.env.NODE_ENV === "production" && process.env.CR_THEME_KIT !== "1") notFound();
  return <TrendingBoard />;
}
