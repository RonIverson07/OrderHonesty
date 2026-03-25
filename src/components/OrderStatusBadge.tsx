import { cn } from "@/lib/utils";
import type { OrderStatus } from "@/lib/types";

interface OrderStatusBadgeProps {
  status: OrderStatus;
  size?: "sm" | "md";
}

export default function OrderStatusBadge({
  status,
  size = "sm",
}: OrderStatusBadgeProps) {
  return (
    <span
      className={cn(
        `status-${status} inline-flex items-center rounded-full font-medium capitalize`,
        size === "sm" ? "px-2 py-0.5 text-xs" : "px-3 py-1 text-sm"
      )}
    >
      {status}
    </span>
  );
}
