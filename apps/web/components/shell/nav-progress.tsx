"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef } from "react";

import { NAV_GIVE_UP_MS, opensAnotherPage, skipsEntrance, trickle } from "@/lib/nav-progress-view";
import { inAppPath } from "@/lib/room-transition-view";

/*
 * Moving between pages (owner, 2026-11-15). Two quiet things, both only watching, never taking a
 * click over:
 *  1. a thin line of light across the top of the window from the moment a link is pressed until the
 *     next page is on screen, so a press always answers at once, even on a slow connection;
 *  2. the arriving page fades in once (opacity only, so fixed layers and 3D spaces are untouched).
 * One animation frame loop writes a transform while a page is loading; React never re-renders.
 * Reduced motion: the line shows and hides without growing, and pages arrive without the fade.
 */
function Watcher() {
  const pathname = usePathname();
  const search = useSearchParams()?.toString() ?? "";
  const line = useRef<HTMLDivElement>(null);
  const run = useRef<{ frame: number; started: number; giveUp: number } | null>(null);
  const here = useRef("");
  const first = useRef(true);

  const finish = () => {
    const el = line.current;
    const r = run.current;
    if (!el || !r) return;
    cancelAnimationFrame(r.frame);
    window.clearTimeout(r.giveUp);
    run.current = null;
    el.style.transform = "scaleX(1)";
    el.dataset.state = "done";
  };

  useEffect(() => {
    here.current = `${pathname ?? ""}${search ? `?${search}` : ""}`;
    finish();
    if (first.current) {
      first.current = false;
      return;
    }
    // The arriving page fades in once.
    const main = document.getElementById("main");
    if (!main || skipsEntrance(pathname)) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    main.removeAttribute("data-arrive");
    void main.offsetWidth; // restart the animation for this page
    main.setAttribute("data-arrive", "");
    const done = window.setTimeout(() => main.removeAttribute("data-arrive"), 500);
    return () => window.clearTimeout(done);
  }, [pathname, search]);

  useEffect(() => {
    const start = () => {
      const el = line.current;
      if (!el || run.current) return;
      const still = Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
      el.dataset.state = "loading";
      el.style.transform = still ? "scaleX(0.6)" : "scaleX(0)";
      const started = performance.now();
      const step = (now: number) => {
        if (!run.current) return;
        if (!still) el.style.transform = `scaleX(${trickle(now - started).toFixed(4)})`;
        run.current.frame = requestAnimationFrame(step);
      };
      run.current = { frame: requestAnimationFrame(step), started, giveUp: window.setTimeout(finish, NAV_GIVE_UP_MS) };
    };
    const onClick = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest?.("a[href]");
      if (!(link instanceof HTMLAnchorElement)) return;
      const to = inAppPath(
        {
          button: event.button,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
          shiftKey: event.shiftKey,
          altKey: event.altKey,
          // Only watching: the link's own handler (and Next's) still decides what happens.
          defaultPrevented: false,
          target: link.getAttribute("target"),
          download: link.hasAttribute("download"),
          href: link.getAttribute("href"),
        },
        window.location.origin,
      );
      if (opensAnotherPage(here.current, to)) start();
    };
    document.addEventListener("click", onClick, true);
    window.addEventListener("popstate", start);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", start);
    };
  }, []);

  return <div ref={line} aria-hidden="true" className="cr-navline" data-state="idle" />;
}

export function NavProgress() {
  // useSearchParams needs a Suspense boundary on statically rendered pages.
  return (
    <Suspense fallback={null}>
      <Watcher />
    </Suspense>
  );
}
