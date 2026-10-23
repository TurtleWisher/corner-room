"use client";

/* Profile changes waiting for staff (owner, 2026-10-23): an artist's or band's new name, bio or
 * picture shows publicly only after someone here approves it. The API lists only what this
 * person may decide in the active workspace and refuses the profile's own people. */

import { useCallback, useEffect, useState } from "react";
import { Check, CircleAlert, X } from "lucide-react";

import { Avatar, DateTime } from "@/components/ds";
import { Button, Card, EmptyState, ErrorState, LoadingState } from "@/components/staff/kit";
import { fetchProfileReviewQueue, transitionProfileChange, type ReviewItem } from "@/features/profiles/api";
import { coverUrl } from "@/lib/cover-view";
import { friendlyError } from "@/lib/error-copy";
import { changeLines } from "@/lib/profile-view";

function ReviewCard({ item, onDone }: { item: ReviewItem; onDone: (text: string) => void }) {
  const { request, profile } = item;
  const [note, setNote] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const newPicture = coverUrl({ signed: request.portrait_url });

  async function decide(to: "APPROVED" | "REJECTED") {
    setBusy(true);
    setError(null);
    try {
      await transitionProfileChange(request.id, to, to === "REJECTED" ? note : undefined);
      onDone(to === "APPROVED" ? `${profile.stage_name}: changes approved and live.` : `${profile.stage_name}: changes turned down. The artist sees your note.`);
    } catch (err) {
      setError(friendlyError(err, "That didn't go through."));
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="text-lg font-semibold text-fg">
          {profile.stage_name} <span className="text-sm font-normal text-fg-muted">({profile.kind === "band" ? "band" : "artist"})</span>
        </p>
        {request.submitted_at ? (
          <p className="text-xs text-fg-muted">
            Sent <DateTime value={request.submitted_at} />
          </p>
        ) : null}
      </div>
      <ul className="mt-2 list-disc pl-5 text-sm text-fg">
        {changeLines(request, profile.kind).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {request.portrait_url || request.remove_portrait ? (
        <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-fg-muted">
          <figure className="grid justify-items-center gap-1">
            <Avatar name={profile.stage_name} src={coverUrl({ signed: profile.portrait_url })} size={80} />
            <figcaption>Now</figcaption>
          </figure>
          <span aria-hidden="true">→</span>
          <figure className="grid justify-items-center gap-1">
            <Avatar name={profile.stage_name} src={newPicture} size={80} />
            <figcaption>{newPicture ? "New picture" : "No picture"}</figcaption>
          </figure>
        </div>
      ) : null}
      {request.bio_changed ? (
        <div className="mt-3 grid gap-3 text-sm md:grid-cols-2">
          <div>
            <p className="text-xs font-semibold text-fg-muted">Bio now</p>
            <p className="mt-1 whitespace-pre-line text-fg">{profile.bio ?? "No bio."}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-fg-muted">New bio</p>
            <p className="mt-1 whitespace-pre-line text-fg">{request.bio ?? "Remove the bio."}</p>
          </div>
        </div>
      ) : null}
      {rejecting ? (
        <label className="mt-3 block text-sm">
          <span className="font-semibold text-fg">Note for the artist (required)</span>
          <textarea
            className="mt-1 block w-full border border-line bg-transparent p-2 text-fg"
            rows={3}
            maxLength={2000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {rejecting ? (
          <>
            <Button size="sm" variant="outline" disabled={busy || !note.trim()} onClick={() => void decide("REJECTED")}>
              <X aria-hidden="true" className="size-4" /> Turn down with this note
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setRejecting(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" disabled={busy} onClick={() => void decide("APPROVED")}>
              <Check aria-hidden="true" className="size-4" /> {busy ? "Working" : "Approve and publish"}
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setRejecting(true)}>
              <CircleAlert aria-hidden="true" className="size-4" /> Turn down
            </Button>
          </>
        )}
      </div>
      {error ? <ErrorState title="Profile change" message={error} /> : null}
    </Card>
  );
}

export function ProfileReviews() {
  const [items, setItems] = useState<ReviewItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    fetchProfileReviewQueue()
      .then(setItems)
      .catch((err) => setError(friendlyError(err, "Profile changes couldn't be loaded.")));
  }, []);
  useEffect(load, [load]);

  return (
    <section aria-labelledby="profile-changes" className="space-y-3">
      <h2 id="profile-changes" className="pt-2 text-lg font-semibold">
        Profile changes to approve
      </h2>
      <p className="text-sm text-fg-muted">
        Artists and band admins change their name, bio and picture in Studio. Fans see a change only after you approve it.
      </p>
      {notice ? (
        <p role="status" className="text-sm text-success">
          {notice}
        </p>
      ) : null}
      {error ? <ErrorState title="Profile changes" message={error} /> : null}
      {items === null && !error ? <LoadingState label="Loading profile changes" /> : null}
      {items !== null && items.length === 0 ? <EmptyState message="No profile changes waiting." /> : null}
      <ul className="grid gap-3">
        {(items ?? []).map((item) => (
          <li key={item.request.id}>
            <ReviewCard
              item={item}
              onDone={(text) => {
                setNotice(text);
                load();
              }}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
