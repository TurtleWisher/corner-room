"use client";

import { ButtonLink, DateTime, EmptyState, ErrorState, Skeleton } from "@/components/ds";
import { usePlayableCatalog, useCustomerCommerce } from "@/components/music/commerce";
import { useCredits } from "@/components/music/credits";
import { ListenPage } from "@/components/music/listen-page";
import { TrackRows } from "@/components/music/track-rows";
import { RetryButton } from "@/components/shell/staff-panel";
import { loadErrorMessage, useAsync } from "@/components/use-async";
import { fetchListeningHistory } from "@/lib/api";
import { formatDuration } from "@/lib/music-view";

function History() {
  const people = useCredits();
  const commerce = useCustomerCommerce();
  const catalog = usePlayableCatalog();
  const history = useAsync(() => fetchListeningHistory().then((p) => p.items), []);
  if (history.status === "loading" || !catalog.ready) return <Skeleton className="h-48 w-full" />;
  if (history.status === "error") {
    return <ErrorState title="History unavailable" message={loadErrorMessage(history.error, "your listening history")} action={<RetryButton onClick={history.reload} />} />;
  }
  if (history.data.length === 0) {
    return <EmptyState title="Nothing played yet" body="Tracks you listen to appear here." action={<ButtonLink href="/listen" size="sm">Start listening</ButtonLink>} />;
  }
  return (
    <TrackRows
      label="Listening history"
      playable={catalog.map}
      people={people}
      commerce={commerce}
      items={history.data.map((e) => ({
        key: e.id,
        trackId: e.track_id,
        note: (
          <>
            <DateTime value={e.started_at} format="date" /> · {e.completed ? "Played to the end" : `Listened ${formatDuration(e.duration_ms) ?? "briefly"}`}
          </>
        ),
      }))}
    />
  );
}

export default function HistoryPage() {
  return (
    <ListenPage title="History" lede="What you listened to, newest first." what="your listening history">
      <History />
    </ListenPage>
  );
}
