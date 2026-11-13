/*
 * The release plan (owner, 2026-11-13, D-RELEASE-PLAN-01): a release's pre-sale and its music are
 * two tracks that meet on release day. These helpers put the API's plan into words for the Studio
 * and the staff release workspace: three steps (Pre-sale, The music, Release day) and the one next
 * thing to do. Words only: the API decides every state, date and allowed step.
 */

import type { ReleasePlan, StudioReleaseDetail } from "@/features/studio/api";
import { formatDateTime } from "@/lib/format/date";
import { studioPresaleStage } from "@/lib/presale-view";
import type { ReleasePart } from "@/lib/release-tabs-view";
import { missingByPart } from "@/lib/release-tabs-view";

export type StepState = "done" | "now" | "waiting" | "todo" | "problem" | "skipped";

export type PlanStep = {
  id: "presale" | "music" | "release";
  title: string;
  state: StepState;
  /** Short status, e.g. "Live", "With Corner Room". */
  status: string;
  /** One sentence under it. */
  detail: string;
  /** The Studio part that works on this step. */
  part: ReleasePart;
};

export type Viewer = "artist" | "staff";

type PlanInput = Pick<StudioReleaseDetail, "release" | "presale" | "readiness" | "history" | "plan">;

const EMPTY_PLAN: ReleasePlan = { stage: "MAKING", date_passed: false, goes_out_by_itself: false, staff_actions: [] };

/** "Fri 13 Nov 2026, 12:00 AM" in Dhaka time (D-TIME-01). */
export function dhaka(iso: string | null | undefined): string {
  return formatDateTime(iso) ?? "a date not set yet";
}

function planOf(d: PlanInput): ReleasePlan {
  return d.plan ?? EMPTY_PLAN;
}

/** Corner Room sent the music back and the artist hasn't sent it again yet. */
export function musicSentBack(d: Pick<StudioReleaseDetail, "history" | "release">): string | null {
  const last = d.history[0];
  if (!last || last.action !== "request_changes") return null;
  if (!["IDEA", "DEMO", "IN_PRODUCTION", "QC"].includes(d.release.status)) return null;
  return last.note?.trim() || "Corner Room asked for changes.";
}

function missingTotal(d: PlanInput): number {
  return d.readiness.items.filter((i) => !i.ok).length;
}

/** The first Studio part that still needs something, for the "Finish" button. */
export function firstMissingPart(d: PlanInput): ReleasePart {
  const by = missingByPart(d.readiness.items);
  const order: ReleasePart[] = ["details", "songs", "price"];
  return order.find((p) => (by[p] ?? 0) > 0) ?? "review";
}

function presaleStep(d: PlanInput, viewer: Viewer): PlanStep {
  const base = { id: "presale" as const, title: "Pre-sale", part: "presale" as ReleasePart };
  const p = d.presale;
  const plan = planOf(d);
  const out = ["RELEASED", "TAKEN_DOWN", "ARCHIVED"].includes(d.release.status);
  if (!p || out) {
    return { ...base, state: "skipped", status: out ? "Over" : "Optional", detail: out ? "The music is out, so pre-orders have ended." : "Take pre-orders before release day." };
  }
  const stage = studioPresaleStage(p, d.release.status);
  const day = p.release_at ?? p.requested_release_at;
  switch (stage) {
    case "live":
      return { ...base, state: "done", status: "Live", detail: `Fans can pre-book until ${dhaka(p.release_at)}.` };
    case "closed":
      return { ...base, state: "done", status: "Closed", detail: "The date has passed, so pre-orders are closed. Buyers keep their pre-orders." };
    case "waiting":
      return {
        ...base,
        state: "waiting",
        status: viewer === "staff" ? "Waiting for you" : "With Corner Room",
        detail: `Title, date (${dhaka(day)}) and price are being checked.`,
      };
    case "returned":
      return { ...base, state: "problem", status: "Sent back", detail: p.note?.trim() || "Change what Corner Room asked and send it again." };
    case "approved_waiting_price":
      return { ...base, state: "waiting", status: "Approved", detail: "Fans can pre-book once the pre-sale price is agreed." };
    case "scheduled":
      return { ...base, state: "skipped", status: "Not taking pre-orders", detail: "A pre-sale price would let fans pre-book until release day." };
    case "ready_to_send":
      return { ...base, state: "todo", status: "Ready to send", detail: "Choose the release date and send the pre-sale for review." };
    case "price_needed":
      return { ...base, state: "todo", status: "Optional", detail: "Propose a pre-sale price, then a date, to take pre-orders." };
    default:
      return {
        ...base,
        state: "skipped",
        status: plan.stage === "MAKING" || plan.stage === "IN_REVIEW" ? "Optional" : "Not used",
        detail: "Take pre-orders before release day.",
      };
  }
}

