import * as React from "react";

import { cn } from "@/lib/utils";

type CardProps = React.HTMLAttributes<HTMLDivElement> & {
  /** raised and glass: frosted glass panel (v1.2, the default). solid: opaque panel for overlays
   *  that sit on busy content. outline: border only. */
  tone?: "raised" | "glass" | "solid" | "outline" | "brand";
  /** Cut the top-left corner (default on). */
  cut?: boolean;
  as?: "div" | "article" | "section" | "li";
};

const TONES = {
  raised: "cr-glass-card",
  glass: "cr-glass-card",
  solid: "[--cut-fill:var(--cr-surface-raised)] [--cut-border:var(--cr-line)]",
  outline: "[--cut-fill:transparent] [--cut-border:var(--cr-line-strong)]",
  brand: "text-on-brand [--cut-fill:var(--cr-brand)] [--cut-border:var(--cr-brand)]",
} as const;

export function Card({ tone = "raised", cut = true, as = "div", className, ...props }: CardProps) {
  const Tag = as as React.ElementType;
  if (!cut) {
    const flat = {
      raised: "cr-glass",
      glass: "cr-glass",
      solid: "bg-surface-raised border border-line",
      outline: "border border-line-strong",
      brand: "bg-brand text-on-brand",
    }[tone];
    return <Tag className={cn("p-5", flat, className)} {...props} />;
  }
  return <Tag className={cn("cr-cut p-5", TONES[tone], className)} {...props} />;
}
