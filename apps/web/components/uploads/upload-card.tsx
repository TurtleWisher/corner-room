"use client";

/* Resumable upload of one master or cover (AUDIO_PHASE_1_DESIGN section 6).
 *
 * Every state shown comes from the API except the byte counter while parts are being sent, which
 * is labelled as such. Leaving the page keeps the upload open on the server; choosing the same
 * file again continues from the parts already received.
 */

import { useEffect, useId, useRef, useState } from "react";
import { CircleAlert, CloudUpload, FileAudio, ImageIcon, RotateCcw, X } from "lucide-react";

import { Button } from "@/components/ds";
import { ApiError } from "@/lib/api/client";
import {
  cancelUpload,
  completeUpload,
  createUploadIntent,
  findOpenUpload,
  putUploadPart,
  type UploadCompleteRecord,
  type UploadIntentRecord,
  type UploadPurpose,
  type UploadTargetType,
} from "@/features/uploads/api";
import {
  bytesReceived,
  formatBytes,
  partsToSend,
  percent,
  planParts,
  preCheckFile,
  uploadErrorText,
} from "@/lib/upload-view";

const MAX_BYTES: Record<UploadPurpose, number> = {
  AUDIO_MASTER: 2 * 1024 * 1024 * 1024,
  COVER_ART: 20 * 1024 * 1024,
};

const ACCEPT: Record<UploadPurpose, string> = {
  AUDIO_MASTER: ".flac,.wav,.wave,audio/flac,audio/wav,audio/x-wav",
  COVER_ART: ".jpg,.jpeg,.png,image/jpeg,image/png",
};

const GUIDANCE: Record<UploadPurpose, string> = {
  AUDIO_MASTER: "FLAC (preferred) or PCM WAV, stereo, 44.1 kHz or higher, 16- or 24-bit, up to 2 GB and 60 minutes.",
  COVER_ART: "Square JPEG or PNG, 3000 × 3000 px recommended (1400 to 6000 px), up to 20 MB.",
};

type Phase =
  | { kind: "idle" }
  | { kind: "sending"; sent: number; total: number }
  | { kind: "finishing" }
  | { kind: "done"; result: UploadCompleteRecord }
  | { kind: "error"; message: string };

/** Blob.arrayBuffer() where available; FileReader on older browsers (Safari before 14). */
function readSlice(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === "function") return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsArrayBuffer(blob);
  });
}

