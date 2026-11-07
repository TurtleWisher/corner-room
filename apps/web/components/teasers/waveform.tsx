"use client";

/*
 * The Teaser Studio waveform (owner, 2026-11-07, D-TEASER-00): peaks from the server (never decoded in
 * the browser), the chosen part lit, fades drawn as ramps, two handles that are real sliders
 * (drag, or arrow keys: 10 ms, Shift 1 s; Home and End), and the selection itself can be slid.
 * A click outside the selection moves the play point. Maths in lib/teaser-editor-view.ts.
 */

import { useEffect, useRef, useState } from "react";

import type { TeaserLimits, TeaserSettings } from "@/features/teasers/api";
import {
  barsFor,
  COARSE_STEP_MS,
  FINE_STEP_MS,
  formatTime,
  moveHandle,
  moveRegion,
  msToX,
  type Handle,
  type View,
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

function readColor(el: HTMLElement | null, name: string, fallback: string): string {
  if (!el) return fallback;
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  return v || fallback;
}

export function TeaserWaveform({ points, bucketMs, masterMs, view, settings, limits, playheadMs, onChange, onSeek, className }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const drag = useRef<{ kind: Handle | "region"; startX: number; from: TeaserSettings } | null>(null);
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

  const msAt = (clientX: number) => {
    const r = box.current?.getBoundingClientRect();
    return r ? xToMs(clientX - r.left, view, r.width) : 0;
  };

  const onPointerDown = (kind: Handle | "region") => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // preventDefault stops the browser focusing what was pressed: a pressed handle takes focus
    // itself, so the arrow keys move it straight after a click.
    if (kind !== "region") (e.currentTarget as HTMLElement).focus({ preventScroll: true });
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = { kind, startX: e.clientX, from: latest.current };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (d.kind === "region") {
      const r = box.current?.getBoundingClientRect();
      const delta = r ? xToMs(e.clientX - r.left, view, r.width) - xToMs(d.startX - r.left, view, r.width) : 0;
      onChange(moveRegion(d.from, delta, masterMs, limits), false);
    } else {
      onChange(moveHandle(latest.current, d.kind, msAt(e.clientX), masterMs, limits), false);
    }
  };

  const onPointerUp = () => {
    if (!drag.current) return;
    drag.current = null;
    onChange(latest.current, true);
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

  const pct = (ms: number) => `${Math.min(100, Math.max(0, ((ms - view.fromMs) / Math.max(1, view.toMs - view.fromMs)) * 100))}%`;
  const startVisible = settings.start_ms >= view.fromMs && settings.start_ms <= view.toMs;
  const endVisible = settings.end_ms >= view.fromMs && settings.end_ms <= view.toMs;
  const handleClass =
    "cr-focus absolute top-0 bottom-0 z-20 w-4 -translate-x-1/2 cursor-ew-resize touch-none bg-transparent outline-none before:absolute before:inset-y-0 before:left-1/2 before:w-0.5 before:-translate-x-1/2 before:bg-highlight after:absolute after:left-1/2 after:top-1/2 after:h-8 after:w-2.5 after:-translate-x-1/2 after:-translate-y-1/2 after:rounded-sm after:bg-highlight";

  return (
    <div
      ref={box}
      className={cn("relative h-40 select-none overflow-hidden border border-line bg-surface-sunken md:h-48", className)}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerDown={(e) => {
        if (e.target === box.current || e.target === canvas.current) onSeek(msAt(e.clientX));
      }}
    >
      <canvas ref={canvas} aria-hidden="true" className="absolute inset-0 size-full" />
      {/* The chosen part: drag it to slide the whole selection. */}
      <div
        aria-hidden="true"
        onPointerDown={onPointerDown("region")}
        className="absolute inset-y-0 z-10 cursor-grab border-y-2 border-highlight/60 bg-highlight/10 active:cursor-grabbing"
        style={{ left: pct(settings.start_ms), right: `calc(100% - ${pct(settings.end_ms)})` }}
      />
      {startVisible ? (
        <button
          type="button"
          role="slider"
          aria-label="Teaser start"
          aria-valuemin={0}
          aria-valuemax={masterMs}
          aria-valuenow={settings.start_ms}
          aria-valuetext={formatTime(settings.start_ms)}
          onPointerDown={onPointerDown("start")}
          onKeyDown={onKey("start")}
          className={handleClass}
          style={{ left: pct(settings.start_ms) }}
        />
      ) : null}
      {endVisible ? (
        <button
          type="button"
          role="slider"
          aria-label="Teaser end"
          aria-valuemin={0}
          aria-valuemax={masterMs}
          aria-valuenow={settings.end_ms}
          aria-valuetext={formatTime(settings.end_ms)}
          onPointerDown={onPointerDown("end")}
          onKeyDown={onKey("end")}
          className={handleClass}
          style={{ left: pct(settings.end_ms) }}
        />
      ) : null}
      {playheadMs !== null && playheadMs >= view.fromMs && playheadMs <= view.toMs ? (
        <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 z-30 w-px bg-fg" style={{ left: pct(playheadMs) }} />
      ) : null}
    </div>
  );
}
