"use client";

/*
 * Save a bought song for offline listening inside Corner Room (owner, 2026-10-25, D-AUDIO-18; it
 * replaces the file download button). The MP3 320 copy comes from the buyer-only download
 * endpoint with visible progress, is checked against the API's SHA-256, and is kept in this
 * browser (lib/offline-store.ts). It then plays without a connection on /offline.html. Only shown
 * for songs bought (or on a bought release); the API checks ownership on every request.
 */

import { useEffect, useRef, useState } from "react";
import { CircleAlert, CircleCheck, CloudDownload, Trash2, X } from "lucide-react";

import { useAuth } from "@/components/auth-provider";
import { startDownload, type DownloadGrantRecord } from "@/features/downloads/api";
import { resolveMediaUrl } from "@/features/streaming/api";
import { ApiError } from "@/lib/api/client";
import { coverUrl } from "@/lib/cover-view";
import { downloadErrorText, percent, sizeLabel, toHex } from "@/lib/download-view";
import { askToKeepStorage, getOfflineSong, offlineSupported, removeOfflineSong, saveOfflineSong } from "@/lib/offline-store";
import { cn } from "@/lib/utils";

type State =
  | { kind: "checking" }
  | { kind: "idle" }
  | { kind: "saving"; received: number; total: number | null }
  | { kind: "verifying" }
  | { kind: "saved"; byteSize: number }
  | { kind: "failed"; message: string };

async function problemCode(res: Response): Promise<string | null> {
  try {
    return ((await res.json()) as { code?: string }).code ?? null;
  } catch {
    return null;
  }
}

async function coverBlob(trackId: string): Promise<Blob | null> {
  const url = coverUrl({ track: trackId }, 480);
  if (!url) return null;
  try {
    const res = await fetch(url, { credentials: "omit" });
    return res.ok ? await res.blob() : null;
  } catch {
    return null;
  }
}

export function SaveOfflineButton({
  trackId,
  title,
  releaseIds = [],
  size = "sm",
}: {
  trackId: string;
  title: string;
  releaseIds?: readonly string[];
  size?: "sm" | "md";
}) {
  const { user } = useAuth();
  const [state, setState] = useState<State>({ kind: "checking" });
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    let live = true;
    if (!offlineSupported()) {
      setState({ kind: "idle" });
      return;
    }
    getOfflineSong(trackId)
      .then((song) => live && setState(song && song.userId === user?.id ? { kind: "saved", byteSize: song.byteSize } : { kind: "idle" }))
      .catch(() => live && setState({ kind: "idle" }));
    return () => {
      live = false;
    };
  }, [trackId, user?.id]);
  useEffect(() => () => abort.current?.abort(), []);

  if (!offlineSupported() || !user) return null;

  async function save() {
    const controller = new AbortController();
    abort.current = controller;
    setState({ kind: "saving", received: 0, total: null });
    let grant: DownloadGrantRecord;
    try {
      grant = await startDownload(trackId, "mp3");
    } catch (err) {
      setState({ kind: "failed", message: downloadErrorText(err instanceof ApiError ? err.code : null) });
      return;
    }
    try {
      const res = await fetch(resolveMediaUrl(grant.url), { signal: controller.signal, credentials: "omit" });
      if (!res.ok || !res.body) {
        setState({ kind: "failed", message: downloadErrorText(await problemCode(res)) });
        return;
      }
      const total = Number(res.headers.get("Content-Length")) || grant.byte_size;
      const reader = res.body.getReader();
      const chunks: BlobPart[] = [];
      let received = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value as BlobPart);
        received += value.byteLength;
        setState({ kind: "saving", received, total });
      }
      const audio = new Blob(chunks, { type: grant.content_type });
      if (typeof crypto !== "undefined" && crypto.subtle) {
        setState({ kind: "verifying" });
        const digest = await crypto.subtle.digest("SHA-256", await audio.arrayBuffer());
        if (toHex(digest) !== grant.sha256.toLowerCase()) {
          setState({ kind: "failed", message: downloadErrorText("INTEGRITY") });
          return;
        }
      }
      await askToKeepStorage();
      await saveOfflineSong({
        trackId,
        title,
        releaseIds: [...releaseIds],
        audio,
        mime: grant.content_type,
        byteSize: audio.size,
        sha256: grant.sha256.toLowerCase(),
        cover: await coverBlob(trackId),
        userId: user!.id,
        savedAt: new Date().toISOString(),
      });
      setState({ kind: "saved", byteSize: audio.size });
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") {
        setState({ kind: "idle" });
        return;
      }
      // QuotaExceededError and friends: the browser refused to keep it.
      setState({ kind: "failed", message: "This song could not be saved on this device. Free some space and try again." });
    } finally {
      if (abort.current === controller) abort.current = null;
    }
  }

  async function forget() {
    await removeOfflineSong(trackId).catch(() => undefined);
    setState({ kind: "idle" });
  }

  const iconSize = size === "md" ? "size-5" : "size-4";
  const box = size === "md" ? "size-11" : "size-9";

  if (state.kind === "checking") return <span className={cn("inline-block", box)} aria-hidden="true" />;

  if (state.kind === "saving" || state.kind === "verifying") {
    const pct = state.kind === "saving" ? percent(state.received, state.total) : 100;
    return (
      <span className="inline-flex items-center gap-2" role="status" aria-live="polite">
        <span className="relative h-1.5 w-20 overflow-hidden bg-[var(--cr-line,rgba(127,127,127,0.3))]" aria-hidden="true">
          <span className="absolute inset-y-0 left-0 bg-[var(--cr-highlight,currentColor)]" style={{ width: `${pct ?? 30}%` }} />
        </span>
        <span className="cr-num whitespace-nowrap text-xs text-fg-muted">
          {state.kind === "verifying" ? "Checking" : pct === null ? "Saving" : `Saving ${pct}%`}
        </span>
        {state.kind === "saving" ? (
          <button
            type="button"
            onClick={() => abort.current?.abort()}
            aria-label={`Stop saving ${title}`}
            className="cr-focus inline-flex size-8 items-center justify-center text-fg-muted hover:text-fg"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        ) : null}
      </span>
    );
  }

  if (state.kind === "failed") {
    return (
      <span className="inline-flex items-center gap-2">
        <span role="alert" className="inline-flex items-center gap-1 text-xs text-danger">
          <CircleAlert aria-hidden="true" className="size-4 shrink-0" /> {state.message}
        </span>
        <button type="button" onClick={() => void save()} className="cr-focus whitespace-nowrap text-xs font-semibold text-link hover:underline">
          Try again
        </button>
      </span>
    );
  }

  if (state.kind === "saved") {
    return (
      <span className="inline-flex items-center gap-1">
        <a
          href="/offline.html"
          className="cr-focus inline-flex items-center gap-1 whitespace-nowrap text-xs font-semibold text-success hover:underline"
          title={sizeLabel(state.byteSize) ?? undefined}
        >
          <CircleCheck aria-hidden="true" className="size-4" /> Saved offline
        </a>
        <button
          type="button"
          onClick={() => void forget()}
          aria-label={`Remove ${title} from this device`}
          title="Remove from this device"
          className={cn("cr-focus inline-flex items-center justify-center text-fg-muted hover:text-fg", box)}
        >
          <Trash2 aria-hidden="true" className={iconSize} />
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void save()}
      aria-label={`Save ${title} for offline listening`}
      title="Save for offline"
      className={cn("cr-focus inline-flex items-center justify-center text-fg-muted hover:text-fg", box)}
    >
      <CloudDownload aria-hidden="true" className={iconSize} />
    </button>
  );
}
