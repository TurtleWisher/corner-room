"use client";

/*
 * Add people to a gift campaign by hand or from a sheet (owner, 2026-11-07, D-CAMPAIGN-04): buyers
 * Corner Room doesn't know about (paid by hand, outside the pre-sale list). One person at a time,
 * pasted rows from a spreadsheet, or an imported .csv / .tsv file; the list is previewed first, and
 * the server checks it again, skips anyone already on the list and links an email to its account.
 * Staff additions count at once; the act's wait for Corner Room.
 */

import { useId, useRef, useState } from "react";
import { CircleAlert, FileUp, UserPlus, X } from "lucide-react";

import { Button, Card, Field, Input, Textarea } from "@/components/ds";
import { addGiftPeople, type GiftCampaignDetail } from "@/features/gifts/api";
import { ApiError } from "@/lib/api/client";
import { addedMessage, parsePeopleSheet, rowProblem, sendable, type PersonRow } from "@/lib/gift-people-view";

const EMPTY = { name: "", email: "", phone: "", address: "" };

export function AddPeople({
  c,
  onChange,
  startOpen = false,
  onClose,
}: {
  c: GiftCampaignDetail;
  onChange: (next: GiftCampaignDetail) => void;
  /** Opened from a toolbar button: show the form at once, and close through `onClose`. */
  startOpen?: boolean;
  onClose?: () => void;
}) {
  const [openState, setOpenState] = useState(startOpen);
  const open = onClose ? true : openState;
  const setOpen = (v: boolean) => (onClose && !v ? onClose() : setOpenState(v));
  const [one, setOne] = useState(EMPTY);
  const [paste, setPaste] = useState("");
  const [rows, setRows] = useState<PersonRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const headingId = useId();
  const staff = c.viewer_role === "staff";

  if (!c.can_add) return null;

  const addRows = (more: PersonRow[]) => setRows((now) => [...now, ...more]);
  const addOne = () => {
    const person = { name: one.name.trim() || null, email: one.email.trim().toLowerCase() || null, phone: one.phone.trim() || null, address: one.address.trim() || null };
    addRows([{ ...person, problem: rowProblem(person) }]);
    setOne(EMPTY);
  };
  const readPaste = () => {
    addRows(parsePeopleSheet(paste));
    setPaste("");
  };
  const readFile = async (f: File | undefined) => {
    if (!f) return;
    addRows(parsePeopleSheet(await f.text()));
    if (file.current) file.current.value = "";
  };
  const ready = sendable(rows);
  const problems = rows.filter((r) => r.problem).length;

  const send = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const next = await addGiftPeople(c.id, ready);
      onChange(next);
      setRows([]);
      setMessage({ ok: true, text: addedMessage(next.added ?? 0, next.skipped ?? 0, !staff) });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof ApiError ? err.message : "That didn't go through. Please try again." });
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
          <UserPlus aria-hidden="true" /> Add people
        </Button>
        <span className="text-sm text-fg-muted">For buyers Corner Room doesn&apos;t know about, like those who paid by hand.</span>
        {message ? (
          <p role="status" className="w-full text-sm text-fg">
            {message.text}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <Card className="grid gap-5 p-5" aria-labelledby={headingId}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 id={headingId} className="flex items-center gap-2 text-base font-bold text-fg">
            <UserPlus aria-hidden="true" className="size-4 text-highlight" /> Add people
          </h4>
          <p className="mt-1 text-sm text-fg-muted">
            An email or a phone for each person, with a name and where to post the gift.{" "}
            {staff ? "They count at once." : "They count once Corner Room approves them."}
          </p>
        </div>
        <button type="button" onClick={() => setOpen(false)} aria-label="Close adding people" className="cr-focus rounded p-1 text-fg-muted hover:text-fg">
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>

      <fieldset className="grid gap-3">
        <legend className="mb-2 text-[0.8125rem] font-semibold text-fg">One person</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Name">{(p) => <Input {...p} value={one.name} onChange={(e) => setOne({ ...one, name: e.target.value })} autoComplete="off" />}</Field>
          <Field label="Email">{(p) => <Input {...p} type="email" value={one.email} onChange={(e) => setOne({ ...one, email: e.target.value })} autoComplete="off" />}</Field>
          <Field label="Phone">{(p) => <Input {...p} type="tel" value={one.phone} onChange={(e) => setOne({ ...one, phone: e.target.value })} autoComplete="off" />}</Field>
        </div>
        <Field label="Address">{(p) => <Textarea {...p} rows={2} value={one.address} onChange={(e) => setOne({ ...one, address: e.target.value })} />}</Field>
        <div>
          <Button size="sm" variant="secondary" disabled={!one.email.trim() && !one.phone.trim()} onClick={addOne}>
            Put on the list
          </Button>
        </div>
      </fieldset>

      <fieldset className="grid gap-3">
        <legend className="mb-2 text-[0.8125rem] font-semibold text-fg">Many people</legend>
        <Field label="Paste rows from a sheet" hint="One person per line: name, email, phone, address. A header row is followed if there is one.">
          {(p) => <Textarea {...p} rows={4} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={"Nila Akter\tnila@example.com\t01712345678\tHouse 2, Road 5, Dhaka"} />}
        </Field>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" disabled={!paste.trim()} onClick={readPaste}>
            Read the rows
          </Button>
          <input
            ref={file}
            type="file"
            accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
            className="sr-only"
            id={`${headingId}-file`}
            onChange={(e) => void readFile(e.target.files?.[0])}
          />
          <label htmlFor={`${headingId}-file`} className="cr-focus inline-flex cursor-pointer items-center gap-2 text-sm font-semibold text-link underline">
            <FileUp aria-hidden="true" className="size-4" /> Import a .csv file
          </label>
        </div>
      </fieldset>

      {rows.length ? (
        <div className="grid gap-3">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] table-fixed text-left text-sm">
              <caption className="sr-only">People to add</caption>
              <thead className="text-xs text-fg-muted">
                <tr className="border-b border-line">
                  <th className="w-[22%] py-2 pr-3 font-semibold">Name</th>
                  <th className="w-[26%] py-2 pr-3 font-semibold">Email</th>
                  <th className="w-[18%] py-2 pr-3 font-semibold">Phone</th>
                  <th className="py-2 pr-3 font-semibold">Address</th>
                  <th className="w-10 py-2">
                    <span className="sr-only">Remove</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-line align-top">
                    <td className="py-2 pr-3 text-fg">
                      {r.name ?? <span className="text-fg-muted">No name</span>}
                      {r.problem ? (
                        <span className="mt-1 flex items-center gap-1 text-xs text-danger">
                          <CircleAlert aria-hidden="true" className="size-3.5 shrink-0" /> {r.problem}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3 text-fg">{r.email ?? <span className="text-fg-muted">None</span>}</td>
                    <td className="py-2 pr-3 text-fg">{r.phone ?? <span className="text-fg-muted">None</span>}</td>
                    <td className="py-2 pr-3 text-fg">{r.address ?? <span className="text-fg-muted">None</span>}</td>
                    <td className="py-2">
                      <button
                        type="button"
                        onClick={() => setRows((now) => now.filter((_, j) => j !== i))}
                        aria-label={`Remove ${r.name ?? r.email ?? r.phone ?? "this row"} from the list`}
                        className="cr-focus rounded p-1 text-fg-muted hover:text-fg"
                      >
                        <X aria-hidden="true" className="size-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" busy={busy} disabled={!ready.length} onClick={() => void send()}>
              <UserPlus aria-hidden="true" /> Add {ready.length} {ready.length === 1 ? "person" : "people"}
            </Button>
            {problems ? (
              <span className="text-sm text-fg-muted">
                {problems} {problems === 1 ? "row needs" : "rows need"} fixing and won&apos;t be added.
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      {message ? (
        <p role={message.ok ? "status" : "alert"} className={`flex items-center gap-2 text-sm ${message.ok ? "text-fg" : "text-danger"}`}>
          {message.ok ? null : <CircleAlert aria-hidden="true" className="size-4" />} {message.text}
        </p>
      ) : null}
    </Card>
  );
}