function musicStep(d: PlanInput, viewer: Viewer): PlanStep {
  const base = { id: "music" as const, title: "The music", part: "review" as ReleasePart };
  const plan = planOf(d);
  switch (plan.stage) {
    case "IN_REVIEW":
      return {
        ...base,
        state: "waiting",
        status: viewer === "staff" ? "Waiting for you" : "With Corner Room",
        detail: "Songs, audio, cover, details and price are being checked.",
      };
    case "APPROVED":
    case "APPROVED_DATE_PASSED":
    case "SCHEDULED":
    case "OVERDUE":
      return { ...base, state: "done", status: "Approved", detail: "Songs, audio, cover, details and price are approved." };
    case "RELEASED":
      return { ...base, state: "done", status: "Out", detail: "Everyone can buy and play it." };
    case "TAKEN_DOWN":
    case "ARCHIVED":
      return { ...base, state: "skipped", status: "Taken down", detail: "It is no longer in the catalog." };
    default: {
      const back = musicSentBack(d);
      if (back) return { ...base, state: "problem", status: "Sent back", detail: back };
      const n = missingTotal(d);
      if (n > 0) {
        return {
          ...base,
          state: "now",
          status: `${n} ${n === 1 ? "thing" : "things"} missing`,
          part: firstMissingPart(d),
          detail: viewer === "staff" ? "The artist is still finishing it." : "Add the songs, audio, cover, details and price, then send it in.",
        };
      }
      return {
        ...base,
        state: "now",
        status: "Ready to send",
        detail: viewer === "staff" ? "Everything is in. The artist sends it for review." : "Everything is in. Send it to Corner Room for review.",
      };
    }
  }
}

function releaseStep(d: PlanInput, viewer: Viewer): PlanStep {
  const base = { id: "release" as const, title: "Release day", part: (d.presale ? "presale" : "review") as ReleasePart };
  const plan = planOf(d);
  const day = plan.release_day;
  switch (plan.stage) {
    case "RELEASED":
      return { ...base, state: "done", status: "Out", detail: day ? `Came out ${dhaka(day)}.` : "It's out." };
    case "SCHEDULED":
      return {
        ...base,
        state: "done",
        status: dhaka(day),
        detail: plan.goes_out_by_itself ? "Goes out by itself. Nobody needs to press anything." : "Scheduled. A song's audio still has to be ready.",
      };
    case "OVERDUE":
      return {
        ...base,
        state: "problem",
        status: "Late",
        detail: viewer === "staff" ? "Its date passed but a song's audio isn't ready, so it couldn't go out." : "Its date passed. Corner Room is looking at it.",
      };
    case "APPROVED_DATE_PASSED":
      return {
        ...base,
        state: "problem",
        status: "Date passed",
        detail: viewer === "staff" ? "Release it now or set a new date." : "The pre-sale date passed. Corner Room releases it now or sets a new date.",
      };
    case "APPROVED":
      return { ...base, state: "waiting", status: "No date yet", detail: viewer === "staff" ? "Schedule it or release it now." : "Corner Room sets the release date." };
    case "TAKEN_DOWN":
    case "ARCHIVED":
      return { ...base, state: "skipped", status: "Not out", detail: "Taken down." };
    default:
      break;
  }
  if (day && plan.release_day_kind === "SET") {
    if (plan.date_passed) {
      return {
        ...base,
        state: "problem",
        status: "Date passed",
        detail:
          viewer === "staff"
            ? "Buyers are waiting. Approving the music lets you release it now or set a new date."
            : "Buyers are waiting. Finish and send the music in so Corner Room can release it.",
      };
    }
    return { ...base, state: "todo", status: dhaka(day), detail: "Goes out by itself on this date once the music is approved." };
  }
  if (day) return { ...base, state: "todo", status: dhaka(day), detail: "The date you asked for. It is set once the pre-sale is approved." };
  return {
    ...base,
    state: "todo",
    status: "Not set",
    detail: viewer === "staff" ? "Set it with the pre-sale, or when you approve the music." : "Set it with a pre-sale, or Corner Room sets it when it approves the music.",
  };
}

