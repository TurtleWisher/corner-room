"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

import { isRoomPath } from "@/components/music/player";

/**
 * Shell pieces (header, footer, phone tab bar) that step aside inside the listening room, which
 * is a dedicated full-screen room with its own way out (owner direction 2026-10-14).
 */
export function OutsideRoom({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  useEffect(() => {
    if (pathname && !isRoomPath(pathname)) cameFrom = pathname;
  }, [pathname]);
  return isRoomPath(pathname) ? null : <>{children}</>;
}

// The last listening page seen in this visit, so leaving the room can go back to it.
let cameFrom: string | null = null;

/** The listening page the room was entered from in this visit, if any. */
export function roomCameFrom(): string | null {
  return cameFrom;
}
