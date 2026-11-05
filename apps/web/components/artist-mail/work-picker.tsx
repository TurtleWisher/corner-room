"use client";

/* Choosing the act's music for an email (owner, 2026-11-02, D-MAIL-02): whole releases or songs on
 * them, with titles kept so the wording and preview can name them. Approved, scheduled and released
 * music only. */

import { useState } from "react";
import { ChevronDown } from "lucide-react";

import { useAsync } from "@/components/use-async";
import type { MailWork } from "@/features/artist-mail/api";
import { fetchStudioRelease, type ReleaseCard } from "@/features/studio/api";

const TYPE_LABEL: Record<string, string> = { SINGLE: "Single", EP: "EP", ALBUM: "Album", COMPILATION: "Compilation", LIVE: "Live" };
const key = (w: Pick<MailWork, "type" | "id">) => `${w.type}:${w.id}`;
export const USABLE_RELEASE = ["APPROVED", "SCHEDULED", "RELEASED"];

function ReleaseRow({ release, chosen, toggle }: { release: ReleaseCard; chosen: Set<string>; toggle: (w: MailWork) => void }) {
  const [open, setOpen] = useState(false);
  const tracks = useAsync(async () => (open ? (await fetchStudioRelease(release.id)).tracks : []), [open, release.id]);
  const whole: MailWork = { type: "RELEASE", id: release.id, title: release.title };
  return (
    <li className="border-b border-line py-2">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex flex-1 items-center gap-2 text-sm text-fg">
          <input type="checkbox" checked={chosen.has(key(whole))} onChange={() => toggle(whole)} />
          <span className="font-semibold">{release.title}</span>
          <span className="text-fg-muted">{TYPE_LABEL[release.release_type] ?? release.release_type}</span>
        </label>
        {release.release_type !== "SINGLE" ? (
          <button type="button" className="cr-focus inline-flex items-center gap-1 text-xs font-semibold text-link" onClick={() => setOpen(!open)} aria-expanded={open}>
            Choose songs <ChevronDown aria-hidden="true" className={`size-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
        ) : null}
      </div>
      {open && tracks.status === "ok" ? (
        <ul className="ml-6 mt-1">
          {tracks.data.map((t) => {
            const w: MailWork = { type: "TRACK", id: t.id, title: t.title };
            return (
              <li key={t.id}>
                <label className="flex items-center gap-2 py-1 text-sm text-fg">
                  <input type="checkbox" checked={chosen.has(key(w))} onChange={() => toggle(w)} />
                  {t.position}. {t.title}
                </label>
              </li>
            );
          })}
        </ul>
      ) : null}
    </li>
  );
}

export function WorkPicker({
  releases,
  value,
  onChange,
  legend,
  hint,
  anyLabel,
  statuses = USABLE_RELEASE,
  emptyText = "No approved or released music yet.",
}: {
  releases: ReleaseCard[];
  value: MailWork[];
  onChange: (works: MailWork[]) => void;
  legend: string;
  hint?: string;
  /** When set, an "any of my music" choice that clears the list (thank-yous). */
  anyLabel?: string;
  /** Release statuses offered (music gifts: released only). */
  statuses?: string[];
  emptyText?: string;
}) {
  const chosen = new Set(value.map(key));
  const usable = releases.filter((r) => statuses.includes(r.status));
  const toggle = (w: MailWork) => onChange(chosen.has(key(w)) ? value.filter((x) => key(x) !== key(w)) : [...value, w]);
  return (
    <fieldset>
      <legend className="text-[0.8125rem] font-semibold text-fg">{legend}</legend>
      {hint ? <p className="mt-1 text-sm text-fg-muted">{hint}</p> : null}
      {anyLabel ? (
        <label className="mt-2 flex items-center gap-2 text-sm font-semibold text-fg">
          <input type="checkbox" checked={value.length === 0} onChange={() => onChange([])} />
          {anyLabel}
        </label>
      ) : null}
      {usable.length === 0 ? (
        <p className="mt-2 text-sm text-fg">{emptyText}</p>
      ) : (
        <ul className="mt-2 max-h-72 overflow-y-auto border-t border-line">
          {usable.map((r) => (
            <ReleaseRow key={r.id} release={r} chosen={chosen} toggle={toggle} />
          ))}
        </ul>
      )}
    </fieldset>
  );
}

/** Release types by id, for the starting words ("an album", "an EP"). */
export function releaseTypes(releases: ReleaseCard[]): Record<string, string> {
  return Object.fromEntries(releases.map((r) => [r.id, r.release_type]));
}
