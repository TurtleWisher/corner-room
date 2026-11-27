/*
 * The Ember-to-Sky curtain (owner, 2026-11-28, D-WORLD-02): the Sky night rises over the Ember room
 * as an ordered dither, pixel by pixel, instead of fading in as one sheet. Every pixel is either
 * Ember (left clear, the page shows) or Sky night, never a blend of the two (brand D1: no purple in
 * between). Its rising edge leans along the logo's depth axis and carries a faint line of cream light,
 * the light passed from the events room to the listening room.
 *
 * One small WebGL canvas fixed to the window (no three.js), drawn only when the scroll moves the
 * curtain, never on its own. lib/home-sections-view.ts decides when it draws (worldCurtain) and where
 * its edge stands (curtainEdge); WorldShift in home-sections.tsx owns it. If WebGL is missing or the
 * context is lost, the CSS veil does the hand-over as before.
 */

import { curtainEdge } from "@/lib/home-sections-view";

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
uniform float uCell;

// Ordered (Bayer 8 x 8) threshold for a dither cell, 0 to 1.
float bayer2(vec2 a) {
  a = floor(a);
  return fract(dot(a, vec2(0.5, a.y * 0.75)));
}
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
float bayer8(vec2 a) { return bayer4(0.5 * a) * 0.25 + bayer2(a); }

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  // The field the edge climbs: up the window, leaning along the depth axis (rising first at the
  // lower right, last at the top left where the light comes from), with a slow, uneven line so it
  // reads as a surface, not a ruler.
  float f = uv.y * 0.86 + (1.0 - uv.x) * 0.14;
  f += sin(uv.x * 6.3 + uv.y * 2.1) * 0.012 + sin(uv.x * 15.7 - uv.y * 4.3) * 0.005;
  // Depth: the band is wider low in the window (near) and tighter high up (far).
  float band = uBand * mix(1.35, 0.7, uv.y);
  float t = clamp((uEdge - f) / band, 0.0, 1.0);
  float th = bayer8(gl_FragCoord.xy / uCell);
  if (t > th) {
    // Sky night, #120f26.
    gl_FragColor = vec4(0.0706, 0.0588, 0.149, 1.0);
    return;
  }
  // The leading edge: a thin ridge of cream light, itself dithered.
  float ridge = smoothstep(0.0, 0.07, t) * (1.0 - smoothstep(0.07, 0.32, t));
  if (ridge * 0.5 > th) {
    float a = 0.2;
    gl_FragColor = vec4(vec3(0.965, 0.925, 0.902) * a, a);
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

const BAND = 0.22;

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
    // Up to 2 device pixels per CSS pixel: the dither cells are drawn at 2 CSS pixels either way.
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
    gl.uniform1f(uEdge, curtainEdge(curtain, BAND));
    gl.uniform1f(uBand, BAND);
    gl.uniform1f(uCell, 2 * dpr);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  resize();
  return {
    set(curtain) {
      // Drawn only when it changes by at least a fraction of a dither step.
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
