"use client";

import { useState, useEffect, useTransition } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/browser";
import { confirmOrderPayment } from "@/lib/domain/orders";
import SummaryCard from "@/components/SummaryCard";
import OrderStatusBadge from "@/components/OrderStatusBadge";
import { formatCurrency, timeAgo } from "@/lib/utils";
import Skeleton from "@/components/Skeleton";
import type { OrderWithItems, Product, Ingredient, RetailStock } from "@/lib/types";
import {
  Package, DollarSign, TrendingDown, TrendingUp,
  Target, CheckCircle2, AlertTriangle, ClipboardList,
  Download, Zap, FlaskConical, ChefHat, Inbox, Receipt,
  Paperclip, CheckCheck, AlertOctagon, X
} from "lucide-react";

const GHOST_STATS = {
  totalOrders: 0, totalRevenue: 0, totalCost: 0, totalMargin: 0,
  cafeOrders: 0, fridgeOrders: 0,
  totalExpected: 0, totalConfirmed: 0, unconfirmedCount: 0,
  flaggedCount: 0,
};

export default function DashboardPage() {
  const [stats, setStats] = useState(GHOST_STATS);
  const [orders, setOrders] = useState<OrderWithItems[]>([]);
  const [lowStockRetail, setLowStockRetail] = useState<any[]>([]);
  const [lowStockIngredients, setLowStockIngredients] = useState<any[]>([]);
  const [isDemo, setIsDemo] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isPending, startTransition] = useTransition();
  const [zoomImage, setZoomImage] = useState<string | null>(null);
  const [viewItemsOrder, setViewItemsOrder] = useState<OrderWithItems | null>(null);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [showCustomExport, setShowCustomExport] = useState(false);
  const [customStartStr, setCustomStartStr] = useState("");
  const [customEndStr, setCustomEndStr] = useState("");

  useEffect(() => {
    const supabase = createClient();

    async function load() {
      try {
        setLoading(true);
        // Is this a demo URL?
        const isActuallyDemo = !process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL.includes("demo");
        setIsDemo(isActuallyDemo);

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
          setLoading(false);
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
          flaggedCount: fetched.filter((o) => o.payment_proof_status === "flagged" || o.risk_flag).length,
        });

        // Low stock — normalize retail_stock array → object (same as stock page)
        const { data: retailData } = await supabase
          .from("products").select("*, retail_stock(*)").eq("type", "retail").eq("active", true).order("name");

        if (retailData) {
          const normalized = (retailData as (Product & { retail_stock: RetailStock[] })[]).map((p) => {
            const stockRow: RetailStock | null = Array.isArray(p.retail_stock)
              ? (p.retail_stock[0] ?? null)
              : (p.retail_stock as RetailStock | null);
            return {
              name: p.name,
              stock: stockRow?.stock ?? 0,
              threshold: p.low_stock_threshold ?? 5,
            };
          });
          setLowStockRetail(
            normalized.filter((p) => p.stock <= p.threshold)
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

        setLoading(false);
      } catch (err) {
        console.error("Dashboard critical error:", err);
        setLoading(false);
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
  const exportOrdersCSV = async (range: "daily" | "weekly" | "monthly" | "q1" | "q2" | "q3" | "q4" | "yearly" | "custom") => {
    try {
      const supabase = createClient();
      const now = new Date();
      let startDate = new Date();
      let endDate = new Date();
      let useEndDate = false;

      if (range === "custom") {
        if (!customStartStr || !customEndStr) {
          alert("Please select both start and end dates.");
          return;
        }
        startDate = new Date(customStartStr);
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(customEndStr);
        endDate.setHours(23, 59, 59, 999);
        useEndDate = true;
      } else if (range === "daily") {
        startDate.setHours(0, 0, 0, 0);
      } else if (range === "weekly") {
        const day = startDate.getDay();
        const diff = startDate.getDate() - day + (day === 0 ? -6 : 1);
        startDate = new Date(startDate.setDate(diff));
        startDate.setHours(0, 0, 0, 0);
      } else if (range === "monthly") {
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      } else if (range === "q1") {
        startDate = new Date(now.getFullYear(), 0, 1);
        endDate = new Date(now.getFullYear(), 3, 0, 23, 59, 59, 999);
        useEndDate = true;
      } else if (range === "q2") {
        startDate = new Date(now.getFullYear(), 3, 1);
        endDate = new Date(now.getFullYear(), 6, 0, 23, 59, 59, 999);
        useEndDate = true;
      } else if (range === "q3") {
        startDate = new Date(now.getFullYear(), 6, 1);
        endDate = new Date(now.getFullYear(), 9, 0, 23, 59, 59, 999);
        useEndDate = true;
      } else if (range === "q4") {
        startDate = new Date(now.getFullYear(), 9, 1);
        endDate = new Date(now.getFullYear(), 12, 0, 23, 59, 59, 999);
        useEndDate = true;
      } else if (range === "yearly") {
        startDate = new Date(now.getFullYear(), 0, 1);
      }

      let query = supabase
        .from("orders")
        .select("*, order_items(*, products!product_id(*))")
        .gte("created_at", startDate.toISOString())
        .order("created_at", { ascending: false });

      if (useEndDate) {
        query = query.lte("created_at", endDate.toISOString());
      }

      const { data, error } = await query;

      if (error) throw error;

      const fetchedOrders = data || [];
      const overallProfit = fetchedOrders.reduce((sum: number, o: any) => {
        return o.payment_confirmed ? sum + Number(o.total_price || 0) : sum;
      }, 0);
      const unconfirmedGap = fetchedOrders.reduce((sum: number, o: any) => {
        return !o.payment_confirmed ? sum + Number(o.total_price || 0) : sum;
      }, 0);

      const headers = ["Order Number", "Source", "Items", "Status", "Payment Method", "Confirmed", "Total Price", "Risk Flag", "Date", "", "Overall Profit", "Unconfirmed Gap"];
      const rows = fetchedOrders.map((o: any, idx: number) => {
        const itemsStr = o.order_items?.map((i: any) => `${i.qty}x ${i.products?.name}`).join(", ") || "No items";
        return [
          o.order_number || o.id,
          o.source,
          `"${itemsStr}"`,
          o.status,
          o.payment_method,
          o.payment_confirmed ? "Yes" : "No",
          o.total_price,
          o.risk_flag ? "Flagged" : "None",
          `"${new Date(o.created_at).toLocaleString()}"`,
          "",
          idx === 0 ? overallProfit : "",
          idx === 0 ? unconfirmedGap : ""
        ];
      });
      const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement("a");
      let rangeLabel = range.charAt(0).toUpperCase() + range.slice(1);
      if (range.startsWith("q")) rangeLabel = range.toUpperCase();
      
      let formattedDate = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }).replace(',', '');
      
      if (range !== "daily") {
        let printEndDate = new Date();
        if (range === "monthly") {
          printEndDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        } else if (range === "yearly") {
          printEndDate = new Date(now.getFullYear(), 11, 31);
        } else if (range.startsWith("q") || range === "custom") {
          printEndDate = endDate;
        }
        
        let startFmt = startDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
        if (range === "custom" || startDate.getFullYear() !== printEndDate.getFullYear()) {
          startFmt = startDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }).replace(',', '');
        }
        const endFmt = printEndDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }).replace(',', '');
        formattedDate = `${startFmt} to ${endFmt}`;
      }
      
      link.setAttribute("href", encodedUri);
      link.setAttribute("download", `Cafe ${rangeLabel} Sales ${formattedDate}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error("CSV Export failed", err);
      alert("Failed to export dashboard data.");
    }
  };

  return (
    <div>
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-500">Today&apos;s overview</p>
          {isDemo && (
            <div className="mt-2 p-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-xs inline-flex items-center gap-1">
              <Zap className="w-3 h-3" /> Demo mode
            </div>
          )}
        </div>

        <div className="relative inline-block text-left">
          <button
            type="button"
            onClick={() => setExportMenuOpen(!exportMenuOpen)}
            disabled={loading}
            className="group inline-flex items-center gap-2 justify-center w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-4 focus:ring-amber-500/10 focus:border-amber-400 transition-all disabled:opacity-50"
          >
            <Download className="w-4 h-4 text-gray-500 group-hover:text-amber-600 transition-colors" />
            Export CSV...
            <svg className={`w-4 h-4 text-gray-400 transition-transform ${exportMenuOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7" /></svg>
          </button>

          {exportMenuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setExportMenuOpen(false)} />
              <div className="absolute right-0 z-50 mt-2 w-48 origin-top-right rounded-xl bg-white shadow-xl border border-gray-100 focus:outline-none overflow-hidden animate-in fade-in slide-in-from-top-2">
              <div className="py-1">
                {[
                  { id: "daily", label: "Daily Sales" },
                  { id: "weekly", label: "Weekly Sales" },
                  { id: "monthly", label: "Monthly Sales" },
                  { id: "q1", label: "Q1 Sales (Jan-Mar)" },
                  { id: "q2", label: "Q2 Sales (Apr-Jun)" },
                  { id: "q3", label: "Q3 Sales (Jul-Sep)" },
                  { id: "q4", label: "Q4 Sales (Oct-Dec)" },
                  { id: "yearly", label: "Yearly Sales" },
                  { id: "custom", label: "Custom Date Range..." }
                ].map((range) => (
                  <button
                    key={range.id}
                    onClick={() => {
                      setExportMenuOpen(false);
                      if (range.id === "custom") {
                        setShowCustomExport(true);
                      } else {
                        exportOrdersCSV(range.id as any);
                      }
                    }}
                    className="flex w-full items-center px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-amber-50 hover:text-amber-700 transition-colors"
                  >
                    <span>{range.label}</span>
                  </button>
                ))}
              </div>
            </div>
            </>
          )}
        </div>
      </div>

      {loading ? (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Skeleton className="lg:col-span-2 h-96 w-full" />
            <Skeleton className="h-96 w-full" />
          </div>
        </div>
      ) : (
        <>

          {/* V3 Governance: Health & Checklist */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            {/* System Health Indicator */}
            <div className={`card p-4 border-l-4 ${healthStatus === "healthy" ? "border-l-emerald-500 bg-emerald-50/30" :
              healthStatus === "warning" ? "border-l-amber-500 bg-amber-50/30" :
                "border-l-red-500 bg-red-50/30"
              }`}>
              <div className="flex items-center gap-3 mb-2">
                <div className={`w-3 h-3 rounded-full ${healthStatus === "healthy" ? "bg-emerald-500" :
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
                <ClipboardList className="w-4 h-4 text-amber-600" /> Operator Checklist
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
            {([
              { href: "/dashboard/products", icon: <Package className="w-6 h-6 text-amber-600 mx-auto" />, label: "Products" },
              { href: "/dashboard/ingredients", icon: <FlaskConical className="w-6 h-6 text-emerald-600 mx-auto" />, label: "Ingredients" },
              { href: "/dashboard/recipes", icon: <ChefHat className="w-6 h-6 text-purple-600 mx-auto" />, label: "Recipes" },
              { href: "/dashboard/stock", icon: <Inbox className="w-6 h-6 text-blue-600 mx-auto" />, label: "Stock" },
              { href: "/dashboard/reconciliation", icon: <Receipt className="w-6 h-6 text-rose-600 mx-auto" />, label: "Reconcile" },
            ] as { href: string; icon: React.ReactNode; label: string }[]).map((link) => (
              <Link key={link.href} href={link.href} className="card p-3 text-center hover:shadow-md transition-shadow">
                <span className="block mb-1">{link.icon}</span>
                <span className="text-xs font-medium text-gray-600">{link.label}</span>
              </Link>
            ))}
          </div>

          {/* Stats Row 1 */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            <SummaryCard icon={<Package className="w-6 h-6 text-amber-500" />} title="Total Orders" value={stats.totalOrders.toString()} subtitle={`${stats.cafeOrders} café · ${stats.fridgeOrders} fridge`} trend="neutral" />
            <SummaryCard icon={<DollarSign className="w-6 h-6 text-emerald-500" />} title="Revenue" value={formatCurrency(stats.totalRevenue)} trend="neutral" />
            <SummaryCard icon={<TrendingDown className="w-6 h-6 text-red-400" />} title="COGS" value={formatCurrency(stats.totalCost)} trend="neutral" />
            <SummaryCard icon={<TrendingUp className="w-6 h-6 text-blue-500" />} title="Margin" value={formatCurrency(stats.totalMargin)} subtitle={stats.totalRevenue > 0 ? `${((stats.totalMargin / stats.totalRevenue) * 100).toFixed(1)}%` : "—"} trend="neutral" />
          </div>

          {/* Stats Row 2: Reconciliation */}
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
            <SummaryCard icon={<Target className="w-6 h-6 text-purple-500" />} title="Expected Revenue" value={formatCurrency(stats.totalExpected)} trend="neutral" />
            <SummaryCard icon={<CheckCircle2 className="w-6 h-6 text-emerald-500" />} title="Confirmed" value={formatCurrency(stats.totalConfirmed)} subtitle={`${stats.unconfirmedCount} unconfirmed`} trend="neutral" />
            <SummaryCard icon={leakage > 0 ? <AlertTriangle className="w-6 h-6 text-amber-500" /> : <CheckCircle2 className="w-6 h-6 text-emerald-500" />} title="Unconfirmed Gap" value={formatCurrency(leakage)} subtitle={`${leakagePct}% of expected`} trend="neutral" />
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
                        const proofLabels: Record<string, React.ReactNode> = {
                          none: "—",
                          uploaded: <Paperclip className="w-3 h-3 inline" />,
                          confirmed: <CheckCheck className="w-3 h-3 inline text-emerald-600" />,
                          flagged: <AlertOctagon className="w-3 h-3 inline text-red-500" />,
                        };
                        return (
                          <tr key={order.id} className="border-b border-gray-50 hover:bg-gray-25">
                            <td className="py-3 px-4">
                              <span className="font-semibold text-amber-600 text-sm">{order.order_number || `#${order.id.slice(0, 8)}`}</span>
                              <span className="text-xs text-gray-400 ml-1.5">{timeAgo(order.created_at)}</span>
                            </td>
                            <td className="py-3 px-4 text-gray-600 max-w-[180px]">
                              <div className="truncate mb-1">
                                {order.order_items.map((i) => `${i.qty}× ${i.products?.name}`).join(", ")}
                              </div>
                              {order.order_items.length > 1 && (
                                <button
                                  onClick={() => setViewItemsOrder(order)}
                                  className="text-[10px] uppercase tracking-wider font-semibold text-amber-600 hover:text-amber-800 transition-colors"
                                >
                                  View all ({order.order_items.length} items)
                                </button>
                              )}
                            </td>
                            <td className="py-3 px-4"><OrderStatusBadge status={order.status} /></td>
                            <td className="py-3 px-4 text-right font-medium">{formatCurrency(order.total_price)}</td>
                            <td className="py-3 px-4 text-center">
                              {order.payment_confirmed ? (
                                <CheckCheck className="w-4 h-4 text-emerald-600 mx-auto" />
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
                        <tr><td colSpan={6} className="py-8 text-center text-gray-400">No orders today</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Low Stock Alerts */}
            <div>
              <h2 className="text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2"><AlertTriangle className="w-5 h-5 text-amber-500" /> Low Stock</h2>
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
        </>
      )}

      {/* Custom Date Range Modal */}
      {showCustomExport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm" onClick={() => setShowCustomExport(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 animate-in zoom-in-95 leading-tight">
            <h3 className="text-xl font-bold text-gray-900 mb-4">Export Custom Range</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                <input 
                  type="date" 
                  value={customStartStr} 
                  onChange={e => setCustomStartStr(e.target.value)} 
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg hover:border-gray-300 focus:outline-none focus:ring-4 focus:ring-amber-500/10 focus:border-amber-400 bg-white" 
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
                <input 
                  type="date" 
                  value={customEndStr} 
                  onChange={e => setCustomEndStr(e.target.value)} 
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg hover:border-gray-300 focus:outline-none focus:ring-4 focus:ring-amber-500/10 focus:border-amber-400 bg-white" 
                />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowCustomExport(false)} className="flex-1 bg-gray-100 text-gray-700 font-bold py-2 rounded-xl hover:bg-gray-200 transition-all text-sm">
                Cancel
              </button>
              <button 
                onClick={() => {
                  if (customStartStr && customEndStr) {
                    exportOrdersCSV("custom");
                    setShowCustomExport(false);
                  } else {
                     alert("Please select both start and end dates.");
                  }
                }}
                className="flex-1 bg-amber-600 text-white font-bold py-2 rounded-xl hover:bg-amber-700 shadow-sm transition-all active:scale-95 text-sm"
              >
                Export CSV
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Image Zoom Modal */}
      {zoomImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in"
          onClick={() => setZoomImage(null)}
        >
          <div className="relative max-w-3xl max-h-[90vh] w-full flex items-center justify-center">
            <button
              className="absolute -top-12 right-0 text-white hover:text-gray-300 transition-colors"
              onClick={() => setZoomImage(null)}
            >
              <span className="text-sm font-medium tracking-wider uppercase bg-white/20 px-4 py-1.5 rounded-full">Close</span>
            </button>
            <img
              src={zoomImage}
              alt="Order Snapshot Zoom"
              className="w-full h-auto max-h-[85vh] object-contain rounded-xl shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </div>
      )}

      {/* View All Items Modal */}
      {viewItemsOrder && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-in fade-in"
          onClick={() => setViewItemsOrder(null)}
        >
          <div
            className="bg-white rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden animate-slide-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-gray-50 px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-gray-900 leading-tight">Order Receipt</h3>
                <p className="text-xs text-gray-500">{viewItemsOrder.order_number || `#${viewItemsOrder.id.slice(0, 8)}`}</p>
              </div>
              <button onClick={() => setViewItemsOrder(null)} className="text-gray-400 hover:text-gray-600 p-2 -mr-2"><X className="w-4 h-4" /></button>
            </div>

            <div className="p-6 max-h-[60vh] overflow-y-auto">
              <ul className="space-y-4">
                {viewItemsOrder.order_items.map((item) => (
                  <li key={item.id} className="flex justify-between items-start text-sm">
                    <span className="font-medium text-gray-900">
                      <span className="text-amber-600 font-bold mr-2">{item.qty}×</span>
                      {item.products?.name || "Unknown Product"}
                    </span>
                    <span className="text-gray-500 tabular-nums">
                      {formatCurrency(item.qty * (item.price_at_sale || 0))}
                    </span>
                  </li>
                ))}
              </ul>

              <div className="mt-6 pt-4 border-t border-gray-100 flex justify-between items-center text-base">
                <span className="font-bold text-gray-500">Total</span>
                <span className="font-black text-gray-900">{formatCurrency(viewItemsOrder.total_price)}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
