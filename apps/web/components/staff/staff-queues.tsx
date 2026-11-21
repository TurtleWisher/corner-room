"use client";

/*
 * What is waiting for staff, counted once and shared by the whole console (owner, 2026-11-21:
 * "work on the staff console more efficiently with minimum clicks"). The home page, the side menu's
 * badges, the Catalog jump bar and the Ctrl+K finder all read this one store, so every place agrees
 * and the queues are asked once, not per page. Counts come from the same review queues the pages
 * show; a queue this person may not read has no number (null), never 0. The store asks again on a
 * page change, right after any save or approval, when the window comes back into view, and every
 * minute while it is visible.
 */

import { usePathname } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";

import { useAuth } from "@/components/auth-provider";
import { useWorkspace } from "@/components/workspace-provider";
import { fetchMailReviewQueue } from "@/features/artist-mail/api";
import { fetchOfferProposals, fetchStaffRefunds, fetchStaffSubmissions } from "@/features/commerce/api";
import { fetchGiftReviewQueue } from "@/features/gifts/api";
import { fetchMusicGiftReviewQueue } from "@/features/music-gifts/api";
import { fetchProfileReviewQueue } from "@/features/profiles/api";
import { fetchChangesQueue, fetchCoverQueue, fetchIntakeQueue, fetchLyricsQueue, fetchPresaleQueue } from "@/features/studio/api";
import { fetchTeaserQueue } from "@/features/teasers/api";
import { API_WRITE_EVENT } from "@/lib/api/client";
import { sortQueues, type QueueCount } from "@/lib/staff-console-view";

/** Ask again at most this often while the console stays open and visible. */
const REFRESH_MS = 60_000;
/** A page change within this long of the last count doesn't ask again. */
const FRESH_MS = 8_000;
/** After a save or approval, wait this long for any follow-up changes, then count once. */
const AFTER_WRITE_MS = 600;

export const STAFF_QUEUES: { key: string; label: string; short: string; href: string; load: () => Promise<unknown[]> }[] = [
  { key: "releases", label: "Releases to review", short: "Releases", href: "/staff/catalog#q-releases", load: () => fetchIntakeQueue(true) },
  { key: "presales", label: "Pre-sales to review", short: "Pre-sales", href: "/staff/catalog#q-presales", load: fetchPresaleQueue },
  { key: "previews", label: "Previews to review", short: "Previews", href: "/staff/catalog#q-previews", load: fetchTeaserQueue },
  { key: "changes", label: "Changes to released music", short: "Changes", href: "/staff/catalog#q-changes", load: fetchChangesQueue },
  { key: "covers", label: "Covers to review", short: "Covers", href: "/staff/catalog#q-covers", load: fetchCoverQueue },
  { key: "lyrics", label: "Lyrics to review", short: "Lyrics", href: "/staff/catalog#q-lyrics", load: fetchLyricsQueue },
  { key: "mail", label: "Artist emails to review", short: "Emails", href: "/staff/catalog#q-mail", load: fetchMailReviewQueue },
  { key: "gifts", label: "Collectibles to review", short: "Collectibles", href: "/staff/catalog#q-gifts", load: fetchGiftReviewQueue },
  { key: "music-gifts", label: "Music gifts to review", short: "Music gifts", href: "/staff/catalog#q-music-gifts", load: fetchMusicGiftReviewQueue },
  { key: "profiles", label: "Profile changes to review", short: "Profiles", href: "/staff/catalog/artists", load: fetchProfileReviewQueue },
  { key: "prices", label: "Prices to agree", short: "Prices", href: "/staff/commerce", load: () => fetchOfferProposals("PROPOSED") },
  { key: "payments", label: "Payments to check", short: "Payments", href: "/staff/commerce", load: () => fetchStaffSubmissions("SUBMITTED") },
  { key: "refunds", label: "Refunds open", short: "Refunds", href: "/staff/commerce", load: fetchStaffRefunds },
];

export type StaffQueueCount = QueueCount & { short: string };
type Snapshot = { status: "loading" | "ok"; queues: StaffQueueCount[]; at: number; workspace: string | null };

let snapshot: Snapshot = { status: "loading", queues: [], at: 0, workspace: null };
const listeners = new Set<() => void>();
let inFlight: Promise<void> | null = null;

function publish(next: Snapshot) {
  snapshot = next;
  listeners.forEach((l) => l());
}

/** Count every queue again. Each is asked on its own: one that fails shows no number. */
export function refreshStaffQueues(workspace: string | null = snapshot.workspace): Promise<void> {
  if (inFlight && workspace === snapshot.workspace) return inFlight;
  if (workspace !== snapshot.workspace) publish({ status: "loading", queues: [], at: 0, workspace });
  inFlight = Promise.all(
    STAFF_QUEUES.map(async ({ load, ...q }) => {
      try {
        const rows = await load();
        return { ...q, count: Array.isArray(rows) ? rows.length : null };
      } catch {
        return { ...q, count: null };
      }
    }),
  )
    .then((counts) => {
      if (workspace === snapshot.workspace) publish({ status: "ok", queues: sortQueues(counts) as StaffQueueCount[], at: Date.now(), workspace });
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

const read = () => snapshot;

/** The shared counts. Keeps them fresh while mounted (the staff shell mounts it once). */
export function useStaffQueues(): Snapshot & { reload: () => void } {
  const state = useSyncExternalStore(subscribe, read, read);
  return { ...state, reload: () => void refreshStaffQueues() };
}

/** Mounted once by the staff shell: counts on sign-in, workspace change, page change and focus. */
export function StaffQueuesKeeper() {
  const { status } = useAuth();
  const { currentOrg } = useWorkspace();
  const pathname = usePathname();
  const workspace = currentOrg?.id ?? null;
  const on = status === "authenticated";

  useEffect(() => {
    if (!on) return;
    if (workspace !== snapshot.workspace || Date.now() - snapshot.at > FRESH_MS) void refreshStaffQueues(workspace);
  }, [on, workspace, pathname]);

  useEffect(() => {
    if (!on) return;
    const again = () => {
      if (document.visibilityState === "visible") void refreshStaffQueues(workspace);
    };
    const timer = window.setInterval(again, REFRESH_MS);
    let settle: number | undefined;
    const afterWrite = () => {
      window.clearTimeout(settle);
      settle = window.setTimeout(() => void refreshStaffQueues(workspace), AFTER_WRITE_MS);
    };
    document.addEventListener("visibilitychange", again);
    window.addEventListener(API_WRITE_EVENT, afterWrite);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(settle);
      document.removeEventListener("visibilitychange", again);
      window.removeEventListener(API_WRITE_EVENT, afterWrite);
    };
  }, [on, workspace]);

  return null;
}
