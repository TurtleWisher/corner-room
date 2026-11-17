import { Money } from "@/components/ds";
import { lowestFor, priceLead } from "@/lib/open-price-view";

type Props = Omit<React.ComponentProps<typeof Money>, "value"> & {
  offer: { amount_minor: number; currency_code: string; open_price?: boolean; open_price_min_minor?: number | null };
};

/** An offer's price as the server sent it; an open price (D-OPEN-PRICE-01) reads "From ৳100". */
export function OfferPrice({ offer, ...money }: Props) {
  const lead = priceLead(offer);
  const value = { amount_minor: offer.open_price ? lowestFor(offer) : offer.amount_minor, currency_code: offer.currency_code };
  if (!lead) return <Money value={value} {...money} />;
  return (
    <span className="whitespace-nowrap">
      <span className="mr-1 text-[0.8em] font-semibold normal-case tracking-normal opacity-80">{lead}</span>
      <Money value={value} {...money} />
    </span>
  );
}
