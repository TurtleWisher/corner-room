# Letter cube (`components/brand/cube-logo`)

The Corner Room mark is an oblique cube built only from letters. There are no drawn faces: the
letterforms are the planes, and the background shows through every counter, gap and seam.
The same construction draws event and release artwork (the Room Cube), so LOW TIDE is a cube
made of LOW, TIDE and SESSIONS, not a cube with a label on it.

| File | Role |
| --- | --- |
| `glyphs.ts` | Block alphabet A to Z, 0 to 9 and `- . , ' !`. Every glyph is one outer polygon plus holes, built from rectangles and wedges only. |
| `geometry.ts` | Master canvas (1920), face boxes measured from the official logo, force-justified line layout, face matrices, `cubeFaces` word placement. |
| `cube-logo.tsx` | `CubeLogo` server component. One `<path>` per line or face, `fill-rule="evenodd"`. |
| `../room-cube.tsx` | `RoomCube` adapter for event and release artwork (title plus one secondary value). |
| `app/styles/cube-logo.css` | `data-cr-theme="ice" | "fire"` colour tokens and the optional assembly animation. |
| `app/theme-kit/cube/page.tsx` | Demo page (`/theme-kit/cube`, dev only unless `CR_THEME_KIT=1`). |

## Construction (master canvas 1920 x 1920)

| Face | Box | Words | Notes |
| --- | --- | --- | --- |
| Front | x 790 to 1499; line 1 y 703, h 293; line 2 y 1009, h 389 (ratio 1.33) | Two lines, one word each | Force-justified: first glyph starts at x0, last ends at x1. Letter gap 20. Line gap 13. |
| Left | 691 x 338 box, sheared 0.5237 (rises toward the front) | One word, reads bottom to top | Letter tops face outward. `matrix(0 -1 1 0.5237 436 1221)`. |
| Top | 714 x 171 box, sheared 1.971 (verticals lean up-left) | One word | Heavier stroke (0.33 of depth) so the lid matches the logo's weight. `matrix(1 0 1.971 1 436 522)`. |

Seams of background separate the three faces. Stroke follows line height (0.13), grows on wide
letters so counters stay narrow slots, and is capped by letter width.

## Usage

```tsx
import { CubeLogo } from "@/components/brand/cube-logo";
import { RoomCube } from "@/components/brand/room-cube";

<CubeLogo />                                  // the logo, ice, 1920 framed square
<CubeLogo theme="fire" framed={false} />      // transparent, cropped to the cube
<CubeLogo theme="theme" />                    // follows the surrounding world's --cr-cube-* tokens
<CubeLogo variant="front" />                  // front-only mark for sizes under 96 px

<RoomCube front={event.title} side={event.series} />          // artwork tile, cube at 80%
<RoomCube front={release.title} side={release.artist} size="front" label="" />  // list thumbnail
```

Props of `CubeLogo`:

| Prop | Default | Meaning |
| --- | --- | --- |
| `front` | `["CORNER", "ROOM"]` | Two front lines. |
| `left` / `top` | `"CORNER"` / `"ROOM"` | Side words. |
| `theme` | `"ice"` | `"ice"`, `"fire"`, `"theme"` or `{ bg, side, face }`. |
| `framed` | `true` | `true` master square, `"tile"` square with the cube at 80%, `false` transparent crop. |
| `variant` | `"full"` | `"front"` drops the sides for small sizes. |
| `title` | `"Corner Room"` | Accessible name; `""` makes the mark decorative (`aria-hidden`). |
| `animate` | `false` | Left slides from x-40, top from y-40, front brightens from 40% (never invisible, so the first paint is not held back); 600 ms; off under reduced motion. |

## Word placement (`cubeFaces(title, secondary)`)

Every word comes from real data. Nothing is invented.

1. Pool: title words in order, then secondary words not already in the title.
2. Front line 1: the first title word that stays legible on line 1 (secondary words reach the front only when no title word fits).
3. Front line 2: the next title word that fits line 2; otherwise line 1 repeats. The front never mixes in the secondary word, so Monsoon Frequencies + Dhaka reads MONSOON / MONSOON.
4. Left: the first unused secondary word, else the first secondary word, else the title's first word.
5. Top: the first unused title word, else the last unused pool word, else the secondary word, else line 2.

| Input | Front | Left | Top |
| --- | --- | --- | --- |
| Corner Room | CORNER / ROOM | CORNER | ROOM |
| Low Tide + Sessions | LOW / TIDE | SESSIONS | SESSIONS |
| Night Bus + Kaal Bela | NIGHT / BUS | KAAL | BELA |
| Monsoon Frequencies + Chattogram | MONSOON / MONSOON | CHATTOGRAM | FREQUENCIES |

Long words go to the lid, which reads best at small letter aspect. In dev, `CubeLogo` warns when a
word drops below the legibility floor (front 0.18, sides 0.12 letter width over height).

## Colours

The official logo files use these values, which replace the approximations in the master prompt:

| Theme | Background | Sides | Front |
| --- | --- | --- | --- |
| ice | `#53C8EA` | `#4F4789` | `#BBEDFE` |
| fire | `#B21F24` | `#831515` | `#FCF475` |

Inside a world, `theme="theme"` reads `--cr-cube-field`, `--cr-cube-shadow` and `--cr-cube-face`
from `app/styles/tokens.css`. Geometry never changes with theme.

## Do

- Use real titles and series, artist or city values only.
- Use `variant="front"` (or `RoomCube size="front"`) below 96 px.
- Pass `title=""` / `label=""` when the same words are visible beside the cube.
- Keep the background flat. The seams must stay visible.

## Don't

- Don't add face panels, outlines, shadows or gradients behind the letters.
- Don't set the words in a font. The glyphs are the type.
- Don't rotate, mirror or re-skew the faces, or change the line ratio.
- Don't use more than three colours, or different colours per letter.
- Don't place the cube on photography or busy texture.

## Bangla and unsupported characters

Words the glyph set cannot draw (Bangla, for example) fall back to a fitted `<text>` in Anek Bangla
on that face only. The geometry and colours stay the same. A drawn Bangla glyph set is open
decision OD-26.

## Acceptance checklist

| # | Check | Result | How |
| --- | --- | --- | --- |
| 1 | No `<text>` and no rect behind letters | Pass | Unit test: Latin output has no `<text>`; only the optional background rect. |
| 2 | Exactly three colours | Pass | Unit test collects the distinct fills. |
| 3 | Both front lines span x0 to x1 | Pass | Unit test on path bounds (within 0.5 units). |
| 4 | Line ratio 1.33, line gap 13 | Pass | Unit test on constants and path bounds. |
| 5 | Side letters legible at 256 px | Pass | Visual check on `/theme-kit/cube` section 05. |
| 6 | Seams visible | Pass | Visual check on `/theme-kit/cube`; seams are 8 to 20 units on the master canvas. |
| 7 | Low Tide gives LOW / TIDE with SESSIONS | Pass | Unit test on `cubeFaces`. |
| 8 | Identical geometry across themes | Pass | Unit test compares path data for ice and fire. |
| 9 | Under 2% deviation from the reference | Pass | Face positions within about 1% of the measured logo. Pixel overlap (IoU) against the official PNG: front 0.909, sides 0.861; the residual is letterform detail, not placement. |

Run `npm test -- cube-logo` for checks 1 to 4, 7 and 8.
