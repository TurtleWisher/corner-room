"use client";

/* Staff release workspace (URL-06): the release plan and what needs you now (D-RELEASE-PLAN-01),
 * the same editor the artist uses, and managed mode (D) for very special cases under More actions.
 * The API enforces who may change what. */

import { useParams } from "next/navigation";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { CircleAlert } from "lucide-react";

import { ReleasePlanView } from "@/components/release-plan/release-plan";
import { Button, Protected } from "@/components/staff/kit";
import { ChangesReview } from "@/components/staff/changes-review";
import { MoreReleaseActions, ReleaseDecision } from "@/components/staff/release-decision";
import { ReleaseEditor } from "@/components/studio/release-editor";
import { fetchStudioRelease, setManagedMode, type StudioReleaseDetail } from "@/features/studio/api";
import { friendlyError } from "@/lib/error-copy";
import { displayStateLabel, RELEASE_TYPE_LABEL } from "@/lib/studio-view";

function ManagedMode({ releaseId }: { releaseId: string }) {
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function apply(enabled: boolean, e?: FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const out = await setManagedMode(releaseId, enabled, enabled ? reason : undefined);
      setResult(out.mode === "MANAGED" ? "Corner Room now manages this release. Reload to see the change." : "Back to assisted mode: the artist submits.");
    } catch (err) {
      setError(friendlyError(err, "Managed mode couldn't be changed."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="managed-mode">
      <h3 id="managed-mode" className="font-semibold">Managed by Corner Room (special cases only)</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Normally the artist submits. Turn this on only when the artist has asked Corner Room to release for them. Needs the catalog manager
        permission and a written reason the artist can see. A different person still approves the release.
      </p>
      <form className="mt-3 grid gap-2" onSubmit={(e) => void apply(true, e)}>
        <textarea className="min-h-20 rounded border p-2 text-sm" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why Corner Room is managing this release (at least 20 characters)" aria-label="Reason" maxLength={1000} />
        <div className="flex gap-2">
          <Button type="submit" disabled={busy}>
            Turn on managed mode
          </Button>
          <Button type="button" variant="outline" disabled={busy} onClick={() => void apply(false)}>
            Turn off
          </Button>
        </div>
      </form>
      {result ? <p className="mt-2 text-sm">{result}</p> : null}
      {error ? (
        <p role="alert" className="mt-2 flex items-center gap-2 text-sm text-red-600">
          <CircleAlert aria-hidden="true" className="size-4" /> {error}
        </p>
      ) : null}
    </section>
  );
}

/** The workspace (owner, 2026-11-13, D-RELEASE-PLAN-01): the release plan, what needs you now, the
 * release itself, then rarer steps folded under More actions. */
export default function StaffCatalogReleasePage() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<StudioReleaseDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const refresh = useCallback(() => setRound((n) => n + 1), []);

  useEffect(() => {
    fetchStudioRelease(id)
      .then((d) => {
        setDetail(d);
        setError(null);
      })
      .catch((err) => setError(friendlyError(err, "This release couldn't be loaded.")));
  }, [id, round]);

  return (
    <Protected>
      <div className="grid gap-6">
        <header className="grid gap-1">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-fg-muted">Release workspace</p>
          <h1 className="break-words text-2xl font-bold text-fg">{detail?.release.title ?? "Release"}</h1>
          {detail ? (
            <p className="text-sm text-fg-muted">
              {RELEASE_TYPE_LABEL[detail.release.release_type] ?? detail.release.release_type} by {detail.profile.display_name} ·{" "}
              <span className="font-semibold text-fg">{displayStateLabel(detail.display_state)}</span>
            </p>
          ) : null}
        </header>
        {error && !detail ? (
          <p role="alert" className="flex items-center gap-2 text-sm text-danger">
            <CircleAlert aria-hidden="true" className="size-4" /> {error}
          </p>
        ) : null}
        {detail ? (
          <>
            <ReleasePlanView detail={detail} viewer="staff" />
            <ReleaseDecision key={`d-${round}`} detail={detail} onDone={refresh} />
          </>
        ) : null}
        <ChangesReview releaseId={id} />
        <section aria-labelledby="release-content" className="grid gap-3">
          <h2 id="release-content" className="text-lg font-bold text-fg">
            The release
          </h2>
          {/* D-THEME-01: inside the console the editor uses the staff (black) palette, not Ember. */}
          <div className="rounded border border-line p-4">
            <ReleaseEditor key={`e-${round}`} releaseId={id} />
          </div>
        </section>
        {detail ? (
          <MoreReleaseActions key={`m-${round}`} detail={detail} onDone={refresh}>
            <ManagedMode releaseId={id} />
          </MoreReleaseActions>
        ) : null}
      </div>
    </Protected>
  );
}
