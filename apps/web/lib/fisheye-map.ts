/*
 * The fisheye bend for a pre-sale screen with no cover (owner, 2026-11-06): a displacement map for
 * an SVG feDisplacementMap. Red moves pixels sideways, green up and down, 128 = stay. The middle
 * is pulled from nearer the centre (it swells towards you) and the edges stay put, like an old
 * curved TV seen through a wide lens. Pure maths, so it can be tested; the canvas only paints it.
 */

/** How strongly the middle swells (share of the half-width) and the map's displacement scale. */
export const FISHEYE_STRENGTH = 0.16;
export const FISHEYE_SCALE = 0.24;

/** RGBA bytes for a size x size map. */
export function fisheyeMap(size: number, strength = FISHEYE_STRENGTH, scale = FISHEYE_SCALE): Uint8ClampedArray {
  const out = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      // Position as a share of the box, centre 0, edges +-0.5.
      const px = (x + 0.5) / size - 0.5;
      const py = (y + 0.5) / size - 0.5;
      const r2 = Math.min(1, (px * px + py * py) / 0.5);
      // Sample from nearer the centre by an amount that fades to nothing at the corners.
      const pull = strength * (1 - r2);
      const dx = -px * pull;
      const dy = -py * pull;
      const i = (y * size + x) * 4;
      out[i] = Math.round(255 * (0.5 + dx / scale));
      out[i + 1] = Math.round(255 * (0.5 + dy / scale));
      out[i + 2] = 128;
      out[i + 3] = 255;
    }
  }
  return out;
}
