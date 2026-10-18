"use client";

/* Ops queue of prices artists proposed for their releases (D-AUDIO-11, D-AUDIO-15). Accepting puts
 * exactly the proposed price on sale; countering sends a note back to the artist's Studio. The
 * server checks commerce.write and the workspace; nothing here decides a price. */

import { useState } from "react";
import Link from "next/link";

import { Money, StatusChip } from "@/components/ds";
import { Button, Card, EmptyState, ErrorState, Input, LoadingState } from "@/components/staff/kit";
import { useAsync } from "@/components/use-async";
import { decideOfferProposal, fetchOfferProposals, type OfferProposalRecord } from "@/features/commerce/api";
import { ApiError } from "@/lib/api/client";
import { proposalWords } from "@/lib/studio-view";

function ProposalRow({ proposal, onDecided }: { proposal: OfferProposalRecord; onDecided: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"accept" | "counter" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const words = proposalWords(proposal);

  async function decide(decision: "accept" | "counter") {
    setError(null);
    setBusy(decision);
    try {
      await decideOfferProposal(proposal.id, decision, note.trim() || undefined);
      onDecided();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That decision could not be saved.");
      setBusy(null);
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="font-semibold text-fg">
          <Link href={`/staff/catalog/releases/${proposal.release_id}`} className="cr-focus hover:text-highlight">
            {proposal.release_title}
          </Link>{" "}
          <StatusChip value={proposal.release_status} />
        </p>
        <Money value={{ amount_minor: proposal.amount_minor, currency_code: proposal.currency_code }} minorDigits="always" className="text-lg font-bold text-fg" />
      </div>
      <p className="mt-1 text-sm text-fg">
        {words.subject} · {words.audience}
      </p>
      {proposal.note ? <p className="mt-2 text-sm text-fg-muted">Artist&apos;s note: {proposal.note}</p> : null}
      <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end">
        <label className="grid gap-1 text-sm text-fg-muted">
          Note to the artist (needed to counter)
          <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
        </label>
        <Button type="button" size="sm" disabled={busy !== null} onClick={() => void decide("accept")}>
          {busy === "accept" ? "Accepting" : "Accept and put on sale"}
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={busy !== null || !note.trim()} onClick={() => void decide("counter")}>
          {busy === "counter" ? "Sending" : "Counter"}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </Card>
  );
}

export function PriceProposals({ onDecided }: { onDecided?: () => void }) {
  const queue = useAsync(() => fetchOfferProposals("PROPOSED"), []);

  return (
    <section aria-labelledby="price-proposals" className="space-y-3">
      <h2 id="price-proposals" className="text-lg font-semibold">
        Price proposals
      </h2>
      <p className="text-sm text-fg-muted">Prices artists proposed in their Studio. Accepting puts exactly this price on sale.</p>
      {queue.status === "loading" ? (
        <LoadingState label="Loading price proposals" />
      ) : queue.status === "error" ? (
        <ErrorState title="Price proposals" message={queue.error instanceof ApiError ? queue.error.message : "Price proposals could not be loaded."} />
      ) : queue.data.length === 0 ? (
        <EmptyState message="No prices waiting for a decision." />
      ) : (
        queue.data.map((p) => (
          <ProposalRow
            key={p.id}
            proposal={p}
            onDecided={() => {
              queue.reload();
              onDecided?.();
            }}
          />
        ))
      )}
    </section>
  );
}
