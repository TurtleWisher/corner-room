/*
 * Makes the story video (D-STORY-01) on the owner's own device: every frame drawn by `drawStory`,
 * the chosen moment's sound with soft fades, recorded by the browser's own MediaRecorder as MP4
 * (H.264 video, AAC sound) where it can (Chrome and Edge 126+, Safari), the file Instagram,
 * Facebook and WhatsApp stories take; WebM elsewhere (offered as a download with a note). It
 * records in real time, so a 30 s moment takes about 30 s, and the page must stay open meanwhile.
 * Nothing is uploaded; the song's audio comes from the same signed link the player uses for people
 * who own it, and making a video is never a listen. No extra library (the faster WebCodecs path
 * through Mediabunny can come later; its download failed on 2026-11-08).
 */

import { drawStory, type StoryAssets } from "@/lib/story-card-draw";
import { fadeGain, STORY_FPS, STORY_H, STORY_W, storyFrame, type StoryInput } from "@/lib/story-card-view";

export type StoryVideo = { blob: Blob; type: string; mp4: boolean };

/** The chosen moment as its own sound, with the soft fades the video uses. */
export function cutClip(ctx: BaseAudioContext, song: AudioBuffer, startMs: number, endMs: number, gainDb = 0): AudioBuffer {
  const rate = song.sampleRate;
  const from = Math.max(0, Math.floor((startMs / 1000) * rate));
  const to = Math.min(song.length, Math.floor((endMs / 1000) * rate));
  const frames = Math.max(1, to - from);
  const clip = ctx.createBuffer(Math.min(2, song.numberOfChannels), frames, rate);
  const lengthS = frames / rate;
  const gain = Math.pow(10, gainDb / 20);
  for (let ch = 0; ch < clip.numberOfChannels; ch++) {
    const src = song.getChannelData(ch);
    const dst = clip.getChannelData(ch);
    for (let i = 0; i < frames; i++) dst[i] = src[from + i] * gain * fadeGain(i / rate, lengthS);
  }
  return clip;
}

/** Mono samples, for the loudness that drives the glow. */
export function monoSamples(clip: AudioBuffer): Float32Array {
  const out = new Float32Array(clip.length);
  for (let ch = 0; ch < clip.numberOfChannels; ch++) {
    const data = clip.getChannelData(ch);
    for (let i = 0; i < out.length; i++) out[i] += data[i] / clip.numberOfChannels;
  }
  return out;
}

const RECORDER_TYPES = ["video/mp4;codecs=avc1.42E01F,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm"];

/** The best recording type this browser offers, MP4 first; null when it can't record. */
export function recorderType(isSupported: (type: string) => boolean): string | null {
  return RECORDER_TYPES.find((t) => isSupported(t)) ?? null;
}

async function inRealTime(
  input: StoryInput,
  assets: StoryAssets,
  clip: AudioBuffer,
  onProgress: (share: number) => void,
  onFrame?: (t: number) => void,
): Promise<StoryVideo> {
  if (typeof MediaRecorder === "undefined") throw new Error("NO_RECORDER");
  const type = recorderType((t) => MediaRecorder.isTypeSupported(t));
  if (!type) throw new Error("NO_RECORDER");
  const canvas = document.createElement("canvas");
  canvas.width = STORY_W;
  canvas.height = STORY_H;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("NO_CANVAS");
  const audioCtx = new AudioContext({ sampleRate: clip.sampleRate });
  const dest = audioCtx.createMediaStreamDestination();
  const src = audioCtx.createBufferSource();
  src.buffer = clip;
  src.connect(dest);
  const stream = new MediaStream([...canvas.captureStream(STORY_FPS).getVideoTracks(), ...dest.stream.getAudioTracks()]);
  const recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 6_000_000, audioBitsPerSecond: 192_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
  const done = new Promise<void>((resolve) => (recorder.onstop = () => resolve()));
  drawStory(ctx, input, storyFrame(input, 0), assets, 0);
  recorder.start(250);
  await audioCtx.resume();
  const startAt = audioCtx.currentTime + 0.05;
  src.start(startAt);
  await new Promise<void>((resolve) => {
    const tick = () => {
      const t = Math.max(0, audioCtx.currentTime - startAt);
      drawStory(ctx, input, storyFrame(input, t), assets, t);
      onFrame?.(t);
      onProgress(Math.min(1, t / clip.duration));
      if (t >= clip.duration) resolve();
      else next();
    };
    // A steady timer at the video's own rate, not animation frames: those are slowed or stopped
    // when the window is covered or another app is on top, which left the video choppy or stuck.
    // Hidden pages slow timers too, so the recording still finishes, with fewer frames meanwhile.
    const next = () => window.setTimeout(tick, 1000 / STORY_FPS);
    next();
  });
  recorder.stop();
  await done;
  await audioCtx.close();
  const base = type.split(";")[0];
  return { blob: new Blob(chunks, { type: base }), type: base, mp4: base === "video/mp4" };
}

/** The finished story video. `onProgress` gets 0..1; `onFrame` lets the page show the card as it records. */
export function makeStoryVideo(
  input: StoryInput,
  assets: StoryAssets,
  clip: AudioBuffer,
  onProgress: (share: number) => void,
  onFrame?: (t: number) => void,
): Promise<StoryVideo> {
  return inRealTime(input, assets, clip, onProgress, onFrame);
}
