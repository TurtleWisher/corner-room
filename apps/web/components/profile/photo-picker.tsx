"use client";

/* Choose a profile picture (owner, 2026-10-23). The browser takes the middle square of the photo,
 * scales a big one down and sends it as a JPEG through the same checked upload as cover art; the
 * API checks it again (square, at least 400 px) and decides what happens next. */

import { useEffect, useId, useRef, useState } from "react";
import { Camera, CircleAlert, Loader2 } from "lucide-react";

import { sendUpload } from "@/features/uploads/send";
import type { UploadTargetType } from "@/features/uploads/api";
import { ApiError } from "@/lib/api/client";
import { PHOTO_MIN_PX, photoOutputSide, photoProblem, squareCrop } from "@/lib/profile-view";
import { percent, uploadErrorText } from "@/lib/upload-view";

type Phase = { kind: "idle" } | { kind: "preparing" } | { kind: "sending"; pct: number } | { kind: "error"; message: string };

async function decode(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  await img.decode();
  return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
}

/** The middle square of the photo as a JPEG file, or why it can't be used. */
async function squarePhoto(file: File): Promise<File | string> {
  let image;
  try {
    image = await decode(file);
  } catch {
    return "This image couldn't be read. Try a JPEG or PNG.";
  }
  try {
    const problem = photoProblem(image.width, image.height);
    if (problem) return problem;
    const { sx, sy, side } = squareCrop(image.width, image.height);
    const out = photoOutputSide(side);
    const canvas = document.createElement("canvas");
    canvas.width = out;
    canvas.height = out;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "Your browser couldn't prepare the photo. Try another browser.";
    ctx.drawImage(image.source, sx, sy, side, side, 0, 0, out, out);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
    if (!blob) return "Your browser couldn't prepare the photo. Try another browser.";
    return new File([blob], "profile-photo.jpg", { type: "image/jpeg" });
  } finally {
    image.close();
  }
}

export function PhotoPicker({
  targetType,
  targetId,
  label = "Choose a photo",
  onUploaded,
}: {
  targetType: Extract<UploadTargetType, "user_avatar" | "artist_portrait" | "band_portrait">;
  targetId: string;
  label?: string;
  /** The file arrived; the checks run next (show the report, then reload). */
  onUploaded: () => void;
}) {
  const inputId = useId();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [preview, setPreview] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  async function start(original: File) {
    setPhase({ kind: "preparing" });
    const file = await squarePhoto(original);
    if (!alive.current) return;
    if (typeof file === "string") {
      setPhase({ kind: "error", message: file });
      return;
    }
    setPreview(URL.createObjectURL(file));
    try {
      const result = await sendUpload({
        file,
        purpose: "COVER_ART",
        targetType,
        targetId,
        onProgress: (sent, total) => alive.current && setPhase({ kind: "sending", pct: percent(sent, total) }),
        isCancelled: () => !alive.current,
      });
      if (!result || !alive.current) return;
      setPhase({ kind: "idle" });
      setPreview(null);
      onUploaded();
    } catch (err) {
      if (!alive.current) return;
      const code = err instanceof ApiError ? err.code : undefined;
      const fallback = err instanceof ApiError ? err.message : "The upload stopped. Check your connection and try again.";
      setPhase({ kind: "error", message: uploadErrorText(code, fallback) });
    }
  }

  const busy = phase.kind === "preparing" || phase.kind === "sending";
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        {preview && busy ? (
          // eslint-disable-next-line @next/next/no-img-element -- local preview of the photo being sent
          <img src={preview} alt="" className="size-12 object-cover" />
        ) : null}
        <input
          id={inputId}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
          className="peer sr-only"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void start(file);
          }}
        />
        <label
          htmlFor={inputId}
          // Focus sits on the hidden input, so its ring is drawn on this label.
          className={`inline-flex cursor-pointer items-center gap-2 border border-line px-4 py-2 text-sm font-semibold text-fg hover:border-highlight peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-solid peer-focus-visible:outline-[var(--cr-focus)] ${busy ? "pointer-events-none opacity-50" : ""}`}
        >
          {busy ? <Loader2 aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" /> : <Camera aria-hidden="true" className="size-4" />}
          {phase.kind === "preparing" ? "Preparing your photo…" : phase.kind === "sending" ? `Sending… ${phase.pct}%` : label}
        </label>
      </div>
      <p className="mt-2 text-xs text-fg-muted">
        JPEG or PNG, at least {PHOTO_MIN_PX} × {PHOTO_MIN_PX} px. We use the middle square of your photo.
      </p>
      {phase.kind === "sending" ? (
        <p className="sr-only" role="status">
          Sending your photo.
        </p>
      ) : null}
      {phase.kind === "error" ? (
        <p className="mt-2 flex items-start gap-2 text-sm text-danger" role="alert">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {phase.message}
        </p>
      ) : null}
    </div>
  );
}
