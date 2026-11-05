"use client";

/* What fans see of this pre-sale (owner, 2026-11-06, D-PRESALE-04): the cover as it shows now
 * (lightly blurred once the artist shows it, else the title on its glowing screen) and when the
 * cover is shown. */

import Link from "next/link";
import { useParams } from "next/navigation";
import { ExternalLink } from "lucide-react";

import { ButtonLink, Card, DateTime } from "@/components/ds";
import { PresaleCover } from "@/components/music/presale-cover";
import { CampaignShell } from "@/components/studio/campaign-shell";
import { CoverReveal } from "@/components/studio/cover-reveal";
import { coverUrl } from "@/lib/cover-view";
import { revealStatus } from "@/lib/cover-reveal-view";
import { RELEASE_TYPE_LABEL } from "@/lib/studio-view";

export default function CampaignFansPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <CampaignShell releaseId={id}>
      {(detail, reload) => {
        const shown = Boolean(detail.cover_reveal) && revealStatus(detail.cover_reveal) === "revealed";
        const date = detail.presale?.release_at ?? detail.presale?.requested_release_at ?? detail.release.release_at;
        return (
          <div className="grid gap-8 lg:grid-cols-[minmax(0,22rem)_1fr] lg:items-start">
            <div>
              <p className="cr-eyebrow mb-3 text-[0.6875rem] text-fg-muted">What fans see now</p>
              <div data-theme="sky" className="cr-scope p-4">
                <PresaleCover
                  coverUrl={shown ? coverUrl({ signed: detail.cover_url }, 480) : null}
                  title={detail.release.title}
                  artist={detail.profile.display_name}
                />
                <p className="mt-3 text-xs font-semibold text-highlight">
                  Pre-sale · {RELEASE_TYPE_LABEL[detail.release.release_type] ?? detail.release.release_type}
                </p>
                <p className="mt-1 text-xl font-bold text-fg">{detail.release.title}</p>
                <p className="text-sm text-fg">{detail.profile.display_name}</p>
                {date ? (
                  <p className="mt-1 text-sm text-fg-muted">
                    Out <DateTime value={date} format="datetime" />
                  </p>
                ) : null}
              </div>
              <ButtonLink href={`/releases/${detail.release.id}`} variant="secondary" size="sm" className="mt-4" target="_blank" rel="noopener">
                <ExternalLink aria-hidden="true" /> Open the fans&apos; page
              </ButtonLink>
            </div>
            <div className="grid gap-4">
              <Card tone="outline" className="p-5 text-sm text-fg">
                <p>
                  {shown
                    ? "Fans see your cover under a very light blur: enough to know it, not enough to see it clearly. It opens fully on release day."
                    : "Until you show your cover, fans see your title as a cube on a curved, glowing screen. Nothing of the cover, songs or credits shows before release."}
                </p>
                <p className="mt-2 text-fg-muted">
                  Fans see the title, your name, the date and the pre-sale price. To change the title or date once the pre-sale is approved, ask
                  Corner Room.
                </p>
              </Card>
              <CoverReveal key={`${detail.release.id}-${detail.release.version}`} detail={detail} reload={reload} />
              {!detail.cover_url ? (
                <p className="text-sm text-fg-muted">
                  No cover yet.{" "}
                  <Link href={`/studio/releases/${detail.release.id}`} className="cr-focus font-semibold text-link underline">
                    Add one in the release
                  </Link>{" "}
                  when it&apos;s ready; the pre-sale works without it.
                </p>
              ) : null}
            </div>
          </div>
        );
      }}
    </CampaignShell>
  );
}
