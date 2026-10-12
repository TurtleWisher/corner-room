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
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  Input,
  LoadingState,
  Money,
  PageHeader,
  Select,
  Skeleton,
  StatusChip,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Textarea,
  UnavailableValue,
} from "@/components/ds";
import { defineStatusMap } from "@/lib/format/status";
import type { ThemeName } from "@/lib/theme/palette";

import { InteractiveDemo } from "./interactive";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Theme kit · Corner Room", robots: { index: false, follow: false } };

/*
 * Stage 3 theme kit. Developer reference only: hidden in production unless CR_THEME_KIT=1.
 * Everything below is SAMPLE CONTENT for judging the system, not real data.
 */

const EVENT_TIME = "2025-10-17T14:00:00Z";
const ZONE = "Asia/Dhaka";

const LEDGER_STATUS = defineStatusMap({
  POSTED: { label: "Posted", tone: "positive" },
  APPROVED: { label: "Approved", tone: "info" },
  DRAFT: { label: "Draft", tone: "neutral" },
});

const LEDGER = [
  { date: "2025-10-17T10:00:00Z", entry: "Ticket capture", ref: "Low Tide Sessions", amount: 4500000, status: "POSTED" },
  { date: "2025-10-16T10:00:00Z", entry: "Refund approved", ref: "Night Bus", amount: -120000, status: "POSTED" },
  { date: "2025-10-15T10:00:00Z", entry: "Royalty run", ref: "Static Bloom", amount: 864050, status: "APPROVED" },
  { date: "2025-10-14T10:00:00Z", entry: "Payout", ref: "Kaal Bela", amount: 1200000, status: "AWAITING_SECOND_APPROVAL" },
  { date: "2025-10-13T10:00:00Z", entry: "Expense", ref: "Monsoon Frequencies", amount: null, status: "DRAFT" },
];

const ROLES: { name: string; cls: string; text?: string }[] = [
  { name: "surface", cls: "bg-surface" },
  { name: "surface-raised", cls: "bg-surface-raised" },
  { name: "surface-sunken", cls: "bg-surface-sunken" },
  { name: "accent", cls: "bg-accent", text: "text-on-accent" },
  { name: "brand", cls: "bg-brand", text: "text-on-brand" },
  { name: "highlight", cls: "bg-highlight", text: "text-surface" },
  { name: "fg", cls: "bg-fg", text: "text-surface" },
  { name: "fg-muted", cls: "bg-fg-muted", text: "text-surface" },
  { name: "danger", cls: "bg-danger", text: "text-surface" },
  { name: "success", cls: "bg-success", text: "text-surface" },
  { name: "warning", cls: "bg-warning", text: "text-surface" },
  { name: "info", cls: "bg-info", text: "text-surface" },
];

const WORLDS: { theme: ThemeName; title: string; eyebrow: string; logo: "ember" | "indigo" | "mono-light" | "mono-dark"; front: string; side: string }[] = [
  { theme: "ember", title: "Events", eyebrow: "Ember world · default", logo: "ember", front: "Low Tide", side: "Sessions" },
  { theme: "sky", title: "Music", eyebrow: "Sky world · listening", logo: "indigo", front: "Night Bus", side: "Kaal Bela" },
  { theme: "staff", title: "Staff", eyebrow: "Graphite · operations", logo: "mono-light", front: "Ledger", side: "Finance" },
  { theme: "paper", title: "Paper", eyebrow: "Reading · documents", logo: "mono-dark", front: "Liner Notes", side: "Paper" },
];

function Section({ index, title, children, note }: { index: string; title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-line px-6 py-14 md:px-12" aria-labelledby={`s-${index}`}>
      <div className="mb-8 flex flex-wrap items-baseline gap-x-5 gap-y-2">
        <span className="cr-num text-sm text-highlight">{index}</span>
        <h2 id={`s-${index}`} className="font-ui text-xl font-extrabold tracking-tight text-fg">
          {title}
        </h2>
        {note ? <p className="text-sm text-fg-muted">{note}</p> : null}
      </div>
      {children}
    </section>
  );
}

