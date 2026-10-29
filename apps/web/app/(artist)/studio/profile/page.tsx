"use client";

/* Studio profile (owner, 2026-10-23; URL-09): artists and band admins change their public name,
 * bio and picture. Staff of their label approve each change before fans see it; the page shows
 * what is public now, what is waiting and the last decision. The API decides all of it. */

import { FormEvent, useState } from "react";
import { ArrowLeft, CircleAlert, CircleCheck, Clock, Trash2, Undo2 } from "lucide-react";

import { Avatar, Button, ButtonLink, Card, DateTime, ErrorState, Field, Input, Skeleton, Textarea } from "@/components/ds";
import { PhotoPicker } from "@/components/profile/photo-picker";
import { AccountPage } from "@/components/shell/account-page";
import { RetryButton } from "@/components/shell/staff-panel";
import { ArtworkReport } from "@/components/uploads/artwork-report";
import { loadErrorMessage, useAsync } from "@/components/use-async";
import { fetchStudioProfile, saveProfileChange, transitionProfileChange, type StudioProfile } from "@/features/profiles/api";
import { fetchMyProfiles, type CatalogProfile } from "@/features/studio/api";
import { coverUrl } from "@/lib/cover-view";
import { friendlyError } from "@/lib/error-copy";
import { changeLines, decisionLine, draftBio, draftName } from "@/lib/profile-view";

const BIO_MAX = 8000;

