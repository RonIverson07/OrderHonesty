"use client";

import { useState, useEffect, useTransition } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/browser";
import { confirmOrderPayment } from "@/lib/domain/orders";
import SummaryCard from "@/components/SummaryCard";
import OrderStatusBadge from "@/components/OrderStatusBadge";
import { formatCurrency, timeAgo } from "@/lib/utils";
import type { OrderWithItems, Product, Ingredient, RetailStock } from "@/lib/types";

const DEMO_STATS = {
  totalOrders: 24, totalRevenue: 4280, totalCost: 892, totalMargin: 3388,
  cafeOrders: 18, fridgeOrders: 6,
  totalExpected: 4280, totalConfirmed: 3150, unconfirmedCount: 8,
  flaggedCount: 2,
};

const DEMO_ORDERS: OrderWithItems[] = [
  {
    id: "demo-r1", order_number: "CF-0012", source: "cafe", status: "completed", payment_method: "cash",
    payment_proof_url: null, payment_proof_status: "none", payment_confirmed: true, order_snapshot_url: null, notes: null,
    total_price: 280, total_cost: 45.6, margin: 234.4, created_at: new Date(Date.now() - 1200000).toISOString(),
    preparing_at: null, ready_at: null, completed_at: new Date(Date.now() - 900000).toISOString(),
    // V3 Fields
    confirmed_by: "demo-admin-id", confirmed_at: new Date(Date.now() - 1000000).toISOString(),
    customer_name: "Alice", payment_provider: "manual", payment_status: "paid", payment_reference: null, payment_amount: null, risk_flag: null,
    order_items: [
      { id: "oi1", order_id: "demo-r1", product_id: "c1", qty: 2, price_at_sale: 140, cost_at_sale: 22.8, products: { id: "c1", name: "Café Latte", type: "cafe", selling_price: 140, base_cost: null, image_url: null, active: true, low_stock_threshold: null, created_at: "" } },
    ],
  },
  {
    id: "demo-r2", order_number: "FR-0005", source: "fridge", status: "completed", payment_method: "gcash",
    payment_proof_url: null, payment_proof_status: "uploaded", payment_confirmed: false, order_snapshot_url: null, notes: null,
    total_price: 105, total_cost: 52, margin: 53, created_at: new Date(Date.now() - 2400000).toISOString(),
    preparing_at: null, ready_at: null, completed_at: null,
    // V3 Fields
    confirmed_by: null, confirmed_at: null,
    customer_name: null, payment_provider: "manual", payment_status: "unpaid", payment_reference: null, payment_amount: null, risk_flag: null,
    order_items: [
      { id: "oi2", order_id: "demo-r2", product_id: "r1", qty: 3, price_at_sale: 35, cost_at_sale: 18, products: { id: "r1", name: "Chips Pack", type: "retail", selling_price: 35, base_cost: 18, image_url: null, active: true, low_stock_threshold: 5, created_at: "" } },
    ],
  },
];

const DEMO_LOW_STOCK = [
  { name: "Energy Drink", stock: 3, threshold: 5 },
  { name: "Granola Bar", stock: 2, threshold: 5 },
];

const DEMO_LOW_INGREDIENTS = [
  { name: "Matcha Powder", stock: 150, threshold: 200, unit: "g" },
];

