"use client";

/* The Studio release editor (URL-05, design 3 and 5). Every field saves to the API and the page
 * re-renders from the server's answer; nothing here decides permission, readiness or state. */

import { FormEvent, useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, CircleAlert, CircleCheck, Plus, Save, Send, Trash2, Undo2, UserRound } from "lucide-react";

import { Button, Card, DateTime, ErrorState, Field, Input, Money, Select, Skeleton } from "@/components/ds";
import { Textarea } from "@/components/ds/input";
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
  saveCreditChanges,
  saveReleaseChanges,
  saveStudioLyrics,
  saveTrackChanges,
  setStudioCredits,
  startChanges,
  submitChanges,
  submitStudioRelease,
  updateStudioRelease,
  updateStudioTrack,
  withdrawChanges,
  withdrawStudioCover,
  withdrawStudioLyrics,
  withdrawStudioRelease,
  type StudioCredit,
  type StudioReleaseDetail,
  type StudioTrack,
  type Taxonomy,
} from "@/features/studio/api";
import { coverUrl } from "@/lib/cover-view";
import { friendlyError } from "@/lib/error-copy";
import { formatCount } from "@/lib/format/count";
import { changeMode, pendingAudio, proposedRelease, proposedTrack, type ChangeMode } from "@/lib/changes-view";
import { lyricsMode } from "@/lib/lyrics-view";
import {
  EDITABLE_STATUSES,
  RELEASE_TYPE_LABEL,
  canProposePresale,
  currentAudio,
  displayStateLabel,
  displayStateTone,
  missingCount,
  moveItem,
  parsePriceToMinor,
  presaleHint,
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

function DetailsForm({
  detail,
  taxonomy,
  editable,
  changing = false,
  reload,
}: {
  detail: StudioReleaseDetail;
  taxonomy: Taxonomy;
  editable: boolean;
  /** D-CHANGES-01: released music; saves go into the change request for staff. */
  changing?: boolean;
  reload: Reload;
}) {
  const r = changing ? proposedRelease(detail) : detail.release;
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
    if (changing) {
      void run("details", () =>
        saveReleaseChanges(r.id, {
          title: form.title,
          language_code: form.language_code || null,
          genre_primary: form.genre_primary || null,
          genre_secondary: form.genre_secondary || null,
          label_name: form.label_name || null,
          p_line: form.p_line || null,
          c_line: form.c_line || null,
          upc: form.upc || null,
        }),
      );
      return;
    }
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
      <fieldset disabled={!editable && !changing} className="contents">
        <Field label="Release title">{(c) => <Input {...c} value={form.title} onChange={set("title")} maxLength={300} required />}</Field>
        <Field label="Type">
          {(c) => (
            <Select {...c} value={form.release_type} onChange={set("release_type")} disabled={changing}>
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
          {(c) => <Input {...c} value={form.release_timezone} onChange={set("release_timezone")} maxLength={64} disabled={changing} />}
        </Field>
        {r.release_type !== "SINGLE" ? (
          <Field label="How fans can buy" className="md:col-span-2">
            {(c) => (
              <Select {...c} value={form.track_sales} onChange={set("track_sales")} disabled={changing}>
                <option value="RELEASE_ONLY">Only the whole {RELEASE_TYPE_LABEL[r.release_type]?.toLowerCase() ?? "release"}</option>
                <option value="TRACKS_ALLOWED">The whole release, or each song on its own</option>
              </Select>
            )}
          </Field>
        ) : null}
      </fieldset>
      {editable || changing ? (
        <div className="md:col-span-2">
          <Button type="submit" busy={busy === "details"}>
            <Save aria-hidden="true" /> {changing ? "Save changes for review" : "Save details"}
          </Button>
          <Problem message={error} />
        </div>
      ) : null}
    </form>
  );
}

function CreditsEditor({
  track,
  taxonomy,
  editable,
  changing = false,
  reload,
}: {
  track: StudioTrack;
  taxonomy: Taxonomy;
  editable: boolean;
  /** D-CHANGES-01: saves go into the change request for staff. */
  changing?: boolean;
  reload: Reload;
}) {
  const [rows, setRows] = useState<StudioCredit[]>(track.credits.map((c) => ({ ...c })));
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAction(reload);
  const roles = new Map(taxonomy.credit_roles.map((r) => [r.key, r]));
  const update = (i: number, patch: Partial<StudioCredit>) => setRows(rows.map((row, j) => (j === i ? { ...row, ...patch } : row)));

  return (
    <div>
      <p className="text-sm text-fg-muted">Credits name who made the song. Add a Musician for each person who played or sang on it (Guitars, Bass, Vocals, Drums); fans see them under Track credits. For any other role, choose Other and name the role yourself. Corner Room checks credits before fans see them. Credits are attribution only; payments are set up separately.</p>
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
                <Field
                  label={row.role_key === "custom" ? "Role" : "Instrument or voice"}
                  hint={row.role_key === "custom" ? "Name it yourself, for example Cover art, Strings, Choir" : "For example Guitars, Bass, Vocals, Drums"}
                >
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
          <Button
            size="sm"
            busy={busy === "credits"}
            onClick={() => {
              setSaved(false);
              void run("credits", async () => {
                if (!changing) return setStudioCredits(track.id, rows);
                const out = await saveCreditChanges(track.id, rows);
                setSaved(true);
                return out;
              });
            }}
          >
            <Save aria-hidden="true" /> {changing ? "Save credit changes for review" : "Save credits"}
          </Button>
        </div>
      ) : null}
      {saved && changing ? (
        // Saving only adds to the list of changes; nothing reaches staff until it is sent (owner, 2026-10-31).
        <p role="status" className="mt-3 flex items-start gap-2 text-sm text-fg">
          <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
          Saved to your changes. Press Send changes for review in the Change this music box at the top of the page to send them to staff.
        </p>
      ) : null}
      <Problem message={error} />
    </div>
  );
}

