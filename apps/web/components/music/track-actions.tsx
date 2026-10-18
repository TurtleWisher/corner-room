"use client";

/* Save to library and add to a playlist, from the listening controls (AUDIO Phase 8). Every button
 * calls the API and shows what happened; the server decides what is allowed. */

import { useEffect, useId, useRef, useState } from "react";
import { Check, ListPlus, Loader2, Plus } from "lucide-react";

import { useAsync } from "@/components/use-async";
import { addLibraryItem, addPlaylistItem, createPlaylist, fetchPlaylistItems, fetchPlaylists } from "@/features/streaming/api";
import { ApiError } from "@/lib/api/client";
import { cn } from "@/lib/utils";

const ICON_BUTTON = "cr-focus inline-flex size-10 items-center justify-center text-fg-muted hover:text-fg disabled:opacity-50";

function SaveToLibrary({ trackId, title }: { trackId: string; title: string }) {
  const [state, setState] = useState<"idle" | "busy" | "saved" | "error">("idle");
  // A new track starts unsaved in this control; the library page is the full record.
  useEffect(() => setState("idle"), [trackId]);
  async function save() {
    setState("busy");
    try {
      await addLibraryItem(trackId, "SAVE");
      setState("saved");
    } catch (err) {
      // Saving twice is still saved.
      setState(err instanceof ApiError && err.status === 409 ? "saved" : "error");
    }
  }
  return (
    <button
      type="button"
      onClick={() => void save()}
      disabled={state === "busy" || state === "saved"}
      aria-label={state === "saved" ? `${title} is in your library` : state === "error" ? `Not saved. Try saving ${title} again` : `Save ${title} to your library`}
      title={state === "saved" ? "In your library" : state === "error" ? "Not saved, try again" : "Save to library"}
      className={cn(ICON_BUTTON, state === "saved" && "text-success disabled:opacity-100", state === "error" && "text-danger")}
    >
      {state === "busy" ? (
        <Loader2 aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
      ) : state === "saved" ? (
        <Check aria-hidden="true" className="size-4" />
      ) : (
        <Plus aria-hidden="true" className="size-4" />
      )}
    </button>
  );
}

function PlaylistPanel({ trackId, onDone }: { trackId: string; onDone: (message: string, ok: boolean) => void }) {
  const lists = useAsync(() => fetchPlaylists().then((p) => p.items.filter((l) => l.kind === "USER" && l.status !== "ARCHIVED")), []);
  const [busy, setBusy] = useState<string | null>(null);
  const [name, setName] = useState("");

  async function addTo(id: string, title: string) {
    setBusy(id);
    try {
      const items = await fetchPlaylistItems(id);
      if (items.some((i) => i.track_id === trackId)) {
        onDone(`Already in ${title}`, true);
        return;
      }
      await addPlaylistItem(id, trackId, items.length + 1);
      onDone(`Added to ${title}`, true);
    } catch (err) {
      onDone(err instanceof ApiError ? err.message : `Could not add to ${title}`, false);
    } finally {
      setBusy(null);
    }
  }

  async function createAndAdd() {
    const title = name.trim();
    if (!title) return;
    setBusy("new");
    try {
      const list = await createPlaylist(title);
      await addPlaylistItem(list.id, trackId, 1);
      onDone(`Added to ${title}`, true);
    } catch (err) {
      onDone(err instanceof ApiError ? err.message : "The playlist could not be created", false);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="cr-glass-card absolute bottom-full right-0 z-10 mb-2 w-64 border border-line p-3 text-left">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-fg-muted">Add to playlist</p>
      {lists.status === "loading" ? (
        <p className="mt-2 text-sm text-fg-muted">Loading your playlists</p>
      ) : lists.status === "error" ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          Your playlists could not be loaded.
        </p>
      ) : (
        <ul className="mt-2 max-h-48 overflow-y-auto">
          {lists.data.length === 0 ? <li className="text-sm text-fg-muted">No playlists yet.</li> : null}
          {lists.data.map((l) => (
            <li key={l.id}>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void addTo(l.id, l.title)}
                className="cr-focus flex w-full items-center justify-between gap-2 px-2 py-1.5 text-sm text-fg hover:bg-[var(--cr-surface-2,transparent)] disabled:opacity-50"
              >
                <span className="truncate">{l.title}</span>
                {busy === l.id ? <Loader2 aria-hidden="true" className="size-3.5 animate-spin motion-reduce:animate-none" /> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="mt-3 flex gap-2 border-t border-line pt-3"
        onSubmit={(e) => {
          e.preventDefault();
          void createAndAdd();
        }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
          maxLength={120}
          placeholder="New playlist"
          aria-label="New playlist name"
          className="cr-focus min-w-0 flex-1 border border-line bg-transparent px-2 py-1 text-sm text-fg"
        />
        <button type="submit" disabled={busy !== null || !name.trim()} className="cr-focus px-2 text-sm font-semibold text-link disabled:opacity-50">
          {busy === "new" ? "Adding" : "Create"}
        </button>
      </form>
    </div>
  );
}

function AddToPlaylist({ trackId, title }: { trackId: string; title: string }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    setOpen(false);
    setNote(null);
  }, [trackId]);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", close);
    };
  }, [open]);
  useEffect(() => {
    if (!note) return;
    const t = window.setTimeout(() => setNote(null), 4000);
    return () => window.clearTimeout(t);
  }, [note]);

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={`Add ${title} to a playlist`}
        title="Add to playlist"
        className={ICON_BUTTON}
      >
        <ListPlus aria-hidden="true" className="size-4" />
      </button>
      {open ? (
        <div id={panelId}>
          <PlaylistPanel
            trackId={trackId}
            onDone={(text, ok) => {
              setNote({ text, ok });
              if (ok) setOpen(false);
            }}
          />
        </div>
      ) : null}
      <span aria-live="polite" className={cn("absolute bottom-full right-0 mb-1 whitespace-nowrap text-xs font-semibold", note?.ok ? "text-success" : "text-danger")}>
        {note && !open ? note.text : ""}
      </span>
    </div>
  );
}

/** The two library actions for the track that is playing. */
export function TrackActions({ trackId, title }: { trackId: string; title: string }) {
  return (
    <div className="flex items-center">
      <SaveToLibrary trackId={trackId} title={title} />
      <AddToPlaylist trackId={trackId} title={title} />
    </div>
  );
}
