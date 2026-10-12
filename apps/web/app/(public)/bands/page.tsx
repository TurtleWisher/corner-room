"use client";

import { RosterPage } from "@/components/artists/roster-page";
import { createBand, fetchBands, type BandRecord } from "@/lib/api";

const entry = (b: BandRecord) => ({ id: b.id, name: b.name, bio: b.bio, status: b.status, primary_org_id: b.primary_org_id });

export default function BandsPage() {
  return (
    <RosterPage
      kind="band"
      title="Bands"
      lede="Bands on the Corner Room label."
      loadPublic={() => fetchBands({ skipAuth: true }).then((p) => p.items.map(entry))}
      loadWorkspace={() => fetchBands().then((p) => p.items.map(entry))}
      create={(name) => createBand({ name })}
    />
  );
}
