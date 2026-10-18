# Intro film (`components/promo/intro-video`)

A 40 second, 1920 x 1080 motion piece that introduces Corner Room. The film is built from the product's own pieces: the letter cube, the official logo files, the Ember and Sky worlds from `tokens.css`, frosted glass with the cut corner, Sikat for display words, Archivo for UI and numerals, Anek Bangla for the Bangla line. Every frame is a pure function of time, so the film renders frame-exact.

| File | Role |
| --- | --- |
| `copy.ts` | Every word on screen, each with the page it was read from. Demo catalog titles live here too. |
| `timeline.ts` | Scene times, the brand easing curves, the listening room's carousel poses and loops. Pure. |
| `timeline.test.ts` | Checks scene tiling, brand curves, carousel poses and that all copy is sourced. |
| `intro-video.tsx` | `IntroFrame` (one frame at time t) and `IntroVideoPlayer` (preview controls and the render seek hook). |
| `intro-video.css` | The film's layout at a fixed 1920 x 1080 stage. Colour, light, glass and type come from tokens. |
| `app/theme-kit/intro-video/page.tsx` | Preview page (dev only unless `CR_THEME_KIT=1`). `?t=21.5` opens on a frame, `?render=1` is the bare stage. |
| `scripts/render-intro-video.mjs` | Seeks every frame with Playwright and encodes H.264 with ffmpeg. |

## Render

```powershell
cd apps\web
$env:CR_THEME_KIT = "1"; npm run dev          # terminal 1
node scripts/render-intro-video.mjs           # terminal 2; needs ffmpeg on PATH
# -> var/promo/corner-room-intro.mp4 and corner-room-intro-poster.png
```

Options: `--url`, `--out`, `--fps`, `--from`, `--to` (seconds, to re-render one scene), `--silent`.

A full render also builds the score and writes `corner-room-intro-sound.mp4` (AAC 192 kbps, -14 LUFS, -1 dBTP).

## Sound

`scripts/build-intro-soundtrack.mjs` synthesises the score in code (`node scripts/build-intro-soundtrack.mjs` writes a 48 kHz stereo WAV). No samples, loops or third-party audio, so there is nothing to license. Its `CUES` block mirrors `timeline.ts`; move both together.

| Time (s) | Sound |
| --- | --- |
| 0 to 6.4 | D minor pad swells from silence; whooshes as the cube's faces fold in and a low impact when it locks; soft ticks as the tagline lines land; a first kick heartbeat |
| 6.4 to 13.2 | Riser into an impact, then the Ember beat at 96 BPM: kick, offbeat hats, backbeat snap, muted pluck arpeggio over Dm9, Bbmaj7, Gm9, A7sus; a whoosh and tick per event card |
| 13.2 to 15.2 | The beat drops out, the chord dims, a riser and a left-to-right sweep carry into the Sky |
| 15.2 to 29.2 | Listening room in F major: bright pad, glass bell melody, half-time beat, a slow swell of air every 5.5 s (the breathing light); each carousel turn is a right-to-left sweep, a tick and a high bell; the focus view opens on a low bloom and a bell chord; the next cover arrives with a sweep from the right |
| 29.2 to 33.6 | Library, Playlists, History land with three rising ticks and bells, left, centre, right |
| 33.6 to 36.8 | The seam wipes left to right with a full-width sweep; the Ember beat and pluck return |
| 36.8 to 40 | The cube folds in again, a held D chord hit, a bell on the calls to action, then a 1.4 s fade |

## Storyboard

| Time (s) | Scene | World | What moves |
| --- | --- | --- | --- |
| 0.0 to 6.4 | Hero | Ember | Corner light rises from the top-left and stays still. The letter cube assembles (left face from the left, lid from above, front brightens). Eyebrow, the two tagline lines and the Bangla line arrive along the 117 degree depth axis. |
| 6.4 to 13.2 | 01 Events | Ember | "What's on" with the events lede. Two glass event cards with Room Cubes fold in from the depth axis. |
| 13.2 to 15.2 | Hand-over | Ember to Sky | The Ember light fades to Night, a neutral band crosses on the 117 degree axis, then the Sky light rises. The lights never overlap (home rule D1). |
| 15.2 to 29.2 | 02 Listening room | Sky | The full-screen room: blurred cover backdrop drifting (lr-drift), breathing light behind the front card (lr-breathe), floating front card (lr-float), equaliser bars, Ice scrubber. Two Next presses turn the 3D carousel (640 ms, room curve); the title rises on each change (lr-rise). Then the front card opens the focus view (lr-enter, lr-art-in, halo) and the next cover turns in from the right edge (lr-peek). |
| 29.2 to 33.6 | Your room | Sky | "Your tickets, library and playlists in one place" with Library, Playlists and History glass cards. |
| 33.6 to 36.8 | 03 Store | Ember | The Ember world returns across a hard seam with a 1 px Sky hairline. "Music to keep" and the Store lede. |
| 36.8 to 40.0 | End card | Ember | The cube assembles again beside the tagline, the mission line, and the calls to action: Create an account, Start listening, Are you an artist? Apply. |

The listening room scene is the longest by design and reuses the exact numbers in `app/styles/modules/listen.css` (slot poses, 640 ms move, `cubic-bezier(0.22, 0.8, 0.16, 1)`, 36 s drift, 5.5 s breathe, 7 s float, 900 ms equaliser, 1400 ms backdrop cross-fade, 40 px stretched canvas backdrop).

## Facts used (read from localhost:3000 on 2026-10-14)

| Item | What the site says | Source page |
| --- | --- | --- |
| Audience | Music fans who go to Corner Room shows and listen to its artists ("Your tickets, library and playlists in one place"), plus artists who want to join the label ("Are you an artist? Apply") | `/`, `/artists` |
| Problem | Not stated on the site. Implied only: tickets, music and playlists in one place, and a way to support artists | `/` |
| Feature 1: Events | "What's on. Live shows from Corner Room. Times are shown in each event's own city." | `/discover` |
| Feature 2: Listening room | "Play what you own. Buy a track to keep it, or unlock everything with a plan." Library ("Everything you bought or saved."), Playlists ("Your own running orders."), History ("What you listened to, newest first.") | `/listen`, `/library`, `/playlists`, `/history` |
| Feature 3: Store | "Music to keep. Subscribe to listen across the catalog, or buy music to keep." | `/store`, `/` |
| Motto | "The city's corner. The music's room." / "শহরের কোণে, গানের ঘরে" | `/`, `/login`, `/register`, footer |
| Purpose | "Find the music you love. Help the artists who make it." | `/` |
| Proof | None on the site: no testimonials, user numbers, press or ratings. The film shows none | all pages |
| CTA | "Create an account" (primary), "Start listening", "Are you an artist? Apply"; also "See what's on", "Visit the Store", "Join" | `/`, `/artists`, header |

## Before publishing

- The track, event and artist names come from the seeded demo catalog. Replace them in `copy.ts` with the launch catalog.
- The tagline and the mission line are provisional (D-P16-07, OD-30, launch blocker LB-02). Re-render when they change.
- Sikat is not licensed for commercial use (D-P16-04, LB-01). A public film needs the licence or the replacement face first.
- The score is original and generated in code. If a licensed track or a Corner Room artist's song replaces it, clear both the master and the composition first.
- No URL appears on the end card because no public domain is decided yet.
