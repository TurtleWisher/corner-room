"use client";

/* Share the Wrap (owner, 2026-11-28, D-WRAP-01). A story gets the whole Wrap as a video: every card
 * of the person's Wrap, animated, with their top song underneath when they may play it (made on the
 * device by lib/wrap-video.ts). Two still pictures stay for anywhere else. The phone share sheet
 * sends the file to Instagram, Facebook, WhatsApp or any app's story; elsewhere it is saved. The
 * first line is the person's own: "Samiul's 2026 Corner Room Wrap". Only counts of shares reach
 * the server. */

import { CircleAlert, Copy, Download, Loader2, Share2, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ds/button";
import { Dialog } from "@/components/ds/dialog";
import { countWrap, type MyWrap } from "@/features/wraps/api";
import { coverUrl } from "@/lib/cover-view";
import { friendlyError } from "@/lib/error-copy";
import { pageFonts } from "@/lib/story-card-draw";
import { shareRoute } from "@/lib/story-card-view";
import { SHARE_H, SHARE_W, drawWrapShare, loadShareCovers, type ShareDesign } from "@/lib/wrap-share-draw";
import { drawWrapVideoFrame, videoPlan, type VideoAssets } from "@/lib/wrap-video-draw";
import { loadSoundtrack, recordWrapVideo } from "@/lib/wrap-video";
import { shareFileName, shareTitle, worldFor } from "@/lib/wrap-view";

/** The official mark for each world: Ember on red, indigo on the blue night (brand). */
const LOGO = { ember: "/brand/logo/corner-room-logo-ember.svg", sky: "/brand/logo/corner-room-logo-indigo.svg" } as const;
const PREVIEW_FPS = 20;

type Choice = "video" | ShareDesign;
type Made = { file: File; url: string; kind: Choice };

async function loadImage(src: string): Promise<HTMLImageElement | null> {
  try {
    const img = new Image();
    img.src = src;
    await img.decode();
    return img;
  } catch {
    return null;
  }
}

function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function WrapShare({ wrap, onClose }: { wrap: MyWrap; onClose: () => void }) {
  const [choice, setChoice] = useState<Choice>("video");
  const [assets, setAssets] = useState<VideoAssets | null>(null);
  const [made, setMade] = useState<Made | null>(null);
  const [making, setMaking] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const lastUrl = useRef<string | null>(null);
  const plan = useMemo(() => videoPlan(wrap), [wrap]);
  const title = shareTitle(wrap.person.first_name, wrap.season.year, wrap.season.sharing.show_name);
  const host = typeof window === "undefined" ? null : window.location.host;
  const songIds = useMemo(() => wrap.stats.top_songs.map((s) => s.track_id), [wrap.stats.top_songs]);
  const pictureWorld = worldFor(wrap.season.look, choice === "numbers" ? 1 : 0);

  useEffect(() => {
    let live = true;
    (async () => {
      await document.fonts?.ready;
      const acts = new Map<string, CanvasImageSource>();
      const [covers, ember, sky] = await Promise.all([
        loadShareCovers(songIds, (id) => coverUrl({ track: id }, 480)),
        loadImage(LOGO.ember),
        loadImage(LOGO.sky),
        loadShareCovers(
          wrap.stats.top_acts.filter((a) => a.picture).map((a) => a.act_id),
          (id) => {
            const a = wrap.stats.top_acts.find((x) => x.act_id === id)!;
            return coverUrl(a.kind === "BAND" ? { band: id, picture: a.picture } : { artist: id, picture: a.picture }, 480);
          },
        ).then((m) => m.forEach((v, k) => acts.set(k, v))),
      ]);
      if (live) setAssets({ covers, acts, logos: { ember, sky }, fonts: pageFonts() });
    })();
    return () => {
      live = false;
    };
  }, [songIds, wrap.stats.top_acts]);

  const keep = useCallback((blob: Blob, name: string, kind: Choice) => {
    const url = URL.createObjectURL(blob);
    if (lastUrl.current) URL.revokeObjectURL(lastUrl.current);
    lastUrl.current = url;
    setMade({ file: new File([blob], name, { type: blob.type }), url, kind });
  }, []);

  // The preview: the video playing on a loop (a still frame under reduced motion), or the picture.
  useEffect(() => {
    const el = canvas.current;
    if (!el || !assets || making !== null) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    if (choice !== "video") {
      drawWrapShare(ctx, wrap, choice, pictureWorld, assets, host);
      el.toBlob((blob) => blob && keep(blob, shareFileName(wrap.season.year, choice), choice), "image/png");
      return;
    }
    if (reducedMotion()) {
      drawWrapVideoFrame(ctx, wrap, plan, assets, Math.min(plan.total, 1.6), host);
      return;
    }
    let timer = 0;
    const started = performance.now();
    const tick = () => {
      const t = ((performance.now() - started) / 1000) % plan.total;
      drawWrapVideoFrame(ctx, wrap, plan, assets, t, host);
      timer = window.setTimeout(tick, 1000 / PREVIEW_FPS);
    };
    tick();
    return () => window.clearTimeout(timer);
  }, [assets, choice, wrap, plan, host, pictureWorld, making, keep]);

  useEffect(
    () => () => {
      if (lastUrl.current) URL.revokeObjectURL(lastUrl.current);
    },
    [],
  );

  const makeVideo = async () => {
    if (!assets) return;
    setProblem(null);
    setNote(null);
    setMade(null);
    setMaking(0);
    try {
      const sound = await loadSoundtrack(wrap.stats.top_songs[0]?.track_id ?? null, plan.total);
      const preview = canvas.current?.getContext("2d") ?? null;
      const video = await recordWrapVideo(
        (ctx, t) => drawWrapVideoFrame(ctx, wrap, plan, assets, t, host),
        { w: SHARE_W, h: SHARE_H },
        plan.total,
        sound,
        setMaking,
        (t) => {
          // Show the card being recorded, a few times a second.
          if (preview && Math.round(t * 30) % 6 === 0) drawWrapVideoFrame(preview, wrap, plan, assets, Math.min(t, plan.total), host);
        },
      );
      keep(video.blob, `corner-room-wrap-${wrap.season.year}.${video.mp4 ? "mp4" : "webm"}`, "video");
      if (!sound) setNote("Made without sound: your top song couldn't be added on this device.");
      else if (!video.mp4) setNote("This browser saves the video as WebM. If an app won't take it, make it again in Chrome, Edge or Safari.");
    } catch (err) {
      setProblem(
        err instanceof Error && err.message === "NO_RECORDER"
          ? "This browser can't make videos. Try Chrome, Edge or Safari, or share a picture instead."
          : friendlyError(err, "The video didn't finish. Please try again."),
      );
    } finally {
      setMaking(null);
    }
  };

  const ready = made && made.kind === choice ? made : null;
  const route = ready ? shareRoute(typeof navigator === "undefined" ? undefined : navigator, ready.file) : "download";

  const share = async () => {
    if (!ready) return;
    try {
      await navigator.share({ files: [ready.file], title, text: title });
      void countWrap(wrap.season.id, "SHARED_SHEET");
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) setNote(`Sharing didn't open. Save the ${ready.kind === "video" ? "video" : "picture"} and post it from your gallery.`);
    }
  };

  const link = host ? `${window.location.protocol}//${host}/wrap` : "/wrap";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${title}: ${link}`);
      setNote("Copied. Add the link to your story as a link sticker.");
      void countWrap(wrap.season.id, "SHARED_LINK");
    } catch {
      setNote(`Copy this link: ${link}`);
    }
  };

  const seconds = Math.round(plan.total);

  return (
    <Dialog
      open
      onClose={onClose}
      title="Share your Wrap"
      description={`${title}. Your whole Wrap as a story video with your music, or a picture.`}
      className="wr-share-dialog w-[min(46rem,calc(100vw-2rem))] max-h-[calc(100dvh-2rem)]"
    >
      <div className="wr-share">
        <div className="wr-share-preview" data-world={choice === "video" ? plan.worlds[0] : pictureWorld}>
          <canvas ref={canvas} width={SHARE_W} height={SHARE_H} aria-label={`${title}: ${choice === "video" ? "story video preview" : "share picture"}`} role="img" />
          {!assets ? <span className="wr-share-wait">Drawing your Wrap</span> : null}
          {making !== null ? (
            <span className="wr-share-making" role="status">
              <Loader2 aria-hidden className="size-5 animate-spin motion-reduce:animate-none" />
              Making your video {Math.round(making * 100)}%
            </span>
          ) : null}
        </div>
        <div className="wr-share-side">
          <fieldset className="wr-choice" disabled={making !== null}>
            <legend>Share</legend>
            {(
              [
                ["video", "My whole Wrap (video)", `Every card, animated, with your top song. About ${seconds} seconds, for stories.`],
                ["songs", "Top songs picture", "Your most played, with covers"],
                ["numbers", "My numbers picture", "Minutes, songs and your song of the year"],
              ] as const
            ).map(([value, label, line]) => (
              <label key={value} className="wr-choice-row" data-on={choice === value || undefined}>
                <input type="radio" name="wr-design" value={value} checked={choice === value} onChange={() => setChoice(value)} />
                <span>
                  <span className="wr-choice-label">{label}</span>
                  <span className="wr-choice-line">{line}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <div className="wr-share-actions">
            {choice === "video" && !ready ? (
              <Button type="button" onClick={() => void makeVideo()} disabled={!assets || making !== null} busy={making !== null}>
                <Sparkles aria-hidden className="size-4" /> {making !== null ? "Making your video" : "Make my story video"}
              </Button>
            ) : null}
            {ready && route === "share" ? (
              <Button type="button" onClick={share}>
                <Share2 aria-hidden className="size-4" /> Share to a story
              </Button>
            ) : null}
            {ready ? (
              <a href={ready.url} download={ready.file.name} className="wr-pill wr-pill-quiet" onClick={() => void countWrap(wrap.season.id, "SHARED_SAVE")}>
                <Download aria-hidden className="size-4" /> Save {ready.kind === "video" ? "video" : "picture"}
              </a>
            ) : null}
            {wrap.season.sharing.show_link ? (
              <button type="button" className="wr-pill wr-pill-quiet" onClick={copy}>
                <Copy aria-hidden className="size-4" /> Copy Wrap link
              </button>
            ) : null}
          </div>
          {choice === "video" && making !== null ? <p className="wr-share-small">Keep this page open while it records. It plays through once, in real time.</p> : null}
          {problem ? (
            <p role="alert" className="flex items-start gap-2 text-sm text-danger">
              <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
              {problem}
            </p>
          ) : null}
          {note ? (
            <p className="wr-share-note" role="status">
              {note}
            </p>
          ) : null}
          <p className="wr-share-small">Made on your device. Nothing about you is posted until you share it.</p>
        </div>
      </div>
    </Dialog>
  );
}
