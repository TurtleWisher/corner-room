"use client";

import { ChevronDown, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * A section folded until opened (owner, 2026-10-28: lyrics and track credit details on the song
 * page). A native <details>, so it opens with the keyboard and screen readers without script; the
 * chevron turns and the content eases in.
 */
export function FoldOut({
  title,
  icon: Icon,
  count,
  level = "section",
  className,
  children,
}: {
  title: string;
  icon?: LucideIcon;
  /** A small number beside the title, such as how many members. */
  count?: number;
  /** "section" for a main fold-out, "sub" for one nested inside another section. */
  level?: "section" | "sub";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <details className={cn("cr-fold group", level === "sub" ? "cr-fold-sub" : "", className)}>
      <summary
        className={cn(
          "cr-focus flex cursor-pointer list-none items-center gap-2 py-3 text-fg [&::-webkit-details-marker]:hidden",
          level === "sub" ? "text-sm font-semibold" : "text-base font-bold",
        )}
      >
        {Icon ? <Icon aria-hidden="true" className={cn("text-highlight", level === "sub" ? "size-4" : "size-5")} /> : null}
        <span>{title}</span>
        {typeof count === "number" ? <span className="cr-num text-sm font-semibold text-fg-muted">{count}</span> : null}
        <ChevronDown aria-hidden="true" className="ml-auto size-4 text-fg-muted transition-transform duration-200 group-open:rotate-180" />
      </summary>
      <div className="cr-fold-body pb-4">{children}</div>
    </details>
  );
}
