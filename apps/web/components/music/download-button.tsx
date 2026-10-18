"use client";

/*
 * Download a bought song (AUDIO Phase 8, D-AUDIO-06): FLAC (lossless) or MP3 320. The file is
 * fetched with visible progress, can be cancelled and retried, and its SHA-256 is checked against
 * the API's before it is saved. Very large files go to the browser's own download manager. Only
 * shown for songs bought (or on a bought release); the API checks ownership on every request.
 */

import { useEffect, useId, useRef, useState } from "react";
import { CircleAlert, CircleCheck, Download, Loader2, X } from "lucide-react";

import {
  fetchDownloadOptions,
  startDownload,
  type DownloadFormat,
  type DownloadGrantRecord,
  type DownloadOptionRecord,
} from "@/features/downloads/api";
import { resolveMediaUrl } from "@/features/streaming/api";
import { ApiError } from "@/lib/api/client";
import { downloadErrorText, IN_PAGE_LIMIT_BYTES, optionDetail, percent, toHex } from "@/lib/download-view";
import { cn } from "@/lib/utils";

type State =
  | { kind: "idle" }
  | { kind: "choosing"; options: DownloadOptionRecord[] | null; error: string | null }
  | { kind: "downloading"; format: DownloadFormat; received: number; total: number | null }
  | { kind: "verifying" }
  | { kind: "done"; filename: string; verified: boolean }
  | { kind: "failed"; message: string; format: DownloadFormat };

function save(href: string, filename: string): void {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

async function problemCode(res: Response): Promise<string | null> {
  try {
    return ((await res.json()) as { code?: string }).code ?? null;
  } catch {
    return null;
  }
}

export function DownloadButton({ trackId, title, size = "sm" }: { trackId: string; title: string; size?: "sm" | "md" }) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const abort = useRef<AbortController | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    if (state.kind !== "choosing") return;
    const close = (e: PointerEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setState({ kind: "idle" });
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", close);
    };
  }, [state.kind]);

  async function choose() {
    setState({ kind: "choosing", options: null, error: null });
    try {
      const options = await fetchDownloadOptions(trackId);
      setState((s) => (s.kind === "choosing" ? { kind: "choosing", options, error: null } : s));
    } catch (err) {
      const message = downloadErrorText(err instanceof ApiError ? err.code : null);
      setState((s) => (s.kind === "choosing" ? { kind: "choosing", options: [], error: message } : s));
    }
  }

  async function run(format: DownloadFormat) {
    const controller = new AbortController();
    abort.current = controller;
    setState({ kind: "downloading", format, received: 0, total: null });
    let grant: DownloadGrantRecord;
    try {
      grant = await startDownload(trackId, format);
    } catch (err) {
      setState({ kind: "failed", format, message: downloadErrorText(err instanceof ApiError ? err.code : null) });
      return;
    }
    const url = resolveMediaUrl(grant.url);
    if (grant.byte_size > IN_PAGE_LIMIT_BYTES) {
      // Too big to hold in the page: the browser saves it (the link still checks ownership).
      save(url, grant.filename);
      setState({ kind: "done", filename: grant.filename, verified: false });
      return;
    }
    try {
      const res = await fetch(url, { signal: controller.signal, credentials: "omit" });
      if (!res.ok || !res.body) {
        setState({ kind: "failed", format, message: downloadErrorText(await problemCode(res)) });
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
        setState({ kind: "downloading", format, received, total });
      }
      const blob = new Blob(chunks, { type: grant.content_type });
      let verified = false;
      if (typeof crypto !== "undefined" && crypto.subtle) {
        setState({ kind: "verifying" });
        const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
        if (toHex(digest) !== grant.sha256.toLowerCase()) {
          setState({ kind: "failed", format, message: downloadErrorText("INTEGRITY") });
          return;
        }
        verified = true;
      }
      const href = URL.createObjectURL(blob);
      save(href, grant.filename);
      window.setTimeout(() => URL.revokeObjectURL(href), 60_000);
      setState({ kind: "done", filename: grant.filename, verified });
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") {
        setState({ kind: "idle" });
        return;
      }
      setState({ kind: "failed", format, message: downloadErrorText(null) });
    } finally {
      if (abort.current === controller) abort.current = null;
    }
  }

  const iconSize = size === "md" ? "size-5" : "size-4";

  if (state.kind === "downloading" || state.kind === "verifying") {
    const pct = state.kind === "downloading" ? percent(state.received, state.total) : 100;
    return (
      <span className="inline-flex items-center gap-2" role="status" aria-live="polite">
        <span className="relative h-1.5 w-20 overflow-hidden bg-[var(--cr-line,rgba(127,127,127,0.3))]" aria-hidden="true">
          <span className="absolute inset-y-0 left-0 bg-[var(--cr-highlight,currentColor)]" style={{ width: `${pct ?? 30}%` }} />
        </span>
        <span className="cr-num whitespace-nowrap text-xs text-fg-muted">
          {state.kind === "verifying" ? "Checking the file" : pct === null ? "Downloading" : `Downloading ${pct}%`}
        </span>
        {state.kind === "downloading" ? (
          <button
            type="button"
            onClick={() => abort.current?.abort()}
            aria-label={`Cancel the download of ${title}`}
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
        <button type="button" onClick={() => void run(state.format)} className="cr-focus whitespace-nowrap text-xs font-semibold text-link hover:underline">
          Try again
        </button>
      </span>
    );
  }

  return (
    <div ref={box} className="relative inline-flex items-center gap-2">
      <button
        type="button"
        onClick={() => (state.kind === "choosing" ? setState({ kind: "idle" }) : void choose())}
        aria-expanded={state.kind === "choosing"}
        aria-controls={state.kind === "choosing" ? panelId : undefined}
        aria-label={`Download ${title}`}
        title="Download"
        className={cn(
          "cr-focus inline-flex items-center justify-center text-fg-muted hover:text-fg",
          size === "md" ? "size-11" : "size-9",
        )}
      >
        <Download aria-hidden="true" className={iconSize} />
      </button>
      {state.kind === "done" ? (
        <span role="status" className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-semibold text-success">
          <CircleCheck aria-hidden="true" className="size-4" /> {state.verified ? "Saved, file checked" : "Sent to your downloads"}
        </span>
      ) : null}
      {state.kind === "choosing" ? (
        <div id={panelId} className="cr-glass-card absolute right-0 top-full z-20 mt-2 w-64 border border-line p-3 text-left">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-fg-muted">Download</p>
          {state.options === null ? (
            <p className="mt-2 inline-flex items-center gap-2 text-sm text-fg-muted">
              <Loader2 aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" /> Loading
            </p>
          ) : state.error ? (
            <p role="alert" className="mt-2 text-sm text-danger">
              {state.error}
            </p>
          ) : (
            <ul className="mt-2 grid gap-1">
              {state.options.map((o) => (
                <li key={o.format}>
                  <button
                    type="button"
                    disabled={!o.available}
                    onClick={() => void run(o.format)}
                    className="cr-focus w-full px-2 py-1.5 text-left hover:bg-[var(--cr-surface-2,transparent)] disabled:opacity-50"
                  >
                    <span className="block text-sm font-semibold text-fg">{o.label}</span>
                    <span className="cr-num block text-xs text-fg-muted">{optionDetail(o)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[0.6875rem] text-fg-muted">Yours to keep. Download again any time from your library.</p>
        </div>
      ) : null}
    </div>
  );
}
