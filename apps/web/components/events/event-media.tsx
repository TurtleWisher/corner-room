import { CoverArt } from "@/components/brand/cover-art";
import { RoomCube } from "@/components/brand/room-cube";
import { coverUrl, type CoverSize } from "@/lib/cover-view";
import { cn } from "@/lib/utils";

/**
 * Event media slot: the event's official poster (OD-06, owner 2026-10-23: square, like music
 * covers), or the Ember letter cube built from the event's own title and city, on its Signal Red
 * tile, when there is no poster or it fails to load. The frame is the same either way.
 */
export function EventMedia({
  title,
  side,
  eventId,
  hasCover,
  alt = "",
  animate,
  size = "full",
  className,
}: {
  title: string;
  /** Secondary real word for the cube's side face: the city, series or headliner. */
  side?: string | null;
  /** The event, for its poster; without one only the cube shows. */
  eventId?: string | null;
  /** From the API's has_cover; false skips the image request. */
  hasCover?: boolean;
  alt?: string;
  animate?: boolean;
  /** "front" for thumbnails under 96 px. */
  size?: "full" | "front";
  className?: string;
}) {
  const imageSize: CoverSize = size === "front" ? 160 : 1200;
  return (
    <CoverArt
      src={eventId ? coverUrl({ event: eventId, hasCover }, imageSize) : null}
      alt={alt}
      fallback={<RoomCube front={title} side={side || title} tone="ember" size={size} label={alt} animate={animate} className="absolute inset-0 size-full" />}
      className={cn("aspect-square w-full overflow-hidden bg-cr-signal", className)}
    />
  );
}
