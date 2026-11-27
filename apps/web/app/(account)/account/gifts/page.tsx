"use client";

/*
 * Your gifts (owner, 2026-11-20, D-GIFT-FAN-01): the gifts you bought for other people and where
 * each one stands (never why one was declined), and your gift credit for each artist's music.
 */

import Link from "next/link";
import { Gift, ShoppingBag, Wallet } from "lucide-react";

import { ButtonLink, Card, DateTime, EmptyState, ErrorState, Money, Skeleton } from "@/components/ds";
import { AccountPage } from "@/components/shell/account-page";
import { RetryButton } from "@/components/shell/staff-panel";
import { loadErrorMessage, useAsync } from "@/components/use-async";
import { fetchMyFanGifts, fetchMyGiftCredit } from "@/features/fan-gifts/api";
import { GIVER_STATE, giftHref, giftStatusLine } from "@/lib/fan-gift-view";

function Gifts() {
  const data = useAsync(async () => {
    const [gifts, credit] = await Promise.all([fetchMyFanGifts(), fetchMyGiftCredit()]);
    return { gifts, credit };
  }, []);
  if (data.status === "loading") return <Skeleton className="h-64 w-full" />;
  if (data.status === "error") {
    return <ErrorState title="Gifts unavailable" message={loadErrorMessage(data.error, "your gifts")} action={<RetryButton onClick={data.reload} />} />;
  }
  const { gifts, credit } = data.data;
  return (
    <div className="space-y-12">
      <section aria-labelledby="credit">
        <h2 id="credit" className="mb-4 flex items-center gap-2 text-xl font-bold text-fg">
          <Wallet aria-hidden="true" className="size-5 text-highlight" /> Gift credit
        </h2>
        {credit.length === 0 ? (
          <p className="text-sm text-fg-muted">No credit. When a gift comes back to you, or you keep one as credit, it shows here.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {credit.map((c) => (
              <li key={`${c.act_id}-${c.balance.currency_code}`} className="cr-cut cr-glass-card p-5">
                <p className="text-sm text-fg-muted">For {c.act_name}&apos;s music</p>
                <p className="mt-1">
                  <Money value={c.balance} minorDigits="always" variant="display" className="text-2xl text-highlight" />
                </p>
                <p className="mt-2 text-xs text-fg-muted">
                  Spend it on any of their songs or releases, for you or as a gift: tick Pay with my gift credit at checkout.
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="sent">
        <h2 id="sent" className="mb-4 flex items-center gap-2 text-xl font-bold text-fg">
          <Gift aria-hidden="true" className="size-5 text-highlight" /> Gifts you sent
        </h2>
        {gifts.length === 0 ? (
          <EmptyState
            title="No gifts yet"
            body="On any song or release, choose Give it as a gift at checkout."
            action={
              <ButtonLink href="/store" size="sm">
                Go to the Store
              </ButtonLink>
            }
          />
        ) : (
          <ul className="grid gap-4">
            {gifts.map((g) => (
              <li key={g.id}>
                <Card className="p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link href={g.work_type === "RELEASE" ? `/releases/${g.work_id}` : `/tracks/${g.work_id}`} className="cr-focus text-lg font-bold text-fg hover:underline">
                        {g.title}
                      </Link>
                      <p className="text-sm text-fg-muted">
                        {g.act_name} · <Money value={g.each} minorDigits="always" /> each
                        {g.created_at ? (
                          <>
                            {" "}
                            · <DateTime value={g.created_at} format="date" />
                          </>
                        ) : null}
                      </p>
                    </div>
                    {g.status === "PENDING_PAYMENT" ? (
                      <ButtonLink href={`/checkout?order=${g.order_id}&world=sky`} size="sm" variant="secondary">
                        Pay now
                      </ButtonLink>
                    ) : g.send_again_offer_id ? (
                      <ButtonLink href={`${giftHref(g.send_again_offer_id)}&credit=1&again=${g.id}&world=sky`} size="sm" variant="secondary">
                        <Gift aria-hidden="true" /> Send it again
                      </ButtonLink>
                    ) : null}
                  </div>
                  <p className="mt-2 text-sm text-fg">{giftStatusLine(g)}</p>
                  <ul className="mt-3 grid gap-1 text-sm">
                    {g.people.map((p) => (
                      <li key={p.email} className="flex flex-wrap justify-between gap-2 border-b border-line py-1.5">
                        <span className="min-w-0 truncate text-fg">{p.name ? `${p.name} (${p.email})` : p.email}</span>
                        <span className="text-fg-muted">{GIVER_STATE[p.state]}</span>
                      </li>
                    ))}
                  </ul>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default function GiftsPage() {
  return (
    <AccountPage
      eyebrow="Your account"
      title="Your gifts"
      what="your gifts"
      actions={
        <ButtonLink href="/store" variant="secondary" size="sm">
          <ShoppingBag aria-hidden="true" /> Store
        </ButtonLink>
      }
    >
      <Gifts />
    </AccountPage>
  );
}
