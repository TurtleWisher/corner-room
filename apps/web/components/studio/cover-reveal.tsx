"use client";

/* When fans see the cover (owner, 2026-11-02, D-COVER-02): with the release, a chosen time before
 * it, or at once with Reveal now. Every answer comes from the API; it decides and refuses. */

import { useState } from "react";
import { CircleAlert, CircleCheck, Eye, EyeOff, Save } from "lucide-react";

import { Button, Card, DateTime, Field, Select } from "@/components/ds";
import { revealCoverNow, setCoverReveal, type StudioReleaseDetail } from "@/features/studio/api";
import { leadFromValue, leadLabel, revealOptions, revealStatus, revealValue } from "@/lib/cover-reveal-view";
import { friendlyError } from "@/lib/error-copy";

const AFTER_RELEASE = ["RELEASED", "TAKEN_DOWN", "ARCHIVED"];

export function CoverReveal({ detail, reload }: { detail: StudioReleaseDetail; reload: (next?: StudioReleaseDetail) => void }) {
  const state = detail.cover_reveal;
  const saved = state?.lead_minutes ?? null;
  const [choice, setChoice] = useState(revealValue(saved));
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<"save" | "now" | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!state || AFTER_RELEASE.includes(detail.release.status)) return null;
  const status = revealStatus(state);

  const run = async (key: "save" | "now", fn: () => Promise<StudioReleaseDetail>) => {
    setBusy(key);
    setError(null);
    try {
      const next = await fn();
      setConfirming(false);
      setChoice(revealValue(next.cover_reveal?.lead_minutes));
      reload(next);
    } catch (err) {
      setError(friendlyError(err, "That didn't save. Please try again."));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card tone="solid" className="mt-6 p-5" aria-labelledby="cover-reveal-title">
      <h3 id="cover-reveal-title" className="flex items-center gap-2 text-base font-bold text-fg">
        {status === "revealed" ? <Eye aria-hidden="true" className="size-4 text-highlight" /> : <EyeOff aria-hidden="true" className="size-4 text-fg-muted" />}
        When fans see the cover
      </h3>

      <p role="status" className="mt-2 text-sm text-fg">
        {status === "revealed" ? (
          <span className="inline-flex items-start gap-2">
            <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
            <span>
              Fans can see your cover now
              {state.revealed_at ? (
                <>
                  {" "}
                  (revealed <DateTime value={state.revealed_at} format="datetime" />)
                </>
              ) : null}
              . It stays on show.
            </span>
          </span>
        ) : status === "timed" ? (
          <>
            Fans see your cover on <DateTime value={state.reveal_at!} format="datetime" className="font-semibold" />, {leadLabel(saved)} the release.
          </>
        ) : status === "waiting_for_date" ? (
          <>Fans see your cover {leadLabel(saved)} the release, once Corner Room sets the date.</>
        ) : (
          <>Fans see your cover when the release comes out.</>
        )}
      </p>
      {status !== "revealed" ? (
        <p className="mt-1 text-sm text-fg-muted">Until then, your pre-order page shows the title, your name and the date. Never the songs.</p>
      ) : null}

      {state.can_change ? (
        <form
          className="mt-4 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run("save", () => setCoverReveal(detail.release.id, leadFromValue(choice)));
          }}
        >
          <Field label="Show the cover early" hint="Choose how long before the release fans see it." className="min-w-56">
            {(c) => (
              <Select {...c} value={choice} onChange={(e) => setChoice(e.target.value)}>
                {revealOptions(saved).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Button type="submit" variant="secondary" busy={busy === "save"} disabled={choice === revealValue(saved)}>
            <Save aria-hidden="true" /> Save
          </Button>
        </form>
      ) : null}

      {state.can_change ? (
        <div className="mt-5 border-t border-line pt-4">
          {state.can_reveal_now ? (
            confirming ? (
              <div className="grid gap-3">
                <p className="text-sm text-fg">Fans will see this cover on your pre-order page right away. You can&apos;t hide it again.</p>
                <div className="flex flex-wrap gap-2">
                  <Button busy={busy === "now"} onClick={() => void run("now", () => revealCoverNow(detail.release.id))}>
                    <Eye aria-hidden="true" /> Yes, reveal it now
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirming(false)} disabled={busy === "now"}>
                    Not yet
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="secondary" onClick={() => setConfirming(true)}>
                  <Eye aria-hidden="true" /> Reveal now
                </Button>
                <p className="text-sm text-fg-muted">Show the cover to fans this moment, ahead of the release.</p>
              </div>
            )
          ) : (
            <p className="text-sm text-fg-muted">
              {detail.cover_url ? "Reveal now opens once Corner Room sets your release date." : "Add a cover to reveal it early."}
            </p>
          )}
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="mt-3 flex items-start gap-2 text-sm text-danger">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      ) : null}
    </Card>
  );
}
