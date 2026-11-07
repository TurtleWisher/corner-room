"use client";

/* The pre-sale cover switch (owner, 2026-11-07, D-COVER-03): one on/off switch in the pre-sale.
 * Off: fans see the cover (or the title screen) a little blurred. On: clearly. It can go back off
 * any time before release. The API keeps the switch and decides; this only asks and shows. */

import { useId, useState } from "react";
import { CircleAlert, Eye, EyeOff } from "lucide-react";

import { setCoverReveal, type StudioReleaseDetail } from "@/features/studio/api";
import { fansSeeLine, switchStateText } from "@/lib/cover-reveal-view";
import { friendlyError } from "@/lib/error-copy";

export function CoverSwitch({ detail, reload }: { detail: StudioReleaseDetail; reload: (next?: StudioReleaseDetail) => void }) {
  const state = detail.cover_reveal;
  const labelId = useId();
  const lineId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!state?.can_switch) return null;
  const on = Boolean(state.revealed);
  const hasCover = Boolean(state.preview_url);

  const flip = async () => {
    setBusy(true);
    setError(null);
    try {
      reload(await setCoverReveal(detail.release.id, !on));
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
            {on ? <Eye aria-hidden="true" className="size-4 text-highlight" /> : <EyeOff aria-hidden="true" className="size-4 text-fg-muted" />}
            Show the cover clearly
          </p>
          <p id={lineId} role="status" className="mt-1 text-sm text-fg-muted">
            {fansSeeLine(on, hasCover)}
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
            {switchStateText(on)}
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
