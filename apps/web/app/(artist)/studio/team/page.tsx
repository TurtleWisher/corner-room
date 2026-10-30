"use client";

/* Studio team (owner, 2026-10-30, D-ARTIST-UNIFY-01): solo artists and bands are run the same way,
 * by one owner and any number of managers. Managers see and do what the owner does: music, files,
 * sales, buyer names and payouts. The owner picks a manager by email and staff approve before the
 * manager gets access. The owner can hand the profile to an approved manager (owner, 2026-10-31).
 * The API decides all of it. */

import { FormEvent, useState } from "react";
import { ArrowLeft, CircleAlert, CircleCheck, Clock, Crown, UserPlus, UserRound } from "lucide-react";

import { Button, ButtonLink, Card, ErrorState, Field, Input, Skeleton } from "@/components/ds";
import { useAuth } from "@/components/auth-provider";
import { AccountPage } from "@/components/shell/account-page";
import { RetryButton } from "@/components/shell/staff-panel";
import { loadErrorMessage, useAsync } from "@/components/use-async";
import { fetchMyProfiles, type CatalogProfile } from "@/features/studio/api";
import { fetchTeam, handOverTeam, pickManager, takeOffTeam } from "@/features/team/api";
import { friendlyError } from "@/lib/error-copy";
import { TAKE_OFF_LABEL, canHandOver, memberBadge, memberName, orderTeam, takeOffAction, type Team } from "@/lib/team-view";

