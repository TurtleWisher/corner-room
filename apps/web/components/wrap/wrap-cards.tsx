"use client";

/* Corner Room Wrap cards (owner, 2026-11-28, D-WRAP-01). One card per part of the person's look
 * back, drawn as carnival pieces in glass: a ticket booth of numbers, prize discs, a stage of acts,
 * a strength tester for fan rank, a fairground clock, a light show of months, ticket stubs for days
 * in a row. Every number comes from the API; nothing here counts or invents. Sikat is only for
 * words; every numeral is Archivo (brand). */

import { Play } from "lucide-react";
import type * as React from "react";

import { CoverArt } from "@/components/brand/cover-art";
import { YEAR_PATTERN, YearMark } from "@/components/wrap/year-mark";
import type { MyWrap, WrapAct, WrapCard, WrapSong, WrapStats } from "@/features/wraps/api";
import { coverUrl } from "@/lib/cover-view";
import { formatCount } from "@/lib/format/count";
import {
  CARD_WORDS,
  DAY_PART_WORDS,
  barHeights,
  biggestMonth,
  fillIn,
  headlineFor,
  hourLabel,
  monthLabel,
  plural,
  type FillContext,
} from "@/lib/wrap-view";

/** Display words in Sikat with any numerals set in Archivo (Sikat never draws numerals); a year
 * becomes the lit celebration mark (owner, 2026-11-28). */
