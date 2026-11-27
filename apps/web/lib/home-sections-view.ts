/*
 * Words for the longer home page (owner, 2026-11-15). Every line states something the product
 * already does (CLAUDE.md "Content rules"): no numbers, no testimonials, no promises about refunds,
 * payment methods or delivery. Headlines here are PROVISIONAL with the tagline (D-P16-07, LB-02).
 */

export type Face = { key: "live" | "listen" | "own"; index: string; title: string; body: string; points: string[]; href: string; link: string };

/** The three sides of the room: what a visitor can do here today. */
export const FACES: readonly Face[] = [
  {
    key: "live",
    index: "A",
    title: "The live room",
    body: "Shows and their tickets in one place.",
    points: ["See what's on and when, in the show's own time", "Your tickets stay with your account", "A code for the door on the night"],
    href: "/events",
    link: "See what's on",
  },
  {
    key: "listen",
    index: "B",
    title: "The listening room",
    body: "A full screen for one song at a time.",
    points: ["Lyrics that move with the singing", "Hear a free preview before you buy", "The music keeps playing as you move around"],
    href: "/listen",
    link: "Start listening",
  },
  {
    key: "own",
    index: "C",
    title: "Your shelf",
    body: "Music you pay for once and keep.",
    points: ["Buy a song or a whole release", "Save what you own to play offline", "Find it all in your library"],
    href: "/store",
    link: "Visit the Store",
  },
];

export type Step = { title: string; body: string };

/** From first hearing a song to owning it. */
export const LISTEN_STEPS: readonly Step[] = [
  { title: "Hear it first", body: "Play a song's preview free, as often as you like. No account needed." },
  { title: "Buy it once", body: "Pay for the song or its release. No subscription." },
  { title: "Play it in the room", body: "Open the listening room for the cover, the lyrics and nothing else in the way." },
  { title: "Keep it close", body: "Save it to play offline, or share a moment of it as a story." },
];

/** What the Artist Studio gives an act, each a tool that exists there now. */
export const ARTIST_POINTS: readonly Step[] = [
  { title: "Your price", body: "Propose a price for each song and release, or let fans choose what to pay from an amount you set." },
  { title: "Pre-sales", body: "Open pre-orders before release day and watch them come in." },
  { title: "Previews", body: "Cut a free preview from your own master, right in the browser." },
  { title: "Your buyers", body: "Thank them, email them and send gifts, with every email checked before it goes." },
];

export type Question = { q: string; a: string; link?: { href: string; label: string } };

export const QUESTIONS: readonly Question[] = [
  {
    q: "Do I need an account to listen?",
    a: "Not for previews: anyone can play them. You need an account to buy music and tickets, so they stay with you.",
    link: { href: "/register", label: "Create an account" },
  },
  {
    q: "What do I get when I buy a song?",
    a: "The full song in your library, to play here whenever you like and to save for offline listening. Buying a release gives you every song on it.",
    link: { href: "/store", label: "Visit the Store" },
  },
  {
    q: "Is there a subscription?",
    a: "No. Music is sold per song and per release, and you pay once.",
  },
  {
    q: "What if I need a refund?",
    a: "The refund page explains when and how.",
    link: { href: "/refunds", label: "Read the refund page" },
  },
  {
    q: "I make music. How do I release it here?",
    a: "Apply as an artist. Once approved you get the Artist Studio, where you upload, price and release your music.",
    link: { href: "/artists/apply", label: "Apply as an artist" },
  },
];

/**
 * How far the page is from the Ember world (0) to the Sky world (1), from where the hand-over zone
 * sits in the window. It starts as the zone's top comes up past 90% of the window's height and is
 * complete when its bottom has risen to 35%. Pure, so the scroll handler only measures and sets.
 */
export function worldProgress(zoneTop: number, zoneBottom: number, windowHeight: number): number {
  if (!(windowHeight > 0)) return 0;
  const start = windowHeight * 0.9;
  const end = windowHeight * 0.35;
  const travelled = start - zoneTop;
  const distance = start - end + (zoneBottom - zoneTop);
  if (!(distance > 0)) return travelled > 0 ? 1 : 0;
  return Math.min(1, Math.max(0, travelled / distance));
}

/** Ember's light is gone before Sky's arrives (brand D1): the two never overlap. */
export function worldLayers(progress: number): { veil: number; sky: number } {
  const p = Math.min(1, Math.max(0, progress));
  return { veil: Math.min(1, p * 2), sky: Math.max(0, p * 2 - 1) };
}

/**
 * The hand-over as a dithered curtain (owner, 2026-11-28, D-WORLD-02): where WebGL draws it, the Sky
 * night rises over the Ember room pixel by pixel instead of fading as one sheet. Every pixel is fully
 * Ember or fully Sky night, never a mix (brand D1: no purple between). `curtain` is how far it has
 * risen (0 to 1, drawn while between); once it has covered the window, the plain veil takes over at
 * full (`veil` jumps to 1 at the exact moment the curtain is whole, so the hand-off can't show).
 */
export function worldCurtain(progress: number): { curtain: number; drawing: boolean; veil: number; sky: number } {
  const { veil, sky } = worldLayers(progress);
  const whole = veil >= 1;
  return { curtain: veil, drawing: veil > 0 && !whole, veil: whole ? 1 : 0, sky };
}

/**
 * Where the curtain's rising edge stands for `curtain` (0 to 1), in the shader's field units: it
 * starts below the window and ends above it, with room for the dithered band (`band`) at both ends,
 * so the first and last frames are wholly Ember and wholly night.
 */
export function curtainEdge(curtain: number, band = 0.22): number {
  const c = Math.min(1, Math.max(0, curtain));
  return -band + c * (1 + 2 * band);
}
