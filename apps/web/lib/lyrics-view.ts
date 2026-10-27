/*
 * Song lyrics (owner, 2026-10-27, D-LYRICS-01). Plain text from the API, one sung line per line
 * and an empty line between verses. Lyrics carry no timings, so the listening room paces the
 * floating lines across the song: an estimate, never presented as synced.
 */

/** Sung lines, verse breaks dropped. */
export function lyricLines(text?: string | null): string[] {
  return (text ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Verses (runs of lines between empty lines), for reading on the song page. */
export function lyricVerses(text?: string | null): string[][] {
  return (text ?? "")
    .split(/\n\s*\n/)
    .map((verse) => lyricLines(verse))
    .filter((verse) => verse.length > 0);
}

/** Share of the song before the first and after the last line (intro and outro). */
const INTRO = 0.06;
const OUTRO = 0.06;

/**
 * The line to float now: lines spread evenly over the song between a short intro and outro.
 * -1 before the first line, or while the length is unknown.
 */
export function lyricIndexAt(count: number, positionS: number, durationS: number): number {
  if (count <= 0 || !(durationS > 0) || !Number.isFinite(positionS)) return -1;
  const start = durationS * INTRO;
  const span = durationS * (1 - INTRO - OUTRO);
  if (positionS < start) return -1;
  return Math.min(count - 1, Math.floor(((positionS - start) / span) * count));
}

export type FloatingLine = { key: number; text: string; age: -1 | 0 | 1 };

/** The line leaving, the line now, and the next one arriving. */
export function floatingLines(lines: string[], index: number): FloatingLine[] {
  const out: FloatingLine[] = [];
  for (const age of [-1, 0, 1] as const) {
    const i = index + age;
    if (i >= 0 && i < lines.length) out.push({ key: i, text: lines[i], age });
  }
  return out;
}

/**
 * Where a line floats, in the room's open spaces (percent of the room), and how it drifts. Fixed
 * per line number so a line never jumps while it is shown, and neighbours land apart.
 */
// Side margins only, above the control bar: the middle belongs to the covers and the title.
const SLOTS: ReadonlyArray<readonly [number, number]> = [
  [4, 14],
  [72, 22],
  [6, 42],
  [74, 50],
  [3, 66],
  [70, 70],
  [8, 28],
  [76, 36],
];

export type FloatSlot = { x: number; y: number; dx: number; dy: number; tilt: number; seconds: number };

export function floatSlot(index: number): FloatSlot {
  const n = Math.max(0, Math.floor(index));
  const [x, y] = SLOTS[n % SLOTS.length];
  const sway = ((n * 37) % 11) - 5; // -5..5
  return {
    x,
    y,
    dx: sway * 2,
    dy: -10 - ((n * 13) % 9) * 2,
    tilt: sway / 6,
    seconds: 16 + ((n * 7) % 9),
  };
}

export type LyricsMode = "draft" | "review" | "locked";

/**
 * How Studio edits a song's lyrics: straight away while it is a draft, through staff review once
 * approved or out, and not at all while the release is being reviewed.
 */
export function lyricsMode(trackStatus: string, releaseEditable: boolean): LyricsMode {
  if (releaseEditable && trackStatus === "DRAFT") return "draft";
  if (trackStatus === "APPROVED" || trackStatus === "SCHEDULED" || trackStatus === "RELEASED") return "review";
  return "locked";
}
