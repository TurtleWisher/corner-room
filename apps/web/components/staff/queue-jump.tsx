"use client";

/*
 * One click to the work (owner, 2026-11-21). A page that stacks several review queues (Catalog)
 * gets a sticky bar of the queues with something waiting, each with its count; pressing one glides
 * to that queue and lights it briefly. Arriving with "#q-<queue>" (from the home page, the side
 * menu or Ctrl+K) does the same once the queue has loaded. Queues with nothing waiting draw nothing.
 */

import { usePathname } from "next/navigation";
import { useEffect } from "react";

import { useStaffQueues } from "@/components/staff/staff-queues";
import { queuesOn } from "@/lib/staff-console-view";

/** The event the finder sends when the queue is on the page already open. */
export const JUMP_EVENT = "st-jump";
/** How long to wait for a queue that is still loading before giving up on the jump. */
const ARRIVE_WAIT_MS = 4000;

function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/** Glide to the queue with this id and light it; false when it isn't on the page (yet). */
export function jumpTo(id: string): boolean {
  const el = document.getElementById(id);
  if (!el || el.childElementCount === 0) return false;
  el.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
  el.removeAttribute("data-flash");
  // Restart the light even when the same queue is pressed twice.
  void el.offsetWidth;
  el.setAttribute("data-flash", "true");
  window.setTimeout(() => el.removeAttribute("data-flash"), 1600);
  history.replaceState(null, "", `#${id}`);
  return true;
}

export function QueueJumpBar() {
  const pathname = usePathname() ?? "";
  const { queues } = useStaffQueues();
  const here = queuesOn(pathname, queues);

  useEffect(() => {
    let observer: MutationObserver | null = null;
    let stop: number | undefined;
    const arrive = (id: string) => {
      observer?.disconnect();
      if (jumpTo(id)) return;
      // The queue is still loading: jump as soon as it draws something.
      observer = new MutationObserver(() => {
        if (jumpTo(id)) observer?.disconnect();
      });
      observer.observe(document.body, { childList: true, subtree: true });
      window.clearTimeout(stop);
      stop = window.setTimeout(() => observer?.disconnect(), ARRIVE_WAIT_MS);
    };
    const fromHash = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (id.startsWith("q-")) arrive(id);
    };
    const fromFinder = (e: Event) => arrive((e as CustomEvent<string>).detail);
    fromHash();
    window.addEventListener("hashchange", fromHash);
    window.addEventListener(JUMP_EVENT, fromFinder);
    return () => {
      observer?.disconnect();
      window.clearTimeout(stop);
      window.removeEventListener("hashchange", fromHash);
      window.removeEventListener(JUMP_EVENT, fromFinder);
    };
  }, []);

  if (here.length === 0) return null;
  return (
    <nav aria-label="Waiting on this page" className="st-jumpbar">
      <span className="st-eyebrow">Waiting</span>
      <ul className="flex flex-wrap gap-1.5">
        {here.map((q) => {
          const id = q.href.split("#")[1];
          return (
            <li key={q.key}>
              <a
                href={`#${id}`}
                className="st-chip cr-focus"
                onClick={(e) => {
                  if (jumpTo(id)) e.preventDefault();
                }}
              >
                {"short" in q ? String(q.short) : q.label}
                <span className="st-chip-n">{q.count}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
