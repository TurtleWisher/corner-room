import type { Metadata } from "next";

import { HomeView } from "@/components/home/home-view";

export const metadata: Metadata = {
  title: "Corner Room",
  description: "Live events, artists and the listening room, from one corner of the city.",
};

/* Role-adaptive home (Phase 16, Stage 5). The guest view is the brand hero plus the next event;
   signed-in users also get their shortcuts. */
export default function HomePage() {
  return <HomeView />;
}
