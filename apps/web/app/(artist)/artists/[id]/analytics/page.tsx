"use client";

import Link from "next/link";
import { useParams } from "next/navigation";

import { EmptyState, ErrorState, Skeleton, Table, TBody, TD, TH, THead, TR } from "@/components/ds";
import { AccountPage } from "@/components/shell/account-page";
import { RetryButton } from "@/components/shell/staff-panel";
import { loadErrorMessage, useAsync } from "@/components/use-async";
import { fetchArtistPlayAggregates } from "@/lib/api";
import { formatDuration } from "@/lib/music-view";

const n = (v: number) => v.toLocaleString("en-IN");

/**
 * An artist's own play counts (operational playback events). Analytics honesty: these are all
 * plays, not royalty-eligible plays; eligibility is stated as the API reports it.
 */
function Aggregates({ artistId }: { artistId: string }) {
  const data = useAsync(() => fetchArtistPlayAggregates(artistId), [artistId]);
  if (data.status === "loading") return <Skeleton className="h-48 w-full" />;
  if (data.status === "error") {
    return <ErrorState title="Plays unavailable" message={loadErrorMessage(data.error, "these plays")} action={<RetryButton onClick={data.reload} />} />;
  }
  const { tracks, eligibility, label } = data.data;
  return (
    <div className="space-y-6">
      <p className="text-sm text-fg">
        {label}. These are all plays, not royalty-eligible plays. Royalty eligibility: <span className="font-semibold">{eligibility}</span>. Listener identities are never shown.
      </p>
      {tracks.length === 0 ? (
        <EmptyState title="No plays yet" />
      ) : (
        <Table label="Plays by track">
          <THead>
            <TR>
              <TH>Track</TH>
              <TH numeric>Plays</TH>
              <TH numeric>Listeners</TH>
              <TH numeric>Played to the end</TH>
              <TH numeric>Skipped</TH>
              <TH numeric>Time listened</TH>
            </TR>
          </THead>
          <TBody>
            {tracks.map((t) => (
              <TR key={t.track_id}>
                <TD>
                  <Link href={`/tracks/${t.track_id}`} className="cr-focus font-semibold text-link underline">
                    {t.title}
                  </Link>
                </TD>
                <TD numeric>{n(t.play_count)}</TD>
                <TD numeric>{n(t.unique_listener_count)}</TD>
                <TD numeric>{n(t.completed_count)}</TD>
                <TD numeric>{n(t.skip_count)}</TD>
                <TD numeric>{formatDuration(t.total_duration_ms) ?? "Not available"}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}

export default function ArtistAnalyticsPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <AccountPage audience="artist" eyebrow="Artist" title="Your plays" what="these plays">
      <Aggregates artistId={id} />
    </AccountPage>
  );
}
