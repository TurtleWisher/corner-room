"use client";

import { Headphones, ShoppingBag } from "lucide-react";

import { useAuth } from "@/components/auth-provider";
import { Button, ButtonLink, Card, EmptyState, Money, Skeleton } from "@/components/ds";
import { usePlayableCatalog, useCustomerCommerce } from "@/components/music/commerce";
import { useCredits } from "@/components/music/credits";
import { ListenPage } from "@/components/music/listen-page";
import { usePlayer } from "@/components/music/player";
import { TrackRows } from "@/components/music/track-rows";
import { creditName, playQueue } from "@/lib/music-view";
import { catalogOffer, hasCatalogAccess, ownsTrack } from "@/lib/ownership";

/** Listening room home: what you can play now, and how to unlock the rest. */
export default function ListenHome() {
  const { status } = useAuth();
  const people = useCredits();
  const commerce = useCustomerCommerce();
  const catalog = usePlayableCatalog();
  const player = usePlayer();
  const access = hasCatalogAccess(commerce.entitlements);
  const pass = access ? null : catalogOffer(commerce.offers);
  const playable = catalog.list.filter((t) => t.catalog_playable && t.audio_deliverable);
  const queue = playQueue(
    catalog.list.map((t) => ({ trackId: t.id, title: t.title, artist: creditName(t, people.artists, people.bands) })),
    catalog.map,
    (id) => ownsTrack(commerce.entitlements, id),
  );
  const firstOwned = playable.find((t) => ownsTrack(commerce.entitlements, t.id));

  return (
    <ListenPage
      title="Listen"
      lede="Play what you own. Buy a track to keep it, or unlock everything with a plan."
      actions={
        firstOwned ? (
          <Button size="lg" onClick={() => void player.play({ id: firstOwned.id, title: firstOwned.title, artist: creditName(firstOwned, people.artists, people.bands) }, { queue, source: "Your music" })}>
            <Headphones aria-hidden="true" /> Play your music
          </Button>
        ) : null
      }
    >
      {status !== "authenticated" ? (
        <Card className="flex flex-col gap-4 p-6 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-lg font-bold text-fg">Sign in to listen</p>
            <p className="mt-1 text-sm text-fg-muted">Your purchases, plan and library follow your account.</p>
          </div>
          <div className="flex gap-2">
            <ButtonLink href="/login?next=%2Flisten">Sign in</ButtonLink>
            <ButtonLink href="/releases" variant="secondary">
              Browse releases
            </ButtonLink>
          </div>
        </Card>
      ) : (
        <>
          {commerce.ready && !access ? (
            <Card className="flex flex-col gap-4 p-6 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-lg font-bold text-fg">Unlock the whole catalog</p>
                <p className="mt-1 text-sm text-fg-muted">Choose a monthly plan, or buy the full catalog once.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <ButtonLink href="/store">See plans</ButtonLink>
                {pass ? (
                  <ButtonLink href={`/checkout?offer=${pass.id}`} variant="secondary">
                    <ShoppingBag aria-hidden="true" /> Full catalog <Money value={{ amount_minor: pass.amount_minor, currency_code: pass.currency_code }} />
                  </ButtonLink>
                ) : null}
              </div>
            </Card>
          ) : null}
          <section aria-labelledby="all-tracks">
            <h2 id="all-tracks" className="mb-4 text-xl font-bold text-fg">
              {access ? "Everything you can play" : "Tracks"}
            </h2>
            {!catalog.ready ? (
              <Skeleton className="h-48 w-full" />
            ) : catalog.list.length === 0 ? (
              <EmptyState title="Nothing to play yet" />
            ) : (
              <TrackRows
                label="Tracks"
                items={catalog.list.map((t) => ({ key: t.id, trackId: t.id }))}
                playable={catalog.map}
                people={people}
                commerce={commerce}
              />
            )}
          </section>
        </>
      )}
    </ListenPage>
  );
}
