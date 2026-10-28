"use client";

/* Staff catalog intake (URL-06): releases in this workspace, and starting one for an artist or
 * band. Catalog fields only; the artist's account is never shown here. */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { CircleAlert, Search } from "lucide-react";

import { ChangesQueue } from "@/components/staff/changes-review";
import { GiftsReview } from "@/components/staff/gifts-review";
import { Button, Card, EmptyState, ErrorState, Input, LoadingState, Protected } from "@/components/staff/kit";
import { useWorkspace } from "@/components/workspace-provider";
import {
  createStudioRelease,
  fetchIntakeQueue,
  fetchCoverQueue,
  fetchLyricsQueue,
  fetchStaffProfiles,
  reviewCover,
  reviewLyrics,
  type CoverReviewItem,
  type IntakeQueueItem,
  type LyricsReviewItem,
  type StaffProfileCard,
} from "@/features/studio/api";
import { ApiError } from "@/lib/api/client";
import { coverUrl } from "@/lib/cover-view";
import { friendlyError } from "@/lib/error-copy";
import { RELEASE_TYPE_LABEL, displayStateLabel, displayStateTone } from "@/lib/studio-view";

const MODE_LABEL: Record<string, string> = { SELF: "Artist", ASSISTED: "Staff helping", MANAGED: "Managed by Corner Room" };

