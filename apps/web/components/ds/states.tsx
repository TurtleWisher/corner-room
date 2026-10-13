import * as React from "react";

import { UNAVAILABLE } from "@/lib/format/locale";
import { cn } from "@/lib/utils";

/**
 * The honesty layer: unknown is never 0, empty is never hidden, errors never leak internals.
 */
export function UnavailableValue({
  label = UNAVAILABLE,
  reason,
  className,
}: {
  label?: string;
  /** Short reason for screen readers and the tooltip, e.g. "Not reported by analytics". */
  reason?: string;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1 text-fg-muted", className)} title={reason}>
      <svg viewBox="0 0 10 10" aria-hidden="true" className="size-2.5">
        <path d="M1.5 5h7" stroke="currentColor" strokeWidth="1.5" />
      </svg>
      <span>{label}</span>
      {reason ? <span className="sr-only">: {reason}</span> : null}
    </span>
  );
}

export function LoadingState({ label = "Loading", className }: { label?: string; className?: string }) {
  return (
    <p role="status" aria-live="polite" className={cn("flex items-center gap-2 text-sm text-fg-muted", className)}>
      <span aria-hidden="true" className="size-2 animate-pulse bg-highlight motion-reduce:animate-none" />
      {label}…
    </p>
  );
}

export function EmptyState({
  title,
  body,
  action,
  className,
}: {
  title: string;
  body?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("cr-cut cr-glass-card flex flex-col items-start gap-3 p-6", className)}>
      <p className="font-ui text-base font-bold text-fg">{title}</p>
      {body ? <div className="max-w-prose text-sm text-fg-muted">{body}</div> : null}
      {action}
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  message,
  action,
  className,
}: {
  title?: string;
  message: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "cr-cut flex flex-col items-start gap-2 p-5 [--cut-border:color-mix(in_srgb,var(--cr-danger)_50%,transparent)] [--cut-fill:color-mix(in_srgb,var(--cr-danger-fill)_16%,rgb(13_4_4/0.55))] [--cut-blur:var(--cr-glass-blur)]",
        className,
      )}
    >
      <p className="flex items-center gap-2 font-ui text-sm font-bold text-danger">
        <svg viewBox="0 0 16 16" aria-hidden="true" className="size-4">
          <path d="M8 1.5 15 14H1L8 1.5Z" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d="M8 6v3.5M8 11.2v.6" stroke="currentColor" strokeWidth="1.6" />
        </svg>
        {title}
      </p>
      <div className="text-sm text-fg">{message}</div>
      {action}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn("block animate-pulse bg-surface-overlay motion-reduce:animate-none", className)} />;
}
