"use client";

/* Developer board for the release plan (D-RELEASE-PLAN-01). SAMPLE CONTENT shaped like the
 * /studio/releases/{id} answer; buttons here would call the real API and are not meant to be pressed. */

import { ReleasePlanView } from "@/components/release-plan/release-plan";
import { ReleaseDecision } from "@/components/staff/release-decision";
import { PresalePanel } from "@/components/studio/presale-panel";
import type { ReleasePlan, StudioPresale, StudioReleaseDetail } from "@/features/studio/api";

const HOUR = 3600_000;
const iso = (h: number) => new Date(Date.UTC(2026, 10, 13, 12) + h * HOUR).toISOString();

function sample(over: { status: string; plan: Partial<ReleasePlan>; presale?: Partial<StudioPresale>; missing?: string[] }): StudioReleaseDetail {
  return {
    release: { id: "sample", title: "Sample Title", release_type: "SINGLE", status: over.status, release_at: over.plan.release_day ?? null, release_timezone: "Asia/Dhaka", track_sales: "RELEASE_ONLY", intake_mode: "ASSISTED", version: 1 },
    plan: { stage: "MAKING", date_passed: false, goes_out_by_itself: false, staff_actions: [], ...over.plan },
    presale: {
      status: null, requested_release_at: null, release_at: null, note: null, requested_at: null, decided_at: null,
      price: { status: "ACCEPTED", amount_minor: 2600, currency_code: "BDT" }, price_live: true, listed: false, open: false,
      can_request: false, can_withdraw: false, email: null, ...over.presale,
    },
    profile: { kind: "artist", id: "a", display_name: "Sample Artist" },
    viewer_role: "staff",
    display_state: over.status === "METADATA_REVIEW" ? "IN_REVIEW" : over.status,
    tracks: [{ id: "t", position: 1, title: "Sample Song", status: "SUBMITTED", explicit: false, version: 1, audio: [{ version_id: "v", status: "READY", is_current: true, has_audio: true }], credits: [] }],
    readiness: { ready: !(over.missing ?? []).length, items: (over.missing ?? []).map((code) => ({ code, ok: false })) },
    proposals: [],
    intake: null,
    history: [],
  };
}

const SCENES: { name: string; detail: StudioReleaseDetail }[] = [
  {
    name: "Pre-sale live, music still being made",
    detail: sample({ status: "IN_PRODUCTION", plan: { release_day: iso(48), release_day_kind: "SET", staff_actions: ["presale_move_date", "cancel_presale"] }, presale: { status: "APPROVED", release_at: iso(48), listed: true, open: true }, missing: ["COVER", "TRACK_AUDIO"] }),
  },
  {
    name: "Pre-sale waiting for staff",
    detail: sample({ status: "IN_PRODUCTION", plan: { release_day: iso(72), release_day_kind: "REQUESTED", staff_actions: ["presale_approve", "presale_return"] }, presale: { status: "REQUESTED", requested_release_at: iso(72), price: { status: "PROPOSED", amount_minor: 2600, currency_code: "BDT" }, can_withdraw: true } }),
  },
  {
    name: "Music in review, approval schedules the pre-sale date",
    detail: sample({ status: "METADATA_REVIEW", plan: { stage: "IN_REVIEW", release_day: iso(48), release_day_kind: "SET", approve_schedules_for: iso(48), staff_actions: ["approve", "request_changes", "presale_move_date", "cancel_presale"] }, presale: { status: "APPROVED", release_at: iso(48), listed: true, open: true } }),
  },
  {
    name: "Music in review, the pre-sale date has passed (today's case)",
    detail: sample({ status: "METADATA_REVIEW", plan: { stage: "IN_REVIEW", release_day: iso(-18), release_day_kind: "SET", date_passed: true, staff_actions: ["approve", "request_changes", "presale_move_date", "cancel_presale"] }, presale: { status: "APPROVED", release_at: iso(-18), listed: true, open: false } }),
  },
  {
    name: "Scheduled, goes out by itself",
    detail: sample({ status: "SCHEDULED", plan: { stage: "SCHEDULED", release_day: iso(48), release_day_kind: "SET", goes_out_by_itself: true, staff_actions: ["schedule", "release", "request_changes", "takedown", "cancel_presale"] }, presale: { status: "APPROVED", release_at: iso(48), listed: true, open: true } }),
  },
];

export function ReleasePlanBoard() {
  return (
    <div className="grid gap-12">
      <section data-theme="staff" className="cr-scope grid gap-10 bg-surface p-6">
        <h2 className="text-2xl font-bold text-fg">Staff release workspace</h2>
        {SCENES.map((s) => (
          <div key={s.name} className="grid gap-4 border-t border-line pt-6">
            <p className="font-mono text-xs text-fg-muted">{s.name}</p>
            <ReleasePlanView detail={s.detail} viewer="staff" />
            <ReleaseDecision detail={s.detail} onDone={() => undefined} />
          </div>
        ))}
      </section>
      <section data-theme="artist-studio" className="cr-scope grid gap-10 bg-surface p-6">
        <h2 className="text-2xl font-bold text-fg">Artist Studio</h2>
        {SCENES.slice(0, 3).map((s) => (
          <div key={s.name} className="grid gap-4 border-t border-line pt-6">
            <p className="font-mono text-xs text-fg-muted">{s.name}</p>
            <ReleasePlanView detail={{ ...s.detail, viewer_role: "owner", plan: { ...s.detail.plan!, staff_actions: [] } }} viewer="artist" onGo={() => undefined} />
          </div>
        ))}
        <div className="grid gap-4 border-t border-line pt-6">
          <p className="font-mono text-xs text-fg-muted">Pre-sale part</p>
          <PresalePanel detail={{ ...SCENES[0].detail, viewer_role: "owner" }} reload={() => undefined} priceRow={<p className="text-sm text-fg">Agreed: ৳26</p>} />
        </div>
      </section>
    </div>
  );
}
