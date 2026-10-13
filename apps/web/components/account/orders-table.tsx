import Link from "next/link";

import { Money, StatusChip, Table, TBody, TD, TH, THead, TR } from "@/components/ds";
import type { OrderRecord } from "@/lib/api";
import { humanizeStatus } from "@/lib/format/status";
import { ORDER_STATUS, PAYMENT_STATUS } from "@/lib/status-maps";

/** commerce order purposes: TICKET, TRACK (music, including the catalog pass), SUBSCRIPTION. */
const PURPOSE: Record<string, string> = { TICKET: "Tickets", TRACK: "Music", SUBSCRIPTION: "Subscription" };

/** The customer's orders: what for, order and payment state, and the full-precision total. */
export function OrdersTable({ orders }: { orders: OrderRecord[] }) {
  return (
    <Table label="Your orders">
      <THead>
        <TR>
          <TH>For</TH>
          <TH>Order</TH>
          <TH>Payment</TH>
          <TH numeric>Total</TH>
          <TH>
            <span className="sr-only">Open</span>
          </TH>
        </TR>
      </THead>
      <TBody>
        {orders.map((row) => (
          <TR key={row.id}>
            <TD>{row.purpose ? (PURPOSE[row.purpose] ?? humanizeStatus(row.purpose)) : "Order"}</TD>
            <TD>
              <StatusChip value={row.status} map={ORDER_STATUS} />
            </TD>
            <TD>{row.payment ? <StatusChip value={row.payment.status} map={PAYMENT_STATUS} /> : <span className="text-fg-muted">No payment</span>}</TD>
            <TD numeric>
              <Money value={{ amount_minor: row.total_amount_minor, currency_code: row.currency_code }} minorDigits="always" />
            </TD>
            <TD>
              {/* Every order reopens at its checkout address, which reads its status from the server. */}
              <Link
                href={`/checkout?order=${row.id}${row.purpose === "TICKET" ? "" : "&world=sky"}`}
                className="cr-focus text-sm font-semibold text-highlight hover:underline"
              >
                {row.status === "PENDING_PAYMENT" ? "Continue" : "View"}
              </Link>
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
