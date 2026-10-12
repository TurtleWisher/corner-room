import * as React from "react";

import { cn } from "@/lib/utils";

type CardProps = React.HTMLAttributes<HTMLDivElement> & {
  /** raised: solid panel. glass: only over the corner light. outline: border only. */
  tone?: "raised" | "glass" | "outline" | "brand";
  /** Cut the top-left corner (default on). */
  cut?: boolean;
  as?: "div" | "article" | "section" | "li";
};

const TONES = {
  raised: "[--cut-fill:var(--cr-surface-raised)] [--cut-border:var(--cr-line)]",
  glass: "[--cut-fill:var(--cr-surface-overlay)] [--cut-border:var(--cr-line)] backdrop-blur-[14px]",
  outline: "[--cut-fill:transparent] [--cut-border:var(--cr-line-strong)]",
  brand: "text-on-brand [--cut-fill:var(--cr-brand)] [--cut-border:var(--cr-brand)]",
} as const;

export function Card({ tone = "raised", cut = true, as = "div", className, ...props }: CardProps) {
  const Tag = as as React.ElementType;
  if (!cut) {
    const flat = {
      raised: "bg-surface-raised border border-line",
      glass: "cr-glass",
      outline: "border border-line-strong",
      brand: "bg-brand text-on-brand",
    }[tone];
    return <Tag className={cn("p-5", flat, className)} {...props} />;
  }
  return <Tag className={cn("cr-cut p-5", TONES[tone], className)} {...props} />;
}
