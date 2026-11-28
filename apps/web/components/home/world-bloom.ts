/*
 * The Ember-to-Sky night bloom (owner, 2026-11-28, D-WORLD-04): the Sky night spreads up from below
 * the window like light through water, a wide, soft, slightly uneven front with no line anywhere.
 * Between the two worlds the front passes through near-black (brand D1: Night between, never
 * purple), a faint Sky haze rides just inside it, and a ±half-step dither keeps the dark gradients
 * free of banding, which is what makes a dark fade look smooth on a real screen.
 *
 * One small WebGL canvas fixed behind the page (no three.js), drawn only when the scroll moves the
 * change, never on its own. At 0 it is exactly Ember Night and at 1 exactly Sky night, so the plain
 * colours take over at either end without a seam (lib/home-sections-view.ts `worldStages`).
 * WorldShift in home-sections.tsx owns it; without WebGL the CSS veil fades instead.
 */

const VERTEX = `
attribute vec2 aPos;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAGMENT = `
precision highp float;
uniform vec2 uRes;
uniform float uCover;

const vec3 EMBER = vec3(0.0784, 0.0275, 0.0275); // #140707, the page's Ember Night
const vec3 NIGHT = vec3(0.0235, 0.0157, 0.0353); // #060409, the dark between
const vec3 SKY = vec3(0.0706, 0.0588, 0.1490);   // #120f26, Sky night
const vec3 HAZE = vec3(0.31, 0.76, 0.91);        // Sky's light, faintly

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
// Smooth value noise for the front's gentle unevenness (fixed: it never moves by itself).
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float aspect = uRes.x / uRes.y;
  // Distance from a point below the middle of the window, a little wider than tall.
  vec2 p = vec2((uv.x - 0.5) * aspect * 0.8, uv.y + 0.18);
  float d = length(p);
  d += (vnoise(uv * vec2(2.4 * aspect, 2.4)) - 0.5) * 0.14;
  float far = length(vec2(0.5 * aspect * 0.8, 1.18)) + 0.08;
  const float EDGE = 0.55;
  float r = mix(-0.1, far + EDGE, uCover);
  float c = 1.0 - smoothstep(r - EDGE, r, d);
  vec3 col = c < 0.5 ? mix(EMBER, NIGHT, smoothstep(0.0, 0.5, c)) : mix(NIGHT, SKY, smoothstep(0.5, 1.0, c));
  // A faint haze of Sky's light just inside the front, gone once the bloom is whole.
  float haze = exp(-pow((c - 0.78) / 0.16, 2.0)) * 0.055 * (1.0 - smoothstep(0.85, 1.0, uCover));
  col += HAZE * haze;
  // Half a step of dither: no bands in the dark.
  col += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
  gl_FragColor = vec4(col, 1.0);
}`;

export type WorldBloom = {
  /** Draw the bloom this far spread (0 Ember to 1 Sky). */
  set(cover: number): void;
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

/** Sets the bloom up on `canvas`, or returns null where WebGL can't draw it. */
export function createWorldBloom(canvas: HTMLCanvasElement, onLost: () => void): WorldBloom | null {
  let gl: WebGLRenderingContext | null = null;
  try {
    gl = canvas.getContext("webgl", { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: "low-power" });
  } catch {
    gl = null;
  }
  if (!gl) return null;
  let program: WebGLProgram | null = null;
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
  const aPos = gl.getAttribLocation(program, "aPos");
  const uRes = gl.getUniformLocation(program, "uRes");
  const uCover = gl.getUniformLocation(program, "uCover");

  let last = Number.NaN;
  let lost = false;
  const lostListener = (e: Event) => {
    e.preventDefault();
    lost = true;
    onLost();
  };
  canvas.addEventListener("webglcontextlost", lostListener);

  const resize = () => {
    // Everything here is soft, so one pixel per CSS pixel is plenty (and cheap on big screens).
    const w = Math.max(1, Math.round(window.innerWidth));
    const h = Math.max(1, Math.round(window.innerHeight));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const again = last;
    last = Number.NaN;
    if (Number.isFinite(again)) draw(again);
  };

  const draw = (cover: number) => {
    if (!gl || !program || lost) return;
    last = cover;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.uniform1f(uCover, cover);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  resize();
  return {
    set(cover) {
      // Drawn only when it moves by more than a sliver.
      if (Math.abs(cover - last) < 0.0005) return;
      draw(cover);
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