/** The three steps, in order. */
export function planSteps(d: PlanInput, viewer: Viewer): PlanStep[] {
  return [presaleStep(d, viewer), musicStep(d, viewer), releaseStep(d, viewer)];
}

export type NextStep = {
  tone: "action" | "wait" | "good" | "problem";
  text: string;
  /** Studio part to open, with the button's words. */
  part?: ReleasePart;
  cta?: string;
};

/** The one thing the artist should do now (or that nothing is needed), in a sentence. */
export function artistNextStep(d: PlanInput): NextStep {
  const plan = planOf(d);
  const p = d.presale;
  const day = plan.release_day;
  if (p?.status === "RETURNED") {
    return { tone: "problem", text: `Corner Room sent your pre-sale back: ${p.note?.trim() || "change it and send it again."}`, part: "presale", cta: "Fix the pre-sale" };
  }
  const back = musicSentBack(d);
  if (back) return { tone: "problem", text: `Corner Room asked for changes: ${back}`, part: firstMissingPart(d), cta: "Make the changes" };
  switch (plan.stage) {
    case "RELEASED":
      return { tone: "good", text: "It's out. Everyone can buy and play it." };
    case "SCHEDULED":
      return { tone: "good", text: `All set. It goes out by itself on ${dhaka(day)}.` };
    case "OVERDUE":
      return { tone: "problem", text: "Its date has passed but it couldn't go out yet. Corner Room is looking at it." };
    case "APPROVED_DATE_PASSED":
      return { tone: "wait", text: "Approved. The pre-sale date has passed, so Corner Room releases it now or sets a new date." };
    case "APPROVED":
      return { tone: "wait", text: "Approved. Corner Room sets the release date." };
    case "IN_REVIEW":
      return {
        tone: "wait",
        text: plan.approve_schedules_for
          ? `Nothing to do. Corner Room is checking the music; once approved it goes out by itself on ${dhaka(plan.approve_schedules_for)}.`
          : plan.date_passed
            ? "Nothing to do. Corner Room is checking the music and will release it as soon as it's approved."
            : "Nothing to do. Corner Room is checking the music.",
      };
    case "TAKEN_DOWN":
    case "ARCHIVED":
      return { tone: "wait", text: "This release is taken down." };
    default:
      break;
  }
  const n = missingTotal(d);
  const dated = day && plan.release_day_kind === "SET";
  if (dated && plan.date_passed) {
    return {
      tone: "problem",
      text: n > 0 ? `The release date has passed and buyers are waiting. ${n} ${n === 1 ? "thing is" : "things are"} still missing.` : "The release date has passed and buyers are waiting. Send the music in now.",
      part: n > 0 ? firstMissingPart(d) : "review",
      cta: n > 0 ? "Finish the music" : "Send for review",
    };
  }
  if (n > 0) {
    return {
      tone: "action",
      text: dated
        ? `Finish the music and send it in before ${dhaka(day)} so it comes out on time. ${n} ${n === 1 ? "thing is" : "things are"} missing.`
        : `${n} ${n === 1 ? "thing is" : "things are"} still missing before you can send the music in.`,
      part: firstMissingPart(d),
      cta: "Finish the music",
    };
  }
  return {
    tone: "action",
    text: dated ? `Everything is in. Send it for review; once approved it goes out by itself on ${dhaka(day)}.` : "Everything is in. Send it to Corner Room for review.",
    part: "review",
    cta: "Send for review",
  };
}

