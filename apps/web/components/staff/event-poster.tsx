"use client";

/* Staff: the event's official poster (OD-06; owner 2026-10-23: square, same rules as music covers).
 * Upload, the checks' verdict, and the poster in use. It shows on the public event page and
 * wherever the event appears once the event is published; until then the letter cube shows. */

import { useState } from "react";

import { ArtworkReport } from "@/components/uploads/artwork-report";
import { UploadCard } from "@/components/uploads/upload-card";
import { fetchEventCoverReport } from "@/features/events/api";

export function EventPoster({ eventId, onChanged }: { eventId: string; onChanged?: () => void }) {
  const [uploads, setUploads] = useState(0);
  return (
    <div className="mt-3">
      <UploadCard purpose="COVER_ART" targetType="event_cover" targetId={eventId} title="Event poster" onCompleted={() => setUploads((n) => n + 1)} />
      <ArtworkReport load={() => fetchEventCoverReport(eventId)} noun="poster" refresh={uploads} onSettled={onChanged} />
    </div>
  );
}
