"use client";

import Link from "next/link";
import { useState } from "react";
import { CalendarDays, Eye, EyeOff, Ticket } from "lucide-react";

import { Button, ButtonLink, Card, DateTime, EmptyState, ErrorState, Skeleton, StatusChip } from "@/components/ds";
import { EventMedia } from "@/components/events/event-media";
import { AccountPage } from "@/components/shell/account-page";
import { RetryButton } from "@/components/shell/staff-panel";
import { loadErrorMessage, useAsync } from "@/components/use-async";
import { fetchEvent, fetchMyTickets, type EventRecord, type TicketRecord } from "@/lib/api";
import { cityFromTimeZone } from "@/lib/home-view";
import { TICKET_STATUS } from "@/lib/status-maps";

/**
 * The code staff scan at the door. Rendering it as a QR image is open (OD-21); until then the
 * code is shown on request so it is not left on screen.
 */
function DoorCode({ ticket }: { ticket: TicketRecord }) {
  const [shown, setShown] = useState(false);
  if (!ticket.presentation_token || ticket.status !== "ISSUED") return null;
  return (
    <div className="mt-3">
      <Button variant="ghost" size="sm" onClick={() => setShown((s) => !s)} aria-expanded={shown}>
        {shown ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />} {shown ? "Hide door code" : "Show door code"}
      </Button>
      {shown ? (
        <p className="mt-2 break-all border border-line bg-surface-sunken p-3 font-mono text-xs text-fg" aria-label="Door code">
          {ticket.presentation_token}
        </p>
      ) : null}
    </div>
  );
}

function Tickets() {
  const data = useAsync(async () => {
    const tickets = (await fetchMyTickets()).items;
    const ids = [...new Set(tickets.map((t) => t.event_id).filter((v): v is string => Boolean(v)))];
    const events = await Promise.all(ids.map((id) => fetchEvent(id, { skipAuth: true }).catch(() => null)));
    const byId = new Map(events.filter((e): e is EventRecord => Boolean(e)).map((e) => [e.id, e]));
    const groups = new Map<string, { event: EventRecord | null; tickets: TicketRecord[] }>();
    for (const t of tickets) {
      const key = t.event_id ?? "unknown";
      const g = groups.get(key) ?? { event: t.event_id ? (byId.get(t.event_id) ?? null) : null, tickets: [] };
      g.tickets.push(t);
      groups.set(key, g);
    }
    return [...groups.values()].sort((a, b) => Date.parse(a.event?.starts_at ?? "9999") - Date.parse(b.event?.starts_at ?? "9999"));
  }, []);

  if (data.status === "loading") return <Skeleton className="h-56 w-full" />;
  if (data.status === "error") {
    return <ErrorState title="Tickets unavailable" message={loadErrorMessage(data.error, "your tickets")} action={<RetryButton onClick={data.reload} />} />;
  }
  if (data.data.length === 0) {
    return <EmptyState title="No tickets yet" body="Tickets you buy for events appear here." action={<ButtonLink href="/events" size="sm">See what&apos;s on</ButtonLink>} />;
  }
  return (
    <ul className="space-y-6">
      {data.data.map(({ event, tickets }) => (
        <li key={event?.id ?? "unknown"}>
          <Card className="grid gap-6 p-5 md:grid-cols-[10rem_minmax(0,1fr)]">
            <EventMedia
              title={event?.title ?? "Event"}
              side={event ? (cityFromTimeZone(event.timezone) ?? event.title) : "Corner Room"}
              eventId={event?.id}
              hasCover={event?.has_cover}
            />
            <div className="min-w-0">
              <h2 className="text-xl font-bold text-fg">
                {event ? (
                  <Link href={`/events/${event.id}`} className="cr-focus hover:text-highlight">
                    {event.title}
                  </Link>
                ) : (
                  "Event not available"
                )}
              </h2>
              {event?.starts_at ? (
                <p className="mt-1 inline-flex items-center gap-2 text-sm text-fg">
                  <CalendarDays aria-hidden="true" className="size-4 text-highlight" />
                  <DateTime value={event.starts_at} timeZone={event.timezone} showZone />
                </p>
              ) : null}
              <ul className="mt-4 divide-y divide-line border-y border-line">
                {tickets.map((t, i) => (
                  <li key={t.id} className="py-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="inline-flex items-center gap-2 font-semibold text-fg">
                        <Ticket aria-hidden="true" className="size-4 text-highlight" />
                        {t.ticket_type_name ?? "Ticket"}
                        <span className="cr-num text-sm text-fg-muted">#{String(i + 1).padStart(2, "0")}</span>
                      </p>
                      <StatusChip value={t.status} map={TICKET_STATUS} />
                    </div>
                    <DoorCode ticket={t} />
                  </li>
                ))}
              </ul>
            </div>
          </Card>
        </li>
      ))}
    </ul>
  );
}

export default function TicketsPage() {
  return (
    <AccountPage eyebrow="Your account" title="Tickets" what="your tickets" actions={<ButtonLink href="/events" variant="secondary" size="sm">What&apos;s on</ButtonLink>}>
      <Tickets />
    </AccountPage>
  );
}
