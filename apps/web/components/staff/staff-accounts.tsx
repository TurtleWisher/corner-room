"use client";

/*
 * Staff accounts (owner, 2026-11-28, D-STAFF-ACCOUNTS-01; /staff/team, URL-15). Admins add people by
 * email as Admin (the whole portal) or Staff (chosen areas); the person signs in with Continue with
 * Google using that address, and an existing fan account with it becomes their staff account. Only
 * the owner adds or removes admins. The API checks every rule; the page only offers what it allows.
 */

import * as React from "react";
import Link from "next/link";
import { CircleCheck, Clock, Mail, ShieldCheck, UserMinus, UserPlus, UserRoundCog } from "lucide-react";

import { Button } from "@/components/ds";
import { Dialog } from "@/components/ds/dialog";
import { PersonMark, StatTile, TonePill, useNow } from "@/components/staff/customers-kit";
import { ErrorState, Input, LoadingState } from "@/components/staff/kit";
import {
  addStaffAccount,
  cancelStaffInvite,
  changeStaffAccount,
  fetchStaffAccounts,
  removeStaffAccount,
  type StaffAccount,
  type StaffAccounts,
  type StaffArea,
} from "@/features/staff-portal/api";
import { ApiError } from "@/lib/api/client";
import { formatDate } from "@/lib/format/date";
import {
  LEVEL_WORDS,
  REFUSALS,
  addProblem,
  addedWords,
  agoWords,
  areaLabels,
  filterAccounts,
  filterInvites,
  groupAreas,
  levelCounts,
  toggle,
  type AccountFilter,
} from "@/lib/staff-accounts-view";

function problemOf(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return REFUSALS[err.code ?? ""] ?? err.message ?? fallback;
  return fallback;
}

const LEVEL_TONE = { OWNER: "accent", ADMIN: "info", STAFF: "neutral" } as const;

