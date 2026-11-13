"use client";

/* Staff release workspace: what needs you now (owner, 2026-11-13, D-RELEASE-PLAN-01). One card says
 * where the release and its pre-sale stand and shows only the steps the API allows right now
 * (`plan.staff_actions`), with the main one first. Rare or risky steps (takedowns, cancelling a
 * pre-sale, moving a pre-sale date, back to pre-sale) sit under More actions. Every time is Dhaka
 * time. The API checks who may do what. */

import { useState } from "react";
import { CalendarClock, CircleAlert, CircleCheck, Clock, Rocket, Send, Undo2 } from "lucide-react";

import { Button, Card, Field, Input, Money } from "@/components/ds";
import { Textarea } from "@/components/ds/input";
import { Dialog } from "@/components/ds/dialog";
import {
  backToPresale,
  cancelPresale,
  reviewPresale,
  reviewRelease,
  type StudioReleaseDetail,
} from "@/features/studio/api";
import { ApiError } from "@/lib/api/client";
import { fromLocalInput, toLocalInput } from "@/lib/artist-mail-view";
import { friendlyError } from "@/lib/error-copy";
import { can, dhaka, staffHeadline } from "@/lib/release-plan-view";
import { cn } from "@/lib/utils";

/** The review routes explain a refusal in plain words; show them instead of a generic line. */
export function reviewError(err: unknown, fallback: string): string {
  if (err instanceof ApiError && ["INVALID_TRANSITION", "VALIDATION_ERROR", "VERSION_NOT_READY"].includes(err.code) && err.problem.title) {
    return err.problem.title.endsWith(".") ? err.problem.title : `${err.problem.title}.`;
  }
  return friendlyError(err, fallback);
}

type Confirm = { title: string; text: string; cta: string; danger?: boolean; go: () => Promise<string> };

function useRunner(onDone: () => void) {
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  async function run(key: string, fn: () => Promise<string>) {
    setBusy(key);
    setError(null);
    setResult(null);
    try {
      setResult(await fn());
      onDone();
      return true;
    } catch (err) {
      setError(reviewError(err, "That didn't go through. Refresh the page to see where things stand."));
      return false;
    } finally {
      setBusy(null);
    }
  }
  return { busy, result, error, confirm, setConfirm, setError, run };
}

function Outcome({ result, error }: { result: string | null; error: string | null }) {
  return (
    <>
      {result ? (
        <p role="status" className="mt-4 flex items-start gap-2 text-sm font-semibold text-success">
          <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0" /> {result}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-4 flex items-start gap-2 text-sm text-danger">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" /> {error}
        </p>
      ) : null}
    </>
  );
}

function ConfirmDialog({ confirm, busy, onClose, onGo }: { confirm: Confirm | null; busy: boolean; onClose: () => void; onGo: () => void }) {
  return (
    <Dialog
      open={confirm !== null}
      onClose={onClose}
      title={confirm?.title ?? ""}
      description={confirm?.text}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Not now
          </Button>
          <Button variant={confirm?.danger ? "danger" : "primary"} busy={busy} onClick={onGo}>
            {confirm?.cta}
          </Button>
        </>
      }
    />
  );
}

/** A date and time field read as Dhaka time (D-TIME-01). */
function DhakaDate({ id, label, value, onChange, hint }: { id?: string; label: string; value: string; onChange: (v: string) => void; hint?: string }) {
  return (
    <Field label={label} hint={hint ?? "Dhaka time"} className="min-w-56">
      {(c) => <Input {...c} id={id ?? c.id} type="datetime-local" value={value} onChange={(e) => onChange(e.target.value)} />}
    </Field>
  );
}

function NoteBox({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <Field label={label} hint="The artist sees this note.">
      {(c) => <Textarea {...c} value={value} onChange={(e) => onChange(e.target.value)} rows={3} maxLength={2000} />}
    </Field>
  );
}

