"use client";

/* "Switch to fan view" in Studio and the staff console (owner, 2026-10-24). It opens the home page
 * with staff tools hidden on fan pages; nothing about the account or its permissions changes. */

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { UserRound } from "lucide-react";

import { Button } from "@/components/ds";
import { useFanView } from "@/components/use-fan-view";
import { FAN_VIEW_HOME } from "@/lib/fan-view";
import { cn } from "@/lib/utils";

function useSwitchToFan(onDone?: () => void) {
  const router = useRouter();
  const [, setFanView] = useFanView();
  return () => {
    setFanView(true);
    onDone?.();
    router.push(FAN_VIEW_HOME);
  };
}

/** Header button: the clear way to the fan site. The label shortens on phones. */
export function FanViewButton({ className }: { className?: string }) {
  const go = useSwitchToFan();
  return (
    <Button variant="secondary" size="sm" className={cn("shrink-0", className)} onClick={go}>
      <UserRound aria-hidden="true" />
      <span className="hidden sm:inline">Switch to fan view</span>
      <span className="sm:hidden">Fan view</span>
    </Button>
  );
}

/** The same switch at the foot of the side menu, where "Back to Corner Room" was. */
export function FanViewLink({ onClick }: { onClick?: () => void }) {
  const go = useSwitchToFan(onClick);
  return (
    <button type="button" onClick={go} className="cr-focus flex h-11 w-full items-center gap-2 px-5 text-left text-sm font-semibold text-fg-muted hover:text-fg">
      <UserRound aria-hidden="true" className="size-4" /> Switch to fan view
    </button>
  );
}

/** Opening a Studio or staff console page brings the staff tools back on fan pages. Only on page
 * changes, so pressing "Switch to fan view" here is not undone before the home page opens. */
export function useLeaveFanView(): void {
  const pathname = usePathname();
  const [, setFanView] = useFanView();
  useEffect(() => {
    setFanView(false);
  }, [pathname, setFanView]);
}
