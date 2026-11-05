"use client";

/*
 * Who a music gift is for (owner, 2026-11-06, D-GIFT-MUSIC-01): add one person (email, name, a
 * personal note), paste a list (one per line, "Name <email>", or columns copied from a sheet), or
 * add people who already bought the act's music by name (their address stays on the server). Each
 * row's name and note can be changed or the row taken off.
 */

import { useMemo, useState } from "react";
import { ClipboardPaste, Search, Trash2, UserPlus, Users } from "lucide-react";

import { Button, Input, Textarea } from "@/components/ds";
import type { GiftSuggestion, PersonInput } from "@/features/music-gifts/api";
import { isEmail, mergePeople, parsePeople } from "@/lib/music-gift-view";

type Mode = "one" | "paste" | "buyers";

export function PeopleEditor({
  value,
  onChange,
  suggestions,
  buyerRefs,
  onBuyerRefs,
}: {
  value: PersonInput[];
  onChange: (people: PersonInput[]) => void;
  suggestions: GiftSuggestion[];
  /** Buyers added by reference (names only; the server knows the address). */
  buyerRefs: string[];
  onBuyerRefs: (refs: string[]) => void;
}) {
  const [mode, setMode] = useState<Mode>("one");
  const [one, setOne] = useState({ email: "", name: "", note: "" });
  const [pasted, setPasted] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [find, setFind] = useState("");
  const [filter, setFilter] = useState("");

  const addOne = () => {
    if (!isEmail(one.email)) {
      setProblem("Write a full email address, like name@example.com.");
      return;
    }
    const before = value.length;
    const next = mergePeople(value, [{ email: one.email.trim().toLowerCase(), name: one.name.trim() || null, note: one.note.trim() || null }]);
    setProblem(next.length === before ? "That address is already on the list." : null);
    onChange(next);
    setOne({ email: "", name: "", note: "" });
  };

  const addPasted = () => {
    const { people, invalid } = parsePeople(pasted);
    const next = mergePeople(value, people);
    onChange(next);
    const added = next.length - value.length;
    setProblem(
      [
        added ? `Added ${added} ${added === 1 ? "person" : "people"}.` : "Nobody new was added.",
        invalid.length ? `Check ${invalid.slice(0, 5).join(", ")}${invalid.length > 5 ? ` and ${invalid.length - 5} more` : ""}.` : "",
      ]
        .filter(Boolean)
        .join(" "),
    );
    setPasted(invalid.join("\n"));
  };

  const update = (i: number, patch: Partial<PersonInput>) => onChange(value.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return value.map((p, i) => ({ p, i })).filter(({ p }) => !q || p.email.includes(q) || (p.name ?? "").toLowerCase().includes(q));
  }, [value, filter]);
  const buyers = suggestions.filter((s) => !find.trim() || s.label.toLowerCase().includes(find.trim().toLowerCase()));
  const chosen = new Set(buyerRefs);
  const total = value.length + buyerRefs.length;

  return (
    <fieldset className="grid gap-3">
      <legend className="flex items-center gap-2 text-[0.8125rem] font-semibold text-fg">
        <Users aria-hidden="true" className="size-4 text-highlight" /> Who it&apos;s for
      </legend>
      <p className="text-sm text-fg-muted">
        Anyone with an email address. People with a Corner Room account get the music at once; anyone else gets your email and the music as soon as they sign up
        with that address.
      </p>
      <div className="am-chips" role="group" aria-label="Add people">
        {(
          [
            ["one", "Add a person", UserPlus],
            ["paste", "Paste a list", ClipboardPaste],
            ["buyers", "From your buyers", Search],
          ] as const
        ).map(([key, label, Icon]) => (
          <button key={key} type="button" aria-pressed={mode === key} className="am-occasion cr-focus" onClick={() => setMode(key)}>
            <Icon aria-hidden="true" className="mr-1 inline size-3.5" />
            {label}
          </button>
        ))}
      </div>

      {mode === "one" ? (
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <Input
            type="email"
            value={one.email}
            onChange={(e) => setOne({ ...one, email: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addOne();
              }
            }}
            placeholder="name@example.com"
            aria-label="Email address"
            maxLength={320}
          />
          <Input value={one.name} onChange={(e) => setOne({ ...one, name: e.target.value })} placeholder="Name (optional)" aria-label="Name" maxLength={200} />
          <Textarea
            className="sm:col-span-2"
            value={one.note}
            onChange={(e) => setOne({ ...one, note: e.target.value })}
            placeholder="A personal note for just this person (optional). It goes under your message."
            aria-label="Personal note"
            maxLength={1000}
            rows={2}
          />
          <div>
            <Button type="button" size="sm" variant="secondary" onClick={addOne} disabled={!one.email.trim()}>
              <UserPlus aria-hidden="true" /> Add
            </Button>
          </div>
        </div>
      ) : null}

      {mode === "paste" ? (
        <div className="grid gap-2">
          <Textarea
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            rows={6}
            placeholder={"One per line:\nfriend@example.com\nRumi Khan <rumi@example.com>\nradio@example.com, Radio Host\n(or paste columns from a sheet: email, name, note)"}
            aria-label="Paste email addresses"
          />
          <div>
            <Button type="button" size="sm" variant="secondary" onClick={addPasted} disabled={!pasted.trim()}>
              <ClipboardPaste aria-hidden="true" /> Add these
            </Button>
          </div>
        </div>
      ) : null}

      {mode === "buyers" ? (
        <div className="grid gap-2">
          {suggestions.length === 0 ? (
            <p className="text-sm text-fg">Nobody has bought your music yet.</p>
          ) : (
            <>
              <Input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find a buyer by name" aria-label="Find a buyer" />
              <div className="flex flex-wrap gap-2 text-xs">
                <button type="button" className="cr-focus font-semibold text-link" onClick={() => onBuyerRefs([...new Set([...buyerRefs, ...buyers.map((b) => b.ref)])])}>
                  Add all {buyers.length} shown
                </button>
                {buyerRefs.length ? (
                  <button type="button" className="cr-focus font-semibold text-link" onClick={() => onBuyerRefs([])}>
                    Take all buyers off
                  </button>
                ) : null}
              </div>
              <ul className="max-h-56 overflow-y-auto border-t border-line">
                {buyers.slice(0, 500).map((b) => (
                  <li key={b.ref} className="border-b border-line py-1.5">
                    <label className="flex items-center gap-2 text-sm text-fg">
                      <input
                        type="checkbox"
                        checked={chosen.has(b.ref)}
                        onChange={() => onBuyerRefs(chosen.has(b.ref) ? buyerRefs.filter((r) => r !== b.ref) : [...buyerRefs, b.ref])}
                      />
                      {b.label}
                    </label>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-fg-muted">You see buyers&apos; names only. Corner Room uses the address they bought with; once saved, they show on the list below.</p>
            </>
          )}
        </div>
      ) : null}

      {problem ? (
        <p role="status" className="text-sm text-fg">
          {problem}
        </p>
      ) : null}

      <div className="mt-1">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-semibold text-fg">
            {total} {total === 1 ? "person" : "people"}
            {buyerRefs.length ? ` (${buyerRefs.length} from your buyers, added when you save)` : ""}
          </p>
          {value.length > 8 ? (
            <Input className="w-auto" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find on the list" aria-label="Find on the list" />
          ) : null}
        </div>
        {value.length ? (
          <ul className="mt-2 max-h-96 overflow-y-auto border-t border-line">
            {shown.slice(0, 300).map(({ p, i }) => (
              <li key={p.email} className="grid gap-2 border-b border-line py-2 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.4fr)_auto] sm:items-center">
                <span className="truncate text-sm text-fg" title={p.email}>
                  {p.email}
                </span>
                <Input value={p.name ?? ""} onChange={(e) => update(i, { name: e.target.value || null })} placeholder="Name" aria-label={`Name for ${p.email}`} maxLength={200} />
                <Input value={p.note ?? ""} onChange={(e) => update(i, { note: e.target.value || null })} placeholder="Personal note" aria-label={`Note for ${p.email}`} maxLength={1000} />
                <button
                  type="button"
                  className="cr-focus inline-flex items-center gap-1 justify-self-start text-xs font-semibold text-fg-muted hover:text-danger"
                  onClick={() => onChange(value.filter((_, j) => j !== i))}
                  aria-label={`Take ${p.email} off`}
                >
                  <Trash2 aria-hidden="true" className="size-3.5" /> Take off
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {shown.length > 300 ? <p className="mt-1 text-xs text-fg-muted">Showing 300 of {shown.length}. Find someone to see them.</p> : null}
      </div>
    </fieldset>
  );
}
