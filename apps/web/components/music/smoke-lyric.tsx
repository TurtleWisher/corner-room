"use client";

import { useEffect, useRef } from "react";

import { SmokeField, sampleHomes, wrapBalanced } from "@/lib/smoke-text";

/*
 * One lyric line as smoke (owner, 2026-11-01; physics in lib/smoke-text.ts). The words are drawn
 * once into a hidden canvas and sampled into particles; each frame the particles are drawn on the
 * GPU as soft cream puffs that add up where they crowd, so the letters read solid and their edges
 * smoke (one draw call per line: thousands of puffs drawn one by one on a 2D canvas measured
 * about 120 ms a frame). Every line shares one animation loop and one pointer: the listening room
 * reports the pointer (`stirSmoke`) and each line maps it into its own pixels, so the smoke never
 * takes a click from the cover or the controls. Without WebGL, or under reduced motion, the words
 * are drawn still, as plain text.
 */

type Line = { canvas: HTMLCanvasElement; field: SmokeField; draw: () => void };

const lines = new Set<Line>();
let frame = 0;
let last = 0;
// The pointer as last reported, and where it was at the previous frame.
const pointer = { x: 0, y: 0, fromX: 0, fromY: 0, known: false };

/** The listening room reports every pointer move here (screen pixels). */
export function stirSmoke(x: number, y: number) {
  if (!pointer.known) {
    pointer.fromX = x;
    pointer.fromY = y;
    pointer.known = true;
  }
  pointer.x = x;
  pointer.y = y;
}

/** The reach of the pointer's wind, in screen pixels. */
const STIR_RADIUS = 70;

function tick(now: number) {
  const dt = last ? Math.min(3, Math.max(0.25, (now - last) / (1000 / 60))) : 1;
  last = now;
  const moved = pointer.known && (pointer.x !== pointer.fromX || pointer.y !== pointer.fromY);
  for (const line of lines) {
    if (moved) {
      // The line's box on screen (its 3D pose projected): close enough to aim smoke by.
      const box = line.canvas.getBoundingClientRect();
      if (box.width > 0 && box.height > 0) {
        const sx = line.field.width / box.width;
        const sy = line.field.height / box.height;
        line.field.stir(
          (pointer.fromX - box.left) * sx,
          (pointer.fromY - box.top) * sy,
          (pointer.x - box.left) * sx,
          (pointer.y - box.top) * sy,
          STIR_RADIUS * sx,
        );
      }
    }
    line.field.step(dt, now / 1000);
    line.draw();
  }
  pointer.fromX = pointer.x;
  pointer.fromY = pointer.y;
  frame = lines.size ? window.requestAnimationFrame(tick) : 0;
}

function join(line: Line) {
  lines.add(line);
  if (!frame) {
    last = 0;
    frame = window.requestAnimationFrame(tick);
  }
  return () => {
    lines.delete(line);
    if (!lines.size && frame) {
      window.cancelAnimationFrame(frame);
      frame = 0;
    }
  };
}

const VERTEX = `
attribute vec2 a_pos;
attribute float a_free;
uniform vec2 u_size;
uniform vec3 u_fade;
uniform float u_dot;
uniform float u_loose;
varying float v_alpha;
void main() {
  float f = max(a_free, u_loose);
  vec2 p = a_pos;
  // Smoke thins out towards the canvas edges, so it never shows a hard border.
  float edge = clamp(min(min(p.x, u_size.x - p.x) / u_fade.x, min(p.y / u_fade.y, (u_size.y - p.y) / u_fade.z)), 0.0, 1.0);
  // Loose smoke spreads wider and thinner.
  v_alpha = (0.26 - f * 0.18) * edge;
  gl_Position = vec4(p.x / u_size.x * 2.0 - 1.0, 1.0 - p.y / u_size.y * 2.0, 0.0, 1.0);
  gl_PointSize = u_dot * (1.0 + f * 1.2);
}`;

// A soft gaussian puff in Cream with no hard core, premultiplied for additive blending.
const FRAGMENT = `
precision mediump float;
varying float v_alpha;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r2 = dot(d, d) * 4.0;
  if (r2 >= 1.0) discard;
  float a = exp(-r2 * 3.2) * (1.0 - r2) * v_alpha * 1.7;
  gl_FragColor = vec4(vec3(0.965, 0.925, 0.902) * a, a);
}`;

type Renderer = { draw: (field: SmokeField) => void; dispose: () => void };

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
}

