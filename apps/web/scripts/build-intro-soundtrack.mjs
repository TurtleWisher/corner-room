#!/usr/bin/env node
/*
 * Corner Room intro film soundtrack: an original score and sound design synthesised in code,
 * so there is nothing to license (no samples, no loops, no third-party audio).
 *
 *   node scripts/build-intro-soundtrack.mjs [--out ../../var/promo/corner-room-intro-score.wav]
 *
 * 40 s, 48 kHz, 16-bit stereo WAV. Cue times mirror components/promo/intro-video/timeline.ts:
 * keep them in step when scenes move (the CUES block below).
 *
 * Sound follows the two worlds. Ember (hero, events, store): warm minor chords, a low pulse,
 * a dry kick. Sky (the listening room): the same key turned brighter, glassy bells, a soft
 * half-time beat, more air. Movement on screen has a sound: faces folding in, cards arriving,
 * the carousel turning, the focus view opening, the seam wiping across.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const OUT = resolve(args.out ?? "../../var/promo/corner-room-intro-score.wav");

const SR = 48000;
const DUR = 40;
const N = SR * DUR;
const TAU = Math.PI * 2;

/* ---------- Cues (seconds), from timeline.ts ---------- */
const CUES = {
  heroCube: [0.45, 1.85], // letter cube assembles
  heroLines: [1.5, 1.9, 2.08, 2.9], // eyebrow, tagline lines, Bangla line
  events: 6.4,
  eventCards: [7.3, 7.46],
  handover: 13.2,
  room: 15.2,
  roomNext: [18.8, 21.6], // carousel turns (640 ms)
  roomFocus: 24.4,
  roomPeek: 26.2,
  roomOut: 28.7,
  yours: 29.2,
  yoursCards: [29.75, 29.87, 29.99],
  seam: 33.6,
  end: 36.8,
  endCube: [36.85, 37.75],
  ctas: 38.05,
};

/* ---------- Buses ---------- */
const L = new Float32Array(N);
const R = new Float32Array(N);
const verbL = new Float32Array(N);
const verbR = new Float32Array(N);

function add(i, l, r, send = 0) {
  if (i < 0 || i >= N) return;
  L[i] += l;
  R[i] += r;
  if (send) {
    verbL[i] += l * send;
    verbR[i] += r * send;
  }
}
const panGains = (p) => [Math.cos(((p + 1) * Math.PI) / 4), Math.sin(((p + 1) * Math.PI) / 4)];

/* ---------- Helpers ---------- */
const mtof = (m) => 440 * 2 ** ((m - 69) / 12);
let seed = 7;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
const smooth = (x) => x * x * (3 - 2 * x);

/** Envelope: attack, hold to `len`, release; values 0..1. */
function env(t, a, len, rel) {
  if (t < 0) return 0;
  if (t < a) return smooth(t / a);
  if (t < len) return 1;
  if (t < len + rel) return 1 - smooth((t - len) / rel);
  return 0;
}

/** State-variable filter (Chamberlin), modulatable per sample. */
function svf() {
  let low = 0;
  let band = 0;
  return (x, fc, q = 0.7) => {
    const f = 2 * Math.sin((Math.PI * Math.min(fc, SR / 6)) / SR);
    low += f * band;
    const high = x - low - (1 / q) * band;
    band += f * high;
    return { low, band, high };
  };
}

/* ---------- Instruments ---------- */

/** Warm pad: detuned saws per note, slow filter, stereo spread. */
function pad({ start, dur, notes, gain = 0.06, cutoff = [500, 1600], attack = 1.2, release = 1.6, send = 0.5, bright = 0 }) {
  const s0 = Math.floor(start * SR);
  const total = Math.floor((dur + release) * SR);
  const fl = svf();
  const fr = svf();
  const voices = notes.flatMap((m, n) =>
    [-0.09, 0, 0.11].map((cents, k) => ({ f: mtof(m + cents), ph: (n * 0.37 + k * 0.21) % 1, side: k - 1 })),
  );
  for (let j = 0; j < total; j += 1) {
    const t = j / SR;
    const e = env(t, attack, dur, release);
    if (e === 0 && t > attack) continue;
    let l = 0;
    let r = 0;
    for (const v of voices) {
      v.ph += v.f / SR;
      if (v.ph >= 1) v.ph -= 1;
      const saw = 2 * v.ph - 1;
      const tri = 1 - 4 * Math.abs(v.ph - 0.5);
      const w = saw * (1 - bright * 0.6) + tri * bright * 0.6;
      l += w * (v.side <= 0 ? 1 : 0.12);
      r += w * (v.side >= 0 ? 1 : 0.12);
    }
    const k = Math.min(1, t / Math.max(0.01, dur));
    const fc = cutoff[0] + (cutoff[1] - cutoff[0]) * smooth(k);
    const a = (gain * e) / voices.length;
    add(s0 + j, fl(l, fc, 0.8).low * a * 3, fr(r, fc, 0.8).low * a * 3, send);
  }
}

