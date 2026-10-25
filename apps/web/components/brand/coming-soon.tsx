import * as React from "react";

import { Display } from "@/components/brand/display";
import { cn } from "@/lib/utils";

/**
 * "Coming soon" panel for the launch, when a list is honestly empty (owner, 2026-10-25): events
 * before the first one is announced, and more music beside the first release. A cut glass card in
 * the page's own world with a quiet equaliser; the bars hold still under reduced motion.
 */
export function ComingSoon({
  eyebrow,
  title,
  body,
  as = "h2",
  className,
}: {
  eyebrow: string;
  title: string;
  body: string;
  as?: "h2" | "h3" | "p";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "cr-cut cr-glass-card cr-soon relative overflow-hidden p-6 md:p-8",
        className,
      )}
    >
      <span aria-hidden="true" className="cr-soon-eq text-highlight">
        {Array.from({ length: 7 }, (_, i) => (
          <i key={i} />
        ))}
      </span>
      <p className="cr-eyebrow mt-5 text-highlight">{eyebrow}</p>
      <Display as={as} size="sm" className="mt-3 leading-[0.95]">
        {title}
      </Display>
      <p className="mt-3 max-w-md text-sm text-fg-muted md:text-base">{body}</p>
    </div>
  );
}
