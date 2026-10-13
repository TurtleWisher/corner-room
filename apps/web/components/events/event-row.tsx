import Link from "next/link";

import { DateBlock, DateTime, StatusChip } from "@/components/ds";
import { EventMedia } from "@/components/events/event-media";
import type { EventRecord } from "@/lib/api";
import { cityFromTimeZone } from "@/lib/home-view";
import { EVENT_STATUS } from "@/lib/status-maps";

/** One event in a list (home Upcoming, What's On): date block, media thumbnail, title, time, status. */
export function EventRow({ event }: { event: EventRecord }) {
  const href = `/discover/${event.id}`;
  return (
    <li className="cr-row grid grid-cols-[3.5rem_4rem_minmax(0,1fr)] items-center gap-x-4 gap-y-2 border-b border-line py-5 md:grid-cols-[6rem_4.5rem_minmax(0,1fr)_auto] md:gap-x-6">
      <DateBlock value={event.starts_at} timeZone={event.timezone} />
      <Link href={href} className="cr-focus block" tabIndex={-1} aria-hidden="true">
        <EventMedia title={event.title} side={cityFromTimeZone(event.timezone) ?? event.title} size="front" />
      </Link>
      <div className="min-w-0">
        <h3 className="truncate text-lg font-bold text-fg">
          <Link href={href} className="cr-focus hover:text-highlight">
            {event.title}
          </Link>
        </h3>
        <p className="mt-0.5 text-sm text-fg-muted">
          <DateTime value={event.starts_at} format="time" timeZone={event.timezone} showZone />
        </p>
      </div>
      <div className="col-start-3 md:col-start-auto md:justify-self-end">
        <StatusChip value={event.status} map={EVENT_STATUS} />
      </div>
    </li>
  );
}
