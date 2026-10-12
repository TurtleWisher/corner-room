"use client";

import Link from "next/link";
import { ArrowRight, LayoutGrid, Library, ListMusic, Receipt, Ticket, type LucideIcon } from "lucide-react";

import { useAuth } from "@/components/auth-provider";
import { LitSurface } from "@/components/brand/corner-light";
import { Display, Eyebrow } from "@/components/brand/display";
import { ButtonLink, Card, DateTime, Skeleton } from "@/components/ds";
import { EventMedia } from "@/components/events/event-media";
import { EventRow } from "@/components/events/event-row";
import { useCredits } from "@/components/music/credits";
import { ReleaseCard } from "@/components/music/release-card";
import { TAGLINE_BN } from "@/components/shell/site-footer";
import { useAsync } from "@/components/use-async";
import { useWorkspace } from "@/components/workspace-provider";
import { fetchHealth, fetchPublicEvents, fetchReleases, type EventRecord } from "@/lib/api";
import { cityFromTimeZone, pickFeaturedEvent, upcomingEvents } from "@/lib/home-view";
import { creditName, sortReleases } from "@/lib/music-view";
import { showStaffEntry, staffHomeHref } from "@/lib/nav-view";
import { checkLabel, healthLabel } from "@/lib/ops-view";

function cityOrTitle(event: EventRecord): string {
  return cityFromTimeZone(event.timezone) ?? event.title;
}

/* ---------- Hero ---------- */

/**
 * The featured event: always present. A LIVE event first, else the next upcoming one, shown in the
 * event media slot (cover later, the Ember letter cube now). With no event, or if events fail to
 * load, the same red frame holds the Corner Room cube so the hero never loses its poster.
 */
function FeaturedEvent({ state }: { state: ReturnType<typeof useAsync<EventRecord[]>> }) {
  const featured = state.status === "ok" ? pickFeaturedEvent(state.data) : null;
  const event = featured?.event ?? null;
  const href = event ? `/discover/${event.id}` : "/discover";
  const label = featured?.label ?? "Next up";
  const caption =
    state.status === "loading"
      ? "Loading"
      : event
        ? event.title
        : state.status === "error"
          ? "Events could not be loaded"
          : "No events announced yet";

  return (
    <figure className="w-full max-w-[28rem]" aria-busy={state.status === "loading" || undefined}>
      <Link href={href} className="cr-focus block" aria-label={event ? `${label}: ${event.title}` : "See all events"}>
        {state.status === "loading" ? (
          <div className="aspect-square w-full animate-pulse bg-cr-signal/40 motion-reduce:animate-none" />
        ) : (
          <EventMedia title={event?.title ?? "Corner Room"} side={event ? cityOrTitle(event) : "Corner Room"} animate className="w-full" />
        )}
      </Link>
      <figcaption className="mt-4 flex items-baseline justify-between gap-4">
        <span className="cr-eyebrow flex items-center gap-2 text-[0.6875rem] text-fg-muted">
          {label === "Live now" ? <span aria-hidden="true" className="size-2 bg-cr-red-glow" /> : null}
          {label}
        </span>
        {event ? (
          <Link href={href} className="cr-focus truncate text-sm font-semibold text-fg hover:text-highlight">
            {caption}
          </Link>
        ) : (
          <span className="truncate text-sm font-semibold text-fg">{caption}</span>
        )}
      </figcaption>
      {event?.starts_at ? (
        <p className="mt-1 text-right text-xs text-fg-muted">
          <DateTime value={event.starts_at} timeZone={event.timezone} showZone />
        </p>
      ) : null}
    </figure>
  );
}

/* ---------- You ---------- */

const SHORTCUTS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/tickets", label: "Tickets", icon: Ticket },
  { href: "/library", label: "Library", icon: Library },
  { href: "/playlists", label: "Playlists", icon: ListMusic },
  { href: "/orders", label: "Orders", icon: Receipt },
];

