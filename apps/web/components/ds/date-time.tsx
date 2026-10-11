import * as React from "react";

import { dateBlock, formatDate, formatDateTime, formatTime, resolveTimeZone, type DateTimeOptions } from "@/lib/format/date";
import { cn } from "@/lib/utils";

import { UnavailableValue } from "./states";

export interface DateTimeProps extends DateTimeOptions {
  value: string | Date | null | undefined;
  format?: "date" | "time" | "datetime";
  /** Append the zone label ("Dhaka time"). Always on when the zone fell back to UTC. */
  showZone?: boolean;
  className?: string;
}

/** Event times render in the event's own timezone (Q-P4-09), inside a machine-readable <time>. */
export function DateTime({ value, format = "datetime", showZone, className, ...opts }: DateTimeProps) {
  const text = format === "date" ? formatDate(value, opts) : format === "time" ? formatTime(value, opts) : formatDateTime(value, opts);
  if (!text || !value) return <UnavailableValue className={className} />;
  const zone = resolveTimeZone(opts.timeZone);
  const iso = new Date(value).toISOString();
  return (
    <time dateTime={iso} className={className}>
      {text}
      {format !== "date" && (showZone || zone.fallback) ? <span className="text-fg-muted">{` · ${zone.label}`}</span> : null}
    </time>
  );
}

/** The large date block on event cards: 17 / OCT. Numerals in condensed Archivo, never Sikat. */
export function DateBlock({ value, timeZone, className }: { value: string | Date | null | undefined; timeZone?: string | null; className?: string }) {
  const b = dateBlock(value, { timeZone });
  if (!b) return <UnavailableValue className={className} />;
  return (
    <time dateTime={b.iso} className={cn("inline-flex flex-col items-start leading-none", className)}>
      <span className="cr-num text-[2.5rem] text-highlight">{b.day}</span>
      <span className="cr-num mt-1 text-sm text-fg">{b.month}</span>
      <span className="sr-only">{`${b.weekday} ${b.day} ${b.month} ${b.year}`}</span>
    </time>
  );
}
