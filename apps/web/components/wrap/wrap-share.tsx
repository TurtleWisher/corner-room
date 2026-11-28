"use client";

/* Share the Wrap as a story picture (owner, 2026-11-28, D-WRAP-01). Drawn on the device at 1080 x
 * 1920 (lib/wrap-share-draw.ts): the phone share sheet sends it to Instagram, Facebook, WhatsApp or
 * any app's story; elsewhere it saves as a picture. Only counts of shares reach the server. */

import { Copy, Download, Share2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ds/button";
import { Dialog } from "@/components/ds/dialog";
import { countWrap, type MyWrap } from "@/features/wraps/api";
import { coverUrl } from "@/lib/cover-view";
import { pageFonts } from "@/lib/story-card-draw";
import { shareRoute } from "@/lib/story-card-view";
import { SHARE_H, SHARE_W, drawWrapShare, loadShareCovers, type ShareAssets, type ShareDesign } from "@/lib/wrap-share-draw";
import { shareFileName, shareTitle, worldFor } from "@/lib/wrap-view";

/** The official mark for the picture's world: Ember on red, indigo on the blue night (brand). */
const LOGO = { ember: "/brand/logo/corner-room-logo-ember.svg", sky: "/brand/logo/corner-room-logo-indigo.svg" } as const;

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

export function WrapShare({ wrap, onClose }: { wrap: MyWrap; onClose: () => void }) {
  const [design, setDesign] = useState<ShareDesign>("songs");
  const [assets, setAssets] = useState<ShareAssets | null>(null);
  const [file, setFile] = useState<{ file: File; url: string } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const lastUrl = useRef<string | null>(null);
  const world = worldFor(wrap.season.look, design === "songs" ? 0 : 1);
  const title = shareTitle(wrap.person.first_name, wrap.season.year, wrap.season.sharing.show_name);
  const host = typeof window === "undefined" ? null : window.location.host;
  const ids = useMemo(() => wrap.stats.top_songs.slice(0, 5).map((s) => s.track_id), [wrap.stats.top_songs]);

  useEffect(() => {
    let live = true;
    (async () => {
      await document.fonts?.ready;
      const [covers, ember, sky] = await Promise.all([loadShareCovers(ids, (id) => coverUrl({ track: id }, 480)), loadImage(LOGO.ember), loadImage(LOGO.sky)]);
      if (live) setAssets({ covers, logos: { ember, sky }, fonts: pageFonts() });
    })();
    return () => {
      live = false;
    };
  }, [ids]);

  useEffect(() => {
    const el = canvas.current;
    if (!el || !assets) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    drawWrapShare(ctx, wrap, design, world, assets, host);
    el.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      if (lastUrl.current) URL.revokeObjectURL(lastUrl.current);
      lastUrl.current = url;
      setFile({ file: new File([blob], shareFileName(wrap.season.year, design), { type: "image/png" }), url });
    }, "image/png");
  }, [assets, design, world, wrap, host]);

  useEffect(
    () => () => {
      if (lastUrl.current) URL.revokeObjectURL(lastUrl.current);
    },
    [],
  );

  const route = file ? shareRoute(typeof navigator === "undefined" ? undefined : navigator, file.file) : "download";

  const share = async () => {
    if (!file) return;
    try {
      await navigator.share({ files: [file.file], title });
      void countWrap(wrap.season.id, "SHARED_SHEET");
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) setNote("Sharing didn't open. Save the picture and post it from your gallery.");
    }
  };

  const link = host ? `${window.location.protocol}//${host}/wrap` : "/wrap";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setNote("Link copied. Add it to your story as a link sticker.");
      void countWrap(wrap.season.id, "SHARED_LINK");
    } catch {
      setNote(`Copy this link: ${link}`);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="Share your Wrap"
      description="A story picture with your music on it. Post it to Instagram, Facebook, WhatsApp or anywhere else."
      className="wr-share-dialog w-[min(46rem,calc(100vw-2rem))] max-h-[calc(100dvh-2rem)]"
    >
      <div className="wr-share">
        <div className="wr-share-preview" data-world={world}>
          <canvas ref={canvas} width={SHARE_W} height={SHARE_H} aria-label={`${title}: share picture`} role="img" />
          {!assets ? <span className="wr-share-wait">Drawing your picture</span> : null}
        </div>
        <div className="wr-share-side">
          <fieldset className="wr-choice">
            <legend>Picture</legend>
            {(
              [
                ["songs", "Top songs", "Your five most played, with covers"],
                ["numbers", "My numbers", "Minutes, songs and your song of the year"],
              ] as const
            ).map(([value, label, line]) => (
              <label key={value} className="wr-choice-row" data-on={design === value || undefined}>
                <input type="radio" name="wr-design" value={value} checked={design === value} onChange={() => setDesign(value)} />
                <span>
                  <span className="wr-choice-label">{label}</span>
                  <span className="wr-choice-line">{line}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <div className="wr-share-actions">
            {route === "share" ? (
              <Button type="button" onClick={share} disabled={!file}>
                <Share2 aria-hidden className="size-4" /> Share to a story
              </Button>
            ) : null}
            {file ? (
              <a
                href={file.url}
                download={file.file.name}
                className="wr-pill wr-pill-quiet"
                onClick={() => void countWrap(wrap.season.id, "SHARED_SAVE")}
              >
                <Download aria-hidden className="size-4" /> Save picture
              </a>
            ) : null}
            {wrap.season.sharing.show_link ? (
              <button type="button" className="wr-pill wr-pill-quiet" onClick={copy}>
                <Copy aria-hidden className="size-4" /> Copy Wrap link
              </button>
            ) : null}
          </div>
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