/** Sub bass: sine with a touch of second harmonic. */
function sub({ start, dur, note, gain = 0.16 }) {
  const s0 = Math.floor(start * SR);
  const f = mtof(note);
  for (let j = 0; j < (dur + 0.3) * SR; j += 1) {
    const t = j / SR;
    const e = env(t, 0.03, dur, 0.25);
    const x = Math.sin(TAU * f * t) + 0.18 * Math.sin(TAU * 2 * f * t);
    add(s0 + j, x * e * gain, x * e * gain);
  }
}

function kick(at, gain = 0.55) {
  const s0 = Math.floor(at * SR);
  let ph = 0;
  for (let j = 0; j < 0.45 * SR; j += 1) {
    const t = j / SR;
    const f = 44 + 90 * Math.exp(-t * 28);
    ph += f / SR;
    const body = Math.sin(TAU * ph) * Math.exp(-t * 7.5);
    const click = j < 0.004 * SR ? rand() * 0.35 * (1 - j / (0.004 * SR)) : 0;
    const x = (body + click) * gain;
    add(s0 + j, x, x);
  }
}

function hat(at, gain = 0.05, pan = 0.25, open = false) {
  const s0 = Math.floor(at * SR);
  const f = svf();
  const [gl, gr] = panGains(pan);
  const len = open ? 0.22 : 0.05;
  for (let j = 0; j < len * SR; j += 1) {
    const t = j / SR;
    const x = f(rand(), 9000, 0.9).high * Math.exp(-t * (open ? 14 : 70)) * gain;
    add(s0 + j, x * gl, x * gr, 0.08);
  }
}

/** Soft rim / snap for the half-time Sky beat and the Ember backbeat. */
function snap(at, gain = 0.12, pan = -0.1) {
  const s0 = Math.floor(at * SR);
  const f = svf();
  const [gl, gr] = panGains(pan);
  for (let j = 0; j < 0.18 * SR; j += 1) {
    const t = j / SR;
    const n = f(rand(), 1900, 1.4).band * Math.exp(-t * 26);
    const tone = Math.sin(TAU * 210 * t) * Math.exp(-t * 40) * 0.5;
    const x = (n + tone) * gain;
    add(s0 + j, x * gl, x * gr, 0.25);
  }
}

/** Muted pluck (Karplus-Strong) for the Ember arpeggio. */
function pluck(at, note, gain = 0.09, pan = 0, decay = 0.993) {
  const s0 = Math.floor(at * SR);
  const p = Math.max(2, Math.round(SR / mtof(note)));
  const buf = new Float32Array(p).map(() => rand());
  const [gl, gr] = panGains(pan);
  let last = 0;
  for (let j = 0; j < 1.1 * SR; j += 1) {
    const i = j % p;
    const y = decay * 0.5 * (buf[i] + last);
    last = buf[i];
    buf[i] = y;
    const x = y * gain;
    add(s0 + j, x * gl, x * gr, 0.3);
  }
}

/** Glass bell for the listening room: inharmonic partials, long ring. */
function bell(at, note, gain = 0.08, pan = 0) {
  const s0 = Math.floor(at * SR);
  const f = mtof(note);
  const [gl, gr] = panGains(pan);
  const parts = [
    [1, 1, 2.2],
    [2.0, 0.45, 3.5],
    [2.76, 0.28, 5],
    [5.4, 0.12, 8],
  ];
  for (let j = 0; j < 3 * SR; j += 1) {
    const t = j / SR;
    let x = 0;
    for (const [m, a, d] of parts) x += Math.sin(TAU * f * m * t) * a * Math.exp(-t * d);
    x *= gain * Math.min(1, t / 0.004);
    add(s0 + j, x * gl, x * gr, 0.55);
  }
}

