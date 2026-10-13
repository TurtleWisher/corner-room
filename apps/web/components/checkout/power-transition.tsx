"use client";

import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

/** Total length of the full motion; the overlay hands over when it ends (or on Continue/Escape). */
export const POWER_TRANSITION_MS = 2600;
/** Reduced motion: a still confirmation, handed over quickly. */
export const POWER_TRANSITION_REDUCED_MS = 1200;

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/**
 * The success moment after a purchase. It only plays when the parent passes `confirmed`, which
 * the parent sets from the server's order (lib/checkout-view `shouldCelebrate`). The animation
 * never changes any state of its own: it shows, then calls `onDone`.
 *
 * Motion: a thin current enters from the lit top-left corner along the 117° depth axis, charges a
 * ring at the centre, one soft pulse, then the check and the message. Transform, opacity and
 * stroke only. No flash, no strobe, no percentages.
 */
export function PowerTransition({
  confirmed,
  title,
  detail,
  onDone,
}: {
  confirmed: boolean;
  title: string;
  detail?: string;
  onDone: () => void;
}) {
  const continueRef = useRef<HTMLButtonElement>(null);
  const done = useRef(false);
  const finish = useRef(onDone);
  finish.current = onDone;

  useEffect(() => {
    if (!confirmed) return;
    done.current = false;
    const end = () => {
      if (done.current) return;
      done.current = true;
      finish.current();
    };
    const timer = window.setTimeout(end, prefersReducedMotion() ? POWER_TRANSITION_REDUCED_MS : POWER_TRANSITION_MS);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && end();
    window.addEventListener("keydown", onKey);
    continueRef.current?.focus({ preventScroll: true });
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", onKey);
    };
  }, [confirmed]);

  if (!confirmed) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="power-title"
      aria-describedby={detail ? "power-detail" : undefined}
      data-testid="power-transition"
      className="cr-power fixed inset-0 z-50 grid place-items-center"
      onClick={() => {
        if (!done.current) {
          done.current = true;
          finish.current();
        }
      }}
    >
      <svg aria-hidden="true" className="cr-power-art absolute inset-0 size-full" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice">
        <defs>
          <radialGradient id="cr-power-halo">
            <stop offset="0%" stopColor="var(--cr-accent)" stopOpacity="0.35" />
            <stop offset="60%" stopColor="var(--cr-accent)" stopOpacity="0.06" />
            <stop offset="100%" stopColor="var(--cr-accent)" stopOpacity="0" />
          </radialGradient>
        </defs>
        {/* The current: a faint trail and a brighter head, both entering from the corner. */}
        <path className="cr-power-trail" d="M -60 -60 C 320 160, 560 330, 800 450" pathLength={1} />
        <path className="cr-power-head" d="M -60 -60 C 320 160, 560 330, 800 450" pathLength={1} />
        <circle className="cr-power-halo" cx="800" cy="450" r="220" fill="url(#cr-power-halo)" />
        <circle className="cr-power-ring-base" cx="800" cy="450" r="64" />
        <circle className="cr-power-ring" cx="800" cy="450" r="64" pathLength={1} transform="rotate(-90 800 450)" />
        <circle className="cr-power-pulse" cx="800" cy="450" r="64" />
        <path className="cr-power-check" d="M 772 452 L 792 472 L 830 432" pathLength={1} />
      </svg>
      <div className="cr-power-copy relative mt-[15rem] max-w-md px-6 text-center">
        <p id="power-title" className="text-2xl font-bold text-fg md:text-3xl">
          {title}
        </p>
        {detail ? (
          <p id="power-detail" className="mt-2 text-fg">
            {detail}
          </p>
        ) : null}
        <button
          ref={continueRef}
          type="button"
          className={cn("cr-focus mt-6 text-sm font-semibold text-highlight underline underline-offset-4")}
          onClick={(e) => {
            e.stopPropagation();
            if (!done.current) {
              done.current = true;
              finish.current();
            }
          }}
        >
          Continue
        </button>
      </div>
    </div>
  );
}
