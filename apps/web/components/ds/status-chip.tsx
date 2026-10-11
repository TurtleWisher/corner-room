import * as React from "react";

import { resolveStatus, type StatusMap, type StatusTone } from "@/lib/format/status";
import { cn } from "@/lib/utils";

const TONE: Record<StatusTone, string> = {
  neutral: "text-fg-muted border-line-strong",
  positive: "text-success border-success/40",
  warning: "text-warning border-warning/40",
  negative: "text-danger border-danger/45",
  info: "text-info border-info/40",
  accent: "text-highlight border-highlight/40",
};

/** Shape differs by tone so meaning never relies on colour alone (paired with the label). */
const MARK: Record<StatusTone, React.ReactNode> = {
  neutral: <circle cx="5" cy="5" r="3" fill="none" stroke="currentColor" strokeWidth="1.5" />,
  positive: <path d="m2 5.2 2 2 4-4.4" fill="none" stroke="currentColor" strokeWidth="1.6" />,
  warning: <path d="M5 1.5 9 8.5H1L5 1.5Z" fill="currentColor" />,
  negative: <path d="m2.2 2.2 5.6 5.6M7.8 2.2 2.2 7.8" stroke="currentColor" strokeWidth="1.6" />,
  info: <circle cx="5" cy="5" r="3.2" fill="currentColor" />,
  accent: <rect x="1.8" y="1.8" width="6.4" height="6.4" fill="currentColor" />,
};

export function Badge({
  tone = "neutral",
  className,
  children,
}: {
  tone?: StatusTone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 border px-2 font-ui text-[0.6875rem] font-semibold tracking-[0.02em]",
        TONE[tone],
        className,
      )}
    >
      <svg viewBox="0 0 10 10" aria-hidden="true" className="size-2.5">
        {MARK[tone]}
      </svg>
      {children}
    </span>
  );
}

/** Renders whatever status string the API returns. Unknown values are humanised, never hidden. */
export function StatusChip({ value, map, className }: { value: string | null | undefined; map?: StatusMap; className?: string }) {
  const status = resolveStatus(map, value);
  if (!status) return <span className="text-sm text-fg-muted">Not available</span>;
  return (
    <Badge tone={status.tone} className={className}>
      {status.label}
    </Badge>
  );
}
