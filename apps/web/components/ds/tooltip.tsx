"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Supplementary text on hover and focus. Dismissable with Escape (WCAG 1.4.13). Never put
 * essential information only in a tooltip.
 */
export function Tooltip({
  content,
  children,
  side = "top",
}: {
  content: React.ReactNode;
  children: React.ReactElement<{ "aria-describedby"?: string }>;
  side?: "top" | "bottom";
}) {
  const id = React.useId();
  const [open, setOpen] = React.useState(false);
  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onKeyDown={(e) => {
        if (e.key === "Escape") setOpen(false);
      }}
    >
      {React.cloneElement(children, { "aria-describedby": id })}
      <span
        id={id}
        role="tooltip"
        className={cn(
          "pointer-events-none absolute left-1/2 z-40 w-max max-w-64 -translate-x-1/2 border border-line-strong bg-surface-raised px-2.5 py-1.5",
          "font-ui text-xs text-fg shadow-[0_8px_24px_rgb(0_0_0/0.4)] transition-opacity duration-[var(--cr-dur-micro)]",
          side === "top" ? "bottom-full mb-2" : "top-full mt-2",
          open ? "opacity-100" : "opacity-0",
        )}
      >
        {content}
      </span>
    </span>
  );
}
