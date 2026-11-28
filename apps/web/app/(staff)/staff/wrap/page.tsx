"use client";

/* Staff > Marketing > Corner Room Wrap (owner, 2026-11-28, D-WRAP-01): every Wrap, and a new one.
 * Platform admins only; the API answers 404 to anyone else. */

import { Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ds/button";
import { Field } from "@/components/ds/field";
import { Input } from "@/components/ds/input";
import { Card, EmptyState, ErrorState, LoadingState, Protected } from "@/components/staff/kit";
import { useAsync } from "@/components/use-async";
import { createWrap, fetchStaffWraps } from "@/features/wraps/api";
import { friendlyError } from "@/lib/error-copy";
import { formatCount } from "@/lib/format/count";
import { LOOK_WORDS, STATUS_WORDS, windowWords } from "@/lib/wrap-view";

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Dhaka" });

function NewWrap() {
  const router = useRouter();
  const year = new Date().getFullYear();
  const [name, setName] = useState(`Corner Room Wrap ${year}`);
  const [start, setStart] = useState(`${year}-01-01`);
  const [end, setEnd] = useState(`${year}-12-31`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const make = async () => {
    setBusy(true);
    setError(null);
    try {
      const made = await createWrap({ name, starts_on: start, ends_on: end });
      router.push(`/staff/wrap/${made.id}`);
    } catch (err) {
      setError(friendlyError(err, "The Wrap couldn't be made."));
      setBusy(false);
    }
  };
  return (
    <Card className="p-5">
      <h2 className="text-lg font-semibold">New Wrap</h2>
      <p className="mt-1 text-sm text-fg-muted">It starts as a draft. Nobody but staff sees it until you set it live.</p>
      <form
        className="mt-4 grid gap-4 md:grid-cols-[2fr_1fr_1fr_auto] md:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          void make();
        }}
      >
        <Field label="Name">{(p) => <Input {...p} value={name} maxLength={80} required onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label="Activity from">{(p) => <Input {...p} type="date" value={start} required onChange={(e) => setStart(e.target.value)} />}</Field>
        <Field label="Activity until">{(p) => <Input {...p} type="date" value={end} required onChange={(e) => setEnd(e.target.value)} />}</Field>
        <Button type="submit" busy={busy} disabled={busy}>
          <Plus aria-hidden className="size-4" /> Make it
        </Button>
      </form>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </Card>
  );
}

export default function StaffWrapsPage() {
  const list = useAsync(() => fetchStaffWraps(), []);
  return (
    <Protected>
      <div className="grid gap-6">
        <div>
          <h1 className="text-2xl font-bold">Corner Room Wrap</h1>
          <p className="mt-1 max-w-2xl text-sm text-fg-muted">
            Each listener&apos;s own look back at a stretch of time, told as a carnival story they can share. Set the period, the look, the cards and their words, who gets one, and when fans can open it.
          </p>
        </div>
        <NewWrap />
        {list.status === "loading" ? <LoadingState /> : null}
        {list.status === "error" ? <ErrorState message={friendlyError(list.error, "Wraps couldn't be loaded. They are for platform admins.")} /> : null}
        {list.status === "ok" && !list.data.items.length ? <EmptyState message="No Wraps yet. Make the first one above." /> : null}
        {list.status === "ok" && list.data.items.length ? (
          <Card className="p-0">
            <ul className="divide-y divide-line">
              {list.data.items.map((w) => (
                <li key={w.id}>
                  <Link href={`/staff/wrap/${w.id}`} className="wre-list-row cr-focus">
                    <span className="wre-status" data-status={w.status}>
                      {STATUS_WORDS[w.status]}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{w.name}</span>
                      <span className="block text-sm text-fg-muted">
                        {w.starts_on} to {w.ends_on} · {LOOK_WORDS[w.look].name} · {windowWords(w.fan_state, w.opens_at, w.closes_at, when)}
                      </span>
                    </span>
                    <span className="text-right text-sm tabular-nums text-fg-muted">
                      {formatCount(w.numbers.built)} made
                      <br />
                      {formatCount(w.numbers.shared_sheet + w.numbers.shared_save)} shared
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </div>
    </Protected>
  );
}
