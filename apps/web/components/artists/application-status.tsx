"use client";

/* Where an artist application stands, from the API, in the applicant's words. */

import { CircleAlert, CircleCheck, Clock, Music } from "lucide-react";

import { ButtonLink, Card, DateTime } from "@/components/ds";
import type { ApplicationRecord } from "@/features/artists/api";
import { applicationStage } from "@/lib/onboarding-view";

export function ApplicationStatus({ app, labelName, bare = false }: { app: ApplicationRecord; labelName?: string | null; bare?: boolean }) {
  const stage = applicationStage(app);
  const Icon = stage.tone === "good" ? CircleCheck : stage.tone === "attention" ? CircleAlert : Clock;
  const Frame = bare ? BareFrame : CardFrame;
  return (
    <Frame>
      <p className={`flex items-center gap-2 text-lg font-bold ${stage.tone === "attention" ? "text-danger" : "text-fg"}`}>
        <Icon aria-hidden="true" className={`size-6 ${stage.tone === "good" ? "text-success" : stage.tone === "attention" ? "" : "text-highlight"}`} /> {stage.title}
      </p>
      {app.stage_name ? <p className="mt-1 font-semibold text-fg">{app.stage_name}</p> : null}
      <p className="mt-2 text-sm text-fg">{labelName && stage.tone === "progress" ? stage.body.replace("The label team", `The ${labelName} team`) : stage.body}</p>
      {app.created_at ? (
        <p className="mt-1 text-xs text-fg-muted">
          Applied <DateTime value={app.created_at} format="date" />
        </p>
      ) : null}
      {app.status === "APPROVED" && app.artist_status === "ACTIVE" ? (
        <ButtonLink href="/studio" className="mt-4">
          <Music aria-hidden="true" /> Open Studio
        </ButtonLink>
      ) : null}
    </Frame>
  );
}

function CardFrame({ children }: { children: React.ReactNode }) {
  return (
    <Card className="max-w-xl p-6" role="status">
      {children}
    </Card>
  );
}

/** Inside a card that is already there (the join pages). */
function BareFrame({ children }: { children: React.ReactNode }) {
  return <div role="status">{children}</div>;
}
