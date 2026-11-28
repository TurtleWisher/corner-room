/*
 * The Wrap's carnival light (owner, 2026-11-28, D-WRAP-01): one WebGL canvas behind the story that
 * draws a pool of light from a corner, slow sunburst rays like a fairground tent and a soft swirl,
 * then dithers it into the four brand tones of the card's world, cell by cell (an 8 x 8 ordered
 * Bayer dither, or interleaved-gradient grain). Every pixel is exactly one tone of one world: a
 * change of card flips pixels from one world to the other by their own threshold, so the worlds
 * never blend (brand D1). The light leans toward the pointer. Plain WebGL, no three.js.
 *
 * Moves only while the page is visible and motion is allowed; "STILL" and reduced motion draw one
 * frame. Without WebGL the CSS backdrop under it (wrap.css) stays.
 */

import { WORLD_TONES, hexToRgb, type WrapWorld } from "@/lib/wrap-view";

const VERTEX = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAGMENT = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform float uCell;
uniform float uStyle;
uniform vec2 uPointer;
uniform float uMix;
uniform vec3 uA0; uniform vec3 uA1; uniform vec3 uA2; uniform vec3 uA3;
uniform vec3 uB0; uniform vec3 uB1; uniform vec3 uB2; uniform vec3 uB3;

float bayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
float bayer8(vec2 a) { return bayer4(0.5 * a) * 0.25 + bayer2(a); }
float grain(vec2 c) { return fract(52.9829189 * fract(dot(c, vec2(0.06711056, 0.00583715)))); }

float light(vec2 uv, float t) {
  vec2 d = uv - uPointer;
  float pool = exp(-dot(d, d) * 2.6);
  vec2 c = uv - vec2(0.5, 1.05);
  float rays = 0.5 + 0.5 * cos(atan(c.y, c.x) * 14.0 + t * 0.25);
  float fall = max(0.0, 1.0 - length(c) * 0.85);
  float swirl = 0.5 + 0.5 * sin(uv.x * 5.0 + sin(uv.y * 4.0 + t * 0.4) * 1.6 + t * 0.3);
  return clamp(pool * 0.78 + rays * fall * 0.28 + swirl * 0.14 - 0.08, 0.0, 1.0);
}

vec3 tone(float v, float th, vec3 c0, vec3 c1, vec3 c2, vec3 c3) {
  float s = clamp(v, 0.0, 0.9999) * 3.0;
  float b = floor(s);
  float i = min(3.0, b + step(th, s - b));
  if (i < 0.5) return c0;
  if (i < 1.5) return c1;
  if (i < 2.5) return c2;
  return c3;
}

