"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import { inAppPath, wantsRoomTransition } from "@/lib/room-transition-view";

/** Longest the old page is held while the next one loads; after this the page simply changes. */
const MAX_WAIT_MS = 1500;

/**
 * The way into and out of the listening room (owner, 2026-10-31): a short, quiet cross-fade, and the
 * player bar's cover grows into the room's front card (styles in app/globals.css). Uses the
 * browser's View Transitions; without them, or with reduced motion, pages change as before. Only
 * plain clicks on in-app links into or out of the room are taken over; everything else is untouched.
 */
export function RoomTransition() {
  const router = useRouter();
  const pathname = usePathname();
  const current = useRef(pathname);
  const arrived = useRef<(() => void) | null>(null);

  useEffect(() => {
    current.current = pathname;
    arrived.current?.();
    arrived.current = null;
  }, [pathname]);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (typeof document.startViewTransition !== "function") return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const link = (event.target as Element | null)?.closest?.("a[href]");
      if (!(link instanceof HTMLAnchorElement)) return;
      const to = inAppPath(
        {
          button: event.button,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
          shiftKey: event.shiftKey,
          altKey: event.altKey,
          defaultPrevented: event.defaultPrevented,
          target: link.getAttribute("target"),
          download: link.hasAttribute("download"),
          href: link.getAttribute("href"),
        },
        window.location.origin,
      );
      const toPath = to?.split(/[?#]/)[0];
      if (!to || !wantsRoomTransition(current.current, toPath)) return;
      event.preventDefault();
      const transition = document.startViewTransition(
        () =>
          new Promise<void>((resolve) => {
            // The limit stays on until the new page paints: a background tab never paints.
            const timer = window.setTimeout(resolve, MAX_WAIT_MS);
            arrived.current = () =>
              requestAnimationFrame(() => {
                window.clearTimeout(timer);
                resolve();
              });
            router.push(to);
          }),
      );
      // A skipped or cut-short animation is fine: the page has still changed.
      transition.ready.catch(() => {});
      transition.finished.catch(() => {});
    }
    // Capture phase: runs before the link's own handler, which then sees the click as handled.
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [router]);

  return null;
}
