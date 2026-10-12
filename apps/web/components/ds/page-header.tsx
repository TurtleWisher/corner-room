import * as React from "react";

import { Display, Eyebrow } from "@/components/brand/display";
import { cn } from "@/lib/utils";

export interface PageHeaderProps {
  title: string;
  eyebrow?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  /** "display": Sikat poster heading for brand surfaces; "plain": UI heading for staff and dense pages. */
  variant?: "display" | "plain";
  className?: string;
}

export function PageHeader({ title, eyebrow, description, actions, variant = "display", className }: PageHeaderProps) {
  return (
    <header className={cn("flex flex-wrap items-end justify-between gap-x-8 gap-y-4", className)}>
      <div className="min-w-0 max-w-3xl">
        {eyebrow ? <Eyebrow className="mb-3">{eyebrow}</Eyebrow> : null}
        {variant === "display" ? (
          <Display as="h1" size="md">
            {title}
          </Display>
        ) : (
          <h1 className="font-ui text-2xl font-extrabold tracking-tight text-fg">{title}</h1>
        )}
        {description ? <div className="mt-3 max-w-prose text-sm text-fg-muted">{description}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}
