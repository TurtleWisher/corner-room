"use client";

import * as React from "react";

import { CubeLogo } from "@/components/brand/cube-logo/cube-logo";
import { cubeFaces } from "@/components/brand/cube-logo/geometry";
import { clock, durationLabel } from "@/lib/player-model";

import { INTRO_COPY as C, INTRO_EVENTS, INTRO_TRACKS, type IntroTrack } from "./copy";
import {
  alternate,
  clamp,
  depthArrival,
  drift,
  DURATION_S,
  easeInOut,
  easeRoom,
  float,
  HEIGHT,
  lerp,
  ramp,
  ROOM_FOCUS_AT,
  ROOM_PEEK_AT,
  roomIndex,
  roomPlaying,
  roomTitleSince,
  SCENES,
  slotPose,
  WIDTH,
  window01,
} from "./timeline";

/*
 * Corner Room intro film (40 s, 1920 x 1080). Every frame is a pure function of `t`, so the same
 * component is the live preview (/theme-kit/intro-video) and the render source
 * (scripts/render-intro-video.mjs). Brand pieces are the real ones: the letter cube, the official
 * logo files, tokens.css worlds, glass with the cut corner, Sikat for words, Archivo for UI.
 */

type Style = React.CSSProperties;
const px = (v: number) => `${v}px`;

/** A block that arrives along the depth axis and fades. */
function arrive(k: number, distance = 56, extra = ""): Style {
  const { x, y } = depthArrival(k, distance);
  return { opacity: k, transform: `translate3d(${px(x)}, ${px(y)}, 0) ${extra}`.trim() };
}

/** Cube words for a title: parenthetical suffixes such as "(Live)" stay in captions only. */
function cubeWordsFor(title: string, secondary?: string) {
  const clean = (s: string) => s.replace(/\s*\([^)]*\)/g, "").trim();
  return cubeFaces(clean(title), secondary ? clean(secondary) : undefined);
}

function Cube({
  title,
  secondary,
  theme,
  framed = "tile",
  parts,
}: {
  title: string;
  secondary?: string;
  theme: "ice" | "fire";
  framed?: boolean | "tile";
  /** Assembly: 0 = parts apart (left from x-, top from y-, front dim), 1 = assembled. */
  parts?: number;
}) {
  const f = cubeWordsFor(title, secondary);
  const k = parts ?? 1;
  const style = {
    "--iv-left-x": px(-320 * (1 - k)),
    "--iv-top-y": px(-320 * (1 - k)),
    "--iv-side-o": String(clamp(k * 1.4)),
    "--iv-front-o": String(lerp(0.4, 1, k)),
  } as Style;
  return (
    <div className="iv-cube" style={style}>
      <CubeLogo front={f.front} left={f.left} top={f.top} theme={theme} framed={framed} title="" />
    </div>
  );
}

/* ---------- Small square-cut icons (2 px stroke, no round terminals: BRAND 7) ---------- */

function Icon({ d, size = 20, fill = false }: { d: string; size?: number; fill?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="iv-icon">
      <path d={d} fill={fill ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2} strokeLinecap="square" strokeLinejoin="miter" />
    </svg>
  );
}
const ICON = {
  prev: "M19 5 9 12l10 7V5ZM5 5v14",
  next: "M5 5l10 7-10 7V5ZM19 5v14",
  pause: "M7 5h3v14H7zM14 5h3v14h-3z",
  volume: "M4 9h4l5-4v14l-5-4H4V9ZM16.5 9a4 4 0 0 1 0 6M19 6.5a7.5 7.5 0 0 1 0 11",
  focus: "M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7",
  close: "M6 6l12 12M18 6 6 18",
  arrow: "M5 12h14M13 6l6 6-6 6",
};

/* ---------- Worlds: base, corner light, grain (BRAND 5.6, 5.7) ---------- */

function World({ theme, light, children, style }: { theme: "ember" | "sky"; light: number; children?: React.ReactNode; style?: Style }) {
  return (
    <div className="iv-world" data-theme={theme} style={style}>
      <div className="iv-light" style={{ opacity: light }} />
      <div className="iv-grain" />
      {children}
    </div>
  );
}

/* ---------- Scene 1: hero (home) ---------- */

