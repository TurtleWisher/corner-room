"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { MapPin, Ticket, TriangleAlert } from "lucide-react";

import { useAuth } from "@/components/auth-provider";
import { LitSurface } from "@/components/brand/corner-light";
import { Display, Eyebrow } from "@/components/brand/display";
import { ButtonLink, Card, DateTime, EmptyState, ErrorState, Money, Skeleton, StatusChip } from "@/components/ds";
import { EventMedia } from "@/components/events/event-media";
import { useCredits } from "@/components/music/credits";
import { RetryButton } from "@/components/shell/staff-panel";
import { loadErrorMessage, useAsync } from "@/components/use-async";
import { fetchEvent, fetchEventLineup, fetchEventTicketTypes, type EventRecord, type TicketTypeRecord } from "@/lib/api";
import { actsLabel, eventCity, eventEyebrow, fromPrice, ticketState } from "@/lib/events-view";
import { EVENT_STATUS } from "@/lib/status-maps";

function StatusBanner({ event }: { event: EventRecord }) {
  if (event.status === "POSTPONED") {
    return (
      <div role="status" className="mt-6 flex gap-3 border border-warning/60 p-4 text-sm text-fg">
        <TriangleAlert aria-hidden="true" className="size-5 shrink-0 text-warning" />
        <div>
          <p className="font-semibold">This event has been postponed.</p>
          {event.previous_starts_at ? (
            <p className="mt-1 text-fg-muted">
              Was <s><DateTime value={event.previous_starts_at} timeZone={event.timezone} /></s>
            </p>
          ) : null}
          {event.postponement_reason ? <p className="mt-1">{event.postponement_reason}</p> : null}
        </div>
      </div>
    );
  }
  if (event.status === "CANCELLED") {
    return (
      <div role="status" className="mt-6 flex gap-3 border border-danger/60 p-4 text-sm text-fg">
        <TriangleAlert aria-hidden="true" className="size-5 shrink-0 text-danger" />
        <div>
          <p className="font-semibold">This event has been cancelled.</p>
          {event.cancellation_reason ? <p className="mt-1">{event.cancellation_reason}</p> : null}
        </div>
      </div>
    );
  }
  return null;
}

