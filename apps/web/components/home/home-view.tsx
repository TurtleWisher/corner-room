"use client";

import Link from "next/link";
import { useEffect } from "react";
import { ArrowRight, LayoutGrid, Library, ListMusic, Play, Receipt, Ticket, type LucideIcon } from "lucide-react";

import { useAuth } from "@/components/auth-provider";
import { ComingSoon } from "@/components/brand/coming-soon";
import { LitSurface } from "@/components/brand/corner-light";
import { Display, Eyebrow } from "@/components/brand/display";
import { ButtonLink, Card, DateTime, Skeleton } from "@/components/ds";
import { EventMedia } from "@/components/events/event-media";
import { EventRow } from "@/components/events/event-row";
import { FeaturedCarousel } from "@/components/home/featured-carousel";
import { MissionBand } from "@/components/home/mission-band";
import { PosterTilt } from "@/components/home/poster-tilt";
import { Reveal } from "@/components/ds/reveal";
import { useCredits } from "@/components/music/credits";
import { ReleaseCard } from "@/components/music/release-card";
import { TAGLINE_BN } from "@/components/shell/site-footer";
import { useAsync } from "@/components/use-async";
import { useWorkspace } from "@/components/workspace-provider";
import { fetchHealth, fetchPublicEvents, fetchReleases, type EventRecord, type ReleaseRecord } from "@/lib/api";
import { cityFromTimeZone, featuredSlides, upcomingEvents } from "@/lib/home-view";
import { creditName, sortReleases } from "@/lib/music-view";
import { showStaffEntry, staffHomeHref } from "@/lib/nav-view";
import { checkLabel, healthLabel } from "@/lib/ops-view";

function cityOrTitle(event: EventRecord): string {
  return cityFromTimeZone(event.timezone) ?? event.title;
}

/* ---------- Hero ---------- */

/**
 * The hero's feature (owner, 2026-10-31, lib/home-view.ts `featuredSlides`): live and upcoming
 * events and the newest releases, turning in the featured carousel. While either list loads, the
 * frame waits; with nothing to feature, the same red frame holds the Corner Room cube.
 */
function Featured({
  events,
  releases,
}: {
  events: ReturnType<typeof useAsync<EventRecord[]>>;
  releases: ReturnType<typeof useAsync<ReleaseRecord[]>>;
}) {
  const loading = events.status === "loading" || releases.status === "loading";
  const slides = loading ? [] : featuredSlides(events.status === "ok" ? events.data : [], releases.status === "ok" ? releases.data : []);
  if (slides.length > 0) return <FeaturedCarousel slides={slides} />;
  return <FeaturedEvent state={loading ? { status: "loading" } : events} featured={null} />;
}

/**
 * The featured event: a LIVE event first, else the next upcoming one, shown in the event media
 * slot. With no event, or if events fail to load, the same red frame holds the Corner Room cube.
 */
