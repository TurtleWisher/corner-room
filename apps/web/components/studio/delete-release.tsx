"use client";

/* Delete a release that isn't out yet (owner, 2026-11-03), so the artist can start again. The API
 * refuses once someone has paid for it; staff and the artist use the same button. */

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CircleAlert, Trash2 } from "lucide-react";

import { Button, Card } from "@/components/ds";
import { deleteStudioRelease, type StudioReleaseDetail } from "@/features/studio/api";
import { friendlyError } from "@/lib/error-copy";

const AFTER_RELEASE = ["RELEASED", "TAKEN_DOWN", "ARCHIVED"];

export function DeleteRelease({ detail, afterHref = "/studio" }: { detail: StudioReleaseDetail; afterHref?: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (AFTER_RELEASE.includes(detail.release.status)) return null;

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await deleteStudioRelease(detail.release.id);
      router.push(afterHref);
    } catch (err) {
      setError(friendlyError(err, "It couldn't be deleted. Please try again."));
      setBusy(false);
    }
  }

  return (
    <Card tone="outline" className="p-5">
      <p className="text-sm text-fg">
        Starting again? Deleting removes this {detail.release.title ? <>&ldquo;{detail.release.title}&rdquo; </> : null}release, its songs, its prices
        and anything waiting for Corner Room. It can&apos;t be undone. Not possible once someone has paid for it: cancel its pre-sale first.
      </p>
      {confirming ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button variant="danger" busy={busy} onClick={() => void remove()}>
            <Trash2 aria-hidden="true" /> Yes, delete it
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>
            Keep it
          </Button>
        </div>
      ) : (
        <Button variant="secondary" className="mt-3" onClick={() => setConfirming(true)}>
          <Trash2 aria-hidden="true" /> Delete this release
        </Button>
      )}
      {error ? (
        <p role="alert" className="mt-3 flex items-start gap-2 text-sm text-danger">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      ) : null}
    </Card>
  );
}
