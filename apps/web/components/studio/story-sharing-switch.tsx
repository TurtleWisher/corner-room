"use client";

/* Story sharing (owner, 2026-11-08, D-STORY-01): one on/off switch per release. On (the default),
 * people who own its songs can share a moment of up to 30 seconds as a story card on Instagram,
 * Facebook and other apps. Off, they can't. The API keeps the switch and decides; this asks and shows.
 * Same switch look as the pre-sale cover switch (`.cover-switch-*`). */

import { useId, useState } from "react";
import { CircleAlert, Share2 } from "lucide-react";

import { setStorySharing, type StudioReleaseDetail } from "@/features/studio/api";
import { friendlyError } from "@/lib/error-copy";

export function StorySharingSwitch({ detail, reload }: { detail: StudioReleaseDetail; reload: (next?: StudioReleaseDetail) => void }) {
  const labelId = useId();
  const lineId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const on = detail.release.story_sharing !== false;

  const flip = async () => {
    setBusy(true);
    setError(null);
    try {
      reload(await setStorySharing(detail.release.id, !on));
    } catch (err) {
      setError(friendlyError(err, "That didn't save. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cover-switch">
      <div className="flex items-center justify-between gap-6">
        <div className="min-w-0">
          <p id={labelId} className="flex items-center gap-2 text-base font-bold text-fg">
            <Share2 aria-hidden="true" className={on ? "size-4 text-highlight" : "size-4 text-fg-muted"} />
            Story sharing
          </p>
          <p id={lineId} role="status" className="mt-1 text-sm text-fg-muted">
            {on
              ? "People who own these songs can share a moment of up to 30 seconds as a story on Instagram, Facebook and other apps."
              : "Nobody can share these songs as stories."}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-labelledby={labelId}
          aria-describedby={lineId}
          aria-busy={busy || undefined}
          disabled={busy}
          onClick={() => void flip()}
          className="cover-switch-button cr-focus"
        >
          <span aria-hidden="true" className="cover-switch-track">
            <span className="cover-switch-thumb" />
          </span>
          <span aria-hidden="true" className="cover-switch-state">
            {on ? "On" : "Off"}
          </span>
        </button>
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
