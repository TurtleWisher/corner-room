import localFont from "next/font/local";

/*
 * Corner Room typefaces, self-hosted (no build-time network).
 * Sikat is NOT licensed for commercial use (D-P16-04, launch blocker LB-01).
 * Swapping the display face before launch is a change to this one declaration.
 *
 * Stage 5: every route now renders the new shell, so Archivo (UI) and Sikat (display) preload.
 * The Bengali face and the taka subset stay lazy: unicode-range loads them only when needed.
 */

export const sikat = localFont({
  src: "./fonts/sikat-regular.woff2",
  variable: "--font-sikat",
  weight: "400",
  display: "swap",
  preload: true,
  fallback: ["Arial Narrow", "sans-serif"],
});

/* Archivo variable (wght 100-900, wdth 62-125), Latin subset. SIL OFL. */
export const archivo = localFont({
  src: "./fonts/archivo-latin-var.woff2",
  variable: "--font-archivo",
  weight: "100 900",
  display: "swap",
  preload: true,
  declarations: [{ prop: "font-stretch", value: "62% 125%" }],
  fallback: ["system-ui", "sans-serif"],
});

/* Anek Bangla variable, Bengali subset. Loaded only when Bengali text is on the page. SIL OFL. */
export const anekBangla = localFont({
  src: "./fonts/anek-bangla-bengali-var.woff2",
  variable: "--font-anek",
  weight: "100 800",
  display: "swap",
  preload: false,
  declarations: [
    { prop: "font-stretch", value: "75% 125%" },
    {
      prop: "unicode-range",
      value: "U+0951-0952, U+0964-0965, U+0980-09FE, U+200C-200D, U+20B9, U+25CC",
    },
  ],
});

/* The taka sign alone (about 2 KB), subset from Anek Bangla, so prices never pull the full Bengali font. */
export const taka = localFont({
  src: "./fonts/anek-bangla-taka.woff2",
  variable: "--font-taka",
  weight: "100 800",
  display: "swap",
  preload: false,
  declarations: [{ prop: "unicode-range", value: "U+09F3" }],
});

/* Instrument Serif Italic, Latin subset, from Google Fonts (SIL OFL, app/fonts/OFL-InstrumentSerif.txt).
   Greeting face only (brand v1.4, owner decision 2026-10-13): a person's name in "Welcome back".
   Not preloaded: it is fetched only on pages that show a greeting. */
export const greeting = localFont({
  src: "./fonts/instrument-serif-italic-latin.woff2",
  variable: "--font-greeting",
  weight: "400",
  style: "italic",
  display: "swap",
  preload: false,
  fallback: ["Georgia", "serif"],
});

export const fontVariables = [sikat.variable, archivo.variable, anekBangla.variable, taka.variable, greeting.variable].join(" ");
