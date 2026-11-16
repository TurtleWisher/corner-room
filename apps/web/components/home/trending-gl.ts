/*
 * Trending Corner in WebGL (owner, 2026-11-15, D-TRENDING-02). The discs as real 3D objects, drawn
 * with three.js: no React in here. `trending-corner.tsx` loads this file only in a browser that can
 * draw WebGL (it is its own chunk, so the home page doesn't wait for it) and keeps the DOM discs as
 * the fallback and for keyboards and screen readers.
 *
 * Each disc is built like a real picture CD (lib/trending-scene-view.ts `DISC`): the hole, clear
 * polycarbonate round it with the raised stacking ring, the silver mirror band, the printed cover
 * under a clear lacquer, a thin clear rim, and the silver data side behind. The metal parts carry a
 * diffraction-grating shader: the rainbow streak a CD throws, worked out per pixel from the track
 * pitch (1.6 µm) and the lights, so it slides as the disc turns. Light comes from a studio built in
 * the Ember colours and baked into reflections, a key light and a lamp that follows the pointer.
 * The floor is a real mirror, blurred and fading like a gloss floor, with soft shadows under the
 * discs.
 *
 * The carousel's own positions, turns, drags and holds stay in the engine in trending-corner.tsx; the
 * scene reads them every frame and adds what only 3D can: discs leaning with the travel and
 * wobbling to rest, a pointed-at disc lifting and tilting toward the pointer, a twinkle on its rim,
 * the camera drifting with the pointer. Nothing draws while the section is off screen or the tab is
 * hidden. Reduced motion: no spin, no drift, no wobble; it draws only when something changes.
 */
import * as THREE from "three";
import { Reflector } from "three/addons/objects/Reflector.js";

import {
  DISC,
  FLOAT_GAP,
  cameraFrame,
  canvasDpr,
  leanFor,
  printTone,
  spinAngle,
  spinRate,
  springAtRest,
  springStep,
  tiltToward,
  twinkle,
  worldPose,
} from "@/lib/trending-scene-view";
import { offsetOf } from "@/lib/trending-view";

export type SceneEngine = {
  snapshot(): { pos: number; speed: number; moving: boolean; dragging: boolean; boosted: boolean; playingFront: number | null; paused: boolean };
  subscribe(fn: () => void): () => void;
  pick(i: number): void;
};

export type SceneDisc = { title: string; cover: string | null };

export type TrendingScene = {
  /** A disc's DOM button took or lost keyboard focus (a blur only clears its own disc). */
  setFocus(i: number, on: boolean): void;
  destroy(): void;
};

const EMBER = {
  lamp: new THREE.Color("#fcf475"),
  glow: new THREE.Color("#ff5a4e"),
  signal: new THREE.Color("#b21f24"),
  night: new THREE.Color("#120607"),
  plain: new THREE.Color("#1a0b0b"),
};

/* ---------- the CD diffraction shader (added to MeshPhysicalMaterial) ---------- */

type GratingUniforms = {
  uKeyDir: { value: THREE.Vector3 };
  uKeyColor: { value: THREE.Color };
  uLampPos: { value: THREE.Vector3 };
  uLampColor: { value: THREE.Color };
};

const GRATING_VERTEX_PARS = /* glsl */ `
varying vec3 vRadialView;
`;
const GRATING_VERTEX = /* glsl */ `
{
  vec3 radialObj = vec3(position.xy, 0.0);
  radialObj = length(radialObj) > 1e-5 ? normalize(radialObj) : vec3(1.0, 0.0, 0.0);
  vRadialView = normalize((modelViewMatrix * vec4(radialObj, 0.0)).xyz);
}
`;
const GRATING_FRAGMENT_PARS = /* glsl */ `
uniform vec3 uKeyDir;
uniform vec3 uKeyColor;
uniform vec3 uLampPos;
uniform vec3 uLampColor;
uniform float uGrating;
varying vec3 vRadialView;

// Visible spectrum to linear RGB (Zucconi's fit), zero outside 380 to 720 nm.
vec3 crSpectral(float w) {
  float inside = step(380.0, w) * step(w, 720.0);
  float x = clamp((w - 400.0) / 300.0, 0.0, 1.0);
  const vec3 cs = vec3(3.54541723, 2.86670055, 2.29421995);
  const vec3 xs = vec3(0.69548916, 0.49416934, 0.28269708);
  const vec3 ys = vec3(0.02320775, 0.15936245, 0.53520021);
  vec3 b = cs * (x - xs);
  return clamp(vec3(1.0) - b * b - ys, 0.0, 1.0) * inside;
}

// A reflection grating with circular grooves 1600 nm apart: light leaves at the angles where
// d (sin in + sin out) = m λ, measured across the grooves; along them it stays a thin streak.
vec3 crGrating(vec3 L, vec3 V, vec3 N, vec3 R, vec3 T) {
  float nl = dot(N, L);
  if (nl <= 0.0 || dot(N, V) <= 0.0) return vec3(0.0);
  vec3 H = L + V;
  float across = abs(dot(H, R));
  float along = dot(H, T);
  float streak = exp(-along * along * 38.0);
  vec3 c = vec3(0.0);
  for (int m = 1; m <= 3; m++) {
    c += crSpectral(across * 1600.0 / float(m)) / float(m);
  }
  return c * streak * nl;
}
`;
const GRATING_FRAGMENT = /* glsl */ `
{
  vec3 gN = normalize(normal);
  vec3 gV = normalize(vViewPosition);
  vec3 gR = vRadialView - gN * dot(vRadialView, gN);
  gR = length(gR) > 1e-5 ? normalize(gR) : vec3(1.0, 0.0, 0.0);
  vec3 gT = cross(gN, gR);
  vec3 lampL = normalize(uLampPos + vViewPosition);
  vec3 rainbow = crGrating(normalize(uKeyDir), gV, gN, gR, gT) * uKeyColor
    + crGrating(lampL, gV, gN, gR, gT) * uLampColor;
  outgoingLight += rainbow * uGrating;
}
#include <opaque_fragment>
`;

