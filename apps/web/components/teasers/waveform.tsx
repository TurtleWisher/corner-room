"use client";

/*
 * The Preview Studio waveform (owner, 2026-11-07, D-TEASER-00; finger-friendly 2026-11-08,
 * D-TEASER-06): peaks from the server (never decoded in the browser), the chosen part lit, fades drawn
 * as ramps. A press anywhere takes the nearest thing within reach (`pickTarget`): the start or end
 * edge, the play line, the chosen part (to slide it) or a new play point, with far more reach for a
 * finger than for a mouse, and the page never scrolls under a drag. A small time label rides above
 * the finger while dragging. The edges are also real sliders for the keyboard (arrow keys: 10 ms,
 * Shift 1 s; Home and End). Maths in lib/teaser-editor-view.ts.
 */

import { useEffect, useRef, useState } from "react";

import type { TeaserLimits, TeaserSettings } from "@/features/teasers/api";
import {
  barsFor,
  COARSE_STEP_MS,
  FINE_STEP_MS,
  formatTime,
  GRAB_PX,
  moveHandle,
  moveRegion,
  msToX,
  pickTarget,
  type Handle,
  type View,
  type WaveTarget,
  xToMs,
} from "@/lib/teaser-editor-view";
import { cn } from "@/lib/utils";

type Props = {
  points: readonly number[];
  bucketMs: number;
  masterMs: number;
  view: View;
  settings: TeaserSettings;
  limits: TeaserLimits;
  /** Where the preview is now, in song time; null when nothing plays. */
  playheadMs: number | null;
  /** `commit` false while dragging (no undo step yet), true when the move is finished. */
  onChange: (next: TeaserSettings, commit: boolean) => void;
  onSeek: (ms: number) => void;
  className?: string;
};

type Drag = { kind: Exclude<WaveTarget, "playhead">; startX: number; from: TeaserSettings; pointerId: number };

const CURSOR: Record<WaveTarget, string> = {
  start: "ew-resize",
  end: "ew-resize",
  playhead: "ew-resize",
  region: "grab",
  scrub: "pointer",
};

function readColor(el: HTMLElement | null, name: string, fallback: string): string {
  if (!el) return fallback;
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  return v || fallback;
}

