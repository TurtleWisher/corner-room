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

/** Seconds each line has the floor: the song between intro and outro, shared by the lines. */
export function lyricStepSeconds(count: number, durationS: number): number {
  if (count <= 0 || !(durationS > 0)) return 4;
  return (durationS * (1 - INTRO - OUTRO)) / count;
}

/**
 * How many lines old line `index` is at `positionS`, as a smooth number: 0 as its singing starts,
 * 1 as the next line's starts, negative before. NaN while the length is unknown.
 */
export function lyricAgeAt(index: number, count: number, positionS: number, durationS: number): number {
  if (count <= 0 || !(durationS > 0) || !Number.isFinite(positionS)) return Number.NaN;
  const step = lyricStepSeconds(count, durationS);
  return (positionS - durationS * INTRO - index * step) / step;
}

/**
 * A line's age: 1 arriving, 0 the line now, -1 drifting away, -2 gone (faded out, so it can
 * leave the page unseen).
 */
export type LyricAge = 1 | 0 | -1 | -2;
export type FloatingLine = { key: number; text: string; age: LyricAge };

const AGES: readonly LyricAge[] = [-2, -1, 0, 1];

/** The lines in the air: two leaving, the line now, and the next one arriving. */
export function floatingLines(lines: string[], index: number): FloatingLine[] {
  const out: FloatingLine[] = [];
  for (const age of AGES) {
    const i = index + age;
    if (i >= 0 && i < lines.length) out.push({ key: i, text: lines[i], age });
  }
  return out;
}

/*
 * The lyric ring (owner, 2026-11-01, D-LYRICS-02). Each line travels a ring around the playing
 * cover: it comes out from behind the cover, is sung in front of it, then either swings across
 * the front and round behind the far side, or drifts on towards the listener and fades.
 *
 * Lines and the cover always face the listener, so their planes are parallel and never cut
 * through each other. A line changes between behind and in front only at the ring's sides, where
 * the ring is wide enough (cover, half the line and a gap) to clear the cover's edge, so it never
 * pops through the art. The browser's depth sorting does the rest.
 */

/** "around": a flat ring about the vertical axis (wide rooms). "over": up and over the cover's
 * top edge (phones and the focus view, where the sides belong to other things). */
export type RingAxis = "around" | "over";

/** Sizes in pixels: the cover (width and height), and the line's own box. */
export type RingSize = { cover: number; coverHeight: number; lineWidth: number; lineHeight: number };

/** Depth plane: what the line is near, for blur, contrast and whether it can be pointed at. */
export type RingPlane = "front" | "side" | "back";

/** A line's centre relative to the cover's centre (pixels, y down, z towards the listener). */
export type RingPose = { x: number; y: number; z: number; opacity: number; plane: RingPlane };

/** Room between the cover's edge and the nearest end of a line as it passes the side. */
export const RING_GAP = 28;

const LANES = [-0.32, 0.1, -0.16, 0.26, -0.24, 0.04];

/** A line's ring: which side it comes from, its height, and how it leaves. Fixed per line. */
export function ringPath(index: number): { dir: 1 | -1; lane: number; exit: "behind" | "forward" } {
  const n = Math.max(0, Math.floor(index));
  return {
    // Three lines in a row come round the same way, so a leaving line never meets the next one.
    dir: Math.floor(n / 3) % 2 === 0 ? 1 : -1,
    lane: LANES[n % LANES.length],
    exit: n % 3 === 2 ? "forward" : "behind",
  };
}

/** Piecewise-linear lookup in sorted [at, value] keys, held flat beyond the ends. */
function along(keys: ReadonlyArray<readonly [number, number]>, at: number): number {
  if (at <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [a1, v1] = keys[i];
    if (at <= a1) {
      const [a0, v0] = keys[i - 1];
      return v0 + ((v1 - v0) * (at - a0)) / (a1 - a0);
    }
  }
  return keys[keys.length - 1][1];
}

// The angle round the ring by age (a line is `age` lines old: 0 as its singing starts, 1 as the
// next one starts). Slow while it is sung, quicker coming and going.
const ARRIVE: ReadonlyArray<readonly [number, number]> = [
  [-1, 150],
  [0, 50],
  [1, 22],
];
const LEAVE_BEHIND: ReadonlyArray<readonly [number, number]> = [
  [1, 22],
  [2, -150],
];
const LEAVE_OVER: ReadonlyArray<readonly [number, number]> = [
  [1, 22],
  [2, 160],
];
const FADE: ReadonlyArray<readonly [number, number]> = [
  [-1, 0],
  [-0.55, 0.5],
  [0, 0.96],
  [1, 0.96],
  [1.5, 0.5],
  [2, 0],
];

/** Where line `index` is when it is `age` lines old. */
export function ringPose(index: number, age: number, axis: RingAxis, size: RingSize): RingPose {
  const { dir, lane, exit } = ringPath(index);
  const leaving = age > 1;
  const turn =
    !leaving || exit === "forward"
      ? along(ARRIVE, Math.min(age, 1))
      : along(axis === "around" ? LEAVE_BEHIND : LEAVE_OVER, age);
  const rad = (turn * Math.PI) / 180;
  const depth = Math.min(280, Math.max(170, size.cover * 0.75));
  // Leaving forwards: on past the front of the ring, towards the listener.
  const forward = leaving && exit === "forward" ? (age - 1) * 340 : 0;
  const z = depth * Math.cos(rad) + forward;
  let x: number;
  let y: number;
  if (axis === "around") {
    const reach = size.cover / 2 + size.lineWidth / 2 + RING_GAP;
    x = dir * reach * Math.sin(rad);
    y = lane * size.cover;
  } else {
    const reach = size.coverHeight / 2 + size.lineHeight / 2 + RING_GAP * 0.7;
    x = dir * size.cover * 0.05;
    y = -reach * Math.sin(rad);
  }
  const plane: RingPlane = z > depth * 0.25 ? "front" : z < -depth * 0.25 ? "back" : "side";
  return { x, y, z, opacity: along(FADE, age), plane };
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
