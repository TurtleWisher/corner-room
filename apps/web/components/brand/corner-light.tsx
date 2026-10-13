import * as React from "react";

import { PointerLightLayer } from "@/components/brand/pointer-light";
import { cn } from "@/lib/utils";
import type { ThemeName } from "@/lib/theme/palette";

/**
 * The Corner Light layer: gradient pools from the top-left corner with the grain inside the
 * gradient only (BRAND_GUIDELINE 5.6 and 5.7). Decorative, never focusable, never z-indexed.
 */
export function CornerLight({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("cr-light", className)} />;
}

type LitSurfaceProps<T extends React.ElementType> = {
  as?: T;
  theme?: ThemeName;
  /** Turn the light off for dense surfaces (tables, long reading); the theme still applies. */
  light?: boolean;
  contentClassName?: string;
} & Omit<React.ComponentPropsWithoutRef<T>, "as">;

/**
 * A themed region lit from the corner. Sets data-theme, paints the base and puts content in a
 * positioned layer above the light.
 */
export function LitSurface<T extends React.ElementType = "section">({
  as,
  theme = "ember",
  light = true,
  className,
  contentClassName,
  children,
  ...rest
}: LitSurfaceProps<T>) {
  const Tag = (as ?? "section") as React.ElementType;
  return (
    <Tag data-theme={theme} className={cn("cr-scope relative overflow-hidden", className)} {...rest}>
      {light ? <CornerLight /> : null}
      {/* The pointer light and the grain above it (v1.4); hidden when nested in the same world. */}
      {light ? <PointerLightLayer /> : null}
      <div className={cn("relative", contentClassName)}>{children}</div>
    </Tag>
  );
}
