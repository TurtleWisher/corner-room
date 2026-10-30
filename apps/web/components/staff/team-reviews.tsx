"use client";

/* Who runs an artist profile, solo or band (owner, 2026-10-30, D-ARTIST-UNIFY-01). An owner picks
 * a manager in Studio; it waits here until someone approves it. Staff can also make another account
 * the owner (for example a band's official email account); the old owner stays on as a manager.
 * The API lists only what this person may decide in the active workspace and refuses the
 * profile's own people. */

import { FormEvent, useCallback, useEffect, useState } from "react";
import { Check, CircleAlert, Crown, X } from "lucide-react";

import { DateTime } from "@/components/ds";
import { Button, Card, EmptyState, ErrorState, Input, LoadingState, selectClasses } from "@/components/staff/kit";
import { fetchArtists, type ArtistRecord } from "@/features/artists/api";
import { fetchArtistTeam, fetchTeamRequests, reviewTeamRequest, setArtistOwner } from "@/features/team/api";
import { friendlyError } from "@/lib/error-copy";
import { memberBadge, memberName, orderTeam, type Team, type TeamRequest } from "@/lib/team-view";

function RequestCard({ item, onDone }: { item: TeamRequest; onDone: (text: string) => void }) {
  const [note, setNote] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const who = memberName(item);

  async function decide(action: "approve" | "reject") {
    setBusy(true);
    setError(null);
    try {
      await reviewTeamRequest(item.id, action, action === "reject" ? note : undefined);
      onDone(action === "approve" ? `${who} now manages ${item.profile.display_name}.` : `${who} was turned down for ${item.profile.display_name}.`);
    } catch (err) {
      setError(friendlyError(err, "That didn't go through."));
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="text-lg font-semibold text-fg">
          {who}{" "}
          <span className="text-sm font-normal text-fg-muted">
            to manage {item.profile.display_name} ({item.profile.kind === "band" ? "band" : "artist"})
          </span>
        </p>
        <p className="text-xs text-fg-muted">
          Picked <DateTime value={item.requested_at} />
        </p>
      </div>
      <p className="mt-1 text-sm text-fg-muted">
        {item.email}
        {item.picked_by ? ` · picked by ${item.picked_by}` : ""}
      </p>
      <p className="mt-2 text-sm text-fg">A manager sees and does what the owner does, including sales, buyer names and payouts.</p>
      {rejecting ? (
        <label className="mt-3 block text-sm">
          <span className="font-semibold text-fg">Note for the owner (required)</span>
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
            <Button size="sm" variant="outline" disabled={busy || !note.trim()} onClick={() => void decide("reject")}>
              <X aria-hidden="true" className="size-4" /> Turn down with this note
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setRejecting(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" disabled={busy} onClick={() => void decide("approve")}>
              <Check aria-hidden="true" className="size-4" /> {busy ? "Working" : "Approve"}
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setRejecting(true)}>
              <CircleAlert aria-hidden="true" className="size-4" /> Turn down
            </Button>
          </>
        )}
      </div>
      {error ? <ErrorState title="Manager" message={error} /> : null}
    </Card>
  );
}

function OwnerTool() {
  const [profiles, setProfiles] = useState<ArtistRecord[] | null>(null);
  const [chosen, setChosen] = useState("");
  const [team, setTeam] = useState<Team | null>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "good" | "bad"; text: string } | null>(null);

  useEffect(() => {
    fetchArtists({ kind: "ALL" })
      .then((p) => setProfiles([...p.items].sort((a, b) => a.stage_name.localeCompare(b.stage_name))))
      .catch(() => setProfiles([]));
  }, []);
  useEffect(() => {
    setTeam(null);
    setMessage(null);
    if (!chosen) return;
    fetchArtistTeam(chosen)
      .then(setTeam)
      .catch((err) => setMessage({ tone: "bad", text: friendlyError(err, "This team couldn't be loaded.") }));
  }, [chosen]);

  async function makeOwner(event: FormEvent) {
    event.preventDefault();
    if (!chosen || !email.trim()) return;
    setBusy(true);
    setMessage(null);
    const hadOwner = team?.members.some((m) => m.role === "OWNER" && m.status === "ACTIVE") ?? false;
    try {
      setTeam(await setArtistOwner(chosen, email.trim()));
      setEmail("");
      setMessage({ tone: "good", text: hadOwner ? "Owner changed. The previous owner stays on as a manager." : "Owner set." });
    } catch (err) {
      setMessage({ tone: "bad", text: friendlyError(err, "The owner couldn't be changed.") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <label className="block text-sm">
        <span className="font-semibold text-fg">Profile</span>
        <select className={`mt-1 w-full ${selectClasses}`} value={chosen} onChange={(e) => setChosen(e.target.value)} disabled={profiles === null}>
          <option value="">{profiles === null ? "Loading profiles" : "Choose an artist or band"}</option>
          {(profiles ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.stage_name} {p.kind === "BAND" ? "(band)" : "(artist)"}
            </option>
          ))}
        </select>
      </label>
      {team ? (
        <ul className="mt-3 divide-y divide-line border-y border-line text-sm">
          {orderTeam(team.members).map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-2 py-2">
              {m.role === "OWNER" ? <Crown aria-hidden="true" className="size-4 text-fg-muted" /> : null}
              <span className="font-semibold text-fg">{memberName(m)}</span>
              <span className="text-fg-muted">
                {memberBadge(m)}
                {m.email && m.display_name ? ` · ${m.email}` : ""}
              </span>
            </li>
          ))}
          {team.members.length === 0 ? <li className="py-2 text-fg-muted">Nobody runs this profile yet.</li> : null}
        </ul>
      ) : null}
      {chosen ? (
        <form onSubmit={(e) => void makeOwner(e)} className="mt-3 flex flex-wrap items-end gap-2">
          <label className="block min-w-64 flex-1 text-sm">
            <span className="font-semibold text-fg">Make this account the owner</span>
            <Input className="mt-1" type="email" autoComplete="off" placeholder="name@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <Button size="sm" type="submit" disabled={busy || !email.trim()}>
            <Crown aria-hidden="true" className="size-4" /> {busy ? "Working" : "Make owner"}
          </Button>
        </form>
      ) : null}
      {message ? (
        <p role={message.tone === "bad" ? "alert" : "status"} className={`mt-2 text-sm ${message.tone === "bad" ? "text-danger" : "text-success"}`}>
          {message.text}
        </p>
      ) : null}
    </Card>
  );
}

