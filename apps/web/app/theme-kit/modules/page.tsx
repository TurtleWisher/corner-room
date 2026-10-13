import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { LitSurface } from "@/components/brand/corner-light";
import { Display, Eyebrow } from "@/components/brand/display";
import { Logo } from "@/components/brand/logo";
import { RoomCube } from "@/components/brand/room-cube";
import {
  Avatar,
  Badge,
  Button,
  Card,
  DateBlock,
  DateTime,
  Field,
  Input,
  Money,
  StatusChip,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  UnavailableValue,
} from "@/components/ds";
import { defineStatusMap } from "@/lib/format/status";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Module art direction · Corner Room", robots: { index: false, follow: false } };

/*
 * Stage 4 module art direction board. Developer reference only (hidden in production unless
 * CR_THEME_KIT=1). Every value below is SAMPLE CONTENT shaped like the real API records named
 * in docs/frontend/modules/*.md. These are compositions, not the Stage 6 to 12 components.
 */

const ZONE = "Asia/Dhaka";
const BDT = (amount_minor: number | null) => ({ amount_minor, currency_code: "BDT" });

const EVENT_STATUS = defineStatusMap({
  TICKETING_OPEN: { label: "On sale", tone: "positive" },
  PUBLISHED: { label: "Announced", tone: "info" },
  POSTPONED: { label: "Postponed", tone: "warning" },
  SOLD_OUT: { label: "Sold out", tone: "negative" },
});
const JOURNAL_STATUS = defineStatusMap({
  POSTED: { label: "Posted", tone: "positive" },
  REVERSED: { label: "Reversed", tone: "warning" },
});
const STATEMENT_STATUS = defineStatusMap({ ISSUED: { label: "Issued", tone: "info" } });
const SUB_STATUS = defineStatusMap({
  ACTIVE: { label: "Active", tone: "positive" },
  TRIALING: { label: "Trial", tone: "info" },
});

function ModuleHeader({ index, name, mood, world, doc }: { index: string; name: string; mood: string; world: string; doc: string }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="cr-eyebrow text-highlight">
          {index} · {world}
        </p>
        <h2 className="mt-2 font-ui text-3xl font-extrabold tracking-tight text-fg">
          {name} <span className="text-fg-muted">· {mood}</span>
        </h2>
      </div>
      <p className="font-mono text-xs text-fg-muted">{doc}</p>
    </div>
  );
}