function withGrating(material: THREE.MeshPhysicalMaterial, shared: GratingUniforms, strength: { value: number }): THREE.MeshPhysicalMaterial {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared, { uGrating: strength });
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${GRATING_VERTEX_PARS}`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>\n${GRATING_VERTEX}`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${GRATING_FRAGMENT_PARS}`)
      .replace("#include <opaque_fragment>", GRATING_FRAGMENT);
  };
  material.customProgramCacheKey = () => "cr-cd-grating";
  return material;
}

/* ---------- the blurred gloss floor ---------- */

const FLOOR_SHADER = {
  name: "CornerRoomGlossFloor",
  uniforms: {
    color: { value: null as THREE.Color | null },
    tDiffuse: { value: null as THREE.Texture | null },
    textureMatrix: { value: null as THREE.Matrix4 | null },
    uBlur: { value: 0.006 },
    uStrength: { value: 0.34 },
    uTint: { value: new THREE.Color("#1a0909") },
  },
  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix;
    varying vec4 vUv;
    varying vec2 vLocal;
    varying vec3 vWorld;
    #include <common>
    #include <logdepthbuf_pars_vertex>
    void main() {
      vUv = textureMatrix * vec4(position, 1.0);
      vLocal = uv;
      vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      #include <logdepthbuf_vertex>
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 color;
    uniform sampler2D tDiffuse;
    uniform float uBlur;
    uniform float uStrength;
    uniform vec3 uTint;
    varying vec4 vUv;
    varying vec2 vLocal;
    varying vec3 vWorld;
    #include <logdepthbuf_pars_fragment>
    void main() {
      #include <logdepthbuf_fragment>
      // A gloss floor, not a mirror: a soft blur that grows away from where the discs stand.
      float spread = uBlur * (0.6 + 1.8 * clamp(1.0 - vLocal.y, 0.0, 1.0));
      vec4 sum = vec4(0.0);
      const int TAPS = 12;
      for (int i = 0; i < TAPS; i++) {
        float a = float(i) * 2.39996323;
        float r = sqrt((float(i) + 0.5) / float(TAPS));
        vec2 o = vec2(cos(a), sin(a)) * r * spread;
        sum += texture2DProj(tDiffuse, vUv + vec4(o * vUv.w, 0.0, 0.0));
      }
      vec4 refl = sum / float(TAPS);
      // Stronger at a glancing look (Fresnel), fading toward the floor's edges and the viewer.
      vec3 toEye = normalize(cameraPosition - vWorld);
      float fres = 0.35 + 0.65 * pow(1.0 - clamp(toEye.y, 0.0, 1.0), 3.0);
      float side = smoothstep(0.0, 0.28, vLocal.x) * smoothstep(1.0, 0.72, vLocal.x);
      float depth = smoothstep(0.0, 0.35, vLocal.y) * smoothstep(1.0, 0.7, vLocal.y);
      float fade = side * depth;
      vec3 rgb = mix(uTint, refl.rgb * color, clamp(refl.a * uStrength * fres * 1.6, 0.0, 1.0));
      float alpha = clamp(0.24 + refl.a * uStrength * fres, 0.0, 1.0) * fade;
      gl_FragColor = vec4(rgb, alpha);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
};

/* ---------- little textures drawn once ---------- */

function canvasTexture(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void, colorSpace: THREE.ColorSpace = THREE.SRGBColorSpace): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const g = c.getContext("2d");
  if (g) draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = colorSpace;
  return t;
}

/** The disc's groove direction per pixel (round the centre), for the metal's brushed highlight. */
function grooveDirections(): THREE.DataTexture {
  const s = 128;
  const data = new Uint8Array(s * s * 4);
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const u = (x + 0.5) / s - 0.5;
      const v = (y + 0.5) / s - 0.5;
      const len = Math.hypot(u, v) || 1;
      const i = (y * s + x) * 4;
      data[i] = Math.round(((-v / len) * 0.5 + 0.5) * 255);
      data[i + 1] = Math.round(((u / len) * 0.5 + 0.5) * 255);
      data[i + 2] = 255;
      data[i + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, s, s, THREE.RGBAFormat);
  t.colorSpace = THREE.NoColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

function softShadow(): THREE.CanvasTexture {
  return canvasTexture(128, (g, s) => {
    const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    r.addColorStop(0, "rgba(0,0,0,0.9)");
    r.addColorStop(0.45, "rgba(0,0,0,0.45)");
    r.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = r;
    g.fillRect(0, 0, s, s);
  });
}

function lightPool(): THREE.CanvasTexture {
  return canvasTexture(256, (g, s) => {
    const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    r.addColorStop(0, "rgba(252,244,117,0.32)");
    r.addColorStop(0.42, "rgba(255,90,78,0.16)");
    r.addColorStop(1, "rgba(255,90,78,0)");
    g.fillStyle = r;
    g.fillRect(0, 0, s, s);
  });
}

/** A four-point star of lamp light, for the twinkle. */
function starTexture(): THREE.CanvasTexture {
  return canvasTexture(128, (g, s) => {
    const c = s / 2;
    const glow = g.createRadialGradient(c, c, 0, c, c, c);
    glow.addColorStop(0, "rgba(255,255,255,1)");
    glow.addColorStop(0.12, "rgba(252,244,117,0.85)");
    glow.addColorStop(0.4, "rgba(252,244,117,0.12)");
    glow.addColorStop(1, "rgba(252,244,117,0)");
    g.fillStyle = glow;
    g.fillRect(0, 0, s, s);
    g.globalCompositeOperation = "lighter";
    for (const [w, h] of [
      [s, s * 0.05],
      [s * 0.05, s],
    ]) {
      const ray = g.createRadialGradient(c, c, 0, c, c, c);
      ray.addColorStop(0, "rgba(255,255,255,0.95)");
      ray.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = ray;
      g.beginPath();
      g.ellipse(c, c, w / 2, h / 2, 0, 0, Math.PI * 2);
      g.fill();
    }
  });
}

/** A disc with no cover: the title on the Signal red, as the DOM disc draws it. */
function titleTexture(title: string, font: string): THREE.CanvasTexture {
  return canvasTexture(1024, (g, s) => {
    const bg = g.createRadialGradient(s * 0.35, s * 0.3, 0, s * 0.35, s * 0.3, s * 0.8);
    bg.addColorStop(0, "#b21f24");
    bg.addColorStop(0.6, "#831515");
    bg.addColorStop(1, "#3b0909");
    g.fillStyle = bg;
    g.fillRect(0, 0, s, s);
    g.fillStyle = "#f6ece6";
    g.textAlign = "center";
    g.textBaseline = "middle";
    const size = Math.round(s * 0.075);
    g.font = `800 ${size}px ${font}`;
    const words = title.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let line = "";
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (g.measureText(next).width > s * 0.5 && line) {
        lines.push(line);
        line = w;
      } else line = next;
    }
    if (line) lines.push(line);
    const shown = lines.slice(0, 3);
    const top = s * 0.27 - ((shown.length - 1) * size * 1.1) / 2;
    shown.forEach((l, i) => g.fillText(l, s / 2, top + i * size * 1.1, s * 0.56));
  });
}

/** The studio the discs reflect: a dark room with soft boxes in the Ember colours. */
function studio(renderer: THREE.WebGLRenderer): THREE.Texture {
  const env = new THREE.Scene();
  const box = new THREE.BoxGeometry(1, 1, 1);
  const room = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: new THREE.Color("#140708"), side: THREE.BackSide }));
  room.scale.set(40, 20, 40);
  env.add(room);
  const panels: THREE.Mesh[] = [];
  const panel = (color: THREE.ColorRepresentation, power: number, at: [number, number, number], size: [number, number, number]) => {
    const m = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(power) }));
    m.position.set(...at);
    m.scale.set(...size);
    env.add(m);
    panels.push(m);
  };
  panel("#fff2e2", 3.2, [-5, 7, 7], [7, 0.3, 4]); // the big warm key overhead, front left
  // A soft box just where the front disc mirrors it (a little above its middle, to the left): the
  // gloss line across the lacquer, which slides away as a disc turns or tilts.
  panel("#ffffff", 14, [-1.1, 0.45, 10], [2.6, 0.32, 0.2]);
  panel("#ffffff", 2.4, [0, 4.6, 10], [12, 1.4, 0.3]); // a long strip above the viewer
  panel("#fcf475", 1.6, [9, 1.5, -4], [0.3, 7, 3]); // lamp yellow strip behind on the right: rims, not faces
  panel("#ff5a4e", 3.6, [-9, 0.5, -2], [0.3, 6, 7]); // Ember glow rim, back left
  panel("#b21f24", 1.4, [0, -8, 0], [24, 0.3, 24]); // the red floor's bounce
  panel("#ffe9d0", 1.6, [7, 6, -8], [5, 0.3, 4]); // a back top fill
  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(env, 0.035);
  pmrem.dispose();
  box.dispose();
  (room.material as THREE.Material).dispose();
  panels.forEach((p) => (p.material as THREE.Material).dispose());
  return target.texture;
}

/** A flat ring with picture coordinates across the whole disc (so the cover spans the face). */
function ring(inner: number, outer: number, segments: number, back = false): THREE.BufferGeometry {
  const g = new THREE.RingGeometry(inner, outer, segments, 2);
  if (back) g.rotateY(Math.PI);
  const p = g.getAttribute("position");
  const uv = g.getAttribute("uv");
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) * 0.5 + 0.5, p.getY(i) * 0.5 + 0.5);
  uv.needsUpdate = true;
  return g;
}

type DiscParts = {
  pose: THREE.Group;
  hover: THREE.Group;
  spin: THREE.Group;
  hit: THREE.Mesh;
  print: THREE.MeshPhysicalMaterial;
  metal: THREE.MeshPhysicalMaterial[];
  glass: THREE.MeshPhysicalMaterial[];
  focusRing: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
  star: THREE.Sprite;
  shadow: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  angle: number;
  lift: [number, number];
  tiltX: [number, number];
  tiltY: [number, number];
  focus: [number, number];
  twinkleAt: number;
  texture: THREE.Texture | null;
};

export function createTrendingScene({
  host,
  discs,
  engine,
  labels,
  measure,
  reduced,
  onReady,
  onLost,
}: {
  host: HTMLElement;
  discs: SceneDisc[];
  engine: SceneEngine;
  labels: (HTMLElement | null)[];
  measure: () => { discPx: number; discCenterPx: number };
  reduced: boolean;
  onReady: () => void;
  onLost: () => void;
}): TrendingScene | null {
  const n = discs.length;
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
  } catch {
    return null;
  }
  const canvas = renderer.domElement;
  canvas.className = "tc-gl";
  canvas.setAttribute("aria-hidden", "true");
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.04;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  host.prepend(canvas);

  const scene = new THREE.Scene();
  const envMap = studio(renderer);
  scene.environment = envMap;
  scene.environmentIntensity = 0.8;

  const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 80);
  // Things lying on the floor (shadows, the light pool) are seen by the camera but not reflected.
  const ON_FLOOR = 1;
  camera.layers.enable(ON_FLOOR);

  // Lights: a warm key, the Ember rim from behind, and a lamp that follows the pointer.
  const key = new THREE.DirectionalLight("#fff1e0", 1.05);
  key.position.set(-3, 4, 6);
  const rim = new THREE.DirectionalLight(EMBER.glow, 1.1);
  rim.position.set(-4, 1.2, -5);
  const lamp = new THREE.PointLight(EMBER.lamp, 0, 0, 2);
  lamp.position.set(1.6, 1.2, 2.4);
  scene.add(key, rim, lamp);

  const grating: GratingUniforms = {
    uKeyDir: { value: new THREE.Vector3() },
    uKeyColor: { value: new THREE.Color("#fff1e0").multiplyScalar(1.15) },
    uLampPos: { value: new THREE.Vector3() },
    uLampColor: { value: EMBER.lamp.clone().multiplyScalar(0) },
  };

  // Shared shapes and textures.
  const SEG = 160;
  const t2 = DISC.thickness / 2;
  const geo = {
    print: ring(DISC.mirrorOuter, DISC.printOuter, SEG),
    mirror: ring(DISC.clearOuter, DISC.mirrorOuter, SEG),
    hubFront: ring(DISC.hole, DISC.clearOuter, 96),
    rimFront: ring(DISC.printOuter, DISC.rim, SEG),
    back: ring(DISC.clearOuter, DISC.printOuter, SEG, true),
    hubBack: ring(DISC.hole, DISC.clearOuter, 96, true),
    rimBack: ring(DISC.printOuter, DISC.rim, SEG, true),
    edge: new THREE.CylinderGeometry(DISC.rim, DISC.rim, DISC.thickness, SEG, 1, true).rotateX(Math.PI / 2),
    holeEdge: new THREE.CylinderGeometry(DISC.hole, DISC.hole, DISC.thickness, 64, 1, true).rotateX(Math.PI / 2),
    stack: new THREE.LatheGeometry(
      [
        new THREE.Vector2(DISC.stackInner, 0),
        new THREE.Vector2((DISC.stackInner * 2 + DISC.stackOuter) / 3, DISC.stackHeight),
        new THREE.Vector2((DISC.stackInner + DISC.stackOuter * 2) / 3, DISC.stackHeight),
        new THREE.Vector2(DISC.stackOuter, 0),
      ],
      96,
    ).rotateX(Math.PI / 2),
    hit: new THREE.CircleGeometry(DISC.rim * 1.02, 48),
    focus: new THREE.TorusGeometry(DISC.rim * 1.075, 0.014, 10, 160),
    shadow: new THREE.PlaneGeometry(2.6, 0.7).rotateX(-Math.PI / 2),
  };
  const grooves = grooveDirections();
  const shadowTex = softShadow();
  const poolTex = lightPool();
  const starTex = starTexture();
  const blank = new THREE.DataTexture(new Uint8Array([26, 11, 11, 255]), 1, 1, THREE.RGBAFormat);
  blank.colorSpace = THREE.SRGBColorSpace;
  blank.needsUpdate = true;
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const font = getComputedStyle(host).fontFamily || "sans-serif";

  const gratingStrength = { value: 1 };

  function metalMaterial(): THREE.MeshPhysicalMaterial {
    return withGrating(
      new THREE.MeshPhysicalMaterial({
        color: new THREE.Color("#e4e7ee"),
        metalness: 1,
        roughness: 0.16,
        anisotropy: 0.75,
        anisotropyMap: grooves,
        iridescence: 0.55,
        iridescenceIOR: 1.58,
        iridescenceThicknessMinimum: 260,
        iridescenceThicknessMaximum: 820,
        clearcoat: 1,
        clearcoatRoughness: 0.03,
        transparent: true,
      }),
      grating,
      gratingStrength,
    );
  }
  function glassMaterial(opacity: number, side: THREE.Side = THREE.FrontSide): THREE.MeshPhysicalMaterial {
    const m = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color("#eef3ff"),
      metalness: 0,
      roughness: 0.05,
      clearcoat: 1,
      clearcoatRoughness: 0.02,
      ior: 1.585,
      specularIntensity: 1,
      transparent: true,
      opacity,
      depthWrite: false,
      side,
    });
    m.userData.baseOpacity = opacity;
    return m;
  }

  const parts: DiscParts[] = discs.map((d) => {
    const pose = new THREE.Group();
    const hover = new THREE.Group();
    const spin = new THREE.Group();
    pose.add(hover);
    hover.add(spin);

    const print = new THREE.MeshPhysicalMaterial({
      map: blank,
      color: new THREE.Color(1, 1, 1),
      roughness: 0.5,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
      specularIntensity: 0.5,
      transparent: true,
    });
    const mirror = metalMaterial();
    const back = metalMaterial();
    const hubGlass = glassMaterial(0.26);
    const hubGlassBack = glassMaterial(0.2);
    const stackGlass = glassMaterial(0.5);
    const rimGlass = glassMaterial(0.55);
    const rimGlassBack = glassMaterial(0.45);
    const holeGlass = glassMaterial(0.5, THREE.BackSide);
    const edgeMetal = new THREE.MeshPhysicalMaterial({ color: new THREE.Color("#d9dee8"), metalness: 0.7, roughness: 0.22, clearcoat: 1, transparent: true });

    const add = (g: THREE.BufferGeometry, m: THREE.Material, z: number, order = 0) => {
      const mesh = new THREE.Mesh(g, m);
      mesh.position.z = z;
      mesh.renderOrder = order;
      spin.add(mesh);
      return mesh;
    };
    add(geo.print, print, t2);
    add(geo.mirror, mirror, t2);
    add(geo.back, back, -t2);
    add(geo.edge, edgeMetal, 0);
    add(geo.hubBack, hubGlassBack, -t2, 1);
    add(geo.rimBack, rimGlassBack, -t2, 1);
    add(geo.holeEdge, holeGlass, 0, 1);
    add(geo.hubFront, hubGlass, t2, 2);
    add(geo.stack, stackGlass, t2, 2);
    add(geo.rimFront, rimGlass, t2 + 0.0005, 2);

    const hit = new THREE.Mesh(geo.hit, new THREE.MeshBasicMaterial({ visible: false }));
    hover.add(hit);

    const focusRing = new THREE.Mesh(geo.focus, new THREE.MeshBasicMaterial({ color: EMBER.lamp, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
    hover.add(focusRing);

    const star = new THREE.Sprite(new THREE.SpriteMaterial({ map: starTex, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    star.position.set(0.66, 0.68, 0.06);
    star.scale.setScalar(0.001);
    hover.add(star);

    const shadow = new THREE.Mesh(geo.shadow, new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.6, toneMapped: false }));
    shadow.layers.set(ON_FLOOR);
    scene.add(shadow);
    scene.add(pose);

    return {
      pose,
      hover,
      spin,
      hit,
      print,
      metal: [mirror, back, edgeMetal],
      glass: [hubGlass, hubGlassBack, stackGlass, rimGlass, rimGlassBack, holeGlass],
      focusRing,
      star,
      shadow,
      angle: (d.title.length * 0.37) % (Math.PI * 2),
      lift: [0, 0],
      tiltX: [0, 0],
      tiltY: [0, 0],
      focus: [0, 0],
      twinkleAt: -1e9,
      texture: null,
    };
  });
  parts.forEach((p, i) => (p.hit.userData.index = i));

  // The floor: a blurred mirror, a pool of lamp light where the front disc stands.
  const floorY = -1 - FLOAT_GAP;
  const floor = new Reflector(new THREE.PlaneGeometry(16, 10), {
    color: new THREE.Color("#c9c2c2"),
    textureWidth: 512,
    textureHeight: 256,
    clipBias: 0.002,
    multisample: 4,
    shader: FLOOR_SHADER,
  });
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, floorY, -1);
  floor.getReflectionCamera(camera).layers.disable(ON_FLOOR);
  const floorMaterial = floor.material as THREE.ShaderMaterial;
  floorMaterial.transparent = true;
  floorMaterial.depthWrite = false;
  floor.renderOrder = -2;
  scene.add(floor);

  const pool = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 2.6).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  pool.position.set(0, floorY + 0.003, 0.15);
  pool.layers.set(ON_FLOOR);
  pool.renderOrder = -1;
  scene.add(pool);

  /* ---------- covers ---------- */

  // The draw loop's state (the loop itself is below); covers can arrive before it starts.
  let raf = 0;
  let last = 0;
  let readySent = false;
  let lastPos = Number.NaN;
  let destroyed = false;
  const setTexture = (p: DiscParts, t: THREE.Texture) => {
    if (destroyed) {
      t.dispose();
      return;
    }
    t.anisotropy = maxAniso;
    t.colorSpace = THREE.SRGBColorSpace;
    p.texture = t;
    p.print.map = t;
    wake();
  };
  discs.forEach((d, i) => {
    const p = parts[i];
    if (!d.cover) {
      setTexture(p, titleTexture(d.title, font));
      return;
    }
    void (async () => {
      try {
        // Fetched as bytes (as the story cards do), so the picture can go onto the GPU.
        const res = await fetch(d.cover as string);
        if (!res.ok) throw new Error("cover");
        const bitmap = await createImageBitmap(await res.blob(), { imageOrientation: "flipY" });
        const t = new THREE.Texture(bitmap);
        t.flipY = false;
        t.generateMipmaps = true;
        t.minFilter = THREE.LinearMipmapLinearFilter;
        t.needsUpdate = true;
        setTexture(p, t);
      } catch {
        setTexture(p, titleTexture(d.title, font));
      }
    })();
  });

  /* ---------- size and framing ---------- */

  let width = 1;
  let height = 1;
  let lookY = 0;
  let distance = 8;
  const resize = () => {
    width = Math.max(host.clientWidth, 1);
    height = Math.max(host.clientHeight, 1);
    const dpr = canvasDpr(window.devicePixelRatio, width);
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    const m = measure();
    const f = cameraFrame({ heightPx: height, discPx: m.discPx, discCenterPx: m.discCenterPx, fov: 26 });
    camera.fov = f.fov;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    lookY = f.lookY;
    distance = f.distance;
    floor.getRenderTarget().setSize(Math.round(width * dpr * 0.5), Math.round(height * dpr * 0.5));
    wake();
  };
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
  ro?.observe(host);
  resize();

  /* ---------- the pointer ---------- */

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const local = new THREE.Vector3();
  let pointerIn = false;
  let pointer = { x: 0, y: 0 };
  let hovered: number | null = null;
  let focused: number | null = null;
  let hoverUV = { u: 0, v: 0 };
  const camDrift: { x: [number, number]; y: [number, number] } = { x: [0, 0], y: [0, 0] };
  let lampPower: [number, number] = [0.25, 0];
  let lean: [number, number] = [0, 0];

  const hitAt = (clientX: number, clientY: number): { index: number; u: number; v: number } | null => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(
      parts.filter((p) => p.pose.visible && (p.pose.userData.opacity ?? 1) > 0.5).map((p) => p.hit),
      false,
    );
    const first = hits[0];
    if (!first) return null;
    const index = first.object.userData.index as number;
    local.copy(first.point);
    parts[index].hover.worldToLocal(local);
    return { index, u: local.x, v: local.y };
  };

  const onMove = (e: PointerEvent) => {
    const r = host.getBoundingClientRect();
    pointer = { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: ((e.clientY - r.top) / r.height) * 2 - 1 };
    pointerIn = true;
    const snap = engine.snapshot();
    if (e.pointerType === "touch" || snap.dragging) {
      setHovered(null);
    } else {
      const hit = hitAt(e.clientX, e.clientY);
      setHovered(hit ? hit.index : null);
      if (hit) hoverUV = { u: hit.u, v: hit.v };
    }
    wake();
  };
  const onLeave = () => {
    pointerIn = false;
    setHovered(null);
    wake();
  };
  const onClick = (e: MouseEvent) => {
    const hit = hitAt(e.clientX, e.clientY);
    if (hit) engine.pick(hit.index);
  };
  function setHovered(i: number | null) {
    if (i === hovered) return;
    hovered = i;
    if (i !== null) parts[i].twinkleAt = performance.now();
    host.style.cursor = i !== null ? "pointer" : "";
  }
  host.addEventListener("pointermove", onMove);
  host.addEventListener("pointerleave", onLeave);
  host.addEventListener("click", onClick);

  /* ---------- the loop ---------- */

  const project = new THREE.Vector3();
  const keyView = new THREE.Vector3();
  const lampView = new THREE.Vector3();
  const lampTarget = new THREE.Vector3();

  function wake() {
    if (destroyed || raf) return;
    if (engine.snapshot().paused) return;
    last = 0;
    raf = requestAnimationFrame(frame);
  }
  const unsubscribe = engine.subscribe(wake);

  const onLostContext = (e: Event) => {
    e.preventDefault();
    onLost();
  };
  canvas.addEventListener("webglcontextlost", onLostContext);

  function frame(t: number) {
    raf = 0;
    if (destroyed) return;
    const snap = engine.snapshot();
    if (snap.paused) return;
    const dt = last ? Math.min((t - last) / 1000, 0.1) : 1 / 60;
    last = t;
    const now = performance.now();
    let busy = snap.moving || snap.pos !== lastPos;
    lastPos = snap.pos;

    // The ring leans against its travel and wobbles to rest.
    const leanTarget = reduced ? 0 : snap.moving ? leanFor(snap.speed) : 0;
    lean = springStep(lean[0], lean[1], leanTarget, dt, 90, 7);
    busy ||= !springAtRest(lean[0], lean[1], leanTarget);

    // The camera drifts a little with the pointer; the lamp follows it.
    const driftX = reduced || !pointerIn ? 0 : pointer.x * 0.22;
    const driftY = reduced || !pointerIn ? 0 : pointer.y * 0.1;
    camDrift.x = springStep(camDrift.x[0], camDrift.x[1], driftX, dt, 40, 12);
    camDrift.y = springStep(camDrift.y[0], camDrift.y[1], driftY, dt, 40, 12);
    busy ||= !springAtRest(camDrift.x[0], camDrift.x[1], driftX) || !springAtRest(camDrift.y[0], camDrift.y[1], driftY);
    const elev = distance * Math.tan((4.5 * Math.PI) / 180);
    camera.position.set(camDrift.x[0], lookY + elev - camDrift.y[0], distance);
    camera.lookAt(camDrift.x[0] * 0.35, lookY, 0);
    camera.updateMatrixWorld();

    const lampOn = pointerIn ? 1 : 0.25;
    lampPower = springStep(lampPower[0], lampPower[1], lampOn, dt, 30, 11);
    busy ||= !springAtRest(lampPower[0], lampPower[1], lampOn);
    lampTarget.set(pointerIn ? pointer.x * 3.2 : 1.6, pointerIn ? 0.4 - pointer.y * 1.6 : 1.2, 2.4);
    lamp.position.lerp(lampTarget, reduced ? 1 : 1 - Math.exp(-dt * 10));
    lamp.intensity = lampPower[0] * 7;
    grating.uLampColor.value.copy(EMBER.lamp).multiplyScalar(lampPower[0] * 1.4);
    keyView.copy(key.position).normalize().transformDirection(camera.matrixWorldInverse);
    grating.uKeyDir.value.copy(keyView);
    lampView.copy(lamp.position).applyMatrix4(camera.matrixWorldInverse);
    grating.uLampPos.value.copy(lampView);

    for (let i = 0; i < n; i++) {
      const p = parts[i];
      const d = offsetOf(i, snap.pos, n);
      const w = worldPose(d, n);
      // Pointed at or focused: lift, tilt toward the pointer, twinkle once. Every disc's springs
      // move each frame, seen or not, so none is left lifted or ringed after turning away.
      const isHover = hovered === i;
      const isFocus = focused === i;
      const liftTarget = isHover ? 1 : isFocus ? 0.75 : 0;
      const tilt = isHover && !reduced ? tiltToward(hoverUV.u, hoverUV.v) : { x: 0, y: 0 };
      p.lift = springStep(p.lift[0], p.lift[1], liftTarget, dt, reduced ? 400 : 160, reduced ? 40 : 15);
      p.tiltX = springStep(p.tiltX[0], p.tiltX[1], tilt.x, dt, 120, 13);
      p.tiltY = springStep(p.tiltY[0], p.tiltY[1], tilt.y, dt, 120, 13);
      p.focus = springStep(p.focus[0], p.focus[1], isFocus ? 1 : 0, dt, 200, 24);
      busy ||=
        !springAtRest(p.lift[0], p.lift[1], liftTarget) ||
        !springAtRest(p.tiltX[0], p.tiltX[1], tilt.x) ||
        !springAtRest(p.tiltY[0], p.tiltY[1], tilt.y) ||
        !springAtRest(p.focus[0], p.focus[1], isFocus ? 1 : 0);

      const visible = w.opacity > 0.01;
      p.pose.visible = visible;
      p.pose.userData.opacity = w.opacity;
      p.shadow.visible = visible;
      if (!visible) {
        const label = labels[i];
        if (label) label.style.opacity = "0";
        continue;
      }

      const bob = !reduced && Math.abs(d) < 0.5 ? Math.sin(now / 900 + i) * 0.018 : 0;
      const y = -1 + w.scale + p.lift[0] * 0.16 + bob;
      p.pose.position.set(w.x, y, w.z);
      p.pose.rotation.set(0, w.rotY + lean[0] * (1 - Math.min(Math.abs(d), 1) * 0.35), 0);
      p.pose.scale.setScalar(w.scale * (1 + p.lift[0] * 0.045));
      p.hover.rotation.set(p.tiltX[0], p.tiltY[0], 0);

      if (!reduced) {
        const rate = spinRate({ boosted: snap.boosted, speed: snap.speed, playing: snap.playingFront === i });
        p.angle = (p.angle - spinAngle(dt, rate)) % (Math.PI * 2);
      }
      p.spin.rotation.z = p.angle;

      const tone = printTone(w.shade);
      p.print.color.setScalar(tone);
      p.print.opacity = w.opacity;
      for (const m of p.metal) {
        m.opacity = w.opacity;
        m.envMapIntensity = tone;
        m.color.setScalar(0.9 * tone);
      }
      for (const m of p.glass) m.opacity = (m.userData.baseOpacity as number) * w.opacity;
      p.focusRing.material.opacity = p.focus[0] * w.opacity;
      p.focusRing.visible = p.focus[0] > 0.01;

      const tw = reduced ? 0 : twinkle(now - p.twinkleAt);
      if (tw > 0) busy = true;
      p.star.material.opacity = tw * w.opacity;
      p.star.material.rotation = (now - p.twinkleAt) / 900;
      p.star.scale.setScalar(0.001 + tw * 0.62);

      // A soft shadow on the floor under the disc, lighter as it lifts.
      p.shadow.position.set(w.x, floorY + 0.002, w.z + 0.05);
      p.shadow.rotation.y = w.rotY;
      p.shadow.scale.set(w.scale, 1, w.scale);
      p.shadow.material.opacity = 0.55 * w.opacity * (1 - p.lift[0] * 0.45);

      // The words under the disc follow it on screen.
      const label = labels[i];
      if (label) {
        p.pose.updateMatrixWorld();
        project.set(0, -1.08, 0);
        p.pose.localToWorld(project);
        project.y = Math.max(project.y, floorY);
        project.project(camera);
        const sx = (project.x * 0.5 + 0.5) * width;
        const sy = (-project.y * 0.5 + 0.5) * height;
        label.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0) translateX(-50%) scale(${w.scale.toFixed(3)})`;
        label.style.opacity = (w.label * w.opacity).toFixed(3);
      }
    }

    renderer.render(scene, camera);
    if (!readySent) {
      readySent = true;
      onReady();
    }
    if (!reduced || busy) raf = requestAnimationFrame(frame);
  }

  wake();

  return {
    setFocus(i, on) {
      if (on) focused = i;
      else if (focused === i) focused = null;
      wake();
    },
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      unsubscribe();
      ro?.disconnect();
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerleave", onLeave);
      host.removeEventListener("click", onClick);
      canvas.removeEventListener("webglcontextlost", onLostContext);
      host.style.cursor = "";
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.Sprite) {
          const m = o.material as THREE.Material | THREE.Material[];
          (Array.isArray(m) ? m : [m]).forEach((x) => x.dispose());
        }
      });
      Object.values(geo).forEach((g) => g.dispose());
      pool.geometry.dispose();
      floor.dispose();
      parts.forEach((p) => p.texture?.dispose());
      [grooves, shadowTex, poolTex, starTex, blank, envMap].forEach((t) => t.dispose());
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}
