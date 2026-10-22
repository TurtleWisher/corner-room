"use client";

import { CalendarDays, CircleCheck, Library, Music, Ticket } from "lucide-react";

import { CoverArt } from "@/components/brand/cover-art";
import { RoomCube } from "@/components/brand/room-cube";
import { DownloadButton } from "@/components/music/download-button";
import { ButtonLink, Card, DateTime, Money } from "@/components/ds";
import { EventMedia } from "@/components/events/event-media";
import type { EventRecord, OrderItemRecord, OrderRecord, TrackRecord } from "@/lib/api";
import { orderReference } from "@/lib/checkout-view";
import { maybeCoverUrl } from "@/lib/cover-view";
import { cityFromTimeZone } from "@/lib/home-view";

/*
 * Product-specific halves of checkout. Every amount is the server's line or total, formatted only.
 * Final visual treatment for the ticket and the music receipt follows the owner's references;
 * these are the functional versions on the current design system.
 */

function Lines({ order }: { order: OrderRecord }) {
  const items = order.items ?? [];
  return (
    <dl className="mt-5 space-y-2 border-t border-line pt-4 text-sm">
      {items.map((item: OrderItemRecord) => (
        <div key={item.id} className="flex items-baseline justify-between gap-4">
          <dt className="text-fg">
            {item.ticket_type_name ?? item.release_title ?? (item.item_type === "TRACK" ? "Track" : item.item_type === "RELEASE" ? "Release" : "Item")}
            {item.quantity > 1 ? (
              <span className="text-fg-muted">
                {" "}
                × {item.quantity} at <Money value={{ amount_minor: item.unit_amount_minor, currency_code: item.currency_code }} minorDigits="always" />
              </span>
            ) : null}
          </dt>
          <dd className="text-fg">
            <Money value={{ amount_minor: item.amount_minor, currency_code: item.currency_code }} minorDigits="always" />
          </dd>
        </div>
      ))}
      <div className="flex items-baseline justify-between gap-4 border-t border-line pt-3 font-bold">
        <dt className="text-fg">Total</dt>
        <dd className="text-fg">
          <Money value={{ amount_minor: order.total_amount_minor, currency_code: order.currency_code }} minorDigits="always" />
        </dd>
      </div>
    </dl>
  );
}

export function TicketSummary({ order, event }: { order: OrderRecord; event: EventRecord | null }) {
  const title = event?.title ?? "Event tickets";
  return (
    <Card as="section" aria-labelledby="summary-title" className="p-6">
      <EventMedia
        title={title}
        side={event ? cityFromTimeZone(event.timezone) ?? event.title : title}
        eventId={event?.id}
        hasCover={event?.has_cover}
        className="max-w-[16rem]"
      />
      <p className="cr-eyebrow mt-5 text-highlight">Tickets</p>
      <h2 id="summary-title" className="mt-2 text-2xl font-bold text-fg">
        {title}
      </h2>
      {event ? (
        <p className="mt-2 flex items-center gap-2 text-sm text-fg">
          <CalendarDays aria-hidden="true" className="size-4 text-highlight" />
          <DateTime value={event.starts_at} timeZone={event.timezone} showZone />
        </p>
      ) : null}
      <Lines order={order} />
    </Card>
  );
}

/** A whole release bought in one order (D-AUDIO-10). */
type BoughtRelease = { id: string; title: string } | null;

export function TrackSummary({
  order,
  track,
  artist,
  release = null,
}: {
  order: OrderRecord;
  track: TrackRecord | null;
  artist: string | null;
  release?: BoughtRelease;
}) {
  const title = release?.title ?? track?.title ?? "Track";
  return (
    <Card as="section" aria-labelledby="summary-title" className="p-6">
      <CoverArt
        src={maybeCoverUrl(release ? { release: release.id } : track ? { track: track.id } : null, 480)}
        fallback={<RoomCube front={title} side={artist ?? title} tone="sky" label="" />}
        className="max-w-[16rem] bg-cr-sky"
      />
      <p className="cr-eyebrow mt-5">{release ? "Release" : "Track"}</p>
      <h2 id="summary-title" className="mt-2 text-2xl font-bold text-fg">
        {title}
      </h2>
      <p className="mt-1 text-fg">{artist ?? "Artist not available"}</p>
      <p className="mt-2 text-sm text-fg-muted">Once the payment is confirmed it is added to your library.</p>
      <Lines order={order} />
    </Card>
  );
}

export function GenericSummary({ order, title }: { order: OrderRecord; title: string }) {
  return (
    <Card as="section" aria-labelledby="summary-title" className="p-6">
      <h2 id="summary-title" className="text-2xl font-bold text-fg">
        {title}
      </h2>
      <Lines order={order} />
    </Card>
  );
}

