"use client";

import { useState, useEffect, useTransition } from "react";
import { createClient } from "@/lib/supabase/browser";
import { adjustStock } from "@/lib/domain/orders";
import { timeAgo } from "@/lib/utils";
import type { Product, Ingredient, RetailStock, InventoryMovement } from "@/lib/types";

type MovementReason = "restock" | "adjustment" | "spoilage";

export default function StockPage() {
  const [retailProducts, setRetailProducts] = useState<(Product & { retail_stock: RetailStock | null })[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [profileMap, setProfileMap] = useState<Record<string, string>>({}); // id -> email
  const [page, setPage] = useState(0);
  const [totalMovements, setTotalMovements] = useState(0);
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [modal, setModal] = useState<{
    type: "product" | "ingredient";
    id: string;
    name: string;
    currentStock: number;
    newStock: string;
    reason: MovementReason;
    notes: string;
  } | null>(null);

  useEffect(() => { load(); }, []);
  useEffect(() => { loadMovements(); }, [page]);

  async function load() {
    try {
      const supabase = createClient();
      const [{ data: prods }, { data: ings }] = await Promise.all([
        supabase.from("products").select("*, retail_stock(*)").eq("type", "retail").eq("active", true).order("name"),
        supabase.from("ingredients").select("*").order("name")
      ]);
      setRetailProducts(
        (prods ?? []).map((p: Record<string, unknown>) => ({
          ...p,
          retail_stock: Array.isArray(p.retail_stock) ? (p.retail_stock as RetailStock[])[0] ?? null : p.retail_stock,
        })) as (Product & { retail_stock: RetailStock | null })[]
      );
      setIngredients((ings ?? []) as Ingredient[]);
      loadMovements();
    } catch (err) {
      console.error("StockPage load error:", err);
    }
  }

  async function loadMovements() {
    try {
      const supabase = createClient();
      const PAGE_SIZE = 20;

      // Fetch profiles for email lookup (client-side join — no FK needed)
      const { data: profileList } = await supabase
        .from("profiles")
        .select("id, email, full_name");

      if (profileList) {
        const map: Record<string, string> = {};
        for (const p of profileList) {
          map[p.id] = p.email || p.full_name || "Admin";
        }
        setProfileMap(map);
      }

      // Get total count first
      const { count } = await supabase
        .from("inventory_movements")
        .select("*", { count: "exact", head: true });

      if (count !== null) setTotalMovements(count);

      const { data: moves, error } = await supabase
        .from("inventory_movements")
        .select("*")
        .order("performed_at", { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (error) throw error;
      setMovements((moves ?? []) as InventoryMovement[]);
    } catch (err: any) {
      console.error("Movements load error:", err.message || err);
    }
  }

  const handleSave = () => {
    if (!modal) return;
    const newStockVal = parseFloat(modal.newStock);
    if (isNaN(newStockVal) || newStockVal < 0 || !modal.notes.trim()) return;

    startTransition(async () => {
      const result = await adjustStock({
        itemType: modal.type,
        itemId: modal.id,
        newStock: newStockVal,
        reason: modal.reason,
        notes: modal.notes.trim(),
      });

      if (result.success) {
        setMessage("✅ Stock updated");
        setModal(null);
        await Promise.all([load(), loadMovements()]);
        setTimeout(() => setMessage(""), 3000);
      } else {
        setMessage(`❌ ${result.error}`);
      }
    });
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Stock Management</h1>
        <p className="text-sm text-gray-500">Restock, adjust, or record spoilage</p>
      </div>

      {message && (
        <div className="mb-4 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm">
          {message}
        </div>
      )}

      {/* Retail Products */}
      <h2 className="text-lg font-semibold text-gray-900 mb-3">🧊 Retail Items</h2>
      <div className="card overflow-hidden mb-8">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="text-left py-3 px-4 font-medium text-gray-500">Item</th>
              <th className="text-right py-3 px-4 font-medium text-gray-500">Current Stock</th>
              <th className="text-right py-3 px-4 font-medium text-gray-500">Threshold</th>
              <th className="text-center py-3 px-4 font-medium text-gray-500">Status</th>
              <th className="text-right py-3 px-4 font-medium text-gray-500">Actions</th>
            </tr>
          </thead>
          <tbody>
            {retailProducts.map((p) => {
              const stock = p.retail_stock?.stock ?? 0;
              const threshold = p.low_stock_threshold ?? 5;
              const isLow = stock <= threshold;
              const isOut = stock === 0;
              return (
                <tr key={p.id} className="border-b border-gray-50">
                  <td className="py-3 px-4 font-medium text-gray-900">{p.name}</td>
                  <td className="py-3 px-4 text-right font-medium">{stock}</td>
                  <td className="py-3 px-4 text-right text-gray-500">{threshold}</td>
                  <td className="py-3 px-4 text-center">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      isOut ? "bg-red-50 text-red-700" : isLow ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"
                    }`}>
                      {isOut ? "Out" : isLow ? "Low" : "OK"}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right">
                    <div className="flex gap-2 justify-end">
                      {(["restock", "adjustment", "spoilage"] as MovementReason[]).map((reason) => (
                        <button
                          key={reason}
                          onClick={() => setModal({
                            type: "product", id: p.id, name: p.name,
                            currentStock: stock, newStock: "", reason, notes: "",
                          })}
                          className={`text-xs font-medium px-2 py-1 rounded ${
                            reason === "restock" ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100" :
                            reason === "spoilage" ? "bg-red-50 text-red-700 hover:bg-red-100" :
                            "bg-gray-100 text-gray-600 hover:bg-gray-200"
                          }`}
                        >
                          {reason.charAt(0).toUpperCase() + reason.slice(1)}
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Ingredients */}
      <h2 className="text-lg font-semibold text-gray-900 mb-3">🧪 Ingredients</h2>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="text-left py-3 px-4 font-medium text-gray-500">Ingredient</th>
              <th className="text-left py-3 px-4 font-medium text-gray-500">Unit</th>
              <th className="text-right py-3 px-4 font-medium text-gray-500">Stock</th>
              <th className="text-right py-3 px-4 font-medium text-gray-500">Threshold</th>
              <th className="text-center py-3 px-4 font-medium text-gray-500">Status</th>
              <th className="text-right py-3 px-4 font-medium text-gray-500">Actions</th>
            </tr>
          </thead>
          <tbody>
            {ingredients.map((i) => {
              const isLow = i.stock <= i.low_stock_threshold;
              return (
                <tr key={i.id} className="border-b border-gray-50">
                  <td className="py-3 px-4 font-medium text-gray-900">{i.name}</td>
                  <td className="py-3 px-4 text-gray-500">{i.unit}</td>
                  <td className="py-3 px-4 text-right font-medium">{Number(i.stock).toLocaleString()}</td>
                  <td className="py-3 px-4 text-right text-gray-500">{Number(i.low_stock_threshold).toLocaleString()}</td>
                  <td className="py-3 px-4 text-center">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      isLow ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"
                    }`}>
                      {isLow ? "Low" : "OK"}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right">
                    <div className="flex gap-2 justify-end">
                      {(["restock", "adjustment", "spoilage"] as MovementReason[]).map((reason) => (
                        <button
                          key={reason}
                          onClick={() => setModal({
                            type: "ingredient", id: i.id, name: i.name,
                            currentStock: i.stock, newStock: "", reason, notes: "",
                          })}
                          className={`text-xs font-medium px-2 py-1 rounded ${
                            reason === "restock" ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100" :
                            reason === "spoilage" ? "bg-red-50 text-red-700 hover:bg-red-100" :
                            "bg-gray-100 text-gray-600 hover:bg-gray-200"
                          }`}
                        >
                          {reason.charAt(0).toUpperCase() + reason.slice(1)}
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Stock History Logs */}
      <div className="mt-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-gray-900">📜 Stock Audit History</h2>
          <div className="flex items-center gap-4">
            <span className="text-xs text-gray-500 uppercase tracking-wider">
              {totalMovements > 0 ? `${page * 20 + 1}-${Math.min((page + 1) * 20, totalMovements)} of ${totalMovements}` : "No movements"}
            </span>
            <div className="flex gap-1">
              <button 
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                className="px-2 py-1 rounded bg-white border text-xs shadow-sm hover:bg-gray-50 disabled:opacity-40"
              >
                ← Prev
              </button>
              <button 
                onClick={() => setPage(p => p + 1)}
                disabled={(page + 1) * 20 >= totalMovements}
                className="px-2 py-1 rounded bg-white border text-xs shadow-sm hover:bg-gray-50 disabled:opacity-40"
              >
                Next →
              </button>
            </div>
          </div>
        </div>
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left py-3 px-4 font-medium text-gray-500">Timestamp</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-500">Item</th>
                  <th className="text-center py-3 px-4 font-medium text-gray-500">Type</th>
                  <th className="text-right py-3 px-4 font-medium text-gray-500">Adjustment</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-500">Performed By</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-500 max-w-[200px]">Notes</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((move) => {
                  const itemName = retailProducts.find(p => p.id === move.item_id)?.name 
                            || ingredients.find(i => i.id === move.item_id)?.name
                            || "Unknown Item";
                  
                  const delta = move.quantity_delta;

                  return (
                    <tr key={move.id} className="border-b border-gray-50 hover:bg-gray-25 transition-colors">
                      <td className="py-3 px-4 text-xs text-gray-500" title={new Date(move.performed_at || move.created_at).toLocaleString()}>
                        {timeAgo(move.performed_at || move.created_at)}
                      </td>
                      <td className="py-3 px-4">
                        <span className="font-medium text-gray-900">{itemName}</span>
                        {move.item_type === "ingredient" && (
                          <span className="ml-1.5 text-[10px] uppercase text-amber-600 bg-amber-50 px-1 rounded">Ingredient</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${
                          move.movement_type === "restock" ? "bg-emerald-50 text-emerald-700" :
                          move.movement_type === "spoilage" ? "bg-red-50 text-red-700" :
                          "bg-gray-100 text-gray-600"
                        }`}>
                          {move.movement_type}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right tabular-nums">
                        <span className={`font-semibold ${delta > 0 ? "text-emerald-600" : delta < 0 ? "text-red-600" : "text-gray-500"}`}>
                          {delta > 0 ? "+" : ""}{delta}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-xs text-gray-600">
                        {move.performed_by ? (profileMap[move.performed_by] || "Admin") : "Admin"}
                      </td>
                      <td className="py-3 px-4 text-gray-500 truncate italic max-w-[200px]" title={move.notes || ""}>
                        {move.notes || "—"}
                      </td>
                    </tr>
                  );
                })}
                {movements.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-gray-400">
                      No recent stock movements found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Stock Adjustment Modal */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <div className="card p-6 w-full max-w-sm mx-4 animate-slide-in">
            <h3 className="text-lg font-semibold text-gray-900 mb-1 capitalize">
              {modal.reason}: {modal.name}
            </h3>
            <p className="text-sm text-gray-500 mb-4">
              Current stock: <span className="font-medium text-gray-900">{modal.currentStock}</span>
            </p>

            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">New Stock Level</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={modal.newStock}
                  onChange={(e) => setModal({ ...modal, newStock: e.target.value })}
                  className="input"
                  placeholder="Enter new stock"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Reason for {modal.reason} <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={modal.notes}
                  onChange={(e) => setModal({ ...modal, notes: e.target.value })}
                  className="input min-h-[80px]"
                  placeholder={`Explain this ${modal.reason} in detail (required)`}
                  required
                />
              </div>
            </div>

            <div className="flex gap-2 mt-5">
              <button
                onClick={handleSave}
                disabled={isPending || !modal.newStock || parseFloat(modal.newStock) < 0 || !modal.notes.trim()}
                className="btn-primary flex-1 text-sm font-bold shadow-sm disabled:opacity-50"
              >
                {isPending ? "Saving..." : "Update Stock"}
              </button>
              <button onClick={() => setModal(null)} className="btn-secondary text-sm">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
