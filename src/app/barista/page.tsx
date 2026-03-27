"use client";

import { useState, useEffect, useCallback, useTransition } from "react";
import { createClient } from "@/lib/supabase/browser";
import { updateStatus } from "@/lib/domain/orders";
import OrderStatusBadge from "@/components/OrderStatusBadge";
import { formatCurrency, timeAgo } from "@/lib/utils";
import type { OrderWithItems, OrderStatus } from "@/lib/types";
import { Target } from "lucide-react";

const STATUS_FLOW: Record<string, OrderStatus> = {
  new: "preparing",
  preparing: "ready",
  ready: "completed",
};

const STATUS_ACTION_LABELS: Record<string, string> = {
  new: "▶ Start Preparing",
  preparing: "✅ Mark Ready",
  ready: "🏁 Complete",
};


export default function BaristaPage() {
  const [orders, setOrders] = useState<OrderWithItems[]>([]);
  const [isPending, startTransition] = useTransition();

  const loadOrders = useCallback(async () => {
    try {
      const supabase = createClient();
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const { data, error } = await supabase
        .from("orders")
        .select("*, order_items(*, products!fk_order_items_product_id(*))")
        .in("status", ["new", "preparing", "ready"])
        .order("created_at", { ascending: true });
      if (error) throw error;
      setOrders((data ?? []) as OrderWithItems[]);
    } catch (err) {
      console.error("Error loading orders:", err);
      setOrders([]);
    }
  }, []);

  useEffect(() => {
    loadOrders();
    try {
      const supabase = createClient();
      const channel = supabase
        .channel("barista-orders")
        .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => { loadOrders(); })
        .subscribe();
      return () => { supabase.removeChannel(channel); };
    } catch (err) {
      console.error("Realtime subscription error:", err);
    }
  }, [loadOrders]);

  const handleStatusChange = (orderId: string, currentStatus: string) => {
    const nextStatus = STATUS_FLOW[currentStatus];
    if (!nextStatus) return;
    startTransition(async () => {
      const result = await updateStatus(orderId, nextStatus);
      if (result.success) await loadOrders();
    });
  };

  const handleCancel = (orderId: string) => {
    startTransition(async () => {
      const result = await updateStatus(orderId, "cancelled");
      if (result.success) await loadOrders();
    });
  };

  const grouped = {
    new: orders.filter((o) => o.status === "new"),
    preparing: orders.filter((o) => o.status === "preparing"),
    ready: orders.filter((o) => o.status === "ready"),
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 mb-1 flex items-center gap-2">
            <Target className="w-8 h-8 text-amber-700" /> Barista Queue
          </h1>
          <p className="text-gray-500">Active orders — updates in realtime</p>
        </div>
        <div className="text-right">
          <div className="text-3xl font-bold text-gray-900">{orders.length}</div>
          <div className="text-xs text-gray-400">Active Orders</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {(["new", "preparing", "ready"] as const).map((statusKey) => (
          <div key={statusKey}>
            <div className="flex items-center gap-2 mb-3">
              <OrderStatusBadge status={statusKey} size="md" />
              <span className="text-sm text-gray-400 font-medium">{grouped[statusKey].length}</span>
            </div>

            <div className="space-y-3">
              {grouped[statusKey].length === 0 && (
                <div className="text-center py-8 text-gray-400 text-sm card">No orders</div>
              )}
              {grouped[statusKey].map((order) => (
                <div key={order.id} className={`card p-4 animate-slide-in ${order.status === "new" ? "pulse-glow" : ""}`}>
                  {/* --- PRIMARY INFO --- */}
                  <div className="flex items-start justify-between mb-3 border-b border-gray-100 pb-3">
                    <div>
                      <div className="flex items-baseline gap-2">
                        <span className="text-xl font-black text-gray-900 tracking-tight">
                          {order.order_number || `#${order.id.slice(0, 8)}`}
                        </span>
                        {/* Timer / Time Ago */}
                        {order.status === "preparing" && order.preparing_at ? (
                          <span className="text-sm font-semibold text-amber-600 animate-pulse">
                            ⏱ {timeAgo(order.preparing_at)}
                          </span>
                        ) : (
                          <span className="text-sm font-medium text-gray-400">
                            {timeAgo(order.created_at)}
                          </span>
                        )}
                      </div>
                      
                      {/* Critical Risk Flag */}
                      {order.risk_flag && (
                        <div className="mt-1 flex items-center gap-1 text-xs font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded border border-red-100 w-fit">
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                          CRITICAL: {order.risk_flag}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Order Items (Tablet Optimized) */}
                  <div className="space-y-2 mb-4">
                    {order.order_items.map((item) => (
                      <div key={item.id} className="flex justify-between items-start text-base font-medium text-gray-800">
                        <span className="leading-tight">
                          <span className="font-bold text-gray-900 mr-1.5">{item.qty}×</span>
                          {item.products.name}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* --- SECONDARY INFO (Footer Pill Row) --- */}
                  <div className="bg-gray-50 rounded-lg p-2.5 mb-4 flex flex-wrap items-center gap-1.5 border border-gray-100">
                    {/* Source */}
                    <span className="text-[11px] font-semibold tracking-wide uppercase px-2 py-0.5 rounded bg-white border border-gray-200 text-gray-600">
                      {order.source === "cafe" ? "☕ Café" : "🧊 Fridge"}
                    </span>
                    
                    {/* Payment Status */}
                    {order.payment_status === "paid" && (
                      <span className="text-[11px] font-semibold tracking-wide uppercase px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-200">💳 Paid</span>
                    )}
                    {order.payment_status === "pending" && (
                      <span className="text-[11px] font-semibold tracking-wide uppercase px-2 py-0.5 rounded bg-blue-100 text-blue-800 border border-blue-200">⏳ Pend</span>
                    )}
                    {order.payment_status === "failed" && (
                      <span className="text-[11px] font-semibold tracking-wide uppercase px-2 py-0.5 rounded bg-red-100 text-red-800 border border-red-200">✕ Fail</span>
                    )}
                    
                    {/* Proof Status */}
                    {order.payment_proof_status === "uploaded" && (
                      <span className="text-[11px] font-semibold tracking-wide uppercase px-2 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200">📎 Revw</span>
                    )}
                    {order.payment_proof_status === "flagged" && (
                      <span className="text-[11px] font-semibold tracking-wide uppercase px-2 py-0.5 rounded bg-red-100 text-red-800 border border-red-200">⚠ Flag</span>
                    )}

                    {/* Snapshot Thumbnail (Mini) */}
                    {order.order_snapshot_url && (
                      <a href={order.order_snapshot_url} target="_blank" rel="noopener noreferrer" className="ml-auto">
                        <span title="View Snapshot" className="text-[11px] font-semibold tracking-wide uppercase px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 transition-colors flex items-center gap-1">
                          📷 Snap
                        </span>
                      </a>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2">
                    {STATUS_FLOW[order.status] && (
                      <button
                        onClick={() => handleStatusChange(order.id, order.status)}
                        disabled={isPending}
                        className="btn-primary flex-1 text-sm py-2.5 font-bold shadow-sm"
                      >
                        {STATUS_ACTION_LABELS[order.status]}
                      </button>
                    )}
                    {order.status !== "ready" && (
                      <button
                        onClick={() => handleCancel(order.id)}
                        disabled={isPending}
                        className="btn-secondary text-sm py-2.5 bg-white border border-gray-300 shadow-sm hover:bg-gray-50"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