function YouPanel() {
  const { status, user } = useAuth();
  const { organizations } = useWorkspace();
  if (status === "loading") return <Skeleton className="h-28 w-full" />;

  if (status !== "authenticated" || !user) {
    return (
      <Card className="flex flex-col gap-5 p-6 md:flex-row md:items-center md:justify-between md:p-8">
        <div>
          <h2 className="text-xl font-bold text-fg md:text-2xl">Your tickets, library and playlists in one place</h2>
          <p className="mt-1 text-sm text-fg-muted">Sign in to pick up where you left off.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ButtonLink href="/login">Sign in</ButtonLink>
          <ButtonLink href="/register" variant="secondary">
            Create an account
          </ButtonLink>
        </div>
      </Card>
    );
  }

  const name = user.display_name || user.email;
  return (
    <section aria-labelledby="home-you">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h2 id="home-you" className="text-xl font-bold text-fg md:text-2xl">
          {name ? `Welcome back, ${name}` : "Welcome back"}
        </h2>
        {showStaffEntry(user.permissions, organizations.length) ? (
          <ButtonLink href={staffHomeHref(user.permissions)} variant="secondary" size="sm">
            <LayoutGrid aria-hidden="true" /> Staff console
          </ButtonLink>
        ) : null}
      </div>
      <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {SHORTCUTS.map(({ href, label, icon: Icon }) => (
          <li key={href}>
            <Link
              href={href}
              className="cr-cut cr-focus flex h-14 items-center gap-3 px-4 text-sm font-semibold text-fg [--cut-border:var(--cr-line)] [--cut-fill:var(--cr-surface-raised)] hover:[--cut-border:var(--cr-line-strong)]"
            >
              <Icon aria-hidden="true" className="size-5 text-highlight" />
              <span className="flex-1">{label}</span>
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ---------- Upcoming ---------- */

function SectionHead({ id, title, href, link }: { id: string; title: string; href: string; link: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line pb-4">
      <h2 id={id} className="text-xl font-bold text-fg md:text-2xl">
        {title}
      </h2>
      <Link href={href} className="cr-focus text-sm font-semibold text-highlight hover:underline">
        {link}
      </Link>
    </div>
  );
}

function Upcoming({ state }: { state: ReturnType<typeof useAsync<EventRecord[]>> }) {
  const rows = state.status === "ok" ? upcomingEvents(state.data) : [];
  return (
    <section aria-labelledby="home-upcoming">
      <SectionHead id="home-upcoming" title="Upcoming" href="/discover" link="All events" />
      {state.status === "loading" ? (
        <div className="space-y-3 pt-4">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : state.status === "error" ? (
        <p className="py-8 text-sm text-fg-muted">Events could not be loaded. Please try again later.</p>
      ) : rows.length === 0 ? (
        <p className="py-8 text-sm text-fg-muted">No events announced yet.</p>
      ) : (
        <ul>
          {rows.map((event) => (
            <EventRow key={event.id} event={event} />
          ))}
        </ul>
      )}
    </section>
  );
}

/* ---------- New releases (Sky) ---------- */

function NewReleases() {
  const credits = useCredits();
  const state = useAsync(() => fetchReleases({ skipAuth: true }).then((p) => sortReleases(p.items).slice(0, 4)), []);
  if (state.status === "ok" && state.data.length === 0) return null;
  return (
    <LitSurface as="section" theme="sky" aria-labelledby="home-releases" className="border-y border-cr-sky/60">
      <div className="mx-auto max-w-[90rem] px-4 py-14 md:px-6">
        <SectionHead id="home-releases" title="New releases" href="/releases" link="All releases" />
        {state.status === "loading" ? (
          <div className="grid grid-cols-2 gap-6 pt-6 md:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="aspect-square w-full" />
            ))}
          </div>
        ) : state.status === "error" ? (
          <p className="py-8 text-sm text-fg">Releases could not be loaded. Please try again later.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-6 pt-6 md:grid-cols-4">
            {state.data.map((release) => (
              <li key={release.id}>
                <ReleaseCard release={release} artist={creditName(release, credits.artists, credits.bands)} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </LitSurface>
  );
}

/* ---------- Service status (staff only) ---------- */

function ServiceStatus() {
  const { user } = useAuth();
  const isOps = (user?.permissions ?? []).includes("audit.read");
  const state = useAsync(() => (isOps ? fetchHealth() : Promise.resolve(null)), [isOps]);
  if (!isOps || state.status !== "ok" || !state.data) return null;
  const { status, checks } = state.data;
  const rows: [string, string][] = [["Overall", healthLabel(status)]];
  for (const [key, value] of Object.entries(checks ?? {})) {
    rows.push([key.charAt(0).toUpperCase() + key.slice(1), checkLabel(value)]);
  }
  return (
    <section aria-labelledby="home-status" className="mx-auto max-w-[90rem] px-4 pb-10 md:px-6">
      <div className="border-t border-line pt-6">
      <h2 id="home-status" className="cr-eyebrow text-[0.6875rem] text-fg-muted">
        Service status <span className="normal-case tracking-normal">(staff only)</span>
      </h2>
      <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-2 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex gap-2">
            <dt className="text-fg-muted">{label}</dt>
            <dd className="font-semibold text-fg">{value}</dd>
          </div>
        ))}
      </dl>
      </div>
    </section>
  );
}

/* ---------- Page ---------- */

export function HomeView() {
  const events = useAsync(() => fetchPublicEvents().then((p) => p.items), []);
  return (
    <main id="main" data-theme="ember" className="cr-scope">
      <LitSurface as="section" theme="ember" aria-labelledby="home-title">
        <div className="mx-auto grid max-w-[90rem] items-center gap-12 px-4 pb-16 pt-12 md:px-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:pb-24 lg:pt-24">
          <div>
            <Eyebrow>Events · Music · Store</Eyebrow>
            <Display as="h1" id="home-title" size="xl" className="mt-4">
              <span className="block">The city&apos;s corner.</span>
              <span className="block">The music&apos;s room.</span>
            </Display>
            <p lang="bn" className="mt-6 font-bangla text-xl leading-[1.6] text-fg md:text-2xl">
              {TAGLINE_BN}
            </p>
            <div className="mt-10 flex flex-wrap gap-3">
              <ButtonLink href="/discover" size="lg">
                See what&apos;s on
              </ButtonLink>
              <ButtonLink href="/listen" variant="secondary" size="lg">
                Start listening
              </ButtonLink>
            </div>
          </div>
          <div className="flex justify-center lg:justify-end">
            <FeaturedEvent state={events} />
          </div>
        </div>
      </LitSurface>

      <div className="mx-auto max-w-[90rem] space-y-16 px-4 py-14 md:px-6">
        <YouPanel />
        <Upcoming state={events} />
      </div>

      <NewReleases />

      <ServiceStatus />
    </main>
  );
}