/** After the server reports the order FULFILLED and the tickets ISSUED. */
export function TicketConfirmation({ order, event }: { order: OrderRecord; event: EventRecord | null }) {
  const qty = (order.items ?? []).reduce((n, i) => n + i.quantity, 0);
  const type = order.items?.[0]?.ticket_type_name;
  const title = event?.title ?? "Your event";
  return (
    <Card as="section" aria-labelledby="done-title" className="overflow-hidden p-0">
      <div className="grid gap-0 sm:grid-cols-[14rem_1fr]">
        <EventMedia title={title} side={event ? cityFromTimeZone(event.timezone) ?? event.title : title} eventId={event?.id} hasCover={event?.has_cover} />
        <div className="p-6">
          <p className="flex items-center gap-2 text-sm font-semibold text-success">
            <CircleCheck aria-hidden="true" className="size-4" /> Tickets issued
          </p>
          <h2 id="done-title" className="mt-2 text-2xl font-bold text-fg">
            {title}
          </h2>
          {event ? (
            <p className="mt-1 text-sm text-fg">
              <DateTime value={event.starts_at} timeZone={event.timezone} showZone />
            </p>
          ) : null}
          <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
            {type ? (
              <>
                <dt className="text-fg-muted">Ticket</dt>
                <dd className="text-fg">
                  {type}
                  {qty > 1 ? ` × ${qty}` : ""}
                </dd>
              </>
            ) : null}
            <dt className="text-fg-muted">Paid</dt>
            <dd className="text-fg">
              <Money value={{ amount_minor: order.total_amount_minor, currency_code: order.currency_code }} minorDigits="always" />
            </dd>
            <dt className="text-fg-muted">Reference</dt>
            <dd className="cr-num text-fg">{orderReference(order.id)}</dd>
          </dl>
          <p className="mt-4 text-sm text-fg-muted">Your door code is with each ticket in Your tickets.</p>
          <div className="mt-5 flex flex-wrap gap-3">
            <ButtonLink href="/tickets">
              <Ticket aria-hidden="true" /> Your tickets
            </ButtonLink>
            <ButtonLink href="/events" variant="secondary">
              More events
            </ButtonLink>
          </div>
        </div>
      </div>
    </Card>
  );
}

/** After the server reports the order FULFILLED, so the purchase entitlement exists. */
export function MusicReceipt({
  order,
  track,
  artist,
  release = null,
}: {
  order: OrderRecord;
  track: TrackRecord | null;
  artist: string | null;
  release?: BoughtRelease;
}) {
  const title = release?.title ?? track?.title ?? "Your track";
  const playHref = release ? `/releases/${release.id}` : track ? `/tracks/${track.id}` : null;
  return (
    <Card as="section" aria-labelledby="done-title" className="overflow-hidden p-0">
      <div className="grid gap-0 sm:grid-cols-[14rem_1fr]">
        <CoverArt
          src={maybeCoverUrl(release ? { release: release.id } : track ? { track: track.id } : null, 480)}
          fallback={<RoomCube front={title} side={artist ?? title} tone="sky" label="" />}
          className="bg-cr-sky"
        />
        <div className="p-6">
          <p className="flex items-center gap-2 text-sm font-semibold text-success">
            <CircleCheck aria-hidden="true" className="size-4" /> In your library
          </p>
          <h2 id="done-title" className="mt-2 text-2xl font-bold text-fg">
            {title}
          </h2>
          <p className="mt-1 text-fg">{artist ?? "Artist not available"}</p>
          <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
            <dt className="text-fg-muted">Paid</dt>
            <dd className="text-fg">
              <Money value={{ amount_minor: order.total_amount_minor, currency_code: order.currency_code }} minorDigits="always" />
            </dd>
            {order.created_at ? (
              <>
                <dt className="text-fg-muted">Date</dt>
                <dd className="text-fg">
                  <DateTime value={order.created_at} format="date" />
                </dd>
              </>
            ) : null}
            <dt className="text-fg-muted">Reference</dt>
            <dd className="cr-num text-fg">{orderReference(order.id)}</dd>
          </dl>
          <div className="mt-5 flex flex-wrap gap-3">
            {playHref ? (
              <ButtonLink href={playHref}>
                <Music aria-hidden="true" /> Play now
              </ButtonLink>
            ) : null}
            <ButtonLink href="/library" variant="secondary">
              <Library aria-hidden="true" /> Your library
            </ButtonLink>
            {track && !release ? <DownloadButton trackId={track.id} title={title} size="md" /> : null}
          </div>
          {release ? <p className="mt-3 text-sm text-fg-muted">Download each song from the release page, as often as you like.</p> : null}
        </div>
      </div>
    </Card>
  );
}
