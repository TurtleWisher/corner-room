"use client";

import * as React from "react";

/**
 * Fades a block up once as it first scrolls into view (home M4, owner decision D3).
 *
 * Safe by default: the server renders it visible. Only after mount, and only for blocks still
 * below the fold, does it hold them back until they enter; anything already on screen stays as is.
 * Reduced motion, or no IntersectionObserver: nothing is ever hidden.
 */
export function Reveal<T extends React.ElementType = "div">({
  as,
  index = 0,
  className,
  style,
  children,
  ...rest
}: { as?: T; index?: number } & Omit<React.ComponentPropsWithoutRef<T>, "as">) {
  const ref = React.useRef<HTMLElement>(null);
  const Tag = (as ?? "div") as React.ElementType;

  React.useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight) return; // already on screen: leave it alone
    el.dataset.reveal = "pending";
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          el.dataset.reveal = "shown";
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <Tag ref={ref} className={className} style={{ ...(style as React.CSSProperties), ["--i" as string]: index }} {...rest}>
      {children}
    </Tag>
  );
}
