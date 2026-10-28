"use client";

import { MicVocal } from "lucide-react";

import { FoldOut } from "@/components/music/fold-out";
import { lyricVerses } from "@/lib/lyrics-view";

/**
 * A released song's lyrics on its page (owner, 2026-10-27, D-LYRICS-01), folded until opened.
 * Owner, 2026-10-28: right under the cover, above the credits. Nothing is drawn without lyrics.
 */
export function SongLyrics({ lyrics, className }: { lyrics?: string | null; className?: string }) {
  const verses = lyricVerses(lyrics);
  if (verses.length === 0) return null;
  return (
    <FoldOut title="Lyrics" icon={MicVocal} className={className}>
      <div className="grid gap-5 text-base leading-relaxed text-fg">
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
    </FoldOut>
  );
}