export type StaffAction =
  | "approve"
  | "request_changes"
  | "schedule"
  | "release"
  | "takedown"
  | "back_to_presale"
  | "presale_approve"
  | "presale_return"
  | "presale_move_date"
  | "cancel_presale";

/** Whether the API allows this step now (staff only). */
export function can(plan: ReleasePlan | undefined, action: StaffAction): boolean {
  return Boolean(plan?.staff_actions.includes(action));
}

/** The headline of the staff decision card. */
export function staffHeadline(d: PlanInput): { tone: NextStep["tone"]; title: string; text: string } {
  const plan = planOf(d);
  if (can(plan, "presale_approve")) {
    return { tone: "action", title: "A pre-sale is waiting for you", text: "Approve the title, artist, date and price going public, or send it back with a note." };
  }
  switch (plan.stage) {
    case "IN_REVIEW":
      if (plan.approve_schedules_for) {
        return { tone: "action", title: "The music is waiting for you", text: `Approving it schedules it for the pre-sale date, ${dhaka(plan.approve_schedules_for)}. It then goes out by itself.` };
      }
      if (plan.date_passed) {
        return { tone: "problem", title: "The music is waiting, and its date has passed", text: `The pre-sale date (${dhaka(plan.release_day)}) has gone and buyers are waiting. Approve and release it now, or approve it with a new date.` };
      }
      return { tone: "action", title: "The music is waiting for you", text: "Approve it, with a release date if you know one, or send it back with a note." };
    case "APPROVED_DATE_PASSED":
      return { tone: "problem", title: "Approved, but its date has passed", text: `The pre-sale date (${dhaka(plan.release_day)}) has gone. Release it now, or set a new date (buyers are emailed).` };
    case "APPROVED":
      return { tone: "action", title: "Approved, with no release date", text: "Schedule it so it goes out by itself, or release it now." };
    case "SCHEDULED":
      return {
        tone: "good",
        title: `Goes out by itself on ${dhaka(plan.release_day)}`,
        text: plan.goes_out_by_itself ? "Nothing is needed. You can move the date (buyers are emailed) or release it early." : "A song's audio isn't ready yet; it goes out once it is.",
      };
    case "OVERDUE":
      return { tone: "problem", title: "Its date passed but it couldn't go out", text: "A song's audio isn't ready. Fix the audio, then release it now." };
    case "RELEASED":
      return { tone: "good", title: "It's out", text: "Nothing is needed." };
    case "TAKEN_DOWN":
    case "ARCHIVED":
      return { tone: "wait", title: "Taken down", text: "Nothing is needed." };
    default:
      if (plan.date_passed && plan.release_day_kind === "SET") {
        const n = missingTotal(d);
        return {
          tone: "problem",
          title: "Its date has passed, and the music hasn't been sent in",
          text:
            (n > 0
              ? `Buyers are waiting, and the artist still has ${n} ${n === 1 ? "thing" : "things"} to finish. `
              : "Buyers are waiting. Everything is in, but the artist hasn't sent it for review, so there is nothing to approve yet. ") +
            "Ask them to press Send for review in Studio. If they asked Corner Room to release it for them, turn on managed mode under More actions, then send it in from the Review part.",
        };
      }
      if (d.presale?.status === "APPROVED") {
        return { tone: "wait", title: "Pre-sale approved; the artist is finishing the music", text: `Once they send it in and you approve it, it goes out by itself on ${dhaka(plan.release_day)}.` };
      }
      return { tone: "wait", title: "The artist is still preparing it", text: "Nothing is waiting for you yet." };
  }
}