const HEAD_TONE = {
  action: { icon: CalendarClock, cls: "text-highlight", bar: "bg-highlight" },
  wait: { icon: Clock, cls: "text-info", bar: "bg-info" },
  good: { icon: CircleCheck, cls: "text-success", bar: "bg-success" },
  problem: { icon: CircleAlert, cls: "text-danger", bar: "bg-danger" },
} as const;

/** The pre-sale an artist sent: approve its title, artist, date and price going public, or send it back. */
function PresaleRequest({ detail, r }: { detail: StudioReleaseDetail; r: ReturnType<typeof useRunner> }) {
  const p = detail.presale!;
  const [when, setWhen] = useState(toLocalInput(p.requested_release_at ?? p.release_at ?? null));
  const [returning, setReturning] = useState(false);
  const [note, setNote] = useState("");
  return (
    <section aria-labelledby="presale-request" className="border-t border-line pt-5">
      <h3 id="presale-request" className="text-base font-bold text-fg">
        Pre-sale
      </h3>
      <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-fg-muted">Fans would see</dt>
          <dd className="font-semibold text-fg">
            {detail.release.title} · {detail.profile.display_name}
          </dd>
        </div>
        <div>
          <dt className="text-fg-muted">Date asked for</dt>
          <dd className="font-semibold text-fg">{dhaka(p.requested_release_at)} (Dhaka time)</dd>
        </div>
        <div>
          <dt className="text-fg-muted">Pre-sale price</dt>
          <dd className="font-semibold text-fg">
            {p.price ? (
              <>
                <Money value={{ amount_minor: p.price.amount_minor, currency_code: p.price.currency_code }} />{" "}
                <span className="font-normal text-fg-muted">
                  {p.price.status === "ACCEPTED" ? "(agreed)" : "(not agreed yet: commerce agrees it in Price proposals before fans can pay)"}
                </span>
              </>
            ) : (
              "None"
            )}
          </dd>
        </div>
      </dl>
      <p className="mt-3 text-sm text-fg-muted">
        Fans then pay now and get the music on release day. The music itself is checked later, on its own. Once you approve the music, it
        goes out by itself on this date.
      </p>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <DhakaDate id="presale-at" label="Release date" value={when} onChange={setWhen} hint="Dhaka time. Change it here if needed." />
        <Button
          busy={r.busy === "presale_approve"}
          disabled={r.busy !== null || !when}
          onClick={() =>
            void r.run("presale_approve", async () => {
              await reviewPresale(detail.release.id, { decision: "approve", release_at: fromLocalInput(when) });
              return "Pre-sale approved. Fans can pre-book once the price is agreed.";
            })
          }
        >
          <CircleCheck aria-hidden="true" /> Approve pre-sale
        </Button>
        {can(detail.plan, "presale_return") && !returning ? (
          <Button variant="secondary" disabled={r.busy !== null} onClick={() => setReturning(true)}>
            <Undo2 aria-hidden="true" /> Send back
          </Button>
        ) : null}
      </div>
      {returning ? (
        <div className="mt-4 grid gap-3">
          <NoteBox label="What should the artist change?" value={note} onChange={setNote} />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              busy={r.busy === "presale_return"}
              disabled={r.busy !== null || !note.trim()}
              onClick={() =>
                void r.run("presale_return", async () => {
                  await reviewPresale(detail.release.id, { decision: "return", note: note.trim() });
                  return "Sent back to the artist with your note.";
                })
              }
            >
              <Send aria-hidden="true" /> Send back to the artist
            </Button>
            <Button variant="ghost" onClick={() => setReturning(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

/** The music sent in for review: approve it (scheduling it when a date is known) or send it back. */
function MusicReview({ detail, r }: { detail: StudioReleaseDetail; r: ReturnType<typeof useRunner> }) {
  const plan = detail.plan!;
  const id = detail.release.id;
  const [otherDate, setOtherDate] = useState(false);
  const [when, setWhen] = useState("");
  const [returning, setReturning] = useState(false);
  const [note, setNote] = useState("");
  const songs = detail.tracks.length;
  const ready = detail.tracks.filter((t) => t.audio.some((a) => a.is_current && a.status === "READY")).length;

  const approve = (releaseAt: string | null, words: string) =>
    r.run("approve", async () => {
      const out = await reviewRelease(id, "approve", undefined, releaseAt ?? undefined);
      return out.status === "SCHEDULED" ? `${words} It goes out by itself on ${dhaka(out.release_at)}.` : words;
    });

  return (
    <section aria-labelledby="music-review" className="border-t border-line pt-5">
      <h3 id="music-review" className="text-base font-bold text-fg">
        The music
      </h3>
      <p className="mt-2 text-sm text-fg">
        {songs} {songs === 1 ? "song" : "songs"}, {ready} with checked audio. Look through the release below before you decide.
      </p>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        {plan.approve_schedules_for && !otherDate ? (
          <>
            <Button busy={r.busy === "approve"} disabled={r.busy !== null} onClick={() => void approve(null, "Approved.")}>
              <CircleCheck aria-hidden="true" /> Approve · out {dhaka(plan.approve_schedules_for)}
            </Button>
            <Button variant="ghost" disabled={r.busy !== null} onClick={() => setOtherDate(true)}>
              Use another date
            </Button>
          </>
        ) : plan.date_passed && !otherDate ? (
          <>
            <Button
              disabled={r.busy !== null}
              onClick={() =>
                r.setConfirm({
                  title: "Approve and release now?",
                  text: "The music goes live for everyone right away. Everyone who pre-ordered is emailed that it's out, with the artist's release-day email if it was approved.",
                  cta: "Approve and release now",
                  go: async () => {
                    await reviewRelease(id, "approve");
                    await reviewRelease(id, "release");
                    return "Approved and released. Buyers are being emailed.";
                  },
                })
              }
            >
              <Rocket aria-hidden="true" /> Approve and release now
            </Button>
            <Button variant="secondary" disabled={r.busy !== null} onClick={() => setOtherDate(true)}>
              <CalendarClock aria-hidden="true" /> Approve with a new date
            </Button>
          </>
        ) : (
          <>
            <DhakaDate
              label={plan.approve_schedules_for || plan.date_passed ? "New release date" : "Release date (optional)"}
              value={when}
              onChange={setWhen}
              hint={plan.release_day_kind === "SET" ? "Dhaka time. Everyone who pre-ordered is emailed the new date." : "Dhaka time. Leave empty to set it later."}
            />
            <Button
              busy={r.busy === "approve"}
              disabled={r.busy !== null || ((plan.approve_schedules_for || plan.date_passed) && !when) || false}
              onClick={() => void approve(when ? fromLocalInput(when) : null, when ? "Approved and scheduled." : "Approved. Schedule it when you know the date.")}
            >
              <CircleCheck aria-hidden="true" /> {when ? "Approve and schedule" : "Approve"}
            </Button>
            {otherDate ? (
              <Button variant="ghost" onClick={() => setOtherDate(false)}>
                Back
              </Button>
            ) : null}
          </>
        )}
        {can(plan, "request_changes") && !returning ? (
          <Button variant="secondary" disabled={r.busy !== null} onClick={() => setReturning(true)}>
            <Undo2 aria-hidden="true" /> Send back for changes
          </Button>
        ) : null}
      </div>
      {returning ? <SendBack id={id} r={r} note={note} setNote={setNote} onCancel={() => setReturning(false)} /> : null}
    </section>
  );
}

function SendBack({ id, r, note, setNote, onCancel }: { id: string; r: ReturnType<typeof useRunner>; note: string; setNote: (v: string) => void; onCancel: () => void }) {
  return (
    <div className="mt-4 grid gap-3">
      <NoteBox label="What should the artist change?" value={note} onChange={setNote} />
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          busy={r.busy === "request_changes"}
          disabled={r.busy !== null || !note.trim()}
          onClick={() =>
            void r.run("request_changes", async () => {
              await reviewRelease(id, "request_changes", note.trim());
              return "Sent back to the artist with your note.";
            })
          }
        >
          <Send aria-hidden="true" /> Send back to the artist
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** Approved or scheduled music: schedule it, move its date, or release it now. */
function ReleaseDay({ detail, r }: { detail: StudioReleaseDetail; r: ReturnType<typeof useRunner> }) {
  const plan = detail.plan!;
  const id = detail.release.id;
  const scheduled = plan.stage === "SCHEDULED" || plan.stage === "OVERDUE";
  const [moving, setMoving] = useState(!scheduled);
  const [when, setWhen] = useState(scheduled ? toLocalInput(plan.release_day ?? null) : "");
  const [returning, setReturning] = useState(false);
  const [note, setNote] = useState("");
  const hasBuyers = Boolean(detail.presale?.listed || detail.presale?.status === "APPROVED");
  const releaseNow = () =>
    r.setConfirm({
      title: "Release now?",
      text: hasBuyers
        ? "The music goes live for everyone right away. Pre-orders close and everyone who pre-ordered is emailed that it's out."
        : "The music goes live for everyone right away.",
      cta: "Release now",
      go: async () => {
        await reviewRelease(id, "release");
        return "Released. It's live now.";
      },
    });
  const urgent = plan.stage === "APPROVED_DATE_PASSED" || plan.stage === "OVERDUE";

  return (
    <section aria-labelledby="release-day" className="border-t border-line pt-5">
      <h3 id="release-day" className="text-base font-bold text-fg">
        Release day
      </h3>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        {urgent ? (
          <Button disabled={r.busy !== null} onClick={releaseNow}>
            <Rocket aria-hidden="true" /> Release now
          </Button>
        ) : null}
        {moving ? (
          <>
            <DhakaDate
              id="release-at"
              label={scheduled ? "New release date" : "Release date"}
              value={when}
              onChange={setWhen}
              hint={hasBuyers ? "Dhaka time. Everyone who pre-ordered is emailed the new date." : "Dhaka time. It goes out by itself then."}
            />
            <Button
              variant={urgent ? "secondary" : "primary"}
              busy={r.busy === "schedule"}
              disabled={r.busy !== null || !when}
              onClick={() =>
                void r.run("schedule", async () => {
                  const out = await reviewRelease(id, "schedule", undefined, fromLocalInput(when) ?? undefined);
                  return `Scheduled. It goes out by itself on ${dhaka(out.release_at)}.`;
                })
              }
            >
              <CalendarClock aria-hidden="true" /> {scheduled ? "Move the date" : "Schedule"}
            </Button>
            {scheduled ? (
              <Button variant="ghost" onClick={() => setMoving(false)}>
                Cancel
              </Button>
            ) : null}
          </>
        ) : (
          <Button variant="secondary" disabled={r.busy !== null} onClick={() => setMoving(true)}>
            <CalendarClock aria-hidden="true" /> Move the date
          </Button>
        )}
        {!urgent && can(plan, "release") ? (
          <Button variant="ghost" disabled={r.busy !== null} onClick={releaseNow}>
            <Rocket aria-hidden="true" /> {scheduled ? "Release early" : "Release now"}
          </Button>
        ) : null}
        {can(plan, "request_changes") && !returning ? (
          <Button variant="ghost" disabled={r.busy !== null} onClick={() => setReturning(true)}>
            <Undo2 aria-hidden="true" /> Send back for changes
          </Button>
        ) : null}
      </div>
      {returning ? <SendBack id={id} r={r} note={note} setNote={setNote} onCancel={() => setReturning(false)} /> : null}
    </section>
  );
}

export function ReleaseDecision({ detail, onDone }: { detail: StudioReleaseDetail; onDone: () => void }) {
  const r = useRunner(onDone);
  const plan = detail.plan;
  if (!plan) return null;
  const head = staffHeadline(detail);
  const tone = HEAD_TONE[head.tone];
  const Icon = tone.icon;
  const showRelease = can(plan, "schedule") || (can(plan, "release") && plan.stage !== "IN_REVIEW");

  return (
    <Card as="section" tone="solid" className="relative p-6" id="presale-review" aria-labelledby="decision-title">
      <span aria-hidden="true" className={cn("absolute inset-x-0 top-0 h-1", tone.bar)} />
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-fg-muted">What needs you now</p>
      <h2 id="decision-title" className="mt-2 flex items-start gap-2 text-xl font-bold text-fg">
        <Icon aria-hidden="true" className={cn("mt-1 size-5 shrink-0", tone.cls)} />
        {head.title}
      </h2>
      <p className="mt-1 max-w-prose text-sm text-fg-muted">{head.text}</p>

      <div className="mt-5 grid gap-5">
        {can(plan, "presale_approve") && detail.presale ? <PresaleRequest detail={detail} r={r} /> : null}
        {can(plan, "approve") ? <MusicReview detail={detail} r={r} /> : null}
        {showRelease ? <ReleaseDay key={`${plan.stage}-${plan.release_day ?? ""}`} detail={detail} r={r} /> : null}
      </div>

      <Outcome result={r.result} error={r.error} />
      <ConfirmDialog
        confirm={r.confirm}
        busy={r.busy === "confirm"}
        onClose={() => r.setConfirm(null)}
        onGo={() => {
          const c = r.confirm;
          if (!c) return;
          void r.run("confirm", c.go).then(() => r.setConfirm(null));
        }}
      />
    </Card>
  );
}

/** Rare or risky steps, folded away: takedowns, the pre-sale's date, cancelling it, back to pre-sale. */
export function MoreReleaseActions({ detail, onDone, children }: { detail: StudioReleaseDetail; onDone: () => void; children?: React.ReactNode }) {
  const r = useRunner(onDone);
  const plan = detail.plan;
  const id = detail.release.id;
  const [note, setNote] = useState("");
  const [presaleWhen, setPresaleWhen] = useState(toLocalInput(detail.presale?.release_at ?? null));
  const [backWhen, setBackWhen] = useState(toLocalInput(detail.release.release_at ?? null));
  const needNote = () => {
    if (note.trim()) return true;
    r.setError("Write a note the artist will see first.");
    return false;
  };

  return (
    <details className="group border border-line bg-surface-raised">
      <summary className="cr-focus flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 font-semibold text-fg">
        More actions
        <span className="text-sm font-normal text-fg-muted">Move a pre-sale date, cancel a pre-sale, take down, managed mode</span>
      </summary>
      <div className="grid gap-6 border-t border-line p-5">
        {can(plan, "presale_move_date") ? (
          <section aria-labelledby="move-presale">
            <h3 id="move-presale" className="font-semibold text-fg">
              Move the pre-sale date
            </h3>
            <p className="mt-1 text-sm text-fg-muted">Everyone who pre-ordered is emailed the new date. Once the music is approved, it goes out by itself on it.</p>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <DhakaDate label="New release date" value={presaleWhen} onChange={setPresaleWhen} />
              <Button
                variant="secondary"
                busy={r.busy === "move"}
                disabled={r.busy !== null || !presaleWhen}
                onClick={() =>
                  void r.run("move", async () => {
                    await reviewPresale(id, { decision: "move_date", release_at: fromLocalInput(presaleWhen) });
                    return "Date moved. Buyers are being emailed.";
                  })
                }
              >
                <CalendarClock aria-hidden="true" /> Move the date and email buyers
              </Button>
            </div>
          </section>
        ) : null}

        {can(plan, "back_to_presale") ? (
          <section aria-labelledby="back-presale">
            <h3 id="back-presale" className="font-semibold text-fg">
              Released too early? Back to pre-sale
            </h3>
            <p className="mt-1 text-sm text-fg-muted">
              It goes back to scheduled for the date below, its songs stop playing until then, and pre-orders open again at the agreed pre-sale
              price. Not possible once someone has bought it at the normal price.
            </p>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <DhakaDate label="Release date" value={backWhen} onChange={setBackWhen} />
              <Button
                variant="secondary"
                disabled={r.busy !== null || !backWhen}
                onClick={() =>
                  r.setConfirm({
                    title: "Back to pre-sale?",
                    text: "It comes off the shelves and goes back on pre-sale until its date.",
                    cta: "Back to pre-sale",
                    go: async () => {
                      await backToPresale(id, { release_at: fromLocalInput(backWhen) });
                      return "Back on pre-sale.";
                    },
                  })
                }
              >
                <Undo2 aria-hidden="true" /> Back to pre-sale
              </Button>
            </div>
          </section>
        ) : null}

        {can(plan, "takedown") || can(plan, "cancel_presale") ? (
          <section aria-labelledby="risky" className="grid gap-3">
            <h3 id="risky" className="flex items-center gap-2 font-semibold text-fg">
              <CircleAlert aria-hidden="true" className="size-4 text-danger" /> Take down or cancel
            </h3>
            <NoteBox label="Note for the artist (needed for these)" value={note} onChange={setNote} />
            <div className="flex flex-wrap gap-2">
              {can(plan, "cancel_presale") ? (
                <Button
                  variant="secondary"
                  disabled={r.busy !== null}
                  onClick={() =>
                    r.setConfirm({
                      title: "Cancel the pre-sale and refund everyone?",
                      text: "Pre-orders stop, every pre-order is sent to finance for a full refund, and buyers are emailed. Needs catalog and finance rights in this release's workspace.",
                      cta: "Cancel pre-sale and refund",
                      danger: true,
                      go: async () => {
                        const out = await cancelPresale(id, note);
                        return `Pre-sale cancelled: ${out.refunds_requested} refunds sent to finance, ${out.buyers_told} buyers emailed.`;
                      },
                    })
                  }
                >
                  <CircleAlert aria-hidden="true" className="text-danger" /> Cancel pre-sale and refund buyers
                </Button>
              ) : null}
              {can(plan, "takedown") ? (
                <>
                  <Button
                    variant="secondary"
                    disabled={r.busy !== null}
                    onClick={() =>
                      needNote() &&
                      r.setConfirm({
                        title: "Take it down?",
                        text: "It leaves the catalog. People who bought it keep listening and downloading.",
                        cta: "Take down",
                        go: async () => {
                          await reviewRelease(id, "takedown", note, undefined, "STANDARD");
                          return "Taken down. Buyers keep it.";
                        },
                      })
                    }
                  >
                    Take down (buyers keep it)
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={r.busy !== null}
                    onClick={() =>
                      needNote() &&
                      r.setConfirm({
                        title: "Legal takedown?",
                        text: "Only for a rights or legal claim. It also removes the songs from everyone who bought them, including their downloads.",
                        cta: "Legal takedown",
                        danger: true,
                        go: async () => {
                          await reviewRelease(id, "takedown", note, undefined, "LEGAL");
                          return "Taken down for everyone, buyers included.";
                        },
                      })
                    }
                  >
                    <CircleAlert aria-hidden="true" className="text-danger" /> Legal takedown (removes it from buyers)
                  </Button>
                </>
              ) : null}
            </div>
          </section>
        ) : null}

        {children}
        <Outcome result={r.result} error={r.error} />
      </div>
      <ConfirmDialog
        confirm={r.confirm}
        busy={r.busy === "confirm"}
        onClose={() => r.setConfirm(null)}
        onGo={() => {
          const c = r.confirm;
          if (!c) return;
          void r.run("confirm", c.go).then(() => r.setConfirm(null));
        }}
      />
    </details>
  );
}

