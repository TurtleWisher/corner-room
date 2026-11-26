/*
 * The front disc's listens in millions, standing far back in Trending Corner's 3D room (owner,
 * 2026-11-18). The song page's figure (`components/music/listens-in-millions.tsx`) in Ember light:
 * very large outlined Archivo numerals with a faint fill, a misregistered Signal shadow and a soft
 * glow, fading toward the floor, with "Million listens" beneath. It is part of the one WebGL scene in
 * `trending-gl.ts` (no second canvas or context), so the gloss floor reflects it, the camera's drift
 * gives it depth, and it turns a little toward the pointer and brightens while the pointer is in the
 * room.
 *
 * Cheap by design: every glyph is drawn once onto canvas textures (one strip of 0 to 9, the point, the
 * words); a place is one quad whose shader picks its digit from the strip, so a roll is one number per
 * place per frame. Rolls run on like a counter (lib/listens-figure-view.ts). Reduced motion: no roll,
 * no float, no tilt.
 *
 * Depth (owner, 2026-11-26): each numeral is a solid block, not a flat print. A second strip holds
 * the glyphs as solid masks; the shader marches back through the block (FIGURE.depth deep) and draws
 * its sides as thin laminated layers in Ember's deep reds, lit on the lamp's side, with real
 * parallax: the sides shift as the camera drifts. The face is warm brushed metal (fine grooves that
 * roll with the digit, a still grain, cream to Lamp across the whole figure), and one band of light
 * crosses the figure when the number rolls, or follows the pointer while it is in the room. Still the
 * same single quad per place, no extra geometry or canvas.
 */
import * as THREE from "three";

import { figureFit, figureGlyphs, figureLayout, rollEase, rollTarget, rollTiming, type FigureGlyph } from "@/lib/listens-figure-view";

/** Where the figure stands, in disc radii: far behind the ring, floating above the floor. */
const FIGURE = {
  z: -5.4,
  /** One glyph cell's height (the numerals are about 70 % of it). */
  height: 2.8,
  /** How near the top of the room the numerals' tops stand (in screen heights from the top). */
  top: 0.05,
  /** The "Million / listens" words' height, beside the last digit. */
  unit: 0.62,
  /** Space between the last digit and the words. */
  unitGap: 0.12,
  /** How deep each numeral's block is, in the same units as its height. */
  depth: 0.62,
  /** How long the light takes to cross the figure after a roll (ms). */
  sweepMs: 1700,
  /** Turned a little into the room, like the song page's plane. */
  rotY: -0.08,
  rotX: 0.03,
} as const;

