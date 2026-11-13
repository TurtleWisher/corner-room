"use client";

/* The release plan (owner, 2026-11-13, D-RELEASE-PLAN-01): the pre-sale and the music as two
 * tracks that meet on release day, in one row of three steps, with the one next thing to do. The
 * same picture in the Artist Studio and the staff release workspace; words come from
 * lib/release-plan-view.ts and every state from the API. */

import { ArrowRight, Circle, CircleAlert, CircleCheck, CircleDashed, CircleDot, Hourglass } from "lucide-react";

import { Button, Card } from "@/components/ds";
import type { StudioReleaseDetail } from "@/features/studio/api";
import { artistNextStep, planSteps, type NextStep, type PlanStep, type StepState, type Viewer } from "@/lib/release-plan-view";
import type { ReleasePart } from "@/lib/release-tabs-view";
import { cn } from "@/lib/utils";

const STATE_WORD: Record<StepState, string> = {
  done: "Done",
  now: "To do now",
  waiting: "Waiting",
  todo: "Coming up",
  problem: "Needs attention",
  skipped: "Not used",
};

const BAR: Record<StepState, string> = {
  done: "bg-success",
  now: "bg-highlight",
  waiting: "bg-info",
  todo: "bg-line-strong",
  problem: "bg-danger",
  skipped: "bg-line",
};

const ICON_TONE: Record<StepState, string> = {
  done: "text-success",
  now: "text-highlight",
  waiting: "text-info",
  todo: "text-fg-muted",
  problem: "text-danger",
  skipped: "text-fg-muted",
};

function StepIcon({ state }: { state: StepState }) {
  const cls = cn("size-4 shrink-0", ICON_TONE[state]);
  if (state === "done") return <CircleCheck aria-hidden="true" className={cls} />;
  if (state === "now") return <CircleDot aria-hidden="true" className={cls} />;
  if (state === "waiting") return <Hourglass aria-hidden="true" className={cls} />;
  if (state === "problem") return <CircleAlert aria-hidden="true" className={cls} />;
  if (state === "skipped") return <CircleDashed aria-hidden="true" className={cls} />;
  return <Circle aria-hidden="true" className={cls} />;
}

function Step({ step, index, onGo }: { step: PlanStep; index: number; onGo?: (part: ReleasePart) => void }) {
  return (
    <Card as="li" tone="solid" className="relative flex min-w-0 flex-col p-4" data-state={step.state}>
      <span aria-hidden="true" className={cn("absolute inset-x-0 top-0 h-1", BAR[step.state])} />
      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-fg-muted">
        <span className="cr-num inline-flex size-5 items-center justify-center border border-line-strong text-[0.6875rem] text-fg">{index + 1}</span>
        {step.title}
        {step.id === "presale" ? <span className="font-normal normal-case tracking-normal">(optional)</span> : null}
      </p>
      <p className="mt-3 flex items-start gap-2 font-semibold text-fg">
        <StepIcon state={step.state} />
        <span className="min-w-0 break-words">
          <span className="sr-only">{STATE_WORD[step.state]}: </span>
          {step.status}
        </span>
      </p>
      <p className="mt-1 text-sm text-fg-muted">{step.detail}</p>
      {onGo ? (
        <button
          type="button"
          onClick={() => onGo(step.part)}
          className="cr-focus mt-auto inline-flex items-center gap-1 self-start pt-3 text-sm font-semibold text-link underline-offset-4 hover:underline"
        >
          Open {step.part === "presale" ? "Pre-sale" : step.part === "review" ? "Review" : step.part === "songs" ? "Songs" : step.part === "price" ? "Price" : "Details"}
          <ArrowRight aria-hidden="true" className="size-3.5" />
        </button>
      ) : null}
    </Card>
  );
}

const NEXT_TONE: Record<NextStep["tone"], string> = {
  action: "border-highlight/60",
  wait: "border-info/50",
  good: "border-success/50",
  problem: "border-danger/60",
};

export function NextStepBar({ next, onGo }: { next: NextStep; onGo?: (part: ReleasePart) => void }) {
  return (
    <div role="status" className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 border-l-4 bg-surface-raised px-4 py-3", NEXT_TONE[next.tone])}>
      <p className="min-w-0 flex-1 text-sm text-fg">
        <span className="mr-2 text-xs font-semibold uppercase tracking-[0.08em] text-fg-muted">Next</span>
        {next.text}
      </p>
      {next.part && next.cta && onGo ? (
        <Button size="sm" onClick={() => onGo(next.part!)}>
          {next.cta} <ArrowRight aria-hidden="true" />
        </Button>
      ) : null}
    </div>
  );
}

/** Three steps (Pre-sale, The music, Release day), and for the artist the next thing to do. */
export function ReleasePlanView({
  detail,
  viewer,
  onGo,
  className,
}: {
  detail: StudioReleaseDetail;
  viewer: Viewer;
  onGo?: (part: ReleasePart) => void;
  className?: string;
}) {
  const steps = planSteps(detail, viewer);
  return (
    <section aria-labelledby="release-plan-title" className={cn("grid gap-3", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="release-plan-title" className="text-base font-bold text-fg">
          Release plan
        </h2>
        <p className="text-xs text-fg-muted">Pre-sale and music meet on release day · times in Dhaka time</p>
      </div>
      <ol className="grid gap-3 md:grid-cols-3">
        {steps.map((s, i) => (
          <Step key={s.id} step={s} index={i} onGo={onGo} />
        ))}
      </ol>
      {viewer === "artist" ? <NextStepBar next={artistNextStep(detail)} onGo={onGo} /> : null}
    </section>
  );
}
