"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

import { useAuth } from "@/components/auth-provider";
import { LitSurface } from "@/components/brand/corner-light";
import { CoverArt } from "@/components/brand/cover-art";
import { RoomCube } from "@/components/brand/room-cube";
import { Button, EmptyState, ErrorState, Field, Input, Skeleton, StatusChip, Table, TBody, TD, TH, THead, TR } from "@/components/ds";
import { TrackBuyControl, useCustomerCommerce } from "@/components/music/commerce";
import { useCredits } from "@/components/music/credits";
import { PageIntro, RetryButton, StaffPanel } from "@/components/shell/staff-panel";
import { loadErrorMessage, useAsync } from "@/components/use-async";
import { useWorkspace } from "@/components/workspace-provider";
import { ApiError, createTrack, fetchPlayableCatalog, fetchTracks, type PlayableTrackRecord } from "@/lib/api";
import { coverUrl } from "@/lib/cover-view";
import { creditName, formatDuration, playQueue } from "@/lib/music-view";
import { ownsTrack } from "@/lib/ownership";
import { RELEASE_STATUS } from "@/lib/status-maps";
import { rowsForActiveOrg } from "@/lib/workspace-view";

function TrackStaffList() {
  const { currentOrg } = useWorkspace();
  const workspace = useAsync(() => fetchTracks().then((p) => p.items), [currentOrg?.id]);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rows = workspace.status === "ok" ? rowsForActiveOrg(currentOrg?.id ?? null, workspace.data) : [];

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createTrack({ title });
      setTitle("");
      workspace.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The track could not be created.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <StaffPanel description={currentOrg ? `Acting in ${currentOrg.name}` : undefined}>
      <form onSubmit={onCreate} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <Field label="New track title">{(c) => <Input {...c} value={title} onChange={(e) => setTitle(e.target.value)} required />}</Field>
        <Button type="submit" busy={busy}>
          Create track
        </Button>
      </form>
      {error ? (
        <p role="alert" className="mt-3 text-danger">
          {error}
        </p>
      ) : null}
      <div className="mt-6">
        {workspace.status === "loading" ? (
          <Skeleton className="h-24 w-full" />
        ) : rows.length === 0 ? (
          <p className="text-fg-muted">No tracks in this workspace.</p>
        ) : (
          <Table label="Workspace tracks">
            <THead>
              <TR>
                <TH>Title</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((row) => (
                <TR key={row.id}>
                  <TD>
                    <Link href={`/tracks/${row.id}`} className="cr-focus font-semibold text-link underline">
                      {row.title}
                    </Link>
                  </TD>
                  <TD>
                    <StatusChip value={row.status} map={RELEASE_STATUS} />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </div>
    </StaffPanel>
  );
}

export default function TracksPage() {
  const { status } = useAuth();
  const { currentOrg } = useWorkspace();
  const people = useCredits();
  const commerce = useCustomerCommerce();
  const signedIn = status === "authenticated";
  const data = useAsync(async () => {
    if (status === "loading") return null;
    const [tracks, playable] = await Promise.all([
      fetchTracks({ skipAuth: true }).then((p) => p.items),
      signedIn ? fetchPlayableCatalog().then((p) => p.items).catch(() => [] as PlayableTrackRecord[]) : Promise.resolve([] as PlayableTrackRecord[]),
    ]);
    return { tracks, playable: new Map(playable.map((t) => [t.id, t])) };
  }, [status]);

  // Up next: this list, in its order, the tracks the customer can play.
  const tracksQueue = {
    queue:
      data.status === "ok" && data.data
        ? playQueue(
            data.data.tracks.map((t) => ({ trackId: t.id, title: t.title, artist: creditName(t, people.artists, people.bands) })),
            data.data.playable,
            (id) => ownsTrack(commerce.entitlements, id),
          )
        : [],
    source: "Tracks",
  };

  return (
    <main id="main" data-theme="sky" className="cr-scope">
      <LitSurface as="section" theme="sky" aria-labelledby="tracks-title">
        <div className="mx-auto max-w-[90rem] px-4 pb-10 pt-12 md:px-6 md:pt-16">
          <div id="tracks-title">
            <PageIntro eyebrow="Listening room" title="Tracks" lede="Every released track. Buy one to keep it, or listen to all of them with a plan." />
          </div>
        </div>
      </LitSurface>
      <div className="mx-auto max-w-[90rem] space-y-12 px-4 pb-16 md:px-6">
        {data.status === "loading" || (data.status === "ok" && !data.data) ? (
          <div className="space-y-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : data.status === "error" ? (
          <ErrorState title="Tracks unavailable" message={loadErrorMessage(data.error, "tracks")} action={<RetryButton onClick={data.reload} />} />
        ) : data.data!.tracks.length === 0 ? (
          <EmptyState title="No tracks yet" />
        ) : (
          <ul className="border-t border-line">
            {data.data!.tracks.map((t) => {
              const artist = creditName(t, people.artists, people.bands);
              const duration = formatDuration(data.data!.playable.get(t.id)?.duration_ms);
              return (
                <li key={t.id} className="grid grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-4 border-b border-line py-3">
                  <div className="size-12 bg-cr-sky">
                    <CoverArt
                      src={coverUrl({ track: t.id }, 160)}
                      fallback={<RoomCube front={t.title} side={artist ?? t.title} tone="sky" size="front" label="" className="size-full" />}
                      className="size-full"
                    />
                  </div>
                  <div className="min-w-0">
                    <Link href={`/tracks/${t.id}`} className="cr-focus block truncate font-semibold text-fg hover:text-highlight">
                      {t.title}
                    </Link>
                    <p className="truncate text-sm text-fg-muted">
                      {artist ?? "Artist not available"}
                      {duration ? ` · ${duration}` : ""}
                    </p>
                  </div>
                  <TrackBuyControl track={{ id: t.id, title: t.title, artist }} commerce={commerce} showPlan={false} playFrom={tracksQueue} />
                </li>
              );
            })}
          </ul>
        )}
        {signedIn && currentOrg ? <TrackStaffList /> : null}
      </div>
    </main>
  );
}
