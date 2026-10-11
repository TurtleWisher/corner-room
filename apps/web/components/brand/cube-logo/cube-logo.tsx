import * as React from "react";

import { cn } from "@/lib/utils";

import { canDrawWord, normalizeWord } from "./glyphs";
import {
  buildCube,
  CANVAS,
  CUBE_BOUNDS,
  FRONT,
  LEFT,
  LEFT_MATRIX,
  TOP,
  TOP_MATRIX,
  UNFRAMED_PADDING,
} from "./geometry";

/**
 * The Corner Room letter cube: an oblique cube made only of letters. The front face is two
 * stacked words, the left face one word read bottom-to-top, the top face one word as the lid.
 * There are no face panels: the background shows through every counter, gap and seam.
 *
 * Pure function of props, server-rendered, no fonts and no <text> for Latin words.
 * Words outside the glyph set (for example Bangla) fall back to a fitted <text> in Anek Bangla
 * on that face only, until a Bangla glyph set exists (OD-26).
 */

export type CubeTheme = "ice" | "fire" | "theme" | { bg: string; side: string; face: string };

const LITERAL: Record<"ice" | "fire", { bg: string; side: string; face: string }> = {
  ice: { bg: "#53C8EA", side: "#4F4789", face: "#BBEDFE" },
  fire: { bg: "#B21F24", side: "#831515", face: "#FCF475" },
};

export interface CubeLogoProps {
  /** Two lines for the front face. A single string is split by `cubeFaces` rules upstream. */
  front?: readonly [string, string];
  /** Word on the left face. */
  left?: string;
  /** Word on the top face. */
  top?: string;
  /**
   * "ice" (Sky world), "fire" (Ember world), "theme" (follows the surrounding world's
   * --cr-cube-* tokens) or a custom three-colour set.
   */
  theme?: CubeTheme;
  /**
   * true: the 1920 master square with background (logo use, about 440 units of margin).
   * "tile": square with background, cube filling 80% (artwork tiles, cards, app icons).
   * false: transparent, cropped to the cube plus 40 units.
   */
  framed?: boolean | "tile";
  /** "front": simplified mark for sizes under 96 px (64 px unframed). */
  variant?: "full" | "front";
  /** Accessible name. Pass "" when the same words are visible next to the mark. */
  title?: string;
  animate?: boolean;
  className?: string;
}

function colours(theme: CubeTheme) {
  if (typeof theme === "object") return { bg: theme.bg, side: theme.side, face: theme.face, attr: undefined };
  if (theme === "theme") {
    return { bg: "var(--cr-cube-field)", side: "var(--cr-cube-shadow)", face: "var(--cr-cube-face)", attr: undefined };
  }
  const lit = LITERAL[theme];
  return {
    bg: `var(--cr-cube-field, ${lit.bg})`,
    side: `var(--cr-cube-shadow, ${lit.side})`,
    face: `var(--cr-cube-face, ${lit.face})`,
    attr: theme,
  };
}

/** Fallback for words the glyph set cannot draw: fitted text, same box, same colour. */
function FallbackText({ word, x, y, w, h }: { word: string; x: number; y: number; w: number; h: number }) {
  return (
    <text
      x={x}
      y={y + h * 0.86}
      fontSize={h * 0.92}
      textLength={w}
      lengthAdjust="spacingAndGlyphs"
      style={{ fontFamily: "var(--font-anek), var(--font-archivo), sans-serif", fontWeight: 700 }}
    >
      {word}
    </text>
  );
}

