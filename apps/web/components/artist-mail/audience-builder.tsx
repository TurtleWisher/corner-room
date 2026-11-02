"use client";

/*
 * Who gets an email to buyers (owner, 2026-11-02, D-MAIL-02): the music they bought, everyone or
 * pre-sale buyers only, more filters (leave out buyers of something, first-time or returning
 * buyers, bought between two dates, own at least so many of your songs and releases), then the
 * people those let through, all ticked, to tick in or out by name. Names only (D-BUYERS-01); the
 * API works out the real audience again when the email goes.
 */

import { useEffect, useMemo, useState } from "react";
import { Search, SlidersHorizontal } from "lucide-react";

import { Input } from "@/components/ds";
import { WorkPicker } from "@/components/artist-mail/work-picker";
import { fetchMailPeople, type BuyerType, type MailAudience, type MailPerson, type MailProfile, type MailWho } from "@/features/artist-mail/api";
import type { ReleaseCard } from "@/features/studio/api";
import { BUYER_TYPE_LABEL, isPicked, reachLine, reachOf, TICK_ALL, togglePick, UNTICK_ALL, WHO_LABEL } from "@/lib/artist-mail-view";

export function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Record<T, string>; onChange: (v: T) => void }) {
  return (
    <div className="am-seg" role="group" aria-label={label}>
      {(Object.keys(options) as T[]).map((k) => (
        <button key={k} type="button" aria-pressed={value === k} onClick={() => onChange(k)} className="cr-focus">
          {options[k]}
        </button>
      ))}
    </div>
  );
}

