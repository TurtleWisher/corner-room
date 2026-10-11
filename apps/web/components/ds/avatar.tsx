import * as React from "react";

import { cn } from "@/lib/utils";

/** "Kaal Bela" -> "KB". Bengali names keep their first grapheme. */
export function monogram(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  const first = (w: string) => Array.from(w)[0] ?? "";
  const letters = words.length === 1 ? Array.from(words[0]).slice(0, 2).join("") : first(words[0]) + first(words[words.length - 1]);
  return letters.toUpperCase();
}

/**
 * Portrait when the API can serve one (OD-05), otherwise a monogram on the brand field.
 * Square with the cut corner: the brand has no circles.
 */
export function Avatar({ name, src, size = 40, className }: { name: string; src?: string | null; size?: number; className?: string }) {
  const style = { width: size, height: size, fontSize: Math.round(size * 0.38) };
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element -- remote media host not decided (OD-05)
    return <img src={src} alt={name} width={size} height={size} className={cn("object-cover", className)} style={style} />;
  }
  return (
    <span
      role="img"
      aria-label={name}
      className={cn("cr-cut cr-cut-sm inline-grid shrink-0 place-items-center font-ui font-extrabold text-on-brand [--cut-fill:var(--cr-brand)]", className)}
      style={style}
    >
      <span aria-hidden="true" className="[font-stretch:62%]">
        {monogram(name)}
      </span>
    </span>
  );
}
