"use client";

import { useState, useEffect, useTransition } from "react";
import { createClient } from "@/lib/supabase/browser";
import { adminDeleteOrder } from "@/lib/domain/orders";
import OrderStatusBadge from "@/components/OrderStatusBadge";
import { formatCurrency, timeAgo } from "@/lib/utils";
import { Trash2, Search, Calendar, Download, Zap, ChevronLeft, ChevronRight, CheckCheck, Paperclip, AlertOctagon, X } from "lucide-react";
import type { OrderWithItems } from "@/lib/types";

export default function OrderHistoryPage() {
  const getTodayStr = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const [selectedDateStr, setSelectedDateStr] = useState<string>(""); // Default to empty (all history) but allow picking
  const [filterSource, setFilterSource] = useState<"all" | "fridge" | "cafe">("all");
  const [orders, setOrders] = useState<OrderWithItems[]>([]);
  const [loading, setLoading] = useState(true);
  const [isPending, startTransition] = useTransition();
  const [search, setSearch] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [orderToDelete, setOrderToDelete] = useState<string | null>(null);
  const [viewItemsOrder, setViewItemsOrder] = useState<OrderWithItems | null>(null);
  
  // Export CSV States
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [showCustomExport, setShowCustomExport] = useState(false);
  const [customStartStr, setCustomStartStr] = useState("");
  const [customEndStr, setCustomEndStr] = useState("");

  // Pagination State
  const [page, setPage] = useState(1);
  const itemsPerPage = 10;

  useEffect(() => {
    const supabase = createClient();
    async function load() {
      setLoading(true);
      
      let query = supabase
        .from("orders")
        .select("*, order_items(*, products!product_id(*))")
        .order("created_at", { ascending: false });

      if (selectedDateStr) {
        const startOfDay = new Date(selectedDateStr);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(selectedDateStr);
        endOfDay.setHours(23, 59, 59, 999);
        query = query
          .gte("created_at", startOfDay.toISOString())
          .lte("created_at", endOfDay.toISOString());
      } else {
        query = query.limit(1000); // Fetch up to 1000 most recent if no date filter
      }

      if (filterSource !== "all") {
        query = query.eq("source", filterSource);
      }

      const { data, error } = await query;
        
      if (!error && data) {
        setOrders(data as OrderWithItems[]);
      }
      setLoading(false);
    }
    load();
  }, [selectedDateStr, filterSource]);

  // Reset page when search, date, or filter changes
  useEffect(() => {
    setPage(1);
  }, [search, selectedDateStr, filterSource]);

  const confirmDelete = () => {
    if (!orderToDelete) return;
    const orderId = orderToDelete;
    
    setDeletingId(orderId);
    setOrderToDelete(null);
    startTransition(async () => {
      const res = await adminDeleteOrder(orderId);
      if (res.success) {
        setOrders(prev => prev.filter(o => o.id !== orderId));
      } else {
        alert("Failed to delete order. It might have complex dependencies.");
      }
      setDeletingId(null);
    });
  };

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

  const filteredOrders = orders.filter(o => {
     if (!search) return true;
     const searchLower = search.toLowerCase();
     return o.order_number?.toLowerCase().includes(searchLower) || o.customer_name?.toLowerCase().includes(searchLower);
  });

  const totalPages = Math.ceil(filteredOrders.length / itemsPerPage);
  const paginatedOrders = filteredOrders.slice((page - 1) * itemsPerPage, page * itemsPerPage);

  const isToday = selectedDateStr === getTodayStr();
  const dateLabel = !selectedDateStr ? "All Time" : (isToday ? "Today" : selectedDateStr);

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Order History</h1>
          <p className="text-sm text-gray-500">Overview for {dateLabel}</p>
        </div>
        
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div className="relative flex-1 sm:w-56">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search by ref..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full h-[42px] pl-9 pr-4 py-2 border border-gray-200 rounded-xl bg-white text-sm font-medium text-gray-700 focus:outline-none focus:ring-4 focus:ring-amber-500/10 focus:border-amber-400 transition-all shadow-sm box-border"
            />
          </div>

          <div className="flex flex-row flex-wrap sm:flex-nowrap items-center gap-3">
            <select
              value={filterSource}
              onChange={(e) => setFilterSource(e.target.value as any)}
              className="flex-1 sm:w-[130px] h-[42px] rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-4 focus:ring-amber-500/10 focus:border-amber-400 transition-all cursor-pointer box-border appearance-none"
              style={{ backgroundImage: 'url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%239CA3AF%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 0.75rem top 50%', backgroundSize: '0.65rem auto' }}
            >
              <option value="all">All Sources</option>
              <option value="fridge">Fridge Orders</option>
              <option value="cafe">Café Orders</option>
            </select>

            <input
              type="date"
              value={selectedDateStr}
              max={getTodayStr()}
              onChange={(e) => setSelectedDateStr(e.target.value)}
              className="flex-1 sm:w-[160px] h-[42px] inline-flex items-center justify-center rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-4 focus:ring-amber-500/10 focus:border-amber-400 transition-all cursor-pointer box-border"
            />

            <div className="relative inline-block text-left flex-1 sm:flex-none">
              <button
                type="button"
                onClick={() => setExportMenuOpen(!exportMenuOpen)}
                disabled={loading}
                className="group inline-flex items-center justify-center gap-2 w-full sm:w-[160px] h-[42px] box-border rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-4 focus:ring-amber-500/10 focus:border-amber-400 transition-all disabled:opacity-50"
              >
                <Download className="w-4 h-4 text-gray-500 group-hover:text-amber-600 transition-colors shrink-0" />
                <span className="whitespace-nowrap">Export CSV</span>
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
                        {range.label}
                      </button>
                    ))}
                  </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

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

      <div className="card overflow-hidden shadow-sm border border-gray-100 mb-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50 text-left">
                <th className="py-3 px-4 font-semibold text-gray-500 w-32 tracking-wide">Date</th>
                <th className="py-3 px-4 font-semibold text-gray-500 tracking-wide">Order Ref</th>
                <th className="py-3 px-4 font-semibold text-gray-500 tracking-wide">Items</th>
                <th className="py-3 px-4 font-semibold text-gray-500 tracking-wide">Status</th>
                <th className="py-3 px-4 text-right font-semibold text-gray-500 tracking-wide">Total</th>
                <th className="py-3 px-4 text-center font-semibold text-gray-500 tracking-wide">Snap</th>
                <th className="py-3 px-4 text-center font-semibold text-gray-500 tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-gray-400 font-medium">Loading history vault...</td>
                </tr>
              ) : paginatedOrders.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-gray-400 font-medium">No orders found.</td>
                </tr>
              ) : (
                paginatedOrders.map(order => (
                  <tr key={order.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors group">
                    <td className="py-3 px-4 text-gray-500 text-xs">
                      <div className="flex items-center gap-1.5 whitespace-nowrap font-medium text-gray-700">
                        <Calendar className="w-3.5 h-3.5 text-amber-500" />
                        {new Date(order.created_at).toLocaleDateString()}
                      </div>
                      <div className="mt-0.5 ml-5 text-[10px] uppercase font-semibold text-gray-400">{timeAgo(order.created_at)}</div>
                    </td>
                    <td className="py-3 px-4">
                      <span className="font-bold text-amber-600 font-mono text-sm tracking-tight bg-amber-50 px-1.5 py-0.5 rounded border border-amber-100">
                        {order.order_number || `#${order.id.slice(0, 8)}`}
                      </span>
                      {order.customer_name && <div className="text-xs text-gray-500 capitalize mt-1 ml-0.5 font-medium">{order.customer_name}</div>}
                    </td>
                    <td className="py-3 px-4 text-gray-600 max-w-[200px]">
                       <div className="truncate text-xs font-medium mb-1">
                         {order.order_items.map((i) => `${i.qty}× ${i.products?.name}`).join(", ")}
                       </div>
                       {order.order_items.length > 1 && (
                         <button
                           onClick={() => setViewItemsOrder(order)}
                           className="inline-flex items-center text-[10px] font-bold uppercase tracking-wider px-2 py-1 mt-1 rounded text-amber-700 bg-amber-50 border border-amber-100 hover:bg-amber-100 hover:border-amber-200 transition-all shadow-sm"
                         >
                           View all ({order.order_items.length} items)
                         </button>
                       )}
                    </td>
                    <td className="py-3 px-4">
                      <OrderStatusBadge status={order.status} />
                    </td>
                    <td className="py-3 px-4 text-right font-medium text-gray-900 tabular-nums">
                      {formatCurrency(order.total_price)}
                    </td>
                    <td className="py-3 px-4 text-center">
                      {order.order_snapshot_url ? (
                        <a href={order.order_snapshot_url} target="_blank" rel="noopener noreferrer" className="inline-block group/snap">
                          <div className="w-8 h-8 rounded overflow-hidden border border-gray-200 group-hover/snap:ring-2 group-hover/snap:ring-amber-300 transition-all mx-auto">
                            <img src={order.order_snapshot_url} alt="Snap" className="w-full h-full object-cover" />
                          </div>
                        </a>
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>
                    <td className="py-3 px-4 align-middle">
                      <div className="flex items-center justify-center">
                        <button
                          onClick={() => setOrderToDelete(order.id)}
                          disabled={deletingId === order.id}
                          className="w-[84px] flex items-center justify-center gap-1.5 whitespace-nowrap text-[10px] font-bold uppercase tracking-wider py-1.5 rounded transition-all text-red-600 bg-red-50 border border-red-100 hover:bg-red-600 hover:text-white disabled:opacity-50"
                          title="Delete order"
                        >
                          <Trash2 className="w-3 h-3" />
                          {deletingId === order.id ? "Wait..." : "Delete"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <div className="text-gray-500 font-medium">
            Showing <span className="text-gray-900 font-bold">{(page - 1) * itemsPerPage + 1}</span> to <span className="text-gray-900 font-bold">{Math.min(page * itemsPerPage, filteredOrders.length)}</span> of <span className="text-gray-900 font-bold">{filteredOrders.length}</span> orders
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-600 font-semibold hover:bg-gray-50 hover:text-amber-600 transition-all disabled:opacity-50 disabled:hover:bg-white disabled:hover:text-gray-600 shadow-sm"
            >
              <ChevronLeft className="w-4 h-4" /> Prev
            </button>
            <div className="flex items-center justify-center min-w-[36px] h-[34px] rounded-lg bg-amber-50 text-amber-700 font-bold border border-amber-100">
              {page}
            </div>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-600 font-semibold hover:bg-gray-50 hover:text-amber-600 transition-all disabled:opacity-50 disabled:hover:bg-white disabled:hover:text-gray-600 shadow-sm"
            >
              Next <ChevronRight className="w-4 h-4" />
            </button>
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
                <span className="font-medium text-gray-900">{formatCurrency(viewItemsOrder.total_price)}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {orderToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm" onClick={() => setOrderToDelete(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 animate-in zoom-in-95 leading-tight text-center">
            <div className="w-12 h-12 rounded-full bg-red-50 border border-red-100 flex items-center justify-center mx-auto mb-4">
              <Trash2 className="w-6 h-6 text-red-600" />
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-2">Delete Order</h3>
            <p className="text-sm text-gray-500 mb-6">Are you sure you want to delete this order?</p>
            <div className="flex gap-3">
              <button 
                onClick={() => setOrderToDelete(null)} 
                className="flex-1 bg-gray-100 text-gray-700 font-bold py-2.5 rounded-xl hover:bg-gray-200 transition-all text-sm"
              >
                Cancel
              </button>
              <button 
                onClick={confirmDelete}
                className="flex-1 bg-red-600 text-white font-bold py-2.5 rounded-xl hover:bg-red-700 shadow-sm transition-all active:scale-95 text-sm"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
