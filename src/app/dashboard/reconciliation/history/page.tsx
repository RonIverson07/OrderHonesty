"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/browser";
import { formatCurrency } from "@/lib/utils";
import type { ReconciliationDay } from "@/lib/types";
import { TrendingUp } from "lucide-react";
import Link from "next/link";

const DEMO_HISTORY: ReconciliationDay[] = [
  { id: "d1", date: "2026-03-20", total_expected: 590, total_confirmed: 280, variance: 310, reconciled_by: null, reconciled_at: new Date().toISOString(), notes: null, created_at: new Date().toISOString() },
  { id: "d2", date: "2026-03-19", total_expected: 1250, total_confirmed: 1180, variance: 70, reconciled_by: null, reconciled_at: new Date().toISOString(), notes: null, created_at: new Date().toISOString() },
  { id: "d3", date: "2026-03-18", total_expected: 980, total_confirmed: 980, variance: 0, reconciled_by: null, reconciled_at: new Date().toISOString(), notes: null, created_at: new Date().toISOString() },
  { id: "d4", date: "2026-03-17", total_expected: 1450, total_confirmed: 1320, variance: 130, reconciled_by: null, reconciled_at: new Date().toISOString(), notes: null, created_at: new Date().toISOString() },
  { id: "d5", date: "2026-03-16", total_expected: 875, total_confirmed: 875, variance: 0, reconciled_by: null, reconciled_at: new Date().toISOString(), notes: null, created_at: new Date().toISOString() },
  { id: "d6", date: "2026-03-15", total_expected: 1100, total_confirmed: 1050, variance: 50, reconciled_by: null, reconciled_at: new Date().toISOString(), notes: null, created_at: new Date().toISOString() },
  { id: "d7", date: "2026-03-14", total_expected: 720, total_confirmed: 650, variance: 70, reconciled_by: null, reconciled_at: new Date().toISOString(), notes: null, created_at: new Date().toISOString() },
];