void main() {
  vec2 cell = floor(gl_FragCoord.xy / uCell);
  vec2 centre = (cell + 0.5) * uCell;
  vec2 uv = vec2(centre.x / uRes.x, 1.0 - centre.y / uRes.y);
  float th = uStyle < 0.5 ? bayer8(cell) : grain(cell);
  float v = light(uv, uTime);
  // The change of world sweeps up from the bottom, each cell flipping on its own threshold.
  float sweep = clamp(uMix * 1.6 - (1.0 - uv.y) * 0.6, 0.0, 1.0);
  vec3 col = sweep > th
    ? tone(v, th, uA0, uA1, uA2, uA3)
    : tone(v, th, uB0, uB1, uB2, uB3);
  gl_FragColor = vec4(col, 1.0);
}`;

export type DitherOptions = { cell: number; style: "BAYER" | "GRAIN"; speed: number };

export type WrapDitherScene = {
  setWorld(world: WrapWorld): void;
  setOptions(o: DitherOptions): void;
  pointer(x: number, y: number): void;
  destroy(): void;
};

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error("shader");
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) || "shader");
  return sh;
}

const rgb = (hex: string): [number, number, number] => hexToRgb(hex).map((n) => n / 255) as [number, number, number];
const SWEEP_MS = 900;

/** Starts the light on `canvas`, or null where WebGL can't draw it. */
export function createWrapDither(canvas: HTMLCanvasElement, world: WrapWorld, initial: DitherOptions): WrapDitherScene | null {
  let gl: WebGLRenderingContext | null = null;
  try {
    gl = canvas.getContext("webgl", { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: "low-power" });
  } catch {
    gl = null;
  }
  if (!gl) return null;
  let program: WebGLProgram | null;
  try {
    program = gl.createProgram();
    if (!program) return null;
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  } catch {
    return null;
  }
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = (n: string) => gl!.getUniformLocation(program!, n);
  const aPos = gl.getAttribLocation(program, "aPos");
  const u = {
    res: loc("uRes"),
    time: loc("uTime"),
    cell: loc("uCell"),
    style: loc("uStyle"),
    pointer: loc("uPointer"),
    mix: loc("uMix"),
    a: [loc("uA0"), loc("uA1"), loc("uA2"), loc("uA3")],
    b: [loc("uB0"), loc("uB1"), loc("uB2"), loc("uB3")],
  };

  let options = initial;
  let current: WrapWorld = world;
  let previous: WrapWorld = world;
  let sweepFrom = -Infinity;
  let pointerAt: [number, number] = [0.82, 0.18];
  let pointerTo: [number, number] = [0.82, 0.18];
  let dpr = 1;
  let raf = 0;
  let lost = false;
  let time = 0;
  let last = performance.now();

  const resize = () => {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  };

  const draw = (now: number) => {
    if (!gl || !program || lost) return;
    const sweep = Math.min(1, (now - sweepFrom) / SWEEP_MS);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(u.res, canvas.width, canvas.height);
    gl.uniform1f(u.time, time);
    gl.uniform1f(u.cell, Math.max(1, options.cell * dpr));
    gl.uniform1f(u.style, options.style === "GRAIN" ? 1 : 0);
    gl.uniform2f(u.pointer, pointerAt[0], pointerAt[1]);
    gl.uniform1f(u.mix, sweep);
    WORLD_TONES[current].forEach((hex, i) => gl!.uniform3f(u.a[i], ...rgb(hex)));
    WORLD_TONES[previous].forEach((hex, i) => gl!.uniform3f(u.b[i], ...rgb(hex)));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  const sweeping = (now: number) => now - sweepFrom < SWEEP_MS;
  const near = () => Math.abs(pointerAt[0] - pointerTo[0]) + Math.abs(pointerAt[1] - pointerTo[1]) < 0.002;

  const frame = (now: number) => {
    raf = 0;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    time += dt * options.speed;
    // The light follows the pointer softly.
    const k = 1 - Math.exp(-dt * 3);
    pointerAt = [pointerAt[0] + (pointerTo[0] - pointerAt[0]) * k, pointerAt[1] + (pointerTo[1] - pointerAt[1]) * k];
    draw(now);
    if (!document.hidden && (options.speed > 0 || sweeping(now) || !near())) raf = requestAnimationFrame(frame);
  };
  const kick = () => {
    if (!raf && !lost) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
  };

  const onLost = (e: Event) => {
    e.preventDefault();
    lost = true;
    canvas.dataset.lost = "1";
  };
  const onVisible = () => kick();
  const ro = new ResizeObserver(() => {
    resize();
    kick();
  });
  ro.observe(canvas);
  canvas.addEventListener("webglcontextlost", onLost);
  document.addEventListener("visibilitychange", onVisible);
  resize();
  kick();

  return {
    setWorld(next) {
      if (next === current) return;
      previous = current;
      current = next;
      // Reduced motion (speed 0) still flips worlds, at once.
      sweepFrom = options.speed > 0 ? performance.now() : -Infinity;
      kick();
    },
    setOptions(o) {
      options = o;
      kick();
    },
    pointer(x, y) {
      // Still means still: the light only answers the pointer while the backdrop may move.
      if (options.speed <= 0) return;
      pointerTo = [Math.max(0, Math.min(1, x)), Math.max(0, Math.min(1, y))];
      kick();
    },
    destroy() {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("webglcontextlost", onLost);
      document.removeEventListener("visibilitychange", onVisible);
      if (gl && !lost) {
        gl.deleteBuffer(buffer);
        gl.deleteProgram(program);
      }
    },
  };
}
