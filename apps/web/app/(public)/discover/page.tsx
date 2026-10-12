"use client";

import { LitSurface } from "@/components/brand/corner-light";
import { EmptyState, ErrorState, Skeleton } from "@/components/ds";
import { EventRow } from "@/components/events/event-row";
import { PageIntro, RetryButton } from "@/components/shell/staff-panel";
import { loadErrorMessage, useAsync } from "@/components/use-async";
import { fetchPublicEvents } from "@/lib/api";
import { groupByMonth, whatsOnOrder } from "@/lib/events-view";

/* What's On (events.md composition 2): live first, then upcoming by month, in each event's own zone. */
export default function WhatsOnPage() {
  const events = useAsync(() => fetchPublicEvents().then((p) => whatsOnOrder(p.items)), []);
  return (
    <main id="main" data-theme="ember" data-module="events" className="cr-scope">
      <LitSurface as="section" theme="ember" aria-labelledby="whats-on-title">
        <div className="mx-auto max-w-[90rem] px-4 pb-10 pt-12 md:px-6 md:pt-16">
          <div id="whats-on-title">
            <PageIntro eyebrow="Events" title="What's on" lede="Live shows from Corner Room. Times are shown in each event's own city." />
          </div>
        </div>
      </LitSurface>
      <div className="mx-auto max-w-[90rem] space-y-12 px-4 pb-16 md:px-6">
        {events.status === "loading" ? (
          <div className="space-y-3">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : events.status === "error" ? (
          <ErrorState title="Events unavailable" message={loadErrorMessage(events.error, "events")} action={<RetryButton onClick={events.reload} />} />
        ) : events.data.length === 0 ? (
          <EmptyState title="No events announced yet" body="New shows will appear here when they are announced." />
        ) : (
          groupByMonth(events.data).map((group) => (
            <section key={group.label} aria-labelledby={`m-${group.label}`}>
              <h2 id={`m-${group.label}`} className="cr-eyebrow border-b border-line pb-3 text-[0.75rem] text-highlight">
                {group.label}
              </h2>
              <ul>
                {group.events.map((event) => (
                  <EventRow key={event.id} event={event} />
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </main>
  );
}