/** Air movement: band-passed noise sweeping in frequency and across the stereo field. */
function whoosh({ at, dur, from = 400, to = 3200, gain = 0.12, panFrom = -0.6, panTo = 0.6, q = 1.2, send = 0.35 }) {
  const s0 = Math.floor(at * SR);
  const f = svf();
  for (let j = 0; j < dur * SR; j += 1) {
    const k = j / (dur * SR);
    const shape = Math.sin(Math.PI * k) ** 1.6;
    const fc = from * (to / from) ** smooth(k);
    const x = f(rand(), fc, q).band * shape * gain;
    const [gl, gr] = panGains(panFrom + (panTo - panFrom) * k);
    add(s0 + j, x * gl, x * gr, send);
  }
}

/** UI tick: tiny sine blip with a noise edge, for text and cards landing. */
function tick(at, freq = 2600, gain = 0.07, pan = 0) {
  const s0 = Math.floor(at * SR);
  const [gl, gr] = panGains(pan);
  for (let j = 0; j < 0.06 * SR; j += 1) {
    const t = j / SR;
    const x = (Math.sin(TAU * freq * t) * 0.8 + rand() * 0.25) * Math.exp(-t * 90) * gain;
    add(s0 + j, x * gl, x * gr, 0.2);
  }
}

/** Low impact for the cube locking together and the focus view opening. */
function impact(at, gain = 0.4, tone = 52) {
  const s0 = Math.floor(at * SR);
  const f = svf();
  let ph = 0;
  for (let j = 0; j < 1.6 * SR; j += 1) {
    const t = j / SR;
    ph += (tone + 40 * Math.exp(-t * 18)) / SR;
    const body = Math.sin(TAU * ph) * Math.exp(-t * 3.2);
    const air = f(rand(), 700, 0.7).low * Math.exp(-t * 9) * 0.6;
    const x = (body + air) * gain;
    add(s0 + j, x, x, 0.3);
  }
}

/** Riser: rising filtered noise and a gliding tone into the hand-over. */
function riser(at, dur, gain = 0.09) {
  const s0 = Math.floor(at * SR);
  const f = svf();
  let ph = 0;
  for (let j = 0; j < dur * SR; j += 1) {
    const k = j / (dur * SR);
    const fc = 300 * (6000 / 300) ** (k * k);
    const n = f(rand(), fc, 2).band;
    ph += (220 * 2 ** (k * 1.5)) / SR;
    const tone = Math.sin(TAU * ph) * 0.15;
    const e = k ** 1.8 * (1 - smooth(Math.max(0, (k - 0.92) / 0.08)));
    const x = (n + tone) * e * gain;
    const [gl, gr] = panGains(Math.sin(k * 9) * 0.4);
    add(s0 + j, x * gl, x * gr, 0.5);
  }
}

/* ---------- Score ---------- */
// Key: D minor (Ember). The listening room turns to F major, the relative major (Sky).
const BPM = 96;
const BEAT = 60 / BPM;

const EMBER = [
  [50, 57, 60, 64, 65], // Dm9 (D A C E F)
  [46, 53, 57, 62, 65], // Bbmaj7
  [43, 50, 53, 57, 62], // Gm9
  [45, 52, 55, 61, 64], // A7sus-ish (A E G C# E)
];
const SKY = [
  [53, 60, 64, 67, 69], // Fmaj9 shape
  [48, 55, 62, 64, 67], // Cadd9
  [50, 57, 62, 65, 69], // Dm7 (bright voicing)
  [46, 53, 58, 62, 69], // Bbmaj9
];