function AreaPicker({ areas, value, onChange, idBase }: { areas: StaffArea[]; value: string[]; onChange: (keys: string[]) => void; idBase: string }) {
  return (
    <fieldset className="space-y-3">
      <legend className="st-label">Areas they work in</legend>
      {groupAreas(areas).map((group) => (
        <div key={group.group}>
          <p className="st-eyebrow">{group.group}</p>
          <ul className="mt-1 grid gap-2 sm:grid-cols-2">
            {group.areas.map((area) => {
              const id = `${idBase}-${area.key}`;
              const on = value.includes(area.key);
              return (
                <li key={area.key}>
                  <label htmlFor={id} className="sa-area cr-cut cr-focus-within" data-on={on || undefined}>
                    <input id={id} type="checkbox" checked={on} onChange={() => onChange(toggle(value, area.key))} className="sa-check" />
                    <span className="min-w-0">
                      <span className="block font-semibold text-fg">{area.label}</span>
                      <span className="block text-xs text-fg-muted">{area.does}</span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </fieldset>
  );
}

function LevelPicker({
  value,
  onChange,
  allowed,
  name,
}: {
  value: "ADMIN" | "STAFF" | null;
  onChange: (level: "ADMIN" | "STAFF") => void;
  allowed: ("ADMIN" | "STAFF")[];
  name: string;
}) {
  return (
    <fieldset>
      <legend className="st-label">Account type</legend>
      <div className="mt-1 grid gap-2 sm:grid-cols-2">
        {(["ADMIN", "STAFF"] as const).map((level) => {
          const can = allowed.includes(level);
          return (
            <label key={level} className="sa-level cr-cut" data-on={value === level || undefined} data-off={!can || undefined}>
              <input type="radio" name={name} value={level} checked={value === level} disabled={!can} onChange={() => onChange(level)} className="sa-check" />
              <span>
                <span className="flex items-center gap-2 font-semibold text-fg">
                  {level === "ADMIN" ? <ShieldCheck aria-hidden="true" className="size-4" /> : <UserRoundCog aria-hidden="true" className="size-4" />}
                  {LEVEL_WORDS[level].label}
                </span>
                <span className="block text-xs text-fg-muted">{can ? LEVEL_WORDS[level].does : REFUSALS.OWNER_ONLY}</span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function AddPerson({ data, onDone }: { data: StaffAccounts; onDone: (message: string) => void }) {
  const [email, setEmail] = React.useState("");
  const [level, setLevel] = React.useState<"ADMIN" | "STAFF" | null>(data.can_add_levels.length === 1 ? data.can_add_levels[0] : "STAFF");
  const [areas, setAreas] = React.useState<string[]>([]);
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [tried, setTried] = React.useState(false);
  const problem = addProblem({ email, level, areas });

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setTried(true);
    if (problem || !level) return;
    setBusy(true);
    setError(null);
    try {
      const res = await addStaffAccount({ email: email.trim(), level, areas: level === "STAFF" ? areas : [], note: note.trim() || undefined });
      onDone(addedWords(res.state, email.trim().toLowerCase()));
      setEmail("");
      setAreas([]);
      setNote("");
      setTried(false);
    } catch (err) {
      setError(problemOf(err, "They couldn't be added."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="st-panel space-y-5" aria-labelledby="sa-add">
      <div>
        <h2 id="sa-add" className="st-h2 flex items-center gap-2">
          <UserPlus aria-hidden="true" className="size-5 text-highlight" /> Add someone to the staff
        </h2>
        <p className="st-sub">
          Use the email they sign in to Google with. If they already have a Corner Room account with it, that same account becomes their staff account and keeps everything it had.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label htmlFor="sa-email" className="st-label">
            Email address
          </label>
          <Input id="sa-email" type="email" inputMode="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@gmail.com" />
        </div>
        <div>
          <label htmlFor="sa-note" className="st-label">
            Note for other admins (optional)
          </label>
          <Input id="sa-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="Who they are, why they need access" />
        </div>
      </div>
      <LevelPicker value={level} onChange={setLevel} allowed={data.can_add_levels} name="sa-level" />
      {level === "STAFF" ? <AreaPicker areas={data.areas} value={areas} onChange={setAreas} idBase="sa-add" /> : null}
      {level === "ADMIN" ? <p className="st-callout text-sm">An admin can see and run every part of the staff portal, set royalty rates and add staff. Only you, the owner, can add or remove admins.</p> : null}
      {tried && problem ? (
        <p role="alert" className="text-sm text-danger">
          {problem}
        </p>
      ) : null}
      {error ? <ErrorState title="Not added" message={error} /> : null}
      <Button type="submit" busy={busy}>
        <UserPlus aria-hidden="true" /> Add to staff
      </Button>
    </form>
  );
}

function ChangeDialog({ account, data, onClose, onDone }: { account: StaffAccount; data: StaffAccounts; onClose: () => void; onDone: (m: string) => void }) {
  const [level, setLevel] = React.useState<"ADMIN" | "STAFF">(account.level === "ADMIN" ? "ADMIN" : "STAFF");
  const [areas, setAreas] = React.useState<string[]>(account.areas);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // Changing an admin, or making someone one, is the owner's: the same list the add form gets.
  const allowed = account.level === "ADMIN" && !data.can_add_levels.includes("ADMIN") ? [] : data.can_add_levels;
  const problem = level === "STAFF" && areas.length === 0 ? "Pick at least one area." : null;

  async function save() {
    if (problem) return;
    setBusy(true);
    setError(null);
    try {
      await changeStaffAccount(account.user_id, { level, areas: level === "STAFF" ? areas : [] });
      onDone(`${account.name}'s staff account is saved.`);
    } catch (err) {
      setError(problemOf(err, "The change couldn't be saved."));
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Change ${account.name}'s access`}
      description={account.email ?? undefined}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()} busy={busy} disabled={Boolean(problem)}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <LevelPicker value={level} onChange={setLevel} allowed={allowed} name={`sa-level-${account.user_id}`} />
        {level === "STAFF" ? <AreaPicker areas={data.areas} value={areas} onChange={setAreas} idBase={`sa-ch-${account.user_id}`} /> : null}
        {problem ? <p className="text-sm text-danger">{problem}</p> : null}
        {error ? <ErrorState title="Not saved" message={error} /> : null}
      </div>
    </Dialog>
  );
}

function RemoveDialog({ account, onClose, onDone }: { account: StaffAccount; onClose: () => void; onDone: (m: string) => void }) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await removeStaffAccount(account.user_id);
      onDone(`${account.name} is off the staff. Their fan account stays as it was.`);
    } catch (err) {
      setError(problemOf(err, "They couldn't be taken off."));
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Take ${account.name} off the staff?`}
      description="Their staff pages close at once. Their Corner Room account, purchases and library stay as they were."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Keep them
          </Button>
          <Button variant="danger" onClick={() => void remove()} busy={busy}>
            <UserMinus aria-hidden="true" /> Take off staff
          </Button>
        </>
      }
    >
      {error ? <ErrorState title="Not changed" message={error} /> : null}
    </Dialog>
  );
}

function AccountRow({ account, areas, now, onChange, onRemove }: { account: StaffAccount; areas: StaffArea[]; now: Date; onChange: () => void; onRemove: () => void }) {
  const labels = areaLabels(account.areas, areas);
  return (
    <li className="sa-row cr-cut">
      <PersonMark name={account.name} seed={account.user_id} src={account.picture_url} size="2.75rem" />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2">
          <span className="truncate font-semibold text-fg">{account.name}</span>
          {account.is_you ? <span className="st-badge">You</span> : null}
          <TonePill tone={LEVEL_TONE[account.level]}>{LEVEL_WORDS[account.level].label}</TonePill>
          {account.status !== "ACTIVE" ? <TonePill tone="warning">{account.status === "SUSPENDED" ? "Suspended" : account.status}</TonePill> : null}
        </p>
        <p className="truncate text-sm text-fg-muted">{account.email ?? "No email"}</p>
        {account.level === "STAFF" ? (
          <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label="Areas">
            {labels.map((label) => (
              <li key={label} className="sa-tag">
                {label}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-xs text-fg-muted">{LEVEL_WORDS[account.level].does}</p>
        )}
      </div>
      <div className="sa-row-side">
        <p className="text-xs text-fg-muted">
          {account.google_linked ? (
            <span className="inline-flex items-center gap-1">
              <CircleCheck aria-hidden="true" className="size-3.5 text-success" /> Google linked
            </span>
          ) : (
            <span className="inline-flex items-center gap-1">
              <Clock aria-hidden="true" className="size-3.5" /> Not signed in with Google yet
            </span>
          )}
        </p>
        <p className="text-xs text-fg-muted">
          <Link href={`/staff/activity?actor=${encodeURIComponent(account.user_id)}`} className="cr-focus underline">
            {account.actions_7d} {account.actions_7d === 1 ? "action" : "actions"} this week
          </Link>{" "}
          · {agoWords(account.last_active_at, now)}
        </p>
        {account.can_change ? (
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className="st-ghost cr-focus" onClick={onChange}>
              <UserRoundCog aria-hidden="true" className="size-3.5" /> Change
            </button>
            <button type="button" className="st-ghost cr-focus" onClick={onRemove}>
              <UserMinus aria-hidden="true" className="size-3.5" /> Take off
            </button>
          </div>
        ) : (
          <p className="mt-2 text-xs text-fg-muted">
            {account.is_you ? "Your own account" : account.level === "OWNER" ? "The owner's account" : "Only the owner changes admins"}
          </p>
        )}
      </div>
    </li>
  );
}

export function StaffAccountsPage() {
  const [data, setData] = React.useState<StaffAccounts | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState<AccountFilter>("all");
  const [query, setQuery] = React.useState("");
  const [changing, setChanging] = React.useState<StaffAccount | null>(null);
  const [removing, setRemoving] = React.useState<StaffAccount | null>(null);
  const now = useNow();

  const load = React.useCallback(async () => {
    try {
      setData(await fetchStaffAccounts());
      setError(null);
    } catch (err) {
      setError(problemOf(err, "Staff accounts couldn't be loaded."));
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  function done(message: string) {
    setChanging(null);
    setRemoving(null);
    setNotice(message);
    void load();
  }

  async function cancelInvite(id: string, email: string) {
    try {
      await cancelStaffInvite(id);
      done(`The invite for ${email} is cancelled.`);
    } catch (err) {
      setNotice(problemOf(err, "The invite couldn't be cancelled."));
    }
  }

  if (error && !data) return <ErrorState message={error} />;
  if (!data) return <LoadingState label="Loading staff accounts" />;

  const counts = levelCounts(data.accounts, data.invites);
  const accounts = filterAccounts(data.accounts, filter, query, data.areas);
  const invites = filter === "all" || filter === "waiting" ? filterInvites(data.invites, query) : [];
  const tiles: { id: AccountFilter; label: string; hint: string }[] = [
    { id: "all", label: "Everyone", hint: "On the staff now" },
    { id: "OWNER", label: "Owner", hint: "Adds and removes admins" },
    { id: "ADMIN", label: "Admins", hint: "The whole portal" },
    { id: "STAFF", label: "Staff", hint: "Chosen areas" },
    { id: "waiting", label: "Waiting to sign in", hint: "Invited by email" },
  ];

  return (
    <div className="cx space-y-6">
      <div className="st-pagehead">
        <div>
          <h1 className="st-h1">Staff accounts</h1>
          <p className="st-sub">Who works on Corner Room, what they can open, and who is still to sign in.</p>
        </div>
      </div>

      {notice ? (
        <p role="status" className="st-callout flex items-center gap-2 text-sm">
          <Mail aria-hidden="true" className="size-4 shrink-0" /> {notice}
        </p>
      ) : null}

      <div className="cx-tiles" style={{ "--cx-cols": 5 } as React.CSSProperties}>
        {tiles.map((t) => (
          <StatTile key={t.id} label={t.label} value={<span className="cr-num">{counts[t.id]}</span>} hint={t.hint} pressed={filter === t.id} onPress={() => setFilter(t.id)} />
        ))}
      </div>

      {data.can_add_levels.length > 0 ? <AddPerson data={data} onDone={done} /> : null}

      <section className="st-panel space-y-4" aria-labelledby="sa-list">
        <div className="st-panel-head">
          <h2 id="sa-list" className="st-h2">
            {filter === "waiting" ? "Waiting to sign in" : "On the staff"}
          </h2>
          <label className="sr-only" htmlFor="sa-search">
            Search staff
          </label>
          <Input id="sa-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name, email or area" className="max-w-xs" />
        </div>
        {filter !== "waiting" ? (
          accounts.length === 0 ? (
            <p className="st-sub">Nobody matches.</p>
          ) : (
            <ul className="space-y-2">
              {accounts.map((a) => (
                <AccountRow key={a.user_id} account={a} areas={data.areas} now={now} onChange={() => setChanging(a)} onRemove={() => setRemoving(a)} />
              ))}
            </ul>
          )
        ) : null}
        {invites.length > 0 ? (
          <div className="space-y-2">
            {filter !== "waiting" ? <h3 className="st-eyebrow">Invited, not signed in yet</h3> : null}
            <ul className="space-y-2">
              {invites.map((i) => (
                <li key={i.id} className="sa-row cr-cut" data-waiting>
                  <span className="cx-avatar cr-cut" aria-hidden="true">
                    <Mail className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-semibold text-fg">{i.email}</span>
                      <TonePill tone="warning">Waiting</TonePill>
                      <TonePill tone={LEVEL_TONE[i.level]}>{LEVEL_WORDS[i.level].label}</TonePill>
                    </p>
                    {i.level === "STAFF" ? <p className="text-sm text-fg-muted">{areaLabels(i.areas, data.areas).join(", ")}</p> : null}
                    {i.note ? <p className="text-xs text-fg-muted">“{i.note}”</p> : null}
                  </div>
                  <div className="sa-row-side">
                    <p className="text-xs text-fg-muted">
                      Invited {formatDate(i.invited_at)}
                      {i.invited_by ? ` by ${i.invited_by}` : ""}
                    </p>
                    {i.can_cancel ? (
                      <button type="button" className="st-ghost cr-focus mt-2" onClick={() => void cancelInvite(i.id, i.email)}>
                        Cancel invite
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : filter === "waiting" ? (
          <p className="st-sub">Nobody is waiting to sign in.</p>
        ) : null}
      </section>

      <section className="st-panel" aria-labelledby="sa-how">
        <h2 id="sa-how" className="st-h2">
          How staff sign in
        </h2>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-fg-muted">
          <li>Add them here with the email they use for Google. They get an email from Corner Room saying so.</li>
          <li>They open the staff sign-in page and choose Continue with Google with that address. A password works too: it is one account.</li>
          <li>If they already had a Corner Room fan account with that email, it simply gains staff access; purchases and library stay.</li>
          <li>Taking someone off closes their staff pages at once. Everything they did stays in Staff activity.</li>
        </ol>
      </section>

      {changing ? <ChangeDialog account={changing} data={data} onClose={() => setChanging(null)} onDone={done} /> : null}
      {removing ? <RemoveDialog account={removing} onClose={() => setRemoving(null)} onDone={done} /> : null}
    </div>
  );
}