function StartRelease() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [profiles, setProfiles] = useState<StaffProfileCard[] | null>(null);
  const [picked, setPicked] = useState<StaffProfileCard | null>(null);
  const [type, setType] = useState("SINGLE");
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function search(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      setProfiles(await fetchStaffProfiles(q));
    } catch (err) {
      setError(friendlyError(err, "Profiles couldn't be searched."));
    }
  }

  async function start(e: FormEvent) {
    e.preventDefault();
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      const created = await createStudioRelease({ profile: { kind: picked.kind, id: picked.id }, release_type: type, title });
      router.push(`/staff/catalog/releases/${created.release.id}`);
    } catch (err) {
      setError(friendlyError(err, "The release couldn't be started."));
      setBusy(false);
    }
  }

  return (
    <Card className="p-5">
      <h2 className="text-lg font-semibold">Prepare a release for an artist</h2>
      <p className="mt-1 text-sm text-muted-foreground">You prepare the details and files; the artist reviews and submits it themselves.</p>
      <form onSubmit={search} className="mt-4 flex gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Artist or band name" aria-label="Artist or band name" />
        <Button type="submit" variant="outline">
          <Search aria-hidden="true" className="size-4" /> Search
        </Button>
      </form>
      {profiles ? (
        profiles.length === 0 ? (
          <p className="mt-3 text-sm">No artist or band in this workspace matches.</p>
        ) : (
          <ul className="mt-3 grid gap-1">
            {profiles.map((p) => (
              <li key={`${p.kind}-${p.id}`}>
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input type="radio" name="profile" checked={picked?.id === p.id} onChange={() => setPicked(p)} />
                  <span className="font-medium">{p.display_name}</span>
                  <span className="text-muted-foreground">
                    {p.kind === "band" ? "Band" : "Artist"} · {p.status}
                    {p.has_owner ? "" : " · no artist account (label-run)"}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )
      ) : null}
      {picked ? (
        <form onSubmit={start} className="mt-4 grid gap-2 md:grid-cols-[10rem_1fr_auto]">
          <select className="rounded border px-2 py-2 text-sm" value={type} onChange={(e) => setType(e.target.value)} aria-label="Release type">
            {Object.entries(RELEASE_TYPE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Release title" aria-label="Release title" required maxLength={300} />
          <Button type="submit" disabled={busy}>
            Start draft for {picked.display_name}
          </Button>
        </form>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 flex items-center gap-2 text-sm text-red-600">
          <CircleAlert aria-hidden="true" className="size-4" /> {error}
        </p>
      ) : null}
    </Card>
  );
}

function Queue() {
  const { currentOrg } = useWorkspace();
  const [inReview, setInReview] = useState(false);
  const [items, setItems] = useState<IntakeQueueItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!currentOrg) return;
    setItems(null);
    fetchIntakeQueue(inReview)
      .then(setItems)
      .catch((err) => setError(friendlyError(err, "The release queue couldn't be loaded.")));
  }, [currentOrg, inReview]);

  if (!currentOrg) return <EmptyState message="Choose a workspace to see its releases." />;
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Releases in {currentOrg.name}</h2>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={inReview} onChange={(e) => setInReview(e.target.checked)} /> Waiting for review only
        </label>
      </div>
      {error ? <ErrorState message={error} /> : items === null ? <LoadingState /> : items.length === 0 ? (
        <EmptyState message="No releases yet." />
      ) : (
        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-2">Release</th>
              <th>Artist or band</th>
              <th>State</th>
              <th>Who is working on it</th>
            </tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.id} className="border-b">
                <td className="py-2">
                  <Link href={`/staff/catalog/releases/${r.id}`} className="font-medium underline">
                    {r.title}
                  </Link>
                  <span className="block text-muted-foreground">
                    {RELEASE_TYPE_LABEL[r.release_type] ?? r.release_type} · {r.track_count} tracks
                  </span>
                </td>
                <td>{r.profile_name}</td>
                <td className={displayStateTone(r.display_state) === "attention" ? "text-red-600" : ""}>{displayStateLabel(r.display_state)}</td>
                <td>{MODE_LABEL[r.intake_mode] ?? r.intake_mode}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function LyricsText({ label, text }: { label: string; text?: string | null }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap rounded border p-2 font-sans text-sm">{text || "No lyrics"}</pre>
    </div>
  );
}

function LyricsChange({ item, onDone }: { item: LyricsReviewItem; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(action: "approve" | "reject") {
    if (action === "reject" && !note.trim()) {
      setError("Write a note the artist will see.");
      return;
    }
    setBusy(action);
    setError(null);
    try {
      await reviewLyrics(item.track_id, action, note);
      onDone();
    } catch (err) {
      setError(friendlyError(err, "That review didn't go through."));
      setBusy(null);
    }
  }

  return (
    <li className="border-b py-4">
      <p className="font-medium">
        {item.title}
        <span className="font-normal text-muted-foreground">
          {" "}
          · {item.profile_name ?? "Artist not available"}
          {item.release_title ? ` · ${item.release_title}` : ""}
        </span>
      </p>
      <div className="mt-2 grid gap-3 md:grid-cols-2">
        <LyricsText label="Listeners see now" text={item.lyrics} />
        <LyricsText label="Suggested change" text={item.lyrics_pending} />
      </div>
      <textarea
        className="mt-3 min-h-16 w-full rounded border p-2 text-sm"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note for the artist (required to send back)"
        aria-label={`Review note for ${item.title}`}
        maxLength={2000}
      />
      <div className="mt-2 flex gap-2">
        <Button disabled={busy !== null} onClick={() => void act("approve")}>
          Approve lyrics
        </Button>
        <Button variant="outline" disabled={busy !== null} onClick={() => void act("reject")}>
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

/**
 * Lyrics changes to songs that are already out (owner, 2026-10-27, D-LYRICS-01). Lyrics typed
 * while drafting are read in the release review instead. The artist can't approve their own.
 */
function LyricsQueue() {
  const { currentOrg } = useWorkspace();
  const [items, setItems] = useState<LyricsReviewItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState(0);

  useEffect(() => {
    if (!currentOrg) return;
    fetchLyricsQueue()
      .then(setItems)
      // Staff who can't approve music don't review lyrics: no card for them.
      .catch((err) => (err instanceof ApiError && err.status === 403 ? setItems([]) : setError(friendlyError(err, "Lyrics waiting for review couldn't be loaded."))));
  }, [currentOrg, round]);

  if (!currentOrg || (items !== null && items.length === 0 && !error)) return null;
  return (
    <Card className="p-5">
      <h2 className="text-lg font-semibold">Lyrics waiting for review</h2>
      <p className="mt-1 text-sm text-muted-foreground">Changes to songs that are already out. Listeners keep the current lyrics until you approve.</p>
      {error ? <ErrorState message={error} /> : items === null ? <LoadingState /> : (
        <ul className="mt-2">
          {items.map((item) => (
            <LyricsChange key={`${item.track_id}|${item.submitted_at}`} item={item} onDone={() => setRound((n) => n + 1)} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function CoverChange({ item, onDone }: { item: CoverReviewItem; onDone: () => void }) {
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
      await reviewCover(item.release_id, action, note);
      onDone();
    } catch (err) {
      setError(friendlyError(err, "That review didn't go through."));
      setBusy(false);
    }
  }

  const img = (url: string | null | undefined, alt: string) =>
    url ? (
      // eslint-disable-next-line @next/next/no-img-element -- signed cover link from the API
      <img src={coverUrl({ signed: url }) ?? ""} alt={alt} className="size-36 object-cover" />
    ) : (
      <div className="flex size-36 items-center justify-center border text-xs text-muted-foreground">No cover</div>
    );

  return (
    <li className="border-b py-4">
      <p className="font-medium">
        {item.title}
        <span className="font-normal text-muted-foreground"> · {item.profile_name ?? "Artist not available"}</span>
      </p>
      <div className="mt-2 flex flex-wrap gap-6">
        <figure>
          {img(item.current_cover_url, `Current cover of ${item.title}`)}
          <figcaption className="mt-1 text-xs text-muted-foreground">Listeners see now</figcaption>
        </figure>
        <figure>
          {img(item.pending_cover_url, `New cover for ${item.title}`)}
          <figcaption className="mt-1 text-xs text-muted-foreground">New cover</figcaption>
        </figure>
      </div>
      <textarea
        className="mt-3 min-h-16 w-full rounded border p-2 text-sm"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note for the artist (required to send back)"
        aria-label={`Review note for the cover of ${item.title}`}
        maxLength={2000}
      />
      <div className="mt-2 flex gap-2">
        <Button disabled={busy} onClick={() => void act("approve")}>
          Approve cover
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

/** New covers for approved or released music (owner, 2026-10-28, D-COVER-01). The uploader can't approve. */
function CoverQueue() {
  const { currentOrg } = useWorkspace();
  const [items, setItems] = useState<CoverReviewItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState(0);

  useEffect(() => {
    if (!currentOrg) return;
    fetchCoverQueue()
      .then(setItems)
      .catch((err) => (err instanceof ApiError && err.status === 403 ? setItems([]) : setError(friendlyError(err, "Covers waiting for review couldn't be loaded."))));
  }, [currentOrg, round]);

  if (!currentOrg || (items !== null && items.length === 0 && !error)) return null;
  return (
    <Card className="p-5">
      <h2 className="text-lg font-semibold">Covers waiting for review</h2>
      <p className="mt-1 text-sm text-muted-foreground">New covers for music that is approved or out. Listeners keep the current cover until you approve.</p>
      {error ? <ErrorState message={error} /> : items === null ? <LoadingState /> : (
        <ul className="mt-2">
          {items.map((item) => (
            <CoverChange key={`${item.release_id}|${item.submitted_at}`} item={item} onDone={() => setRound((n) => n + 1)} />
          ))}
        </ul>
      )}
    </Card>
  );
}

export default function StaffCatalogPage() {
  return (
    <Protected>
      <div className="grid gap-6">
        <h1 className="text-2xl font-bold">Catalog releases</h1>
        <ChangesQueue />
        <GiftsReview />
        <LyricsQueue />
        <CoverQueue />
        <StartRelease />
        <Queue />
      </div>
    </Protected>
  );
}
