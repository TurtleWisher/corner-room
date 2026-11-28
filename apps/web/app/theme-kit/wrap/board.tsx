"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { WrapStory } from "@/components/wrap/wrap-story";
import type { MyWrap, WrapCardKey, WrapLook } from "@/features/wraps/api";

const CARDS: WrapCardKey[] = ["INTRO", "MINUTES", "TOP_SONG", "TOP_SONGS", "TOP_ACTS", "FAN_RANK", "CLOCK", "MONTHS", "STREAK", "DISCOVERY", "COLLECTION", "EVENTS", "GIFTS", "SUMMARY"];

function sample(look: WrapLook, card: WrapCardKey | null): MyWrap {
  const songs = ["Sample song one", "A much longer sample song title", "Sample song three", "Sample song four", "Sample song five"];
  return {
    season: {
      id: "sample",
      name: "Corner Room Wrap 2026",
      starts_on: "2026-01-01",
      ends_on: "2026-12-31",
      year: 2026,
      opens_at: null,
      closes_at: null,
      fan_state: "OPEN",
      tagline: "Your 2026 in Corner Room",
      intro: "Step right up. This is what you played, bought and lived on Corner Room.",
      outro: "Thank you for listening. See you in the next one.",
      look,
      dither: { style: "BAYER", cell: 3, motion: "LIVELY" },
      slide_seconds: 7,
      sharing: { on: true, show_name: true, show_link: true },
    },
    preview: false,
    person: { name: "Sample Listener", first_name: "Sample" },
    enough: true,
    min_listens: 1,
    cards: (card ? [card] : CARDS).map((key) => ({ key, title: null })),
    stats: {
      period: { starts_on: "2026-01-01", ends_on: "2026-12-31" },
      listens: 812,
      minutes: 2436,
      songs: 64,
      acts: 18,
      top_songs: songs.map((title, i) => ({ track_id: `sample-${i}`, title, act_id: null, act: "Sample act", listens: 90 - i * 12, minutes: 270 - i * 30 })),
      top_acts: ["Sample act", "Second act", "Third act", "Fourth act", "Fifth act"].map((name, i) => ({ act_id: `sample-act-${i}`, name, kind: "SOLO" as const, picture: null, listens: 120 - i * 20, songs: 8 - i })),
      fan_rank: { act_id: "sample-act-0", act: "Sample act", rank: 3, listeners: 240, top_percent: 2 },
      hours: [3, 1, 0, 0, 0, 1, 4, 8, 10, 9, 7, 6, 8, 9, 7, 6, 9, 14, 20, 26, 31, 28, 19, 9],
      peak_hour: 20,
      day_part: "SUNDOWN",
      months: [30, 42, 51, 38, 60, 72, 66, 81, 95, 88, 102, 87].map((listens, i) => ({ month: `2026-${String(i + 1).padStart(2, "0")}`, listens })),
      streak: { days: 12, from: "2026-03-01", to: "2026-03-12" },
      busiest_day: { day: "2026-08-14", listens: 31 },
      first_song: null,
      new_songs: 23,
      new_acts: 6,
      new_act_names: ["Second act", "Third act"],
      bought: { songs: 7, releases: 2, preorders: 1, first: { kind: "TRACK", id: "sample-0", day: "2026-02-02", title: "Sample song one" } },
      events: {
        tickets: 3,
        events: 2,
        attended: 2,
        list: [
          { event_id: "sample-ev-1", title: "Sample night out", starts_at: "2026-05-10T14:00:00Z", has_poster: false, tickets: 2, attended: true },
          { event_id: "sample-ev-2", title: "Second sample show", starts_at: "2026-10-02T14:00:00Z", has_poster: false, tickets: 1, attended: true },
        ],
      },
      gifts: { given: 2, received: 1 },
      follows: 4,
    },
  };
}

function Board() {
  const q = useSearchParams();
  const look = (q.get("look")?.toUpperCase() as WrapLook) || "FAIRGROUND";
  const card = (q.get("card")?.toUpperCase() as WrapCardKey) || null;
  return <WrapStory wrap={sample(["MARQUEE", "CAROUSEL", "FAIRGROUND"].includes(look) ? look : "FAIRGROUND", card && CARDS.includes(card) ? card : null)} closeHref="/theme-kit" />;
}

export function WrapBoard() {
  return (
    <main data-module="wrap" className="wr-main">
      <Suspense>
        <Board />
      </Suspense>
    </main>
  );
}
