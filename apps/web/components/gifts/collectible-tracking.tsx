"use client";

/*
 * Collectible tracking for one gift campaign (owner, 2026-11-06, D-CAMPAIGN-03; made calmer
 * 2026-11-09, D-MAILBOX-01), for the artist and for Corner Room staff. One row of status chips with
 * their counts, a search over name, email, phone and address, and the list. Tick gifts and a bar
 * floats up with the moves the API allows (dispatch now or at a chosen time) and "Email them", which
 * opens the campaign's email writer with those people already picked. The API decides who may
 * update and which moves exist.
 */

import { useMemo, useState } from "react";
import { CalendarClock, CircleAlert, Mail, PackageCheck, Truck, UserPlus, X } from "lucide-react";

import { Button, DateTime, Input } from "@/components/ds";
import { AddPeople } from "@/components/gifts/add-people";
import { WaitingPeople } from "@/components/gifts/waiting-people";
import { Check, FilterChips, NoMatch, SearchField, SelectionBar, StatusMark, type ChipOption } from "@/components/studio-kit";
import { removeGiftPerson, trackGifts, type GiftCampaignDetail, type GiftMove, type GiftRecipientStatus } from "@/features/gifts/api";
import { ApiError } from "@/lib/api/client";
import { fromLocalInput, toLocalInput } from "@/lib/artist-mail-view";
import type { StatusTone } from "@/lib/format/status";
import { isLater, MOVE_LABEL, MOVE_TELLS_BUYER, movesFor, RECIPIENT_STATUS_LABEL, RECIPIENT_STATUSES, trackedSince } from "@/lib/gifts-view";
import { searchList, shownCount } from "@/lib/list-search-view";

const TONE: Record<GiftRecipientStatus, StatusTone> = {
  YET_TO_SEND: "neutral",
  PREPARED: "accent",
  DISPATCHED: "info",
  RECEIVED: "positive",
  RETURNED: "warning",
  MISSING: "negative",
};

type Filter = GiftRecipientStatus | "ALL";

