"use client";

import { Gift } from "lucide-react";

import { useAsync } from "@/components/use-async";
import { fetchPublicGifts } from "@/features/gifts/api";

/**
 * A live gift campaign for this music (owner, 2026-10-28, D-CAMPAIGN-01): fans see what they get
 * with it, only while the campaign is live. Nothing is drawn otherwise.
 */
export function GiftNote({ releaseId, trackId, className }: { releaseId?: string; trackId?: string; className?: string }) {
  const gifts = useAsync(() => fetchPublicGifts({ releaseId, trackId }).catch(() => []), [releaseId, trackId]);
  if (gifts.status !== "ok" || gifts.data.length === 0) return null;
  return (
    <div className={className}>
      {gifts.data.map((g) => (
        <div key={g.id} className="cr-cut cr-glass-card flex items-start gap-3 p-4">
          <Gift aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-highlight" />
          <div>
            <p className="text-sm font-bold text-fg">A gift from {g.artist} with this music</p>
            <p className="mt-1 text-sm text-fg">{g.gift_items}</p>
            {g.description ? <p className="mt-1 text-sm text-fg-muted">{g.description}</p> : null}
          </div>
        </div>
      ))}
    </div>
  );
}