function TeamCard({ card }: { card: CatalogProfile }) {
  const { user } = useAuth();
  const loaded = useAsync(() => fetchTeam(card.kind, card.id), [card.kind, card.id]);
  const [override, setOverride] = useState<Team | null>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  if (loaded.status === "loading") return <Skeleton className="h-40 w-full" />;
  if (loaded.status === "error") {
    return <ErrorState title="Team unavailable" message={loadErrorMessage(loaded.error, "this team")} action={<RetryButton onClick={loaded.reload} />} />;
  }
  const team = override ?? loaded.data;
  const headingId = `team-${card.kind}-${card.id}`;

  async function pick(event: FormEvent) {
    event.preventDefault();
    const wanted = email.trim();
    if (!wanted) return;
    setBusy("pick");
    setMessage(null);
    try {
      setOverride(await pickManager(card.kind, card.id, wanted));
      setEmail("");
      setMessage({ tone: "good", text: "Sent to staff. They get access once staff approve." });
    } catch (err) {
      setMessage({ tone: "bad", text: friendlyError(err, "This person couldn't be added. Please try again.") });
    } finally {
      setBusy(null);
    }
  }

  async function handOver(memberId: string, name: string) {
    setBusy(`owner-${memberId}`);
    setMessage(null);
    try {
      setOverride(await handOverTeam(card.kind, card.id, memberId));
      setConfirming(null);
      setMessage({ tone: "good", text: `${name} is the owner now. You stay on as a manager.` });
    } catch (err) {
      setMessage({ tone: "bad", text: friendlyError(err, "The profile couldn't be handed over. Please try again.") });
    } finally {
      setBusy(null);
    }
  }

  async function takeOff(memberId: string, leaving: boolean) {
    setBusy(memberId);
    setMessage(null);
    try {
      const next = await takeOffTeam(card.kind, card.id, memberId);
      if (leaving) {
        window.location.assign("/studio");
        return;
      }
      setOverride(next);
    } catch (err) {
      setMessage({ tone: "bad", text: friendlyError(err, "That didn't work. Please try again.") });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card as="section" aria-labelledby={headingId} className="p-6">
      <h2 id={headingId} className="text-xl font-bold text-fg">
        {team.profile.display_name}
        <span className="ml-2 text-sm font-normal text-fg-muted">{team.profile.kind === "band" ? "Band" : "Artist"}</span>
      </h2>
      <ul className="mt-4 divide-y divide-line border-y border-line">
        {orderTeam(team.members).map((m) => {
          const action = takeOffAction(m, team, user?.id ?? null);
          const Icon = m.role === "OWNER" ? Crown : m.status === "PENDING" ? Clock : UserRound;
          return (
            <li key={m.id} className="flex flex-wrap items-center gap-3 py-3">
              <Icon aria-hidden="true" className="size-5 shrink-0 text-fg-muted" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-fg">
                  {memberName(m)}
                  {m.user_id === user?.id ? <span className="font-normal text-fg-muted"> (you)</span> : null}
                </p>
                <p className="truncate text-sm text-fg-muted">
                  {memberBadge(m)}
                  {m.email && m.display_name ? ` · ${m.email}` : ""}
                </p>
              </div>
              {canHandOver(m, team) ? (
                confirming === m.id ? (
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-fg">Make {memberName(m)} the owner?</span>
                    <Button size="sm" busy={busy === `owner-${m.id}`} onClick={() => void handOver(m.id, memberName(m))}>
                      <Crown aria-hidden="true" /> Yes, hand over
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setConfirming(null)}>
                      Cancel
                    </Button>
                  </span>
                ) : (
                  <Button variant="secondary" size="sm" onClick={() => setConfirming(m.id)}>
                    <Crown aria-hidden="true" /> Make owner
                  </Button>
                )
              ) : null}
              {action && confirming !== m.id ? (
                <Button variant="ghost" size="sm" busy={busy === m.id} onClick={() => void takeOff(m.id, action === "leave")}>
                  {TAKE_OFF_LABEL[action]}
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {team.can_pick_managers ? (
        <form onSubmit={(e) => void pick(e)} className="mt-6 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <Field
            label="Add a manager"
            hint="The email of their Corner Room account. Staff approve before they get access. To hand the profile to someone, add them here first, then press Make owner once they are approved."
          >
            {(c) => <Input {...c} type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" required />}
          </Field>
          <Button type="submit" busy={busy === "pick"}>
            <UserPlus aria-hidden="true" /> Send for approval
          </Button>
        </form>
      ) : (
        <p className="mt-4 text-sm text-fg-muted">The owner adds and removes managers, and can make a manager the owner.</p>
      )}
      {message ? (
        <p role={message.tone === "bad" ? "alert" : "status"} className={`mt-3 flex items-start gap-2 text-sm ${message.tone === "bad" ? "text-danger" : "text-fg"}`}>
          {message.tone === "bad" ? <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" /> : <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0" />}
          {message.text}
        </p>
      ) : null}
    </Card>
  );
}

function Teams() {
  const profiles = useAsync(() => fetchMyProfiles(), []);
  if (profiles.status === "loading") return <Skeleton className="h-48 w-full" />;
  if (profiles.status === "error") {
    return <ErrorState title="Team unavailable" message={loadErrorMessage(profiles.error, "your profiles")} action={<RetryButton onClick={profiles.reload} />} />;
  }
  if (profiles.data.length === 0) {
    return (
      <Card className="max-w-xl p-6">
        <p className="text-lg font-bold text-fg">No artist or band profile yet</p>
        <p className="mt-2 text-sm text-fg">Your team shows here once you run an artist or band profile.</p>
      </Card>
    );
  }
  return (
    <div className="space-y-6">
      <p className="max-w-2xl text-sm text-fg">
        Solo artists and bands are run the same way: one owner and any managers you trust. Managers see and do everything you can, including sales,
        buyer names and payouts.
      </p>
      {profiles.data.map((p) => (
        <TeamCard key={`${p.kind}-${p.id}`} card={p} />
      ))}
    </div>
  );
}

export default function StudioTeamPage() {
  return (
    <AccountPage
      audience="artist"
      eyebrow="Studio"
      title="Team"
      what="your team"
      actions={
        <ButtonLink href="/studio" variant="secondary">
          <ArrowLeft aria-hidden="true" /> Studio home
        </ButtonLink>
      }
    >
      <Teams />
    </AccountPage>
  );
}