/** The poster's date row (events.md composition 1): date, time and acts, in condensed numerals. */
function PosterFacts({ event, acts }: { event: EventRecord; acts: number }) {
  const facts: { label: string; value: React.ReactNode }[] = [
    { label: "Date", value: <DateTime value={event.starts_at} format="date" timeZone={event.timezone} /> },
    { label: "Time", value: <DateTime value={event.starts_at} format="time" timeZone={event.timezone} showZone /> },
  ];
  const count = actsLabel(acts);
  if (count) facts.push({ label: "Line-up", value: count });
  return (
    <dl className="ev-facts mt-7 grid max-w-2xl grid-cols-2 gap-x-8 gap-y-5 sm:flex sm:flex-wrap">
      {facts.map((f) => (
        <div key={f.label} className="min-w-0">
          <dt className="cr-eyebrow text-[0.625rem] text-fg-muted">{f.label}</dt>
          <dd className="cr-num mt-1.5 text-[1.375rem] leading-tight text-fg">{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Phones: the lowest price and one action stay at the bottom of the screen (events.md section 8). */
function TicketBar({ price }: { price: { amount_minor: number; currency_code: string } }) {
  return (
    <>
      <div className="h-20 lg:hidden" aria-hidden="true" />
      <div className="cr-bar fixed inset-x-0 bottom-16 z-30 border-t border-line lg:hidden">
        <div className="mx-auto flex h-16 max-w-[90rem] items-center justify-between gap-4 px-4">
          <p className="text-sm text-fg-muted">
            From <Money value={price} variant="display" className="ml-1 text-xl text-highlight" />
          </p>
          <ButtonLink href="#tickets" size="sm">
            <Ticket aria-hidden="true" /> Tickets
          </ButtonLink>
        </div>
      </div>
    </>
  );
}

function TicketCard({ event, type }: { event: EventRecord; type: TicketTypeRecord }) {
  const { status } = useAuth();
  const state = ticketState(event, type);
  const href = `/checkout?ticketTypeId=${type.id}&event=${event.id}`;
  return (
    <Card as="article" tone="glass" className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h3 className="text-lg font-bold text-fg">{type.name}</h3>
        {type.sales_ends_at && state.kind === "buy" ? (
          <p className="mt-1 text-xs text-fg-muted">
            On sale until <DateTime value={type.sales_ends_at} timeZone={event.timezone} showZone />
          </p>
        ) : null}
      </div>
      <div className="flex items-center gap-4">
        <Money value={{ amount_minor: type.price_amount_minor, currency_code: type.currency_code }} variant="display" className="text-3xl text-highlight" />
        {state.kind === "buy" ? (
          <ButtonLink href={status === "authenticated" ? href : `/login?next=${encodeURIComponent(href)}`} aria-label={`Buy ${type.name} tickets`}>
            <Ticket aria-hidden="true" /> {status === "authenticated" ? "Buy tickets" : "Sign in to buy"}
          </ButtonLink>
        ) : (
          <span className="inline-flex h-11 items-center border border-line-strong px-4 text-sm font-semibold text-fg-muted">
            {state.kind === "sold_out" ? "Sold out" : state.label}
          </span>
        )}
      </div>
    </Card>
  );
}

export default function EventPage() {
  const { id } = useParams<{ id: string }>();
  const credits = useCredits();
  const data = useAsync(
    () =>
      Promise.all([
        fetchEvent(id, { skipAuth: true }),
        fetchEventTicketTypes(id, { skipAuth: true }).then((p) => p.items),
        fetchEventLineup(id, { skipAuth: true }).then((p) => p.items).catch(() => []),
      ]).then(([event, types, lineup]) => ({ event, types, lineup })),
    [id],
  );

  if (data.status === "loading") {
    return (
      <main id="main" data-theme="ember" className="cr-scope">
        <div className="mx-auto grid max-w-[90rem] gap-10 px-4 py-14 md:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)]">
          <div className="space-y-4">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-28 w-3/4" />
            <Skeleton className="h-10 w-1/2" />
          </div>
          <Skeleton className="aspect-square w-full" />
        </div>
      </main>
    );
  }
  if (data.status === "error") {
    return (
      <main id="main" data-theme="ember" className="cr-scope">
        <div className="mx-auto max-w-3xl px-4 py-16">
          <h1 className="sr-only">Event</h1>
          <ErrorState title="Event unavailable" message={loadErrorMessage(data.error, "this event")} action={<RetryButton onClick={data.reload} />} />
        </div>
      </main>
    );
  }

  const { event, types, lineup } = data.data;
  const city = eventCity(event);
  const price = fromPrice(event, types);
  const billed = [...lineup].sort((a, b) => a.billing_order - b.billing_order);
  const nameOf = (row: (typeof lineup)[number]) =>
    (row.artist_id && credits.artists.find((a) => a.id === row.artist_id)?.stage_name) ||
    (row.band_id && credits.bands.find((b) => b.id === row.band_id)?.name) ||
    null;

  return (
    <main id="main" data-theme="ember" data-module="events" className="cr-scope">
      <LitSurface as="section" theme="ember" aria-labelledby="event-title">
        <div className="mx-auto grid max-w-[90rem] items-center gap-10 px-4 py-12 md:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)] lg:py-20">
          <div className="order-2 lg:order-1">
            <div className="flex flex-wrap items-center gap-3">
              <Eyebrow>{eventEyebrow(event)}</Eyebrow>
              <StatusChip value={event.status} map={EVENT_STATUS} />
            </div>
            <Display as="h1" id="event-title" size="xl" className="ev-rise mt-4">
              {event.title}
            </Display>
            {event.venue ? (
              <p className="mt-4 inline-flex items-center gap-2 text-base text-fg">
                <MapPin aria-hidden="true" className="size-4 text-highlight" />
                {[event.venue.name, event.venue.city].filter(Boolean).join(", ")}
              </p>
            ) : null}
            <PosterFacts event={event} acts={billed.length} />
            <StatusBanner event={event} />
            <div className="mt-8 flex flex-wrap gap-3">
              {types.length ? (
                <ButtonLink href="#tickets" size="lg">
                  <Ticket aria-hidden="true" /> Tickets
                  {price ? (
                    <span className="font-normal">
                      {" "}
                      from <Money value={price} />
                    </span>
                  ) : null}
                </ButtonLink>
              ) : null}
              <ButtonLink href="/events" variant="secondary" size="lg">
                All events
              </ButtonLink>
            </div>
          </div>
          <div className="order-1 lg:order-2">
            <EventMedia title={event.title} side={city ?? event.title} eventId={event.id} hasCover={event.has_cover} animate />
          </div>
        </div>
      </LitSurface>

      <div className="mx-auto grid max-w-[90rem] gap-12 px-4 pb-16 pt-10 md:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)]">
        <div className="space-y-12">
          {event.description ? (
            <section aria-labelledby="about">
              <h2 id="about" className="mb-3 text-xl font-bold text-fg">
                About
              </h2>
              <p className="max-w-prose text-base leading-relaxed text-fg">{event.description}</p>
            </section>
          ) : null}
          <section id="tickets" aria-labelledby="tickets-title" className="scroll-mt-24">
            <h2 id="tickets-title" className="mb-4 text-xl font-bold text-fg">
              Tickets
            </h2>
            {types.length === 0 ? (
              <EmptyState title="Tickets not on sale yet" body="Check back soon." />
            ) : (
              <div className="space-y-3">
                {types.map((type) => (
                  <TicketCard key={type.id} event={event} type={type} />
                ))}
              </div>
            )}
          </section>
        </div>
        <aside aria-labelledby="lineup-title">
          <h2 id="lineup-title" className="mb-4 text-xl font-bold text-fg">
            Line-up
          </h2>
          {billed.length === 0 ? (
            <p className="text-sm text-fg-muted">Line-up announced soon.</p>
          ) : (
            <ol className="border-t border-line">
              {billed.map((row, i) => {
                const name = nameOf(row);
                const href = row.artist_id ? `/artists/${row.artist_id}` : row.band_id ? `/bands/${row.band_id}` : null;
                return (
                  <li key={row.id} className="flex items-baseline gap-4 border-b border-line py-3">
                    <span className="cr-num text-lg text-highlight">{String(i + 1).padStart(2, "0")}</span>
                    {name && href ? (
                      <Link href={href} className="cr-focus text-lg font-semibold text-fg hover:text-highlight">
                        {name}
                      </Link>
                    ) : (
                      <span className="text-fg-muted">Name not available</span>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </aside>
      </div>
      {price ? <TicketBar price={price} /> : null}
    </main>
  );
}
