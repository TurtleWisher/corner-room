"use client";

import Link from "next/link";
import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";

import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ds";
import { Dialog } from "@/components/ds/dialog";
import { useWorkspace } from "@/components/workspace-provider";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * "Acting in" workspace chip for the staff console (audit section 12), always visible. The active
 * organization comes from the session; switching calls POST /organizations/{id}/switch through
 * WorkspaceProvider. The client never asserts an organization on its own.
 */
export function WorkspaceChip({ className }: { className?: string }) {
  const { status } = useAuth();
  const { organizations, currentOrg, loading, error, switchTo } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);

  const name =
    status === "loading"
      ? "Loading workspace"
      : status !== "authenticated"
        ? "Not signed in"
        : (currentOrg?.name ?? (loading ? "Loading workspace" : "No workspace selected"));

  async function choose(orgId: string) {
    setPending(orgId);
    setSwitchError(null);
    try {
      await switchTo(orgId);
      setOpen(false);
    } catch (err) {
      setSwitchError(err instanceof ApiError ? err.message : "The workspace could not be switched. Please try again.");
    } finally {
      setPending(null);
    }
  }

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className={cn("cr-focus flex w-full min-w-0 flex-col border border-line-strong bg-surface-sunken px-3 py-2 text-left", className)}
      >
        <span className="cr-eyebrow text-[0.625rem] text-fg-muted">Acting in</span>
        <span className="mt-0.5 flex min-w-0 items-center gap-2">
          <span className={cn("min-w-0 flex-1 truncate text-sm font-semibold", currentOrg || status !== "authenticated" ? "text-fg" : "text-warning")}>
            {name}
          </span>
          <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-fg" />
          {currentOrg?.type ? <span className="cr-eyebrow shrink-0 text-[0.5625rem] text-fg">{currentOrg.type}</span> : null}
        </span>
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Switch workspace"
        description="Staff pages act in the workspace shown here."
        footer={
          <Link href="/organizations" className="cr-focus text-sm font-semibold text-link underline" onClick={() => setOpen(false)}>
            Manage organizations
          </Link>
        }
      >
        {error ? <p className="mb-3 text-danger">{error}</p> : null}
        {switchError ? (
          <p role="alert" className="mb-3 text-danger">
            {switchError}
          </p>
        ) : null}
        {status !== "authenticated" ? (
          <p className="text-fg-muted">
            <Link href="/login" className="cr-focus font-semibold text-link underline" onClick={() => setOpen(false)}>
              Sign in
            </Link>{" "}
            to see your workspaces.
          </p>
        ) : organizations.length === 0 && !loading ? (
          <p className="text-fg-muted">You are not a member of any organization.</p>
        ) : (
          <ul className="grid gap-2">
            {organizations.map((org) => {
              const active = org.id === currentOrg?.id;
              return (
                <li key={org.id}>
                  <Button
                    variant={active ? "secondary" : "ghost"}
                    block
                    className="justify-between"
                    aria-current={active ? "true" : undefined}
                    busy={pending === org.id}
                    disabled={active || pending !== null}
                    onClick={() => void choose(org.id)}
                  >
                    <span className="truncate">{org.name}</span>
                    {active ? (
                      <span className="flex items-center gap-1 text-xs text-fg-muted">
                        <Check aria-hidden="true" /> Current
                      </span>
                    ) : null}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </Dialog>
    </>
  );
}

/**
 * Shown above staff pages when the signed-in user has workspaces but none is active yet, so the
 * page is never a dead end ("Select a workspace"). The user picks; nothing is chosen for them.
 */
export function WorkspacePrompt() {
  const { status } = useAuth();
  const { organizations, currentOrg, loading, switchTo } = useWorkspace();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (status !== "authenticated" || loading || currentOrg || organizations.length === 0) return null;

  async function choose(orgId: string) {
    setPending(orgId);
    setError(null);
    try {
      await switchTo(orgId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The workspace could not be switched. Please try again.");
    } finally {
      setPending(null);
    }
  }

  return (
    <section data-theme="staff" aria-labelledby="workspace-prompt" className="cr-scope border-b border-line px-4 py-5 md:px-6">
      <h2 id="workspace-prompt" className="text-base font-bold text-fg">
        Choose the workspace you are acting in
      </h2>
      <p className="mt-1 text-sm text-fg-muted">Staff pages show and change data for the workspace you choose.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        {organizations.map((org) => (
          <Button key={org.id} variant="secondary" size="sm" busy={pending === org.id} disabled={pending !== null} onClick={() => void choose(org.id)}>
            {org.name}
            {org.type ? <span className="cr-eyebrow text-[0.5625rem] text-fg-muted">{org.type}</span> : null}
          </Button>
        ))}
      </div>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </section>
  );
}