// Hero: pad swell from the corner, the cube's faces fold in, the tagline lands.
pad({ start: 0, dur: 3.2, notes: EMBER[0], gain: 0.07, cutoff: [260, 1500], attack: 1.6, release: 1.4 });
pad({ start: 3.2, dur: 3.2, notes: EMBER[1], gain: 0.07, cutoff: [900, 1300], attack: 0.9, release: 1.2 });
sub({ start: 0.3, dur: 2.9, note: 38, gain: 0.1 });
sub({ start: 3.2, dur: 3.1, note: 34, gain: 0.1 });
whoosh({ at: CUES.heroCube[0], dur: 1.25, from: 250, to: 2400, gain: 0.13, panFrom: -0.8, panTo: 0 });
whoosh({ at: CUES.heroCube[0] + 0.12, dur: 1.15, from: 600, to: 3600, gain: 0.08, panFrom: -0.2, panTo: 0.3 });
impact(CUES.heroCube[1] - 0.05, 0.36);
CUES.heroLines.forEach((at, i) => tick(at + 0.12, [3200, 2400, 2700, 2100][i], 0.055, [-0.3, -0.2, -0.1, 0.1][i]));
// A first heartbeat of the pulse under the tagline.
[2.5, 3.75, 5.0].forEach((at) => kick(at, 0.32));

// Events: the beat enters. Kick on every beat, hats on the offbeats, a muted pluck arpeggio.
riser(CUES.events - 0.9, 0.9, 0.06);
impact(CUES.events, 0.3, 46);
{
  const start = CUES.events;
  const end = CUES.handover - 0.1;
  for (let b = 0; start + b * BEAT < end; b += 1) {
    const at = start + b * BEAT;
    kick(at, b % 4 === 0 ? 0.55 : 0.46);
    hat(at + BEAT / 2, 0.045, 0.3);
    if (b % 4 === 1 || b % 4 === 3) snap(at, 0.09);
    if (b % 2 === 1) hat(at + BEAT * 0.75, 0.025, -0.3);
  }
  const prog = [EMBER[0], EMBER[1], EMBER[2], EMBER[3]];
  const barLen = 4 * BEAT;
  for (let c = 0; start + c * barLen * 0.5 < end; c += 1) {
    const chord = prog[c % 4];
    const at = start + c * barLen * 0.5;
    const len = Math.min(barLen * 0.5, end - at);
    pad({ start: at, dur: len, notes: chord.slice(1), gain: 0.045, cutoff: [700, 1200], attack: 0.25, release: 0.6, send: 0.4 });
    sub({ start: at, dur: len - 0.05, note: chord[0] - 12, gain: 0.15 });
    const arp = [chord[1], chord[3], chord[2] + 12, chord[4]];
    for (let s = 0; s < 8 && at + s * (BEAT / 2) < end; s += 1) pluck(at + s * (BEAT / 2), arp[s % 4] + 12, 0.075, s % 2 ? 0.35 : -0.35);
  }
  CUES.eventCards.forEach((at, i) => {
    whoosh({ at: at - 0.05, dur: 0.7, from: 500, to: 3000, gain: 0.09, panFrom: -0.7, panTo: 0.25 + i * 0.2 });
    tick(at + 0.55, 2900, 0.05, 0.3 + i * 0.2);
  });
}

// Hand-over: the beat drops away, the Ember chord dims, a riser carries into the Sky.
pad({ start: CUES.handover, dur: 0.9, notes: EMBER[3], gain: 0.05, cutoff: [1100, 300], attack: 0.05, release: 0.8 });
riser(CUES.handover + 0.15, CUES.room - CUES.handover - 0.1, 0.26);
whoosh({ at: CUES.handover + 0.2, dur: 1.6, from: 200, to: 5000, gain: 0.16, panFrom: -0.9, panTo: 0.9, q: 0.8 });

