"use client";

/*
 * Small pieces shared by Customers and users, a person's page and Commerce (owner, 2026-11-27,
 * D-CUSTOMERS-03). Styles in app/styles/modules/staff-customers.css; every tone also has a word.
 */

import * as React from "react";
import { Check, Copy } from "lucide-react";

import { monogram } from "@/components/ds/avatar";
import type { StatusTone } from "@/lib/format/status";
import { cn } from "@/lib/utils";

/** A stable colour for a person's square, from their key (no meaning, only to tell rows apart). */
function hue(seed: string): number {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 6;
}

export function PersonMark({ name, seed, size }: { name: string; seed: string; size?: string }) {
  return (
    <span
      className="cx-avatar cr-cut"
      data-hue={hue(seed) || undefined}
      style={size ? ({ "--cx-av": size } as React.CSSProperties) : undefined}
      aria-hidden="true"
    >
      {monogram(name) || "?"}
    </span>
  );
}

/** A dot and a word; the word carries the meaning. */
export function TonePill({ tone, children, className }: { tone: StatusTone; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("cx-pill cr-cut", className)} data-tone={tone}>
      <span className="cx-dot" data-tone={tone} aria-hidden="true" />
      {children}
    </span>
  );
}

export function LiveDot({ label = "Active in the last 30 minutes" }: { label?: string }) {
  return (
    <span className="cx-dot cx-live" role="img" aria-label={label} title={label} />
  );
}

/** A raised tile with a number. As a button it filters the list and shows pressed. */
export function StatTile({
  label,
  value,
  hint,
  tone,
  pressed,
  onPress,
  style,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: StatusTone;
  pressed?: boolean;
  onPress?: () => void;
  style?: React.CSSProperties;
}) {
  const body = (
    <>
      <span className="cx-tile-label">
        {tone ? <span className="cx-dot" data-tone={tone} aria-hidden="true" /> : null}
        {label}
      </span>
      <span className="cx-tile-value">{value}</span>
      {hint ? <span className="cx-tile-hint">{hint}</span> : null}
    </>
  );
  if (onPress) {
    return (
      <button type="button" className="cx-tile cr-cut cr-focus cx-rise" aria-pressed={pressed} onClick={onPress} style={style}>
        {body}
      </button>
    );
  }
  return (
    <div className="cx-tile cr-cut cx-rise" style={style}>
      {body}
    </div>
  );
}

/** Copies a value (an email, a transaction ID) and says so for a moment. */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const [done, setDone] = React.useState(false);
  React.useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 1500);
    return () => clearTimeout(t);
  }, [done]);
  return (
    <button
      type="button"
      className="cx-copy cr-focus"
      aria-label={done ? "Copied" : label}
      title={done ? "Copied" : label}
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => setDone(true), () => undefined);
      }}
    >
      {done ? <Check aria-hidden="true" className="size-3.5" /> : <Copy aria-hidden="true" className="size-3.5" />}
    </button>
  );
}

/** "Updated just now" ticker: re-renders every 30 s so "x min ago" stays true. */
export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