/* ---------------- 01 Events ---------------- */
function EventsBoard() {
  const lineup = [
    { n: "01", name: "Rumi & The Static", role: "Headliner" },
    { n: "02", name: "Kaal Bela", role: "Support" },
  ];
  const whatsOn = [
    { when: "2025-10-17T14:00:00Z", title: "Low Tide Sessions", side: "Sessions", price: 150000, status: "TICKETING_OPEN" },
    { when: "2025-10-25T13:30:00Z", title: "Night Bus", side: "Kaal Bela", price: 120000, status: "TICKETING_OPEN" },
    { when: "2025-11-06T15:00:00Z", title: "Monsoon Frequencies", side: "Chattogram", price: 200000, status: "POSTPONED" },
    { when: "2025-11-14T14:30:00Z", title: "Corner Sessions", side: "Corner", price: null, status: "PUBLISHED" },
  ];
  return (
    <div data-module="events">
      <LitSurface theme="ember" contentClassName="px-6 py-14 md:px-12">
        <ModuleHeader index="01" name="Events" mood="Poster Night" world="Ember · full light" doc="modules/events.md" />
        <div className="relative grid items-center gap-10 border border-line p-8 lg:grid-cols-[1.4fr_1fr]">
          <div>
            <Eyebrow className="mb-4">Concert · Dhaka time</Eyebrow>
            <Display as="h3" size="xl">
              Low Tide <span className="text-highlight">Sessions</span>
            </Display>
            <dl className="mt-8 flex flex-wrap gap-x-10 gap-y-4">
              {[
                ["FRI 17 OCT", "Date"],
                ["8:00 PM", "Doors, Dhaka time"],
                ["2 ACTS", "Confirmed line-up"],
              ].map(([v, k]) => (
                <div key={k} className="flex flex-col-reverse">
                  <dt className="mt-1 text-xs text-fg-muted">{k}</dt>
                  <dd className="cr-num text-4xl text-fg">{v}</dd>
                </div>
              ))}
            </dl>
            <ol className="mt-8 max-w-md divide-y divide-line border-y border-line">
              {lineup.map((a) => (
                <li key={a.n} className="flex items-baseline gap-4 py-3">
                  <span className="cr-num text-sm text-highlight">{a.n}</span>
                  <span className="font-ui text-lg font-bold text-fg">{a.name}</span>
                  <span className="cr-eyebrow ml-auto text-[0.625rem] text-fg-muted">{a.role}</span>
                </li>
              ))}
            </ol>
          </div>
          <div className="mx-auto w-full max-w-sm">
            <RoomCube front="Low Tide" side="Sessions" label="" />
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <Card tone="glass">
            <p className="text-sm font-semibold text-fg">General admission</p>
            <Money value={BDT(150000)} variant="display" className="mt-2 block text-3xl text-highlight" />
            <div className="mt-4 flex items-center justify-between">
              <Badge tone="positive">On sale</Badge>
              <Button size="sm">Get tickets</Button>
            </div>
          </Card>
          <Card tone="glass">
            <p className="text-sm font-semibold text-fg">Early entry</p>
            <Money value={BDT(220000)} variant="display" className="mt-2 block text-3xl text-fg-muted" />
            <div className="mt-4 flex items-center justify-between">
              <Badge tone="negative">Sold out</Badge>
              <Button size="sm" disabled>
                Sold out
              </Button>
            </div>
          </Card>
          <Card tone="outline" className="text-sm text-fg-muted">
            <p className="cr-eyebrow mb-2 text-[0.625rem]">Honest gaps</p>
            Venue and event images are not public in the API yet (OD-06). The cube carries the artwork, and the zone label carries the
            city.
          </Card>
        </div>

        <h3 className="mt-14 font-ui text-sm font-bold uppercase tracking-[0.2em] text-fg-muted">What&apos;s on · focus and blur</h3>
        <ul className="ev-whatson mt-4 divide-y divide-line border-y border-line">
          {whatsOn.map((e) => (
            <li key={e.title} className="ev-row">
              <a href="#" className="cr-focus grid grid-cols-[3.5rem_1fr] items-center gap-x-4 gap-y-2 py-4 sm:grid-cols-[4rem_5rem_1fr_auto] sm:gap-6 md:grid-cols-[4rem_5rem_1fr_10rem_8rem]">
                <DateBlock value={e.when} timeZone={ZONE} />
                <span className="ev-cube hidden w-16 sm:block">
                  <RoomCube front={e.title} side={e.side} size="front" label="" />
                </span>
                <span>
                  <span className="block font-ui text-lg font-bold text-fg">{e.title}</span>
                  <span className="text-sm text-fg-muted">
                    <DateTime value={e.when} timeZone={ZONE} format="time" showZone />
                  </span>
                </span>
                <span className="hidden text-right md:block">
                  {e.price ? (
                    <span className="text-sm">
                      From <Money value={BDT(e.price)} className="font-bold text-fg" />
                    </span>
                  ) : (
                    <span className="text-sm text-fg-muted">Tickets not on sale yet</span>
                  )}
                </span>
                <span className="col-start-2 justify-self-start sm:col-start-auto sm:justify-self-end">
                  <StatusChip value={e.status} map={EVENT_STATUS} />
                </span>
              </a>
            </li>
          ))}
        </ul>
      </LitSurface>
    </div>
  );
}

