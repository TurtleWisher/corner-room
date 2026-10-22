import Link from "next/link";

import { CoverArt } from "@/components/brand/cover-art";
import { RoomCube } from "@/components/brand/room-cube";
import { DateTime } from "@/components/ds";
import type { ReleaseRecord } from "@/lib/api";
import { coverUrl } from "@/lib/cover-view";
import { releaseTypeLabel } from "@/lib/music-view";

/**
 * A release on a shelf: its official cover (OD-05), or the Sky letter cube built from its title and
 * artist when it has none, then title, artist and type. The whole card is one link.
 */
export function ReleaseCard({ release, artist }: { release: ReleaseRecord; artist: string | null }) {
  return (
    <article className="group">
      <Link href={`/releases/${release.id}`} className="cr-focus block">
        <CoverArt
          src={coverUrl({ release: release.id, hasCover: !!release.cover_asset_id }, 480)}
          fallback={<RoomCube front={release.title} side={artist ?? release.title} tone="sky" label="" className="w-full" />}
          className="w-full transition-transform duration-[var(--cr-dur-component)] ease-[var(--ease-corner)] group-hover:-translate-y-0.5"
        />
        <h3 className="mt-3 truncate text-base font-bold text-fg group-hover:text-highlight">{release.title}</h3>
      </Link>
      <p className="mt-0.5 truncate text-sm text-fg">{artist ?? <span className="text-fg-muted">Artist not available</span>}</p>
      <p className="mt-0.5 text-xs text-fg-muted">
        {releaseTypeLabel(release.release_type)}
        {release.release_at ? (
          <>
            {" · "}
            <DateTime value={release.release_at} format="date" />
          </>
        ) : null}
      </p>
    </article>
  );
}
