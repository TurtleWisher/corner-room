import { StudioShell } from "@/components/shell/studio-shell";

/*
 * Artist Studio shell (D-THEME-02, ARTIST_STUDIO_DESIGN_GUIDE): the mint world for signed-in
 * artists and band admins. "Apply as an artist" is for fans and lives in the account group.
 */
export default function ArtistLayout({ children }: { children: React.ReactNode }) {
  return <StudioShell>{children}</StudioShell>;
}
