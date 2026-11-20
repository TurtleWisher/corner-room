"use client";

/*
 * Staff: the emails fans designed for gifts they paid for (owner, 2026-11-20, D-GIFT-FAN-01 and
 * D-GIFT-FAN-02: fans' words and files are checked). Each shows exactly as its first person will
 * get it, with its pictures and PDFs to open. The gift is paid, so it always goes: Send as they
 * made it, or Send in Corner Room's own words (no message, subject or files) when something can't
 * go out as it is. Nobody is emailed until one is pressed.
 */

import { useEffect, useState } from "react";
import { CircleAlert, FileText, ImageIcon } from "lucide-react";

import { EmailFrame } from "@/components/fan-gifts/email-frame";
import { Button, Card, ErrorState, LoadingState } from "@/components/staff/kit";
import { useWorkspace } from "@/components/workspace-provider";
import { fetchFanGiftNotes, fetchStaffGiftFile, fetchStaffGiftPreview, reviewFanGiftNote, type FanGiftNote, type GiftFile } from "@/features/fan-gifts/api";
import { ApiError } from "@/lib/api/client";
import { friendlyError } from "@/lib/error-copy";
import { LOOKS, peopleLine } from "@/lib/fan-gift-view";

function useStaffPreview(id: string) {
  const [state, setState] = useState<{ subject: string; html: string; files: GiftFile[]; pictures: Record<string, string> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const made: string[] = [];
    (async () => {
      try {
        const p = await fetchStaffGiftPreview(id);
        const pictures: Record<string, string> = {};
        for (const f of p.files) {
          const blob = await fetchStaffGiftFile(f.id);
          if (blob) {
            pictures[f.id] = URL.createObjectURL(blob);
            made.push(pictures[f.id]);
          }
        }
        if (live) setState({ ...p, pictures });
      } catch (err) {
        if (live) setError(friendlyError(err, "The email couldn't be drawn."));
      }
    })();
    return () => {
      live = false;
      made.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [id]);
  return { state, error };
}

function Item({ g, onDone }: { g: FanGiftNote; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preview = useStaffPreview(g.id);

  async function act(approve: boolean) {
    setBusy(true);
    setError(null);
    try {
      await reviewFanGiftNote(g.id, approve);
      onDone();
    } catch (err) {
      setError(friendlyError(err, "That didn't go through."));
      setBusy(false);
    }
  }

  const look = LOOKS.find((l) => l.key === g.look)?.label ?? "Sky";
  return (
    <li className="border-b py-4">
      <p className="font-medium">
        {g.title}
        <span className="font-normal text-muted-foreground"> · {g.act_name}</span>
      </p>
      <p className="mt-1 text-sm">
        A gift from {g.giver_name ?? "a fan"} to {peopleLine(g.people)}, paid for. {look} look
        {g.files?.length ? `, ${g.files.length} ${g.files.length === 1 ? "file" : "files"}` : ""}. As its first person will get it:
      </p>
      {preview.error ? (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {preview.error}
        </p>
      ) : !preview.state ? (
        <LoadingState />
      ) : (
        <div className="mt-2 grid gap-2">
          <p className="text-sm">
            <span className="text-muted-foreground">Subject: </span>
            {preview.state.subject}
          </p>
          <EmailFrame html={preview.state.html} pictures={preview.state.pictures} className="max-w-[40rem]" />
          {preview.state.files.length ? (
            <ul className="flex flex-wrap gap-2 text-sm">
              {preview.state.files.map((f) => (
                <li key={f.id}>
                  {preview.state?.pictures[f.id] ? (
                    <a className="inline-flex items-center gap-1 underline" href={preview.state.pictures[f.id]} target="_blank" rel="noreferrer" download={f.kind === "PDF" ? f.name : undefined}>
                      {f.kind === "IMAGE" ? <ImageIcon aria-hidden="true" className="size-4" /> : <FileText aria-hidden="true" className="size-4" />} {f.name}
                    </a>
                  ) : (
                    f.name
                  )}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => void act(true)}>
          Send as they made it
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => void act(false)}>
          Send in Corner Room&apos;s words
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

export function FanGiftNotes() {
  const { currentOrg } = useWorkspace();
  const [items, setItems] = useState<FanGiftNote[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState(0);

  useEffect(() => {
    if (!currentOrg) return;
    fetchFanGiftNotes()
      .then(setItems)
      .catch((err) =>
        err instanceof ApiError && (err.status === 403 || err.status === 404 || err.status === 409)
          ? setItems([])
          : setError(friendlyError(err, "Gift emails couldn't be loaded.")),
      );
  }, [currentOrg, round]);

  if (!currentOrg || (items !== null && items.length === 0 && !error)) return null;
  return (
    <Card className="p-5">
      <h2 className="text-lg font-semibold">Fans&apos; gift emails waiting for a check</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Fans bought music for people they know and designed the email they get. The people are emailed once you choose.
      </p>
      {error ? (
        <ErrorState message={error} />
      ) : items === null ? (
        <LoadingState />
      ) : (
        <ul className="mt-2">
          {items.map((g) => (
            <Item key={g.id} g={g} onDone={() => setRound((n) => n + 1)} />
          ))}
        </ul>
      )}
    </Card>
  );
}
