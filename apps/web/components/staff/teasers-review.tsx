"use client";

/*
 * Staff: teasers waiting for review (owner, 2026-11-07, D-TEASER-01). Listen to the made teaser as fans
 * will hear it, then approve (it goes live at once, replacing any live version) or send it back with a
 * note the artist sees. Whoever made or sent it, and the music's own people, can't approve (the API
 * checks). Once approved, anyone can listen to it free, as often as they like.
 */

import { useEffect, useRef, useState } from "react";
import { CircleAlert, Pause, Play } from "lucide-react";

import { Button, Card, ErrorState, LoadingState } from "@/components/staff/kit";
import { useWorkspace } from "@/components/workspace-provider";
import { fetchStudioVersionAudio, fetchTeaserQueue, reviewTeaser, type TeaserQueueItem } from "@/features/teasers/api";
import { resolveMediaUrl } from "@/lib/api";
import { ApiError } from "@/lib/api/client";
import { friendlyError } from "@/lib/error-copy";
import { formatLength, formatTime } from "@/lib/teaser-editor-view";

function Item({ t, onDone }: { t: TeaserQueueItem; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => () => audio.current?.pause(), []);

  async function listen() {
    if (playing) {
      audio.current?.pause();
      setPlaying(false);
      return;
    }
    try {
      const a = audio.current ?? new Audio();
      audio.current = a;
      if (!a.src) {
        const got = await fetchStudioVersionAudio(t.teaser_id, t.version_id);
        a.src = resolveMediaUrl(got.url);
        a.onended = () => setPlaying(false);
      }
      await a.play();
      setPlaying(true);
    } catch (err) {
      setError(friendlyError(err, "The teaser couldn't play."));
    }
  }

  async function act(action: "approve" | "return") {
    if (action === "return" && !note.trim()) {
      setError("Write a note the artist will see.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await reviewTeaser(t.teaser_id, action, note);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError && err.code === "SAME_PERSON_REVIEW" ? err.message : friendlyError(err, "That review didn't go through."));
      setBusy(false);
    }
  }

  return (
    <li className="border-b py-4">
      <p className="font-medium">
        {t.track_title}
        {t.title ? <span className="font-normal"> · {t.title}</span> : null}
        <span className="font-normal text-muted-foreground"> · {t.profile_name ?? "Artist"}</span>
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        Version {t.number} · {formatTime(t.start_ms)} to {formatTime(t.end_ms)}
        {t.duration_ms ? ` · ${formatLength(t.duration_ms)}` : ""} · song is {t.track_status === "RELEASED" ? "out" : "not out yet"}
        {t.replaces_live ? " · replaces the live teaser" : ""}
      </p>
      <div className="mt-2">
        <Button variant="outline" onClick={() => void listen()}>
          {playing ? <Pause aria-hidden="true" className="mr-1 size-4" /> : <Play aria-hidden="true" className="mr-1 size-4" />}
          {playing ? "Pause" : "Listen as fans will"}
        </Button>
      </div>
      <textarea
        className="mt-3 min-h-16 w-full rounded border p-2 text-sm"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note for the artist (required to send back)"
        aria-label={`Review note for the teaser of ${t.track_title}`}
        maxLength={2000}
      />
      <div className="mt-2 flex gap-2">
        <Button disabled={busy} onClick={() => void act("approve")}>
          Approve and publish
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => void act("return")}>
          Send back
        </Button>
      </div>
      {error ? (
        <p role="alert" className="mt-2 flex items-center gap-2 text-sm text-red-600">
          <CircleAlert aria-hidden="true" className="size-4" /> {error}
        </p>
      ) : null}
    </li>
  );
}

export function TeasersReview() {
  const { currentOrg } = useWorkspace();
  const [items, setItems] = useState<TeaserQueueItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState(0);

  useEffect(() => {
    if (!currentOrg) return;
    fetchTeaserQueue()
      .then(setItems)
      .catch((err) => (err instanceof ApiError && err.status === 403 ? setItems([]) : setError(friendlyError(err, "Teasers couldn't be loaded."))));
  }, [currentOrg, round]);

  if (!currentOrg || (items !== null && items.length === 0 && !error)) return null;
  return (
    <Card className="p-5">
      <h2 className="text-lg font-semibold">Teasers waiting for review</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Short parts of songs that anyone will be able to hear free, as often as they like. Nothing is public until it is approved.
      </p>
      {error ? <ErrorState message={error} /> : items === null ? <LoadingState /> : (
        <ul className="mt-2">
          {items.map((t) => (
            <Item key={t.version_id} t={t} onDone={() => setRound((n) => n + 1)} />
          ))}
        </ul>
      )}
    </Card>
  );
}
