"use client";

import { useEffect, useState } from "react";

import { LitSurface } from "@/components/brand/corner-light";
import { Button, EmptyState, ErrorState, Reveal, Skeleton } from "@/components/ds";
import { EventRow } from "@/components/events/event-row";
import { PageIntro, RetryButton } from "@/components/shell/staff-panel";
import { loadErrorMessage, useAsync } from "@/components/use-async";
import { fetchEventTicketTypes, fetchPublicEvents, type EventRecord } from "@/lib/api";
import { fromPrice, groupByMonth, splitPast, whatsOnOrder } from "@/lib/events-view";

type Price = { amount_minor: number; currency_code: string } | null;

/** One list of rows. */
function EventList({ events, prices, label }: { events: EventRecord[]; prices: Record<string, Price>; label: string }) {
  return (
    <ul aria-label={label}>
      {events.map((event) => (
        <EventRow key={event.id} event={event} price={prices[event.id]} />
      ))}
    </ul>
  );
}

/*
 * What's On (events.md composition 2, D-EV-02): live first, then upcoming by month in each
 * event's own zone, then a separate Past section; the lowest on-sale price per row; more pages
 * on request.
 */
export default function WhatsOnPage() {
  const first = useAsync(() => fetchPublicEvents(), []);
  const [extra, setExtra] = useState<EventRecord[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [more, setMore] = useState<"idle" | "loading" | "error">("idle");
  const [prices, setPrices] = useState<Record<string, Price>>({});

  // A fresh first page (load or retry) starts the list again. Keyed to the page itself: the
  // useAsync result is a new object on every render.
  const firstPage = first.status === "ok" ? first.data : null;
  useEffect(() => {
    if (!firstPage) return;
    setExtra([]);
    setCursor(firstPage.next_cursor);
  }, [firstPage]);

  const all = firstPage ? [...firstPage.items, ...extra] : [];
  const { current, past } = splitPast(whatsOnOrder(all));

  // Prices for what can still be bought: one request per event, fetched once each.
  const wanted = current.map((e) => e.id).filter((id) => !(id in prices));
  const wantedKey = wanted.join(",");
  useEffect(() => {
    if (!wantedKey) return;
    let alive = true;
    const byId = new Map(current.map((e) => [e.id, e]));
    void Promise.all(
      wantedKey.split(",").map(async (id) => {
        const event = byId.get(id);
        const types = await fetchEventTicketTypes(id, { skipAuth: true })
          .then((p) => p.items)
          .catch(() => []);
        return [id, event ? fromPrice(event, types) : null] as const;
      }),
    ).then((rows) => alive && setPrices((prev) => ({ ...prev, ...Object.fromEntries(rows) })));
    return () => {
      alive = false;
    };
    // `current` is derived from the same data as `wantedKey`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantedKey]);

  const loadMore = async () => {
    if (!cursor) return;
    setMore("loading");
    try {
      const page = await fetchPublicEvents(cursor);
      setExtra((prev) => [...prev, ...page.items]);
      setCursor(page.next_cursor);
      setMore("idle");
    } catch {
      setMore("error");
    }
  };

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
        {first.status === "loading" ? (
          <div className="space-y-3">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : first.status === "error" ? (
          <ErrorState title="Events unavailable" message={loadErrorMessage(first.error, "events")} action={<RetryButton onClick={first.reload} />} />
        ) : all.length === 0 ? (
          <EmptyState title="No events announced yet" body="New shows will appear here when they are announced." />
        ) : (
          // The focus effect spans every list on the page: the row under the pointer stays sharp.
          <div className="ev-whatson space-y-12">
            {current.length === 0 ? <EmptyState title="Nothing coming up right now" body="New shows will appear here when they are announced." /> : null}
            {groupByMonth(current).map((group, i) => (
              <Reveal as="section" index={i} key={group.label} aria-labelledby={`m-${group.label}`}>
                <h2 id={`m-${group.label}`} className="cr-eyebrow border-b border-line pb-3 text-[0.75rem] text-highlight">
                  {group.label}
                </h2>
                <EventList events={group.events} prices={prices} label={`Events in ${group.label}`} />
              </Reveal>
            ))}
            {cursor ? (
              <div className="flex flex-col items-start gap-2">
                <Button variant="secondary" onClick={() => void loadMore()} disabled={more === "loading"}>
                  {more === "loading" ? "Loading" : "Show more events"}
                </Button>
                {more === "error" ? (
                  <p role="status" className="text-sm text-fg">
                    More events could not be loaded. Please try again.
                  </p>
                ) : null}
              </div>
            ) : null}
            {past.length ? (
              <Reveal as="section" aria-labelledby="whats-on-past" className="opacity-90">
                <h2 id="whats-on-past" className="cr-eyebrow border-b border-line pb-3 text-[0.75rem] text-fg-muted">
                  Past
                </h2>
                <EventList events={past} prices={{}} label="Past events" />
              </Reveal>
            ) : null}
          </div>
        )}
      </div>
    </main>
  );
}
