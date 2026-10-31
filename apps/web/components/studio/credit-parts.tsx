"use client";

/* Pieces of the Studio credits editor (owner, 2026-10-31, D-CREDITS-07): pick a Corner Room
 * profile by its stage name, say which act a musician played in, see where a change goes, and see
 * the credits as fans will. Display only; the API checks every credit. */

import { useId, useState } from "react";
import { BadgeCheck, CircleDot, Eye, Link2Off, Lock, Radio, Search } from "lucide-react";

import { Avatar, Field, Input, Select } from "@/components/ds";
import { SongCredits } from "@/components/music/song-credits";
import type { StudioCredit } from "@/features/studio/api";
import type { ArtistRecord, BandRecord } from "@/lib/api";
import { coverUrl } from "@/lib/cover-view";
import { creditsNote, profileMatches, type CreditProfile, type CreditsStage } from "@/lib/credit-editor-view";

function pictureOf(p: CreditProfile, size: 160 | 480 = 160): string | null {
  return coverUrl(p.kind === "BAND" ? { band: p.id, picture: p.picture } : { artist: p.id, picture: p.picture }, size);
}

/**
 * Who the credit names. Typing shows matching Corner Room profiles by their stage name; picking one
 * links the credit, so the name opens their page everywhere and the song joins their "Credited on".
 * A name with no profile stays typed. Performer roles must be a profile.
 */
export function PersonField({
  row,
  profiles,
  mustLink,
  disabled,
  onType,
  onLink,
}: {
  row: StudioCredit;
  profiles: CreditProfile[];
  mustLink: boolean;
  disabled: boolean;
  onType: (name: string) => void;
  onLink: (profile: CreditProfile | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const linked = row.artist_id ? (profiles.find((p) => p.id === row.artist_id) ?? null) : null;

  if (row.artist_id) {
    const name = linked?.name ?? row.artist_name ?? "Corner Room profile";
    return (
      <div className="flex flex-col gap-1.5">
        <span className="font-ui text-[0.8125rem] font-semibold text-fg">Name</span>
        <div className="credit-linked flex min-h-10 items-center gap-2.5 px-2.5 py-1.5">
          <Avatar name={name} src={linked ? pictureOf(linked) : null} size={28} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-fg">{name}</span>
            <span className="flex items-center gap-1 text-xs text-fg-muted">
              <BadgeCheck aria-hidden="true" className="size-3.5 text-success" /> Corner Room {linked?.kind === "BAND" ? "band" : "artist"}
            </span>
          </span>
          {disabled ? null : (
            <button
              type="button"
              onClick={() => onLink(null)}
              className="cr-focus inline-flex items-center gap-1 text-xs font-semibold text-fg-muted hover:text-fg"
              aria-label={`Unlink ${name} and type a name instead`}
            >
              <Link2Off aria-hidden="true" className="size-3.5" /> Change
            </button>
          )}
        </div>
      </div>
    );
  }

  const matches = disabled ? [] : profileMatches(row.display_name ?? "", profiles);
  const showing = open && matches.length > 0;
  const pick = (p: CreditProfile) => {
    onLink(p);
    setOpen(false);
  };
  return (
    <Field
      label="Name"
      hint={mustLink ? "Pick their Corner Room profile from the list." : "Type a name. If they are on Corner Room, pick them from the list so the name links to their page."}
    >
      {(c) => (
        <div className="relative">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-muted" />
          <Input
            {...c}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={showing}
            aria-controls={listId}
            aria-activedescendant={showing ? `${listId}-${active}` : undefined}
            autoComplete="off"
            className="pl-9"
            value={row.display_name ?? ""}
            disabled={disabled}
            maxLength={200}
            placeholder={mustLink ? "Search Corner Room artists" : "Name, or search Corner Room"}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onChange={(e) => {
              onType(e.target.value);
              setOpen(true);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (!showing) return;
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => (a + (e.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length);
              } else if (e.key === "Enter") {
                e.preventDefault();
                pick(matches[active]);
              } else if (e.key === "Escape") {
                setOpen(false);
              }
            }}
          />
          {showing ? (
            <ul id={listId} role="listbox" aria-label="Corner Room profiles" className="credit-suggest absolute inset-x-0 top-full z-20 mt-1 py-1">
              {matches.map((p, i) => (
                <li
                  key={p.id}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  // Keep focus in the field so the pick lands before blur closes the list.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(p)}
                  onMouseEnter={() => setActive(i)}
                  className="credit-suggest-option flex cursor-pointer items-center gap-2.5 px-3 py-2"
                >
                  <Avatar name={p.name} src={pictureOf(p)} size={28} />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">{p.name}</span>
                  <span className="text-xs text-fg-muted">{p.kind === "BAND" ? "Band" : "Artist"}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </Field>
  );
}

/** Which act on this song a musician played in (D-CREDITS-05); fans see them under that act. */
export function PartOfField({
  value,
  options,
  disabled,
  onChange,
}: {
  value: string;
  options: { value: string; label: string }[];
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <Field label="Played as part of" hint="Fans see them under that credit. Choose a guest if they are not part of an act here.">
      {(c) => (
        <Select {...c} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
          <option value="">A guest (their own line)</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

const STAGE_ICON = { draft: CircleDot, live: Radio, changing: CircleDot, locked: Lock } as const;

/** Where a change to these credits goes, said once above the editor. */
export function CreditsNote({ stage }: { stage: CreditsStage }) {
  const note = creditsNote(stage);
  const Icon = STAGE_ICON[stage];
  return (
    <div className="credit-note flex items-start gap-3 p-3" data-stage={stage}>
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div className="text-sm">
        <p className="font-semibold text-fg">{note.title}</p>
        <p className="mt-0.5 text-fg-muted">{note.body}</p>
      </div>
    </div>
  );
}

/** The credits as the song page will show them, updated as you type. */
export function CreditsPreview({
  rows,
  artists,
  bands,
}: {
  rows: (StudioCredit & { rowKey: string })[];
  artists: Pick<ArtistRecord, "id" | "stage_name">[];
  bands: Pick<BandRecord, "id" | "name">[];
}) {
  const records = rows.map((r) => ({
    id: r.rowKey,
    credit_role: r.role_key,
    role_key: r.role_key,
    artist_id: r.artist_id ?? null,
    display_name: r.artist_id ? null : r.display_name,
    instrument: r.instrument,
    part_of_artist_id: r.part_of_artist_id ?? null,
    part_of_name: r.part_of_artist_id ? null : r.part_of_name,
  }));
  return (
    <div className="credit-preview mt-4 px-4 pt-2" data-theme="sky" data-module="music">
      <p className="flex items-center gap-1.5 pt-2 text-xs font-semibold uppercase tracking-wider text-fg-muted">
        <Eye aria-hidden="true" className="size-3.5" /> How fans will see it
      </p>
      <SongCredits credits={records} artists={artists} bands={bands} defaultOpen />
    </div>
  );
}
