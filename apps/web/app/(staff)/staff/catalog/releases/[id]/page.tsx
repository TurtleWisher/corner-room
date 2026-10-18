"use client";

/* Staff release workspace (URL-06): the same editor the artist uses, plus managed mode (D) for
 * very special cases. The API enforces who may change what. */

import { useParams } from "next/navigation";
import { FormEvent, useState } from "react";
import { CircleAlert } from "lucide-react";

import { Button, Card, Protected } from "@/components/staff/kit";
import { ReleaseEditor } from "@/components/studio/release-editor";
import { reviewRelease, setManagedMode } from "@/features/studio/api";
import { friendlyError } from "@/lib/error-copy";

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
    <Card className="p-5">
      <h2 className="font-semibold">Managed by Corner Room (special cases only)</h2>
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
    </Card>
  );
}

const REVIEW_ACTIONS = [
  { action: "start_review", label: "Start review", needsNote: false },
  { action: "approve", label: "Approve release and tracks", needsNote: false },
  { action: "request_changes", label: "Send back for changes", needsNote: true },
  { action: "release", label: "Release now", needsNote: false },
] as const;

function ReviewPanel({ releaseId }: { releaseId: string }) {
  const [note, setNote] = useState("");
  const [when, setWhen] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function act(action: string, needsNote: boolean, releaseAt?: string, takedownKind?: "STANDARD" | "LEGAL") {
    if (needsNote && note.trim().length === 0) {
      setError("Write a note the artist will see.");
      return;
    }
    if (
      takedownKind === "LEGAL" &&
      !window.confirm("A legal takedown also removes the songs from everyone who bought them, including their downloads. Continue?")
    ) {
      return;
    }
    setBusy(action);
    setError(null);
    try {
      const out = await reviewRelease(releaseId, action, note, releaseAt, takedownKind);
      setResult(`Done: the release is now ${out.status.replaceAll("_", " ").toLowerCase()}. Reload to see the details.`);
      setNote("");
    } catch (err) {
      setError(friendlyError(err, "That review action didn't go through."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="p-5">
      <h2 className="font-semibold">Review</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Reviewers need the content manager permission. Whoever prepared or owns a release can&apos;t approve or publish it.
      </p>
      <textarea className="mt-3 min-h-20 w-full rounded border p-2 text-sm" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note for the artist (required to send back or take down)" aria-label="Review note" maxLength={2000} />
      <div className="mt-2 flex flex-wrap gap-2">
        {REVIEW_ACTIONS.map((a) => (
          <Button key={a.action} disabled={busy !== null} onClick={() => void act(a.action, a.needsNote)}>
            {a.label}
          </Button>
        ))}
      </div>
      <div className="mt-3 rounded border p-3">
        <p className="text-sm font-semibold">Take down</p>
        <p className="mt-1 text-sm text-muted-foreground">
          An ordinary takedown removes the release from the catalog; people who bought it keep listening and downloading. Use a legal
          takedown only for a rights or legal claim: it removes it from buyers too.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button variant="outline" disabled={busy !== null} onClick={() => void act("takedown", true, undefined, "STANDARD")}>
            Take down (buyers keep it)
          </Button>
          <Button variant="outline" disabled={busy !== null} onClick={() => void act("takedown", true, undefined, "LEGAL")}>
            <CircleAlert aria-hidden="true" className="size-4 text-red-600" /> Legal takedown (removes it from buyers)
          </Button>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label className="text-sm" htmlFor="release-at">
          Schedule for
        </label>
        <input id="release-at" type="datetime-local" className="rounded border px-2 py-1 text-sm" value={when} onChange={(e) => setWhen(e.target.value)} />
        <Button variant="outline" disabled={busy !== null || !when} onClick={() => void act("schedule", false, new Date(when).toISOString())}>
          Schedule
        </Button>
      </div>
      {result ? <p className="mt-2 text-sm">{result}</p> : null}
      {error ? (
        <p role="alert" className="mt-2 flex items-center gap-2 text-sm text-red-600">
          <CircleAlert aria-hidden="true" className="size-4" /> {error}
        </p>
      ) : null}
    </Card>
  );
}

export default function StaffCatalogReleasePage() {
  const { id } = useParams<{ id: string }>();
  return (
    <Protected>
      <div className="grid gap-6">
        <h1 className="text-2xl font-bold">Release workspace</h1>
        {/* D-THEME-01: inside the console the editor uses the staff (black) palette, not Ember. */}
        <div className="rounded border border-line p-4">
          <ReleaseEditor releaseId={id} />
        </div>
        <ReviewPanel releaseId={id} />
        <ManagedMode releaseId={id} />
      </div>
    </Protected>
  );
}