/** The canvas the glyphs are drawn at (px). */
const FONT_PX = 200;
const UNIT_PX = 44;

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAGMENT = /* glsl */ `
uniform sampler2D uMap;
uniform sampler2D uMask;
uniform float uRoll;
uniform float uRows;
uniform float uOpacity;
uniform float uGlow;
uniform float uFall;
uniform float uSolid;
uniform vec2 uDepth;
uniform vec2 uSpan;
uniform vec2 uLight;
uniform vec2 uSheen;
varying vec2 vUv;

// Where a point of this quad reads the glyph strip (a place's digits wrap like a counter).
vec2 cellAt(vec2 uv) {
  float row = uRoll + (1.0 - uv.y);
  float rows = max(uRows, 1.0);
  return uRows > 1.5 ? vec2(uv.x, 1.0 - fract(row / rows)) : uv;
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

// A over B, both straight (not premultiplied) colour.
vec4 over(vec4 a, vec4 b) {
  float alpha = a.a + b.a * (1.0 - a.a);
  vec3 rgb = (a.rgb * a.a + b.rgb * b.a * (1.0 - a.a)) / max(alpha, 1e-4);
  return vec4(rgb, alpha);
}

void main() {
  float row = uRoll + (1.0 - vUv.y);
  float rows = max(uRows, 1.0);
  vec2 unwrapped = vec2(vUv.x, -row / rows);
  vec2 gx = dFdx(unwrapped);
  vec2 gy = dFdy(unwrapped);
  vec2 at = cellAt(vUv);
  vec4 print = textureGrad(uMap, at, gx, gy);
  vec4 col = vec4(print.rgb * uGlow, print.a);

  if (uSolid > 0.5) {
    float face = textureGrad(uMask, at, gx, gy).a;
    // Across the whole figure, 0 at its left edge and 1 at its right.
    float across = uSpan.x + vUv.x * uSpan.y;

    // The block's sides: the nearest layer behind this point that the glyph covers.
    const int STEPS = 16;
    float hit = -1.0;
    for (int i = 1; i <= STEPS; i++) {
      float s = float(i) / float(STEPS);
      vec2 back = vUv + uDepth * s;
      if (back.x < 0.0 || back.x > 1.0 || back.y < 0.0 || back.y > 1.0) continue;
      if (textureGrad(uMask, cellAt(back), gx, gy).a > 0.5) {
        hit = s;
        break;
      }
    }
    vec4 side = vec4(0.0);
    if (hit > 0.0) {
      // Thin laminated sheets, deep Signal red to near black going back, lit on the lamp's side.
      float sheet = 0.5 + 0.5 * cos(hit * float(STEPS) * 3.14159);
      vec3 deep = mix(vec3(0.50, 0.08, 0.10), vec3(0.06, 0.015, 0.03), smoothstep(0.0, 1.0, hit));
      float facing = dot(normalize(-uDepth + vec2(1e-5)), normalize(uLight + vec2(1e-5))) * 0.5 + 0.5;
      deep *= (0.62 + 0.55 * facing) * (0.88 + 0.12 * sheet);
      float edge = 1.0 - smoothstep(0.0, 0.18, hit);
      deep += vec3(1.0, 0.42, 0.34) * edge * 0.35 * facing;
      side = vec4(deep, (0.62 - 0.3 * hit) * (1.0 - smoothstep(0.3, 0.7, face)));
    }

    // The face: brushed metal, cream to Lamp across the figure, grooves that roll with the digit.
    float grooves = 0.5 + 0.5 * sin(row * 300.0);
    float aa = clamp(1.0 - fwidth(row * 300.0) * 0.35, 0.0, 1.0);
    float grain = hash(floor(gl_FragCoord.xy * 0.5)) - 0.5;
    float tilt = dot(uDepth, vec2(4.0, -2.0));
    vec3 metal = mix(vec3(0.97, 0.93, 0.90), vec3(0.99, 0.95, 0.47), smoothstep(0.05, 0.95, across + tilt));
    metal = mix(metal, vec3(1.0, 0.45, 0.36), smoothstep(0.55, 1.0, vUv.y) * 0.35);
    float band = uSheen.y * exp(-pow((across + (1.0 - vUv.y) * 0.18 - uSheen.x) * 7.0, 2.0));
    vec3 faceRgb = metal * (0.78 + 0.12 * grooves * aa + 0.06 * grain) + vec3(1.0, 0.97, 0.82) * band * 0.9;
    vec4 front = vec4(faceRgb, face * (0.17 + 0.05 * grooves * aa + 0.03 * grain + 0.42 * band));

    col = over(col, over(front, side));
  }

  // Digits fade as they roll past the top and bottom of their window.
  float window = uRows > 1.5 ? smoothstep(0.0, 0.16, vUv.y) * smoothstep(1.0, 0.84, vUv.y) : 1.0;
  // The song page's mask: the figure fades toward the floor.
  float fall = mix(1.0, mix(0.3, 1.0, smoothstep(0.12, 0.72, vUv.y)), uFall);
  gl_FragColor = vec4(col.rgb, col.a * window * fall * uOpacity);
  #include <colorspace_fragment>
}`;

type Uniforms = {
  uMap: { value: THREE.Texture | null };
  uMask: { value: THREE.Texture | null };
  uSolid: { value: number };
  uDepth: { value: THREE.Vector2 };
  uSpan: { value: THREE.Vector2 };
  uLight: { value: THREE.Vector2 };
  uSheen: { value: THREE.Vector2 };
  uRoll: { value: number };
  uRows: { value: number };
  uOpacity: { value: number };
  uGlow: { value: number };
  uFall: { value: number };
};

type Place = {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  u: Uniforms;
  roll: number;
  tween: { from: number; to: number; start: number; dur: number } | null;
  x: number;
  tx: number;
  op: number;
  target: number;
};

