"use client";

/*
 * Staff review of changes to approved or released music (owner, 2026-10-28, D-CHANGES-01): every
 * change old next to new, the new audio's check report, then approve (all of it goes public at
 * once) or send back with a note the artist sees. The server enforces who may approve.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { CircleAlert } from "lucide-react";

import { MediaReport } from "@/components/music/media-report";
import { Button, Card, ErrorState, LoadingState } from "@/components/staff/kit";
import { useWorkspace } from "@/components/workspace-provider";
import { fetchChangesQueue, fetchReleaseChanges, reviewChanges, type ChangeRequest } from "@/features/studio/api";
import { ApiError } from "@/lib/api/client";
import { friendlyError } from "@/lib/error-copy";

function DiffTable({ req }: { req: ChangeRequest }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[36rem] text-left text-sm">
        <thead className="text-xs text-muted-foreground">
          <tr className="border-b">
            <th className="py-2 pr-3 font-semibold">Where</th>
            <th className="py-2 pr-3 font-semibold">What</th>
            <th className="py-2 pr-3 font-semibold">Now</th>
            <th className="py-2 font-semibold">Proposed</th>
          </tr>
        </thead>
        <tbody>
          {req.diff.map((d, i) => (
            <tr key={i} className="border-b align-top">
              <td className="py-2 pr-3 text-muted-foreground">{d.scope}</td>
              <td className="py-2 pr-3">{d.field}</td>
              <td className="py-2 pr-3 text-muted-foreground">{d.before}</td>
              <td className="py-2 font-semibold">{d.after}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** On the release workspace: the waiting request for this release, if any. */
export function ChangesReview({ releaseId }: { releaseId: string }) {
  const [req, setReq] = useState<ChangeRequest | null | undefined>(undefined);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    fetchReleaseChanges(releaseId)
      .then(setReq)
      .catch((err) => (err instanceof ApiError && (err.status === 403 || err.status === 404) ? setReq(null) : setError(friendlyError(err, "Changes couldn't be loaded."))));
  }, [releaseId]);

  async function act(action: "approve" | "reject") {
    if (action === "reject" && !note.trim()) {
      setError("Write a note the artist will see.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const out = await reviewChanges(releaseId, action, note);
      setDone(out.status === "APPROVED" ? "Approved: the changes are now public. Reload to see them." : "Sent back to the artist with your note.");
      setReq(null);
    } catch (err) {
      setError(friendlyError(err, "That review didn't go through."));
    } finally {
      setBusy(false);
    }
  }

  if (done) return <Card className="p-5 text-sm">{done}</Card>;
  if (req === undefined && !error) return null;
  if (!req) return error ? <ErrorState message={error} /> : null;
  return (
    <Card className="p-5">
      <h2 className="font-semibold">Changes waiting for review</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        The artist changed this music after it was approved. Listeners see none of it until you approve. Whoever prepared or owns the release, or
        made these changes, can&apos;t approve them.
      </p>
      <div className="mt-3">
        <DiffTable req={req} />
      </div>
      {req.audio.map((a) => (
        <div key={a.version_id} className="mt-4 rounded border p-3">
          <p className="text-sm font-semibold">New audio: check report</p>
          <MediaReport trackId={a.track_id} versionId={a.version_id} />
        </div>
      ))}
      <textarea
        className="mt-3 min-h-16 w-full rounded border p-2 text-sm"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note for the artist (required to send back)"
        aria-label="Review note for the changes"
        maxLength={2000}
      />
      <div className="mt-2 flex gap-2">
        <Button disabled={busy} onClick={() => void act("approve")}>
          Approve changes
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => void act("reject")}>
          Send back
        </Button>
      </div>
      {error ? (
        <p role="alert" className="mt-2 flex items-center gap-2 text-sm text-red-600">
          <CircleAlert aria-hidden="true" className="size-4" /> {error}
        </p>
      ) : null}
    </Card>
  );
}

/** On Catalog releases: every release with changes waiting, linking to its workspace. */
export function ChangesQueue() {
  const { currentOrg } = useWorkspace();
  const [items, setItems] = useState<ChangeRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!currentOrg) return;
    fetchChangesQueue()
      .then(setItems)
      .catch((err) => (err instanceof ApiError && err.status === 403 ? setItems([]) : setError(friendlyError(err, "Changes waiting for review couldn't be loaded."))));
  }, [currentOrg]);

  if (!currentOrg || (items !== null && items.length === 0 && !error)) return null;
  return (
    <Card className="p-5">
      <h2 className="text-lg font-semibold">Changes to released music waiting for review</h2>
      <p className="mt-1 text-sm text-muted-foreground">Details, credits or audio the artist changed after approval. Open each release to compare and decide.</p>
      {error ? <ErrorState message={error} /> : items === null ? <LoadingState /> : (
        <ul className="mt-2">
          {items.map((r) => (
            <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-3 border-b py-3 text-sm">
              <Link href={`/staff/catalog/releases/${r.release_id}`} className="font-medium underline">
                {r.release_title}
              </Link>
              <span className="text-muted-foreground">
                {r.profile_name ?? "Artist not available"} · {r.diff.length} {r.diff.length === 1 ? "change" : "changes"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
