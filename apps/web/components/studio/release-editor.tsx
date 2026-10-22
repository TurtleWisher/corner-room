"use client";

/* The Studio release editor (URL-05, design 3 and 5). Every field saves to the API and the page
 * re-renders from the server's answer; nothing here decides permission, readiness or state. */

import { FormEvent, useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, CircleAlert, CircleCheck, Plus, Save, Send, Trash2, Undo2, UserRound } from "lucide-react";

import { Button, Card, DateTime, ErrorState, Field, Input, Money, Select, Skeleton } from "@/components/ds";
import { MediaReport } from "@/components/music/media-report";
import { ArtworkReport } from "@/components/uploads/artwork-report";
import { UploadCard } from "@/components/uploads/upload-card";
import {
  addStudioTrack,
  fetchCoverReport,
  fetchStudioRelease,
  fetchTaxonomy,
  newStudioVersion,
  proposeStudioPrice,
  removeStudioTrack,
  reorderStudioTracks,
  setStudioCredits,
  submitStudioRelease,
  updateStudioRelease,
  updateStudioTrack,
  withdrawStudioRelease,
  type StudioCredit,
  type StudioReleaseDetail,
  type StudioTrack,
  type Taxonomy,
} from "@/features/studio/api";
import { coverUrl } from "@/lib/cover-view";
import { friendlyError } from "@/lib/error-copy";
import {
  EDITABLE_STATUSES,
  RELEASE_TYPE_LABEL,
  currentAudio,
  displayStateLabel,
  displayStateTone,
  missingCount,
  moveItem,
  parsePriceToMinor,
  readinessRows,
  reviewEventText,
  submitPanelMode,
} from "@/lib/studio-view";

type Reload = (next?: StudioReleaseDetail) => void;

