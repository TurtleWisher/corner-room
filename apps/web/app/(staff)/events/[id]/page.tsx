"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

import { Protected } from "@/components/protected";
import { EmptyState, ErrorState, LoadingState } from "@/components/async-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  ApiError,
  assignEventVenue,
  createTicketType,
  fetchArtists,
  fetchEvent,
  fetchEventLineup,
  fetchEventTicketTypes,
  fetchMilestones,
  fetchVenues,
  inviteEventLineup,
  transitionEvent,
  transitionEventLineup,
  transitionTicketType,
  updateEvent,
  type ArtistRecord,
  type EventRecord,
  type LineupRecord,
  type MilestoneRecord,
  type TicketTypeRecord,
  type VenueRecord,
} from "@/lib/api";

function EventDetailBody() {
  const params = useParams<{ id: string }>();
  const eventId = params.id;
  const [event, setEvent] = useState<EventRecord | null>(null);
  const [venues, setVenues] = useState<VenueRecord[]>([]);
  const [milestones, setMilestones] = useState<MilestoneRecord[]>([]);
  const [ticketTypes, setTicketTypes] = useState<TicketTypeRecord[]>([]);
  const [lineup, setLineup] = useState<LineupRecord[]>([]);
  const [artists, setArtists] = useState<ArtistRecord[]>([]);
  const [lineupArtistId, setLineupArtistId] = useState("");
  const [typeName, setTypeName] = useState("General");
  const [typePrice, setTypePrice] = useState("1500");
  const [typeCurrency, setTypeCurrency] = useState("USD");
  const [typeQty, setTypeQty] = useState("10");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [venueId, setVenueId] = useState("");
  const [reason, setReason] = useState("");
  const [newStart, setNewStart] = useState("");

  async function reload() {
    const row = await fetchEvent(eventId);
    setEvent(row);
    setTitle(row.title);
    setDescription(row.description ?? "");
    try {
      const [venuePage, milestonePage, typePage, lineupPage, artistPage] = await Promise.all([
        fetchVenues(),
        fetchMilestones(eventId),
        fetchEventTicketTypes(eventId),
        fetchEventLineup(eventId),
        fetchArtists(),
      ]);
      setVenues(venuePage.items);
      setMilestones(milestonePage.items);
      setTicketTypes(typePage.items);
      setLineup(lineupPage.items);
      setArtists(artistPage.items.filter((row) => row.status === "ACTIVE"));
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 403)) {
        throw err;
      }
    }
  }

  useEffect(() => {
    let cancelled = false;
    setEvent(null);
    setVenues([]);
    setMilestones([]);
    setTicketTypes([]);
    setLineup([]);
    setArtists([]);
    (async () => {
      setLoading(true);
      setError(null);
      try {
        await reload();
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Unable to load event");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  async function run(fn: () => Promise<EventRecord>) {
    setActionError(null);
    try {
      const row = await fn();
      setEvent(row);
      setTitle(row.title);
      setDescription(row.description ?? "");
      const milestonePage = await fetchMilestones(eventId).catch(() => ({ items: [] as MilestoneRecord[] }));
      setMilestones(milestonePage.items);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Action failed");
    }
  }

  async function onSave(form: FormEvent) {
    form.preventDefault();
    if (!event?.version) {
      return;
    }
    await run(() =>
      updateEvent(event.id, { title, description, version: event.version }),
    );
  }

  if (loading) {
    return <LoadingState label="Loading event" />;
  }
  if (error) {
    return <ErrorState title="Event unavailable" message={error} />;
  }
  if (!event) {
    return <EmptyState message="Event not found." />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">{event.title}</h1>
        <p className="mt-1 text-sm text-neutral-600">
          {event.status} · {event.timezone}
          {event.starts_at ? ` · ${event.starts_at}` : ""}
        </p>
        <p className="mt-2 text-sm">
          <Link href={`/staff/analytics/events/${event.id}`} className="underline">
            Event analytics
          </Link>
        </p>
      </div>
      {actionError ? (
        <ErrorState title="Action failed" message={actionError} />
      ) : null}
      <Card>
        <form onSubmit={onSave} className="space-y-3">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          <Button type="submit" size="sm">
            Save
          </Button>
        </form>
      </Card>
      <Card>
        <h2 className="text-sm font-medium">Lifecycle</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {["plan", "publish", "open_ticketing", "close_sales", "cancel"].map((action) => (
            <Button
              key={action}
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void run(() => transitionEvent(event.id, { action, version: event.version }))}
            >
              {action}
            </Button>
          ))}
        </div>
        <form
          className="mt-4 space-y-2"
          onSubmit={(form) => {
            form.preventDefault();
            void run(() =>
              transitionEvent(event.id, {
                action: "postpone",
                starts_at: newStart ? new Date(newStart).toISOString() : undefined,
                reason,
                version: event.version,
              }),
            );
          }}
        >
          <Input type="datetime-local" value={newStart} onChange={(e) => setNewStart(e.target.value)} />
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason" />
          <Button type="submit" size="sm" variant="outline">
            Postpone
          </Button>
        </form>
      </Card>
      <Card>
        <h2 className="text-sm font-medium">Venue</h2>
        <form
          className="mt-3 flex gap-2"
          onSubmit={(form) => {
            form.preventDefault();
            void run(() => assignEventVenue(event.id, venueId || null, event.version));
          }}
        >
          <select
            className="h-10 w-full rounded-md border border-neutral-300 px-2 text-sm"
            value={venueId}
            onChange={(e) => setVenueId(e.target.value)}
          >
            <option value="">Unassigned</option>
            {venues.map((venue) => (
              <option key={venue.id} value={venue.id}>
                {venue.name} ({venue.status})
              </option>
            ))}
          </select>
          <Button type="submit" size="sm">
            Assign
          </Button>
        </form>
        <p className="mt-2 text-sm text-neutral-600">Current: {event.venue_id ?? "none"}</p>
      </Card>
      <Card>
        <h2 className="text-sm font-medium">Lineup</h2>
        <p className="mt-1 text-xs text-neutral-600">
          Participation only. No fees, tickets, or contract terms. Only ACTIVE artists.
        </p>
        <form
          className="mt-3 flex gap-2"
          onSubmit={(form) => {
            form.preventDefault();
            if (!lineupArtistId) {
              return;
            }
            void (async () => {
              setActionError(null);
              try {
                await inviteEventLineup(event.id, { artist_id: lineupArtistId, billing_order: lineup.length + 1 });
                const lineupPage = await fetchEventLineup(event.id);
                setLineup(lineupPage.items);
                setLineupArtistId("");
              } catch (err) {
                setActionError(err instanceof ApiError ? err.message : "Could not invite lineup");
              }
            })();
          }}
        >
          <select
            className="h-10 w-full rounded-md border border-neutral-300 px-2 text-sm"
            value={lineupArtistId}
            onChange={(e) => setLineupArtistId(e.target.value)}
          >
            <option value="">Select ACTIVE artist</option>
            {artists.map((row) => (
              <option key={row.id} value={row.id}>
                {row.stage_name}
              </option>
            ))}
          </select>
          <Button type="submit" size="sm">
            Invite
          </Button>
        </form>
        {lineup.length === 0 ? (
          <EmptyState message="No lineup entries." />
        ) : (
          <ul className="mt-3 space-y-2 text-sm">
            {lineup.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-2">
                <span>
                  {row.artist_id ?? row.band_id} · {row.status} · #{row.billing_order}
                </span>
                {row.status === "INVITED" ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      void (async () => {
                        setActionError(null);
                        try {
                          await transitionEventLineup(event.id, row.id, "confirm", row.version);
                          const lineupPage = await fetchEventLineup(event.id);
                          setLineup(lineupPage.items);
                          const milestonePage = await fetchMilestones(event.id).catch(() => ({
                            items: [] as MilestoneRecord[],
                          }));
                          setMilestones(milestonePage.items);
                        } catch (err) {
                          setActionError(err instanceof ApiError ? err.message : "Could not confirm lineup");
                        }
                      })();
                    }}
                  >
                    Confirm
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Ticket types</h2>
          <Link href={`/events/${event.id}/attendance`} className="text-sm underline">
            Attendance
          </Link>
        </div>
        <form
          className="mt-3 space-y-2"
          onSubmit={(form) => {
            form.preventDefault();
            void (async () => {
              setActionError(null);
              try {
                await createTicketType({
                  event_id: event.id,
                  name: typeName,
                  price_amount_minor: Number.parseInt(typePrice, 10),
                  currency_code: typeCurrency,
                  quantity_total: Number.parseInt(typeQty, 10),
                });
                const typePage = await fetchEventTicketTypes(event.id);
                setTicketTypes(typePage.items);
              } catch (err) {
                setActionError(err instanceof ApiError ? err.message : "Could not create ticket type");
              }
            })();
          }}
        >
          <Input value={typeName} onChange={(e) => setTypeName(e.target.value)} placeholder="Name" />
          <Input value={typePrice} onChange={(e) => setTypePrice(e.target.value)} placeholder="Amount (minor units)" />
          <Input value={typeCurrency} onChange={(e) => setTypeCurrency(e.target.value)} placeholder="Currency" />
          <Input value={typeQty} onChange={(e) => setTypeQty(e.target.value)} placeholder="Quantity" />
          <Button type="submit" size="sm">
            Add type
          </Button>
        </form>
        {ticketTypes.length === 0 ? (
          <EmptyState message="No ticket types yet." />
        ) : (
          <ul className="mt-3 space-y-2 text-sm">
            {ticketTypes.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-2">
                <span>
                  {row.name} · {row.status} · {row.price_amount_minor} {row.currency_code} · remaining{" "}
                  {row.remaining}
                </span>
                {row.status === "DRAFT" ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      void (async () => {
                        setActionError(null);
                        try {
                          await transitionTicketType(row.id, "on_sale", row.version ?? undefined);
                          const typePage = await fetchEventTicketTypes(event.id);
                          setTicketTypes(typePage.items);
                        } catch (err) {
                          setActionError(err instanceof ApiError ? err.message : "Could not put on sale");
                        }
                      })();
                    }}
                  >
                    On sale
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <h2 className="text-sm font-medium">Timeline</h2>
        {milestones.length === 0 ? (
          <EmptyState message="No milestones yet." />
        ) : (
          <ul className="mt-3 space-y-2 text-sm">
            {milestones.map((row) => (
              <li key={row.id}>
                {row.type} · {row.previous_state ?? "—"} → {row.new_state ?? "—"}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

export default function EventDetailPage() {
  return (
    <Protected>
      <EventDetailBody />
    </Protected>
  );
}
