/*
 * Every word the intro video shows, with the page it was read from (localhost:3000, 2026-10-14).
 * Nothing here is written for the video: copy is lifted from the live site so the film never
 * claims more than the product does. No prices, counts, testimonials or press (BRAND 3.5).
 *
 * The tagline and the mission line are PROVISIONAL on the site (D-P16-07, OD-30, LB-02).
 * Re-render the video when they change.
 */

export type Sourced = { text: string; source: string };

const s = (text: string, source: string): Sourced => ({ text, source });

export const INTRO_COPY = {
  eyebrow: s("Events · Music · Store", "/"),
  motto: [s("The city's corner.", "/"), s("The music's room.", "/")] as const,
  mottoBangla: s("শহরের কোণে, গানের ঘরে", "/"),

  events: {
    number: s("01", "/"),
    eyebrow: s("Events", "/discover"),
    title: s("What's on", "/discover"),
    lede: s("Live shows from Corner Room. Times are shown in each event's own city.", "/discover"),
  },

  listen: {
    number: s("02", "/"),
    eyebrow: s("Listening room", "/listen"),
    title: s("Listen", "/listen"),
    lede: s("Play what you own. Buy a track to keep it, or unlock everything with a plan.", "/listen"),
  },

  yours: {
    headline: s("Your tickets, library and playlists in one place", "/"),
    library: { title: s("Library", "/library"), lede: s("Everything you bought or saved.", "/library") },
    playlists: { title: s("Playlists", "/playlists"), lede: s("Your own running orders.", "/playlists") },
    history: { title: s("History", "/history"), lede: s("What you listened to, newest first.", "/history") },
  },

  store: {
    number: s("03", "/"),
    eyebrow: s("Corner Room Store", "/"),
    title: s("Music to keep", "/store"),
    lede: s("Subscribe to listen across the catalog, or buy music to keep.", "/store"),
    mission: s("Find the music you love. Help the artists who make it.", "/"),
  },

  cta: {
    primary: s("Create an account", "/ (signed-out band) and /register"),
    secondary: s("Start listening", "/"),
    artists: s("Are you an artist? Apply", "/artists"),
  },
} as const;

/*
 * Titles shown on cubes and cards. Read from the local API (GET /api/v1/tracks, /events,
 * /artists, /bands) on 2026-10-14. This is the seeded DEMO catalog: swap these for the launch
 * catalog before the video is published anywhere. Only titles and credits are used: no dates,
 * prices or statuses, so nothing in the film goes stale or overstates.
 */
export type IntroTrack = { title: string; artist: string };

export const INTRO_TRACKS: readonly IntroTrack[] = [
  { title: "First Rain", artist: "Rumi" },
  { title: "Dry Season", artist: "Rumi" },
  { title: "Tin Roof", artist: "Rumi" },
  { title: "Wet Asphalt", artist: "Rumi" },
  { title: "Sodium Light (Live)", artist: "Kaal Bela" },
  { title: "Farmgate (Live)", artist: "Kaal Bela" },
];

export const INTRO_EVENTS: readonly { title: string; secondary: string; place: string }[] = [
  { title: "Night Bus", secondary: "Kaal Bela", place: "Dhaka time" },
  { title: "Low Tide", secondary: "Low Tide", place: "Dhaka time" },
];
