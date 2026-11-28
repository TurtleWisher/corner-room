/* Records the Wrap's story video on the device (owner, 2026-11-28): every frame drawn by
 * drawWrapVideoFrame, the person's top song underneath (a moment from it, with soft fades) when
 * they may play it, recorded by the browser's own MediaRecorder as MP4 (H.264 + AAC) where it can
 * (Chrome and Edge 126+, Safari), the file Instagram, Facebook and WhatsApp stories take; WebM
 * elsewhere. In real time, like the song story cards: a 40 s Wrap takes about 40 s. Nothing is
 * uploaded, and making it is never a listen. */

import { fetchTrackAudio, resolveMediaUrl } from "@/features/streaming/api";
import { cutClip, recorderType } from "@/lib/story-video";
import { VIDEO_FPS } from "@/lib/wrap-view";

export type WrapVideo = { blob: Blob; type: string; mp4: boolean };

/** A moment of the top song as long as the video, from a third of the way in; null when the person
 * can't play it or it won't decode (the video is then made without sound). */
export async function loadSoundtrack(trackId: string | null, seconds: number): Promise<AudioBuffer | null> {
  if (!trackId || typeof AudioContext === "undefined") return null;
  const ac = new AudioContext();
  try {
    const delivery = await fetchTrackAudio(trackId, ["mp3", "opus"]);
    for (const url of [delivery.url, ...(delivery.alternates ?? []).map((a) => a.url)]) {
      try {
        const res = await fetch(resolveMediaUrl(url));
        if (!res.ok) continue;
        const song = await ac.decodeAudioData(await res.arrayBuffer());
        const startS = Math.max(0, Math.min(song.duration * 0.33, song.duration - seconds));
        return cutClip(ac, song, startS * 1000, Math.min(song.duration, startS + seconds) * 1000, delivery.gain_db ?? 0);
      } catch {
        /* the next copy */
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    void ac.close();
  }
}

export async function recordWrapVideo(
  draw: (ctx: CanvasRenderingContext2D, t: number) => void,
  size: { w: number; h: number },
  seconds: number,
  sound: AudioBuffer | null,
  onProgress: (share: number) => void,
  onFrame?: (t: number) => void,
): Promise<WrapVideo> {
  if (typeof MediaRecorder === "undefined") throw new Error("NO_RECORDER");
  const type = recorderType((t) => MediaRecorder.isTypeSupported(t));
  if (!type) throw new Error("NO_RECORDER");
  const canvas = document.createElement("canvas");
  canvas.width = size.w;
  canvas.height = size.h;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("NO_CANVAS");
  const audioCtx = new AudioContext(sound ? { sampleRate: sound.sampleRate } : undefined);
  const tracks = [...canvas.captureStream(VIDEO_FPS).getVideoTracks()];
  let src: AudioBufferSourceNode | null = null;
  if (sound) {
    const dest = audioCtx.createMediaStreamDestination();
    src = audioCtx.createBufferSource();
    src.buffer = sound;
    src.connect(dest);
    tracks.push(...dest.stream.getAudioTracks());
  }
  const recorder = new MediaRecorder(new MediaStream(tracks), { mimeType: type, videoBitsPerSecond: 8_000_000, audioBitsPerSecond: 192_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
  const done = new Promise<void>((resolve) => (recorder.onstop = () => resolve()));
  draw(ctx, 0);
  recorder.start(250);
  await audioCtx.resume();
  // The audio clock keeps picture and sound together, sound or not.
  const startAt = audioCtx.currentTime + 0.05;
  src?.start(startAt);
  await new Promise<void>((resolve) => {
    const tick = () => {
      const t = Math.max(0, audioCtx.currentTime - startAt);
      draw(ctx, Math.min(t, seconds));
      onFrame?.(t);
      onProgress(Math.min(1, t / seconds));
      if (t >= seconds) resolve();
      else next();
    };
    // A steady timer, not animation frames (those stop when the window is covered).
    const next = () => window.setTimeout(tick, 1000 / VIDEO_FPS);
    next();
  });
  recorder.stop();
  await done;
  await audioCtx.close();
  const base = type.split(";")[0];
  return { blob: new Blob(chunks, { type: base }), type: base, mp4: base === "video/mp4" };
}
