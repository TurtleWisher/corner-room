/**
 * Brand palette mirror for TypeScript (Room Cube, charts, tests). Must match app/styles/tokens.css
 * and brand/palette/corner-room-palette.json. Prefer CSS variables in components.
 */
export const palette = {
  signal: "#B21F24",
  oxblood: "#831515",
  lamp: "#FCF475",
  sky: "#53C8EA",
  indigo: "#4F4789",
  ice: "#BBEDFE",
  night: "#140707",
  deep: "#120F26",
  graphite: "#110E0F",
  cream: "#F6ECE6",
  muted: "#CDB9B3",
  mist: "#B9B6D6",
  paper: "#FBF5E6",
  ink: "#1C0607",
  redGlow: "#FF5A4E",
  indigoInk: "#2E2860",
  // Artist Studio world (D-THEME-02): the mint logo's three colours and the derived base.
  signalMint: "#2CBB76",
  forest: "#326000",
  paleMint: "#D3ECC9",
  studioNight: "#0B1710",
} as const;

export type ThemeName = "ember" | "sky" | "staff" | "paper" | "artist-studio";
export const THEMES: readonly ThemeName[] = ["ember", "sky", "staff", "paper", "artist-studio"];