export function CollectibleTracking({
  c,
  onChange,
  onEmail,
}: {
  c: GiftCampaignDetail;
  onChange: (next: GiftCampaignDetail) => void;
  /** Open the email writer with these people picked (the campaign page's Emails part). */
  onEmail?: (recipientIds: string[]) => void;
}) {
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<Filter>("ALL");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [later, setLater] = useState(false);
  const [when, setWhen] = useState("");
  const [adding, setAdding] = useState(false);

  const byStatus = useMemo(() => (filter === "ALL" ? c.recipients : c.recipients.filter((r) => r.status === filter)), [c.recipients, filter]);
  const shown = useMemo(
    () => searchList(byStatus, query, (r) => [r.name, r.email, r.phone, r.address]),
    [byStatus, query],
  );
  const moves = movesFor(c.recipients, chosen, c.transitions);
  const whenIso = later ? fromLocalInput(when) : null;
  const whenOk = !later || isLater(whenIso, new Date());
  const tells = moves.map((m) => MOVE_TELLS_BUYER[m.to]).filter(Boolean);
  const shownIds = shown.map((r) => r.id);
  const allShownChosen = shownIds.length > 0 && shownIds.every((id) => chosen.has(id));
  const someShownChosen = shownIds.some((id) => chosen.has(id));
  const chosenIds = c.recipients.filter((r) => chosen.has(r.id)).map((r) => r.id);

  const chips: ChipOption<Filter>[] = [
    { key: "ALL", label: "Everyone", count: c.counts.TOTAL },
    ...RECIPIENT_STATUSES.map((s) => ({ key: s as Filter, label: RECIPIENT_STATUS_LABEL[s], count: c.counts[s] ?? 0, dot: TONE[s] })),
  ];

  async function run(key: string, move: GiftMove, done: (n: number) => string, call?: () => Promise<GiftCampaignDetail>) {
    setBusy(key);
    setMessage(null);
    try {
      const next = await (call ? call() : trackGifts(c.id, move));
      onChange(next);
      setChosen(new Set());
      if (call) {
        setMessage({ ok: true, text: "Taken off the list." });
        return;
      }
      const skipped = next.skipped ?? 0;
      setMessage({
        ok: true,
        text: `${done(next.moved ?? 0)}${skipped ? ` ${skipped} couldn't make that move and stayed as they were.` : ""}`,
      });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof ApiError ? err.message : "That didn't go through. Please try again." });
    } finally {
      setBusy(null);
    }
  }

  const pick = (rid: string) => setChosen((s) => (s.has(rid) ? new Set([...s].filter((x) => x !== rid)) : new Set([...s, rid])));
  const plural = (n: number) => `${n} ${n === 1 ? "gift" : "gifts"}`;

  return (
    <section aria-labelledby="tracking-title" className={`grid gap-5 ${c.can_dispatch && chosen.size > 0 ? "pb-48" : ""}`}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="sk-kicker">Collectibles</p>
          <h3 id="tracking-title" className="mt-1 text-xl font-bold text-fg">
            Where every gift is
          </h3>
          <p className="mt-1 max-w-2xl text-sm text-fg-muted">
            {c.can_dispatch
              ? "Tick gifts to move them along. Dispatched, Returned and Missing email the buyer by themselves."
              : "Corner Room's team sends these gifts and keeps this list up to date."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {c.can_add ? (
            <Button size="sm" variant={adding ? "secondary" : "ghost"} onClick={() => setAdding((v) => !v)} aria-expanded={adding}>
              {adding ? <X aria-hidden="true" /> : <UserPlus aria-hidden="true" />} {adding ? "Close adding" : "Add people"}
            </Button>
          ) : null}
          {c.can_dispatch && c.counts.YET_TO_SEND > 0 ? (
            <Button
              size="sm"
              className="sk-gloss cr-cut"
              busy={busy === "all"}
              onClick={() => void run("all", { to: "PREPARED", every: "YET_TO_SEND" }, (n) => `${plural(n)} marked prepared.`)}
            >
              <PackageCheck aria-hidden="true" /> Mark all {c.counts.YET_TO_SEND} not prepared as prepared
            </Button>
          ) : null}
        </div>
      </div>

      {adding ? (
        <div className="sk-appear">
          <AddPeople c={c} onChange={onChange} onClose={() => setAdding(false)} />
        </div>
      ) : null}
      <WaitingPeople c={c} onChange={onChange} />

      <div className="grid gap-3">
        <FilterChips<Filter> label="Show gifts by status" options={chips} value={filter} onChange={(f) => setFilter(f)} />
        <div className="flex flex-wrap items-center gap-3">
          <SearchField
            className="min-w-[14rem] flex-1"
            value={query}
            onChange={setQuery}
            label="Search buyers"
            placeholder={c.shows_contact ? "Search by name, email, phone or address" : "Search by name"}
            shortcut
          />
          <span className="text-sm text-fg-muted" aria-live="polite">
            {shownCount(shown.length, c.recipients.length)} {c.recipients.length === 1 ? "gift" : "gifts"}
          </span>
        </div>
      </div>

      {message ? (
        <p role={message.ok ? "status" : "alert"} className="gm-banner" data-tone={message.ok ? "success" : "problem"}>
          {message.ok ? null : <CircleAlert aria-hidden="true" className="size-4" />} {message.text}
        </p>
      ) : null}

      {c.recipients.length === 0 ? (
        <p className="text-sm text-fg">No one has earned this gift yet. Buyers appear here once their payment is confirmed.</p>
      ) : shown.length === 0 ? (
        query ? (
          <NoMatch query={query} onClear={() => setQuery("")} />
        ) : (
          <p className="text-sm text-fg">No gifts are {filter !== "ALL" ? RECIPIENT_STATUS_LABEL[filter].toLowerCase() : "here"} right now.</p>
        )
      ) : (
        <div className="overflow-x-auto">
          <table className="sk-table min-w-[44rem]">
            <thead>
              <tr>
                {c.can_dispatch ? (
                  <th className="w-10">
                    <Check
                      label={filter !== "ALL" ? `Choose everyone ${RECIPIENT_STATUS_LABEL[filter].toLowerCase()}` : "Choose everyone"}
                      checked={allShownChosen}
                      indeterminate={someShownChosen}
                      onChange={(on) =>
                        setChosen((s) => (on ? new Set([...s, ...shownIds]) : new Set([...s].filter((id) => !shownIds.includes(id)))))
                      }
                    />
                  </th>
                ) : null}
                <th>Buyer</th>
                {c.shows_contact ? <th>Phone</th> : null}
                {c.shows_contact ? <th>Address</th> : null}
                <th>Gift</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const i = c.recipients.indexOf(r);
                const since = trackedSince(r);
                return (
                  <tr key={r.id} data-chosen={chosen.has(r.id)} onClick={c.can_dispatch ? (e) => {
                    if ((e.target as HTMLElement).closest("button,input,a")) return;
                    pick(r.id);
                  } : undefined}>
                    {c.can_dispatch ? (
                      <td>
                        <Check label={`Choose ${r.name ?? `buyer ${i + 1}`}`} checked={chosen.has(r.id)} onChange={() => pick(r.id)} />
                      </td>
                    ) : null}
                    <td className="text-fg">
                      <span className="font-semibold">{r.name ?? (c.shows_contact ? "No name given" : `Buyer ${i + 1}`)}</span>
                      {r.email ? <span className="block text-xs text-fg-muted">{r.email}</span> : null}
                      {r.source === "ADDED" ? (
                        <span className="block text-xs text-fg-muted">Added by hand{r.has_account ? ", has an account" : ""}</span>
                      ) : !r.has_account ? (
                        <span className="block text-xs text-fg-muted">Pre-sale, no account yet</span>
                      ) : null}
                      {c.can_review && r.source === "ADDED" && r.status === "YET_TO_SEND" ? (
                        <button
                          type="button"
                          className="cr-focus mt-1 text-xs font-semibold text-link underline"
                          onClick={() => void run(`remove-${r.id}`, { to: "YET_TO_SEND" } as GiftMove, () => "", () => removeGiftPerson(c.id, r.id))}
                        >
                          Take back
                        </button>
                      ) : null}
                    </td>
                    {c.shows_contact ? <td className="text-fg">{r.phone ?? <span className="text-fg-muted">None</span>}</td> : null}
                    {c.shows_contact ? <td className="max-w-72 text-fg">{r.address ?? <span className="text-fg-muted">None</span>}</td> : null}
                    <td>
                      <StatusMark tone={TONE[r.status] ?? "neutral"}>{RECIPIENT_STATUS_LABEL[r.status] ?? r.status}</StatusMark>
                      {r.status === "PREPARED" && r.dispatch_at ? <span className="block text-xs font-normal text-fg-muted">Set to leave later</span> : null}
                    </td>
                    <td className="text-fg-muted">
                      {since ? (
                        <>
                          {since.label}{" "}
                          {since.label === "Leaves" ? (
                            <DateTime value={since.at} timeZone="Asia/Dhaka" format="datetime" showZone />
                          ) : (
                            <DateTime value={since.at} timeZone="Asia/Dhaka" format="date" />
                          )}
                        </>
                      ) : (
                        "Not yet"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {c.can_dispatch && chosen.size > 0 ? (
        <SelectionBar label="Update chosen gifts">
          <div className="grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-fg">
                {chosen.size} chosen{moves.length ? "" : ". These gifts can't move from where they are."}
              </p>
              <button type="button" className="cr-focus text-sm font-semibold text-fg-muted hover:text-fg" onClick={() => setChosen(new Set())}>
                Clear
              </button>
            </div>
            {moves.some((m) => m.to === "DISPATCHED") ? (
              <fieldset>
                <legend className="flex items-center gap-2 text-[0.8125rem] font-semibold text-fg">
                  <CalendarClock aria-hidden="true" className="size-4 text-highlight" /> When they leave
                </legend>
                <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-fg">
                  <label className="flex items-center gap-2">
                    <input type="radio" name={`dispatch-when-${c.id}`} checked={!later} onChange={() => setLater(false)} />
                    Now
                  </label>
                  <label className="flex flex-wrap items-center gap-2">
                    <input type="radio" name={`dispatch-when-${c.id}`} checked={later} onChange={() => setLater(true)} />
                    At a time I choose (Bangladesh time)
                    {later ? (
                      <Input
                        type="datetime-local"
                        className="h-9 w-auto"
                        value={when}
                        min={toLocalInput(new Date().toISOString())}
                        onChange={(e) => setWhen(e.target.value)}
                        aria-label="Dispatch at"
                      />
                    ) : null}
                  </label>
                  {later && when && !whenOk ? <p className="text-sm text-danger">Choose a time that is still to come.</p> : null}
                </div>
              </fieldset>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {moves.map((m) => {
                const dispatch = m.to === "DISPATCHED";
                const label = dispatch && later ? `Schedule ${m.ids.length} to leave then` : `${MOVE_LABEL[m.to]} ${m.ids.length}`;
                return (
                  <Button
                    key={m.to}
                    size="sm"
                    variant={dispatch ? "primary" : "secondary"}
                    className={dispatch ? "sk-gloss cr-cut" : undefined}
                    busy={busy === m.to}
                    disabled={dispatch && !whenOk}
                    onClick={() =>
                      void run(
                        m.to,
                        { to: m.to, recipient_ids: m.ids, ...(dispatch && whenIso ? { dispatch_at: whenIso } : {}) },
                        (n) =>
                          dispatch && whenIso
                            ? `${plural(n)} set to leave at the time you chose.`
                            : `${plural(n)} marked ${RECIPIENT_STATUS_LABEL[m.to].toLowerCase()}.`,
                      )
                    }
                  >
                    {dispatch ? <Truck aria-hidden="true" /> : null} {label}
                  </Button>
                );
              })}
              {onEmail ? (
                <Button size="sm" variant="ghost" onClick={() => onEmail(chosenIds)}>
                  <Mail aria-hidden="true" /> Email {chosenIds.length === 1 ? "them" : `these ${chosenIds.length}`}
                </Button>
              ) : null}
            </div>
            {tells.length ? (
              <ul className="grid gap-1 text-xs text-fg-muted">
                {tells.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            ) : null}
          </div>
        </SelectionBar>
      ) : null}
    </section>
  );
}
