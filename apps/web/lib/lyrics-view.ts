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
 * The lyric orbit (owner, 2026-11-01): big smoke lines float in 3D around the playing cover. Each
 * line arrives from behind the cover (hidden by the art, its ends showing either side), comes out
 * in front of it to be sung, then drifts away towards the edges of the room: some nearer the
 * listener, some back behind the cover. The browser sorts the lines and the cards by real depth.
 */

/** "beside": wide rooms, lines swing far to the sides. "stack": phones and the focus view. */
export type OrbitLayout = "beside" | "stack";

/**
 * Where a line's centre is at one age. x and y are in cover widths from the cover's centre (y
 * down), z in pixels towards the listener, `turn` degrees about the vertical axis, `opacity` 0 to 1
 * and `blur` pixels of depth of field. `dissolve` is how far the words have come apart into smoke
 * (0 the words, 1 all smoke).
 */
export type OrbitPose = { x: number; y: number; z: number; turn: number; opacity: number; blur: number; dissolve: number };

type Path = "front-out" | "front-sweep" | "back-out" | "back-cross";
const PATHS: readonly Path[] = ["back-out", "front-out", "back-cross", "front-sweep"];
// Where the sung line sits, over the cover: never low enough to reach the title and the bar.
const LIFTS = [-0.38, -0.1, -0.26, 0.0, -0.18, -0.32, -0.06];

/** A line's path, side and height: fixed per line number, varied so neighbours land apart. */
export function orbitPath(index: number): { path: Path; side: 1 | -1; lift: number } {
  const n = Math.max(0, Math.floor(index));
  return {
    path: PATHS[(n * 3) % PATHS.length],
    side: (n + Math.floor(n / 3)) % 2 === 0 ? 1 : -1,
    lift: LIFTS[n % LIFTS.length],
  };
}

type Step = [x: number, y: number, z: number, turn: number, opacity: number, blur: number, dissolve: number];

// Every line: born behind the cover as gathering smoke, sung in front of it as words.
const ARRIVE: Step = [0.18, 0.06, -280, 10, 0.45, 4, 0.45];
const SUNG: Step = [0.06, 0, 110, 4, 0.95, 0, 0];

// Then, per path, two steps away (ages -1 and -2) before the side (s) and height are applied. x
// and turn are mirrored by the side; y is added to the line's height.
const LEAVE: Record<Path, [Step, Step]> = {
  // Towards the listener and out to its side, coming apart as it passes.
  "front-out": [
    [0.75, -0.3, 420, -8, 0.32, 2.5, 0.3],
    [1.4, -0.6, 760, -12, 0, 6, 1],
  ],
  // Towards the listener and across to the other side.
  "front-sweep": [
    [-0.7, 0.12, 400, 10, 0.3, 2.5, 0.3],
    [-1.3, 0.2, 720, 14, 0, 6, 1],
  ],
  // Back behind the cover on its own side, then away into the room.
  "back-out": [
    [0.5, -0.2, -420, -14, 0.35, 4, 0.3],
    [1.1, -0.45, -900, -18, 0, 7, 1],
  ],
  // Back behind the cover and out the far side.
  "back-cross": [
    [-0.35, -0.1, -380, 12, 0.35, 4, 0.3],
    [-0.9, -0.25, -860, 16, 0, 7, 1],
  ],
};

/** How far sideways the stacked layout swings, against the wide one. */
const STACK_REACH = 0.6;

/**
 * Where line `index` floats at `age`. `towards` sends every line to one side, where the other
 * side of the cover is taken (the focus view's title and console).
 */
export function orbitPose(index: number, age: LyricAge, layout: OrbitLayout, towards?: 1 | -1): OrbitPose {
  const { path, side, lift } = orbitPath(index);
  const [x, y, z, turn, opacity, blur, dissolve] =
    age === 1 ? ARRIVE : age === 0 ? SUNG : LEAVE[path][age === -1 ? 0 : 1];
  const reach = layout === "beside" ? 1 : STACK_REACH;
  // A forced side puts every pose on that side, crossing paths included.
  const across = towards ? towards * Math.abs(x) : x * side;
  return { x: across * reach, y: y + lift, z, turn: turn * (towards ?? side), opacity, blur, dissolve };
}

/** The slow sway every line has while music plays, fixed per line. */
export function lyricSway(index: number): { dx: number; dy: number; seconds: number } {
  const n = Math.max(0, Math.floor(index));
  const sway = ((n * 37) % 11) - 5; // -5..5
  return { dx: sway * 1.6, dy: -6 - ((n * 13) % 7), seconds: 7 + ((n * 7) % 6) };
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
