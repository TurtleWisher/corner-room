"use client";

/*
 * Preview Studio for one release (owner, 2026-11-07, D-TEASER-00, URL-11; named and moved into the
 * release page 2026-11-08, D-RELEASE-TABS-01): every song on it, the teasers cut from each, and a way
 * to start a new one. A teaser is the free, permanent way to hear a song for anyone who hasn't bought
 * it; Corner Room approves each one before fans hear it. Shown as the release page's Preview Studio
 * part and on its own page.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ChevronRight, CircleAlert, Plus } from "lucide-react";

import { Badge, Button, EmptyState, ErrorState, Skeleton } from "@/components/ds";
import { RetryButton } from "@/components/shell/staff-panel";
import { loadErrorMessage, useAsync } from "@/components/use-async";
import { createTeaser, fetchReleaseTeasers } from "@/features/teasers/api";
import { friendlyError } from "@/lib/error-copy";
import { formatLength, REVIEW_STATUS_LABEL, TEASER_STATUS_LABEL, VERSION_STATUS_LABEL } from "@/lib/teaser-editor-view";

export function PreviewStudioList({ releaseId, onUploadMaster }: { releaseId: string; onUploadMaster?: () => void }) {
  const router = useRouter();
  const data = useAsync(() => fetchReleaseTeasers(releaseId), [releaseId]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const start = async (trackId: string) => {
    setBusy(trackId);
    setError(null);
    try {
      const made = await createTeaser(trackId);
      router.push(`/studio/releases/${releaseId}/teasers/${made.id}`);
    } catch (err) {
      setError(friendlyError(err));
      setBusy(null);
    }
  };

  return (
    <div className="grid min-w-0 gap-5">
      <div className="max-w-prose text-sm">
        <p className="text-fg">
          Cut a short part of a song that anyone can hear free, as often as they like. It helps people get to know the song before they buy
          it.
        </p>
        <details className="mt-1 text-fg-muted">
          <summary className="cr-focus w-fit cursor-pointer font-semibold text-link">How it works</summary>
          <p className="mt-2">
            You cut it from the song&apos;s own master, which never changes. Corner Room checks each teaser before fans hear it. Fans find it
            in the song&apos;s Preview Corner and play it in the Preview Room; after each full listen they get a gentle suggestion to buy. It
            works before and after the release.
          </p>
        </details>
      </div>

      {data.status === "loading" ? (
        <Skeleton className="h-40 w-full" />
      ) : data.status === "error" ? (
        <ErrorState title="Preview Studio unavailable" message={loadErrorMessage(data.error, "this release's teasers")} action={<RetryButton onClick={data.reload} />} />
      ) : data.data.songs.length === 0 ? (
        <EmptyState title="No songs yet" body="Add a song and upload its master first." />
      ) : (
        <>
          {error ? (
            <p role="alert" className="flex items-start gap-2 text-sm text-danger">
              <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" /> {error}
            </p>
          ) : null}
          <ul className="grid gap-3">
            {data.data.songs.map((song) => {
              const ready = song.master_status === "READY";
              return (
                <li key={song.track_id} className="ts-panel cr-cut min-w-0 p-4">
                  <section aria-labelledby={`song-${song.track_id}`}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <h3 id={`song-${song.track_id}`} className="truncate text-base font-bold text-fg">
                          {song.title}
                        </h3>
                        <p className="text-xs text-fg-muted">
                          {ready && song.master_duration_ms ? `Master ready · ${formatLength(song.master_duration_ms)}` : "Master not ready yet"}
                        </p>
                      </div>
                      {ready ? (
                        <Button size="sm" className="ts-gloss" onClick={() => void start(song.track_id)} busy={busy === song.track_id}>
                          <Plus aria-hidden="true" /> New teaser
                        </Button>
                      ) : onUploadMaster ? (
                        <button type="button" onClick={onUploadMaster} className="cr-focus text-sm font-semibold text-link underline">
                          Upload the master
                        </button>
                      ) : (
                        <Link href={`/studio/releases/${releaseId}#songs`} className="cr-focus text-sm font-semibold text-link underline">
                          Upload the master
                        </Link>
                      )}
                    </div>
                    {song.teasers.length === 0 ? (
                      <p className="mt-2 text-sm text-fg-muted">No teasers for this song yet.</p>
                    ) : (
                      <ul className="mt-3 grid gap-1.5">
                        {song.teasers.map((t) => (
                          <li key={t.id}>
                            <Link
                              href={`/studio/releases/${releaseId}/teasers/${t.id}`}
                              className="cr-focus group flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border border-line px-3 py-2.5 transition-colors hover:border-highlight"
                            >
                              <span className="min-w-0">
                                <span className="block truncate text-sm font-semibold text-fg">{t.title ?? "Teaser"}</span>
                                <span className="block text-xs text-fg-muted">
                                  {t.latest_review_status
                                    ? REVIEW_STATUS_LABEL[t.latest_review_status]
                                    : t.latest_status
                                      ? VERSION_STATUS_LABEL[t.latest_status]
                                      : ""}
                                  {t.live_duration_ms ? ` · live teaser ${formatLength(t.live_duration_ms)}` : ""}
                                </span>
                              </span>
                              <span className="flex items-center gap-3 text-xs text-fg-muted">
                                {t.status === "PUBLISHED" || t.status === "UNPUBLISHED" ? (
                                  <span className="cr-num">
                                    {t.counts.starts} starts · {t.counts.completes} full listens
                                  </span>
                                ) : null}
                                <Badge tone={t.status === "PUBLISHED" ? "positive" : "neutral"}>{TEASER_STATUS_LABEL[t.status]}</Badge>
                                <ChevronRight aria-hidden="true" className="size-4 transition-transform group-hover:translate-x-0.5" />
                              </span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