// Listening room: Sky key, glassy bells, a soft half-time beat, more air.
impact(CUES.room, 0.22, 58);
{
  const start = CUES.room;
  const end = CUES.roomOut + 0.4;
  const barLen = 4 * BEAT;
  for (let c = 0; start + c * barLen < end; c += 1) {
    const chord = SKY[c % 4];
    const at = start + c * barLen;
    const len = Math.min(barLen, end - at);
    const opened = at >= CUES.roomFocus - 0.2 ? 1 : 0;
    pad({ start: at, dur: len, notes: chord.slice(1), gain: 0.05, cutoff: opened ? [1800, 2600] : [1100, 1700], attack: 0.5, release: 1.0, send: 0.7, bright: 0.8 });
    sub({ start: at, dur: len - 0.05, note: chord[0] - 12, gain: 0.12 });
  }
  // Half-time beat: kick on 1, snap on 3, light hats; starts a bar into the room.
  for (let b = 4; start + b * BEAT < end - 0.2; b += 1) {
    const at = start + b * BEAT;
    if (b % 4 === 0) kick(at, 0.4);
    if (b % 4 === 2) snap(at, 0.1, 0.1);
    if (b % 8 === 7) kick(at + BEAT / 2, 0.25);
    hat(at + BEAT / 2, 0.03, -0.2);
  }
  // Bell melody over the room (F major pentatonic), resolving at the focus view.
  const melody = [
    [0.6, 81], [1.2, 79], [1.8, 76], [3.0, 74],
    [4.4, 76], [5.0, 79], [5.6, 81], [6.8, 84],
    [7.6, 81], [8.6, 79], [9.2, 77], [9.8, 76],
    [11.4, 81], [12.0, 84],
  ];
  for (const [dt, note] of melody) if (start + dt < end) bell(start + dt, note, 0.06, ((note % 5) - 2) * 0.2);
  // Breathing light: a slow swell of air every 5.5 s.
  for (let at = start + 0.4; at < end - 1; at += 5.5) whoosh({ at, dur: 5.5, from: 300, to: 900, gain: 0.025, panFrom: -0.2, panTo: 0.2, q: 0.6, send: 0.6 });
  // Carousel turns: a sweep across the stereo field, then the new card lands.
  for (const at of CUES.roomNext) {
    whoosh({ at: at - 0.02, dur: 0.72, from: 900, to: 4200, gain: 0.11, panFrom: 0.7, panTo: -0.7, q: 1.6 });
    tick(at + 0.55, 3100, 0.045, 0);
    bell(at + 0.5, 88, 0.035, 0.2);
  }
  // Focus view opens: a soft low bloom, the filter opens wider.
  impact(CUES.roomFocus, 0.28, 50);
  whoosh({ at: CUES.roomFocus - 0.15, dur: 0.9, from: 180, to: 1400, gain: 0.1, panFrom: 0, panTo: 0, q: 0.7 });
  bell(CUES.roomFocus + 0.1, 77, 0.07, -0.1);
  bell(CUES.roomFocus + 0.1, 84, 0.04, 0.1);
  // The next cover turns in from the right edge.
  whoosh({ at: CUES.roomPeek - 0.05, dur: 0.65, from: 1200, to: 3800, gain: 0.08, panFrom: 0.95, panTo: 0.55, q: 1.4 });
  tick(CUES.roomPeek + 0.5, 3400, 0.04, 0.7);
  whoosh({ at: CUES.roomOut - 0.1, dur: 0.9, from: 3000, to: 400, gain: 0.06, panFrom: 0.2, panTo: -0.2 });
}

// Your room: library, playlists, history land one after another.
pad({ start: CUES.yours, dur: CUES.seam - CUES.yours, notes: SKY[0].slice(1), gain: 0.045, cutoff: [1400, 2200], attack: 0.6, release: 0.5, send: 0.7, bright: 0.8 });
sub({ start: CUES.yours, dur: CUES.seam - CUES.yours - 0.1, note: 41, gain: 0.1 });
CUES.yoursCards.forEach((at, i) => {
  tick(at + 0.45, [2600, 2900, 3300][i], 0.05, [-0.5, 0, 0.5][i]);
  bell(at + 0.45, [72, 76, 79][i], 0.04, [-0.5, 0, 0.5][i]);
});
[CUES.yours + 1.25, CUES.yours + 2.5, CUES.yours + 3.75].forEach((at) => hat(at, 0.03, 0.2, true));

// Store: the seam wipes left to right and the Ember beat returns.
whoosh({ at: CUES.seam - 0.1, dur: 0.85, from: 600, to: 5200, gain: 0.15, panFrom: -1, panTo: 1, q: 1.8 });
impact(CUES.seam + 0.7, 0.34, 46);
{
  const start = CUES.seam + 0.7;
  const end = CUES.end + 0.1;
  for (let b = 0; start + b * BEAT < end; b += 1) {
    const at = start + b * BEAT;
    kick(at, 0.5);
    hat(at + BEAT / 2, 0.045, 0.3);
    if (b % 2 === 1) snap(at, 0.1);
  }
  pad({ start, dur: end - start, notes: EMBER[1].slice(1), gain: 0.05, cutoff: [800, 1600], attack: 0.2, release: 0.5, send: 0.4 });
  sub({ start, dur: end - start - 0.05, note: 34, gain: 0.15 });
  for (let s = 0; start + s * (BEAT / 2) < end; s += 1) pluck(start + s * (BEAT / 2), [65, 69, 74, 77][s % 4] + 12, 0.07, s % 2 ? 0.35 : -0.35);
}

