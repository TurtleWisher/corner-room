"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { ChartLine, Heart, HeartOff } from "lucide-react";

import { useAuth } from "@/components/auth-provider";
import { LitSurface } from "@/components/brand/corner-light";
import { Display, Eyebrow } from "@/components/brand/display";
import { Avatar, Button, ErrorState, Field, Input, Skeleton, StatusChip } from "@/components/ds";
import { ReleaseCard } from "@/components/music/release-card";
import { RetryButton, StaffPanel } from "@/components/shell/staff-panel";
import { loadErrorMessage, useAsync } from "@/components/use-async";
import {
  ApiError,
  fetchArtist,
  fetchBand,
  fetchBandMembers,
  fetchReleases,
  followArtist,
  inviteBandMember,
  transitionArtist,
  transitionBand,
  transitionBandMember,
  unfollowArtist,
  type BandMemberRecord,
} from "@/lib/api";
import { friendlyError } from "@/lib/error-copy";
import { humanizeStatus } from "@/lib/format/status";
import { sortReleases } from "@/lib/music-view";

type Kind = "artist" | "band";
type Entity = { id: string; name: string; bio: string | null; status: string; version?: number };

const ACTIONS: Record<Kind, string[]> = {
  artist: ["start_review", "approve", "activate", "begin_contract", "mark_signed", "suspend", "terminate"],
  band: ["activate", "pause", "resume", "disband"],
};