export default function ThemeKitPage() {
  if (process.env.NODE_ENV === "production" && process.env.CR_THEME_KIT !== "1") notFound();

  return (
    <div data-theme="ember" className="cr-scope min-h-dvh">
      <LitSurface theme="ember" as="header" contentClassName="px-6 pb-16 pt-8 md:px-12">
        <div className="flex items-center justify-between gap-4">
          <Logo variant="ember" height={48} />
          <Badge tone="accent">Sample content, not real data</Badge>
        </div>
        <div className="mt-16 grid items-end gap-10 lg:grid-cols-[1.3fr_1fr]">
          <div>
            <Eyebrow className="mb-4">Phase 16 · Stage 3 · Design system</Eyebrow>
            <Display as="h1" size="xl">
              Theme <span className="text-highlight">kit</span>
            </Display>
            <p className="mt-6 max-w-xl text-base text-fg-muted">
              Tokens, worlds and primitives for every Corner Room module. Components read semantic roles only, so a module
              changes its look by changing its theme, not its components.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button size="lg">Primary action</Button>
              <Button size="lg" variant="secondary">
                Secondary
              </Button>
            </div>
          </div>
          <div className="mx-auto w-full max-w-sm">
            <RoomCube front="Corner Room" side="Corner" top="Room" tone="ember" />
          </div>
        </div>
      </LitSurface>

      <Section index="01" title="Worlds" note="Set data-theme on a layout. Gradients never cross worlds.">
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {WORLDS.map((w) => (
            <LitSurface key={w.theme} theme={w.theme} as="article" className="border border-line" contentClassName="flex flex-col gap-5 p-6">
              <Logo variant={w.logo} height={40} />
              <div>
                <Eyebrow className="mb-2">{w.eyebrow}</Eyebrow>
                <Display as="h3" size="md">
                  {w.title}
                </Display>
              </div>
              <div className="w-40">
                <RoomCube front={w.front} side={w.side} label="" />
              </div>
              <Card tone="glass" className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs text-fg-muted">From</p>
                  <Money value={{ amount_minor: 150000, currency_code: "BDT" }} variant="display" className="text-2xl text-highlight" />
                </div>
                <Button size="sm">Action</Button>
              </Card>
            </LitSurface>
          ))}
        </div>
      </Section>

      <Section index="02" title="Semantic roles" note="Contrast of every text pair is checked in lib/theme/tokens.test.ts.">
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {WORLDS.map((w) => (
            <div key={w.theme} data-theme={w.theme} className="cr-scope border border-line p-4">
              <p className="cr-eyebrow mb-3 text-fg-muted">{w.theme}</p>
              <ul className="grid grid-cols-2 gap-2">
                {ROLES.map((r) => (
                  <li key={r.name} className={`flex h-14 items-end border border-line p-2 text-[0.6875rem] font-semibold ${r.cls} ${r.text ?? "text-fg"}`}>
                    {r.name}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Section>

      <Section index="03" title="Type" note="Sikat for words, Archivo for UI and every numeral, Anek Bangla for Bangla and ৳.">
        <div className="grid gap-10 lg:grid-cols-2">
          <div className="space-y-5">
            <Display size="lg">After hours</Display>
            <Display size="md">What&apos;s on</Display>
            <Display size="sm" misregister={false}>
              New on Corner Room Music
            </Display>
            <p lang="bn" className="text-2xl text-fg">
              শহরের কোণে, গানের ঘরে
            </p>
          </div>
          <div className="space-y-4">
            <p className="cr-num text-5xl text-highlight">FRI 17 OCT · 8:00 PM</p>
            <p className="cr-num text-3xl text-fg">
              <Money value={{ amount_minor: 41250000, currency_code: "BDT" }} />
            </p>
            <p className="font-ui text-lg font-bold text-fg">UI heading, Archivo 700</p>
            <p className="max-w-prose text-sm leading-relaxed text-fg-muted">
              Body text in Archivo at 14 to 16 px. Short, direct, local. Doors 8:00 PM, Dhaka time. Never Sikat for body copy or
              for numbers: its zero is slashed.
            </p>
            <Eyebrow>Micro-label · numbered index</Eyebrow>
          </div>
        </div>
      </Section>

      <Section index="04" title="Actions">
        <div className="space-y-5">
          {(["primary", "brand", "secondary", "ghost", "danger"] as const).map((v) => (
            <div key={v} className="flex flex-wrap items-center gap-3">
              <span className="w-24 text-xs font-semibold text-fg-muted">{v}</span>
              <Button variant={v} size="sm">
                Small
              </Button>
              <Button variant={v}>Medium</Button>
              <Button variant={v} size="lg">
                Large
              </Button>
              <Button variant={v} disabled>
                Disabled
              </Button>
              <Button variant={v} busy>
                Busy
              </Button>
            </div>
          ))}
          <div className="flex items-center gap-3">
            <span className="w-24 text-xs font-semibold text-fg-muted">icon</span>
            <IconButton label="Play" variant="primary">
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M4 2.5v11l9-5.5-9-5.5Z" fill="currentColor" />
              </svg>
            </IconButton>
            <IconButton label="Search" variant="secondary">
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
                <path d="m10.5 10.5 3 3" stroke="currentColor" strokeWidth="1.6" />
              </svg>
            </IconButton>
            <Avatar name="Kaal Bela" />
            <Avatar name="Dhulo" size={32} />
          </div>
        </div>
      </Section>

      <Section index="05" title="Forms">
        <div className="grid max-w-4xl gap-6 md:grid-cols-2">
          <Field label="Email" hint="Tickets are sent here" required>
            {(p) => <Input {...p} type="email" autoComplete="email" placeholder="you@example.com" />}
          </Field>
          <Field label="Promo code" error="This code is not valid for this event">
            {(p) => <Input {...p} defaultValue="NIGHTBUS" />}
          </Field>
          <Field label="Ticket type">
            {(p) => (
              <Select {...p} defaultValue="ga">
                <option value="ga">General admission</option>
                <option value="early">Early entry</option>
              </Select>
            )}
          </Field>
          <Field label="Note to the organiser" hint="Optional">
            {(p) => <Textarea {...p} rows={3} />}
          </Field>
        </div>
      </Section>

      <Section index="06" title="Status and honest states" note="Unknown is never 0. Status labels come from the API value.">
        <div className="space-y-8">
          <div className="flex flex-wrap gap-2">
            <Badge tone="positive">On sale</Badge>
            <Badge tone="warning">Few left</Badge>
            <Badge tone="negative">Sold out</Badge>
            <Badge tone="info">Announced</Badge>
            <Badge tone="accent">Held for you</Badge>
            <Badge>Not on sale yet</Badge>
            <StatusChip value="AWAITING_SECOND_APPROVAL" />
          </div>
          <div className="flex flex-wrap items-center gap-8 text-sm">
            <span>
              Unique listeners: <UnavailableValue reason="Not reported by analytics" />
            </span>
            <span>
              Campaign: <UnavailableValue label="Not attributed" />
            </span>
            <LoadingState label="Loading tickets" />
          </div>
          <div className="grid gap-5 md:grid-cols-3">
            <EmptyState title="No events yet" body="When this organiser announces a show it appears here." action={<Button variant="secondary" size="sm">Browse all events</Button>} />
            <ErrorState title="Tickets could not be loaded" message="Please try again. Internal details are not shown." action={<Button variant="secondary" size="sm">Try again</Button>} />
            <div className="space-y-3 border border-line p-5" role="status" aria-label="Loading placeholder">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-10 w-32" />
            </div>
          </div>
        </div>
      </Section>

      <LitSurface theme="staff" as="div" contentClassName="border-t border-line px-6 py-14 md:px-12">
        <PageHeader
          variant="plain"
          eyebrow="07 · Staff surface"
          title="Finance ledger"
          description="Tables show the full minor exponent. Amounts are formatted, never computed."
          actions={<Button variant="secondary" size="sm">Export</Button>}
          className="mb-8"
        />
        <Table label="Sample ledger">
          <THead>
            <TR>
              <TH>Date</TH>
              <TH>Entry</TH>
              <TH>Reference</TH>
              <TH numeric>Amount</TH>
              <TH>Status</TH>
            </TR>
          </THead>
          <TBody>
            {LEDGER.map((row) => (
              <TR key={row.entry}>
                <TD>
                  <DateTime value={row.date} timeZone={ZONE} format="date" />
                </TD>
                <TD>{row.entry}</TD>
                <TD className="text-fg-muted">{row.ref}</TD>
                <TD numeric>
                  <Money value={{ amount_minor: row.amount, currency_code: "BDT" }} minorDigits="always" />
                </TD>
                <TD>
                  <StatusChip value={row.status} map={LEDGER_STATUS} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </LitSurface>

      <Section index="08" title="Dates and times" note="Always the event's own timezone.">
        <div className="flex flex-wrap items-center gap-10">
          <DateBlock value={EVENT_TIME} timeZone={ZONE} />
          <div className="space-y-1 text-sm">
            <p>
              <DateTime value={EVENT_TIME} timeZone={ZONE} showZone />
            </p>
            <p className="text-fg-muted">
              No zone from the API: <DateTime value={EVENT_TIME} format="time" />
            </p>
          </div>
        </div>
      </Section>

      <Section index="09" title="Interaction" note="Keyboard first. Native dialog. Polite live region for toasts.">
        <InteractiveDemo />
      </Section>

      <Section index="10" title="Room Cubes" note="Text only from real data. Tones per world.">
        <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-5">
          {(
            [
              ["ember", "Low Tide", "Sessions"],
              ["sky", "Night Bus", "Kaal Bela"],
              ["night", "Monsoon", "Chattogram"],
              ["ice", "Static Bloom", "Rumi"],
              ["mono", "Ledger", "Finance"],
            ] as const
          ).map(([tone, front, side]) => (
            <figure key={tone} className="space-y-2">
              <RoomCube tone={tone} front={front} side={side} />
              <figcaption className="text-xs text-fg-muted">{tone}</figcaption>
            </figure>
          ))}
        </div>
      </Section>
    </div>
  );
}
