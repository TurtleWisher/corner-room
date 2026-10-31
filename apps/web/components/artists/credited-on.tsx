"use client";

import Link from "next/link";
import { useState } from "react";

import { CoverArt } from "@/components/brand/cover-art";
import { RoomCube } from "@/components/brand/room-cube";
import { useAsync } from "@/components/use-async";
import { fetchCreditedOn } from "@/lib/api";
import { coverUrl } from "@/lib/cover-view";
import { byHref, creditedRoles, songsFor } from "@/lib/credited-on-view";

/**
 * "Credited on" (owner, 2026-10-31, D-CREDITS-06): released songs by other artists that this
 * artist or band worked on, kept apart from their own releases so fans and artists never mix the
 * two. Each card says plainly what they did on the song; a row of roles filters the list when they
 * have done more than one thing. Hidden until there is at least one song.
 */
export function CreditedOn({ id, name }: { id: string; name: string }) {
  const data = useAsync(() => fetchCreditedOn(id).catch(() => []), [id]);
  const [role, setRole] = useState<string | null>(null);
  const songs = data.status === "ok" ? (data.data ?? []) : [];
  if (songs.length === 0) return null;
  const roles = creditedRoles(songs);
  const shown = songsFor(songs, role);

  return (
    <section aria-labelledby="credited-title">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="credited-title" className="flex items-center gap-2 text-xl font-bold text-fg">
            Credited on <span className="cr-num text-sm font-semibold text-fg-muted">{songs.length}</span>
          </h2>
          <p className="mt-1 text-sm text-fg-muted">Songs by other artists that {name} worked on. Their own music is under Releases.</p>
        </div>
        {roles.length > 1 ? (
          <div role="group" aria-label="Show songs by role" className="flex flex-wrap gap-2">
            {[{ role: null as string | null, count: songs.length }, ...roles].map((r) => (
              <button
                key={r.role ?? "all"}
                type="button"
                aria-pressed={role === r.role}
                onClick={() => setRole(r.role)}
                className="credited-chip cr-focus"
              >
                {r.role ?? "All"} <span className="cr-num opacity-70">{r.count}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {shown.map((s, i) => {
          const by = byHref(s);
          return (
            <li key={s.track_id} className="credited-card group" style={{ "--i": i } as React.CSSProperties}>
              <CoverArt
                src={coverUrl({ release: s.release_id, hasCover: s.has_cover }, 160)}
                fallback={<RoomCube front={s.track_title} side={s.by_name ?? s.track_title} tone="sky" label="" className="w-full" />}
                className="credited-cover size-20 shrink-0 overflow-hidden"
              />
              <div className="min-w-0 flex-1">
                <Link href={`/tracks/${s.track_id}`} className="credited-title cr-focus block truncate font-bold text-fg">
                  {s.track_title}
                </Link>
                <p className="mt-0.5 truncate text-sm text-fg-muted">
                  by{" "}
                  {by ? (
                    <Link href={by} className="credited-by cr-focus font-semibold text-fg">
                      {s.by_name}
                    </Link>
                  ) : (
                    <span className="font-semibold text-fg">{s.by_name ?? "Not available"}</span>
                  )}
                </p>
                <ul aria-label={`What ${name} did`} className="mt-2 flex flex-wrap gap-1.5">
                  {s.roles.map((r) => (
                    <li key={r} className="credited-role">
                      {r}
                    </li>
                  ))}
                </ul>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
