"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

import { useAuth } from "@/components/auth-provider";
import { LitSurface } from "@/components/brand/corner-light";
import { Button, EmptyState, ErrorState, Field, Input, Select, Skeleton, StatusChip, Table, TBody, TD, TH, THead, TR } from "@/components/ds";
import { useCredits } from "@/components/music/credits";
import { ReleaseCard } from "@/components/music/release-card";
import { PageIntro, RetryButton, StaffPanel } from "@/components/shell/staff-panel";
import { loadErrorMessage, useAsync } from "@/components/use-async";
import { useWorkspace } from "@/components/workspace-provider";
import { ApiError, createRelease, fetchReleases } from "@/lib/api";
import { creditName, releaseTypeLabel, sortReleases } from "@/lib/music-view";
import { RELEASE_STATUS } from "@/lib/status-maps";
import { rowsForActiveOrg } from "@/lib/workspace-view";

const TYPES = ["SINGLE", "EP", "ALBUM", "COMPILATION", "LIVE"];

/** Staff: this workspace's releases in every state, and the create form (behaviour unchanged). */
function ReleaseStaffTools() {
  const { currentOrg } = useWorkspace();
  const workspace = useAsync(() => fetchReleases(), [currentOrg?.id]);
  const [title, setTitle] = useState("");
  const [releaseType, setReleaseType] = useState("SINGLE");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    setBusy(true);
    try {
      await createRelease({ title, release_type: releaseType });
      setTitle("");
      workspace.reload();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "The release could not be created.");
    } finally {
      setBusy(false);
    }
  }

  const rows = workspace.status === "ok" ? rowsForActiveOrg(currentOrg?.id ?? null, workspace.data.items) : [];
  return (
    <StaffPanel description={currentOrg ? `Acting in ${currentOrg.name}` : undefined}>
      <form onSubmit={onCreate} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem_auto] sm:items-end">
        <Field label="New release title">
          {(c) => <Input {...c} value={title} onChange={(e) => setTitle(e.target.value)} required />}
        </Field>
        <Field label="Type">
          {(c) => (
            <Select {...c} value={releaseType} onChange={(e) => setReleaseType(e.target.value)}>
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {releaseTypeLabel(t)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Button type="submit" busy={busy}>
          Create release
        </Button>
      </form>
      {formError ? (
        <p role="alert" className="mt-3 text-danger">
          {formError}
        </p>
      ) : null}
      <div className="mt-6">
        {workspace.status === "loading" ? (
          <Skeleton className="h-24 w-full" />
        ) : workspace.status === "error" ? (
          <p className="text-fg-muted">{loadErrorMessage(workspace.error, "this workspace's releases")}</p>
        ) : rows.length === 0 ? (
          <p className="text-fg-muted">No releases in this workspace.</p>
        ) : (
          <Table label="Workspace releases">
            <THead>
              <TR>
                <TH>Title</TH>
                <TH>Type</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((row) => (
                <TR key={row.id}>
                  <TD>
                    <Link href={`/releases/${row.id}`} className="cr-focus font-semibold text-link underline">
                      {row.title}
                    </Link>
                  </TD>
                  <TD>{releaseTypeLabel(row.release_type)}</TD>
                  <TD>
                    <StatusChip value={row.status} map={RELEASE_STATUS} />
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

export default function ReleasesPage() {
  const { status } = useAuth();
  const { currentOrg } = useWorkspace();
  const credits = useCredits();
  const catalog = useAsync(() => fetchReleases({ skipAuth: true }).then((p) => sortReleases(p.items)), []);
  const staff = status === "authenticated" && Boolean(currentOrg);

  return (
    <main id="main" data-theme="sky" className="cr-scope">
      <LitSurface as="section" theme="sky" aria-labelledby="releases-title">
        <div className="mx-auto max-w-[90rem] px-4 pb-10 pt-12 md:px-6 md:pt-16">
          <div id="releases-title">
            <PageIntro eyebrow="Listening room" title="Releases" lede="Singles, EPs and albums from Corner Room artists." />
          </div>
        </div>
      </LitSurface>
      <div className="mx-auto max-w-[90rem] space-y-12 px-4 pb-16 md:px-6">
        {catalog.status === "loading" ? (
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="aspect-square w-full" />
            ))}
          </div>
        ) : catalog.status === "error" ? (
          <ErrorState title="Releases unavailable" message={loadErrorMessage(catalog.error, "releases")} action={<RetryButton onClick={catalog.reload} />} />
        ) : catalog.data.length === 0 ? (
          <EmptyState title="No releases yet" body="New music will appear here when it is out." />
        ) : (
          <ul className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {catalog.data.map((release) => (
              <li key={release.id}>
                <ReleaseCard release={release} artist={creditName(release, credits.artists, credits.bands)} />
              </li>
            ))}
          </ul>
        )}
        {staff ? <ReleaseStaffTools /> : null}
      </div>
    </main>
  );
}