export default function DashboardPage() {
  const [stats, setStats] = useState(DEMO_STATS);
  const [orders, setOrders] = useState<OrderWithItems[]>(DEMO_ORDERS);
  const [lowStockRetail, setLowStockRetail] = useState(DEMO_LOW_STOCK);
  const [lowStockIngredients, setLowStockIngredients] = useState(DEMO_LOW_INGREDIENTS);
  const [isDemo, setIsDemo] = useState(true);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const supabase = createClient();
    
    async function load() {
      try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const { data: ordersData, error: ordersError } = await supabase
          .from("orders")
          .select("*, order_items(*, products!product_id(*))")
          .gte("created_at", today.toISOString())
          .order("created_at", { ascending: false })
          .limit(50);
        
        if (ordersError) {
          console.error("Dashboard Load Error:", ordersError);
          return;
        }

        const fetched = (ordersData ?? []) as OrderWithItems[];
        setOrders(fetched);

        const totalRevenue = fetched.reduce((s, o) => s + Number(o.total_price || 0), 0);
        const totalCost = fetched.reduce((s, o) => s + Number(o.total_cost || 0), 0);
        const totalConfirmed = fetched.filter((o) => o.payment_confirmed).reduce((s, o) => s + Number(o.total_price || 0), 0);

        setStats({
          totalOrders: fetched.length,
          totalRevenue,
          totalCost,
          totalMargin: totalRevenue - totalCost,
          cafeOrders: fetched.filter((o) => o.source === "cafe").length,
          fridgeOrders: fetched.filter((o) => o.source === "fridge").length,
          totalExpected: totalRevenue,
          totalConfirmed,
          unconfirmedCount: fetched.filter((o) => !o.payment_confirmed).length,
          flaggedCount: fetched.filter((o) => o.risk_flag).length,
        });

        // Low stock
        const { data: retailData } = await supabase
          .from("products").select("*, retail_stock(*)").eq("type", "retail").eq("active", true);

        if (retailData) {
          setLowStockRetail(
            (retailData as (Product & { retail_stock: RetailStock[] })[])
              .map((p) => ({
                name: p.name,
                stock: Array.isArray(p.retail_stock) ? (p.retail_stock[0]?.stock ?? 0) : 0,
                threshold: p.low_stock_threshold ?? 5,
              }))
              .filter((p) => p.stock <= p.threshold)
          );
        }

        const { data: ingData } = await supabase.from("ingredients").select("*").order("name");
        if (ingData) {
          setLowStockIngredients(
            (ingData as Ingredient[])
              .filter((i) => i.stock <= i.low_stock_threshold)
              .map((i) => ({ name: i.name, stock: i.stock, threshold: i.low_stock_threshold, unit: i.unit }))
          );
        }

        setIsDemo(false);
      } catch (err) {
        console.error("Dashboard critical error:", err);
      }
    }

    load();

    // Subscribe to real-time updates for orders
    const channel = supabase
      .channel("dashboard-updates")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => {
        load();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const handleConfirmPayment = (orderId: string) => {
    startTransition(async () => {
      if (isDemo) {
        setOrders((prev) => prev.map((o) => o.id === orderId ? { ...o, payment_confirmed: true } : o));
        return;
      }
      await confirmOrderPayment(orderId);
      window.location.reload();
    });
  };

  const leakage = stats.totalExpected - stats.totalConfirmed;
  const leakagePct = stats.totalExpected > 0 ? ((leakage / stats.totalExpected) * 100).toFixed(1) : "0";

  // System Health Logic
  let healthStatus: "healthy" | "warning" | "critical" = "healthy";
  let healthMessage = "All systems operational.";
  const totalWarnings = stats.unconfirmedCount + stats.flaggedCount + lowStockRetail.length + lowStockIngredients.length;
  
  if (leakage > 1000 || stats.flaggedCount > 3) {
    healthStatus = "critical";
    healthMessage = "Immediate attention required. High variance or multiple flagged orders.";
  } else if (totalWarnings > 0) {
    healthStatus = "warning";
    healthMessage = `${totalWarnings} items need review (unconfirmed payments, low stock, or flagged orders).`;
  }

  // CSV Export
  const exportOrdersCSV = () => {
    const headers = ["Order Number", "Source", "Status", "Payment Method", "Confirmed", "Total Price", "Risk Flag", "Date"];
    const rows = orders.map(o => [
      o.order_number || o.id,
      o.source,
      o.status,
      o.payment_method,
      o.payment_confirmed ? "Yes" : "No",
      o.total_price,
      o.risk_flag || "None",
      new Date(o.created_at).toLocaleString()
    ]);
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `labrew_orders_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div>
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-500">Today&apos;s overview</p>
          {isDemo && (
            <div className="mt-2 p-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-xs inline-block">
              ⚡ Demo mode
            </div>
          )}
        </div>
        
        <button 
          onClick={exportOrdersCSV}
          className="btn-secondary text-xs flex items-center gap-2 max-w-fit"
        >
          <span>📥</span> Export Today&apos;s Orders
        </button>
      </div>

      {/* V3 Governance: Health & Checklist */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        {/* System Health Indicator */}
        <div className={`card p-4 border-l-4 ${
          healthStatus === "healthy" ? "border-l-emerald-500 bg-emerald-50/30" : 
          healthStatus === "warning" ? "border-l-amber-500 bg-amber-50/30" : 
          "border-l-red-500 bg-red-50/30"
        }`}>
          <div className="flex items-center gap-3 mb-2">
            <div className={`w-3 h-3 rounded-full ${
              healthStatus === "healthy" ? "bg-emerald-500" : 
              healthStatus === "warning" ? "bg-amber-500 animate-pulse" : 
              "bg-red-500 animate-pulse"
            }`}></div>
            <h3 className="font-semibold text-gray-900">System Health: <span className="capitalize">{healthStatus}</span></h3>
          </div>
          <p className="text-sm text-gray-600">{healthMessage}</p>
        </div>

        {/* Operator Checklist */}
        <div className="card p-4">
          <h3 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">
            <span>📋</span> Operator Checklist
          </h3>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <label className="flex items-center gap-2 text-gray-700">
              <input type="checkbox" className="rounded text-amber-600 focus:ring-amber-500" checked={stats.unconfirmedCount === 0} readOnly />
              <span className={stats.unconfirmedCount === 0 ? "line-through text-gray-400" : ""}>Confirm {stats.unconfirmedCount} Payments</span>
            </label>
            <label className="flex items-center gap-2 text-gray-700">
              <input type="checkbox" className="rounded text-amber-600 focus:ring-amber-500" checked={stats.flaggedCount === 0} readOnly />
              <span className={stats.flaggedCount === 0 ? "line-through text-gray-400" : "font-medium text-red-600"}>Resolve {stats.flaggedCount} Flagged</span>
            </label>
            <label className="flex items-center gap-2 text-gray-700">
              <input type="checkbox" className="rounded text-amber-600 focus:ring-amber-500" checked={lowStockRetail.length === 0 && lowStockIngredients.length === 0} readOnly />
              <span className={lowStockRetail.length === 0 && lowStockIngredients.length === 0 ? "line-through text-gray-400" : ""}>Handle Low Stock</span>
            </label>
            <label className="flex items-center gap-2 text-gray-700">
              <input type="checkbox" className="rounded text-amber-600 focus:ring-amber-500" checked={leakage === 0} readOnly />
              <span className={leakage === 0 ? "line-through text-gray-400" : ""}>Reconcile Day</span>
            </label>
          </div>
        </div>
      </div>

      {/* Quick Links (mobile-friendly) */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6 lg:hidden">
        {[
          { href: "/dashboard/products", icon: "📦", label: "Products" },
          { href: "/dashboard/ingredients", icon: "🧪", label: "Ingredients" },
          { href: "/dashboard/recipes", icon: "📋", label: "Recipes" },
          { href: "/dashboard/stock", icon: "📥", label: "Stock" },
          { href: "/dashboard/reconciliation", icon: "🧾", label: "Reconcile" },
        ].map((link) => (
          <Link key={link.href} href={link.href} className="card p-3 text-center hover:shadow-md transition-shadow">
            <span className="text-2xl block mb-1">{link.icon}</span>
            <span className="text-xs font-medium text-gray-600">{link.label}</span>
          </Link>
        ))}
      </div>

      {/* Stats Row 1 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <SummaryCard icon="📦" title="Total Orders" value={stats.totalOrders.toString()} subtitle={`${stats.cafeOrders} café · ${stats.fridgeOrders} fridge`} trend="neutral" />
        <SummaryCard icon="💰" title="Revenue" value={formatCurrency(stats.totalRevenue)} trend="up" />
        <SummaryCard icon="📉" title="COGS" value={formatCurrency(stats.totalCost)} trend="neutral" />
        <SummaryCard icon="📈" title="Margin" value={formatCurrency(stats.totalMargin)} subtitle={stats.totalRevenue > 0 ? `${((stats.totalMargin / stats.totalRevenue) * 100).toFixed(1)}%` : "—"} trend="up" />
      </div>

      {/* Stats Row 2: Reconciliation */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        <SummaryCard icon="🎯" title="Expected Revenue" value={formatCurrency(stats.totalExpected)} trend="neutral" />
        <SummaryCard icon="✅" title="Confirmed" value={formatCurrency(stats.totalConfirmed)} subtitle={`${stats.unconfirmedCount} unconfirmed`} trend={stats.totalConfirmed >= stats.totalExpected ? "up" : "down"} />
        <SummaryCard icon={leakage > 0 ? "⚠️" : "🎉"} title="Unconfirmed Gap" value={formatCurrency(leakage)} subtitle={`${leakagePct}% of expected`} trend={leakage > 0 ? "down" : "up"} />
      </div>

      {/* Two-column: Orders + Alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <h2 className="text-lg font-semibold text-gray-900 mb-3">Recent Orders</h2>
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="text-left py-3 px-4 font-medium text-gray-500">Order</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-500">Items</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-500">Status</th>
                    <th className="text-center py-3 px-4 font-medium text-gray-500">Proof</th>
                    <th className="text-right py-3 px-4 font-medium text-gray-500">Total</th>
                    <th className="text-center py-3 px-4 font-medium text-gray-500">Paid</th>
                    <th className="text-center py-3 px-4 font-medium text-gray-500">Snap</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.slice(0, 10).map((order) => {
                    const proofStyles: Record<string, string> = {
                      none: "bg-gray-100 text-gray-400",
                      uploaded: "bg-amber-50 text-amber-700",
                      confirmed: "bg-emerald-50 text-emerald-700",
                      flagged: "bg-red-50 text-red-700",
                    };
                    const proofLabels: Record<string, string> = {
                      none: "—", uploaded: "📎", confirmed: "✓", flagged: "⚠",
                    };
                    return (
                    <tr key={order.id} className="border-b border-gray-50 hover:bg-gray-25">
                      <td className="py-3 px-4">
                        <span className="font-semibold text-amber-600 text-sm">{order.order_number || `#${order.id.slice(0, 8)}`}</span>
                        <span className="text-xs text-gray-400 ml-1.5">{timeAgo(order.created_at)}</span>
                      </td>
                      <td className="py-3 px-4 text-gray-600 max-w-[180px] truncate">
                        {order.order_items.map((i) => `${i.qty}× ${i.products.name}`).join(", ")}
                      </td>
                      <td className="py-3 px-4"><OrderStatusBadge status={order.status} /></td>
                      <td className="py-3 px-4 text-center">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${proofStyles[order.payment_proof_status] ?? proofStyles.none}`}>
                          {proofLabels[order.payment_proof_status] ?? "—"}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right font-medium">{formatCurrency(order.total_price)}</td>
                      <td className="py-3 px-4 text-center">
                        {order.payment_confirmed ? (
                          <span className="text-emerald-600 text-xs font-medium">✓</span>
                        ) : (
                          <button onClick={() => handleConfirmPayment(order.id)} disabled={isPending}
                            className="text-xs px-2 py-1 rounded bg-amber-50 border border-amber-200 text-amber-700 hover:bg-amber-100 transition disabled:opacity-50">
                            Confirm
                          </button>
                        )}
                      </td>
                      <td className="py-3 px-4 text-center">
                        {order.order_snapshot_url ? (
                          <a href={order.order_snapshot_url} target="_blank" rel="noopener noreferrer" className="inline-block group">
                            <div className="w-8 h-8 rounded overflow-hidden border border-gray-200 group-hover:ring-2 group-hover:ring-amber-300 transition-all mx-auto">
                              <img src={order.order_snapshot_url} alt="" className="w-full h-full object-cover" />
                            </div>
                          </a>
                        ) : (
                          <span className="text-xs text-gray-300">—</span>
                        )}
                      </td>
                    </tr>
                    );
                  })}
                  {orders.length === 0 && (
                    <tr><td colSpan={7} className="py-8 text-center text-gray-400">No orders today</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Low Stock Alerts */}
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-3">⚠️ Low Stock</h2>
          <div className="space-y-3">
            {lowStockRetail.length === 0 && lowStockIngredients.length === 0 && (
              <div className="card p-4 text-center text-gray-400 text-sm">All stock healthy ✅</div>
            )}
            {lowStockRetail.length > 0 && (
              <div className="card p-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-medium text-gray-500">Retail Items</h3>
                  <Link href="/dashboard/stock" className="text-xs text-amber-600 hover:underline">Manage →</Link>
                </div>
                <div className="space-y-2">
                  {lowStockRetail.map((item, idx) => (
                    <div key={idx} className="flex items-center justify-between">
                      <span className="text-sm text-gray-700">{item.name}</span>
                      <div className="flex items-center gap-2">
                        <div className="w-12 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full bg-red-500 rounded-full" style={{ width: `${Math.min(100, (item.stock / item.threshold) * 100)}%` }} />
                        </div>
                        <span className="text-xs font-medium text-red-600 w-6 text-right">{item.stock}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {lowStockIngredients.length > 0 && (
              <div className="card p-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-medium text-gray-500">Ingredients</h3>
                  <Link href="/dashboard/stock" className="text-xs text-amber-600 hover:underline">Manage →</Link>
                </div>
                <div className="space-y-2">
                  {lowStockIngredients.map((item, idx) => (
                    <div key={idx} className="flex items-center justify-between">
                      <span className="text-sm text-gray-700">{item.name}</span>
                      <span className="text-xs text-amber-600 font-medium">{item.stock}{item.unit}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
