"use client";

/*
 * Staff console home (/staff). Staff sign-in, the staff join welcome and the "staff only" notice
 * all open here. Since 2026-11-15 it is a working start page: what is waiting for staff right now
 * (counts read from the same review queues the pages show; a queue this person may not read simply
 * shows no number), then every section of the console. Visibility is UX only: every page and the
 * API still check permissions.
 */

import Link from "next/link";
import { ArrowRight, CircleCheck, RefreshCw } from "lucide-react";

import { useAuth } from "@/components/auth-provider";
import { SpotlightRegion } from "@/components/ds/spotlight";
import { NavIcon } from "@/components/shell/nav-icons";
import { Protected } from "@/components/staff/kit";
import { useAsync } from "@/components/use-async";
import { useWorkspace } from "@/components/workspace-provider";
import { fetchMailReviewQueue } from "@/features/artist-mail/api";
import { fetchOfferProposals, fetchStaffRefunds, fetchStaffSubmissions } from "@/features/commerce/api";
import { fetchGiftReviewQueue } from "@/features/gifts/api";
import { fetchMusicGiftReviewQueue } from "@/features/music-gifts/api";
import { fetchProfileReviewQueue } from "@/features/profiles/api";
import { fetchChangesQueue, fetchCoverQueue, fetchIntakeQueue, fetchLyricsQueue, fetchPresaleQueue } from "@/features/studio/api";
import { fetchTeaserQueue } from "@/features/teasers/api";
import { staffNavSections } from "@/lib/nav-view";
import { sortQueues, waitingTotal, type QueueCount } from "@/lib/staff-console-view";

const QUEUES: { key: string; label: string; href: string; load: () => Promise<unknown[]> }[] = [
  { key: "releases", label: "Releases to review", href: "/staff/catalog", load: () => fetchIntakeQueue(true) },
  { key: "presales", label: "Pre-sales to review", href: "/staff/catalog", load: fetchPresaleQueue },
  { key: "previews", label: "Previews to review", href: "/staff/catalog", load: fetchTeaserQueue },
  { key: "changes", label: "Changes to released music", href: "/staff/catalog", load: fetchChangesQueue },
  { key: "covers", label: "Covers to review", href: "/staff/catalog", load: fetchCoverQueue },
  { key: "lyrics", label: "Lyrics to review", href: "/staff/catalog", load: fetchLyricsQueue },
  { key: "mail", label: "Artist emails to review", href: "/staff/catalog", load: fetchMailReviewQueue },
  { key: "gifts", label: "Gift campaigns to review", href: "/staff/catalog", load: fetchGiftReviewQueue },
  { key: "music-gifts", label: "Music gifts to review", href: "/staff/catalog", load: fetchMusicGiftReviewQueue },
  { key: "profiles", label: "Profile changes to review", href: "/staff/catalog/artists", load: fetchProfileReviewQueue },
  { key: "prices", label: "Prices to agree", href: "/staff/commerce", load: () => fetchOfferProposals("PROPOSED") },
  { key: "payments", label: "Payments to check", href: "/staff/commerce", load: () => fetchStaffSubmissions("SUBMITTED") },
  { key: "refunds", label: "Refunds open", href: "/staff/commerce", load: fetchStaffRefunds },
];

/** Each queue is asked on its own: one that fails (no permission, no workspace) shows no number. */
async function loadQueues(): Promise<QueueCount[]> {
  const counts = await Promise.all(
    QUEUES.map(async ({ load, ...q }) => {
      try {
        const rows = await load();
        return { ...q, count: Array.isArray(rows) ? rows.length : null };
      } catch {
        return { ...q, count: null };
      }
    }),
  );
  return sortQueues(counts);
}

function Waiting({ workspaceId }: { workspaceId: string | null }) {
  const state = useAsync(loadQueues, [workspaceId]);
  const queues = state.status === "ok" ? state.data : [];
  const known = queues.filter((q) => q.count !== null);
  const total = waitingTotal(queues);
  return (
    <section aria-labelledby="st-waiting" className="st-panel">
      <div className="st-panel-head">
        <div>
          <h2 id="st-waiting" className="st-h2">
            Waiting for you
          </h2>
          <p className="st-sub">
            {state.status === "loading"
              ? "Counting what is in each review queue."
              : known.length === 0
                ? "No queue could be read. Choose a workspace from “Acting in”, or ask an administrator for the review rights."
                : total === 0
                  ? "Nothing is waiting in the queues you can read."
                  : `${total} ${total === 1 ? "thing is" : "things are"} waiting across ${known.filter((q) => (q.count ?? 0) > 0).length} ${known.filter((q) => (q.count ?? 0) > 0).length === 1 ? "queue" : "queues"}.`}
          </p>
        </div>
        <button type="button" onClick={state.reload} className="st-ghost cr-focus" disabled={state.status === "loading"}>
          <RefreshCw aria-hidden="true" className="size-3.5" /> Refresh
        </button>
      </div>
      {state.status === "loading" ? (
        <ul className="st-queues" aria-busy="true">
          {QUEUES.slice(0, 8).map((q) => (
            <li key={q.key} className="st-queue st-queue-wait" />
          ))}
        </ul>
      ) : (
        <ul className="st-queues">
          {known.map((q) => (
            <li key={q.key}>
              <Link href={q.href} className="st-queue cr-focus" data-busy={(q.count ?? 0) > 0 || undefined}>
                <span className="st-queue-n cr-num">{q.count}</span>
                <span className="st-queue-label">{q.label}</span>
                {(q.count ?? 0) > 0 ? <ArrowRight aria-hidden="true" className="size-3.5" /> : <CircleCheck aria-hidden="true" className="size-3.5 text-success" />}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ConsoleHome() {
  const { user } = useAuth();
  const { currentOrg } = useWorkspace();
  const sections = staffNavSections(user?.permissions);
  return (
    <div className="space-y-6">
      <div className="st-pagehead">
        <div>
          <h1 className="st-h1">Staff console</h1>
          <p className="st-sub">
            {currentOrg ? (
              <>
                Acting in <span className="font-semibold text-fg">{currentOrg.name}</span>. Change it from &ldquo;Acting in&rdquo; in the menu.
              </>
            ) : (
              <>Choose a workspace from &ldquo;Acting in&rdquo; in the menu; staff pages work inside it.</>
            )}
          </p>
        </div>
        <p className="st-sub hidden md:block">
          Press <kbd className="st-kbd">Ctrl K</kbd> to jump to any page
        </p>
      </div>

      <Waiting workspaceId={currentOrg?.id ?? null} />

      <SpotlightRegion className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {sections.map((section) => (
          <section key={section.label} aria-labelledby={`sec-${section.label}`} className="st-panel">
            <h2 id={`sec-${section.label}`} className="st-nav-head !px-0">
              {section.label}
            </h2>
            <ul className="mt-1">
              {section.items.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="st-jump cr-focus">
                    <NavIcon href={item.href} className="size-4 text-highlight" />
                    <span className="flex-1">{item.label}</span>
                    <ArrowRight aria-hidden="true" className="st-jump-go size-3.5" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </SpotlightRegion>
    </div>
  );
}

export default function StaffHomePage() {
  return (
    <Protected>
      <ConsoleHome />
    </Protected>
  );
}
