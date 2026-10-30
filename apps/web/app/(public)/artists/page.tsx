"use client";

import { RosterPage, type RosterEntry } from "@/components/artists/roster-page";
import { createArtist, fetchArtists, type ArtistRecord } from "@/lib/api";

const entry = (a: ArtistRecord): RosterEntry => ({
  id: a.id,
  name: a.stage_name,
  bio: a.bio,
  status: a.status,
  primary_org_id: a.primary_org_id,
  picture: a.portrait_asset_id,
  kind: a.kind === "BAND" ? "band" : "artist",
});

/** Every band is an artist on Corner Room (owner, 2026-10-30, D-ARTIST-UNIFY-01): one list, A to Z. */
async function everyone(skipAuth: boolean): Promise<RosterEntry[]> {
  const all = await fetchArtists({ skipAuth, kind: "ALL" });
  return all.items.map(entry).sort((a, b) => a.name.localeCompare(b.name));
}

export default function ArtistsPage() {
  return (
    <RosterPage
      kind="artist"
      title="Artists"
      lede="Solo artists and bands of the Corner Room label."
      loadPublic={() => everyone(true)}
      loadWorkspace={() => fetchArtists().then((p) => p.items.map(entry))}
      create={(name, bio) => createArtist({ stage_name: name, bio: bio || undefined })}
    />
  );
}