export function TeamReviews() {
  const [items, setItems] = useState<TeamRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    fetchTeamRequests()
      .then(setItems)
      .catch((err) => setError(friendlyError(err, "Managers waiting for approval couldn't be loaded.")));
  }, []);
  useEffect(load, [load]);

  return (
    <section aria-labelledby="artist-teams" className="space-y-3">
      <h2 id="artist-teams" className="pt-2 text-lg font-semibold">
        Who runs each artist
      </h2>
      <p className="text-sm text-fg-muted">
        Solo artists and bands each have one owner and any managers. An owner picks a manager in Studio; they get access only after you approve.
      </p>
      {notice ? (
        <p role="status" className="text-sm text-success">
          {notice}
        </p>
      ) : null}
      {error ? <ErrorState title="Managers" message={error} /> : null}
      {items === null && !error ? <LoadingState label="Loading managers waiting for approval" /> : null}
      {items !== null && items.length === 0 ? <EmptyState message="No managers waiting for approval." /> : null}
      <ul className="grid gap-3">
        {(items ?? []).map((item) => (
          <li key={item.id}>
            <RequestCard
              item={item}
              onDone={(text) => {
                setNotice(text);
                load();
              }}
            />
          </li>
        ))}
      </ul>
      <h3 className="pt-2 text-base font-semibold">Change the owner</h3>
      <OwnerTool />
    </section>
  );
}
