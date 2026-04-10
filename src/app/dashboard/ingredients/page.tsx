"use client";

import { useState, useEffect, useTransition } from "react";
import { createClient } from "@/lib/supabase/browser";
import { adminSaveIngredient, adminDeleteIngredient } from "@/lib/domain/orders";
import type { Ingredient } from "@/lib/types";
import { Search, ChevronLeft, ChevronRight } from "lucide-react";

const PAGE_SIZE = 10;

export default function IngredientsPage() {
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState<Ingredient | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);

  useEffect(() => { loadIngredients(); }, []);

  // Reset to page 0 whenever search changes
  useEffect(() => { setPage(0); }, [search]);

  async function loadIngredients() {
    try {
      const supabase = createClient();
      const { data, error } = await supabase.from("ingredients").select("*").order("name");
      if (error) throw error;
      setIngredients((data ?? []) as Ingredient[]);
    } catch { /* demo */ }
  }

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);

    startTransition(async () => {
      const result = await adminSaveIngredient(formData);
      if (result.success) {
        setMessage("✅ Ingredient saved");
        setShowForm(false);
        setEditing(null);
        await loadIngredients();
        setTimeout(() => setMessage(""), 3000);
      } else {
        setMessage(`❌ ${result.error}`);
      }
    });
  };

  const handleDelete = (id: string, name: string) => {
    if (!confirm(`Are you sure you want to delete ${name}?`)) return;
    startTransition(async () => {
      const result = await adminDeleteIngredient(id);
      if (result.success) {
        setMessage("✅ Ingredient deleted");
        await loadIngredients();
        setTimeout(() => setMessage(""), 3000);
      } else {
        setMessage(`❌ ${result.error}`);
      }
    });
  };

  // Filtered + paginated
  const filtered = ingredients.filter((i) =>
    i.name.toLowerCase().includes(search.toLowerCase())
  );
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const from = filtered.length === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE + PAGE_SIZE, filtered.length);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Ingredients</h1>
          <p className="text-sm text-gray-500">Raw materials for café drinks</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative w-full max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Search ingredients..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 pr-3 py-2 text-sm w-full bg-white border border-gray-200 rounded-lg shadow-sm hover:border-gray-300 focus:outline-none focus:ring-4 focus:ring-gray-100 focus:border-gray-400 transition-all"
            />
          </div>
          <button onClick={() => { setEditing(null); setShowForm(true); }} className="btn-primary text-sm h-10 px-4">
            + Add Ingredient
          </button>
        </div>
      </div>

      {message && (
        <div className="mb-4 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm">
          {message}
        </div>
      )}

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="text-left py-3 px-4 font-medium text-gray-500">Name</th>
              <th className="text-left py-3 px-4 font-medium text-gray-500">Unit</th>
              <th className="text-right py-3 px-4 font-medium text-gray-500">Unit Cost</th>
              <th className="text-right py-3 px-4 font-medium text-gray-500">Stock</th>
              <th className="text-right py-3 px-4 font-medium text-gray-500">Threshold</th>
              <th className="text-center py-3 px-4 font-medium text-gray-500">Status</th>
              <th className="text-right py-3 px-4 font-medium text-gray-500">Actions</th>
            </tr>
          </thead>
          <tbody>
            {paginated.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-10 text-center text-sm text-gray-400">
                  {search ? `No ingredients matching "${search}"` : "No ingredients yet."}
                </td>
              </tr>
            ) : (
              paginated.map((i) => {
                const isLow = i.stock <= i.low_stock_threshold;
                return (
                  <tr key={i.id} className="border-b border-gray-50 hover:bg-gray-25">
                    <td className="py-3 px-4 font-medium text-gray-900">{i.name}</td>
                    <td className="py-3 px-4 text-gray-500">{i.unit}</td>
                    <td className="py-3 px-4 text-right text-gray-500">₱{Number(i.unit_cost).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 4 })}</td>
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
                      <div className="flex justify-end gap-3">
                        <button onClick={() => { setEditing(i); setShowForm(true); }} className="text-sm text-amber-600 hover:text-amber-700 font-medium">
                          Edit
                        </button>
                        <button onClick={() => handleDelete(i.id, i.name)} className="text-sm text-red-600 hover:text-red-700 font-medium">
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>

        {/* Pagination */}
        {filtered.length > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 bg-gray-50">
            <span className="text-xs text-gray-500">
              Showing {from}–{to} of {filtered.length} ingredient{filtered.length !== 1 ? "s" : ""}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-200 text-gray-600 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="w-3.5 h-3.5" /> Previous
              </button>
              <span className="text-xs text-gray-500 font-medium px-1">
                {page + 1} / {Math.max(1, totalPages)}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-200 text-gray-600 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Next <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <form onSubmit={handleSubmit} className="card p-6 w-full max-w-md mx-4 animate-slide-in">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              {editing ? `Edit ${editing?.name}` : "New Ingredient"}
            </h2>
            {editing && <input type="hidden" name="id" value={editing.id} />}
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                <input name="name" defaultValue={editing?.name ?? ""} required className="input" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Unit</label>
                  <input name="unit" defaultValue={editing?.unit ?? ""} required className="input" placeholder="g, ml, pcs" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Unit Cost (₱)</label>
                  <input name="unit_cost" type="number" step="0.0001" defaultValue={editing?.unit_cost ?? ""} required className="input" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Stock</label>
                  <input name="stock" type="number" step="0.01" defaultValue={editing?.stock ?? "0"} required className="input" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Low Stock Threshold</label>
                  <input name="low_stock_threshold" type="number" step="0.01" defaultValue={editing?.low_stock_threshold ?? ""} className="input" />
                </div>
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button type="submit" disabled={isPending} className="btn-primary flex-1 text-sm">
                {isPending ? "Saving..." : "Save"}
              </button>
              <button type="button" onClick={() => { setShowForm(false); setEditing(null); }} className="btn-secondary text-sm">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}


