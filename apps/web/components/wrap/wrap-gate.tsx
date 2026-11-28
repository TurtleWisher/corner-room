"use client";

/* The Wrap's waiting rooms (loading, signed out, closed): the same carnival light and one glass card. */

import Link from "next/link";
import { useEffect, useRef } from "react";

import { Logo } from "@/components/brand/logo";
import { Words } from "@/components/wrap/wrap-cards";
import { createWrapDither } from "@/components/wrap/wrap-dither";

export function WrapGate({
  title,
  body,
  busy,
  children,
  world = "ember",
}: {
  title: string;
  body?: string;
  busy?: boolean;
  children?: React.ReactNode;
  world?: "ember" | "sky";
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!canvas.current) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const scene = createWrapDither(canvas.current, world, { cell: 4, style: "BAYER", speed: still ? 0 : 0.35 });
    return () => scene?.destroy();
  }, [world]);
  return (
    <div className="wr-root wr-gate" data-world={world}>
      <canvas ref={canvas} className="wr-dither" aria-hidden />
      <div className="wr-vignette" aria-hidden />
      <div className="wr-gate-inner">
        <Link href="/" className="wr-logo" aria-label="Corner Room home">
          <Logo variant={world === "sky" ? "indigo" : "ember"} height={48} alt="" />
        </Link>
        <article className="wr-card cr-cut" aria-busy={busy || undefined}>
          <span className="wr-sheen" aria-hidden />
          <p className="wr-eyebrow">
            <span>Corner Room Wrap</span>
          </p>
          <h1 className="wr-headline">
            <Words text={title} />
          </h1>
          {busy ? <span className="wr-loader" role="status" aria-label="Loading" /> : null}
          {body ? <p className="wr-lede">{body}</p> : null}
          {children ? <div className="wr-gate-actions">{children}</div> : null}
        </article>
      </div>
    </div>
  );
}