function Section({ id, title, children, done }: { id: string; title: string; children: React.ReactNode; done?: boolean }) {
  return (
    <section aria-labelledby={id} className="mt-10">
      <h2 id={id} className="flex items-center gap-2 text-xl font-bold text-fg">
        {done ? <CircleCheck aria-hidden="true" className="size-5 text-success" /> : null}
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Problem({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="mt-3 flex items-start gap-2 text-sm text-danger">
      <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      {message}
    </p>
  );
}

function useAction(reload: Reload) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(
    async (key: string, fn: () => Promise<StudioReleaseDetail | unknown>) => {
      setBusy(key);
      setError(null);
      try {
        const out = await fn();
        reload(out && typeof out === "object" && "release" in (out as object) ? (out as StudioReleaseDetail) : undefined);
      } catch (err) {
        setError(friendlyError(err, "That didn't save. Please try again."));
      } finally {
        setBusy(null);
      }
    },
    [reload],
  );
  return { busy, error, run };
}

function DetailsForm({ detail, taxonomy, editable, reload }: { detail: StudioReleaseDetail; taxonomy: Taxonomy; editable: boolean; reload: Reload }) {
  const r = detail.release;
  const [form, setForm] = useState({
    title: r.title,
    release_type: r.release_type,
    language_code: r.language_code ?? "",
    genre_primary: r.genre_primary ?? "",
    genre_secondary: r.genre_secondary ?? "",
    label_name: r.label_name ?? "",
    p_line: r.p_line ?? "",
    c_line: r.c_line ?? "",
    upc: r.upc ?? "",
    release_timezone: r.release_timezone,
    track_sales: r.track_sales,
  });
  const { busy, error, run } = useAction(reload);
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [key]: e.target.value });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void run("details", () =>
      updateStudioRelease(r.id, {
        version: r.version,
        title: form.title,
        release_type: form.release_type,
        language_code: form.language_code || null,
        genre_primary: form.genre_primary || null,
        genre_secondary: form.genre_secondary || null,
        label_name: form.label_name || null,
        p_line: form.p_line || null,
        c_line: form.c_line || null,
        upc: form.upc || null,
        release_timezone: form.release_timezone,
        track_sales: form.track_sales,
      }),
    );
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4 md:grid-cols-2">
      <fieldset disabled={!editable} className="contents">
        <Field label="Release title">{(c) => <Input {...c} value={form.title} onChange={set("title")} maxLength={300} required />}</Field>
        <Field label="Type">
          {(c) => (
            <Select {...c} value={form.release_type} onChange={set("release_type")}>
              {taxonomy.release_types.map((t) => (
                <option key={t} value={t}>
                  {RELEASE_TYPE_LABEL[t] ?? t}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Language">
          {(c) => (
            <Select {...c} value={form.language_code} onChange={set("language_code")}>
              <option value="">Choose a language</option>
              {taxonomy.languages.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label_en} · {l.label_bn}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Main genre">
          {(c) => (
            <Select {...c} value={form.genre_primary} onChange={set("genre_primary")}>
              <option value="">Choose a genre</option>
              {taxonomy.genres.map((g) => (
                <option key={g.key} value={g.key}>
                  {g.label_en}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Second genre" hint="Optional">
          {(c) => (
            <Select {...c} value={form.genre_secondary} onChange={set("genre_secondary")}>
              <option value="">None</option>
              {taxonomy.genres
                .filter((g) => g.key !== form.genre_primary)
                .map((g) => (
                  <option key={g.key} value={g.key}>
                    {g.label_en}
                  </option>
                ))}
            </Select>
          )}
        </Field>
        <Field label="Label or imprint" hint="Optional">
          {(c) => <Input {...c} value={form.label_name} onChange={set("label_name")} maxLength={200} />}
        </Field>
        <Field label="℗ line" hint="Who owns the sound recording, e.g. ℗ 2026 Your Name">
          {(c) => <Input {...c} value={form.p_line} onChange={set("p_line")} maxLength={300} />}
        </Field>
        <Field label="© line" hint="Who owns the artwork and text, e.g. © 2026 Your Name">
          {(c) => <Input {...c} value={form.c_line} onChange={set("c_line")} maxLength={300} />}
        </Field>
        <Field label="UPC / EAN" hint="Optional. 12 to 14 digits, if you have one">
          {(c) => <Input {...c} value={form.upc} onChange={set("upc")} inputMode="numeric" maxLength={14} />}
        </Field>
        <Field label="Time zone for the release date">
          {(c) => <Input {...c} value={form.release_timezone} onChange={set("release_timezone")} maxLength={64} />}
        </Field>
        {r.release_type !== "SINGLE" ? (
          <Field label="How fans can buy" className="md:col-span-2">
            {(c) => (
              <Select {...c} value={form.track_sales} onChange={set("track_sales")}>
                <option value="RELEASE_ONLY">Only the whole {RELEASE_TYPE_LABEL[r.release_type]?.toLowerCase() ?? "release"}</option>
                <option value="TRACKS_ALLOWED">The whole release, or each song on its own</option>
              </Select>
            )}
          </Field>
        ) : null}
      </fieldset>
      {editable ? (
        <div className="md:col-span-2">
          <Button type="submit" busy={busy === "details"}>
            <Save aria-hidden="true" /> Save details
          </Button>
          <Problem message={error} />
        </div>
      ) : null}
    </form>
  );
}

function CreditsEditor({ track, taxonomy, editable, reload }: { track: StudioTrack; taxonomy: Taxonomy; editable: boolean; reload: Reload }) {
  const [rows, setRows] = useState<StudioCredit[]>(track.credits.map((c) => ({ ...c })));
  const { busy, error, run } = useAction(reload);
  const roles = new Map(taxonomy.credit_roles.map((r) => [r.key, r]));
  const update = (i: number, patch: Partial<StudioCredit>) => setRows(rows.map((row, j) => (j === i ? { ...row, ...patch } : row)));

  return (
    <div>
      <p className="text-sm text-fg-muted">Credits name who made the song. They are attribution only; payments are set up separately.</p>
      <ul className="mt-3 grid gap-3">
        {rows.map((row, i) => {
          const role = roles.get(row.role_key);
          return (
            <li key={i} className="grid gap-2 border border-line p-3 md:grid-cols-[12rem_1fr_10rem_auto] md:items-end">
              <Field label="Role">
                {(c) => (
                  <Select {...c} value={row.role_key} disabled={!editable} onChange={(e) => update(i, { role_key: e.target.value })}>
                    {taxonomy.credit_roles.map((r) => (
                      <option key={r.key} value={r.key}>
                        {r.label_en}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              {role?.performer || row.artist_id ? (
                <Field label="Artist on Corner Room" hint={row.artist_name ?? "Artist profile ID"}>
                  {(c) => <Input {...c} value={row.artist_id ?? ""} disabled={!editable} onChange={(e) => update(i, { artist_id: e.target.value, display_name: null })} />}
                </Field>
              ) : (
                <Field label="Name">
                  {(c) => <Input {...c} value={row.display_name ?? ""} disabled={!editable} maxLength={200} onChange={(e) => update(i, { display_name: e.target.value, artist_id: null })} />}
                </Field>
              )}
              {role?.allows_instrument ? (
                <Field label="Instrument" hint="Optional">
                  {(c) => <Input {...c} value={row.instrument ?? ""} disabled={!editable} maxLength={80} onChange={(e) => update(i, { instrument: e.target.value })} />}
                </Field>
              ) : (
                <span />
              )}
              {editable ? (
                <Button variant="ghost" size="sm" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                  <Trash2 aria-hidden="true" /> Remove
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {editable ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => setRows([...rows, { role_key: "songwriter", display_name: "" }])}>
            <UserRound aria-hidden="true" /> Add a credit
          </Button>
          <Button size="sm" busy={busy === "credits"} onClick={() => void run("credits", () => setStudioCredits(track.id, rows))}>
            <Save aria-hidden="true" /> Save credits
          </Button>
        </div>
      ) : null}
      <Problem message={error} />
    </div>
  );
}

function TrackCard({
  track,
  index,
  count,
  detail,
  taxonomy,
  editable,
  reload,
  onMove,
}: {
  track: StudioTrack;
  index: number;
  count: number;
  detail: StudioReleaseDetail;
  taxonomy: Taxonomy;
  editable: boolean;
  reload: Reload;
  onMove: (delta: -1 | 1) => void;
}) {
  const [form, setForm] = useState({
    title: track.title,
    version_title: track.version_title ?? "",
    explicit: track.explicit,
    language_code: track.language_code ?? "",
    isrc: track.isrc ?? "",
  });
  const { busy, error, run } = useAction(reload);
  const audio = currentAudio(track);
  const waiting = track.audio.find((a) => a.status === "UPLOADING" && !a.has_audio);
  const trackEditable = editable && track.status === "DRAFT";

  return (
    <li className="cr-glass-card p-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="cr-num text-2xl font-bold text-highlight">{track.position}</span>
        <h3 className="min-w-0 flex-1 truncate text-lg font-semibold text-fg">{track.title}</h3>
        {editable ? (
          <span className="flex gap-1">
            <Button variant="ghost" size="sm" aria-label={`Move ${track.title} up`} disabled={index === 0} onClick={() => onMove(-1)}>
              <ArrowUp aria-hidden="true" />
            </Button>
            <Button variant="ghost" size="sm" aria-label={`Move ${track.title} down`} disabled={index === count - 1} onClick={() => onMove(1)}>
              <ArrowDown aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Remove ${track.title}`}
              busy={busy === "remove"}
              onClick={() => void run("remove", async () => { await removeStudioTrack(detail.release.id, track.id); return fetchStudioRelease(detail.release.id); })}
            >
              <Trash2 aria-hidden="true" />
            </Button>
          </span>
        ) : null}
      </div>

      <form
        className="mt-4 grid gap-3 md:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run("track", () =>
            updateStudioTrack(track.id, {
              version: track.version,
              title: form.title,
              version_title: form.version_title || null,
              explicit: form.explicit,
              language_code: form.language_code || null,
              isrc: form.isrc || null,
            }),
          );
        }}
      >
        <fieldset disabled={!trackEditable} className="contents">
          <Field label="Song title">{(c) => <Input {...c} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={300} required />}</Field>
          <Field label="Version" hint='Optional, e.g. "Live" or "Acoustic"'>
            {(c) => <Input {...c} value={form.version_title} onChange={(e) => setForm({ ...form, version_title: e.target.value })} maxLength={100} />}
          </Field>
          <Field label="Song language" hint="Leave empty to use the release language">
            {(c) => (
              <Select {...c} value={form.language_code} onChange={(e) => setForm({ ...form, language_code: e.target.value })}>
                <option value="">Same as the release</option>
                {taxonomy.languages.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label_en}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="ISRC" hint="Optional. Only if you already have one">
            {(c) => <Input {...c} value={form.isrc} onChange={(e) => setForm({ ...form, isrc: e.target.value })} maxLength={15} />}
          </Field>
          <label className="flex items-center gap-2 text-sm text-fg md:col-span-2">
            <input type="checkbox" checked={form.explicit} onChange={(e) => setForm({ ...form, explicit: e.target.checked })} />
            Explicit lyrics
          </label>
        </fieldset>
        {trackEditable ? (
          <div className="md:col-span-2">
            <Button type="submit" size="sm" busy={busy === "track"}>
              <Save aria-hidden="true" /> Save song details
            </Button>
          </div>
        ) : null}
      </form>
      <Problem message={error} />

      <div className="mt-6">
        <h4 className="font-semibold text-fg">Master audio</h4>
        {waiting ? (
          <div className="mt-3">
            <UploadCard purpose="AUDIO_MASTER" targetType="track_version" targetId={waiting.version_id} onCompleted={() => reload()} />
          </div>
        ) : audio && audio.has_audio ? (
          <MediaReport trackId={track.id} versionId={audio.version_id} onSettled={() => reload()} />
        ) : null}
        {!waiting && editable ? (
          <Button
            variant="secondary"
            size="sm"
            className="mt-3"
            busy={busy === "version"}
            disabled={audio?.status === "PROCESSING"}
            onClick={() => void run("version", async () => { await newStudioVersion(track.id); return fetchStudioRelease(detail.release.id); })}
          >
            <Plus aria-hidden="true" /> {audio ? "Upload a new master" : "Upload the master"}
          </Button>
        ) : null}
      </div>

      <div className="mt-6">
        <h4 className="font-semibold text-fg">Credits</h4>
        <div className="mt-2">
          <CreditsEditor key={track.credits.map((c) => c.id).join()} track={track} taxonomy={taxonomy} editable={trackEditable} reload={reload} />
        </div>
      </div>
    </li>
  );
}

function PriceRow({ detail, subjectType, subjectId, label, audience, reload }: { detail: StudioReleaseDetail; subjectType: "TRACK" | "RELEASE"; subjectId: string; label: string; audience: "EVERYONE" | "OWNS_PART_OF_RELEASE"; reload: Reload }) {
  const mine = detail.proposals
    .filter((p) => p.subject_type === subjectType && p.subject_id === subjectId && p.audience === audience && p.status !== "WITHDRAWN")
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const current = mine.find((p) => p.status === "PROPOSED" || p.status === "ACCEPTED");
  // The team's answer to the newest proposal, when they countered it instead of accepting.
  const countered = mine[0]?.status === "COUNTERED" ? mine[0] : null;
  const [text, setText] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const { busy, error, run } = useAction(reload);
  return (
    <div className="grid gap-2 border-b border-line py-3 md:grid-cols-[1fr_14rem] md:items-end">
      <div>
        <p className="font-semibold text-fg">{label}</p>
        <p className="text-sm text-fg-muted">
          {current ? (
            <>
              {current.status === "ACCEPTED" ? "Agreed: " : "You proposed "}
              <Money value={{ amount_minor: current.amount_minor, currency_code: current.currency_code }} />
              {current.status === "PROPOSED" ? ". Corner Room's team will confirm the final price with you." : null}
            </>
          ) : countered ? null : (
            "No price proposed yet."
          )}
        </p>
        {countered ? (
          <p className="mt-1 text-sm text-fg">
            Corner Room&apos;s team replied to your <Money value={{ amount_minor: countered.amount_minor, currency_code: countered.currency_code }} /> proposal
            {countered.decision_note ? `: ${countered.decision_note}` : "."} Propose a new price when you&apos;re ready.
          </p>
        ) : null}
      </div>
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const minor = parsePriceToMinor(text);
          if (minor === null) {
            setNote("Enter a price like 120 or 120.50.");
            return;
          }
          setNote(null);
          void run(`price-${subjectId}-${audience}`, async () => {
            await proposeStudioPrice(detail.release.id, { subject_type: subjectType, subject_id: subjectId, audience, amount_minor: minor, currency_code: "BDT" });
            setText("");
            return fetchStudioRelease(detail.release.id);
          });
        }}
      >
        <Field label="Price (৳)" className="flex-1">
          {(c) => <Input {...c} value={text} onChange={(e) => setText(e.target.value)} inputMode="decimal" placeholder={current ? "Propose a new price" : "e.g. 120"} />}
        </Field>
        <Button type="submit" size="sm" busy={busy !== null}>
          Propose
        </Button>
      </form>
      <Problem message={note ?? error} />
    </div>
  );
}

function SubmitPanel({ detail, reload }: { detail: StudioReleaseDetail; reload: Reload }) {
  const [rights, setRights] = useState(false);
  const { busy, error, run } = useAction(reload);
  const rows = readinessRows(detail.readiness.items, detail.tracks);
  const missing = missingCount(detail.readiness.items);
  const mode = submitPanelMode(detail.release.status);
  const staffPreparing = detail.viewer_role === "staff" && detail.release.intake_mode !== "MANAGED";

  return (
    <div>
      {/* After review the checklist no longer applies: it only steered the submission. */}
      {mode === "past_review" ? null : (
        <ul className="grid gap-1 text-sm">
          {rows.map((row) => (
            <li key={row.key} className={`flex items-start gap-2 ${row.ok ? "text-fg" : "text-danger"}`}>
              {row.ok ? <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" /> : <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />}
              <span>
                <span className="sr-only">{row.ok ? "Done: " : "Missing: "}</span>
                {row.text}
              </span>
            </li>
          ))}
        </ul>
      )}
      {mode === "past_review" ? (
        <p className="mt-5 text-sm text-fg">
          This release is past review ({displayStateLabel(detail.display_state)}), so there is nothing to submit. Corner Room takes it from here.
        </p>
      ) : mode === "in_review" ? (
        <div className="mt-5">
          <p className="text-sm text-fg">Corner Room is reviewing this release. You can withdraw it to make changes before the review starts.</p>
          <Button variant="secondary" className="mt-3" busy={busy === "withdraw"} onClick={() => void run("withdraw", () => withdrawStudioRelease(detail.release.id))}>
            <Undo2 aria-hidden="true" /> Withdraw from review
          </Button>
        </div>
      ) : staffPreparing ? (
        <p className="mt-5 text-sm text-fg">You are preparing this release for {detail.profile.display_name}. They review it and submit it themselves.</p>
      ) : (
        <div className="mt-5">
          <label className="flex items-start gap-2 text-sm text-fg">
            <input type="checkbox" className="mt-1" checked={rights} onChange={(e) => setRights(e.target.checked)} />
            <span>I confirm I own or have permission to release this music, its artwork and every credit listed, and that nothing in it copies anyone else&apos;s work without permission.</span>
          </label>
          <Button size="lg" className="mt-4" disabled={missing > 0 || !rights} busy={busy === "submit"} onClick={() => void run("submit", () => submitStudioRelease(detail.release.id, rights))}>
            <Send aria-hidden="true" /> Submit for review
          </Button>
          {missing > 0 ? <p className="mt-2 text-sm text-fg-muted">{missing} {missing === 1 ? "item is" : "items are"} still missing.</p> : null}
        </div>
      )}
      <Problem message={error} />
    </div>
  );
}

export function ReleaseEditor({ releaseId }: { releaseId: string }) {
  const [detail, setDetail] = useState<StudioReleaseDetail | null>(null);
  const [taxonomy, setTaxonomy] = useState<Taxonomy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [coverUploads, setCoverUploads] = useState(0);

  const reload = useCallback<Reload>(
    (next) => {
      if (next) {
        setDetail(next);
        return;
      }
      fetchStudioRelease(releaseId)
        .then(setDetail)
        .catch((err) => setError(friendlyError(err, "This release couldn't be loaded.")));
    },
    [releaseId],
  );
  const tracksAction = useAction(reload);

  useEffect(() => {
    reload();
    fetchTaxonomy()
      .then(setTaxonomy)
      .catch(() => setTaxonomy({ credit_roles: [], genres: [], languages: [], release_types: [] }));
  }, [reload]);

  if (error && !detail) return <ErrorState title="Release unavailable" message={error} />;
  if (!detail || !taxonomy) return <Skeleton className="h-96 w-full" />;
  const editable = EDITABLE_STATUSES.has(detail.release.status);
  const tone = displayStateTone(detail.display_state);
  const ids = detail.tracks.map((t) => t.id);
  const coverOk = detail.readiness.items.find((i) => i.code === "COVER")?.ok ?? false;
  const sellsTracks = detail.release.track_sales === "TRACKS_ALLOWED" && detail.release.release_type !== "SINGLE";

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <span className={`inline-flex items-center gap-1 font-semibold ${tone === "attention" ? "text-danger" : tone === "good" ? "text-success" : "text-fg"}`}>
          {tone === "attention" ? <CircleAlert aria-hidden="true" className="size-4" /> : null}
          {displayStateLabel(detail.display_state)}
        </span>
        <span className="text-fg-muted">
          {RELEASE_TYPE_LABEL[detail.release.release_type]} by {detail.profile.display_name}
        </span>
      </div>
      {detail.intake?.mode === "MANAGED" ? (
        <p className="mt-2 text-sm text-fg">Managed by Corner Room: {detail.intake.managed_reason}</p>
      ) : detail.intake ? (
        <p className="mt-2 text-sm text-fg-muted">Corner Room staff are helping prepare this release.</p>
      ) : null}

      <Section id="details" title="Details">
        <DetailsForm key={detail.release.version} detail={detail} taxonomy={taxonomy} editable={editable} reload={reload} />
      </Section>

      <Section id="cover" title="Cover art" done={coverOk}>
        {editable ? <UploadCard purpose="COVER_ART" targetType="release_cover" targetId={detail.release.id} onCompleted={() => setCoverUploads((n) => n + 1)} /> : null}
        {detail.cover_url ? (
          // The cover fans will see (accepted by the checks), as uploaded.
          // eslint-disable-next-line @next/next/no-img-element -- signed cover link from the API
          <img src={coverUrl({ signed: detail.cover_url }) ?? ""} alt="Current cover" className="mb-4 size-40 object-cover" />
        ) : null}
        {/* The checks' verdict on the latest cover; the readiness list updates once they finish. */}
        <ArtworkReport load={() => fetchCoverReport(detail.release.id)} refresh={coverUploads} onSettled={() => reload()} />
      </Section>

      <Section id="tracks" title="Tracks">
        {detail.tracks.length === 0 ? (
          <div className="text-sm text-fg">
            <p>{detail.release.release_type === "SINGLE" ? "A single has one song." : "Add each song on this release, in order."}</p>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-fg-muted">
              <li>Type the song&apos;s name below and press Add song.</li>
              <li>A card for the song opens. Upload its master audio there (FLAC or WAV) and add its credits.</li>
              <li>The song counts as ready once its audio has passed Corner Room&apos;s checks.</li>
            </ol>
          </div>
        ) : null}
        <ol className="grid gap-4">
          {detail.tracks.map((t, i) => (
            <TrackCard
              key={`${t.id}-${t.version}`}
              track={t}
              index={i}
              count={detail.tracks.length}
              detail={detail}
              taxonomy={taxonomy}
              editable={editable}
              reload={reload}
              onMove={(delta) => void tracksAction.run("order", () => reorderStudioTracks(detail.release.id, moveItem(ids, i, delta)))}
            />
          ))}
        </ol>
        {editable && !(detail.release.release_type === "SINGLE" && detail.tracks.length >= 1) ? (
          <form
            className="mt-4 flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void tracksAction.run("add", async () => {
                const next = await addStudioTrack(detail.release.id, newTitle);
                setNewTitle("");
                return next;
              });
            }}
          >
            <Field label="Song title" hint="The name fans will see" className="min-w-64 flex-1">
              {(c) => <Input {...c} value={newTitle} onChange={(e) => setNewTitle(e.target.value)} maxLength={300} required />}
            </Field>
            <Button type="submit" busy={tracksAction.busy === "add"}>
              <Plus aria-hidden="true" /> Add song
            </Button>
          </form>
        ) : null}
        <Problem message={tracksAction.error} />
      </Section>

      <Section id="price" title="Price">
        <Card tone="solid" className="p-5">
          <p className="text-sm text-fg-muted">Propose a price. Corner Room&apos;s team agrees the final price with you before anything goes on sale.</p>
          <PriceRow detail={detail} subjectType="RELEASE" subjectId={detail.release.id} label={`The whole ${RELEASE_TYPE_LABEL[detail.release.release_type]?.toLowerCase() ?? "release"}`} audience="EVERYONE" reload={reload} />
          {detail.release.release_type !== "SINGLE" ? (
            <PriceRow detail={detail} subjectType="RELEASE" subjectId={detail.release.id} label="For fans who already own some songs (optional)" audience="OWNS_PART_OF_RELEASE" reload={reload} />
          ) : null}
          {sellsTracks
            ? detail.tracks.map((t) => <PriceRow key={t.id} detail={detail} subjectType="TRACK" subjectId={t.id} label={`${t.position}. ${t.title}`} audience="EVERYONE" reload={reload} />)
            : null}
        </Card>
      </Section>

      <Section id="submit" title="Review and submit" done={submitPanelMode(detail.release.status) !== "submit"}>
        <SubmitPanel detail={detail} reload={reload} />
      </Section>

      {detail.history.length > 0 ? (
        <Section id="history" title="Review history">
          <ol className="grid gap-3 text-sm">
            {detail.history.map((h, i) => (
              <li key={i} className="border-l-2 border-line pl-3">
                <p className="font-semibold text-fg">
                  {reviewEventText(h.action)} <span className="font-normal text-fg-muted">· <DateTime value={h.created_at} /></span>
                </p>
                {h.note ? <p className="mt-1 text-fg">{h.note}</p> : null}
              </li>
            ))}
          </ol>
        </Section>
      ) : null}
    </div>
  );
}
