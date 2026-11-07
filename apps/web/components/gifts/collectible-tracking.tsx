"use client";

/*
 * Collectible tracking for one gift campaign (owner, 2026-11-06, D-CAMPAIGN-03), for the artist and
 * for Corner Room staff: how many are not prepared, prepared, dispatched, received, returned and
 * missing; "Mark all prepared" in one click; and, for chosen buyers, the moves the API allows
 * (dispatching now or at a chosen time). The API decides who may update and which moves exist.
 */

import { useMemo, useState } from "react";
import { CalendarClock, CircleAlert, PackageCheck, Truck } from "lucide-react";

import { Button, Card, DateTime, Input } from "@/components/ds";
import { AddPeople } from "@/components/gifts/add-people";
import { WaitingPeople } from "@/components/gifts/waiting-people";
import { removeGiftPerson, trackGifts, type GiftCampaignDetail, type GiftMove, type GiftRecipientStatus } from "@/features/gifts/api";
import { ApiError } from "@/lib/api/client";
import { fromLocalInput, toLocalInput } from "@/lib/artist-mail-view";
import { isLater, MOVE_LABEL, MOVE_TELLS_BUYER, movesFor, RECIPIENT_STATUS_LABEL, RECIPIENT_STATUSES, trackedSince } from "@/lib/gifts-view";

function Tiles({ c, filter, onFilter }: { c: GiftCampaignDetail; filter: GiftRecipientStatus | null; onFilter: (s: GiftRecipientStatus | null) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-4 lg:grid-cols-7" role="group" aria-label="Show buyers by status">
      <button type="button" aria-pressed={filter === null} onClick={() => onFilter(null)} className="cr-focus text-left">
        <Card className={`h-full p-4 ${filter === null ? "ring-2 ring-highlight" : ""}`}>
          <span className="block text-sm text-fg-muted">Everyone who earned it</span>
          <span className="cr-num mt-1 block text-3xl font-bold text-fg">{c.counts.TOTAL}</span>
        </Card>
      </button>
      {RECIPIENT_STATUSES.map((s) => (
        <button key={s} type="button" aria-pressed={filter === s} onClick={() => onFilter(filter === s ? null : s)} className="cr-focus text-left">
          <Card className={`h-full p-4 ${filter === s ? "ring-2 ring-highlight" : ""}`}>
            <span className="block text-sm text-fg-muted">{RECIPIENT_STATUS_LABEL[s]}</span>
            <span className="cr-num mt-1 block text-3xl font-bold text-fg">{c.counts[s] ?? 0}</span>
            {s === "PREPARED" && c.counts.SCHEDULED ? (
              <span className="mt-1 block text-xs text-fg-muted">{c.counts.SCHEDULED} set to leave later</span>
            ) : null}
          </Card>
        </button>
      ))}
    </div>
  );
}

