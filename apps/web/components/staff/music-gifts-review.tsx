"use client";

/*
 * Staff: artists' music gifts waiting for review (owner, 2026-11-06, D-GIFT-MUSIC-01). Approve (the
 * music is given and the emails go, now or at the artist's time) or send back with a note the artist
 * sees. The act's own people and whoever set it up or sent it can't approve (the API checks).
 */

import { useEffect, useState } from "react";
import { CircleAlert } from "lucide-react";

import { Button, Card, ErrorState, LoadingState } from "@/components/staff/kit";
import { useWorkspace } from "@/components/workspace-provider";
import { fetchMusicGiftReviewQueue, reviewMusicGift, type MusicGiftReview } from "@/features/music-gifts/api";
import { ApiError } from "@/lib/api/client";
import { whenLine } from "@/lib/artist-mail-view";
import { friendlyError } from "@/lib/error-copy";
import { worksLine } from "@/lib/gifts-view";

function Item({ g, onDone }: { g: MusicGiftReview; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  async function act(action: "approve" | "reject") {
    if (action === "reject" && !note.trim()) {
      setError("Write a note the artist will see.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await reviewMusicGift(g.id, action, note);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError && err.code === "SAME_PERSON_REVIEW" ? err.message : friendlyError(err, "That review didn't go through."));
      setBusy(false);
    }
  }

  const n = g.people.length;
  return (
    <li className="border-b py-4">
      <p className="font-medium">
        {g.title}
        <span className="font-normal text-muted-foreground"> · {g.profile.display_name}</span>
      </p>
      <p className="mt-1 text-sm">
        Gives {g.works.map((w) => w.title).join(", ") || worksLine(g.works)} free to {n} {n === 1 ? "person" : "people"}.
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        {g.send_at ? `Given ${whenLine(g.send_at)} if approved.` : "Given as soon as it is approved."} People with an account own it at once (a ৳0 order, no money);
        anyone else is emailed and gets it when they sign up with that address.
        {g.files?.length ? ` With files: ${g.files.map((f) => f.name).join(", ")}.` : ""}
      </p>
      <p className="mt-2 text-sm font-medium">Subject: {g.subject}</p>
      <pre className="mt-1 max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded border bg-muted/30 p-3 font-sans text-sm">{g.body}</pre>
      <button type="button" className="mt-2 text-sm font-medium underline" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? "Hide" : "Show"} the {n} {n === 1 ? "address" : "addresses"}
      </button>
      {open ? (
        <ul className="mt-2 max-h-56 overflow-y-auto rounded border p-2 text-sm">
          {g.people.map((p) => (
            <li key={p.email} className="py-0.5">
              {p.email}
              {p.name ? ` · ${p.name}` : ""}
              {p.note ? <span className="text-muted-foreground"> · note: {p.note}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      <textarea
        className="mt-3 min-h-16 w-full rounded border p-2 text-sm"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note for the artist (required to send back)"
        aria-label={`Review note for ${g.title}`}
        maxLength={2000}
      />
      <div className="mt-2 flex gap-2">
        <Button disabled={busy} onClick={() => void act("approve")}>
          Approve and give
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

export function MusicGiftsReview() {
  const { currentOrg } = useWorkspace();
  const [items, setItems] = useState<MusicGiftReview[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState(0);

  useEffect(() => {
    if (!currentOrg) return;
    fetchMusicGiftReviewQueue()
      .then(setItems)
      .catch((err) => (err instanceof ApiError && err.status === 403 ? setItems([]) : setError(friendlyError(err, "Music gifts couldn't be loaded."))));
  }, [currentOrg, round]);

  if (!currentOrg || (items !== null && items.length === 0 && !error)) return null;
  return (
    <Card className="p-5">
      <h2 className="text-lg font-semibold">Music gifts waiting for review</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Music artists want to give free to people they chose, by email. Nothing is given or sent until it is approved.
      </p>
      {error ? <ErrorState message={error} /> : items === null ? <LoadingState /> : (
        <ul className="mt-2">
          {items.map((g) => (
            <Item key={`${g.id}|${g.status}`} g={g} onDone={() => setRound((n) => n + 1)} />
          ))}
        </ul>
      )}
    </Card>
  );
}
