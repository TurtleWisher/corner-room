"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { ArrowUpRight } from "lucide-react";

import { useAuth } from "@/components/auth-provider";
import { LitSurface } from "@/components/brand/corner-light";
import { CoverArt } from "@/components/brand/cover-art";
import { Button, EmptyState, ErrorState, Field, Input, Skeleton, StatusChip, Table, TBody, TD, TH, THead, TR } from "@/components/ds";
import { coverUrl } from "@/lib/cover-view";
import { PageIntro, RetryButton, StaffPanel } from "@/components/shell/staff-panel";
import { loadErrorMessage, useAsync } from "@/components/use-async";
import { useWorkspace } from "@/components/workspace-provider";
import { ApiError } from "@/lib/api";
import { rowsForActiveOrg } from "@/lib/workspace-view";

export type RosterEntry = {
  id: string;
  name: string;
  bio: string | null;
  status: string;
  primary_org_id?: string | null;
  picture?: string | null;
  /** Solo artist or band, when one list shows both (owner, 2026-10-30); else the page's kind. */
  kind?: "artist" | "band";
};

/** Up to two initials, for a card without a picture. */
function monogram(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

/**
 * One artist on the roster (owner, 2026-11-01): their picture fills the card edge to edge and is
 * cut at the corner with it, and their name floats on a clear glass plate. Solo artists and bands
 * look the same. Without a picture, their initials. Styles: `app/styles/modules/artists.css`.
 */
function RosterCard({ row, kind }: { row: RosterEntry; kind: "artist" | "band" }) {
  const own = row.kind ?? kind;
  return (
    <Link href={`/${own}s/${row.id}`} className="cr-focus roster-link" aria-label={row.name}>
      <div className="roster-card">
        <CoverArt
          src={coverUrl(own === "band" ? { band: row.id, picture: row.picture } : { artist: row.id, picture: row.picture }, 480)}
          fallback={
            <div className="flex size-full items-center justify-center">
              <span className="font-ui text-5xl font-extrabold tracking-wide text-highlight">{monogram(row.name)}</span>
            </div>
          }
          className="roster-pic"
        />
        <div aria-hidden="true" className="roster-shade" />
        <div aria-hidden="true" className="roster-sheen" />
        <div className="roster-glass">
          <h2 className="min-w-0 truncate text-lg font-bold text-fg">{row.name}</h2>
          <ArrowUpRight aria-hidden="true" className="roster-arrow size-5" />
        </div>
        <div aria-hidden="true" className="roster-edge" />
      </div>
    </Link>
  );
}

type Props = {
  kind: "artist" | "band";
  title: string;
  lede: string;
  /** Public list (guest-readable). */
  loadPublic: () => Promise<RosterEntry[]>;
  /** The active workspace's roster for staff, every state. */
  loadWorkspace: () => Promise<RosterEntry[]>;
  create: (name: string, bio: string) => Promise<unknown>;
};

function StaffTools({ kind, loadWorkspace, create }: Pick<Props, "kind" | "loadWorkspace" | "create">) {
  const { currentOrg } = useWorkspace();
  const roster = useAsync(loadWorkspace, [currentOrg?.id]);
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noun = kind === "artist" ? "artist" : "band";

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await create(name, bio);
      setName("");
      setBio("");
      roster.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `The ${noun} could not be created.`);
    } finally {
      setBusy(false);
    }
  }

  const rows = roster.status === "ok" ? rowsForActiveOrg(currentOrg?.id ?? null, roster.data) : [];
  return (
    <StaffPanel description={currentOrg ? `Acting in ${currentOrg.name}` : "Choose a workspace to manage the roster"}>
      <form onSubmit={onCreate} className="grid gap-3 md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto] md:items-end">
        <Field label={kind === "artist" ? "Stage name" : "Band name"}>
          {(c) => <Input {...c} value={name} onChange={(e) => setName(e.target.value)} required />}
        </Field>
        {kind === "artist" ? (
          <Field label="Biography">{(c) => <Input {...c} value={bio} onChange={(e) => setBio(e.target.value)} />}</Field>
        ) : (
          <span />
        )}
        <Button type="submit" busy={busy} disabled={!currentOrg}>
          Add {noun}
        </Button>
      </form>
      {error ? (
        <p role="alert" className="mt-3 text-danger">
          {error}
        </p>
      ) : null}
      <div className="mt-6">
        {!currentOrg ? (
          <p className="text-fg-muted">Switch to an organization workspace to see its roster.</p>
        ) : roster.status === "loading" ? (
          <Skeleton className="h-24 w-full" />
        ) : roster.status === "error" ? (
          <p className="text-fg-muted">{loadErrorMessage(roster.error, "this workspace's roster")}</p>
        ) : rows.length === 0 ? (
          <p className="text-fg-muted">No {noun}s in this workspace yet.</p>
        ) : (
          <Table label="Workspace roster">
            <THead>
              <TR>
                <TH>Name</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((row) => (
                <TR key={row.id}>
                  <TD>
                    <Link href={`/${kind}s/${row.id}`} className="cr-focus font-semibold text-link underline">
                      {row.name}
                    </Link>
                  </TD>
                  <TD>
                    <StatusChip value={row.status} />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </div>
    </StaffPanel>
  );
}

/**
 * Public roster (Artists module, Ember): a grid of glass picture cards with the name only (owner,
 * 2026-10-30; the bio is on the profile). Staff get the workspace roster and the create form in
 * a separate panel, as the legacy page offered.
 */
export function RosterPage({ kind, title, lede, loadPublic, loadWorkspace, create }: Props) {
  const { status } = useAuth();
  const { currentOrg, organizations } = useWorkspace();
  const list = useAsync(loadPublic, []);
  const staff = status === "authenticated" && (Boolean(currentOrg) || organizations.length > 0);

  return (
    <main id="main" data-theme="ember" data-module="artists" className="cr-scope">
      <LitSurface as="section" theme="ember" aria-labelledby="roster-title">
        <div className="mx-auto max-w-[90rem] px-4 pb-10 pt-12 md:px-6 md:pt-16">
          <div id="roster-title">
            {/* Owner, 2026-10-17: applying lives in the signed-in profile menu, and artists join
                through their label's link; the public roster does not advertise it. */}
            <PageIntro eyebrow="Label" title={title} lede={lede} />
          </div>
        </div>
      </LitSurface>
      <div className="mx-auto max-w-[90rem] space-y-12 px-4 pb-16 md:px-6">
        {list.status === "loading" ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-6 lg:grid-cols-4 xl:grid-cols-5">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="aspect-[4/5] w-full" />
            ))}
          </div>
        ) : list.status === "error" ? (
          <ErrorState title={`${title} unavailable`} message={loadErrorMessage(list.error, title.toLowerCase())} action={<RetryButton onClick={list.reload} />} />
        ) : list.data.length === 0 ? (
          <EmptyState title={`No ${title.toLowerCase()} yet`} />
        ) : (
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-6 lg:grid-cols-4 xl:grid-cols-5">
            {list.data.map((row) => (
              <li key={`${row.kind ?? kind}-${row.id}`}>
                <RosterCard row={row} kind={kind} />
              </li>
            ))}
          </ul>
        )}
        {staff ? <StaffTools kind={kind} loadWorkspace={loadWorkspace} create={create} /> : null}
      </div>
    </main>
  );
}
