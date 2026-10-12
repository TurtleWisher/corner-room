import * as React from "react";

import { cn } from "@/lib/utils";

export type LogoVariant = "ember" | "indigo" | "mono-dark" | "mono-light";

const SRC: Record<LogoVariant, string> = {
  ember: "/brand/logo/corner-room-logo-ember.svg",
  indigo: "/brand/logo/corner-room-logo-indigo.svg",
  "mono-dark": "/brand/logo/corner-room-logo-mono-dark.svg",
  "mono-light": "/brand/logo/corner-room-logo-mono-light.svg",
};

/**
 * Official logo files only (brand/logo). Never redrawn or recoloured. Ember on red or warm black,
 * indigo on sky or deep indigo, mono on neutrals. Minimum 40 px tall; below that use the tile.
 */
export function Logo({
  variant = "ember",
  height = 48,
  className,
  alt = "Corner Room",
}: {
  variant?: LogoVariant;
  height?: number;
  className?: string;
  alt?: string;
}) {
  const h = Math.max(40, height);
  const w = Math.round((h * 279) / 232);
  // eslint-disable-next-line @next/next/no-img-element -- static SVG brand asset, no optimisation needed
  return <img src={SRC[variant]} width={w} height={h} alt={alt} className={cn("block", className)} />;
}