export type ListensFigure = {
  object: THREE.Group;
  /** Show this listen count; the figure rolls to it (at once under reduced motion). */
  setListens(listens: number): void;
  /** Move one frame (after the camera has moved). Returns true while it moves. */
  update(f: { now: number; dt: number; pointer: { x: number; y: number } | null; camera: THREE.PerspectiveCamera; floorY: number }): boolean;
  dispose(): void;
};

/** The Archivo family the page loaded (next/font names it through a CSS variable). */
function archivo(host: HTMLElement): string {
  const fromVar = getComputedStyle(host).getPropertyValue("--font-archivo").trim();
  return fromVar || getComputedStyle(host).fontFamily || "sans-serif";
}

type Glyphs = {
  strip: THREE.CanvasTexture;
  point: THREE.CanvasTexture;
  /** The same glyphs as solid shapes: the blocks' masks. */
  stripMask: THREE.CanvasTexture;
  pointMask: THREE.CanvasTexture;
  unit: THREE.CanvasTexture;
  cell: { w: number; h: number; pointW: number; advance: number; pointAdvance: number; unitW: number; unitH: number };
};

function drawGlyphs(family: string): Glyphs {
  const font = `700 ${FONT_PX}px ${family}`;
  const probe = document.createElement("canvas").getContext("2d");
  if (!probe) throw new Error("canvas");
  const condense = (g: CanvasRenderingContext2D) => {
    g.font = font;
    // The song page draws these at 78 % width; canvas offers the nearest keyword.
    if ("fontStretch" in g) (g as CanvasRenderingContext2D & { fontStretch: string }).fontStretch = "condensed";
  };
  condense(probe);
  const advance = Math.ceil(Math.max(...Array.from({ length: 10 }, (_, d) => probe.measureText(String(d)).width)));
  const pad = Math.round(FONT_PX * 0.2);
  const h = Math.round(FONT_PX * 1.3);
  const w = advance + pad * 2;
  const pointAdvance = Math.round(FONT_PX * 0.26);
  const pointW = pointAdvance + pad * 2;

  const glyph = (g: CanvasRenderingContext2D, ch: string, cx: number, cy: number) => {
    condense(g);
    g.textAlign = "center";
    g.textBaseline = "middle";
    // The misregistered shadow, a deeper print behind (Signal red on Ember, as Indigo is on Sky).
    g.fillStyle = "rgba(178, 31, 36, 0.3)";
    g.fillText(ch, cx + FONT_PX * 0.04, cy + FONT_PX * 0.05);
    // A soft Ember glow, the faint fill, then the outline.
    g.shadowColor = "rgba(255, 90, 78, 0.28)";
    g.shadowBlur = FONT_PX * 0.16;
    g.fillStyle = "rgba(246, 236, 230, 0.06)";
    g.fillText(ch, cx, cy);
    g.shadowBlur = 0;
    g.shadowColor = "transparent";
    g.lineWidth = Math.max(2, FONT_PX * 0.012);
    g.lineJoin = "round";
    g.strokeStyle = "rgba(246, 236, 230, 0.34)";
    g.strokeText(ch, cx, cy);
  };

  const canvas = (cw: number, ch: number, draw: (g: CanvasRenderingContext2D) => void) => {
    const c = document.createElement("canvas");
    c.width = cw;
    c.height = ch;
    const g = c.getContext("2d");
    if (g) draw(g);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    return t;
  };

  const strip = canvas(w, h * 10, (g) => {
    for (let d = 0; d < 10; d++) glyph(g, String(d), w / 2, d * h + h * 0.54);
  });
  const point = canvas(pointW, h, (g) => glyph(g, ".", pointW / 2, h * 0.54));
  const solid = (g: CanvasRenderingContext2D, ch: string, cx: number, cy: number) => {
    condense(g);
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = "#fff";
    g.fillText(ch, cx, cy);
  };
  const stripMask = canvas(w, h * 10, (g) => {
    for (let d = 0; d < 10; d++) solid(g, String(d), w / 2, d * h + h * 0.54);
  });
  const pointMask = canvas(pointW, h, (g) => solid(g, ".", pointW / 2, h * 0.54));

  // "Million / listens" in two lines beside the last digit, spaced wide in caps like the song page's
  // unit (beneath the figure it would stand behind the discs).
  const lines = ["MILLION", "LISTENS"];
  const unitFont = `600 ${UNIT_PX}px ${family}`;
  probe.font = unitFont;
  const spacing = UNIT_PX * 0.32;
  const lineW = (text: string) => Array.from(text).reduce((s, ch) => s + probe.measureText(ch).width + spacing, 0);
  const unitW = Math.ceil(Math.max(...lines.map(lineW)) + UNIT_PX * 0.5);
  const unitH = Math.round(UNIT_PX * 2.9);
  const unit = canvas(unitW, unitH, (g) => {
    g.font = unitFont;
    g.textBaseline = "middle";
    g.fillStyle = "rgba(252, 244, 117, 0.6)";
    lines.forEach((text, row) => {
      let x = UNIT_PX * 0.25;
      for (const ch of text) {
        g.fillText(ch, x, unitH * (row === 0 ? 0.3 : 0.72));
        x += g.measureText(ch).width + spacing;
      }
    });
  });
  return { strip, point, stripMask, pointMask, unit, cell: { w, h, pointW, advance, pointAdvance, unitW, unitH } };
}

