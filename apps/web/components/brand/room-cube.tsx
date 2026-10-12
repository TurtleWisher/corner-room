import * as React from "react";

import { CubeLogo, type CubeTheme } from "./cube-logo/cube-logo";
import { cubeFaces } from "./cube-logo/geometry";

/**
 * The Room Cube (BRAND_GUIDELINE section 9): Corner Room artwork for events and releases,
 * drawn with the same letter-cube construction as the logo. The cube is made of the words
 * themselves; there are no drawn faces. Text comes only from real data.
 *
 * `front` is the title, `side` a secondary real value (series, artist, city). Word placement
 * follows `cubeFaces`: the title over two lines on the front, the secondary word on the left
 * face, the title's last word (or `top`) on the lid.
 */
export type RoomCubeTone = "theme" | "ember" | "sky" | "mono" | "night" | "ice";

const TONE: Record<RoomCubeTone, CubeTheme> = {
  theme: "theme",
  ember: "fire",
  sky: "ice",
  mono: { bg: "#FBF5E6", side: "#3B3B3B", face: "#1C0607" },
  night: { bg: "#160707", side: "#B21F24", face: "#FCF475" },
  ice: { bg: "#1B1838", side: "#53C8EA", face: "#BBEDFE" },
};

export interface RoomCubeProps {
  front: string;
  side: string;
  top?: string;
  tone?: RoomCubeTone;
  /** Draw the square background (artwork tile, cube at 80%). Off for cubes placed directly on a matching surface. */
  field?: boolean;
  /** "front": simplified front-only mark for sizes under 96 px. */
  size?: "full" | "front";
  /** Accessible name. Defaults to the title. Pass "" when the title is visible beside the cube. */
  label?: string;
  animate?: boolean;
  className?: string;
}

/** The two front-face lines a title produces (kept for callers that need the words). */
export function cubeFrontLines(text: string, side?: string): [string, string] {
  return [...cubeFaces(text, side).front] as [string, string];
}

export function RoomCube({ front, side, top, tone = "theme", field = true, size = "full", label, animate, className }: RoomCubeProps) {
  const faces = cubeFaces(front, side);
  return (
    <CubeLogo
      front={faces.front}
      left={faces.left}
      top={top ?? faces.top}
      theme={TONE[tone]}
      framed={field ? "tile" : false}
      variant={size}
      title={label ?? `${front}${side ? `, ${side}` : ""}`}
      animate={animate}
      className={className}
    />
  );
}
