"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

import { Protected } from "@/components/protected";
import { ErrorState, LoadingState } from "@/components/async-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  ApiError,
  addLibraryItem,
  closeListeningSession,
  fetchTrack,
  fetchTrackAudio,
  ingestPlaybackEvent,
  openListeningSession,
  resolveMediaUrl,
  type ListeningSessionRecord,
  type TrackRecord,
} from "@/lib/api";
import { applyPlayerCommand, initialPlayerState, progressRatio, type PlayerState } from "@/lib/player-view";

function newClientEventId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `play-${Date.now()}`;
}

function PlayerBody() {
  const params = useParams<{ trackId: string }>();
  const trackId = params.trackId;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const sessionRef = useRef<ListeningSessionRecord | null>(null);
  const [track, setTrack] = useState<TrackRecord | null>(null);
  const [player, setPlayer] = useState<PlayerState>(initialPlayerState());
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioMessage, setAudioMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const row = await fetchTrack(trackId);
        const session = await openListeningSession(trackId);
        sessionRef.current = session;
        if (!cancelled) {
          setTrack(row);
          setPlayer(
            applyPlayerCommand(initialPlayerState(), {
              type: "load",
              trackId: row.id,
              trackVersionId: session.track_version_id ?? null,
              durationMs: 0,
            }),
          );
        }
        if (session.audio_deliverable) {
          const delivery = await fetchTrackAudio(trackId);
          if (!cancelled) {
            setAudioUrl(resolveMediaUrl(delivery.url));
            setPlayer((current) =>
              applyPlayerCommand(current, {
                type: "load",
                trackId: row.id,
                trackVersionId: delivery.track_version_id,
                durationMs: current.durationMs,
              }),
            );
          }
        } else {
          setAudioMessage("Audio bytes are not stored yet (Q-P0-12). The catalog track is still recorded as playable.");
        }
      } catch (err) {
        if (!cancelled) {
          if (err instanceof ApiError && err.code === "ENTITLEMENT_REQUIRED") {
            setError("A commercial entitlement is required. Open the store to purchase or subscribe.");
          } else if (err instanceof ApiError && err.code === "TRACK_TAKEN_DOWN") {
            setError("This track is taken down and cannot be played, even with an entitlement.");
          } else {
            setError(err instanceof ApiError ? err.message : "Unable to open player");
          }
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      const session = sessionRef.current;
      if (session && session.status === "OPEN") {
        void closeListeningSession(session.id, session.version).catch(() => undefined);
      }
    };
  }, [trackId]);

  async function report(completed: boolean) {
    const session = sessionRef.current;
    const audio = audioRef.current;
    if (!session || !track) {
      return;
    }
    const durationMs = Math.max(0, Math.round((audio?.currentTime ?? player.positionMs / 1000) * 1000));
    try {
      await ingestPlaybackEvent({
        client_event_id: newClientEventId(),
        track_id: track.id,
        session_id: session.id,
        duration_ms: durationMs,
        completed,
      });
    } catch {
      return;
    }
  }

  if (loading) {
    return <LoadingState label="Opening player" />;
  }
  if (error) {
    return <ErrorState title="Player unavailable" message={error} />;
  }
  if (!track) {
    return <ErrorState title="Track unavailable" message="This track could not be loaded." />;
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">{track.title}</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Play, pause, seek, and progress use the canonical track version. This player does not
          compute royalties.
        </p>
      </div>
      <Card className="space-y-4">
        {audioMessage ? <p className="text-sm text-neutral-600">{audioMessage}</p> : null}
        <audio
          ref={audioRef}
          src={audioUrl ?? undefined}
          onPlay={() => setPlayer((current) => applyPlayerCommand(current, { type: "play" }))}
          onPause={() => {
            setPlayer((current) => applyPlayerCommand(current, { type: "pause" }));
            void report(false);
          }}
          onEnded={() => {
            setPlayer((current) => applyPlayerCommand(current, { type: "ended" }));
            void report(true);
          }}
          onTimeUpdate={(event) => {
            const node = event.currentTarget;
            setPlayer((current) =>
              applyPlayerCommand(current, {
                type: "tick",
                positionMs: Math.round(node.currentTime * 1000),
              }),
            );
          }}
          onLoadedMetadata={(event) => {
            const node = event.currentTarget;
            setPlayer((current) =>
              applyPlayerCommand(current, {
                type: "load",
                trackId: track.id,
                trackVersionId: current.trackVersionId,
                durationMs: Math.round(node.duration * 1000) || current.durationMs,
              }),
            );
          }}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            onClick={() => {
              void audioRef.current?.play();
            }}
            disabled={!audioUrl}
          >
            Play
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              audioRef.current?.pause();
            }}
            disabled={!audioUrl}
          >
            Pause
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              const node = audioRef.current;
              if (!node) {
                return;
              }
              node.currentTime = Math.max(0, node.currentTime - 10);
              setPlayer((current) =>
                applyPlayerCommand(current, { type: "seek", positionMs: node.currentTime * 1000 }),
              );
            }}
            disabled={!audioUrl}
          >
            Seek -10s
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => void addLibraryItem(track.id, "LIKE")}
          >
            Like
          </Button>
        </div>
        <p className="text-sm text-neutral-600">
          Progress {Math.round(progressRatio(player) * 100)}% · status {player.status}
        </p>
      </Card>
      <p className="text-sm">
        <Link href="/listen" className="underline">
          Back to listen
        </Link>
      </p>
    </div>
  );
}

export default function ListenTrackPage() {
  return (
    <Protected>
      <PlayerBody />
    </Protected>
  );
}