/** The GPU puff renderer for one line, or null where WebGL is not available. */
function smokeRenderer(
  canvas: HTMLCanvasElement,
  size: { width: number; height: number; ratio: number; dot: number; fade: [number, number, number] },
): Renderer | null {
  // The drawing is kept between frames so the page compositor never shows a cleared buffer
  // (seen as dark, washed-out smoke when frames are throttled); every frame clears it anyway.
  const gl = canvas.getContext("webgl", {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    preserveDrawingBuffer: true,
  });
  if (!gl) return null;
  const vs = compile(gl, gl.VERTEX_SHADER, VERTEX);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
  const program = gl.createProgram();
  if (!vs || !fs || !program) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);
  const posBuffer = gl.createBuffer();
  const freeBuffer = gl.createBuffer();
  const aPos = gl.getAttribLocation(program, "a_pos");
  const aFree = gl.getAttribLocation(program, "a_free");
  gl.uniform2f(gl.getUniformLocation(program, "u_size"), size.width, size.height);
  gl.uniform3f(gl.getUniformLocation(program, "u_fade"), ...size.fade);
  gl.uniform1f(gl.getUniformLocation(program, "u_dot"), size.dot * size.ratio);
  const uLoose = gl.getUniformLocation(program, "u_loose");
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE);
  gl.clearColor(0, 0, 0, 0);
  let xy = new Float32Array(0);
  return {
    draw(field) {
      if (xy.length !== field.count * 2) xy = new Float32Array(field.count * 2);
      for (let i = 0; i < field.count; i++) {
        xy[i * 2] = field.px[i];
        xy[i * 2 + 1] = field.py[i];
      }
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform1f(uLoose, field.loose);
      gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, xy, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, freeBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, field.free, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(aFree);
      gl.vertexAttribPointer(aFree, 1, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.POINTS, 0, field.count);
    },
    dispose() {
      // Browsers allow only a few live WebGL contexts: give this one back as the line leaves.
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}

/** The widest a line may wrap to: most of a phone, less of a wide room, a cover in focus view. */
function wrapWidth(host: HTMLElement): number {
  const cover = host.closest<HTMLElement>(".lr-focus-cover");
  if (cover) return cover.clientWidth * 1.15;
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  return window.innerWidth < 768 ? window.innerWidth * 0.86 : Math.min(window.innerWidth * 0.6, 46 * rem);
}

export function SmokeLyric({ text, dissolve }: { text: string; dissolve: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const field = useRef<SmokeField | null>(null);
  // The looseness a line is born with: the first pose it is shown at.
  const born = useRef(dissolve);

  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    const style = getComputedStyle(host);
    const size = parseFloat(style.fontSize) || 48;
    const font = `${style.fontWeight} ${size}px ${style.fontFamily}`;

    const ink = document.createElement("canvas");
    const inkCtx = ink.getContext("2d", { willReadFrequently: true });
    if (!inkCtx) return;
    inkCtx.font = font;
    const rows = wrapBalanced(text, (s) => inkCtx.measureText(s).width, wrapWidth(host));
    const rowHeight = size * 1.12;
    const textWidth = Math.max(1, ...rows.map((r) => inkCtx.measureText(r).width));
    // Room around the words for the smoke to drift into: more above, where it rises.
    const padX = size * 0.7;
    const padTop = size * 1.1;
    const padBottom = size * 0.5;
    const width = Math.ceil(textWidth + padX * 2);
    const height = Math.ceil(rows.length * rowHeight + padTop + padBottom);
    ink.width = width;
    ink.height = height;
    inkCtx.font = font;
    inkCtx.textAlign = "center";
    inkCtx.textBaseline = "middle";
    inkCtx.fillStyle = "rgb(246 236 230)";
    rows.forEach((row, i) => inkCtx.fillText(row, width / 2, padTop + rowHeight * (i + 0.5)));

    // A canvas of its own per mount: a WebGL context given back can never be used again.
    const canvas = document.createElement("canvas");
    host.replaceChildren(canvas);
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const step = Math.max(3, size / 15);
    const renderer = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
      ? null
      : smokeRenderer(canvas, { width, height, ratio, dot: step * 3.4, fade: [padX * 0.8, padTop * 0.8, padBottom * 0.8] });
    if (!renderer) {
      // Still words, no smoke: the ink itself, shown at the line's size.
      ink.style.width = canvas.style.width;
      ink.style.height = canvas.style.height;
      host.replaceChildren(ink);
      return () => ink.remove();
    }

    const homes = sampleHomes(inkCtx.getImageData(0, 0, width, height).data, width, height, step);
    const smoke = new SmokeField(homes, width, height, { loose: born.current });
    field.current = smoke;
    const leave = join({ canvas, field: smoke, draw: () => renderer.draw(smoke) });
    return () => {
      leave();
      renderer.dispose();
      canvas.remove();
      field.current = null;
    };
  }, [text]);

  useEffect(() => {
    field.current?.setDissolve(dissolve);
  }, [dissolve]);

  return <div ref={ref} className="lr-smoke" />;
}
