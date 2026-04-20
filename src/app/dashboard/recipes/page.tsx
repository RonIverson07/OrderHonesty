"use client";

import { useState, useEffect, useTransition } from "react";
import { createClient } from "@/lib/supabase/browser";
import { adminSaveRecipes } from "@/lib/domain/orders";
import { formatCurrency } from "@/lib/utils";
import type { Product, Ingredient, RecipeWithIngredient } from "@/lib/types";
import { ClipboardList } from "lucide-react";

interface RecipeRow {
  ingredient_id: string;
  qty_required: number;
}

export default function RecipesPage() {
  const [cafeProducts, setCafeProducts] = useState<Product[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [recipes, setRecipes] = useState<RecipeRow[]>([]);
  const [existingRecipes, setExistingRecipes] = useState<RecipeWithIngredient[]>([]);
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [rowToRemove, setRowToRemove] = useState<number | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const supabase = createClient();
        const [{ data: prods }, { data: ings }] = await Promise.all([
          supabase.from("products").select("*").eq("type", "cafe").order("name"),
          supabase.from("ingredients").select("*").order("name"),
        ]);
        setCafeProducts((prods ?? []) as Product[]);
        setIngredients((ings ?? []) as Ingredient[]);
      } catch { /* demo */ }
    }
    load();
  }, []);

  const selectProduct = async (product: Product) => {
    setSelectedProduct(product);
    setMessage("");
    try {
      const supabase = createClient();
      const { data } = await supabase
        .from("recipes")
        .select("*, ingredients(*)")
        .eq("product_id", product.id);
      const fetched = (data ?? []) as RecipeWithIngredient[];
      setExistingRecipes(fetched);
      setRecipes(fetched.map((r) => ({ ingredient_id: r.ingredient_id, qty_required: r.qty_required })));
    } catch {
      setRecipes([]);
      setExistingRecipes([]);
    }
  };

  const addRow = () => setRecipes([...recipes, { ingredient_id: "", qty_required: 0 }]);
  const removeRow = (idx: number) => {
    setRowToRemove(idx);
    setIsDeleteDialogOpen(true);
  };

  const confirmRemoveRow = () => {
    if (rowToRemove === null) return;
    setRecipes(recipes.filter((_, i) => i !== rowToRemove));
    setIsDeleteDialogOpen(false);
    setRowToRemove(null);
  };

  const updateRow = (idx: number, field: keyof RecipeRow, value: string | number) => {
    setRecipes(recipes.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));
  };

  const ingredientMap = new Map(ingredients.map((i) => [i.id, i]));

  const normalizedSearch = productSearch.trim().toLowerCase();
  const filteredCafeProducts = normalizedSearch
    ? cafeProducts.filter((p) => p.name.toLowerCase().includes(normalizedSearch))
    : cafeProducts;

  const clearSearch = () => {
    setProductSearch("");
  };

  const totalCost = recipes.reduce((sum, r) => {
    const ing = ingredientMap.get(r.ingredient_id);
    return sum + (ing ? ing.unit_cost * r.qty_required : 0);
  }, 0);

  const margin = selectedProduct ? selectedProduct.selling_price - totalCost : 0;
  const marginPct = selectedProduct && selectedProduct.selling_price > 0
    ? ((margin / selectedProduct.selling_price) * 100).toFixed(1) : "0";

  const handleSave = () => {
    if (!selectedProduct) return;
    const valid = recipes.filter((r) => r.ingredient_id && r.qty_required > 0);

    startTransition(async () => {
      const result = await adminSaveRecipes(selectedProduct.id, valid);
      if (result.success) {
        setMessage("✅ Recipe saved");
        setTimeout(() => setMessage(""), 3000);
      } else {
        setMessage(`❌ ${result.error}`);
      }
    });
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Recipe Builder</h1>
        <p className="text-sm text-gray-500">Define ingredient breakdown for café drinks</p>
      </div>

      {message && (
        <div className="mb-4 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm">
          {message}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Product List */}
        <div className="card p-4">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Café Products</h3>
          <div className="mb-3 flex gap-2">
            <div className="relative flex-1 group">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 group-hover:text-gray-500 transition-colors pointer-events-none">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </span>
              <input
                type="text"
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                placeholder="Search products..."
                className="w-full pl-10 pr-8 py-2 text-sm bg-white border border-gray-200 rounded-lg shadow-sm hover:border-gray-300 focus:outline-none focus:ring-4 focus:ring-gray-100 focus:border-gray-400 transition-all"
              />
              {productSearch.trim() && (
                <button
                  type="button"
                  onClick={clearSearch}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-lg leading-none"
                  aria-label="Clear search"
                >
                  ×
                </button>
              )}
            </div>
          </div>
          <div className="space-y-1">
            {filteredCafeProducts.map((p) => (
              <button
                key={p.id}
                onClick={() => selectProduct(p)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-all ${selectedProduct?.id === p.id
                    ? "bg-amber-50 text-amber-700 font-medium"
                    : "text-gray-600 hover:bg-gray-50"
                  }`}
              >
                {p.name}
                <span className="text-xs text-gray-400 ml-2">{formatCurrency(p.selling_price)}</span>
              </button>
            ))}
            {filteredCafeProducts.length === 0 && (
              <p className="text-sm text-gray-400 py-4 text-center">No café products added yet</p>
            )}
          </div>
        </div>

        {/* Recipe Editor */}
        <div className="lg:col-span-2">
          {selectedProduct ? (
            <div className="card p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">
                  {selectedProduct.name}
                  <span className="text-sm font-normal text-gray-400 ml-2">
                    {formatCurrency(selectedProduct.selling_price)}
                  </span>
                </h3>
                <button onClick={addRow} className="btn-secondary text-sm">
                  + Add Ingredient
                </button>
              </div>

              {recipes.length === 0 ? (
                <p className="text-sm text-gray-400 py-6 text-center">
                  No recipe defined. Click &ldquo;+ Add Ingredient&rdquo; to start.
                </p>
              ) : (
                <div className="space-y-3 mb-4">
                  {/* Column headers */}
                  <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2 px-1">
                    <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Ingredient</span>
                    <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider w-24 text-center">Qty</span>
                    <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider w-20 text-right">Cost</span>
                    <span className="w-6" />
                  </div>

                  {recipes.map((row, idx) => {
                    const ing = ingredientMap.get(row.ingredient_id);
                    const lineCost = ing ? ing.unit_cost * row.qty_required : 0;
                    return (
                      <div key={idx} className="flex flex-col gap-1 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5">
                        {/* Ingredient name label — always visible */}
                        {ing && (
                          <div className="flex items-center gap-1.5 mb-1">
                            <span className="text-xs font-bold text-amber-700 bg-amber-50 border border-amber-100 rounded-full px-2.5 py-0.5">
                              {ing.name}
                            </span>
                            <span className="text-xs text-gray-400">({ing.unit})</span>
                          </div>
                        )}
                        {/* Controls row */}
                        <div className="flex items-center gap-2">
                          <select
                            value={row.ingredient_id}
                            onChange={(e) => updateRow(idx, "ingredient_id", e.target.value)}
                            className="input flex-1 text-sm"
                          >
                            <option value="">Select ingredient</option>
                            {ingredients.map((i) => (
                              <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>
                            ))}
                          </select>
                          <input
                            type="number"
                            step="0.01"
                            value={row.qty_required || ""}
                            onChange={(e) => updateRow(idx, "qty_required", parseFloat(e.target.value) || 0)}
                            className="input w-24 text-sm"
                            placeholder="Qty"
                          />
                          <span className="text-xs text-gray-500 w-20 text-right font-medium">
                            {formatCurrency(lineCost)}
                          </span>
                          <button
                            onClick={() => removeRow(idx)}
                            className="text-red-400 hover:text-red-600 text-lg px-1 flex-shrink-0"
                          >
                            ×
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Cost Summary */}
              {recipes.length > 0 && (
                <div className="border-t border-gray-100 pt-3 mb-4">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Raw Material Cost</span>
                    <span className="font-semibold text-gray-900">{formatCurrency(totalCost)}</span>
                  </div>
                  <div className="flex justify-between text-sm mt-1">
                    <span className="text-gray-500">Selling Price</span>
                    <span>{formatCurrency(selectedProduct.selling_price)}</span>
                  </div>
                  <div className="flex justify-between text-sm mt-1">
                    <span className="text-gray-500">Margin</span>
                    <span className={`font-semibold ${margin >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                      {formatCurrency(margin)} ({marginPct}%)
                    </span>
                  </div>
                </div>
              )}

              <button
                onClick={handleSave}
                disabled={isPending}
                className="btn-primary w-full text-sm"
              >
                {isPending ? "Saving..." : "Save Recipe"}
              </button>
            </div>
          ) : (
            <div className="card p-8 text-center text-gray-400">
              <ClipboardList className="w-16 h-16 mx-auto mb-4 text-gray-300" />
              <p>Select a café product to edit its recipe</p>
            </div>
          )}
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {isDeleteDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm mx-4 shadow-2xl border border-gray-100 animate-slide-in text-center">
            <div className="w-12 h-12 bg-red-50 rounded-full flex items-center justify-center mb-4 mx-auto">
              <span className="text-2xl">⚠️</span>
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-2">Remove Ingredient?</h3>
            <p className="text-sm text-gray-600 mb-6">
              Are you sure you want to remove this ingredient from the recipe? 
              You will need to save the recipe to apply changes permanently.
            </p>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => { setIsDeleteDialogOpen(false); setRowToRemove(null); }}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold text-gray-700 bg-gray-50 border border-gray-200 hover:bg-gray-100 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={confirmRemoveRow}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-white bg-red-600 hover:bg-red-700 shadow-lg shadow-red-200 transition-all"
              >
                Yes, Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
