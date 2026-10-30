"use client";

import { RosterPage, type RosterEntry } from "@/components/artists/roster-page";
import { createArtist, fetchArtists, fetchBands, type ArtistRecord, type BandRecord } from "@/lib/api";

const artist = (a: ArtistRecord): RosterEntry => ({ id: a.id, name: a.stage_name, bio: a.bio, status: a.status, primary_org_id: a.primary_org_id, picture: a.portrait_asset_id, kind: "artist" });
const band = (b: BandRecord): RosterEntry => ({ id: b.id, name: b.name, bio: b.bio, status: b.status, primary_org_id: b.primary_org_id, picture: b.portrait_asset_id, kind: "band" });

/** Solo artists and bands are all artists on Corner Room (owner, 2026-10-30): one roster, A to Z. */
async function everyone(skipAuth: boolean): Promise<RosterEntry[]> {
  const [artists, bands] = await Promise.all([fetchArtists({ skipAuth }), fetchBands({ skipAuth })]);
  return [...artists.items.map(artist), ...bands.items.map(band)].sort((a, b) => a.name.localeCompare(b.name));
}

export default function ArtistsPage() {
  return (
    <RosterPage
      kind="artist"
      title="Artists"
      lede="Solo artists and bands of the Corner Room label."
      loadPublic={() => everyone(true)}
      loadWorkspace={() => fetchArtists().then((p) => p.items.map(artist))}
      create={(name, bio) => createArtist({ stage_name: name, bio: bio || undefined })}
    />
  );
}
