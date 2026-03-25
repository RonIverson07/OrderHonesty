"use client";

import { useState, useEffect, useTransition } from "react";
import { createClient } from "@/lib/supabase/browser";
import { adjustStock } from "@/lib/domain/orders";
import type { Product, Ingredient, RetailStock } from "@/lib/types";

type MovementReason = "restock" | "adjustment" | "spoilage";

export default function StockPage() {
  const [retailProducts, setRetailProducts] = useState<(Product & { retail_stock: RetailStock | null })[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
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

  async function load() {
    try {
      const supabase = createClient();
      const [{ data: prods }, { data: ings }] = await Promise.all([
        supabase.from("products").select("*, retail_stock(*)").eq("type", "retail").eq("active", true).order("name"),
        supabase.from("ingredients").select("*").order("name"),
      ]);
      setRetailProducts(
        (prods ?? []).map((p: Record<string, unknown>) => ({
          ...p,
          retail_stock: Array.isArray(p.retail_stock) ? (p.retail_stock as RetailStock[])[0] ?? null : p.retail_stock,
        })) as (Product & { retail_stock: RetailStock | null })[]
      );
      setIngredients((ings ?? []) as Ingredient[]);
    } catch { /* demo */ }
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
        await load();
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
