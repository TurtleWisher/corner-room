"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * The official cover when there is one (OD-05, owner 2026-10-23), the letter cube otherwise. The
 * cube is drawn first and keeps the space; the image covers it once it has loaded, and if there is
 * no cover (404) or it fails, the cube simply stays. Artwork is shown as uploaded: never tinted.
 */
export function CoverArt({
  src,
  fallback,
  alt = "",
  className,
}: {
  /** From lib/cover-view; null when it is known there is no cover. */
  src: string | null;
  /** The letter cube for this release or track. */
  fallback: React.ReactNode;
  /** Empty when the title is already written next to the cover. */
  alt?: string;
  className?: string;
}) {
  const [state, setState] = React.useState<"loading" | "loaded" | "failed">("loading");
  const img = React.useRef<HTMLImageElement>(null);

  React.useEffect(() => {
    setState("loading");
    // A cached image can finish before React attaches onLoad.
    const el = img.current;
    if (el?.complete) setState(el.naturalWidth > 0 ? "loaded" : "failed");
  }, [src]);

  const loaded = src !== null && state === "loaded";
  return (
    <div className={cn("relative", className)}>
      <div className={cn("contents", loaded && "invisible")}>{fallback}</div>
      {src !== null && state !== "failed" ? (
        // eslint-disable-next-line @next/next/no-img-element -- cover images come from the API, not static assets
        <img
          ref={img}
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          onLoad={() => setState("loaded")}
          onError={() => setState("failed")}
          className={cn("absolute inset-0 size-full object-cover", loaded ? "opacity-100" : "opacity-0")}
        />
      ) : null}
    </div>
  );
}
