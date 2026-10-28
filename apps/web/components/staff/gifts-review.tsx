"use client";

/*
 * Staff: gift campaigns waiting to go live, and changes to live ones (owner, 2026-10-28,
 * D-CAMPAIGN-01). Approve, or send back with a note the artist sees. The people who set it up or
 * changed it, and the profile's own people, can't approve (the API checks).
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { CircleAlert } from "lucide-react";

import { Button, Card, ErrorState, LoadingState } from "@/components/staff/kit";
import { useWorkspace } from "@/components/workspace-provider";
import { fetchGiftReviewQueue, reviewGiftCampaign, type GiftCampaign } from "@/features/gifts/api";
import { ApiError } from "@/lib/api/client";
import { friendlyError } from "@/lib/error-copy";
import { reviewKind, SENDER_LABEL, worksLine } from "@/lib/gifts-view";

const FIELD = {
  title: "Name",
  gift_items: "What the gift is",
  description: "Note for fans",
  sender: "Who sends",
  include_presale: "Pre-sale buyers",
  counts_from: "Count purchases from",
  works: "Which music",
} as Record<string, string>;

function show(key: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "None";
  if (key === "works" && Array.isArray(value)) return `${value.length} songs or releases`;
  if (key === "sender") return SENDER_LABEL[value as "ARTIST" | "CORNER_ROOM"] ?? String(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (key === "counts_from") return String(value).slice(0, 10);
  return String(value);
}

function Item({ c, onDone }: { c: GiftCampaign; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const kind = reviewKind(c);

  async function act(action: "approve" | "reject") {
    if (action === "reject" && !note.trim()) {
      setError("Write a note the artist will see.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await reviewGiftCampaign(c.id, action, note);
      onDone();
    } catch (err) {
      setError(friendlyError(err, "That review didn't go through."));
      setBusy(false);
    }
  }

  return (
    <li className="border-b py-4">
      <p className="font-medium">
        <Link href={`/studio/gifts/${c.id}`} className="underline">
          {c.title}
        </Link>
        <span className="font-normal text-muted-foreground"> · {c.profile.display_name} · {kind === "new" ? "New campaign" : "Change to a live campaign"}</span>
      </p>
      <p className="mt-1 text-sm">
        {c.gift_items} · {worksLine(c.works)} · {SENDER_LABEL[c.sender]}
        {c.include_presale ? " · pre-sale buyers included" : ""}
      </p>
      {c.description ? <p className="mt-1 text-sm text-muted-foreground">{c.description}</p> : null}
      {kind === "change" && c.pending ? (
        <table className="mt-2 w-full text-left text-sm">
          <tbody>
            {Object.entries(c.pending).map(([k, v]) => (
              <tr key={k} className="border-b align-top">
                <td className="py-1 pr-3 text-muted-foreground">{FIELD[k] ?? k}</td>
                <td className="py-1 pr-3 text-muted-foreground">{show(k, (c as unknown as Record<string, unknown>)[k])}</td>
                <td className="py-1 font-semibold">{show(k, v)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      <textarea
        className="mt-3 min-h-16 w-full rounded border p-2 text-sm"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note for the artist (required to send back)"
        aria-label={`Review note for ${c.title}`}
        maxLength={2000}
      />
      <div className="mt-2 flex gap-2">
        <Button disabled={busy} onClick={() => void act("approve")}>
          {kind === "new" ? "Approve and go live" : "Approve the change"}
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

export function GiftsReview() {
  const { currentOrg } = useWorkspace();
  const [items, setItems] = useState<GiftCampaign[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState(0);

  useEffect(() => {
    if (!currentOrg) return;
    fetchGiftReviewQueue()
      .then(setItems)
      .catch((err) => (err instanceof ApiError && err.status === 403 ? setItems([]) : setError(friendlyError(err, "Gift campaigns couldn't be loaded."))));
  }, [currentOrg, round]);

  if (!currentOrg || (items !== null && items.length === 0 && !error)) return null;
  return (
    <Card className="p-5">
      <h2 className="text-lg font-semibold">Gift campaigns waiting for review</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Free gifts artists offer to their buyers. Fans see a campaign only once it is approved; changes to a live one wait here too.
      </p>
      {error ? <ErrorState message={error} /> : items === null ? <LoadingState /> : (
        <ul className="mt-2">
          {items.map((c) => (
            <Item key={`${c.id}|${c.status}|${JSON.stringify(c.pending ?? {})}`} c={c} onDone={() => setRound((n) => n + 1)} />
          ))}
        </ul>
      )}
    </Card>
  );
}
