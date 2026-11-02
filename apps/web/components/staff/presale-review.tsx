"use client";

/* Staff: early pre-sales (owner, 2026-11-03, D-PRESALE-03). An artist opened a pre-sale before the
 * music is finished; staff approve just its title, artist, date and price going public, send it
 * back with a note, or later move its date (buyers are emailed). The API checks who may decide. */

import Link from "next/link";
import { useEffect, useState } from "react";
import { CircleAlert } from "lucide-react";

import { DateTime, Money } from "@/components/ds";
import { Button, Card, ErrorState, LoadingState } from "@/components/staff/kit";
import { useWorkspace } from "@/components/workspace-provider";
import { fetchPresaleQueue, reviewPresale, type PresaleQueueItem, type StudioReleaseDetail } from "@/features/studio/api";
import { ApiError } from "@/lib/api/client";
import { friendlyError } from "@/lib/error-copy";
import { fromLocalInput, toLocalInput } from "@/lib/artist-mail-view";
import { RELEASE_TYPE_LABEL } from "@/lib/studio-view";

/** The queue on Catalog releases: early pre-sales waiting for a decision in this workspace. */
export function PresaleQueue() {
  const { currentOrg } = useWorkspace();
  const [items, setItems] = useState<PresaleQueueItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!currentOrg) return;
    fetchPresaleQueue()
      .then(setItems)
      .catch((err) =>
        err instanceof ApiError && (err.status === 403 || err.status === 404)
          ? setItems([])
          : setError(friendlyError(err, "Pre-sales waiting for review couldn't be loaded.")),
      );
  }, [currentOrg]);

  if (!currentOrg || (items !== null && items.length === 0 && !error)) return null;
  return (
    <Card className="p-5">
      <h2 className="text-lg font-semibold">Pre-sales waiting for review</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Artists who want to take pre-orders before their music is finished. You approve only the title, artist, date and price going public;
        the release itself is reviewed in full later.
      </p>
      {error ? (
        <ErrorState message={error} />
      ) : items === null ? (
        <LoadingState />
      ) : (
        <ul className="mt-3 grid gap-2">
          {items.map((item) => (
            <li key={item.release_id} className="flex flex-wrap items-center justify-between gap-3 rounded border p-3 text-sm">
              <div>
                <p className="font-semibold">
                  {item.title} <span className="font-normal text-muted-foreground">· {RELEASE_TYPE_LABEL[item.release_type] ?? item.release_type}</span>
                </p>
                <p className="text-muted-foreground">
                  {item.profile_name ?? "Unknown artist"}
                  {item.requested_release_at ? (
                    <>
                      {" "}
                      · out <DateTime value={item.requested_release_at} format="datetime" />
                    </>
                  ) : null}
                  {item.price ? (
                    <>
                      {" "}
                      · <Money value={{ amount_minor: item.price.amount_minor, currency_code: item.price.currency_code }} />{" "}
                      {item.price.status === "ACCEPTED" ? "(price agreed)" : "(price not agreed yet)"}
                    </>
                  ) : null}
                </p>
              </div>
              <Link href={`/staff/catalog/releases/${item.release_id}#presale-review`} className="font-semibold underline">
                Review
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** In the release workspace: decide an early pre-sale, or move an approved one's date. */
export function PresaleDecision({ detail, onDone }: { detail: StudioReleaseDetail | null; onDone: () => void }) {
  const p = detail?.presale;
  const [note, setNote] = useState("");
  const [when, setWhen] = useState(toLocalInput(p?.release_at ?? p?.requested_release_at ?? null));
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!detail || !p || (p.status !== "REQUESTED" && p.status !== "APPROVED") || detail.release.status === "SCHEDULED") return null;

  async function decide(decision: "approve" | "return" | "move_date") {
    if (decision === "return" && !note.trim()) {
      setError("Write a note the artist will see.");
      return;
    }
    setBusy(decision);
    setError(null);
    try {
      await reviewPresale(detail!.release.id, { decision, release_at: fromLocalInput(when), note: note.trim() || undefined });
      setResult(decision === "approve" ? "Pre-sale approved." : decision === "return" ? "Sent back to the artist." : "Date moved; buyers are being emailed.");
      setNote("");
      onDone();
    } catch (err) {
      setError(friendlyError(err, "That didn't go through."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="p-5" id="presale-review">
      <h2 className="font-semibold">{p.status === "REQUESTED" ? "Pre-sale waiting for review" : "Approved pre-sale"}</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {p.status === "REQUESTED"
          ? "Fans would see only the title, the artist, the date and the pre-sale price, and pay now. The music unlocks on release day once the release is finished and approved. Whoever prepared or owns it can't approve it."
          : "Moving the date emails everyone who pre-ordered. To end the pre-sale and refund everyone, use Cancel pre-sale below."}
      </p>
      <dl className="mt-3 grid gap-1 text-sm">
        <div>
          <dt className="inline font-semibold">Title: </dt>
          <dd className="inline">{detail.release.title}</dd>
        </div>
        <div>
          <dt className="inline font-semibold">Artist: </dt>
          <dd className="inline">{detail.profile.display_name}</dd>
        </div>
        <div>
          <dt className="inline font-semibold">Pre-sale price: </dt>
          <dd className="inline">
            {p.price ? (
              <>
                <Money value={{ amount_minor: p.price.amount_minor, currency_code: p.price.currency_code }} />{" "}
                {p.price.status === "ACCEPTED" ? "(agreed)" : "(waiting for commerce to agree it in Price proposals)"}
              </>
            ) : (
              "none"
            )}
          </dd>
        </div>
      </dl>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label className="text-sm" htmlFor="presale-at">
          Release date (Bangladesh time)
        </label>
        <input id="presale-at" type="datetime-local" className="rounded border px-2 py-1 text-sm" value={when} onChange={(e) => setWhen(e.target.value)} />
      </div>
      <textarea
        className="mt-3 min-h-16 w-full rounded border p-2 text-sm"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note for the artist (needed to send it back)"
        aria-label="Pre-sale note"
        maxLength={2000}
      />
      <div className="mt-2 flex flex-wrap gap-2">
        {p.status === "REQUESTED" ? (
          <>
            <Button disabled={busy !== null || !when} onClick={() => void decide("approve")}>
              Approve pre-sale
            </Button>
            <Button variant="outline" disabled={busy !== null} onClick={() => void decide("return")}>
              Send back
            </Button>
          </>
        ) : (
          <Button variant="outline" disabled={busy !== null || !when} onClick={() => void decide("move_date")}>
            Move the date and email buyers
          </Button>
        )}
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
