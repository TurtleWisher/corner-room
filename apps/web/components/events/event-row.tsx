import Link from "next/link";

import { DateBlock, DateTime, Money, StatusChip } from "@/components/ds";
import { EventMedia } from "@/components/events/event-media";
import type { EventRecord } from "@/lib/api";
import { eventCity } from "@/lib/events-view";
import { EVENT_STATUS } from "@/lib/status-maps";

/**
 * One event in a list (home Upcoming, What's On): date block, media thumbnail, title, time and
 * place, the lowest on-sale price when the list has it, and the status. `ev-row` and `ev-cube`
 * join the What's On focus effect (events.css): the row under the pointer stays sharp.
 */
export function EventRow({ event, price }: { event: EventRecord; price?: { amount_minor: number; currency_code: string } | null }) {
  const href = `/events/${event.id}`;
  const city = eventCity(event);
  return (
    <li className="ev-row cr-row grid grid-cols-[3.5rem_4rem_minmax(0,1fr)] items-center gap-x-4 gap-y-2 border-b border-line py-5 md:grid-cols-[6rem_4.5rem_minmax(0,1fr)_auto] md:gap-x-6">
      <DateBlock value={event.starts_at} timeZone={event.timezone} />
      <Link href={href} className="ev-cube cr-focus block" tabIndex={-1} aria-hidden="true">
        <EventMedia title={event.title} side={city ?? event.title} eventId={event.id} hasCover={event.has_cover} size="front" />
      </Link>
      <div className="min-w-0">
        <h3 className="truncate text-lg font-bold text-fg">
          <Link href={href} className="cr-focus hover:text-highlight">
            {event.title}
          </Link>
        </h3>
        <p className="mt-0.5 truncate text-sm text-fg-muted">
          <DateTime value={event.starts_at} format="time" timeZone={event.timezone} showZone />
          {event.venue ? ` · ${event.venue.name}` : null}
        </p>
      </div>
      <div className="col-start-3 flex flex-wrap items-center gap-x-4 gap-y-2 md:col-start-auto md:justify-self-end">
        {price ? (
          <span className="text-sm text-fg-muted">
            From <Money value={price} variant="display" className="ml-0.5 text-lg text-highlight" />
          </span>
        ) : null}
        <StatusChip value={event.status} map={EVENT_STATUS} />
      </div>
    </li>
  );
}