function Lifecycle({ kind, entity, onChanged }: { kind: Kind; entity: Entity; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState("");
  const members = useAsync(() => (kind === "band" ? fetchBandMembers(entity.id).then((p) => p.items) : Promise.resolve([] as BandMemberRecord[])), [kind, entity.id]);

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
      onChanged();
      members.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That action could not be completed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <StaffPanel>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-fg-muted">Status</span>
        <StatusChip value={entity.status} />
        {kind === "artist" ? (
          <Link href={`/staff/analytics/artists/${entity.id}`} className="cr-focus ml-auto inline-flex items-center gap-1 font-semibold text-link underline">
            <ChartLine aria-hidden="true" className="size-4" /> Artist analytics
          </Link>
        ) : null}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {ACTIONS[kind].map((a) => (
          <Button key={a} variant="secondary" size="sm" busy={busy === a} disabled={busy !== null}
            onClick={() => void run(a, () => (kind === "artist" ? transitionArtist(entity.id, a, entity.version) : transitionBand(entity.id, a, entity.version)))}>
            {humanizeStatus(a)}
          </Button>
        ))}
      </div>
      {kind === "band" ? (
        <div className="mt-6">
          <form
            className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,14rem)_auto] md:items-end"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              void run("invite", () => inviteBandMember(entity.id, userId, role || undefined)).then(() => {
                setUserId("");
                setRole("");
              });
            }}
          >
            <Field label="Invite member (user ID)">{(c) => <Input {...c} value={userId} onChange={(e) => setUserId(e.target.value)} required />}</Field>
            <Field label="Role">{(c) => <Input {...c} value={role} onChange={(e) => setRole(e.target.value)} />}</Field>
            <Button type="submit" busy={busy === "invite"}>
              Invite
            </Button>
          </form>
          {members.status === "ok" && members.data.length ? (
            <ul className="mt-4 divide-y divide-line border-y border-line">
              {members.data.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="font-mono text-xs text-fg">{m.artist_id ?? m.user_id}</span>
                  <span className="flex items-center gap-2">
                    <StatusChip value={m.status} />
                    {m.status !== "REMOVED" && m.status !== "LEFT" ? (
                      <Button variant="ghost" size="sm" busy={busy === m.id} onClick={() => void run(m.id, () => transitionBandMember(entity.id, m.id, "remove"))}>
                        Remove
                      </Button>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 text-danger">
          {error}
        </p>
      ) : null}
    </StaffPanel>
  );
}

function FollowButton({ artistId }: { artistId: string }) {
  const [following, setFollowing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      if (following) await unfollowArtist(artistId);
      else await followArtist(artistId);
      setFollowing(!following);
    } catch (err) {
      setError(friendlyError(err, "That did not work. Please try again."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <span className="inline-flex items-center gap-3">
      <Button variant={following ? "secondary" : "primary"} size="lg" busy={busy} onClick={() => void toggle()} aria-pressed={following}>
        {following ? <HeartOff aria-hidden="true" /> : <Heart aria-hidden="true" />} {following ? "Following" : "Follow"}
      </Button>
      {error ? (
        <span role="alert" className="text-sm text-danger">
          {error}
        </span>
      ) : null}
    </span>
  );
}

/**
 * Artist and band profiles (artists.md "Liner Notes"): stage-name masthead on Ember, the bio as a
 * Paper reading band, and their releases (the public release list filtered to them; OD-24 asks
 * for a dedicated endpoint). Portraits are monograms until media can be served (OD-05).
 */
export function ProfilePage({ kind, id }: { kind: Kind; id: string }) {
  const { status } = useAuth();
  const signedIn = status === "authenticated";
  const data = useAsync(async () => {
    if (status === "loading") return null;
    const opts = { skipAuth: !signedIn };
    const entity: Entity =
      kind === "artist"
        ? await fetchArtist(id, opts).then((a) => ({ id: a.id, name: a.stage_name, bio: a.bio, status: a.status, version: a.version }))
        : await fetchBand(id, opts).then((b) => ({ id: b.id, name: b.name, bio: b.bio, status: b.status, version: b.version }));
    const releases = await fetchReleases({ skipAuth: true })
      .then((p) => sortReleases(p.items.filter((r) => (kind === "artist" ? r.primary_artist_id === id : r.primary_band_id === id))))
      .catch(() => []);
    return { entity, releases };
  }, [kind, id, status]);

  if (data.status === "loading" || (data.status === "ok" && !data.data)) {
    return (
      <main id="main" data-theme="ember" className="cr-scope">
        <div className="mx-auto max-w-[90rem] space-y-4 px-4 py-16 md:px-6">
          <Skeleton className="h-24 w-24" />
          <Skeleton className="h-20 w-2/3" />
        </div>
      </main>
    );
  }
  if (data.status === "error") {
    return (
      <main id="main" data-theme="ember" className="cr-scope">
        <div className="mx-auto max-w-3xl px-4 py-16">
          <h1 className="sr-only">{kind === "artist" ? "Artist" : "Band"}</h1>
          <ErrorState title={kind === "artist" ? "Artist unavailable" : "Band unavailable"} message={loadErrorMessage(data.error, kind === "artist" ? "this artist" : "this band")} action={<RetryButton onClick={data.reload} />} />
        </div>
      </main>
    );
  }

  const { entity, releases } = data.data!;
  const canManage = signedIn && typeof entity.version === "number";
  return (
    <main id="main" data-theme="ember" data-module="artists" className="cr-scope">
      <LitSurface as="section" theme="ember" aria-labelledby="profile-title">
        <div className="mx-auto flex max-w-[90rem] flex-col gap-8 px-4 py-12 md:flex-row md:items-end md:px-6 md:py-20">
          <Avatar name={entity.name} size={160} />
          <div>
            <Eyebrow>{kind === "artist" ? "Artist" : "Band"} · Corner Room label</Eyebrow>
            <Display as="h1" id="profile-title" size="xl" className="mt-4">
              {entity.name}
            </Display>
            {kind === "artist" && signedIn ? (
              <div className="mt-6">
                <FollowButton artistId={entity.id} />
              </div>
            ) : null}
          </div>
        </div>
      </LitSurface>

      {entity.bio ? (
        <section data-theme="paper" aria-labelledby="bio-title" className="cr-scope cr-clip-cut">
          <div className="mx-auto max-w-3xl px-4 py-12 md:px-6">
            <h2 id="bio-title" className="cr-eyebrow text-[0.75rem] text-fg-muted">
              About
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-fg">{entity.bio}</p>
          </div>
        </section>
      ) : null}

      <div className="mx-auto max-w-[90rem] space-y-12 px-4 py-14 md:px-6">
        <section aria-labelledby="releases-title">
          <h2 id="releases-title" className="mb-5 text-xl font-bold text-fg">
            Releases
          </h2>
          {releases.length === 0 ? (
            <p className="text-sm text-fg-muted">No releases yet.</p>
          ) : (
            <LitSurface theme="sky" light={false} className="p-6">
              <ul className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-5">
                {releases.map((r) => (
                  <li key={r.id}>
                    <ReleaseCard release={r} artist={entity.name} />
                  </li>
                ))}
              </ul>
            </LitSurface>
          )}
        </section>
        {canManage ? <Lifecycle kind={kind} entity={entity} onChanged={data.reload} /> : null}
        <p className="text-sm text-fg-muted">
          {kind === "artist" ? (
            <Link href="/artists" className="cr-focus font-semibold text-link underline">
              All artists
            </Link>
          ) : (
            <Link href="/bands" className="cr-focus font-semibold text-link underline">
              All bands
            </Link>
          )}
        </p>
      </div>
    </main>
  );
}