export function createListensFigure({ host, reduced, onReady }: { host: HTMLElement; reduced: boolean; onReady: () => void }): ListensFigure {
  const group = new THREE.Group();
  const tilt = new THREE.Group();
  const row = new THREE.Group();
  group.add(tilt);
  tilt.add(row);
  group.visible = false;
  group.position.z = FIGURE.z;

  const glow = { value: 0.85 };
  // Shared by every place: where the lamp is across the plane, and the band of light (position, power).
  const light = { value: new THREE.Vector2(0.6, 0.7) };
  const sheen = { value: new THREE.Vector2(-1, 0) };
  let sweepStart = Number.NaN;
  let sheenPower = 0;
  let sheenAt = -0.4;
  const camLocal = new THREE.Vector3();
  const plane = new THREE.PlaneGeometry(1, 1);
  const places = new Map<string, Place>();
  let glyphs: Glyphs | null = null;
  let unit: Place | null = null;
  let pending: number | null = null;
  let shown: FigureGlyph[] = [];
  let width = 0;
  let scale = 1;
  let rowX = 0;
  let disposed = false;
  const lean = { y: 0, x: 0 };
  const aim = new THREE.Vector3();

  const material = (map: THREE.Texture, rows: number, fall: number, mask: THREE.Texture | null = null): { m: THREE.ShaderMaterial; u: Uniforms } => {
    const u: Uniforms = {
      uMap: { value: map },
      uMask: { value: mask },
      uSolid: { value: mask ? 1 : 0 },
      uDepth: { value: new THREE.Vector2() },
      uSpan: { value: new THREE.Vector2(0, 1) },
      uLight: light,
      uSheen: sheen,
      uRoll: { value: 0 },
      uRows: { value: rows },
      uOpacity: { value: 0 },
      uGlow: glow,
      uFall: { value: fall },
    };
    const m = new THREE.ShaderMaterial({
      uniforms: u,
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });
    return { m, u };
  };

  const placeFor = (g: FigureGlyph): Place | null => {
    if (!glyphs) return null;
    const have = places.get(g.key);
    if (have) return have;
    const { cell } = glyphs;
    const isPoint = g.kind === "point";
    const { m, u } = material(isPoint ? glyphs.point : glyphs.strip, isPoint ? 1 : 10, 1, isPoint ? glyphs.pointMask : glyphs.stripMask);
    const mesh = new THREE.Mesh(plane, m);
    mesh.renderOrder = -1;
    mesh.scale.set((FIGURE.height * (isPoint ? cell.pointW : cell.w)) / cell.h, FIGURE.height, 1);
    mesh.frustumCulled = false;
    row.add(mesh);
    const p: Place = { mesh, u, roll: 0, tween: null, x: 0, tx: 0, op: 0, target: 0 };
    p.x = Number.NaN;
    places.set(g.key, p);
    return p;
  };

  function apply(listens: number) {
    if (!glyphs) {
      pending = listens;
      return;
    }
    const now = performance.now();
    const before = shown.map((g) => (g.kind === "digit" ? g.value : ".")).join("");
    shown = figureGlyphs(listens);
    const after = shown.map((g) => (g.kind === "digit" ? g.value : ".")).join("");
    if (!reduced && before !== after) sweepStart = now + 260;
    const { cell } = glyphs;
    const k = FIGURE.height / cell.h;
    const layout = figureLayout(shown, { digit: cell.advance * k, point: cell.pointAdvance * k });
    // The words stand beside the last digit; the whole line (numerals and words) is centred.
    const words = unit ? unit.mesh.scale.x + FIGURE.unitGap : 0;
    width = layout.width + words;
    rowX = -words / 2;
    if (reduced) row.position.x = rowX;
    const keep = new Set<string>();
    let order = 0;
    for (const g of shown) {
      const p = placeFor(g);
      if (!p) continue;
      keep.add(g.key);
      p.tx = layout.xs[g.key];
      // A place that wasn't showing appears where it stands, instead of sliding in from the last spot.
      if (Number.isNaN(p.x) || p.op < 0.02) p.x = p.tx;
      p.target = 1;
      if (g.kind === "digit") {
        const to = rollTarget(p.tween ? p.tween.to : p.roll, g.value, g.turns);
        if (reduced) {
          p.roll = g.value;
          p.tween = null;
        } else if (to !== (p.tween ? p.tween.to : p.roll)) {
          const t = rollTiming(g.turns, order);
          p.tween = { from: p.roll, to, start: now + t.delayMs, dur: t.durationMs };
        }
        order++;
      }
      if (reduced) {
        p.x = p.tx;
        p.op = 1;
      }
    }
    for (const [key, p] of places) {
      if (keep.has(key)) continue;
      p.target = 0;
      if (reduced) p.op = 0;
    }
    if (unit) {
      unit.tx = layout.width / 2 + FIGURE.unitGap + unit.mesh.scale.x / 2;
      if (Number.isNaN(unit.x) || reduced) unit.x = unit.tx;
      unit.target = 1;
    }
  }

  // The glyphs need the page's Archivo, so they are drawn once it has loaded.
  const family = archivo(host);
  const ready = typeof document !== "undefined" && document.fonts?.load ? document.fonts.load(`700 ${FONT_PX}px ${family}`).catch(() => []) : Promise.resolve([]);
  void ready.then(() => {
    if (disposed) return;
    try {
      glyphs = drawGlyphs(family);
    } catch {
      return;
    }
    const { cell } = glyphs;
    const { m, u } = material(glyphs.unit, 1, 0);
    const mesh = new THREE.Mesh(plane, m);
    mesh.renderOrder = -1;
    mesh.frustumCulled = false;
    const uh = FIGURE.unit;
    mesh.scale.set((uh * cell.unitW) / cell.unitH, uh, 1);
    row.add(mesh);
    unit = { mesh, u, roll: 0, tween: null, x: Number.NaN, tx: 0, op: 0, target: 0 };
    group.visible = true;
    if (pending !== null) apply(pending);
    pending = null;
    onReady();
  });

  return {
    object: group,
    setListens(listens) {
      apply(listens);
    },
    update({ now, dt, pointer, camera, floorY }) {
      if (!glyphs) return false;
      let busy = false;
      const ease = (rate: number) => (reduced ? 1 : 1 - Math.exp(-dt * rate));

      // Fit the room's width at the figure's depth (phones), then float a little above the floor.
      const depth = Math.max(camera.position.z - FIGURE.z, 1);
      const roomWidth = 2 * Math.tan((camera.fov * Math.PI) / 360) * depth * camera.aspect;
      const fit = figureFit(width + 0.4, roomWidth * 0.86);
      const nextScale = scale + (fit - scale) * ease(6);
      busy ||= Math.abs(fit - nextScale) > 1e-4;
      scale = nextScale;
      group.scale.setScalar(scale);
      // The numerals' tops stand just under the top of the room at any size, so on a phone too they
      // rise clear of the discs (the numerals' tops are about 26 % down their cell).
      const bob = reduced ? 0 : Math.sin(now / 2600) * 0.06;
      aim.set(0, 1 - FIGURE.top * 2, 0.5).unproject(camera).sub(camera.position);
      const topY = camera.position.y + (aim.y * (FIGURE.z - camera.position.z)) / (aim.z || -1);
      group.position.y = Math.max(topY - FIGURE.height * 0.26 * scale, floorY + (FIGURE.height / 2) * scale) + bob;

      // Turned a little into the room, and toward the pointer while it is in.
      const ty = FIGURE.rotY + (pointer && !reduced ? pointer.x * 0.16 : 0);
      const tx = FIGURE.rotX + (pointer && !reduced ? pointer.y * 0.07 : 0);
      lean.y += (ty - lean.y) * ease(4);
      lean.x += (tx - lean.x) * ease(4);
      busy ||= Math.abs(ty - lean.y) > 1e-4 || Math.abs(tx - lean.x) > 1e-4;
      tilt.rotation.set(lean.x, lean.y, 0);
      row.position.x += (rowX - row.position.x) * ease(7);
      busy ||= Math.abs(rowX - row.position.x) > 1e-4;
      const glowTo = pointer ? 1.15 : 0.85;
      glow.value += (glowTo - glow.value) * ease(5);
      busy ||= Math.abs(glowTo - glow.value) > 1e-3;

      const move = (p: Place) => {
        if (p.tween) {
          const k = (now - p.tween.start) / Math.max(p.tween.dur, 1);
          if (k >= 1) {
            p.roll = p.tween.to;
            p.tween = null;
          } else if (k > 0) {
            p.roll = p.tween.from + (p.tween.to - p.tween.from) * rollEase(k);
          }
          busy = true;
        }
        p.x += (p.tx - p.x) * ease(7);
        p.op += (p.target - p.op) * ease(5);
        busy ||= Math.abs(p.tx - p.x) > 1e-4 || Math.abs(p.target - p.op) > 1e-3;
        p.mesh.visible = p.op > 0.004;
        p.mesh.position.x = p.x;
        p.u.uRoll.value = p.roll;
        p.u.uOpacity.value = p.op;
      };
      places.forEach(move);

      // The blocks' sides: where the back of each block lands on its face, seen from the camera
      // (true parallax, so the sides shift as the camera drifts with the pointer).
      group.updateMatrixWorld(true);
      row.worldToLocal(camLocal.copy(camera.position));
      const cz = Math.max(camLocal.z, 0.5);
      for (const p of places.values()) {
        const sx = p.mesh.scale.x;
        const sy = p.mesh.scale.y;
        const d = p.u.uDepth.value;
        d.set(((p.x - camLocal.x) / sx) * (FIGURE.depth / cz), ((p.mesh.position.y - camLocal.y) / sy) * (FIGURE.depth / cz));
        const len = d.length();
        if (len > 0.14) d.multiplyScalar(0.14 / len);
        p.u.uSpan.value.set(width > 0 ? (p.x - sx / 2 + (width - (unit ? unit.mesh.scale.x + FIGURE.unitGap : 0)) / 2) / width : 0, width > 0 ? sx / width : 1);
      }
      // The lamp's side, and the band of light: once across after a roll, else with the pointer.
      light.value.set(pointer ? pointer.x : 0.6, pointer ? -pointer.y : 0.7);
      let sheenTo = 0;
      let sheenTarget = sheenAt;
      if (!reduced && Number.isFinite(sweepStart)) {
        const k = (now - sweepStart) / FIGURE.sweepMs;
        if (k >= 1) sweepStart = Number.NaN;
        else if (k > 0) {
          sheenTarget = -0.3 + k * 1.6;
          sheenAt = sheenTarget;
          sheenTo = Math.sin(Math.PI * k);
        }
        busy = true;
      } else if (pointer && !reduced) {
        sheenTarget = pointer.x * 0.5 + 0.5;
        sheenTo = 0.55;
      }
      sheenAt += (sheenTarget - sheenAt) * ease(6);
      sheenPower += (sheenTo - sheenPower) * ease(Number.isFinite(sweepStart) ? 30 : 5);
      busy ||= Math.abs(sheenTo - sheenPower) > 1e-3 || Math.abs(sheenTarget - sheenAt) > 1e-3;
      sheen.value.set(sheenAt, sheenPower);

      if (unit) {
        move(unit);
        // Level with the numerals' tops (they fill about the middle 70 % of their cell), clear of the
        // discs in front.
        unit.mesh.position.y = FIGURE.height * 0.3 - unit.mesh.scale.y * 0.5;
      }
      return busy;
    },
    dispose() {
      disposed = true;
      places.forEach((p) => p.mesh.material.dispose());
      unit?.mesh.material.dispose();
      plane.dispose();
      if (glyphs) [glyphs.strip, glyphs.point, glyphs.stripMask, glyphs.pointMask, glyphs.unit].forEach((t) => t.dispose());
      group.removeFromParent();
    },
  };
}
