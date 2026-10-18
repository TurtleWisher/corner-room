"use client";

/* Versions of one track and a real upload for the master (AUDIO_PHASE_1_DESIGN 5.3 and 6).
 * States come from the API; nobody can mark a version ready by hand. */

import { useCallback, useEffect, useState } from "react";
import { CircleAlert, Plus } from "lucide-react";

import { Button } from "@/components/ds";
import { MediaReport } from "@/components/music/media-report";
import { UploadCard } from "@/components/uploads/upload-card";
import { ApiError } from "@/lib/api/client";
import { createTrackVersion, fetchTrackVersions, type TrackVersionRecord } from "@/features/catalog/api";
import { versionAudioLabel } from "@/lib/upload-view";

const TONE_CLASS = {
  neutral: "text-fg-muted",
  progress: "text-fg",
  good: "text-success",
  attention: "text-danger",
} as const;

export function TrackAudioPanel({ trackId }: { trackId: string }) {
  const [versions, setVersions] = useState<TrackVersionRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const page = await fetchTrackVersions(trackId);
      setVersions(page.items);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Versions could not be loaded.");
    }
  }, [trackId]);

  useEffect(() => {
    void load();
  }, [load]);

  const waiting = versions?.find((v) => v.status === "UPLOADING" && !v.media_asset_id) ?? null;
  const inProgress = versions?.some((v) => v.status === "PROCESSING" || (v.status === "UPLOADING" && v.media_asset_id)) ?? false;

  async function addVersion() {
    setBusy(true);
    setError(null);
    try {
      await createTrackVersion(trackId);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "A new version could not be started.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6">
      <h3 className="text-base font-semibold text-fg">Audio</h3>
      {versions && versions.length > 0 ? (
        <ul className="mt-3 border-t border-line text-sm">
          {versions.map((v) => {
            const state = versionAudioLabel(v);
            return (
              <li key={v.id} className="border-b border-line py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-fg-muted">
                    {v.version_type === "MASTER" ? "Master" : "Working"} version{v.is_current ? " · current" : ""}
                  </span>
                  <span className={`inline-flex items-center gap-1 font-semibold ${TONE_CLASS[state.tone]}`}>
                    {state.tone === "attention" ? <CircleAlert aria-hidden="true" className="size-4" /> : null}
                    {state.label}
                  </span>
                </div>
                {v.media_asset_id && v.status !== "SUPERSEDED" ? (
                  <MediaReport trackId={trackId} versionId={v.id} onSettled={() => void load()} />
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : versions ? (
        <p className="mt-2 text-sm text-fg-muted">No audio yet.</p>
      ) : null}

      <div className="mt-4">
        {waiting ? (
          <UploadCard purpose="AUDIO_MASTER" targetType="track_version" targetId={waiting.id} onCompleted={() => void load()} />
        ) : inProgress ? null : (
          <Button variant="secondary" size="sm" busy={busy} onClick={() => void addVersion()}>
            <Plus aria-hidden="true" /> {versions && versions.length > 0 ? "Upload a new master" : "Upload the master"}
          </Button>
        )}
      </div>
      {error ? (
        <p role="alert" className="mt-3 flex items-start gap-2 text-sm text-danger">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      ) : null}
    </div>
  );
}
