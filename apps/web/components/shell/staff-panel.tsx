"use client";

import { RotateCw, Wrench } from "lucide-react";

import { Button } from "@/components/ds";

import { cn } from "@/lib/utils";

/**
 * Staff tools placed on a public page (until staff management moves to its own URL, URL-04).
 * Graphite world, plain type, clearly labelled so fans never mistake it for content.
 */
export function StaffPanel({
  title = "Staff tools",
  description,
  children,
  className,
}: {
  title?: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section data-theme="staff" aria-label={title} className={cn("cr-scope border border-line-strong", className)}>
      <div className="flex items-center gap-2 border-b border-line px-5 py-3">
        <Wrench aria-hidden="true" className="size-4 text-highlight" />
        <h2 className="text-sm font-bold text-fg">{title}</h2>
        {description ? <p className="ml-auto hidden text-xs text-fg-muted sm:block">{description}</p> : null}
      </div>
      <div className="p-5 text-sm text-fg">{children}</div>
    </section>
  );
}

/** Page heading for rebuilt public pages: eyebrow, display title, optional lede. */
export function PageIntro({
  eyebrow,
  title,
  lede,
  children,
}: {
  eyebrow?: string;
  title: string;
  lede?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-6">
      <div className="max-w-3xl">
        {eyebrow ? <p className="cr-eyebrow text-highlight">{eyebrow}</p> : null}
        <h1 className="cr-display cr-misregister mt-3 text-[clamp(2.75rem,6vw,5rem)] text-fg">{title}</h1>
        {lede ? <p className="mt-3 text-base text-fg">{lede}</p> : null}
      </div>
      {children}
    </div>
  );
}

/** "Try again" for an ErrorState action. */
export function RetryButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="secondary" size="sm" onClick={onClick}>
      <RotateCw aria-hidden="true" /> Try again
    </Button>
  );
}
