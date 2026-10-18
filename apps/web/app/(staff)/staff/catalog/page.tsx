"use client";

/* Staff catalog intake (URL-06): releases in this workspace, and starting one for an artist or
 * band. Catalog fields only; the artist's account is never shown here. */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { CircleAlert, Search } from "lucide-react";

import { Button, Card, EmptyState, ErrorState, Input, LoadingState, Protected } from "@/components/staff/kit";
import { useWorkspace } from "@/components/workspace-provider";
import { createStudioRelease, fetchIntakeQueue, fetchStaffProfiles, type IntakeQueueItem, type StaffProfileCard } from "@/features/studio/api";
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

export default function StaffCatalogPage() {
  return (
    <Protected>
      <div className="grid gap-6">
        <h1 className="text-2xl font-bold">Catalog releases</h1>
        <StartRelease />
        <Queue />
      </div>
    </Protected>
  );
}