export function Words({ text }: { text: string }) {
  const parts = text.split(/(\d[\d,.]*)/);
  return (
    <>
      {parts.map((p, i) =>
        YEAR_PATTERN.test(p) ? (
          <YearMark key={i} year={p} />
        ) : /^\d/.test(p) ? (
          <span key={i} className="wr-num-inline">
            {p}
          </span>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

function initials(text: string | null | undefined): string {
  const t = (text || "?").trim();
  return t.slice(0, 2).toUpperCase();
}

export function SongCover({ song, size = 480, className }: { song: Pick<WrapSong, "track_id" | "title">; size?: 160 | 480 | 1200; className?: string }) {
  return (
    <CoverArt
      // The staff look preview uses sample songs with no cover to fetch.
      src={song.track_id.startsWith("sample-") ? null : coverUrl({ track: song.track_id }, size)}
      fallback={<span className="wr-cover-fallback">{initials(song.title)}</span>}
      className={className ?? "wr-cover"}
    />
  );
}

function ActPicture({ act, className }: { act: WrapAct; className?: string }) {
  const src = act.picture ? coverUrl(act.kind === "BAND" ? { band: act.act_id, picture: act.picture } : { artist: act.act_id, picture: act.picture }, 480) : null;
  return <CoverArt src={src} fallback={<span className="wr-cover-fallback">{initials(act.name)}</span>} className={className ?? "wr-act-pic"} />;
}

/** A big number that counts up once when its card arrives (still under reduced motion: CSS). */
function Big({ value, unit }: { value: number; unit?: string }) {
  return (
    <span className="wr-big">
      <span className="wr-big-n">{formatCount(value)}</span>
      {unit ? <span className="wr-big-unit">{unit}</span> : null}
    </span>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="wr-well">
      <span className="wr-well-v">{value}</span>
      <span className="wr-well-l">{label}</span>
    </div>
  );
}

type Body = (p: { wrap: MyWrap; stats: WrapStats; ctx: FillContext; onPlay: (from: number) => void }) => React.ReactNode;

const BODIES: Record<WrapCard["key"], Body> = {
  INTRO: ({ wrap, ctx }) => (
    <div className="wr-intro">
      <span className="wr-ticket" aria-hidden>
        <span>Admit one</span>
        <span className="wr-ticket-year">{wrap.season.year}</span>
      </span>
      <p className="wr-tagline">
        <Words text={fillIn(wrap.season.tagline, ctx)} />
      </p>
      {wrap.season.intro ? <p className="wr-lede">{fillIn(wrap.season.intro, ctx)}</p> : null}
    </div>
  ),
  MINUTES: ({ stats }) => (
    <div className="wr-stack">
      <Big value={stats.minutes} unit="minutes" />
      <div className="wr-wells">
        <Stat label="listens" value={formatCount(stats.listens)} />
        <Stat label="songs" value={formatCount(stats.songs)} />
        <Stat label="acts" value={formatCount(stats.acts)} />
      </div>
    </div>
  ),
  TOP_SONG: ({ stats, onPlay }) => {
    const song = stats.top_songs[0];
    return (
      <div className="wr-prize">
        <div className="wr-disc-wrap">
          <span className="wr-disc" aria-hidden />
          <SongCover song={song} size={1200} className="wr-cover wr-cover-xl" />
        </div>
        <p className="wr-song-title">{song.title ?? "Not available"}</p>
        <p className="wr-song-act">{song.act ?? "Not available"}</p>
        <p className="wr-meta">
          {plural(song.listens, "listen")} · {plural(song.minutes, "minute")}
        </p>
        <button type="button" className="wr-pill" onClick={() => onPlay(0)}>
          <Play aria-hidden className="size-4" /> Play it
        </button>
      </div>
    );
  },
  TOP_SONGS: ({ stats, onPlay }) => (
    <ol className="wr-stubs">
      {stats.top_songs.map((s, i) => (
        <li key={s.track_id} className="wr-stub" style={{ "--i": i } as React.CSSProperties}>
          <button type="button" className="wr-stub-btn" onClick={() => onPlay(i)} aria-label={`Play ${s.title ?? "song"}`}>
            <span className="wr-stub-rank">{i + 1}</span>
            <SongCover song={s} size={160} className="wr-cover wr-cover-sm" />
            <span className="wr-stub-text">
              <span className="wr-stub-title">{s.title ?? "Not available"}</span>
              <span className="wr-stub-act">{s.act ?? "Not available"}</span>
            </span>
            <span className="wr-stub-n">{formatCount(s.listens)}</span>
          </button>
        </li>
      ))}
    </ol>
  ),
  TOP_ACTS: ({ stats }) => {
    const [first, ...rest] = stats.top_acts;
    return (
      <div className="wr-stage-acts">
        <div className="wr-headliner">
          <span className="wr-spot" aria-hidden />
          <ActPicture act={first} className="wr-act-pic wr-act-pic-xl" />
          <p className="wr-song-title">{first.name ?? "Not available"}</p>
          <p className="wr-meta">
            {plural(first.listens, "listen")} · {plural(first.songs, "song")}
          </p>
        </div>
        {rest.length ? (
          <ul className="wr-support">
            {rest.map((a, i) => (
              <li key={a.act_id} style={{ "--i": i } as React.CSSProperties}>
                <ActPicture act={a} />
                <span className="wr-support-rank">{i + 2}</span>
                <span className="wr-support-name">{a.name ?? "Not available"}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  },
  FAN_RANK: ({ stats }) => {
    const r = stats.fan_rank!;
    const fill = Math.max(0.06, 1 - (r.top_percent - 1) / 100);
    return (
      <div className="wr-striker">
        <div className="wr-striker-tower" aria-hidden>
          <span className="wr-striker-fill" style={{ "--fill": fill } as React.CSSProperties} />
          <span className="wr-striker-bell" />
        </div>
        <div className="wr-stack">
          <span className="wr-big">
            <span className="wr-big-unit">Top</span>
            <span className="wr-big-n">{r.top_percent}%</span>
          </span>
          <p className="wr-lede">
            of everyone who listened to {r.act ?? "this act"} in this Wrap&apos;s time. Number {formatCount(r.rank)} of {formatCount(r.listeners)} listeners.
          </p>
        </div>
      </div>
    );
  },
  CLOCK: ({ stats }) => {
    const heights = barHeights(stats.hours);
    const part = stats.day_part ? DAY_PART_WORDS[stats.day_part] : null;
    return (
      <div className="wr-stack">
        <svg viewBox="-120 -120 240 240" className="wr-clock" role="img" aria-label={`Most listens at ${hourLabel(stats.peak_hour ?? 0)}, Dhaka time`}>
          <circle r="54" className="wr-clock-face" />
          {heights.map((h, i) => {
            const a = (i / 24) * Math.PI * 2 - Math.PI / 2;
            const r0 = 60;
            const r1 = 60 + 4 + h * 52;
            return (
              <line
                key={i}
                x1={Math.cos(a) * r0}
                y1={Math.sin(a) * r0}
                x2={Math.cos(a) * r1}
                y2={Math.sin(a) * r1}
                className={i === stats.peak_hour ? "wr-clock-bar wr-clock-peak" : "wr-clock-bar"}
                style={{ "--i": i } as React.CSSProperties}
              />
            );
          })}
          <text y="-6" textAnchor="middle" className="wr-clock-time">
            {hourLabel(stats.peak_hour ?? 0)}
          </text>
          <text y="16" textAnchor="middle" className="wr-clock-sub">
            your hour
          </text>
        </svg>
        {part ? (
          <>
            <p className="wr-song-title">{part.name}</p>
            <p className="wr-lede">{part.line}</p>
          </>
        ) : null}
      </div>
    );
  },
  MONTHS: ({ stats }) => {
    const heights = barHeights(stats.months.map((m) => m.listens));
    const best = biggestMonth(stats.months);
    return (
      <div className="wr-stack">
        <div className="wr-lights" role="img" aria-label={best ? `Most listens in ${monthLabel(best.month)}: ${best.listens}` : "Listens by month"}>
          {stats.months.map((m, i) => (
            <span key={m.month} className="wr-light-col" data-best={best?.month === m.month || undefined} style={{ "--h": heights[i], "--i": i } as React.CSSProperties}>
              <span className="wr-light-bar" />
              <span className="wr-light-label">{monthLabel(m.month).slice(0, 1)}</span>
            </span>
          ))}
        </div>
        {best ? (
          <p className="wr-lede">
            {monthLabel(best.month)} was your biggest month, with {plural(best.listens, "listen")}.
          </p>
        ) : null}
      </div>
    );
  },
  STREAK: ({ stats }) => {
    const days = stats.streak?.days ?? 0;
    return (
      <div className="wr-stack">
        <Big value={days} unit={days === 1 ? "day" : "days"} />
        <div className="wr-bulbs" aria-hidden>
          {Array.from({ length: Math.min(days, 21) }, (_, i) => (
            <span key={i} className="wr-bulb" style={{ "--i": i } as React.CSSProperties} />
          ))}
        </div>
        {stats.busiest_day ? (
          <p className="wr-lede">
            Your busiest day was {new Date(`${stats.busiest_day.day}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "long" })}, with{" "}
            {plural(stats.busiest_day.listens, "listen")}.
          </p>
        ) : null}
      </div>
    );
  },
  DISCOVERY: ({ stats }) => (
    <div className="wr-stack">
      <Big value={stats.new_songs} unit={stats.new_songs === 1 ? "new song" : "new songs"} />
      {stats.new_acts ? (
        <p className="wr-lede">
          and {plural(stats.new_acts, "act")} you heard for the first time
          {stats.new_act_names.length ? `, like ${stats.new_act_names.join(", ")}` : ""}.
        </p>
      ) : null}
    </div>
  ),
  COLLECTION: ({ stats }) => (
    <div className="wr-stack">
      <div className="wr-wells">
        <Stat label={stats.bought.songs === 1 ? "song" : "songs"} value={formatCount(stats.bought.songs)} />
        <Stat label={stats.bought.releases === 1 ? "release" : "releases"} value={formatCount(stats.bought.releases)} />
        {stats.bought.preorders ? <Stat label="pre-orders" value={formatCount(stats.bought.preorders)} /> : null}
      </div>
      {stats.bought.first?.title ? <p className="wr-lede">It started with {stats.bought.first.title}.</p> : null}
    </div>
  ),
  EVENTS: ({ stats }) => (
    <div className="wr-stack">
      <div className="wr-wells">
        <Stat label={stats.events.events === 1 ? "event" : "events"} value={formatCount(stats.events.events)} />
        <Stat label="went to" value={formatCount(stats.events.attended)} />
        <Stat label={stats.events.tickets === 1 ? "ticket" : "tickets"} value={formatCount(stats.events.tickets)} />
      </div>
      <ul className="wr-posters">
        {stats.events.list.map((e) => (
          <li key={e.event_id}>
            <CoverArt
              src={coverUrl({ event: e.event_id, hasCover: e.has_poster }, 160)}
              fallback={<span className="wr-cover-fallback">{initials(e.title)}</span>}
              className="wr-cover wr-cover-sm"
            />
            <span className="wr-stub-text">
              <span className="wr-stub-title">{e.title}</span>
              <span className="wr-stub-act">{new Date(e.starts_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Dhaka" })}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  ),
  GIFTS: ({ stats }) => (
    <div className="wr-wells">
      <Stat label={stats.gifts.given === 1 ? "person got a gift from you" : "people got a gift from you"} value={formatCount(stats.gifts.given)} />
      <Stat label={stats.gifts.received === 1 ? "gift came to you" : "gifts came to you"} value={formatCount(stats.gifts.received)} />
    </div>
  ),
  SUMMARY: ({ wrap, stats, ctx }) => (
    <div className="wr-summary">
      <div className="wr-wells">
        <Stat label="minutes" value={formatCount(stats.minutes)} />
        <Stat label="songs" value={formatCount(stats.songs)} />
        {stats.day_part ? <Stat label="listener" value={DAY_PART_WORDS[stats.day_part].name} /> : null}
      </div>
      {stats.top_songs.length ? (
        <ol className="wr-mini-list">
          {stats.top_songs.slice(0, 5).map((s, i) => (
            <li key={s.track_id}>
              <span className="wr-stub-rank">{i + 1}</span>
              <SongCover song={s} size={160} className="wr-cover wr-cover-xs" />
              <span className="wr-stub-title">{s.title ?? "Not available"}</span>
            </li>
          ))}
        </ol>
      ) : null}
      {stats.top_acts[0]?.name ? <p className="wr-meta">Top act: {stats.top_acts[0].name}</p> : null}
      {wrap.season.outro ? <p className="wr-lede">{fillIn(wrap.season.outro, ctx)}</p> : null}
    </div>
  ),
};

export function WrapCardView({
  card,
  wrap,
  ctx,
  onPlay,
}: {
  card: WrapCard;
  wrap: MyWrap;
  ctx: FillContext;
  onPlay: (from: number) => void;
}) {
  const Body = BODIES[card.key];
  return (
    <article className="wr-card cr-cut" data-card={card.key} aria-roledescription="Wrap card">
      <span className="wr-sheen" aria-hidden />
      <p className="wr-eyebrow">
        <span>{CARD_WORDS[card.key].name}</span>
        <span className="wr-eyebrow-year">{wrap.season.year}</span>
      </p>
      <h2 className="wr-headline">
        <Words text={headlineFor(card.key, card.title, ctx)} />
      </h2>
      <div className="wr-body">
        <Body wrap={wrap} stats={wrap.stats} ctx={ctx} onPlay={onPlay} />
      </div>
    </article>
  );
}