export default function ReconciliationHistoryPage() {
  const [history, setHistory] = useState<ReconciliationDay[]>([]);
  const [isDemo, setIsDemo] = useState(true);
  const [topFlagged, setTopFlagged] = useState<{ order_number: string; risk_flag: string; total_price: number }[]>([]);
  const [topAdjusted, setTopAdjusted] = useState<{ name: string; total_delta: number }[]>([]);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    try {
      const supabase = createClient();

      // Reconciliation history
      const { data: days, error } = await supabase
        .from("reconciliation_days")
        .select("*")
        .order("date", { ascending: false })
        .limit(30);
      if (error) throw error;

      // Top flagged orders (last 7 days)
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data: flagged } = await supabase
        .from("orders")
        .select("order_number, risk_flag, total_price")
        .not("risk_flag", "is", null)
        .gte("created_at", sevenDaysAgo)
        .order("created_at", { ascending: false })
        .limit(5);

      // Top adjusted items (last 7 days)
      const { data: movements } = await supabase
        .from("inventory_movements")
        .select("item_id, quantity_delta, notes")
        .eq("movement_type", "adjustment")
        .gte("created_at", sevenDaysAgo)
        .order("created_at", { ascending: false })
        .limit(20);

      // Aggregate adjustments by item
      const adjustMap = new Map<string, { name: string; total_delta: number }>();
      for (const m of movements ?? []) {
        const itemName = m.notes?.match(/\(([^)]+)\)$/)?.[1] || m.item_id.slice(0, 8);
        const existing = adjustMap.get(m.item_id) ?? { name: itemName, total_delta: 0 };
        existing.total_delta += Number(m.quantity_delta);
        adjustMap.set(m.item_id, existing);
      }

      setHistory((days ?? []) as ReconciliationDay[]);
      setTopFlagged((flagged ?? []) as typeof topFlagged);
      setTopAdjusted(Array.from(adjustMap.values()).sort((a, b) => Math.abs(b.total_delta) - Math.abs(a.total_delta)).slice(0, 5));
      setIsDemo(false);
    } catch {
      setHistory(DEMO_HISTORY);
      setIsDemo(true);
    }
  }

  // 7-day trend
  const last7 = [...history].reverse().slice(-7);
  const maxVariance = Math.max(...last7.map((d) => Math.abs(d.variance)), 1);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <TrendingUp className="w-6 h-6 text-emerald-600" /> Reconciliation History
          </h1>
          <p className="text-sm text-gray-500">Past reconciliations, trends, and flagged items</p>
          {isDemo && (
            <div className="mt-2 p-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-xs">⚡ Demo mode</div>
          )}
        </div>
        <Link href="/dashboard/reconciliation" className="text-sm text-amber-600 hover:text-amber-700 font-medium">
          ← Back to Today
        </Link>
      </div>

      {/* 7-Day Variance Trend */}
      <div className="card p-5 mb-6">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">7-Day Variance Trend</h2>
        <div className="flex items-end gap-2 h-32">
          {last7.map((day) => {
            const height = maxVariance > 0 ? (Math.abs(day.variance) / maxVariance) * 100 : 0;
            const isZero = day.variance === 0;
            return (
              <div key={day.id} className="flex-1 flex flex-col items-center gap-1">
                <span className={`text-xs font-medium ${day.variance > 0 ? "text-red-600" : "text-emerald-600"}`}>
                  {day.variance > 0 ? `-${formatCurrency(day.variance)}` : isZero ? "✓" : `+${formatCurrency(Math.abs(day.variance))}`}
                </span>
                <div className="w-full flex items-end justify-center" style={{ height: "100px" }}>
                  <div
                    className={`w-full max-w-[40px] rounded-t-md transition-all ${
                      isZero ? "bg-emerald-200" : day.variance > 200 ? "bg-red-400" : day.variance > 0 ? "bg-amber-300" : "bg-emerald-300"
                    }`}
                    style={{ height: `${Math.max(height, 4)}%` }}
                  />
                </div>
                <span className="text-[10px] text-gray-400">
                  {new Date(day.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </span>
              </div>
            );
          })}
          {last7.length === 0 && (
            <div className="flex-1 text-center text-gray-400 text-sm py-8">No reconciliation data yet</div>
          )}
        </div>
      </div>

      {/* Bottom row: flagged + adjusted */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        {/* Top Flagged */}
        <div className="card p-4">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">🚩 Top Flagged Orders</h3>
          {topFlagged.length > 0 ? (
            <div className="space-y-2">
              {topFlagged.map((f, i) => (
                <div key={i} className="flex items-center justify-between text-sm border-b border-gray-50 pb-2 last:border-0">
                  <div>
                    <span className="font-semibold text-amber-600">{f.order_number}</span>
                    <p className="text-xs text-red-500 mt-0.5">{f.risk_flag}</p>
                  </div>
                  <span className="font-medium">{formatCurrency(f.total_price)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400 py-4 text-center">No flagged orders in the last 7 days ✓</p>
          )}
        </div>

        {/* Top Adjusted */}
        <div className="card p-4">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">📦 Top Adjusted Items</h3>
          {topAdjusted.length > 0 ? (
            <div className="space-y-2">
              {topAdjusted.map((a, i) => (
                <div key={i} className="flex items-center justify-between text-sm border-b border-gray-50 pb-2 last:border-0">
                  <span className="text-gray-700">{a.name}</span>
                  <span className={`font-medium ${a.total_delta < 0 ? "text-red-600" : "text-amber-600"}`}>
                    {a.total_delta > 0 ? "+" : ""}{a.total_delta}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400 py-4 text-center">No adjustments in the last 7 days</p>
          )}
        </div>
      </div>

      {/* History Table */}
      <h2 className="text-lg font-semibold text-gray-900 mb-3">Reconciliation Log</h2>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="text-left py-3 px-4 font-medium text-gray-500">Date</th>
              <th className="text-right py-3 px-4 font-medium text-gray-500">Expected</th>
              <th className="text-right py-3 px-4 font-medium text-gray-500">Confirmed</th>
              <th className="text-right py-3 px-4 font-medium text-gray-500">Variance</th>
              <th className="text-center py-3 px-4 font-medium text-gray-500">Status</th>
            </tr>
          </thead>
          <tbody>
            {history.map((day) => (
              <tr key={day.id} className="border-b border-gray-50 hover:bg-gray-25">
                <td className="py-3 px-4 font-medium text-gray-900">
                  {new Date(day.date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                </td>
                <td className="py-3 px-4 text-right">{formatCurrency(day.total_expected)}</td>
                <td className="py-3 px-4 text-right text-emerald-600 font-medium">{formatCurrency(day.total_confirmed)}</td>
                <td className="py-3 px-4 text-right">
                  <span className={`font-medium ${day.variance > 0 ? "text-red-600" : day.variance < 0 ? "text-amber-600" : "text-emerald-600"}`}>
                    {day.variance === 0 ? "—" : day.variance > 0 ? `-${formatCurrency(day.variance)}` : `+${formatCurrency(Math.abs(day.variance))}`}
                  </span>
                </td>
                <td className="py-3 px-4 text-center">
                  {day.variance === 0 ? (
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">✓ Balanced</span>
                  ) : day.variance > 200 ? (
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-50 text-red-700">⚠ Gap</span>
                  ) : (
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">~ Minor</span>
                  )}
                </td>
              </tr>
            ))}
            {history.length === 0 && (
              <tr><td colSpan={5} className="py-8 text-center text-gray-400">No reconciliation history yet</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