function Hero({ t }: { t: number }) {
  const [s0, s1] = SCENES.hero;
  const out = 1 - ramp(t, s1 - 0.5, 0.5);
  const cube = ramp(t, s0 + 0.45, 1.4);
  const lean = lerp(-14, -5, ramp(t, s0 + 0.5, 1.6));
  return (
    <div className="iv-scene" style={{ opacity: out }}>
      <div className="iv-hero-poster" style={{ opacity: ramp(t, s0 + 0.35, 0.6), transform: `perspective(1600px) rotateY(${lean}deg)` }}>
        <Cube title="Corner Room" theme="fire" parts={cube} />
      </div>
      <div className="iv-hero-copy">
        <p className="cr-eyebrow iv-eyebrow-lg text-lamp" style={arrive(ramp(t, s0 + 1.5, 0.7))}>
          {C.eyebrow.text}
        </p>
        <h1 className="cr-display cr-misregister iv-hero-title">
          <span style={arrive(ramp(t, s0 + 1.9, 0.8), 70)}>{C.motto[0].text}</span>
          <span style={arrive(ramp(t, s0 + 2.08, 0.8), 70)}>{C.motto[1].text}</span>
        </h1>
        <p lang="bn" className="iv-bangla" style={arrive(ramp(t, s0 + 2.9, 0.8))}>
          {C.mottoBangla.text}
        </p>
      </div>
    </div>
  );
}

/* ---------- Scene 2: events ---------- */

function SectionHead({ t, at, number, eyebrow, title, lede, width = 820 }: { t: number; at: number; number: string; eyebrow: string; title: string; lede: string; width?: number }) {
  return (
    <div className="iv-head" style={{ width }}>
      <p className="iv-kicker" style={arrive(ramp(t, at, 0.6))}>
        <span className="cr-num iv-kicker-num">{number}</span>
        <span className="cr-eyebrow iv-eyebrow-lg">{eyebrow}</span>
      </p>
      <h2 className="cr-display cr-misregister iv-section-title" style={arrive(ramp(t, at + 0.15, 0.75), 70)}>
        {title}
      </h2>
      <p className="iv-lede" style={arrive(ramp(t, at + 0.45, 0.7))}>
        {lede}
      </p>
    </div>
  );
}

