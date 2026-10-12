import * as React from "react";

import { cn } from "@/lib/utils";

const SIZES = {
  xl: "text-[clamp(3.5rem,9vw,8.5rem)]",
  lg: "text-[clamp(3rem,6vw,5.5rem)]",
  md: "text-[clamp(2.25rem,4vw,3.25rem)]",
  sm: "text-[2rem]",
} as const;

type DisplayProps = {
  as?: "h1" | "h2" | "h3" | "p" | "span";
  size?: keyof typeof SIZES;
  /** Misregistered print shadow. Defaults on for xl and lg only (48 px and up). */
  misregister?: boolean;
} & React.HTMLAttributes<HTMLElement>;

/**
 * Sikat display words. Words only: never numerals (slashed zero), never body copy.
 * Bangla text inherits Anek Bangla through the font stack; pass lang="bn" on Bangla runs.
 */
export function Display({ as = "h2", size = "md", misregister, className, ...props }: DisplayProps) {
  const Tag = as;
  const shadow = misregister ?? (size === "xl" || size === "lg");
  return <Tag className={cn("cr-display text-fg", SIZES[size], shadow && "cr-misregister", className)} {...props} />;
}

/** Micro-label above a heading: "DHAKA · AFTER HOURS". */
export function Eyebrow({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("cr-eyebrow text-highlight", className)} {...props} />;
}