export function CollectibleTracking({ c, onChange }: { c: GiftCampaignDetail; onChange: (next: GiftCampaignDetail) => void }) {
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<GiftRecipientStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [later, setLater] = useState(false);
  const [when, setWhen] = useState("");

  const shown = useMemo(() => (filter ? c.recipients.filter((r) => r.status === filter) : c.recipients), [c.recipients, filter]);
  const moves = movesFor(c.recipients, chosen, c.transitions);
  const whenIso = later ? fromLocalInput(when) : null;
  const whenOk = !later || isLater(whenIso, new Date());
  const tells = moves.map((m) => MOVE_TELLS_BUYER[m.to]).filter(Boolean);
  const shownIds = shown.map((r) => r.id);
  const allShownChosen = shownIds.length > 0 && shownIds.every((id) => chosen.has(id));

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
    <section aria-labelledby="tracking-title" className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 id="tracking-title" className="text-lg font-bold text-fg">
            Collectible tracking
          </h3>
          <p className="mt-1 text-sm text-fg-muted">
            {c.can_dispatch
              ? "Mark each gift as you go: prepared, dispatched, then received, returned or missing."
              : "Corner Room's team sends these gifts and keeps this list up to date."}
          </p>
        </div>
        {c.can_dispatch && c.counts.YET_TO_SEND > 0 ? (
          <Button
            size="sm"
            busy={busy === "all"}
            onClick={() =>
              void run("all", { to: "PREPARED", every: "YET_TO_SEND" }, (n) => `${plural(n)} marked prepared.`)
            }
          >
            <PackageCheck aria-hidden="true" /> Mark all {c.counts.YET_TO_SEND} not prepared as prepared
          </Button>
        ) : null}
      </div>

      <Tiles c={c} filter={filter} onFilter={(s) => setFilter(s)} />

      {/* Buyers Corner Room doesn't know about (D-CAMPAIGN-04), and the act's additions waiting for staff. */}
      <AddPeople c={c} onChange={onChange} />
      <WaitingPeople c={c} onChange={onChange} />

      {c.can_dispatch && chosen.size > 0 ? (
        <Card className="grid gap-3 p-4" aria-label="Update chosen gifts">
          <p className="text-sm font-semibold text-fg">
            {chosen.size} chosen. {moves.length ? "What happened to them?" : "These gifts can't move from where they are."}
          </p>
          {moves.some((m) => m.to === "DISPATCHED") ? (
            <fieldset>
              <legend className="flex items-center gap-2 text-[0.8125rem] font-semibold text-fg">
                <CalendarClock aria-hidden="true" className="size-4 text-highlight" /> When they leave
              </legend>
              <div className="mt-2 grid gap-2 text-sm text-fg">
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
                      className="w-auto"
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
          </div>
          {tells.length ? (
            <ul className="grid gap-1 text-sm text-fg-muted">
              {tells.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          ) : null}
        </Card>
      ) : null}

      {message ? (
        <p role={message.ok ? "status" : "alert"} className={`flex items-center gap-2 text-sm ${message.ok ? "text-fg" : "text-danger"}`}>
          {message.ok ? null : <CircleAlert aria-hidden="true" className="size-4" />} {message.text}
        </p>
      ) : null}

      {c.recipients.length === 0 ? (
        <p className="text-sm text-fg">No one has earned this gift yet. Buyers appear here once their payment is confirmed.</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-fg">No gifts are {filter ? RECIPIENT_STATUS_LABEL[filter].toLowerCase() : "here"} right now.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[44rem] text-left text-sm">
            <thead className="text-xs text-fg-muted">
              <tr className="border-b border-line">
                {c.can_dispatch ? (
                  <th className="py-2 pr-3">
                    <input
                      type="checkbox"
                      aria-label={filter ? `Choose everyone ${RECIPIENT_STATUS_LABEL[filter].toLowerCase()}` : "Choose everyone"}
                      checked={allShownChosen}
                      onChange={(e) =>
                        setChosen((s) => (e.target.checked ? new Set([...s, ...shownIds]) : new Set([...s].filter((id) => !shownIds.includes(id)))))
                      }
                    />
                  </th>
                ) : null}
                <th className="py-2 pr-3 font-semibold">Buyer</th>
                {c.shows_contact ? <th className="py-2 pr-3 font-semibold">Phone</th> : null}
                {c.shows_contact ? <th className="py-2 pr-3 font-semibold">Address</th> : null}
                <th className="py-2 pr-3 font-semibold">Gift</th>
                <th className="py-2 font-semibold">When</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const i = c.recipients.indexOf(r);
                const since = trackedSince(r);
                return (
                  <tr key={r.id} className="border-b border-line align-top">
                    {c.can_dispatch ? (
                      <td className="py-2 pr-3">
                        <input type="checkbox" aria-label={`Choose ${r.name ?? `buyer ${i + 1}`}`} checked={chosen.has(r.id)} onChange={() => pick(r.id)} />
                      </td>
                    ) : null}
                    <td className="py-2 pr-3 text-fg">
                      {r.name ?? (c.shows_contact ? "No name given" : `Buyer ${i + 1}`)}
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
                    {c.shows_contact ? <td className="py-2 pr-3 text-fg">{r.phone ?? <span className="text-fg-muted">None</span>}</td> : null}
                    {c.shows_contact ? <td className="max-w-72 py-2 pr-3 text-fg">{r.address ?? <span className="text-fg-muted">None</span>}</td> : null}
                    <td className="py-2 pr-3 font-semibold text-fg">
                      {RECIPIENT_STATUS_LABEL[r.status] ?? r.status}
                      {r.status === "PREPARED" && r.dispatch_at ? <span className="block text-xs font-normal text-fg-muted">Set to leave later</span> : null}
                    </td>
                    <td className="py-2 text-fg-muted">
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
    </section>
  );
}
