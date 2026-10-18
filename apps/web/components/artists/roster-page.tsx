"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

import { useAuth } from "@/components/auth-provider";
import { LitSurface } from "@/components/brand/corner-light";
import { Avatar, Button, Card, EmptyState, ErrorState, Field, Input, Skeleton, StatusChip, Table, TBody, TD, TH, THead, TR } from "@/components/ds";
import { PageIntro, RetryButton, StaffPanel } from "@/components/shell/staff-panel";
import { loadErrorMessage, useAsync } from "@/components/use-async";
import { useWorkspace } from "@/components/workspace-provider";
import { ApiError } from "@/lib/api";
import { rowsForActiveOrg } from "@/lib/workspace-view";

export type RosterEntry = { id: string; name: string; bio: string | null; status: string; primary_org_id?: string | null };

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
 * Public roster (Artists module, Ember): a grid of monogram portraits (OD-05: no portraits served
 * yet), name and the first line of the bio. Staff get the workspace roster and the create form in
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
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-5">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="aspect-square w-full" />
            ))}
          </div>
        ) : list.status === "error" ? (
          <ErrorState title={`${title} unavailable`} message={loadErrorMessage(list.error, title.toLowerCase())} action={<RetryButton onClick={list.reload} />} />
        ) : list.data.length === 0 ? (
          <EmptyState title={`No ${title.toLowerCase()} yet`} />
        ) : (
          <ul className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-5">
            {list.data.map((row) => (
              <li key={row.id}>
                <Link href={`/${kind}s/${row.id}`} className="cr-focus group block">
                  <Card className="flex flex-col items-start gap-4 p-5 group-hover:[--cut-border:var(--cr-line-strong)]">
                    <Avatar name={row.name} size={88} />
                    <div className="min-w-0">
                      <h2 className="truncate text-lg font-bold text-fg group-hover:text-highlight">{row.name}</h2>
                      <p className="mt-1 line-clamp-2 text-sm text-fg-muted">{row.bio || (kind === "band" ? "Band" : "Artist")}</p>
                    </div>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {staff ? <StaffTools kind={kind} loadWorkspace={loadWorkspace} create={create} /> : null}
      </div>
    </main>
  );
}
