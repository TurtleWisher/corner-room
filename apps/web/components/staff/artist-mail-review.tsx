"use client";

/*
 * Staff: artists' emails to buyers waiting to go out (owner, 2026-11-02, D-MAIL-01). Approve (Corner
 * Room sends it to whoever the audience reaches now) or send back with a note the artist sees. The
 * profile's own people and whoever wrote or sent it can't approve (the API checks).
 */

import { useEffect, useState } from "react";
import { CircleAlert } from "lucide-react";

import { Button, Card, ErrorState, LoadingState } from "@/components/staff/kit";
import { useWorkspace } from "@/components/workspace-provider";
import { fetchMailReviewQueue, fullAudience, reviewMail, type ArtistMail } from "@/features/artist-mail/api";
import { ApiError } from "@/lib/api/client";
import { audienceLine, reachLine, whenLine } from "@/lib/artist-mail-view";
import { friendlyError } from "@/lib/error-copy";

function Item({ m, onDone }: { m: ArtistMail; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(action: "approve" | "reject") {
    if (action === "reject" && !note.trim()) {
      setError("Write a note the artist will see.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await reviewMail(m.id, action, note);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError && err.code === "SAME_PERSON_REVIEW" ? err.message : friendlyError(err, "That review didn't go through."));
      setBusy(false);
    }
  }

  return (
    <li className="border-b py-4">
      <p className="font-medium">
        {m.subject}
        <span className="font-normal text-muted-foreground"> · {m.profile.display_name}</span>
      </p>
      <p className="mt-1 text-sm">
        {audienceLine(fullAudience(m.audience))} · {reachLine(m.reach)}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        {m.send_at ? `Goes out ${whenLine(m.send_at)} if approved (who gets it is worked out then).` : "Goes out as soon as it is approved."}
        {m.files?.length ? ` With files: ${m.files.map((f) => f.name).join(", ")}.` : ""}
      </p>
      <pre className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded border bg-muted/30 p-3 font-sans text-sm">{m.body}</pre>
      <textarea
        className="mt-3 min-h-16 w-full rounded border p-2 text-sm"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note for the artist (required to send back)"
        aria-label={`Review note for ${m.subject}`}
        maxLength={2000}
      />
      <div className="mt-2 flex gap-2">
        <Button disabled={busy} onClick={() => void act("approve")}>
          Approve and send
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
    </li>
  );
}

export function ArtistMailReview() {
  const { currentOrg } = useWorkspace();
  const [items, setItems] = useState<ArtistMail[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState(0);

  useEffect(() => {
    if (!currentOrg) return;
    fetchMailReviewQueue()
      .then(setItems)
      .catch((err) => (err instanceof ApiError && err.status === 403 ? setItems([]) : setError(friendlyError(err, "Artists' emails couldn't be loaded."))));
  }, [currentOrg, round]);

  if (!currentOrg || (items !== null && items.length === 0 && !error)) return null;
  return (
    <Card className="p-5">
      <h2 className="text-lg font-semibold">Artists&apos; emails waiting for review</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Emails artists want Corner Room to send to their buyers. Nothing goes out until it is approved; the people it reaches are worked out then.
      </p>
      {error ? <ErrorState message={error} /> : items === null ? <LoadingState /> : (
        <ul className="mt-2">
          {items.map((m) => (
            <Item key={`${m.id}|${m.status}`} m={m} onDone={() => setRound((n) => n + 1)} />
          ))}
        </ul>
      )}
    </Card>
  );
}
