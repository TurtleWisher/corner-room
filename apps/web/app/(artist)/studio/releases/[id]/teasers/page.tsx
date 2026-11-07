"use client";

/* Teaser Studio for one release (owner, 2026-11-07, D-TEASER-00, URL-11): every song on it, the
 * teasers cut from each, and a way to start a new one. A teaser is the free, permanent way to hear a
 * song for anyone who hasn't bought it; Corner Room approves each one before fans hear it. */

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, CircleAlert, Plus } from "lucide-react";

import { Badge, Button, Card, EmptyState, ErrorState, Skeleton } from "@/components/ds";
import { AccountPage } from "@/components/shell/account-page";
import { RetryButton } from "@/components/shell/staff-panel";
import { loadErrorMessage, useAsync } from "@/components/use-async";
import { createTeaser, fetchReleaseTeasers } from "@/features/teasers/api";
import { friendlyError } from "@/lib/error-copy";
import { formatLength, REVIEW_STATUS_LABEL, TEASER_STATUS_LABEL, VERSION_STATUS_LABEL } from "@/lib/teaser-editor-view";

export default function ReleaseTeasersPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const data = useAsync(() => fetchReleaseTeasers(id), [id]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const start = async (trackId: string) => {
    setBusy(trackId);
    setError(null);
    try {
      const made = await createTeaser(trackId);
      router.push(`/studio/releases/${id}/teasers/${made.id}`);
    } catch (err) {
      setError(friendlyError(err));
      setBusy(null);
    }
  };

  return (
    <AccountPage audience="artist" eyebrow="Teaser Studio" title={data.status === "ok" ? data.data.release_title : "Teasers"} what="your teasers">
      <Link href={`/studio/releases/${id}`} className="cr-focus mb-6 inline-flex items-center gap-1 text-sm font-semibold text-link hover:underline">
        <ArrowLeft aria-hidden="true" className="size-4" /> Back to the release
      </Link>
      <Card tone="outline" className="mb-8 max-w-prose p-5 text-sm text-fg">
        <p>
          A teaser is a short part of a song that anyone can listen to for free, as often as they like, for as long as the song is on Corner
          Room. It lets people get to know the song before they buy it. After each full listen they get a gentle suggestion to buy.
        </p>
        <p className="mt-2 text-fg-muted">
          You cut it from the song&apos;s own master; the master never changes. Corner Room checks each teaser before fans hear it. It works
          before and after the release, and stays on the same song when the release comes out.
        </p>
      </Card>
      {data.status === "loading" ? (
        <Skeleton className="h-48 w-full" />
      ) : data.status === "error" ? (
        <ErrorState title="Teasers unavailable" message={loadErrorMessage(data.error, "this release's teasers")} action={<RetryButton onClick={data.reload} />} />
      ) : data.data.songs.length === 0 ? (
        <EmptyState title="No songs yet" body="Add a song and upload its master in the release first." />
      ) : (
        <div className="grid gap-8">
          {error ? (
            <p role="alert" className="flex items-start gap-2 text-sm text-danger">
              <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" /> {error}
            </p>
          ) : null}
          {data.data.songs.map((song) => {
            const ready = song.master_status === "READY";
            return (
              <section key={song.track_id} aria-labelledby={`song-${song.track_id}`}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 id={`song-${song.track_id}`} className="text-2xl font-bold text-fg">
                      {song.title}
                    </h2>
                    <p className="text-sm text-fg-muted">
                      {ready && song.master_duration_ms ? `Master ready · ${formatLength(song.master_duration_ms)}` : "Master not ready yet"}
                    </p>
                  </div>
                  {ready ? (
                    <Button size="sm" onClick={() => void start(song.track_id)} busy={busy === song.track_id}>
                      <Plus aria-hidden="true" /> New teaser
                    </Button>
                  ) : (
                    <Link href={`/studio/releases/${id}`} className="cr-focus text-sm font-semibold text-link underline">
                      Upload the master
                    </Link>
                  )}
                </div>
                {song.teasers.length === 0 ? (
                  <p className="mt-3 text-sm text-fg-muted">No teasers for this song yet.</p>
                ) : (
                  <ul className="mt-4 grid gap-2">
                    {song.teasers.map((t) => (
                      <li key={t.id}>
                        <Link
                          href={`/studio/releases/${id}/teasers/${t.id}`}
                          className="cr-focus flex flex-wrap items-center justify-between gap-3 border border-line p-4 hover:border-highlight"
                        >
                          <span>
                            <span className="block font-semibold text-fg">{t.title ?? "Teaser"}</span>
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
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
    </AccountPage>
  );
}
