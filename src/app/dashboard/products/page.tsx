"use client";

import { useState, useEffect, useTransition } from "react";
import { createClient } from "@/lib/supabase/browser";
import { adminSaveProduct, adminDeleteProduct, adminToggleProductStatus } from "@/lib/domain/orders";
import { formatCurrency, getImageUrl } from "@/lib/utils";
import type { ProductWithStock } from "@/lib/types";

export default function ProductsPage() {
  const [products, setProducts] = useState<ProductWithStock[]>([]);
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState<ProductWithStock | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formType, setFormType] = useState<"cafe" | "retail">("retail");
  const [message, setMessage] = useState("");
  const [searchTerm, setSearchTerm] = useState("");

  const filteredProducts = products.filter(p => 
    p.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  useEffect(() => {
    loadProducts();
  }, []);

  async function loadProducts() {
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("products")
        .select("*, retail_stock(*)")
        .order("type")
        .order("name");
      if (error) throw error;
      setProducts(
        (data ?? []).map((p: Record<string, unknown>) => ({
          ...p,
          retail_stock: Array.isArray(p.retail_stock)
            ? (p.retail_stock as unknown[])[0] ?? null
            : p.retail_stock,
        })) as ProductWithStock[]
      );
    } catch {
      // Demo mode
    }
  }

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);

    startTransition(async () => {
      try {
        console.log("[Client] Submitting product form...");
        const result = await adminSaveProduct(formData);
        console.log("[Client] Save result:", result);
        
        if (result && result.success) {
          setMessage("✅ Product saved successfully");
          setShowForm(false);
          setEditing(null);
          // Small delay before reloading to allow DB to propagate
          setTimeout(async () => {
            await loadProducts();
          }, 100);
          setTimeout(() => setMessage(""), 3000);
        } else {
          setMessage(`❌ ${result?.error || "Failed to save product"}`);
        }
      } catch (err: any) {
        console.error("[Client] Submission error:", err);
        setMessage(`❌ Error: ${err.message || "Something went wrong"}`);
      }
    });
  };

  const openNew = (type: "cafe" | "retail") => {
    setEditing(null);
    setFormType(type);
    setShowForm(true);
  };

  const openEdit = (product: ProductWithStock) => {
    setEditing(product);
    setFormType(product.type);
    setShowForm(true);
  };
  const handleToggle = (id: string, current: boolean) => {
    startTransition(async () => {
      const result = await adminToggleProductStatus(id, current);
      if (result.success) {
        await loadProducts();
      } else {
        setMessage(`❌ ${result.error}`);
      }
    });
  };

  const handleDelete = (id: string, name: string) => {
    if (!confirm(`Are you sure you want to delete ${name}?`)) return;
    startTransition(async () => {
      const result = await adminDeleteProduct(id);
      if (result.success) {
        setMessage("✅ Product deleted");
        await loadProducts();
        setTimeout(() => setMessage(""), 3000);
      } else {
        setMessage(`❌ ${result.error}`);
      }
    });
  };

  return (
    <div>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Products</h1>
          <p className="text-sm text-gray-500">Manage fridge items and café drinks</p>
        </div>
        
        <div className="flex-1 flex justify-center max-w-sm">
          <div className="relative w-full">
            <input
              type="text"
              placeholder="Search products..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="input !pl-10 h-10 w-full bg-white border-gray-200 focus:border-amber-500 focus:ring-amber-500"
            />
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </span>
          </div>
        </div>

        <div className="flex gap-2">
          <button onClick={() => openNew("retail")} className="btn-primary text-sm h-10 px-4">
            + Fridge Item
          </button>
          <button onClick={() => openNew("cafe")} className="btn-secondary text-sm h-10 px-4">
            + Café Drink
          </button>
        </div>
      </div>

      {message && (
        <div className="mb-4 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm">
          {message}
        </div>
      )}

      {/* Product Table */}
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="text-left py-3 px-4 font-medium text-gray-500">Product</th>
              <th className="text-left py-3 px-4 font-medium text-gray-500">Type</th>
              <th className="text-right py-3 px-4 font-medium text-gray-500">Price</th>
              <th className="text-right py-3 px-4 font-medium text-gray-500">Cost</th>
              <th className="text-center py-3 px-4 font-medium text-gray-500">Status</th>
              <th className="text-right py-3 px-4 font-medium text-gray-500">Stock</th>
              <th className="text-right py-3 px-4 font-medium text-gray-500">Threshold</th>
              <th className="text-right py-3 px-4 font-medium text-gray-500">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredProducts.map((p) => (
              <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-25">
                <td className="py-3 px-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-gray-50 flex items-center justify-center text-base overflow-hidden border border-gray-100 shrink-0 shadow-sm">
                      {p.image_url ? (
                        <img src={getImageUrl(p.image_url) ?? ""} alt={p.name} className="w-full h-full object-cover" />
                      ) : (
                        <span>{p.type === "cafe" ? "☕" : "🧊"}</span>
                      )}
                    </div>
                    <span className="font-medium text-gray-900 truncate">{p.name}</span>
                  </div>
                </td>
                <td className="py-3 px-4">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                    p.type === "cafe" ? "bg-amber-50 text-amber-700" : "bg-blue-50 text-blue-700"
                  }`}>
                    {p.type}
                  </span>
                </td>
                <td className="py-3 px-4 text-right font-medium">{formatCurrency(p.selling_price)}</td>
                <td className="py-3 px-4 text-right text-gray-500">
                  {p.base_cost ? formatCurrency(p.base_cost) : "—"}
                </td>
                <td className="py-3 px-4 text-center">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                    p.active ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-500"
                  }`}>
                    {p.active ? "Active" : "Inactive"}
                  </span>
                </td>
                <td className="py-3 px-4 text-right text-gray-900 font-medium">
                  {p.retail_stock?.stock ?? 0}
                </td>
                <td className="py-3 px-4 text-right text-amber-600 font-medium">
                  {p.low_stock_threshold ?? 0}
                </td>
                <td className="py-3 px-4 text-right">
                  <div className="flex justify-end gap-3">
                    <button
                      onClick={() => handleToggle(p.id, p.active)}
                      className={`text-sm font-medium ${p.active ? "text-gray-500 hover:text-gray-700 underline" : "text-emerald-600 hover:text-emerald-700 font-bold"}`}
                    >
                      {p.active ? "Deactivate" : "Activate"}
                    </button>
                    <button
                      onClick={() => openEdit(p)}
                      className="text-sm text-amber-600 hover:text-amber-700 font-medium"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(p.id, p.name)}
                      className="text-sm text-red-600 hover:text-red-700 font-medium"
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modal Form */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <form onSubmit={handleSubmit} className="card p-6 w-full max-w-md mx-4 animate-slide-in">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              {editing ? `Edit ${editing.name}` : `New ${formType === "cafe" ? "Café Drink" : "Fridge Item"}`}
            </h2>

            {editing && <input type="hidden" name="id" value={editing.id} />}
            <input type="hidden" name="type" value={editing?.type ?? formType} />

            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                <input name="name" defaultValue={editing?.name ?? ""} required className="input" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Selling Price</label>
                  <input name="selling_price" type="number" step="0.01" defaultValue={editing?.selling_price ?? ""} required className="input" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Base Cost</label>
                  <input name="base_cost" type="number" step="0.01" defaultValue={editing?.base_cost ?? ""} className="input" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Stock</label>
                  <input name="initial_stock" type="number" defaultValue={editing?.retail_stock?.stock ?? "0"} className="input" placeholder="Quantity" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Low Stock Threshold</label>
                  <input name="low_stock_threshold" type="number" defaultValue={editing?.low_stock_threshold ?? ""} className="input" />
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Image URL</label>
                <input name="image_url" type="url" defaultValue={editing?.image_url ?? ""} className="input" placeholder="Optional" />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Upload Photo</label>
                <input name="image_file" type="file" accept="image/*" className="input text-xs" />
                <p className="text-[10px] text-gray-400 mt-1">Choosing a file will overwrite the URL above.</p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="hidden"
                  name="active"
                  value={editing?.active !== false ? "true" : "false"}
                />
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    defaultChecked={editing?.active !== false}
                    onChange={(e) => {
                      const hidden = e.target.closest("div")?.querySelector("input[type=hidden]") as HTMLInputElement;
                      if (hidden) hidden.value = e.target.checked ? "true" : "false";
                    }}
                    className="rounded border-gray-300"
                  />
                  Active
                </label>
              </div>
            </div>

            <div className="flex gap-2 mt-5">
              <button type="submit" disabled={isPending} className="btn-primary flex-1 text-sm">
                {isPending ? "Saving..." : "Save Product"}
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
