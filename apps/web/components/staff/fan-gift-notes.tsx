"use client";

/*
 * Staff: notes fans wrote on gifts they paid for (owner, 2026-11-20, D-GIFT-FAN-01: fans' notes are
 * checked). The gift is paid, so it always goes: Send with the note, or Send without it when the
 * note can't go out as written. Nobody is emailed until one is pressed.
 */

import { useEffect, useState } from "react";
import { CircleAlert } from "lucide-react";

import { Button, Card, ErrorState, LoadingState } from "@/components/staff/kit";
import { useWorkspace } from "@/components/workspace-provider";
import { fetchFanGiftNotes, reviewFanGiftNote, type FanGiftNote } from "@/features/fan-gifts/api";
import { ApiError } from "@/lib/api/client";
import { friendlyError } from "@/lib/error-copy";
import { peopleLine } from "@/lib/fan-gift-view";

function Item({ g, onDone }: { g: FanGiftNote; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(approve: boolean) {
    setBusy(true);
    setError(null);
    try {
      await reviewFanGiftNote(g.id, approve);
      onDone();
    } catch (err) {
      setError(friendlyError(err, "That didn't go through."));
      setBusy(false);
    }
  }

  return (
    <li className="border-b py-4">
      <p className="font-medium">
        {g.title}
        <span className="font-normal text-muted-foreground"> · {g.act_name}</span>
      </p>
      <p className="mt-1 text-sm">
        A gift from {g.giver_name ?? "a fan"} to {peopleLine(g.people)}, paid for. Their note:
      </p>
      <pre className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded border bg-muted/30 p-3 font-sans text-sm">{g.note}</pre>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => void act(true)}>
          Send with the note
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => void act(false)}>
          Send without the note
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

export function FanGiftNotes() {
  const { currentOrg } = useWorkspace();
  const [items, setItems] = useState<FanGiftNote[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState(0);

  useEffect(() => {
    if (!currentOrg) return;
    fetchFanGiftNotes()
      .then(setItems)
      .catch((err) =>
        err instanceof ApiError && (err.status === 403 || err.status === 404) ? setItems([]) : setError(friendlyError(err, "Gift notes couldn't be loaded.")),
      );
  }, [currentOrg, round]);

  if (!currentOrg || (items !== null && items.length === 0 && !error)) return null;
  return (
    <Card className="p-5">
      <h2 className="text-lg font-semibold">Fans&apos; gift notes waiting for a check</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Fans bought music for people they know and wrote a note. The people are emailed once you choose.
      </p>
      {error ? (
        <ErrorState message={error} />
      ) : items === null ? (
        <LoadingState />
      ) : (
        <ul className="mt-2">
          {items.map((g) => (
            <Item key={g.id} g={g} onDone={() => setRound((n) => n + 1)} />
          ))}
        </ul>
      )}
    </Card>
  );
}