async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function UploadCard({
  purpose,
  targetType,
  targetId,
  title,
  onCompleted,
}: {
  purpose: UploadPurpose;
  targetType: UploadTargetType;
  targetId: string;
  title?: string;
  onCompleted?: (result: UploadCompleteRecord) => void;
}) {
  const inputId = useId();
  const [open, setOpen] = useState<UploadIntentRecord | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const cancelled = useRef(false);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    let alive = true;
    findOpenUpload(targetType, targetId)
      .then((row) => alive && setOpen(row))
      .catch(() => alive && setOpen(null));
    return () => {
      alive = false;
    };
  }, [targetType, targetId]);

  async function start(file: File) {
    const early = preCheckFile(file, purpose, MAX_BYTES[purpose]);
    if (early) {
      setPhase({ kind: "error", message: early });
      return;
    }
    cancelled.current = false;
    try {
      const intent = await createUploadIntent({
        purpose,
        target_type: targetType,
        target_id: targetId,
        filename: file.name,
        byte_size: file.size,
      });
      setOpen(intent);
      const plan = planParts(file.size, intent.part_size);
      let sent = bytesReceived(plan, intent.parts_received);
      setPhase({ kind: "sending", sent, total: file.size });
      for (const part of partsToSend(plan, intent.parts_received)) {
        if (cancelled.current) return;
        const data = await readSlice(file.slice(part.start, part.end));
        await putUploadPart(intent.id, part.number, data, await sha256Hex(data));
        sent += part.end - part.start;
        setPhase({ kind: "sending", sent, total: file.size });
      }
      setPhase({ kind: "finishing" });
      const result = await completeUpload(intent.id);
      setOpen(null);
      setPhase({ kind: "done", result });
      onCompleted?.(result);
    } catch (err) {
      const code = err instanceof ApiError ? err.code : undefined;
      const fallback = err instanceof ApiError ? err.message : "The upload stopped. Check your connection and try again.";
      setPhase({ kind: "error", message: uploadErrorText(code, fallback) });
    }
  }

  async function cancel() {
    cancelled.current = true;
    if (open) {
      try {
        await cancelUpload(open.id);
      } catch {
        // The server expires it later anyway.
      }
    }
    setOpen(null);
    setPhase({ kind: "idle" });
  }

  const Icon = purpose === "AUDIO_MASTER" ? FileAudio : ImageIcon;
  const busy = phase.kind === "sending" || phase.kind === "finishing";
  const resumePercent = open ? percent(bytesReceived(planParts(open.byte_size, open.part_size), open.parts_received), open.byte_size) : 0;

  return (
    <section
      className={`cr-glass-card rounded-none p-5 ${dragging ? "outline-2 outline-offset-2 outline-dashed outline-[var(--cr-accent)]" : ""}`}
      aria-label={title ?? (purpose === "AUDIO_MASTER" ? "Upload master" : "Upload cover art")}
      // Drop a file anywhere on the card; the file picker below does the same by keyboard or touch.
      onDragOver={(e) => {
        if (busy || !e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files?.[0];
        if (file && !busy) void start(file);
      }}
    >
      <div className="flex items-start gap-3">
        <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-highlight" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-fg">{title ?? (purpose === "AUDIO_MASTER" ? "Master audio" : "Cover art")}</p>
          <p className="mt-1 text-sm text-fg-muted">{GUIDANCE[purpose]}</p>
          <p className="mt-1 text-sm text-fg-muted">Drop the file on this card, or choose it below.</p>

          {open && phase.kind === "idle" ? (
            <p className="mt-3 text-sm text-fg" role="status">
              An upload of <span className="font-semibold">{open.filename}</span> ({formatBytes(open.byte_size)}) is {resumePercent}% done.
              Choose the same file to continue.
            </p>
          ) : null}

          {phase.kind === "sending" ? (
            <div className="mt-4">
              {/* Announced once; the byte counter below is not live, so screen readers don't read every tick. */}
              <p className="sr-only" role="status">
                Sending your file.
              </p>
              <div
                className="h-2 w-full bg-line"
                role="progressbar"
                aria-label="Upload progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent(phase.sent, phase.total)}
              >
                <div className="h-2 bg-highlight transition-[width]" style={{ width: `${percent(phase.sent, phase.total)}%` }} />
              </div>
              <p className="mt-2 text-sm text-fg-muted">
                Sending {formatBytes(phase.sent)} of {formatBytes(phase.total)} ({percent(phase.sent, phase.total)}%)
              </p>
            </div>
          ) : null}
          {phase.kind === "finishing" ? (
            <p className="mt-4 text-sm text-fg" role="status">Putting the file together and checking it arrived intact…</p>
          ) : null}
          {phase.kind === "done" ? (
            <p className="mt-4 text-sm text-fg" role="status">
              Uploaded ({formatBytes(phase.result.byte_size)}). {purpose === "AUDIO_MASTER" ? "Checking your audio next." : "Checking your artwork next."}
            </p>
          ) : null}
          {phase.kind === "error" ? (
            <p className="mt-4 flex items-start gap-2 text-sm text-danger" role="alert">
              <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              {phase.message}
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <input
              id={inputId}
              type="file"
              accept={ACCEPT[purpose]}
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
              // Focus sits on the hidden input, so its ring is drawn on this label (keyboard users see it).
              className={`inline-flex cursor-pointer items-center gap-2 border border-line px-4 py-2 text-sm font-semibold text-fg hover:border-highlight peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-solid peer-focus-visible:outline-[var(--cr-focus)] ${busy ? "pointer-events-none opacity-50" : ""}`}
            >
              {open && phase.kind !== "done" ? <RotateCcw aria-hidden="true" className="size-4" /> : <CloudUpload aria-hidden="true" className="size-4" />}
              {open && phase.kind !== "done" ? "Choose the file to continue" : phase.kind === "done" ? "Upload a different file" : "Choose a file"}
            </label>
            {open && (busy || phase.kind === "idle" || phase.kind === "error") ? (
              <Button variant="ghost" size="sm" onClick={() => void cancel()}>
                <X aria-hidden="true" /> Cancel upload
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