/* ---------------- 02 Ticketing ---------------- */
function TicketingBoard() {
  return (
    <div data-module="ticketing">
      <LitSurface theme="ember" contentClassName="px-6 py-14 md:px-12">
        <ModuleHeader index="02" name="Ticketing" mood="Box Office" world="Ember · quiet light · Staff at the door" doc="modules/ticketing.md" />
        <div className="grid gap-6 lg:grid-cols-3">
          <Card tone="raised" className="space-y-5 p-6">
            <div>
              <p className="cr-eyebrow text-[0.625rem] text-fg-muted">Checkout</p>
              <p className="mt-1 font-ui text-xl font-extrabold text-fg">Low Tide Sessions</p>
              <p className="text-sm text-fg-muted">
                <DateTime value="2025-10-17T14:00:00Z" timeZone={ZONE} showZone />
              </p>
            </div>
            <div className="flex items-baseline justify-between border-y border-line py-3 text-sm">
              <span className="text-fg">2 × General admission</span>
              <Money value={BDT(150000)} className="text-fg-muted" />
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-semibold text-fg">Order total</span>
              <Money value={BDT(300000)} variant="display" className="text-3xl text-highlight" />
            </div>
            <div className="cr-cut flex items-center justify-between p-3 text-on-brand [--cut-fill:var(--cr-brand)]">
              <span className="cr-eyebrow text-[0.625rem]">Held for you</span>
              <span className="cr-num text-3xl" role="timer" aria-label="14 minutes 32 seconds left">
                14:32
              </span>
            </div>
            <Button block size="lg">
              Continue to payment
            </Button>
            <p className="text-xs text-fg-muted">The total comes from the order. Nothing is added at payment.</p>
          </Card>

          <article className="cr-cut flex flex-col p-0 [--cut-fill:var(--cr-surface-raised)] [--cut-border:var(--cr-line-strong)]">
            <div className="flex items-start justify-between gap-4 p-6">
              <div>
                <Badge tone="positive">Ready</Badge>
                <p className="cr-display mt-4 text-4xl text-fg">Low Tide Sessions</p>
                <p className="mt-2 text-sm text-fg-muted">General admission</p>
              </div>
              <DateBlock value="2025-10-17T14:00:00Z" timeZone={ZONE} />
            </div>
            <div className="mx-6 mb-6 grid aspect-square place-items-center border border-dashed border-line-strong bg-cr-cream p-6 text-center text-xs font-semibold text-cr-ink">
              QR from the ticket&apos;s presentation token
              <br />
              (renderer decided in OD-21)
            </div>
            <p className="border-t border-dashed border-line-strong px-6 py-3 text-xs text-fg-muted">Turn your screen brightness up at the door.</p>
          </article>

          <LitSurface theme="staff" as="div" className="border border-line" contentClassName="flex h-full flex-col justify-between gap-6 p-6">
            <div className="flex items-center justify-between">
              <p className="cr-eyebrow text-[0.625rem] text-fg-muted">Door scan</p>
              <Badge>Low Tide Sessions</Badge>
            </div>
            <div role="alert" className="text-center">
              <svg viewBox="0 0 48 48" aria-hidden="true" className="mx-auto size-16 text-success">
                <path d="m10 25 9 9 19-20" fill="none" stroke="currentColor" strokeWidth="5" />
              </svg>
              <p className="cr-display mt-4 text-6xl text-success">Admitted</p>
              <p className="mt-2 text-sm text-fg">General admission</p>
            </div>
            <div className="grid grid-cols-2 gap-3 text-center text-xs">
              <div className="border border-warning/50 p-3 text-warning">
                <p className="font-bold">ALREADY SCANNED</p>
                <p className="mt-1 text-fg-muted">shows first scan time</p>
              </div>
              <div className="border border-danger/50 p-3 text-danger">
                <p className="font-bold">NOT VALID</p>
                <p className="mt-1 text-fg-muted">ticket type shown</p>
              </div>
            </div>
          </LitSurface>
        </div>
      </LitSurface>
    </div>
  );
}

