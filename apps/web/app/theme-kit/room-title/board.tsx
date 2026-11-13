"use client";

/* Developer board for the listening room's title (D-VERSION-01). SAMPLE CONTENT: titles of every
 * length, with and without a version, in the carousel heading and the focus view's column. */

import { RoomTitle } from "@/components/music/listening-room";

const SAMPLES: { title: string; version: string | null }[] = [
  { title: "Night Bus", version: null },
  { title: "Meghe Dhaka Dhrubotara", version: "Acoustic Demo" },
  { title: "Sample Song With A Rather Long Title Indeed", version: "Live At The Old Theatre" },
  { title: "মেঘে ঢাকা ধ্রুবতারা", version: "অ্যাকুস্টিক" },
];

export function RoomTitleBoard() {
  return (
    <div data-module="music">
      <div data-theme="sky" className="cr-scope grid gap-12 bg-surface px-4 py-10">
        <section className="grid gap-8">
          <h2 className="font-mono text-xs text-fg-muted">Carousel heading (.lr-heading)</h2>
          {SAMPLES.map((s, i) => (
            <div key={`c${i}`} className="flex justify-center">
              <div className="lr-heading">
                <RoomTitle track={{ id: `c${i}`, title: s.title, artist: "Sample Artist" }} version={s.version} className="mt-3 text-[2.25rem] leading-[0.95] md:text-[3rem]" />
              </div>
            </div>
          ))}
        </section>
        <section className="grid gap-8">
          <h2 className="font-mono text-xs text-fg-muted">Focus view column (.lr-focus-info)</h2>
          {SAMPLES.map((s, i) => (
            <div key={`f${i}`} className="lr-focus-info">
              <RoomTitle track={{ id: `f${i}`, title: s.title, artist: "Sample Artist" }} version={s.version} className="mt-4 text-[2.5rem] leading-[0.92] md:text-[4rem]" />
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
