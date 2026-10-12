"use client";

import { RosterPage } from "@/components/artists/roster-page";
import { createArtist, fetchArtists, type ArtistRecord } from "@/lib/api";

const entry = (a: ArtistRecord) => ({ id: a.id, name: a.stage_name, bio: a.bio, status: a.status, primary_org_id: a.primary_org_id });

export default function ArtistsPage() {
  return (
    <RosterPage
      kind="artist"
      title="Artists"
      lede="The artists of the Corner Room label."
      loadPublic={() => fetchArtists({ skipAuth: true }).then((p) => p.items.map(entry))}
      loadWorkspace={() => fetchArtists().then((p) => p.items.map(entry))}
      create={(name, bio) => createArtist({ stage_name: name, bio: bio || undefined })}
    />
  );
}
