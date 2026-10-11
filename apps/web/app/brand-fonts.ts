import localFont from "next/font/local";

/*
 * Corner Room typefaces, self-hosted (no build-time network).
 * Sikat is NOT licensed for commercial use (D-P16-04, launch blocker LB-01).
 * Swapping the display face before launch is a change to this one declaration.
 *
 * preload is off while legacy pages (which do not use these faces) are still live, so they pay
 * nothing. Stage 5 turns preload on for Archivo and Sikat when the new shell adopts them.
 */

export const sikat = localFont({
  src: "./fonts/sikat-regular.woff2",
  variable: "--font-sikat",
  weight: "400",
  display: "swap",
  preload: false,
  fallback: ["Arial Narrow", "sans-serif"],
});

/* Archivo variable (wght 100-900, wdth 62-125), Latin subset. SIL OFL. */
export const archivo = localFont({
  src: "./fonts/archivo-latin-var.woff2",
  variable: "--font-archivo",
  weight: "100 900",
  display: "swap",
  preload: false,
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

export const fontVariables = [sikat.variable, archivo.variable, anekBangla.variable, taka.variable].join(" ");