function FeaturedEvent({
  state,
  featured,
}: {
  state: { status: "loading" } | ReturnType<typeof useAsync<EventRecord[]>>;
  featured: { event: EventRecord; label: "Live now" | "Next up" } | null;
}) {
  const event = featured?.event ?? null;
  const href = event ? `/events/${event.id}` : "/events";
  const label = featured?.label ?? "Next up";
  const caption =
    state.status === "loading"
      ? "Loading"
      : event
        ? event.title
        : state.status === "error"
          ? "Events could not be loaded"
          : "Nothing announced yet";

  return (
    <figure className="home-poster-in home-feature-size w-full max-w-[28rem]" aria-busy={state.status === "loading" || undefined}>
      <PosterTilt>
        <Link href={href} className="cr-focus block" aria-label={event ? `${label}: ${event.title}` : "See all events"}>
          {state.status === "loading" ? (
            <div className="aspect-square w-full animate-pulse bg-cr-signal/40 motion-reduce:animate-none" />
          ) : (
            <EventMedia
              title={event?.title ?? "Corner Room"}
              side={event ? cityOrTitle(event) : "Corner Room"}
              eventId={event?.id}
              hasCover={event?.has_cover}
              animate
              className="w-full"
            />
          )}
        </Link>
      </PosterTilt>
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
          <Display as="h2" size="sm" className="md:text-[2.25rem]">
            Your tickets, library and playlists in one place
          </Display>
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
        {/* Sikat for the words, the greeting face for the person (brand v1.4). */}
        <h2 id="home-you" className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="cr-display text-[2rem] text-fg md:text-[2.5rem]">Welcome back{name ? "," : ""}</span>
          {name ? <span className="cr-greeting text-[2.25rem] leading-none text-highlight md:text-[2.875rem]">{name}</span> : null}
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
              className="cr-cut cr-focus flex h-14 items-center gap-3 px-4 text-sm font-semibold text-fg cr-glass-card cr-hover"
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

function SectionHead({ id, index, title, href, link }: { id: string; index: string; title: string; href: string; link: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line pb-4">
      <h2 id={id} className="flex items-baseline gap-3">
        {/* REF-003 index: a small numbered tag before each home section (Archivo: never Sikat numerals). */}
        <span aria-hidden="true" className="cr-num text-sm text-highlight">
          {index}
        </span>
        <span className="cr-display text-[2rem] text-fg md:text-[2.5rem]">{title}</span>
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
    <Reveal as="section" aria-labelledby="home-upcoming">
      <SectionHead id="home-upcoming" index="01" title="Upcoming" href="/events" link="All events" />
      {state.status === "loading" ? (
        <div className="space-y-3 pt-4">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : state.status === "error" ? (
        <p className="py-8 text-sm text-fg-muted">Events could not be loaded. Please try again later.</p>
      ) : rows.length === 0 ? (
        <ComingSoon
          as="h3"
          eyebrow="Events"
          title="Events coming soon"
          body="The first shows will be announced here, with tickets on sale in the same place."
          className="mt-4"
        />
      ) : (
        <ul>
          {rows.map((event) => (
            <EventRow key={event.id} event={event} />
          ))}
        </ul>
      )}
    </Reveal>
  );
}

/* ---------- The Sky world: new releases, then the mission and the Store ---------- */

function NewReleases() {
  const credits = useCredits();
  const state = useAsync(() => fetchReleases({ skipAuth: true }).then((p) => sortReleases(p.items).slice(0, 4)), []);
  if (state.status === "ok" && state.data.length === 0) return null;
  return (
    <section aria-labelledby="home-releases" className="mx-auto max-w-[90rem] px-4 pb-10 pt-14 md:px-6">
      <Reveal>
        <SectionHead id="home-releases" index="02" title="New releases" href="/releases" link="All releases" />
      </Reveal>
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
          {state.data.map((release, i) => (
            <Reveal as="li" key={release.id} index={i} className="home-tile">
              <ReleaseCard release={release} artist={creditName(release, credits.artists, credits.bands)} />
            </Reveal>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Ember hands over to Sky as you scroll (owner decision D1, brand v1.3): Night in between, never purple. */
function WorldHandover() {
  return (
    <div aria-hidden="true" className="home-handover">
      <div className="home-handover-ember" />
      <div className="home-handover-sky" />
      <div className="home-handover-beam" />
    </div>
  );
}

function SkyWorld() {
  return (
    <LitSurface as="div" theme="sky" className="home-sky border-b border-cr-sky/60">
      <NewReleases />
      <MissionBand />
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
  const releases = useAsync(() => fetchReleases({ skipAuth: true }).then((p) => p.items), []);
  // Arriving at "/#welcome" after sign-in: Next's own hash scroll leaves the panel under the
  // sticky header (measured 2026-10-23), so line it up again once the page has its content.
  useEffect(() => {
    if (events.status !== "loading" && window.location.hash === "#welcome") {
      document.getElementById("welcome")?.scrollIntoView();
    }
  }, [events.status]);
  return (
    <main id="main" data-theme="ember" data-module="home" className="cr-scope">
      <LitSurface as="section" theme="ember" aria-labelledby="home-title">
        {/* The whole hero fits the first screen, short laptop screens included (owner, 2026-11-01):
            spacing and the headline scale with the screen's height as well as its width (home.css). */}
        <div className="home-hero mx-auto grid max-w-[90rem] items-center gap-10 px-4 md:px-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:gap-12">
          <div className="home-depth-near">
            <Eyebrow className="home-in" style={{ ["--i" as string]: 0 }}>
              Events · Music · Store
            </Eyebrow>
            <Display as="h1" id="home-title" size="xl" className="home-title mt-3">
              <span className="home-rise block" style={{ ["--i" as string]: 1 }}>
                The city&apos;s corner.
              </span>
              <span className="home-rise block" style={{ ["--i" as string]: 2 }}>
                The music&apos;s room.
              </span>
            </Display>
            <p lang="bn" className="home-in home-tagline mt-5 font-bangla text-xl leading-[1.6] text-fg md:text-2xl" style={{ ["--i" as string]: 3 }}>
              {TAGLINE_BN}
            </p>
            <div className="home-in home-cta mt-8 flex flex-wrap gap-3" style={{ ["--i" as string]: 4 }}>
              <ButtonLink href="/events" size="lg" className="home-cta-go">
                See what&apos;s on <ArrowRight aria-hidden="true" />
              </ButtonLink>
              <ButtonLink href="/listen" variant="secondary" size="lg" className="home-cta-go">
                <Play aria-hidden="true" /> Start listening
              </ButtonLink>
            </div>
          </div>
          <div className="home-depth-far flex justify-center lg:justify-end">
            <Featured events={events} releases={releases} />
          </div>
        </div>
      </LitSurface>

      <div className="mx-auto max-w-[90rem] space-y-16 px-4 py-14 md:px-6">
        {/* Sign-in lands here ("/#welcome", HOME_WELCOME). The wrapper exists while the panel loads. */}
        <div id="welcome" className="scroll-mt-24">
          <YouPanel />
        </div>
        <Upcoming state={events} />
      </div>

      <WorldHandover />
      <SkyWorld />

      <ServiceStatus />
    </main>
  );
}