export function AudienceBuilder({
  profile,
  releases,
  value,
  onChange,
  onPeople,
}: {
  profile: MailProfile;
  releases: ReleaseCard[];
  value: MailAudience;
  onChange: (next: MailAudience) => void;
  onPeople: (people: MailPerson[]) => void;
}) {
  const [people, setPeople] = useState<MailPerson[] | null>(null);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(
    Boolean(value.exclude_works.length || value.buyer_type !== "ANY" || value.bought_from || value.bought_to || value.min_owned),
  );
  const set = (patch: Partial<MailAudience>) => onChange({ ...value, ...patch });

  // The people the filters let through; ticking is applied here, on the page.
  const filterKey = JSON.stringify({ ...value, pick: null });
  const { kind, id } = profile;
  useEffect(() => {
    if (!value.works.length) {
      setPeople([]);
      onPeople([]);
      return;
    }
    let live = true;
    setError(false);
    const timer = window.setTimeout(() => {
      fetchMailPeople({ kind, id }, { ...value, pick: TICK_ALL })
        .then((r) => {
          if (!live) return;
          setPeople(r.people);
          onPeople(r.people);
        })
        .catch(() => live && setError(true));
    }, 300);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
    // filterKey stands for every filter; ticking people doesn't refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, id, filterKey]);

  const reach = useMemo(() => (people ? reachOf(people, value.pick) : null), [people, value.pick]);
  const shown = (people ?? []).filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase()));
  const picked = (people ?? []).filter((p) => isPicked(value.pick, p.ref)).length;

  return (
    <div className="grid gap-5">
      <WorkPicker
        releases={releases}
        value={value.works}
        onChange={(works) => set({ works, pick: TICK_ALL })}
        legend="Which music"
        hint="It goes to people who bought what you tick. Buying an album counts for each of its songs."
      />
      <div>
        <p className="text-[0.8125rem] font-semibold text-fg">Who gets it</p>
        <div className="mt-2">
          <Segmented<MailWho> label="Who gets it" value={value.who} options={WHO_LABEL} onChange={(who) => set({ who })} />
        </div>
      </div>
      <div>
        <button
          type="button"
          className="cr-focus inline-flex items-center gap-2 text-sm font-semibold text-link"
          aria-expanded={filtersOpen}
          onClick={() => setFiltersOpen(!filtersOpen)}
        >
          <SlidersHorizontal aria-hidden="true" className="size-4" /> {filtersOpen ? "Fewer filters" : "More filters"}
        </button>
        {filtersOpen ? (
          <div className="mt-3 grid gap-5 border-l-2 border-line pl-4">
            <div>
              <p className="text-[0.8125rem] font-semibold text-fg">Kind of buyer</p>
              <p className="mt-1 text-sm text-fg-muted">First-time buyers have one order with your music; returning buyers have two or more.</p>
              <div className="mt-2">
                <Segmented<BuyerType> label="Kind of buyer" value={value.buyer_type} options={BUYER_TYPE_LABEL} onChange={(buyer_type) => set({ buyer_type })} />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-[0.8125rem] font-semibold text-fg">
                Bought from
                <Input type="date" value={value.bought_from ?? ""} onChange={(e) => set({ bought_from: e.target.value || null })} />
              </label>
              <label className="grid gap-1 text-[0.8125rem] font-semibold text-fg">
                Bought until
                <Input type="date" value={value.bought_to ?? ""} onChange={(e) => set({ bought_to: e.target.value || null })} />
              </label>
            </div>
            <label className="grid max-w-xs gap-1 text-[0.8125rem] font-semibold text-fg">
              Biggest supporters: own at least
              <span className="flex items-center gap-2 text-sm font-normal text-fg-muted">
                <Input
                  type="number"
                  min={2}
                  max={1000}
                  inputMode="numeric"
                  className="w-24"
                  value={value.min_owned ?? ""}
                  onChange={(e) => set({ min_owned: e.target.value ? Math.max(0, Math.floor(Number(e.target.value))) : null })}
                />
                of your songs and releases
              </span>
            </label>
            <WorkPicker
              releases={releases}
              value={value.exclude_works}
              onChange={(exclude_works) => set({ exclude_works })}
              legend="Leave out people who bought"
              hint="For example, everyone who bought the single but not the album yet."
            />
          </div>
        ) : null}
      </div>
      {value.works.length ? (
        <div className="grid gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[0.8125rem] font-semibold text-fg">People</p>
            <div className="flex gap-2">
              <button type="button" className="am-tool" onClick={() => set({ pick: TICK_ALL })}>
                Tick everyone
              </button>
              <button type="button" className="am-tool" onClick={() => set({ pick: UNTICK_ALL })}>
                Untick everyone
              </button>
            </div>
          </div>
          {error ? (
            <p className="text-sm text-danger">These people couldn&apos;t be loaded. Change a filter to try again.</p>
          ) : people === null ? (
            <p className="text-sm text-fg-muted">Finding who bought it</p>
          ) : people.length === 0 ? (
            <p className="text-sm text-fg">Nobody fits these choices yet.</p>
          ) : (
            <>
              <label className="relative block">
                <span className="sr-only">Find a person</span>
                <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-muted" />
                <Input className="pl-9" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a person" />
              </label>
              <p className="text-xs text-fg-muted">
                {picked} of {people.length} ticked. You see names only; Corner Room sends the email.
              </p>
              <ul className="am-people">
                {shown.map((p) => (
                  <li key={p.ref} className="am-person">
                    <input
                      type="checkbox"
                      aria-label={`Send to ${p.name}`}
                      checked={isPicked(value.pick, p.ref)}
                      onChange={() => set({ pick: togglePick(value.pick, p.ref) })}
                    />
                    <span className="min-w-0">
                      <span className="font-semibold text-fg">{p.name}</span>
                      {p.bought.length ? <span className="block truncate text-xs text-fg-muted">Bought {p.bought.join(", ")}</span> : null}
                    </span>
                    <span className="flex gap-1">
                      {p.presale ? <span className="am-tag">Pre-sale</span> : null}
                      {p.stopped ? <span className="am-tag">Stopped your emails</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      ) : null}
      <p className="text-sm font-semibold text-fg" aria-live="polite">
        {value.works.length ? reachLine(reach) : "Choose the music to see who it reaches"}
      </p>
    </div>
  );
}
