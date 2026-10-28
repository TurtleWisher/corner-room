"use client";

/*
 * Set up or change a gift campaign (owner, 2026-10-28, D-CAMPAIGN-01, D-CAMPAIGN-02): what the gift
 * is, which music it covers, who sends it, whether pre-sale buyers count and from when purchases
 * count. A draft saves at once; a change to a live campaign waits for Corner Room.
 */

import { FormEvent, useState } from "react";
import { ChevronDown, Save } from "lucide-react";

import { Button, Field, Input, Select } from "@/components/ds";
import { Textarea } from "@/components/ds/input";
import { useAsync } from "@/components/use-async";
import type { GiftCampaign, GiftCampaignInput, GiftWork } from "@/features/gifts/api";
import { fetchProfileReleases, fetchStudioRelease, type ReleaseCard } from "@/features/studio/api";
import { ApiError } from "@/lib/api/client";
import { RELEASE_TYPE_LABEL } from "@/lib/studio-view";

const key = (w: GiftWork) => `${w.type}:${w.id}`;

/** One album or EP: tick the whole release, or open it to pick its songs. */
function ReleaseChoice({ release, chosen, toggle }: { release: ReleaseCard; chosen: Set<string>; toggle: (w: GiftWork) => void }) {
  const [open, setOpen] = useState(false);
  const tracks = useAsync(async () => (open ? (await fetchStudioRelease(release.id)).tracks : []), [open, release.id]);
  const whole: GiftWork = { type: "RELEASE", id: release.id };
  return (
    <li className="border-b border-line py-2">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex flex-1 items-center gap-2 text-sm text-fg">
          <input type="checkbox" checked={chosen.has(key(whole))} onChange={() => toggle(whole)} />
          <span className="font-semibold">{release.title}</span>
          <span className="text-fg-muted">{RELEASE_TYPE_LABEL[release.release_type] ?? release.release_type}</span>
        </label>
        {release.release_type !== "SINGLE" ? (
          <button type="button" className="cr-focus inline-flex items-center gap-1 text-xs font-semibold text-link" onClick={() => setOpen(!open)}>
            Choose songs <ChevronDown aria-hidden="true" className={`size-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
        ) : null}
      </div>
      {open && tracks.status === "ok" ? (
        <ul className="ml-6 mt-1">
          {tracks.data.map((t) => {
            const w: GiftWork = { type: "TRACK", id: t.id };
            return (
              <li key={t.id}>
                <label className="flex items-center gap-2 py-1 text-sm text-fg">
                  <input type="checkbox" checked={chosen.has(key(w))} onChange={() => toggle(w)} />
                  {t.position}. {t.title}
                </label>
              </li>
            );
          })}
        </ul>
      ) : null}
    </li>
  );
}

export function CampaignForm({
  profile,
  initial,
  submitLabel,
  onSave,
}: {
  profile: { kind: "artist" | "band"; id: string };
  initial?: GiftCampaign | null;
  submitLabel: string;
  onSave: (body: GiftCampaignInput) => Promise<unknown>;
}) {
  const releases = useAsync(() => fetchProfileReleases(profile.kind, profile.id), [profile.kind, profile.id]);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [items, setItems] = useState(initial?.gift_items ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [sender, setSender] = useState<"ARTIST" | "CORNER_ROOM">(initial?.sender ?? "ARTIST");
  const [presale, setPresale] = useState(initial?.include_presale ?? false);
  const [from, setFrom] = useState(initial?.counts_from ? initial.counts_from.slice(0, 10) : "");
  const [works, setWorks] = useState<GiftWork[]>(initial?.works.map((w) => ({ type: w.type, id: w.id })) ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chosen = new Set(works.map(key));

  const toggle = (w: GiftWork) => setWorks((list) => (list.some((x) => key(x) === key(w)) ? list.filter((x) => key(x) !== key(w)) : [...list, w]));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSave({
        title,
        gift_items: items,
        description: description.trim() || null,
        sender,
        include_presale: presale,
        // Midnight in Dhaka (UTC+6) on the chosen day.
        counts_from: from ? `${from}T00:00:00+06:00` : null,
        works,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The campaign couldn't be saved.");
    } finally {
      setBusy(false);
    }
  }

  const music = releases.status === "ok" ? releases.data.filter((r) => ["APPROVED", "SCHEDULED", "RELEASED"].includes(r.status)) : [];
  return (
    <form onSubmit={submit} className="grid gap-4">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Campaign name" required>
          {(c) => <Input {...c} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="Launch gift" />}
        </Field>
        <Field label="What the gift is" required hint="Fans see this, e.g. a signed poster and a sticker">
          {(c) => <Input {...c} value={items} onChange={(e) => setItems(e.target.value)} maxLength={500} />}
        </Field>
      </div>
      <Field label="A note for fans" hint="Optional">
        {(c) => <Textarea {...c} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={4000} rows={3} />}
      </Field>
      <fieldset>
        <legend className="text-[0.8125rem] font-semibold text-fg">Which music</legend>
        <p className="mt-1 text-sm text-fg-muted">Everyone who buys what you tick here while the campaign is live gets the gift.</p>
        {releases.status === "loading" ? (
          <p className="mt-2 text-sm text-fg-muted">Loading your music</p>
        ) : music.length === 0 ? (
          <p className="mt-2 text-sm text-fg">No approved or released music yet.</p>
        ) : (
          <ul className="mt-2 border-t border-line">
            {music.map((r) => (
              <ReleaseChoice key={r.id} release={r} chosen={chosen} toggle={toggle} />
            ))}
          </ul>
        )}
      </fieldset>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Who sends the gifts">
          {(c) => (
            <Select {...c} value={sender} onChange={(e) => setSender(e.target.value as "ARTIST" | "CORNER_ROOM")}>
              <option value="ARTIST">I do (you see each buyer&apos;s name, phone and address to post them)</option>
              <option value="CORNER_ROOM">Corner Room&apos;s team</option>
            </Select>
          )}
        </Field>
        <Field label="Count purchases from" hint="Leave empty to count from when the campaign goes live">
          {(c) => <Input {...c} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />}
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm text-fg">
        <input type="checkbox" checked={presale} onChange={(e) => setPresale(e.target.checked)} />
        Pre-sale buyers of this music get it too
      </label>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <div>
        <Button type="submit" busy={busy}>
          <Save aria-hidden="true" /> {submitLabel}
        </Button>
      </div>
    </form>
  );
}