export function TeaserWaveform({ points, bucketMs, masterMs, view, settings, limits, playheadMs, onChange, onSeek, className }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const startRef = useRef<HTMLButtonElement>(null);
  const endRef = useRef<HTMLButtonElement>(null);
  const [width, setWidth] = useState(0);
  const drag = useRef<Drag | null>(null);
  const [dragging, setDragging] = useState<Drag["kind"] | null>(null);
  /** Where a dragged play line is, until the finger lifts. */
  const [scrubMs, setScrubState] = useState<number | null>(null);
  const scrubRef = useRef<number | null>(null);
  const setScrubMs = (ms: number | null) => {
    scrubRef.current = ms;
    setScrubState(ms);
  };
  const [cursor, setCursor] = useState("pointer");
  const latest = useRef(settings);
  latest.current = settings;

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Draw the peaks: dim outside the chosen part, lit inside, scaled by the fades.
  useEffect(() => {
    const c = canvas.current;
    if (!c || width <= 0) return;
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    const height = c.clientHeight || 160;
    c.width = Math.round(width * dpr);
    c.height = Math.round(height * dpr);
    const g = c.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, width, height);
    const dim = readColor(box.current, "--cr-fg-muted", "#7a8a85");
    const lit = readColor(box.current, "--cr-highlight", "#5eead4");
    const columns = Math.max(1, Math.floor(width / 3));
    const bars = barsFor(points, bucketMs, view, columns);
    const step = width / columns;
    const mid = height / 2;
    for (let i = 0; i < bars.length; i += 1) {
      const atMs = view.fromMs + ((i + 0.5) / columns) * (view.toMs - view.fromMs);
      const inside = atMs >= settings.start_ms && atMs <= settings.end_ms;
      const h = Math.max(1, (bars[i] / 255) * (height - 8));
      g.fillStyle = inside ? lit : dim;
      g.globalAlpha = inside ? 1 : 0.45;
      g.fillRect(i * step + 0.5, mid - h / 2, Math.max(1, step - 1), h);
    }
    g.globalAlpha = 1;
    // Fade ramps over the lit part.
    const x0 = msToX(settings.start_ms, view, width);
    const x1 = msToX(settings.end_ms, view, width);
    g.strokeStyle = lit;
    g.lineWidth = 2;
    if (settings.fade_in_ms > 0) {
      g.beginPath();
      g.moveTo(x0, height - 2);
      g.lineTo(msToX(settings.start_ms + settings.fade_in_ms, view, width), 2);
      g.stroke();
    }
    if (settings.fade_out_ms > 0) {
      g.beginPath();
      g.moveTo(msToX(settings.end_ms - settings.fade_out_ms, view, width), 2);
      g.lineTo(x1, height - 2);
      g.stroke();
    }
  }, [points, bucketMs, view, settings, width]);

  const rect = () => box.current?.getBoundingClientRect() ?? null;
  const msAt = (clientX: number) => {
    const r = rect();
    return r ? Math.min(masterMs, Math.max(0, xToMs(clientX - r.left, view, r.width))) : 0;
  };
  const shownPlayhead = scrubMs ?? playheadMs;
  const targetAt = (clientX: number, pointerType: string): WaveTarget => {
    const r = rect();
    if (!r) return "scrub";
    const s = latest.current;
    return pickTarget(
      clientX - r.left,
      {
        start: msToX(s.start_ms, view, r.width),
        end: msToX(s.end_ms, view, r.width),
        playhead: playheadMs !== null ? msToX(playheadMs, view, r.width) : null,
      },
      pointerType === "mouse" ? GRAB_PX.mouse : GRAB_PX.touch,
    );
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const target = targetAt(e.clientX, e.pointerType);
    const kind: Drag["kind"] = target === "playhead" ? "scrub" : target;
    // The pressed edge takes focus, so the arrow keys move it straight after.
    if (kind === "start") startRef.current?.focus({ preventScroll: true });
    if (kind === "end") endRef.current?.focus({ preventScroll: true });
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { kind, startX: e.clientX, from: latest.current, pointerId: e.pointerId };
    setDragging(kind);
    if (kind === "scrub") setScrubMs(msAt(e.clientX));
    if (kind === "region") setCursor("grabbing");
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) {
      if (e.pointerType === "mouse") setCursor(CURSOR[targetAt(e.clientX, "mouse")]);
      return;
    }
    if (e.pointerId !== d.pointerId) return;
    if (d.kind === "region") {
      const r = rect();
      const delta = r ? xToMs(e.clientX - r.left, view, r.width) - xToMs(d.startX - r.left, view, r.width) : 0;
      onChange(moveRegion(d.from, delta, masterMs, limits), false);
    } else if (d.kind === "scrub") {
      setScrubMs(msAt(e.clientX));
    } else {
      // The edge keeps its distance from the finger, so it never jumps when taken a little to one side.
      const from = d.kind === "start" ? d.from.start_ms : d.from.end_ms;
      const r = rect();
      const delta = r ? xToMs(e.clientX - r.left, view, r.width) - xToMs(d.startX - r.left, view, r.width) : 0;
      onChange(moveHandle(latest.current, d.kind, from + delta, masterMs, limits), false);
    }
  };

  const finish = (e: React.PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    drag.current = null;
    setDragging(null);
    if (d.kind === "scrub") {
      const at = scrubRef.current;
      setScrubMs(null);
      if (!cancelled && at !== null) onSeek(at);
    } else {
      onChange(latest.current, true);
    }
    if (e.pointerType === "mouse") setCursor(CURSOR[targetAt(e.clientX, "mouse")]);
  };

  const onKey = (handle: Handle) => (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? COARSE_STEP_MS : FINE_STEP_MS;
    const at = handle === "start" ? settings.start_ms : settings.end_ms;
    let to: number | null = null;
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") to = at - step;
    else if (e.key === "ArrowRight" || e.key === "ArrowUp") to = at + step;
    else if (e.key === "PageDown") to = at - COARSE_STEP_MS * 5;
    else if (e.key === "PageUp") to = at + COARSE_STEP_MS * 5;
    else if (e.key === "Home") to = 0;
    else if (e.key === "End") to = masterMs;
    if (to === null) return;
    e.preventDefault();
    onChange(moveHandle(settings, handle, to, masterMs, limits), true);
  };

  const share = (ms: number) => Math.min(100, Math.max(0, ((ms - view.fromMs) / Math.max(1, view.toMs - view.fromMs)) * 100));
  const pct = (ms: number) => `${share(ms)}%`;
  const startVisible = settings.start_ms >= view.fromMs && settings.start_ms <= view.toMs;
  const endVisible = settings.end_ms >= view.fromMs && settings.end_ms <= view.toMs;
  const playVisible = shownPlayhead !== null && shownPlayhead >= view.fromMs && shownPlayhead <= view.toMs;

  // The time under the finger while dragging, kept inside the box.
  const bubble =
    dragging === "start"
      ? { at: settings.start_ms, text: formatTime(settings.start_ms) }
      : dragging === "end"
        ? { at: settings.end_ms, text: formatTime(settings.end_ms) }
        : dragging === "region"
          ? { at: (settings.start_ms + settings.end_ms) / 2, text: `${formatTime(settings.start_ms)} to ${formatTime(settings.end_ms)}` }
          : dragging === "scrub" && scrubMs !== null
            ? { at: scrubMs, text: formatTime(scrubMs) }
            : null;

  const edgeClass = cn(
    "ts-edge cr-focus pointer-events-none absolute inset-y-0 z-20 w-6 -translate-x-1/2 bg-transparent outline-none",
    "before:absolute before:inset-y-0 before:left-1/2 before:w-0.5 before:-translate-x-1/2 before:bg-highlight",
  );

  // The outer frame takes every press (its side room too, so an edge at the very start or end of the
  // song keeps a whole grip to hold); the inner area is the song's time line.
  return (
    <div
      data-dragging={dragging ?? undefined}
      className={cn("ts-wave relative h-40 touch-none select-none overflow-hidden border border-line bg-surface-sunken px-2.5 md:h-48", className)}
      style={{ cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => finish(e, false)}
      onPointerCancel={(e) => finish(e, true)}
      onLostPointerCapture={(e) => finish(e, false)}
    >
      <div ref={box} className="relative size-full">
        <canvas ref={canvas} aria-hidden="true" className="pointer-events-none absolute inset-0 size-full" />
        {/* The chosen part: drag it to slide the whole selection. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 z-10 border-y-2 border-highlight/60 bg-highlight/10"
          style={{ left: pct(settings.start_ms), right: `calc(100% - ${pct(settings.end_ms)})` }}
        />
        {startVisible ? (
          <button
            ref={startRef}
            type="button"
            role="slider"
            aria-label="Teaser start"
            aria-valuemin={0}
            aria-valuemax={masterMs}
            aria-valuenow={settings.start_ms}
            aria-valuetext={formatTime(settings.start_ms)}
            onKeyDown={onKey("start")}
            data-active={dragging === "start" || undefined}
            className={edgeClass}
            style={{ left: pct(settings.start_ms) }}
          >
            <span aria-hidden="true" className="ts-grip" />
          </button>
        ) : null}
        {endVisible ? (
          <button
            ref={endRef}
            type="button"
            role="slider"
            aria-label="Teaser end"
            aria-valuemin={0}
            aria-valuemax={masterMs}
            aria-valuenow={settings.end_ms}
            aria-valuetext={formatTime(settings.end_ms)}
            onKeyDown={onKey("end")}
            data-active={dragging === "end" || undefined}
            className={edgeClass}
            style={{ left: pct(settings.end_ms) }}
          >
            <span aria-hidden="true" className="ts-grip" />
          </button>
        ) : null}
        {playVisible ? (
          <div
            aria-hidden="true"
            data-active={dragging === "scrub" || undefined}
            className="ts-playline pointer-events-none absolute inset-y-0 z-30 w-px -translate-x-1/2 bg-fg"
            style={{ left: pct(shownPlayhead!) }}
          />
        ) : null}
        {bubble ? (
          <span
            aria-hidden="true"
            className="ts-bubble cr-num pointer-events-none absolute top-1.5 z-40 -translate-x-1/2 whitespace-nowrap px-2 py-0.5 text-xs font-semibold"
            style={{ left: `clamp(3rem, ${share(bubble.at)}%, calc(100% - 3rem))` }}
          >
            {bubble.text}
          </span>
        ) : null}
      </div>
    </div>
  );
}
