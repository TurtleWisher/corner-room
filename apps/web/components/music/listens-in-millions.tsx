"use client";

import * as React from "react";

import { counterPlaces, inMillions } from "@/lib/millions-view";

/**
 * The song's listens in millions, very large behind the song page (owner, 2026-11-02): 753
 * listens reads 0.000753. Each digit is a strip of 0 to 9 that rolls up into place once, places
 * to the right turning more, like a counter running up; transform only, so nothing re-lays out.
 * Under reduced motion it simply shows the number. Decoration only: the exact count stays in the
 * words beside the cover. Styles: `.lm-*` in `app/styles/modules/music.css`.
 */
export function ListensInMillions({ listens }: { listens: number }) {
  const text = inMillions(listens);
  const [rolled, setRolled] = React.useState(false);

  React.useEffect(() => {
    setRolled(false);
    // Two frames so the strips are drawn at 0 before they roll.
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setRolled(true));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [text]);

  let digit = 0;
  return (
    <div aria-hidden="true" className="lm-backdrop">
      <div className="lm-frame">
        <div className="lm-figure" data-rolled={rolled || undefined}>
          <span className="lm-number">
            {counterPlaces(text).map((place, i) => {
              if (place.kind === "point") {
                return (
                  <span key={i} className="lm-point">
                    .
                  </span>
                );
              }
              const stop = place.turns * 10 + place.value;
              const order = digit++;
              return (
                <span key={i} className="lm-place">
                  <span
                    className="lm-strip"
                    style={{ "--stop": stop, "--turns": place.turns, "--order": order } as React.CSSProperties}
                  >
                    {Array.from({ length: stop + 1 }, (_, n) => (
                      <span key={n}>{n % 10}</span>
                    ))}
                  </span>
                </span>
              );
            })}
          </span>
          <span className="lm-unit">Million listens</span>
        </div>
      </div>
    </div>
  );
}