function Events({ t }: { t: number }) {
  const [s0, s1] = SCENES.events;
  const vis = window01(t, s0, s1 - 0.5, 0.45);
  return (
    <div className="iv-scene" style={{ opacity: vis }}>
      <div className="iv-events-head">
        <SectionHead t={t} at={s0 + 0.2} number={C.events.number.text} eyebrow={C.events.eyebrow.text} title={C.events.title.text} lede={C.events.lede.text} />
      </div>
      <div className="iv-events-cards">
        {INTRO_EVENTS.map((e, i) => {
          const k = ramp(t, s0 + 0.9 + i * 0.16, 0.85);
          const tilt = lerp(10, 0, k);
          return (
            <article key={e.title} className="iv-event cr-cut cr-glass-card" style={arrive(k, 120, `perspective(1400px) rotateY(${-tilt}deg)`)}>
              <Cube title={e.title} secondary={e.secondary} theme="fire" />
              <div className="iv-event-cap">
                <span className="cr-eyebrow">Live show</span>
                <span className="iv-event-title">{e.title}</span>
                {e.secondary !== e.title ? <span className="iv-event-sub">{e.secondary}</span> : null}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- Scene 3: Ember to Sky hand-over (home rule D1: the lights never overlap) ---------- */

function Handover({ t }: { t: number }) {
  const [s0] = SCENES.handover;
  const k = ramp(t, s0 + 0.2, 1.4, (x) => x);
  const band = lerp(-60, 160, easeInOut(k));
  const vis = window01(t, s0 + 0.1, s0 + 1.4, 0.4);
  return <div className="iv-band" style={{ opacity: vis * 0.9, backgroundPosition: `${band}% 50%` }} />;
}

/* ---------- Scene 4: the listening room ---------- */

/**
 * Stretched covers for the room's backdrop, made the way the room makes them
 * (components/music/listening-room.tsx): the cover SVG drawn into a 40 px canvas with a 2 px blur,
 * then stretched across the screen, so the stretch is the blur. Drawn once per track.
 */
const BACKDROP_PX = 40;

function useStretchedCovers() {
  const source = React.useRef<HTMLDivElement>(null);
  const [urls, setUrls] = React.useState<Record<string, string>>({});
  React.useEffect(() => {
    const box = source.current;
    if (!box) return;
    let alive = true;
    const svgs = Array.from(box.querySelectorAll<SVGSVGElement>("svg"));
    Promise.all(
      svgs.map(
        (svg) =>
          new Promise<[string, string]>((resolve) => {
            const key = svg.closest<HTMLElement>("[data-cover]")?.dataset.cover ?? "";
            const canvas = document.createElement("canvas");
            canvas.width = BACKDROP_PX;
            canvas.height = BACKDROP_PX;
            const ctx = canvas.getContext("2d");
            const img = new Image();
            img.onload = () => {
              if (ctx) {
                ctx.filter = "blur(2px)";
                ctx.drawImage(img, -3, -3, BACKDROP_PX + 6, BACKDROP_PX + 6);
              }
              resolve([key, canvas.toDataURL("image/png")]);
            };
            img.onerror = () => resolve([key, ""]);
            img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
          }),
      ),
    ).then((pairs) => {
      if (alive) setUrls(Object.fromEntries(pairs));
    });
    return () => {
      alive = false;
    };
  }, []);
  const sources = (
    <div ref={source} aria-hidden="true" className="iv-lr-sources">
      {INTRO_TRACKS.map((track) => (
        <div key={track.title} data-cover={track.title}>
          <Cube title={track.title} secondary={track.artist} theme="ice" />
        </div>
      ))}
    </div>
  );
  return { urls, ready: Object.keys(urls).length === INTRO_TRACKS.length, sources };
}

const CoversContext = React.createContext<Record<string, string>>({});

function Backdrop({ t }: { t: number }) {
  const urls = React.useContext(CoversContext);
  const d = drift(t);
  const playing = roomPlaying(t);
  const since = roomTitleSince(t);
  // A new track's cover fades in over the old one (BACKDROP_FADE_MS 1400).
  const fresh = since > SCENES.room[0] + 0.5 ? ramp(t, since, 1.4, easeRoom) : ramp(t, SCENES.room[0], 1.4, easeRoom);
  const layers: { track: IntroTrack; o: number }[] = [];
  if (fresh < 1 && since > SCENES.room[0] + 0.5) layers.push({ track: INTRO_TRACKS[playing - 1], o: 0.92 });
  layers.push({ track: INTRO_TRACKS[playing], o: 0.92 * fresh });
  return (
    <div className="iv-lr-backdrop" aria-hidden="true">
      <div className="iv-lr-drift" style={{ transform: `translate(${d.x}%, ${d.y}%) rotate(${d.r}deg) scale(${d.s})` }}>
        {layers.map(({ track, o }) =>
          urls[track.title] ? (
            // eslint-disable-next-line @next/next/no-img-element -- a 40 px canvas snapshot, stretched on purpose
            <img key={track.title} src={urls[track.title]} alt="" className="iv-lr-stretch" style={{ opacity: o }} />
          ) : null,
        )}
      </div>
      <div className="iv-lr-scrim" />
    </div>
  );
}

function Eq({ t }: { t: number }) {
  return (
    <span className="iv-eq" aria-hidden="true">
      {[0, -0.3, -0.6].map((delay) => (
        <i key={delay} style={{ transform: `scaleY(${lerp(0.3, 1, alternate(t, 0.9, easeRoom, -delay))})` }} />
      ))}
    </span>
  );
}

/** The scrubber: elapsed time, and "--:--" for the length (the film has no real audio to measure). */
function Scrub({ t, wide = false }: { t: number; wide?: boolean }) {
  const pos = Math.max(0, t - roomTitleSince(t));
  const pct = clamp(pos / 180) * 100;
  return (
    <div className={wide ? "iv-scrub iv-scrub-wide" : "iv-scrub"}>
      <span className="cr-num">{clock(pos)}</span>
      <span className="iv-range">
        <span className="iv-range-fill" style={{ width: `${pct}%` }} />
        <span className="iv-range-thumb" style={{ left: `${pct}%` }} />
      </span>
      <span className="cr-num">{durationLabel(null)}</span>
    </div>
  );
}

function Transport({ large = false }: { large?: boolean }) {
  const s = large ? 26 : 22;
  return (
    <div className="iv-transport">
      <span className="iv-tool">
        <Icon d={ICON.prev} size={s} />
      </span>
      <span className={large ? "iv-key iv-key-lg cr-cut cr-cut-sm" : "iv-key cr-cut cr-cut-sm"}>
        <Icon d={ICON.pause} size={s} fill />
      </span>
      <span className="iv-tool">
        <Icon d={ICON.next} size={s} />
      </span>
    </div>
  );
}

function Carousel({ t }: { t: number }) {
  const idx = roomIndex(t);
  const card = 380;
  const front = Math.round(idx);
  return (
    <div className="iv-lr-stage" style={{ height: card * 1.3 }}>
      <div className="iv-lr-breathe" style={breathe(t, card)} />
      {INTRO_TRACKS.map((track, q) => {
        const offset = q - idx;
        if (Math.abs(offset) > 3) return null;
        const p = slotPose(offset);
        const isFront = q === front && Math.abs(offset) < 0.5;
        const fl = isFront ? float(t - SCENES.room[0], 7) * (1 - Math.abs(offset) * 2) : 0;
        return (
          <div
            key={track.title}
            className="iv-lr-slot"
            style={{
              width: card,
              marginLeft: -card / 2,
              zIndex: 10 - Math.round(Math.abs(offset)),
              opacity: p.o,
              transform: `translate3d(${card * p.tx}px, ${fl}px, ${p.tz}px) rotateY(${p.ry}deg) scale(${p.s})`,
            }}
          >
            <div className="iv-lr-card cr-cut cr-glass-card">
              <span className="iv-lr-cover">
                <Cube title={track.title} secondary={track.artist} theme="ice" />
              </span>
              <span className="iv-lr-caption">
                <span className="iv-lr-cap-title">{track.title}</span>
                <span className="iv-lr-cap-artist">{track.artist}</span>
              </span>
              <span className="iv-lr-dim" style={{ opacity: p.dim }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** lr-breathe: 5.5 s alternate, opacity 0.55 -> 1, scale 0.92 -> 1.06, while music plays. */
function breathe(t: number, card: number): Style {
  const k = alternate(t, 5.5);
  return {
    width: card * 1.9,
    height: card * 1.5,
    opacity: lerp(0.55, 1, k),
    transform: `translate(-50%, -50%) scale(${lerp(0.92, 1.06, k)})`,
  };
}

/** lr-rise: the playing title rises 16 px in 720 ms on every change of track. */
function rise(t: number): Style {
  const k = ramp(t, roomTitleSince(t), 0.72, easeRoom);
  return { opacity: k, transform: `translateY(${lerp(16, 0, k)}px)` };
}

function RoomHeading({ t, large = false }: { t: number; large?: boolean }) {
  const i = roomPlaying(t);
  const track = INTRO_TRACKS[i];
  return (
    <>
      <p className="cr-eyebrow iv-lr-eyebrow">{`From Your music · Track ${i + 1} of ${INTRO_TRACKS.length}`}</p>
      <h3 key={track.title} className={large ? "cr-display iv-lr-title iv-lr-title-lg" : "cr-display iv-lr-title"} style={rise(t)}>
        {track.title}
      </h3>
      <p className={large ? "iv-lr-artist iv-lr-artist-lg" : "iv-lr-artist"}>{track.artist}</p>
    </>
  );
}

function ControlBar({ t }: { t: number }) {
  const track = INTRO_TRACKS[roomPlaying(t)];
  return (
    <div className="iv-lr-bar cr-cut cr-glass-card">
      <Transport />
      <div className="iv-lr-now">
        <span className="iv-lr-now-cube">
          <CubeLogo {...cubeWordsFor(track.title, track.artist)} theme="ice" variant="front" framed={false} title="" />
        </span>
        <div className="iv-lr-now-main">
          <div className="iv-lr-now-row">
            <span className="iv-lr-now-title">{track.title}</span>
            <span className="iv-lr-status">
              <Eq t={t} /> Playing
            </span>
          </div>
          <Scrub t={t} />
        </div>
      </div>
      <div className="iv-lr-tools">
        <span className="iv-tool">
          <Icon d={ICON.volume} />
        </span>
        <span className="iv-vol">
          <span style={{ width: "72%" }} />
        </span>
        <span className="iv-tool">
          <Icon d={ICON.focus} />
        </span>
      </div>
    </div>
  );
}

function FocusView({ t }: { t: number }) {
  const enter = ramp(t, ROOM_FOCUS_AT, 0.62, easeRoom);
  const art = ramp(t, ROOM_FOCUS_AT, 0.76, easeRoom);
  const i = roomPlaying(t);
  const track = INTRO_TRACKS[i];
  const next = INTRO_TRACKS[i + 1];
  const peek = ramp(t, ROOM_PEEK_AT, 0.56, easeRoom);
  const haloK = alternate(t, 5.5);
  return (
    <div className="iv-lr-focus" style={{ opacity: enter, transform: `scale(${lerp(0.96, 1, enter)})` }}>
      <div className="iv-lr-focus-cover" style={{ transform: `translateY(${float(t - ROOM_FOCUS_AT, 8)}px)` }}>
        <div className="iv-lr-halo" style={{ opacity: lerp(0.55, 1, haloK), transform: `scale(${lerp(0.92, 1.06, haloK)})` }} />
        <div className="iv-lr-focus-art" style={{ opacity: art, transform: `scale(${lerp(0.93, 1, art)})` }}>
          <Cube title={track.title} secondary={track.artist} theme="ice" />
        </div>
      </div>
      <div className="iv-lr-focus-info">
        <RoomHeading t={Math.max(t, roomTitleSince(t) + 1)} large />
        <div className="iv-lr-console cr-cut cr-glass-card">
          <span className="iv-lr-status">
            <Eq t={t} /> Playing
          </span>
          <div className="iv-lr-console-row">
            <Transport large />
            <div className="iv-lr-tools">
              <span className="iv-tool">
                <Icon d={ICON.volume} />
              </span>
              <span className="iv-vol">
                <span style={{ width: "72%" }} />
              </span>
            </div>
          </div>
          <Scrub t={t} wide />
        </div>
      </div>
      {next ? (
        <div
          className="iv-lr-peek cr-cut cr-glass-card"
          style={{
            opacity: peek,
            transform: `translate3d(${lerp(135, 0, peek)}%, -50%, 0) perspective(900px) rotateY(${lerp(-40, -14, peek)}deg)`,
          }}
        >
          <span className="iv-lr-cover">
            <Cube title={next.title} secondary={next.artist} theme="ice" />
          </span>
          <span className="iv-lr-caption iv-lr-caption-left">
            <span className="iv-lr-peek-label">Next</span>
            <span className="iv-lr-cap-title">{next.title}</span>
          </span>
        </div>
      ) : null}
    </div>
  );
}

function Room({ t }: { t: number }) {
  const [s0, s1] = SCENES.room;
  const vis = window01(t, s0, s1 - 0.5, 0.6, easeRoom);
  const enter = ramp(t, s0, 0.62, easeRoom);
  const carouselOut = 1 - ramp(t, ROOM_FOCUS_AT - 0.1, 0.35, easeRoom);
  const caption = window01(t, s0 + 0.9, ROOM_FOCUS_AT - 0.5, 0.6);
  return (
    <div className="iv-scene iv-lr" style={{ opacity: vis }}>
      <Backdrop t={t} />
      <div className="iv-lr-top" style={{ opacity: enter }}>
        <div className="iv-lr-brand">
          {/* eslint-disable-next-line @next/next/no-img-element -- official logo file, never redrawn */}
          <img src="/brand/logo/corner-room-logo-indigo.svg" alt="" width={67} height={56} />
          <span className="cr-eyebrow">{C.listen.eyebrow.text}</span>
        </div>
        <span className="iv-lr-chip cr-cut cr-cut-sm">
          <Icon d={ICON.close} size={18} />
        </span>
      </div>

      <div className="iv-lr-side" style={{ opacity: caption }}>
        <p className="iv-kicker" style={arrive(ramp(t, s0 + 0.9, 0.6))}>
          <span className="cr-num iv-kicker-num">{C.listen.number.text}</span>
          <span className="cr-eyebrow iv-eyebrow-lg">{C.listen.eyebrow.text}</span>
        </p>
        <h2 className="cr-display cr-misregister iv-lr-side-title" style={arrive(ramp(t, s0 + 1.05, 0.7), 60)}>
          {C.listen.title.text}
        </h2>
        <p className="iv-lr-side-lede" style={arrive(ramp(t, s0 + 1.35, 0.7))}>
          {C.listen.lede.text}
        </p>
      </div>

      {carouselOut > 0 ? (
        <div className="iv-lr-view" style={{ opacity: carouselOut * enter, transform: `scale(${lerp(0.96, 1, enter)})` }}>
          <Carousel t={t} />
          <div className="iv-lr-heading">
            <RoomHeading t={t} />
          </div>
          <ControlBar t={t} />
        </div>
      ) : null}
      {t >= ROOM_FOCUS_AT ? <FocusView t={t} /> : null}
    </div>
  );
}

/* ---------- Scene 5: yours (library, playlists, history) ---------- */

function Yours({ t }: { t: number }) {
  const [s0] = SCENES.yours;
  const vis = ramp(t, s0, 0.5);
  const cards = [C.yours.library, C.yours.playlists, C.yours.history];
  return (
    <div className="iv-scene" style={{ opacity: vis }}>
      <p className="cr-display-line iv-yours-head" style={arrive(ramp(t, s0 + 0.2, 0.7))}>
        {C.yours.headline.text}
      </p>
      <div className="iv-yours-cards">
        {cards.map((c, i) => {
          const k = ramp(t, s0 + 0.55 + i * 0.12, 0.8);
          return (
            <article key={c.title.text} className="iv-yours-card cr-cut cr-glass-card" style={arrive(k, 90)}>
              <span className="cr-eyebrow iv-lr-eyebrow">{C.listen.eyebrow.text}</span>
              <h3 className="cr-display iv-yours-title">{c.title.text}</h3>
              <p className="iv-yours-lede">{c.lede.text}</p>
            </article>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- Scene 6: store, then the end card ---------- */

function Store({ t }: { t: number }) {
  const [s0, s1] = SCENES.store;
  const vis = 1 - ramp(t, s1 - 0.4, 0.45);
  return (
    <div className="iv-scene" style={{ opacity: vis }}>
      <div className="iv-store cr-cut cr-glass-card" style={arrive(ramp(t, s0 + 0.35, 0.8), 80)}>
        <SectionHead t={t} at={s0 + 0.5} number={C.store.number.text} eyebrow={C.store.eyebrow.text} title={C.store.title.text} lede={C.store.lede.text} width={1380} />
      </div>
    </div>
  );
}

function End({ t }: { t: number }) {
  const [s0] = SCENES.end;
  const vis = ramp(t, s0, 0.5);
  return (
    <div className="iv-scene" style={{ opacity: vis }}>
      <div className="iv-end-cube" style={{ opacity: ramp(t, s0 + 0.05, 0.5) }}>
        <Cube title="Corner Room" theme="fire" framed={false} parts={ramp(t, s0 + 0.05, 0.9)} />
      </div>
      <div className="iv-end-copy">
        <h2 className="cr-display cr-misregister iv-end-title">
          <span style={arrive(ramp(t, s0 + 0.35, 0.7), 60)}>{C.motto[0].text}</span>
          <span style={arrive(ramp(t, s0 + 0.5, 0.7), 60)}>{C.motto[1].text}</span>
        </h2>
        <p className="cr-display-line iv-end-mission" style={arrive(ramp(t, s0 + 0.9, 0.7))}>
          {C.store.mission.text}
        </p>
        <div className="iv-end-ctas" style={arrive(ramp(t, s0 + 1.25, 0.7))}>
          <span className="iv-btn iv-btn-primary cr-cut">
            {C.cta.primary.text} <Icon d={ICON.arrow} size={22} />
          </span>
          <span className="iv-btn iv-btn-secondary cr-cut cr-glass-card">{C.cta.secondary.text}</span>
        </div>
        <p className="iv-end-artists" style={{ opacity: ramp(t, s0 + 1.6, 0.6) }}>
          {C.cta.artists.text}
        </p>
      </div>
    </div>
  );
}

/* ---------- The frame ---------- */

export function IntroFrame({ t }: { t: number }) {
  const time = clamp(t, 0, DURATION_S);
  // Ember light: rises from the corner, stays still, fades to Night before the Sky rises (D1).
  const emberA = Math.min(ramp(time, 0, 1.4), 1 - ramp(time, SCENES.handover[0] + 0.05, 0.75, (x) => x));
  const skyIn = ramp(time, SCENES.handover[0] + 1.0, 1.0, (x) => x);
  // Store: the Ember world returns across a hard seam with a 1 px Sky hairline (BRAND 5.6).
  const seam = ramp(time, SCENES.store[0], 0.75, easeRoom);
  const seamX = seam * WIDTH;
  return (
    <div className="iv-stage" style={{ width: WIDTH, height: HEIGHT }}>
      {time < SCENES.handover[1] ? (
        <World theme="ember" light={emberA}>
          {time < SCENES.hero[1] ? <Hero t={time} /> : null}
          {time >= SCENES.events[0] && time < SCENES.events[1] ? <Events t={time} /> : null}
        </World>
      ) : null}
      {time >= SCENES.handover[0] && time < SCENES.handover[1] ? <Handover t={time} /> : null}
      {time >= SCENES.handover[0] + 1.0 && seam < 1 ? (
        <World theme="sky" light={1} style={{ opacity: skyIn }}>
          {time >= SCENES.room[0] && time < SCENES.room[1] ? <Room t={time} /> : null}
          {time >= SCENES.yours[0] ? <Yours t={time} /> : null}
        </World>
      ) : null}
      {seam > 0 ? (
        <>
          <World theme="ember" light={1} style={{ clipPath: `inset(0 ${WIDTH - seamX}px 0 0)` }}>
            {time < SCENES.end[0] + 0.5 ? <Store t={time} /> : null}
            {time >= SCENES.end[0] ? <End t={time} /> : null}
          </World>
          {seam < 1 ? <div className="iv-seam" style={{ left: seamX }} /> : null}
        </>
      ) : null}
    </div>
  );
}

/* ---------- Player: preview controls, and the seek hook the renderer drives ---------- */

declare global {
  interface Window {
    __crIntro?: { seek: (t: number) => Promise<void>; duration: number; fps: number };
  }
}

export function IntroVideoPlayer({ render = false, start = 0 }: { render?: boolean; start?: number }) {
  const covers = useStretchedCovers();
  const ready = React.useRef(false);
  React.useEffect(() => {
    ready.current = covers.ready;
  }, [covers.ready]);
  const [t, setT] = React.useState(start);
  const [playing, setPlaying] = React.useState(!render);
  const raf = React.useRef(0);
  const box = React.useRef<HTMLDivElement>(null);
  const [scale, setScale] = React.useState(1);

  React.useEffect(() => {
    window.__crIntro = {
      duration: DURATION_S,
      fps: 30,
      seek: (to: number) =>
        new Promise<void>((resolve) => {
          setPlaying(false);
          setT(to);
          // Resolve after the frame has painted, and only once the room's covers exist.
          const settle = () => (ready.current ? requestAnimationFrame(() => requestAnimationFrame(() => resolve())) : setTimeout(settle, 30));
          settle();
        }),
    };
    return () => {
      delete window.__crIntro;
    };
  }, []);

  React.useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setT((v) => (v + dt >= DURATION_S ? 0 : v + dt));
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [playing]);

  React.useEffect(() => {
    if (render) return;
    const fit = () => {
      const w = box.current?.clientWidth ?? WIDTH;
      setScale(Math.min(1, w / WIDTH));
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [render]);

  if (render) {
    return (
      <CoversContext.Provider value={covers.urls}>
        <IntroFrame t={t} />
        {covers.sources}
      </CoversContext.Provider>
    );
  }

  return (
    <CoversContext.Provider value={covers.urls}>
    {covers.sources}
    <div className="iv-preview">
      <div ref={box} className="iv-preview-frame" style={{ height: HEIGHT * scale }}>
        <div style={{ transform: `scale(${scale})`, transformOrigin: "0 0", width: WIDTH, height: HEIGHT }}>
          <IntroFrame t={t} />
        </div>
      </div>
      <div className="iv-preview-controls">
        <button type="button" className="cr-focus" onClick={() => setPlaying((p) => !p)}>
          {playing ? "Pause" : "Play"}
        </button>
        <input
          type="range"
          min={0}
          max={DURATION_S}
          step={1 / 30}
          value={t}
          aria-label="Time"
          onChange={(e) => {
            setPlaying(false);
            setT(Number(e.target.value));
          }}
        />
        <span className="cr-num">{t.toFixed(2)} s</span>
      </div>
    </div>
    </CoversContext.Provider>
  );
}
