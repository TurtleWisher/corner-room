import { RoomCube } from "@/components/brand/room-cube";
import { cn } from "@/lib/utils";

/**
 * Event media slot. Shows the event's cover when the API can serve one (OD-05, OD-06); until
 * then the placeholder is the Ember letter cube built from the event's own title and city, on
 * its Signal Red tile. The frame is the same either way, so media drops in without a layout change.
 */
export function EventMedia({
  title,
  side,
  src,
  alt = "",
  animate,
  size = "full",
  className,
}: {
  title: string;
  /** Secondary real word for the cube's side face: the city, series or headliner. */
  side?: string | null;
  /** Cover image URL, once events carry one. */
  src?: string | null;
  alt?: string;
  animate?: boolean;
  /** "front" for thumbnails under 96 px. */
  size?: "full" | "front";
  className?: string;
}) {
  return (
    <div className={cn("relative aspect-square w-full overflow-hidden bg-cr-signal", className)}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- signed media URLs from the API, not static assets
        <img src={src} alt={alt} className="absolute inset-0 size-full object-cover" />
      ) : (
        <RoomCube front={title} side={side || title} tone="ember" size={size} label={alt} animate={animate} className="absolute inset-0 size-full" />
      )}
    </div>
  );
}