/**
 * A song's lyrics (owner, 2026-10-27, D-LYRICS-01). While drafting they save straight away and
 * staff read them in the release review; once the song is approved or out, a change waits for
 * Corner Room to check it and listeners keep seeing the current lyrics until then.
 */
function LyricsEditor({ track, editable, reload }: { track: StudioTrack; editable: boolean; reload: Reload }) {
  const mode = lyricsMode(track.status, editable);
  const shown = track.lyrics_waiting ? (track.lyrics_pending ?? "") : (track.lyrics ?? "");
  const [text, setText] = useState(shown);
  const { busy, error, run } = useAction(reload);
  const changed = text.trim() !== shown.trim();
  const id = `lyrics-${track.id}`;

  return (
    <div>
      <p className="text-sm text-fg-muted">
        One sung line per line, with an empty line between verses. Listeners see them on the song page and in the listening room once the song
        is out.
      </p>
      {track.lyrics_waiting ? (
        <p className="mt-2 text-sm text-fg">Your change is waiting for Corner Room to check it. Listeners still see the current lyrics.</p>
      ) : null}
      {track.lyrics_review_note && !track.lyrics_waiting ? (
        <p className="mt-2 flex items-start gap-2 text-sm text-danger">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          Not approved: {track.lyrics_review_note}
        </p>
      ) : null}
      <label htmlFor={id} className="sr-only">
        Lyrics of {track.title}
      </label>
      <Textarea
        id={id}
        value={text}
        onChange={(e) => setText(e.target.value)}
        readOnly={mode === "locked"}
        maxLength={10000}
        rows={Math.min(14, Math.max(5, text.split("\n").length + 1))}
        placeholder={mode === "locked" ? "No lyrics yet." : "Type or paste the lyrics"}
        className="mt-3 resize-y"
      />
      {mode === "locked" ? (
        <p className="mt-2 text-xs text-fg-muted">Lyrics can be changed again after the review.</p>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" busy={busy === "lyrics"} disabled={!changed} onClick={() => void run("lyrics", () => saveStudioLyrics(track.id, text.trim() ? text : null))}>
            {mode === "draft" ? <Save aria-hidden="true" /> : <Send aria-hidden="true" />}
            {mode === "draft" ? "Save lyrics" : "Send lyrics for review"}
          </Button>
          {track.lyrics_waiting ? (
            <Button variant="ghost" size="sm" busy={busy === "withdraw"} onClick={() => void run("withdraw", () => withdrawStudioLyrics(track.id))}>
              <Undo2 aria-hidden="true" /> Withdraw the change
            </Button>
          ) : null}
        </div>
      )}
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
  mode = "not_released",
  reload,
  onMove,
}: {
  track: StudioTrack;
  index: number;
  count: number;
  detail: StudioReleaseDetail;
  taxonomy: Taxonomy;
  editable: boolean;
  /** D-CHANGES-01: "editing" saves into the change request for staff. */
  mode?: ChangeMode;
  reload: Reload;
  onMove: (delta: -1 | 1) => void;
}) {
  const changing = mode === "editing";
  const shown = changing ? proposedTrack(detail, track) : track;
  const replacement = pendingAudio(detail, track.id);
  const [form, setForm] = useState({
    title: shown.title,
    version_title: shown.version_title ?? "",
    explicit: shown.explicit,
    language_code: shown.language_code ?? "",
    isrc: shown.isrc ?? "",
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
        {/* Counted listens (owner, 2026-10-27, D-LISTEN-01): plays heard for 30 seconds. */}
        {typeof track.listens === "number" ? (
          <span className="text-sm text-fg-muted">
            <span className="cr-num font-semibold text-fg">{formatCount(track.listens)}</span> {track.listens === 1 ? "listen" : "listens"}
          </span>
        ) : null}
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
          if (changing) {
            void run("track", () =>
              saveTrackChanges(track.id, {
                title: form.title,
                version_title: form.version_title || null,
                explicit: form.explicit,
                language_code: form.language_code || null,
                isrc: form.isrc || null,
              }),
            );
            return;
          }
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
        <fieldset disabled={!trackEditable && !changing} className="contents">
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
        {trackEditable || changing ? (
          <div className="md:col-span-2">
            <Button type="submit" size="sm" busy={busy === "track"}>
              <Save aria-hidden="true" /> {changing ? "Save song changes for review" : "Save song details"}
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
        {replacement && !waiting ? (
          <div className="mt-3 border border-line p-3">
            <p className="text-sm font-semibold text-fg">New audio, waiting for review</p>
            <p className="text-xs text-fg-muted">Listeners keep hearing the current audio until Corner Room approves your changes.</p>
            <MediaReport trackId={track.id} versionId={replacement} onSettled={() => reload()} />
          </div>
        ) : null}
        {!waiting && (editable || changing) ? (
          <Button
            variant="secondary"
            size="sm"
            className="mt-3"
            busy={busy === "version"}
            disabled={audio?.status === "PROCESSING"}
            onClick={() => void run("version", async () => { await newStudioVersion(track.id); return fetchStudioRelease(detail.release.id); })}
          >
            <Plus aria-hidden="true" /> {changing ? "Upload replacement audio" : audio ? "Upload a new master" : "Upload the master"}
          </Button>
        ) : null}
      </div>

      <div className="mt-6">
        <h4 className="font-semibold text-fg">Credits</h4>
        <div className="mt-2">
          <CreditsEditor
            key={`${shown.credits.map((c) => `${c.id ?? ""}${c.role_key}${c.display_name ?? ""}${c.artist_id ?? ""}`).join()}|${mode}`}
            track={shown}
            taxonomy={taxonomy}
            editable={trackEditable || changing}
            changing={changing}
            reload={reload}
          />
        </div>
      </div>

      <div className="mt-6">
        <h4 className="font-semibold text-fg">Lyrics</h4>
        <div className="mt-2">
          <LyricsEditor
            key={`${track.version}|${track.lyrics_waiting ? "w" : ""}`}
            track={track}
            editable={editable}
            reload={reload}
          />
        </div>
      </div>
    </li>
  );
}

function PriceRow({ detail, subjectType, subjectId, label, hint, audience, reload }: { detail: StudioReleaseDetail; subjectType: "TRACK" | "RELEASE"; subjectId: string; label: string; hint?: string; audience: "EVERYONE" | "OWNS_PART_OF_RELEASE" | "PRESALE"; reload: Reload }) {
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
        {hint ? <p className="text-sm text-fg-muted">{hint}</p> : null}
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

/**
 * Changes to music that is approved or out (owner, 2026-10-28, D-CHANGES-01): every edit waits for
 * Corner Room. The panel starts a change request, lists what changed (old next to new), and sends
 * it for review; while it is open, the forms below save into it instead of going live.
 */
function ChangesPanel({ detail, mode, reload }: { detail: StudioReleaseDetail; mode: ChangeMode; reload: Reload }) {
  const { busy, error, run } = useAction(reload);
  const req = detail.change_request;
  const last = detail.last_change_decision;
  if (mode === "not_released") return null;
  return (
    <Card tone="solid" className="mt-6 p-5">
      <h2 className="text-lg font-bold text-fg">Change this music</h2>
      {mode === "none" ? (
        <>
          <p className="mt-1 text-sm text-fg-muted">
            This music is approved or out. You can change its details, song details, credits or audio file; every change waits for Corner Room to
            check it, and listeners keep the current version until it is approved. Lyrics and the cover have their own boxes below.
          </p>
          {last?.status === "REJECTED" && last.review_note ? (
            <p className="mt-3 flex items-start gap-2 text-sm text-danger">
              <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              Your last changes were not approved: {last.review_note}
            </p>
          ) : null}
          <Button className="mt-3" size="sm" busy={busy === "start"} onClick={() => void run("start", () => startChanges(detail.release.id))}>
            <Plus aria-hidden="true" /> Make changes
          </Button>
        </>
      ) : (
        <>
          <p className="mt-1 text-sm text-fg-muted">
            {mode === "editing"
              ? "Edit below. Your changes are saved here and nobody else sees them until Corner Room approves them."
              : "Your changes are waiting for Corner Room to check them. Listeners keep the current version until then."}
          </p>
          {req && req.diff.length ? (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[32rem] text-left text-sm">
                <thead className="text-xs text-fg-muted">
                  <tr className="border-b border-line">
                    <th className="py-2 pr-3 font-semibold">Where</th>
                    <th className="py-2 pr-3 font-semibold">What</th>
                    <th className="py-2 pr-3 font-semibold">Now</th>
                    <th className="py-2 font-semibold">After approval</th>
                  </tr>
                </thead>
                <tbody>
                  {req.diff.map((d, i) => (
                    <tr key={i} className="border-b border-line align-top">
                      <td className="py-2 pr-3 text-fg-muted">{d.scope}</td>
                      <td className="py-2 pr-3 text-fg">{d.field}</td>
                      <td className="py-2 pr-3 text-fg-muted">{d.before}</td>
                      <td className="py-2 font-semibold text-fg">{d.after}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-3 text-sm text-fg">No changes yet.</p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {mode === "editing" ? (
              <Button size="sm" busy={busy === "send"} disabled={!req?.diff.length} onClick={() => void run("send", () => submitChanges(detail.release.id))}>
                <Send aria-hidden="true" /> Send changes for review
              </Button>
            ) : (
              <Button size="sm" variant="secondary" busy={busy === "start"} onClick={() => void run("start", () => startChanges(detail.release.id))}>
                <Undo2 aria-hidden="true" /> Take back to make more changes
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              busy={busy === "discard"}
              onClick={() => void run("discard", async () => { await withdrawChanges(detail.release.id); return fetchStudioRelease(detail.release.id); })}
            >
              <Trash2 aria-hidden="true" /> Discard all changes
            </Button>
          </div>
        </>
      )}
      <Problem message={error} />
    </Card>
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
  const coverChangeable = ["APPROVED", "SCHEDULED", "RELEASED"].includes(detail.release.status);
  const mode = changeMode(detail);
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

      <ChangesPanel detail={detail} mode={mode} reload={reload} />

      <Section id="details" title="Details">
        <DetailsForm
          key={`${detail.release.version}|${mode}|${JSON.stringify(detail.change_request?.changes ?? {})}`}
          detail={detail}
          taxonomy={taxonomy}
          editable={editable}
          changing={mode === "editing"}
          reload={reload}
        />
      </Section>

      <Section id="cover" title="Cover art" done={coverOk}>
        {/* Owner, 2026-10-28 (D-COVER-01): approved or released music can get a new cover too; it waits
            for Corner Room to check it and listeners keep the current one until then. */}
        {coverChangeable ? (
          <p className="mb-3 text-sm text-fg-muted">
            A new cover for music that is approved or out waits for Corner Room to check it. Listeners keep the current cover until then.
          </p>
        ) : null}
        {detail.cover_review_note && !detail.cover_waiting ? (
          <p className="mb-3 flex items-start gap-2 text-sm text-danger">
            <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            New cover not approved: {detail.cover_review_note}
          </p>
        ) : null}
        {detail.cover_waiting && detail.pending_cover_url ? (
          <div className="mb-4 flex flex-wrap items-end gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element -- signed cover link from the API */}
            <img src={coverUrl({ signed: detail.pending_cover_url }) ?? ""} alt="New cover waiting for review" className="size-40 object-cover" />
            <div className="text-sm text-fg">
              <p>Your new cover is waiting for Corner Room to check it.</p>
              <Button variant="ghost" size="sm" className="mt-2" onClick={() => void withdrawStudioCover(detail.release.id).then(() => reload())}>
                <Undo2 aria-hidden="true" /> Withdraw the new cover
              </Button>
            </div>
          </div>
        ) : null}
        {editable || coverChangeable ? (
          <UploadCard purpose="COVER_ART" targetType="release_cover" targetId={detail.release.id} onCompleted={() => setCoverUploads((n) => n + 1)} />
        ) : null}
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
              key={`${t.id}-${t.version}-${mode}-${JSON.stringify(detail.change_request?.changes ?? {})}`}
              track={t}
              index={i}
              count={detail.tracks.length}
              detail={detail}
              taxonomy={taxonomy}
              editable={editable}
              mode={mode}
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
          {canProposePresale(detail.release.status) ? (
            <PriceRow
              detail={detail}
              subjectType="RELEASE"
              subjectId={detail.release.id}
              label="Pre-sale price (optional)"
              hint={presaleHint(detail.release.status, detail.release.release_at)}
              audience="PRESALE"
              reload={reload}
            />
          ) : null}
          {detail.release.status === "SCHEDULED" && detail.proposals.some((p) => p.audience === "PRESALE" && p.status === "ACCEPTED") ? (
            <p className="pt-3 text-sm text-fg">
              Fans pre-order on your release&apos;s page:{" "}
              <a href={`/releases/${detail.release.id}`} className="cr-focus font-semibold text-link underline">
                open the pre-order page
              </a>
              . Share that link.
            </p>
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
