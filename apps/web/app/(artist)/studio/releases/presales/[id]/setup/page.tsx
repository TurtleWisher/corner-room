"use client";

/* A pre-sale campaign's setup (owner, 2026-11-06, D-PRESALE-04): price, date, review and the
 * release-day email, the same controls as the release editor's Pre-sale section. */

import Link from "next/link";
import { useParams } from "next/navigation";

import { Card } from "@/components/ds";
import { CampaignShell } from "@/components/studio/campaign-shell";
import { PresalePanel } from "@/components/studio/presale-panel";
import { PriceRow } from "@/components/studio/release-editor";
import { canProposePresale, presaleHint } from "@/lib/studio-view";

export default function CampaignSetupPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <CampaignShell releaseId={id}>
      {(detail, reload) =>
        canProposePresale(detail.release.status) && detail.presale ? (
          <PresalePanel
            key={`${detail.release.id}-${detail.release.version}`}
            detail={detail}
            reload={reload}
            priceRow={
              <PriceRow
                detail={detail}
                subjectType="RELEASE"
                subjectId={detail.release.id}
                label="What fans pay to pre-book"
                hint={presaleHint(detail.release.status, detail.release.release_at)}
                audience="PRESALE"
                reload={reload}
              />
            }
          />
        ) : (
          <Card tone="solid" className="p-5 text-sm text-fg">
            {detail.release.status === "RELEASED"
              ? "This release is out, so its pre-sale is over. Its numbers carry on under the release."
              : "This release can't take a pre-sale right now."}{" "}
            <Link href={`/studio/releases/${detail.release.id}`} className="cr-focus font-semibold text-link underline">
              Open the release
            </Link>
          </Card>
        )
      }
    </CampaignShell>
  );
}