// End card: the cube folds in once more, one held chord, the calls to action, then rest.
whoosh({ at: CUES.endCube[0], dur: 1.0, from: 250, to: 2600, gain: 0.12, panFrom: -0.8, panTo: 0 });
impact(CUES.endCube[1] - 0.1, 0.42, 44);
kick(CUES.endCube[1] - 0.1, 0.5);
pad({ start: CUES.endCube[1] - 0.1, dur: 1.6, notes: [50, 57, 62, 65, 69, 74], gain: 0.085, cutoff: [2200, 900], attack: 0.04, release: 1.0, send: 0.8 });
sub({ start: CUES.endCube[1] - 0.1, dur: 1.4, note: 38, gain: 0.16 });
pluck(CUES.endCube[1], 86, 0.08, 0.2, 0.996);
tick(CUES.ctas + 0.5, 2700, 0.05, 0.2);
bell(CUES.ctas + 0.5, 81, 0.05, 0.2);

/* ---------- Reverb (Freeverb-style: parallel combs into series allpasses) ---------- */
function reverb(input, spread) {
  const out = new Float32Array(N);
  const combs = [1557, 1617, 1491, 1422, 1277, 1356, 1188, 1116].map((d) => {
    const len = Math.round(((d + spread) * SR) / 44100);
    return { buf: new Float32Array(len), i: 0, store: 0 };
  });
  const aps = [556, 441, 341, 225].map((d) => ({ buf: new Float32Array(Math.round(((d + spread) * SR) / 44100)), i: 0 }));
  const feedback = 0.86;
  const damp = 0.32;
  for (let n = 0; n < N; n += 1) {
    const x = input[n] * 0.015;
    let y = 0;
    for (const c of combs) {
      const o = c.buf[c.i];
      c.store = o * (1 - damp) + c.store * damp;
      c.buf[c.i] = x + c.store * feedback;
      c.i = (c.i + 1) % c.buf.length;
      y += o;
    }
    for (const a of aps) {
      const b = a.buf[a.i];
      a.buf[a.i] = y + b * 0.5;
      a.i = (a.i + 1) % a.buf.length;
      y = b - y;
    }
    out[n] = y;
  }
  return out;
}
const wetL = reverb(verbL, 0);
const wetR = reverb(verbR, 23);

/* ---------- Master: high-pass, glue, soft limit, fades ---------- */
const hpL = svf();
const hpR = svf();
let peak = 0;
const mixL = new Float32Array(N);
const mixR = new Float32Array(N);
for (let n = 0; n < N; n += 1) {
  const l = hpL(L[n] + wetL[n] * 0.9, 28, 0.7).high;
  const r = hpR(R[n] + wetR[n] * 0.9, 28, 0.7).high;
  mixL[n] = l;
  mixR[n] = r;
  peak = Math.max(peak, Math.abs(l), Math.abs(r));
}
const drive = 1.25 / Math.max(peak, 1e-6);
const fadeIn = 0.05 * SR;
const fadeOut = 1.4 * SR;
const pcm = Buffer.alloc(N * 4);
for (let n = 0; n < N; n += 1) {
  const g = Math.min(1, n / fadeIn) * Math.min(1, (N - n) / fadeOut);
  const l = Math.tanh(mixL[n] * drive) * 0.89 * g;
  const r = Math.tanh(mixR[n] * drive) * 0.89 * g;
  pcm.writeInt16LE(Math.round(l * 32767), n * 4);
  pcm.writeInt16LE(Math.round(r * 32767), n * 4 + 2);
}

/* ---------- WAV ---------- */
const header = Buffer.alloc(44);
header.write("RIFF", 0);
header.writeUInt32LE(36 + pcm.length, 4);
header.write("WAVE", 8);
header.write("fmt ", 12);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(2, 22);
header.writeUInt32LE(SR, 24);
header.writeUInt32LE(SR * 4, 28);
header.writeUInt16LE(4, 32);
header.writeUInt16LE(16, 34);
header.write("data", 36);
header.writeUInt32LE(pcm.length, 40);
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, Buffer.concat([header, pcm]));
console.log(`Wrote ${OUT}`);