export function CubeLogo({
  front = ["CORNER", "ROOM"],
  left = "CORNER",
  top = "ROOM",
  theme = "ice",
  framed = true,
  variant = "full",
  title = "Corner Room",
  animate = false,
  className,
}: CubeLogoProps) {
  const geo = buildCube({ front, left, top });
  if (process.env.NODE_ENV !== "production") {
    for (const w of geo.warnings) console.warn(`[CubeLogo] ${w}`);
  }
  const c = colours(theme);
  const W = FRONT.x1 - FRONT.x0;
  const decorative = title === "";
  const fill = (v: string) => ({ fill: v });

  let viewBox = `0 0 ${CANVAS} ${CANVAS}`;
  if (variant === "front") {
    const p = UNFRAMED_PADDING;
    viewBox = `${FRONT.x0 - p} ${FRONT.line1.y - p} ${W + 2 * p} ${FRONT.line2.y + FRONT.line2.h - FRONT.line1.y + 2 * p}`;
  } else if (framed === "tile") {
    const cx = (CUBE_BOUNDS.x0 + CUBE_BOUNDS.x1) / 2;
    const cy = (CUBE_BOUNDS.y0 + CUBE_BOUNDS.y1) / 2;
    const side = Math.round((CUBE_BOUNDS.x1 - CUBE_BOUNDS.x0) / 0.8);
    viewBox = `${Math.round(cx - side / 2)} ${Math.round(cy - side / 2)} ${side} ${side}`;
  } else if (!framed) {
    const p = UNFRAMED_PADDING;
    viewBox = `${CUBE_BOUNDS.x0 - p} ${CUBE_BOUNDS.y0 - p} ${CUBE_BOUNDS.x1 - CUBE_BOUNDS.x0 + 2 * p} ${CUBE_BOUNDS.y1 - CUBE_BOUNDS.y0 + 2 * p}`;
  }
  const [vx, vy, vw, vh] = viewBox.split(" ").map(Number);

  const drawable = {
    l1: canDrawWord(front[0]),
    l2: canDrawWord(front[1]),
    left: canDrawWord(left),
    top: canDrawWord(top),
  };

  return (
    <svg
      viewBox={viewBox}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : title}
      aria-hidden={decorative ? true : undefined}
      focusable="false"
      data-cr-theme={c.attr}
      className={cn("block h-auto w-full", animate && "cr-cube-animate", className)}
    >
      {decorative ? null : <title>{title}</title>}
      {framed ? <rect x={vx} y={vy} width={vw} height={vh} style={fill(c.bg)} /> : null}

      {variant === "full" ? (
        <>
          <g className="cr-cube-left" style={fill(c.side)}>
            <g transform={`matrix(${LEFT_MATRIX.join(" ")})`}>
              {drawable.left ? (
                <path d={geo.left.d} fillRule="evenodd" />
              ) : (
                <FallbackText word={left} x={0} y={0} w={LEFT.length} h={LEFT.d} />
              )}
            </g>
          </g>
          <g className="cr-cube-top" style={fill(c.side)}>
            <g transform={`matrix(${TOP_MATRIX.join(" ")})`}>
              {drawable.top ? (
                <path d={geo.top.d} fillRule="evenodd" />
              ) : (
                <FallbackText word={top} x={0} y={0} w={TOP.w} h={TOP.d} />
              )}
            </g>
          </g>
        </>
      ) : null}

      <g className="cr-cube-front" style={fill(c.face)}>
        {drawable.l1 ? (
          <path d={geo.front[0].d} fillRule="evenodd" />
        ) : (
          <FallbackText word={front[0]} x={FRONT.x0} y={FRONT.line1.y} w={W} h={FRONT.line1.h} />
        )}
        {drawable.l2 ? (
          <path d={geo.front[1].d} fillRule="evenodd" />
        ) : (
          <FallbackText word={front[1]} x={FRONT.x0} y={FRONT.line2.y} w={W} h={FRONT.line2.h} />
        )}
      </g>
    </svg>
  );
}

/** Uppercased words exactly as the cube will draw them (for alt text and tests). */
export function cubeWords(props: Pick<CubeLogoProps, "front" | "left" | "top">) {
  const { front = ["CORNER", "ROOM"], left = "CORNER", top = "ROOM" } = props;
  return { front: [normalizeWord(front[0]), normalizeWord(front[1])], left: normalizeWord(left), top: normalizeWord(top) };
}
