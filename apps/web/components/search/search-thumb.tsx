import { CoverArt } from "@/components/brand/cover-art";
import { RoomCube } from "@/components/brand/room-cube";
import { Avatar } from "@/components/ds";
import { EventMedia } from "@/components/events/event-media";
import type { SearchHitRecord } from "@/lib/api";
import { coverUrl } from "@/lib/cover-view";

/** A search hit's picture: the event poster, the release or track cover, or the name's initials. */
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
  return <Avatar name={hit.title} size={size} />;
}
