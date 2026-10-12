"use client";

import { ShoppingBag } from "lucide-react";

import { OrdersTable } from "@/components/account/orders-table";
import { ButtonLink, EmptyState, ErrorState, Skeleton } from "@/components/ds";
import { AccountPage } from "@/components/shell/account-page";
import { RetryButton } from "@/components/shell/staff-panel";
import { loadErrorMessage, useAsync } from "@/components/use-async";
import { fetchMyOrders } from "@/lib/api";

function Orders() {
  const data = useAsync(() => fetchMyOrders().then((p) => p.items), []);
  if (data.status === "loading") return <Skeleton className="h-48 w-full" />;
  if (data.status === "error") {
    return <ErrorState title="Orders unavailable" message={loadErrorMessage(data.error, "your orders")} action={<RetryButton onClick={data.reload} />} />;
  }
  if (data.data.length === 0) {
    return <EmptyState title="No orders yet" body="Tickets, music and plans you buy appear here." action={<ButtonLink href="/store" size="sm">Go to the Store</ButtonLink>} />;
  }
  return <OrdersTable orders={data.data} />;
}

export default function OrdersPage() {
  return (
    <AccountPage
      eyebrow="Your account"
      title="Orders"
      what="your orders"
      actions={
        <ButtonLink href="/purchases" variant="secondary" size="sm">
          <ShoppingBag aria-hidden="true" /> What you own
        </ButtonLink>
      }
    >
      <Orders />
    </AccountPage>
  );
}
