import { CoverArt } from "@/components/brand/cover-art";
import { RoomCube } from "@/components/brand/room-cube";
import { Avatar } from "@/components/ds";
import { EventMedia } from "@/components/events/event-media";
import type { SearchHitRecord } from "@/lib/api";
import { searchHitPicture } from "@/lib/search-view";
import { coverUrl } from "@/lib/cover-view";

/**
 * A search hit's picture: the event poster, the release or track cover, the artist's or band's
 * approved picture, or the name's initials when there is none (or it fails to load).
 */
export function SearchThumb({ hit, size = 56 }: { hit: SearchHitRecord; size?: number }) {
  if (hit.entity_type === "EVENT") return <EventMedia title={hit.title} eventId={hit.entity_id} size="front" />;
  if (hit.entity_type === "RELEASE" || hit.entity_type === "TRACK") {
    return (
      <div className="aspect-square w-full bg-cr-sky">
        <CoverArt
          src={coverUrl(hit.entity_type === "RELEASE" ? { release: hit.entity_id } : { track: hit.entity_id }, 160)}
          fallback={<RoomCube front={hit.title} side={hit.subtitle || hit.title} tone="sky" size="front" label="" className="size-full" />}
          className="size-full"
        />
      </div>
    );
  }
  const picture = searchHitPicture(hit);
  return <Avatar name={hit.title} src={picture ? coverUrl(picture, 160) : null} size={size} />;
}
