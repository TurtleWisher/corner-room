import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { IntroVideoPlayer } from "@/components/promo/intro-video/intro-video";

import "@/components/promo/intro-video/intro-video.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Intro film · Corner Room", robots: { index: false, follow: false } };

/*
 * The 40 s platform intro film (components/promo/intro-video). Developer page: hidden in
 * production unless CR_THEME_KIT=1, like the rest of /theme-kit.
 *   /theme-kit/intro-video            live preview with play and scrub
 *   /theme-kit/intro-video?t=21.5     open paused on a frame
 *   /theme-kit/intro-video?render=1   bare 1920 x 1080 stage for scripts/render-intro-video.mjs
 */
export default async function IntroVideoPage({ searchParams }: { searchParams: Promise<{ render?: string; t?: string }> }) {
  if (process.env.NODE_ENV === "production" && process.env.CR_THEME_KIT !== "1") notFound();
  const sp = await searchParams;
  const render = sp.render === "1";
  const start = Number.isFinite(Number(sp.t)) ? Number(sp.t) : 0;

  return (
    <div data-theme="ember" className="cr-scope min-h-dvh" style={render ? { margin: 0, width: 1920, height: 1080, overflow: "hidden" } : undefined}>
      <IntroVideoPlayer render={render} start={start} />
    </div>
  );
}