function Waiting({ data, onChanged }: { data: StudioProfile; onChanged: (next: StudioProfile | null) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = data.pending;
  if (!pending) return null;
  const lines = changeLines(pending, data.profile.kind);
  const picture = coverUrl({ signed: pending.portrait_url });

  async function withdraw() {
    setBusy(true);
    setError(null);
    try {
      await transitionProfileChange(pending!.id, "WITHDRAWN");
      onChanged(null);
    } catch (err) {
      setError(friendlyError(err, "The change couldn't be withdrawn. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card as="section" aria-labelledby="waiting" className="p-6">
      <h2 id="waiting" className="flex items-center gap-2 text-lg font-bold text-fg">
        <Clock aria-hidden="true" className="size-5 text-highlight" /> Waiting for staff approval
      </h2>
      <p className="mt-1 text-sm text-fg-muted">
        Fans still see your current profile until staff approve.
        {pending.submitted_at ? (
          <>
            {" "}
            Sent <DateTime value={pending.submitted_at} />.
          </>
        ) : null}
      </p>
      <div className="mt-4 flex flex-wrap items-start gap-4">
        {picture ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed link to the picture waiting for review
          <img src={picture} alt="New picture waiting for approval" className="size-24 object-cover" />
        ) : null}
        <ul className="list-disc space-y-1 pl-5 text-sm text-fg">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>
      {pending.bio_changed && pending.bio ? <p className="mt-3 max-w-prose whitespace-pre-line border-l-2 border-line pl-3 text-sm text-fg">{pending.bio}</p> : null}
      <Button variant="ghost" size="sm" className="mt-4" busy={busy} onClick={() => void withdraw()}>
        <Undo2 aria-hidden="true" /> Withdraw these changes
      </Button>
      {error ? (
        <p role="alert" className="mt-2 flex items-start gap-2 text-sm text-danger">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      ) : null}
    </Card>
  );
}

function Editor({ data, onSaved }: { data: StudioProfile; onSaved: (next: StudioProfile) => void }) {
  const { profile, pending } = data;
  const [name, setName] = useState(draftName(profile.stage_name, pending));
  const [bio, setBio] = useState(draftBio(profile.bio, pending));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const nameLabel = profile.kind === "band" ? "Band name" : "Stage name";
  const unchanged = name.trim() === draftName(profile.stage_name, pending) && bio.trim() === draftBio(profile.bio, pending).trim();

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const next = await saveProfileChange(profile.kind, profile.id, { stage_name: name.trim(), bio: bio.trim() || null });
      onSaved(next);
      setMessage({ tone: "good", text: next.pending ? "Sent to staff for approval." : "Nothing is waiting: this matches your public profile." });
    } catch (err) {
      setMessage({ tone: "bad", text: friendlyError(err, "Your changes couldn't be sent. Please try again.") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <Field label={nameLabel} hint="Shown on your profile, songs and releases.">
        {(c) => <Input {...c} value={name} onChange={(e) => setName(e.target.value)} maxLength={200} required />}
      </Field>
      <Field label="Bio" hint={`Tell fans about your music. Up to ${BIO_MAX.toLocaleString("en-US")} characters.`}>
        {(c) => <Textarea {...c} value={bio} onChange={(e) => setBio(e.target.value)} maxLength={BIO_MAX} rows={8} />}
      </Field>
      <Button type="submit" busy={busy} disabled={!name.trim() || unchanged}>
        Send for approval
      </Button>
      {message ? (
        <p role="status" className={`flex items-start gap-2 text-sm ${message.tone === "bad" ? "text-danger" : "text-fg"}`}>
          {message.tone === "bad" ? (
            <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          ) : (
            <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
          )}
          {message.text}
        </p>
      ) : null}
    </form>
  );
}

function ProfileCard({ card }: { card: CatalogProfile }) {
  const state = useAsync(() => fetchStudioProfile(card.kind, card.id), [card.kind, card.id]);
  const [override, setOverride] = useState<StudioProfile | null>(null);
  const [uploads, setUploads] = useState(0);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  if (state.status === "loading") return <Skeleton className="h-72 w-full" />;
  if (state.status === "error") {
    return (
      <ErrorState
        title={`${card.display_name} couldn't be loaded`}
        message={loadErrorMessage(state.error, "this profile")}
        action={<RetryButton onClick={state.reload} />}
      />
    );
  }
  const data = override ?? state.data;
  const { profile } = data;
  const decision = decisionLine(data.last_decision);
  const showDecision = decision && !data.pending;
  const reload = () => {
    setOverride(null);
    state.reload();
  };

  async function removePicture() {
    setRemoving(true);
    setRemoveError(null);
    try {
      setOverride(await saveProfileChange(profile.kind, profile.id, { remove_portrait: true }));
    } catch (err) {
      setRemoveError(friendlyError(err, "That couldn't be sent. Please try again."));
    } finally {
      setRemoving(false);
    }
  }

  return (
    <section aria-labelledby={`profile-${profile.id}`} className="mt-12 first:mt-0">
      <p className="cr-eyebrow text-highlight">{profile.kind === "band" ? "Band" : "Artist"}</p>
      <h2 id={`profile-${profile.id}`} className="mt-1 text-2xl font-bold text-fg">
        {profile.stage_name}
      </h2>
      {showDecision ? (
        <p role="status" className={`mt-3 flex items-start gap-2 text-sm ${decision.tone === "attention" ? "text-danger" : "text-fg"}`}>
          {decision.tone === "attention" ? (
            <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          ) : (
            <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
          )}
          {decision.text}
        </p>
      ) : null}
      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <Card className="p-6">
          <p className="font-semibold text-fg">Picture</p>
          <div className="mt-3 flex items-center gap-4">
            <Avatar name={profile.stage_name} src={coverUrl({ signed: profile.portrait_url })} size={96} />
            <p className="text-sm text-fg-muted">{profile.portrait_url ? "What fans see now." : "No picture yet: fans see your initials."}</p>
          </div>
          <div className="mt-4 space-y-3">
            <PhotoPicker
              targetType={profile.kind === "band" ? "band_portrait" : "artist_portrait"}
              targetId={profile.id}
              label={profile.portrait_url ? "Choose a new picture" : "Add a picture"}
              onUploaded={() => setUploads((n) => n + 1)}
            />
            {profile.portrait_url && !data.pending?.remove_portrait ? (
              <Button variant="ghost" size="sm" busy={removing} onClick={() => void removePicture()}>
                <Trash2 aria-hidden="true" /> Ask to remove the picture
              </Button>
            ) : null}
            {removeError ? (
              <p role="alert" className="flex items-start gap-2 text-sm text-danger">
                <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                {removeError}
              </p>
            ) : null}
            {uploads > 0 ? (
              <ArtworkReport load={() => fetchStudioProfile(profile.kind, profile.id).then((p) => p.picture_report)} noun="picture" refresh={uploads} onSettled={reload} />
            ) : null}
            <p className="text-xs text-fg-muted">A new picture goes to staff for approval once it passes the checks.</p>
          </div>
        </Card>
        <div className="space-y-6">
          <Waiting data={data} onChanged={() => reload()} />
          <Card as="section" aria-labelledby={`details-${profile.id}`} className="p-6">
            <h3 id={`details-${profile.id}`} className="mb-4 text-lg font-bold text-fg">
              Details
            </h3>
            {/* Re-mount the form when what is waiting changes, so the fields show it. */}
            <Editor key={`${data.pending?.id ?? "none"}-${data.pending?.submitted_at ?? ""}`} data={data} onSaved={setOverride} />
          </Card>
        </div>
      </div>
    </section>
  );
}

function Profiles() {
  const profiles = useAsync(() => fetchMyProfiles(), []);
  if (profiles.status === "loading") return <Skeleton className="h-48 w-full" />;
  if (profiles.status === "error") {
    return <ErrorState title="Profile unavailable" message={loadErrorMessage(profiles.error, "your profiles")} action={<RetryButton onClick={profiles.reload} />} />;
  }
  const active = profiles.data.filter((p) => p.status === "ACTIVE");
  if (active.length === 0) {
    return (
      <Card className="max-w-xl p-6">
        <p className="text-lg font-bold text-fg">No active artist or band profile yet</p>
        <p className="mt-2 text-sm text-fg">You can edit your profile here once your label has activated it.</p>
      </Card>
    );
  }
  return (
    <div>
      <p className="max-w-2xl text-sm text-fg">
        Change your name, bio and picture. Staff of your label check each change before fans see it, so your public profile stays as it is until
        then.
      </p>
      <div className="mt-8">
        {active.map((p) => (
          <ProfileCard key={`${p.kind}-${p.id}`} card={p} />
        ))}
      </div>
    </div>
  );
}

export default function StudioProfilePage() {
  return (
    <AccountPage
      audience="artist"
      eyebrow="Studio"
      title="Profile"
      what="your profile"
      actions={
        <ButtonLink href="/studio" variant="secondary">
          <ArrowLeft aria-hidden="true" /> Studio home
        </ButtonLink>
      }
    >
      <Profiles />
    </AccountPage>
  );
}
