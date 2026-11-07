"use client";

import * as React from "react";

import { CoverArt } from "@/components/brand/cover-art";
import { RoomCube } from "@/components/brand/room-cube";
import { FISHEYE_SCALE, fisheyeMap } from "@/lib/fisheye-map";
import { cn } from "@/lib/utils";

/**
 * A release's cover while it is on pre-sale (owner, 2026-11-06, D-PRESALE-04; switch 2026-11-07,
 * D-COVER-03).
 *
 * With a cover: the picture. Until the artist switches the cover on it is the server's lightly
 * blurred copy (enough to recognise, not to see clearly; the sharp file never reaches fans); once
 * on, the cover as it is. No shade, no tint: the art stays the art.
 *
 * Without one: the title cube on an old curved TV screen seen through a wide lens, a little
 * blurred while the switch is off and sharp once it is on (`revealed`). The
 * screen swells in the middle (an SVG fisheye bend, where the browser draws it reliably), the
 * glass carries a slow gloss and a soft band of light rolls down it. The cube's faces stay clean
 * (brand: no texture on Room Cubes), so the old-TV feel comes from the glass, not from lines on
 * the art. Still under reduced motion; no glass layers under reduced transparency.
 */
export function PresaleCover({
  coverUrl,
  revealed = false,
  title,
  artist,
  className,
  children,
}: {
  /** From lib/cover-view; null when there is no cover. Already blurred by the server while off. */
  coverUrl: string | null;
  /** The artist's switch: on shows everything clearly; off blurs the title screen a little. */
  revealed?: boolean;
  title: string;
  artist?: string | null;
  className?: string;
  /** Laid over the cover (the hover Pre-book button). */
  children?: React.ReactNode;
}) {
  const screen = <PresaleScreen title={title} artist={artist} />;
  return (
    <div className={cn("psc", className)} data-kind={coverUrl ? "art" : "screen"} data-soft={revealed ? undefined : ""}>
      {coverUrl ? (
        <div className="psc-art">
          <CoverArt src={coverUrl} fallback={screen} className="w-full" />
        </div>
      ) : (
        screen
      )}
      {children}
    </div>
  );
}

/** The no-cover screen: title cube behind curved glass. Decoration; the title is written nearby. */
export function PresaleScreen({ title, artist }: { title: string; artist?: string | null }) {
  const id = React.useId().replace(/:/g, "");
  const map = useFisheyeMap();
  return (
    <div className="psc-screen" aria-hidden="true">
      {map ? (
        <svg className="psc-defs" width="0" height="0" focusable="false">
          <filter id={`psc-bend-${id}`} x="0" y="0" width="1" height="1" primitiveUnits="objectBoundingBox" colorInterpolationFilters="sRGB">
            <feImage href={map} x="0" y="0" width="1" height="1" preserveAspectRatio="none" result="map" />
            <feDisplacementMap in="SourceGraphic" in2="map" scale={FISHEYE_SCALE} xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </svg>
      ) : null}
      <div className="psc-tube">
        <div className="psc-picture" style={map ? { filter: `url(#psc-bend-${id})` } : undefined}>
          <RoomCube front={title} side={artist || title} tone="ice" label="" className="w-full" />
        </div>
        <span className="psc-band" />
        <span className="psc-gloss" />
      </div>
    </div>
  );
}

let cachedMap: string | null | undefined;

/** The fisheye map as a PNG data URL, made once per page, in browsers that draw SVG filters on
 * HTML reliably (WebKit's Safari can drop the element instead, so it gets the flat glass). */
function useFisheyeMap(): string | null {
  const [map, setMap] = React.useState<string | null>(cachedMap ?? null);
  React.useEffect(() => {
    if (cachedMap !== undefined) {
      setMap(cachedMap);
      return;
    }
    cachedMap = makeMap();
    setMap(cachedMap);
  }, []);
  return map;
}

function makeMap(): string | null {
  try {
    const ua = navigator.userAgent;
    const webkitOnly = /AppleWebKit/i.test(ua) && !/(Chrome|Chromium|CriOS|Edg|Android)/i.test(ua);
    if (webkitOnly || /jsdom/i.test(ua)) return null;
    const size = 128;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const image = ctx.createImageData(size, size);
    image.data.set(fisheyeMap(size));
    ctx.putImageData(image, 0, 0);
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}
