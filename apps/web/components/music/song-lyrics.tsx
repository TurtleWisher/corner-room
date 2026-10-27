"use client";

import { ChevronDown, MicVocal } from "lucide-react";

import { lyricVerses } from "@/lib/lyrics-view";

/**
 * A released song's lyrics on its page (owner, 2026-10-27, D-LYRICS-01), folded until opened so
 * the page stays short. Nothing is drawn for a song without lyrics.
 */
export function SongLyrics({ lyrics }: { lyrics?: string | null }) {
  const verses = lyricVerses(lyrics);
  if (verses.length === 0) return null;
  return (
    <details className="group mt-10 border-t border-line pt-4">
      <summary className="cr-focus flex cursor-pointer list-none items-center gap-2 text-xl font-bold text-fg [&::-webkit-details-marker]:hidden">
        <MicVocal aria-hidden="true" className="size-5 text-highlight" />
        Lyrics
        <ChevronDown aria-hidden="true" className="ml-auto size-5 text-fg-muted transition-transform group-open:rotate-180" />
      </summary>
      <div className="mt-4 grid gap-5 text-base leading-relaxed text-fg">
        {verses.map((verse, i) => (
          <p key={i}>
            {verse.map((line, j) => (
              <span key={j} className="block">
                {line}
              </span>
            ))}
          </p>
        ))}
      </div>
    </details>
  );
}