/* ---------------- 03 Music ---------------- */
function MusicBoard() {
  const tracks = [
    { n: 1, title: "Night Bus", ms: 222000 },
    { n: 2, title: "Farmgate, 2 AM", ms: 245000, playing: true },
    { n: 3, title: "Rickshaw Neon", ms: 198000 },
    { n: 4, title: "Bari Phera", ms: 301000, locked: true },
    { n: 5, title: "Last Stop", ms: null },
  ];
  const mmss = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;
  return (
    <LitSurface theme="sky" contentClassName="px-6 pb-0 pt-14 md:px-12">
      <ModuleHeader index="03" name="Music" mood="Night Bus" world="Sky" doc="modules/music.md" />
      <div className="grid gap-10 lg:grid-cols-[22rem_1fr]">
        <RoomCube front="Night Bus" side="Kaal Bela" top="EP" label="" />
        <div>
          <Eyebrow className="mb-3">EP · Kaal Bela · 5 tracks</Eyebrow>
          <Display as="h3" size="lg">
            Night Bus
          </Display>
          <div className="mt-6 flex gap-3">
            <Button>Play</Button>
            <Button variant="secondary">Add to library</Button>
          </div>
          <ol className="mt-8 divide-y divide-line border-y border-line">
            {tracks.map((t) => (
              <li
                key={t.n}
                className={cn("grid grid-cols-[2.5rem_1fr_auto] items-center gap-4 px-3 py-3 text-sm", t.playing && "bg-surface-overlay")}
              >
                <span className={cn("cr-num", t.playing ? "text-highlight" : "text-fg-muted")}>{String(t.n).padStart(2, "0")}</span>
                <span className={cn("font-semibold", t.playing ? "text-highlight" : "text-fg")}>
                  {t.title}
                  {t.playing ? <span className="sr-only"> (playing)</span> : null}
                </span>
                <span className="flex items-center gap-3 text-fg-muted">
                  {t.locked ? (
                    <span className="inline-flex items-center gap-1 text-xs">
                      <svg viewBox="0 0 12 12" aria-hidden="true" className="size-3">
                        <rect x="2" y="5.5" width="8" height="5.5" fill="currentColor" />
                        <path d="M3.8 5.5V4a2.2 2.2 0 0 1 4.4 0v1.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
                      </svg>
                      Subscription required
                    </span>
                  ) : null}
                  {t.ms ? <span className="tabular-nums">{mmss(t.ms)}</span> : <UnavailableValue label="Duration not available" />}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>
      <div className="cr-glass mt-10 -mx-6 flex items-center gap-4 px-6 py-3 md:-mx-12 md:px-12">
        <span className="block w-11 shrink-0">
          <RoomCube front="Night Bus" side="Kaal Bela" size="front" label="" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-fg">Farmgate, 2 AM</p>
          <p className="truncate text-xs text-fg-muted">Kaal Bela</p>
        </div>
        <button type="button" aria-label="Pause Farmgate, 2 AM" className="cr-cut cr-cut-sm cr-focus ml-4 grid size-11 shrink-0 place-items-center text-on-accent [--cut-fill:var(--cr-accent)]">
          <svg viewBox="0 0 16 16" aria-hidden="true" className="size-4">
            <rect x="3.5" y="3" width="3" height="10" fill="currentColor" />
            <rect x="9.5" y="3" width="3" height="10" fill="currentColor" />
          </svg>
        </button>
        <div className="flex flex-1 items-center gap-3">
          <span className="cr-num text-xs text-fg-muted">1:33</span>
          <div role="slider" aria-label="Position" aria-valuemin={0} aria-valuemax={245} aria-valuenow={93} tabIndex={0} className="cr-focus h-1.5 flex-1 bg-surface-overlay">
            <div className="h-full w-[38%] bg-highlight" />
          </div>
          <span className="cr-num text-xs text-fg-muted">4:05</span>
        </div>
      </div>
    </LitSurface>
  );
}

/* ---------------- 04 Artists ---------------- */
function ArtistsBoard() {
  return (
    <div>
      <LitSurface theme="ember" contentClassName="px-6 pt-14 md:px-12">
        <ModuleHeader index="04" name="Artists" mood="Liner Notes" world="Ember · Paper reading band" doc="modules/artists.md" />
        <div className="flex flex-wrap items-end gap-8 pb-12">
          <Avatar name="Kaal Bela" size={160} />
          <div>
            <Eyebrow className="mb-3">Band · Claimed profile</Eyebrow>
            <Display as="h3" size="xl">
              Kaal Bela
            </Display>
          </div>
          <Button className="ml-auto" variant="secondary" aria-pressed="false">
            Follow
          </Button>
        </div>
      </LitSurface>
      <LitSurface theme="paper" as="section" className="cr-clip-cut [--cut:28px]" contentClassName="grid gap-10 px-6 py-12 md:px-12 lg:grid-cols-[1fr_20rem]">
        <div className="max-w-[62ch]">
          <p className="cr-eyebrow mb-4 text-[0.625rem] text-highlight">Liner notes</p>
          <p className="font-ui text-2xl font-bold leading-snug text-fg">Sample bio text: four friends from Mirpur who write about the last bus home.</p>
          <p className="mt-4 text-base leading-relaxed text-fg">
            Sample body copy set in Archivo on the Paper world, Ink on Paper at 17.9:1. The real bio comes from the band record&apos;s
            <code className="mx-1 font-mono text-sm">bio</code> field and is omitted when it is empty.
          </p>
        </div>
        <div>
          <p className="cr-eyebrow mb-3 text-[0.625rem] text-fg-muted">Members</p>
          <ul className="divide-y divide-line border-y border-line text-sm">
            {[
              ["Rumi", "Vocals"],
              ["Tanzil", "Guitar"],
              ["Mehnaz", "Synths"],
            ].map(([n, r]) => (
              <li key={n} className="flex items-center justify-between py-2.5">
                <span className="font-semibold text-fg">{n}</span>
                <span className="cr-eyebrow text-[0.625rem] text-fg-muted">{r}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-fg-muted">Releases and events per artist need endpoints (OD-24).</p>
        </div>
      </LitSurface>
    </div>
  );
}

/* ---------------- 05 Store ---------------- */
function StoreBoard() {
  return (
    <LitSurface theme="ember" contentClassName="px-6 py-14 md:px-12">
      <ModuleHeader index="05" name="Store" mood="Merch Table" world="Ember · soft light" doc="modules/store.md" />
      <div className="grid gap-5 lg:grid-cols-[1fr_1fr_1.2fr]">
        {[
          { key: "listener_monthly", price: 19900, trial: 14 },
          { key: "listener_yearly", price: 199000, trial: null, interval: "year" },
        ].map((p) => (
          <Card key={p.key} as="article" tone="raised" className="flex flex-col gap-4 p-6">
            <p className="cr-eyebrow text-[0.625rem] text-fg-muted">Plan · name from key until OD-22</p>
            <h3 className="font-ui text-xl font-extrabold text-fg">{p.key === "listener_monthly" ? "Listener monthly" : "Listener yearly"}</h3>
            <p>
              <Money value={BDT(p.price)} variant="display" className="text-5xl text-highlight" />
              <span className="ml-1 text-sm text-fg-muted">/ {p.interval ?? "month"}</span>
            </p>
            {p.trial ? <Badge tone="info" className="self-start">{p.trial}-day trial</Badge> : <span className="h-6" />}
            <Button className="mt-auto">Subscribe</Button>
          </Card>
        ))}
        <Card tone="outline" className="p-6">
          <p className="cr-eyebrow mb-4 text-[0.625rem] text-fg-muted">What you own</p>
          <ul className="space-y-3 text-sm">
            <li className="flex items-center justify-between gap-3">
              <span className="text-fg">Streaming subscription</span>
              <StatusChip value="ACTIVE" map={SUB_STATUS} />
            </li>
            <li className="flex items-center justify-between gap-3 text-fg-muted">
              <span>Ends on</span>
              <DateTime value="2025-11-30T00:00:00Z" timeZone={ZONE} format="date" />
            </li>
            <li className="flex items-center justify-between gap-3">
              <span className="text-fg">Track purchase · Night Bus</span>
              <span className="text-xs text-fg-muted">No end date</span>
            </li>
          </ul>
          <p className="mt-6 text-xs text-fg-muted">No merch yet (Q-P1-28). No &quot;best value&quot; badges unless the API states them.</p>
        </Card>
      </div>
    </LitSurface>
  );
}

/* ---------------- 06 Marketing ---------------- */
function MarketingBoard() {
  const steps = ["Planning", "Content preparation", "Scheduled", "Active", "Optimisation", "Completed", "Reporting"];
  const current = 2;
  const cols: [string, string[]][] = [
    ["To do", ["Poster copy, Bangla", "Venue photos (blocked on media, OD-05)"]],
    ["In progress", ["Social posts schedule"]],
    ["Blocked", ["Radio slot confirmation"]],
    ["Done", ["Line-up announced"]],
  ];
  return (
    <LitSurface theme="staff" contentClassName="px-6 py-14 md:px-12">
      <ModuleHeader index="06" name="Marketing" mood="War Room" world="Staff" doc="modules/marketing.md" />
      <p className="cr-display text-[2rem] text-fg">Low Tide launch</p>
      <ol className="mt-6 grid grid-cols-7 gap-1" aria-label="Campaign lifecycle">
        {steps.map((s, i) => (
          <li
            key={s}
            aria-current={i === current ? "step" : undefined}
            className={cn(
              "border-t-2 pt-2 text-[0.6875rem] font-semibold",
              i < current && "border-fg text-fg",
              i === current && "border-highlight text-highlight",
              i > current && "border-line text-fg-muted",
            )}
          >
            <span className="cr-num block text-sm">{String(i + 1).padStart(2, "0")}</span>
            {s}
          </li>
        ))}
      </ol>
      <div className="mt-6 flex flex-wrap gap-2">
        <Button size="sm">Activate</Button>
        <Button size="sm" variant="ghost">
          Cancel campaign
        </Button>
      </div>
      <div className="mt-8 grid gap-4 lg:grid-cols-[3fr_1fr]">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {cols.map(([title, items]) => (
            <section key={title} className="border border-line p-3">
              <h3 className="mb-3 flex justify-between text-xs font-bold text-fg">
                {title} <span className="cr-num text-fg-muted">{items.length}</span>
              </h3>
              <ul className="space-y-2">
                {items.map((t) => (
                  <li key={t} className="cr-cut cr-cut-sm p-2.5 text-xs text-fg [--cut-fill:var(--cr-surface-raised)]">
                    {t}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <Card tone="raised" className="space-y-3 text-sm">
          <p className="flex justify-between">
            <span className="text-fg-muted">Budget (planning cap)</span>
            <Money value={BDT(5000000)} minorDigits="always" />
          </p>
          <p className="flex justify-between">
            <span className="text-fg-muted">Committed spend</span>
            <Money value={BDT(1250000)} minorDigits="always" />
          </p>
          <p className="flex justify-between">
            <span className="text-fg-muted">Results</span>
            <UnavailableValue label="Not attributed" />
          </p>
        </Card>
      </div>
    </LitSurface>
  );
}

/* ---------------- 07 Finance ---------------- */
function FinanceBoard() {
  const rows = [
    { at: "2025-10-17T10:00:00Z", type: "Ticket capture", src: "ticketing", amount: 4500000, status: "POSTED" },
    { at: "2025-10-16T10:00:00Z", type: "Refund", src: "commerce", amount: -120000, status: "POSTED" },
    { at: "2025-10-15T10:00:00Z", type: "Correction", src: "finance", amount: null, status: "REVERSED" },
  ];
  return (
    <LitSurface theme="staff" contentClassName="px-6 py-14 md:px-12">
      <ModuleHeader index="07" name="Finance" mood="Ledger" world="Staff · Paper statements" doc="modules/finance.md" />
      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <div>
          <Table label="Sample ledger">
            <THead>
              <TR>
                <TH>Date</TH>
                <TH>Type</TH>
                <TH>Source</TH>
                <TH numeric>Amount</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.type}>
                  <TD>
                    <DateTime value={r.at} timeZone={ZONE} format="date" />
                  </TD>
                  <TD>{r.type}</TD>
                  <TD className="font-mono text-xs text-fg-muted">{r.src}</TD>
                  <TD numeric>
                    <Money value={BDT(r.amount)} minorDigits="always" />
                  </TD>
                  <TD>
                    <StatusChip value={r.status} map={JOURNAL_STATUS} />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <div className="mt-6 grid grid-cols-2 gap-3 text-sm">
            <Card tone="raised">
              <p className="text-xs text-fg-muted">Payout P-0031 approvals</p>
              <p className="mt-2 flex items-center gap-2 text-success">
                <svg viewBox="0 0 12 12" aria-hidden="true" className="size-3">
                  <path d="m2 6.3 2.4 2.4L10 3" fill="none" stroke="currentColor" strokeWidth="1.8" />
                </svg>
                First approver
              </p>
              <p className="mt-1 flex items-center gap-2 text-fg-muted">
                <svg viewBox="0 0 12 12" aria-hidden="true" className="size-3">
                  <rect x="2" y="2" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="1.4" />
                </svg>
                Second approver needed
              </p>
            </Card>
            <Card tone="raised">
              <p className="text-xs text-fg-muted">Event P&amp;L · Low Tide</p>
              <p className="mt-2 text-sm text-warning">Currency not provided by the API (OD-25)</p>
            </Card>
          </div>
        </div>
        <div className="[filter:drop-shadow(0_24px_40px_rgb(0_0_0/0.55))]">
        <LitSurface theme="paper" as="article" className="cr-clip-cut" contentClassName="p-7">
          <div className="flex items-start justify-between">
            <Logo variant="mono-dark" height={40} />
            <StatusChip value="ISSUED" map={STATEMENT_STATUS} />
          </div>
          <p className="cr-eyebrow mt-6 text-[0.625rem] text-fg-muted">Royalty statement · version 1</p>
          <p className="mt-1 font-ui text-xl font-extrabold text-fg">Kaal Bela</p>
          <p className="text-sm text-fg-muted">
            <DateTime value="2025-09-01T00:00:00Z" timeZone={ZONE} format="date" /> to{" "}
            <DateTime value="2025-09-30T00:00:00Z" timeZone={ZONE} format="date" />
          </p>
          <table className="mt-5 w-full text-sm">
            <caption className="sr-only">Statement lines</caption>
            <thead>
              <tr className="border-b border-line-strong text-left text-[0.625rem] uppercase tracking-[0.18em] text-fg-muted">
                <th scope="col" className="py-2">Track</th>
                <th scope="col" className="py-2 text-right">Units</th>
                <th scope="col" className="py-2 text-right">Share</th>
                <th scope="col" className="py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["Night Bus", 1204, "40.00%", 432050],
                ["Farmgate, 2 AM", 860, "40.00%", 308600],
              ].map(([t, u, sh, a]) => (
                <tr key={t as string} className="border-b border-line">
                  <td className="py-2 text-fg">{t}</td>
                  <td className="py-2 text-right tabular-nums text-fg">{(u as number).toLocaleString("en-IN")}</td>
                  <td className="py-2 text-right tabular-nums text-fg-muted">{sh}</td>
                  <td className="py-2 text-right">
                    <Money value={BDT(a as number)} minorDigits="always" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-5 flex items-baseline justify-between">
            <span className="text-sm font-semibold text-fg">Statement total (from the API)</span>
            <Money value={BDT(740650)} minorDigits="always" variant="display" className="text-2xl text-highlight" />
          </p>
        </LitSurface>
        </div>
      </div>
    </LitSurface>
  );
}

/* ---------------- 08 Admin ---------------- */
function AdminBoard() {
  const checks: [string, string, "positive" | "warning" | "neutral"][] = [
    ["Database", "Healthy", "positive"],
    ["Redis", "Healthy", "positive"],
    ["Email", "Stub", "warning"],
    ["Worker", "Not configured", "neutral"],
  ];
  return (
    <LitSurface theme="staff" contentClassName="px-6 py-14 md:px-12">
      <ModuleHeader index="08" name="Admin" mood="Control Room" world="Staff · densest" doc="modules/admin.md" />
      <div className="flex flex-wrap items-center gap-3">
        <span className="cr-cut cr-cut-sm inline-flex items-center gap-2 px-3 py-1.5 text-xs font-semibold text-fg [--cut-border:var(--cr-line-strong)] [--cut-fill:var(--cr-surface-raised)]">
          <span className="cr-eyebrow text-[0.5625rem] text-fg-muted">Workspace</span> Corner Room Label
        </span>
        {checks.map(([n, s, t]) => (
          <Badge key={n} tone={t}>
            {n}: {s}
          </Badge>
        ))}
        <span className="ml-auto text-sm text-warning">Overall: Degraded while email is a stub</span>
      </div>
      <div className="mt-8 grid gap-5 lg:grid-cols-[1fr_1.6fr]">
        <div className="grid grid-cols-3 gap-3">
          {[
            ["Pending", 12],
            ["Published", 4310],
            ["Failed", 2],
          ].map(([k, v]) => (
            <Card key={k as string} tone="raised" className="p-4">
              <p className="text-xs text-fg-muted">Outbox {String(k).toLowerCase()}</p>
              <p className={cn("cr-num mt-1 text-3xl", k === "Failed" ? "text-danger" : "text-fg")}>{(v as number).toLocaleString("en-IN")}</p>
            </Card>
          ))}
        </div>
        <Card tone="raised" className="p-0">
          <div className="flex items-center justify-between border-b border-line px-4 py-3 text-xs">
            <span className="font-semibold text-fg">ticket_type.price_changed · General admission</span>
            <span className="text-fg-muted">
              staff user · <DateTime value="2025-10-12T09:41:00Z" timeZone={ZONE} format="datetime" />
            </span>
          </div>
          <dl className="grid grid-cols-[11rem_1fr_1fr] gap-x-4 gap-y-1 px-4 py-3 font-mono text-xs">
            <dt className="text-fg-muted">field</dt>
            <dd className="text-fg-muted">previous</dd>
            <dd className="text-fg-muted">new</dd>
            <dt className="text-fg">price_amount_minor</dt>
            <dd className="text-fg">120000</dd>
            <dd className="flex items-center gap-2 text-highlight">
              150000 <Badge tone="accent">changed</Badge>
            </dd>
            <dt className="text-fg">status</dt>
            <dd className="text-fg">ON_SALE</dd>
            <dd className="text-fg">ON_SALE</dd>
          </dl>
        </Card>
      </div>
    </LitSurface>
  );
}

/* ---------------- 09 Account ---------------- */
function AccountBoard() {
  return (
    <div data-module="account">
      <LitSurface theme="ember" contentClassName="px-6 py-14 md:px-12">
        <ModuleHeader index="09" name="Account" mood="Front Door" world="Ember · quiet light" doc="modules/account.md" />
        <div className="grid items-start gap-10 lg:grid-cols-[26rem_1fr]">
          <div>
            <Logo variant="ember" height={56} className="mb-6" />
            <Card tone="glass" className="space-y-4 p-6">
              <h3 className="font-ui text-2xl font-extrabold text-fg">Sign in</h3>
              <Field label="Email">{(p) => <Input {...p} type="email" autoComplete="email" />}</Field>
              <Field label="Password">{(p) => <Input {...p} type="password" autoComplete="current-password" />}</Field>
              <Button block size="lg">
                Sign in
              </Button>
              <p className="text-xs text-fg-muted">Pending accounts see: &quot;Your account is not verified yet.&quot; with a resend option (OD-08)</p>
            </Card>
            <p className="mt-6 font-ui text-lg font-bold text-fg">The city&apos;s corner. The music&apos;s room.</p>
            <p lang="bn" className="text-lg text-fg-muted">
              শহরের কোণে, গানের ঘরে
            </p>
            <p className="mt-1 text-xs text-fg-muted">Provisional tagline (D-P16-07, LB-02)</p>
          </div>
          <section aria-labelledby="feed">
            <h3 id="feed" className="cr-eyebrow mb-4 text-fg-muted">
              Notifications · today
            </h3>
            <ul className="divide-y divide-line border-y border-line">
              {[
                ["Your tickets are ready", "Low Tide Sessions · 2 tickets", true],
                ["Payment received", "Order for Low Tide Sessions", true],
                ["New release from Kaal Bela", "Night Bus is out now", false],
              ].map(([t, b, unread]) => (
                <li key={t as string} className="flex items-start gap-4 py-4">
                  <span aria-hidden="true" className={cn("mt-1.5 size-2.5 shrink-0", unread ? "bg-highlight" : "border border-line-strong")} />
                  <div className="min-w-0 flex-1">
                    <p className={cn("text-sm", unread ? "font-bold text-fg" : "text-fg-muted")}>
                      {unread ? <span className="sr-only">New: </span> : null}
                      {t}
                    </p>
                    <p className="text-xs text-fg-muted">{b}</p>
                  </div>
                  {unread ? (
                    <Button size="sm" variant="ghost">
                      Mark read
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        </div>
      </LitSurface>
    </div>
  );
}

export default function ModuleBoardPage() {
  if (process.env.NODE_ENV === "production" && process.env.CR_THEME_KIT !== "1") notFound();
  return (
    <div data-theme="ember" className="cr-scope min-h-dvh">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-line px-6 py-5 md:px-12">
        <div className="flex items-center gap-4">
          <Logo variant="ember" height={40} />
          <h1 className="font-ui text-lg font-extrabold text-fg">Module art direction · Stage 4</h1>
        </div>
        <Badge tone="accent">Sample content, not real data</Badge>
      </header>
      <EventsBoard />
      <TicketingBoard />
      <MusicBoard />
      <ArtistsBoard />
      <StoreBoard />
      <MarketingBoard />
      <FinanceBoard />
      <AdminBoard />
      <AccountBoard />
    </div>
  );
}
