/*
 * The Ember-to-Sky curtain (owner, 2026-11-28, D-WORLD-02; calmer, 2026-11-28): the Sky night rises
 * over the Ember room as one tall, soft fade, broken into a fine grain instead of fading as a sheet.
 * There is no edge line and nothing wobbles: the middle of the window leads a little (the gentle arc
 * of a horizon) and the grain thins out above it. Every pixel is Ember (left clear, the page shows)
 * or Sky night, never a blend drawn on screen (brand D1).
 *
 * The grain is interleaved gradient noise in 2 px cells: even like an ordered dither but with no
 * grid or crosshatch to see. One small WebGL canvas fixed to the window (no three.js), drawn only when
 * the scroll moves the curtain, never on its own. lib/home-sections-view.ts decides when it draws
 * (worldCurtain) and where it stands (curtainEdge); WorldShift in home-sections.tsx owns it. If WebGL
 * is missing or the context is lost, the CSS veil does the hand-over as before.
 */

import { CURTAIN_BAND, CURTAIN_SPAN, curtainEdge } from "@/lib/home-sections-view";

const VERTEX = `
attribute vec2 aPos;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAGMENT = `
precision highp float;
uniform vec2 uRes;
uniform float uEdge;
uniform float uBand;
uniform float uArc;
uniform float uCell;

// Interleaved gradient noise: an even threshold per cell, 0 to 1, with no visible pattern.
float grain(vec2 cell) {
  return fract(52.9829189 * fract(dot(cell, vec2(0.06711056, 0.00583715))));
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float x = uv.x * 2.0 - 1.0;
  // Up the window, the middle a little ahead of the sides.
  float f = uv.y + uArc * x * x;
  float t = clamp((uEdge - f) / uBand, 0.0, 1.0);
  t = t * t * (3.0 - 2.0 * t);
  if (t > grain(floor(gl_FragCoord.xy / uCell))) {
    // Sky night, #120f26.
    gl_FragColor = vec4(0.0706, 0.0588, 0.149, 1.0);
    return;
  }
  gl_FragColor = vec4(0.0);
}`;

export type WorldCurtain = {
  /** Draw the curtain risen this far (0 to 1). */
  set(curtain: number): void;
  resize(): void;
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

/** Sets the curtain up on `canvas`, or returns null where WebGL can't draw it. */
export function createWorldCurtain(canvas: HTMLCanvasElement, onLost: () => void): WorldCurtain | null {
  let gl: WebGLRenderingContext | null = null;
  try {
    gl = canvas.getContext("webgl", { alpha: true, antialias: false, depth: false, stencil: false, premultipliedAlpha: true, powerPreference: "low-power" });
  } catch {
    gl = null;
  }
  if (!gl) return null;
  let program: WebGLProgram | null = null;
  let buffer: WebGLBuffer | null = null;
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
  buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(program, "aPos");
  const uRes = gl.getUniformLocation(program, "uRes");
  const uEdge = gl.getUniformLocation(program, "uEdge");
  const uBand = gl.getUniformLocation(program, "uBand");
  const uArc = gl.getUniformLocation(program, "uArc");
  const uCell = gl.getUniformLocation(program, "uCell");

  let dpr = 1;
  let last = Number.NaN;
  let lost = false;
  const lostListener = (e: Event) => {
    e.preventDefault();
    lost = true;
    onLost();
  };
  canvas.addEventListener("webglcontextlost", lostListener);

  const resize = () => {
    // Up to 2 device pixels per CSS pixel: the grain cells are drawn at 2 CSS pixels either way.
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(window.innerWidth * dpr));
    const h = Math.max(1, Math.round(window.innerHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    last = Number.NaN;
  };

  const draw = (curtain: number) => {
    if (!gl || !program || lost) return;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.uniform1f(uEdge, curtainEdge(curtain));
    gl.uniform1f(uBand, CURTAIN_BAND);
    gl.uniform1f(uArc, CURTAIN_SPAN - 1);
    gl.uniform1f(uCell, 2 * dpr);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  resize();
  return {
    set(curtain) {
      // Drawn only when it changes by at least a fraction of a grain step.
      if (Math.abs(curtain - last) < 0.0008) return;
      last = curtain;
      draw(curtain);
    },
    resize,
    destroy() {
      canvas.removeEventListener("webglcontextlost", lostListener);
      if (gl && !lost) {
        gl.deleteBuffer(buffer);
        gl.deleteProgram(program);
        gl.getExtension("WEBGL_lose_context")?.loseContext();
      }
      gl = null;
    },
  };
}
