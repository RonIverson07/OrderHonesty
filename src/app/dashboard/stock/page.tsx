"use client";

import { useState, useEffect, useTransition } from "react";
import { createClient } from "@/lib/supabase/browser";
import { adjustStock } from "@/lib/domain/orders";
import { timeAgo } from "@/lib/utils";
import type { Product, Ingredient, RetailStock, InventoryMovement } from "@/lib/types";
import { Package, FlaskConical, Scroll } from "lucide-react";

type MovementReason = "restock" | "adjustment" | "spoilage";

const PAGE_SIZE = 20;

const NoteCell = ({ text, onOpenModal }: { text: string, onOpenModal: (text: string) => void }) => {
  if (!text) return <span className="italic text-gray-400">—</span>;
  
  if (text.length <= 40) {
    return <span className="italic text-gray-500">{text}</span>;
  }
  
  return (
    <div className="flex flex-col items-start gap-1">
      <span className="italic text-gray-500 break-words w-full whitespace-normal">
        {text.slice(0, 40)}...
      </span>
      <button 
        onClick={() => onOpenModal(text)} 
        className="text-[10px] uppercase font-bold text-amber-600 hover:text-amber-700 bg-amber-50 hover:bg-amber-100 px-1.5 py-0.5 rounded transition-colors"
      >
        View More
      </button>
    </div>
  );
};

export default function StockPage() {
  const [retailProducts, setRetailProducts] = useState<(Product & { retail_stock: RetailStock | null })[]>([]);
  const [filteredRetailProducts, setFilteredRetailProducts] = useState<(Product & { retail_stock: RetailStock | null })[]>([]);
  const [ingredientSearchTerm, setIngredientSearchTerm] = useState("");
  const [filteredIngredients, setFilteredIngredients] = useState<Ingredient[]>([]);
  const [auditSearchTerm, setAuditSearchTerm] = useState("");
  const [auditTypeFilter, setAuditTypeFilter] = useState("all");
  const [filteredMovements, setFilteredMovements] = useState<InventoryMovement[]>([]);

  const [retailFilterStatus, setRetailFilterStatus] = useState("all");
  const [ingredientFilterStatus, setIngredientFilterStatus] = useState("all");

  const [retailProductPage, setRetailProductPage] = useState(0);
  const [totalRetailProducts, setTotalRetailProducts] = useState(0);
  const [ingredientPage, setIngredientPage] = useState(0);
  const [totalIngredients, setTotalIngredients] = useState(0);

  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [profileMap, setProfileMap] = useState<Record<string, string>>({}); // id -> email
  const [page, setPage] = useState(0);
  const [totalMovements, setTotalMovements] = useState(0);
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [modal, setModal] = useState<{
    type: "product" | "ingredient";
    id: string;
    name: string;
    currentStock: number;
    newStock: string;
    reason: MovementReason;
    notes: string;
  } | null>(null);
  const [noteModal, setNoteModal] = useState<string | null>(null);

  useEffect(() => { load(); }, []);
  useEffect(() => { loadMovements(); }, [page]);
  useEffect(() => { load(); }, [retailProductPage]);
  useEffect(() => { load(); }, [ingredientPage]);
  useEffect(() => {
    const filtered = retailProducts.filter(product => {
      const matchesSearch = product.name.toLowerCase().includes(searchTerm.toLowerCase());
      const stock = product.retail_stock?.stock ?? 0;
      const threshold = product.low_stock_threshold ?? 5;
      const isOut = stock === 0;
      const isLow = stock > 0 && stock <= threshold;
      const status = isOut ? "out" : isLow ? "low" : "ok";
      const matchesStatus = retailFilterStatus === "all" || status === retailFilterStatus;
      return matchesSearch && matchesStatus;
    });
    setFilteredRetailProducts(filtered);
  }, [retailProducts, searchTerm, retailFilterStatus]);
  useEffect(() => {
    const filtered = ingredients.filter(ingredient => {
      const matchesSearch = ingredient.name.toLowerCase().includes(ingredientSearchTerm.toLowerCase());
      const isOut = ingredient.stock === 0;
      const isLow = ingredient.stock > 0 && ingredient.stock <= ingredient.low_stock_threshold;
      const status = isOut ? "out" : isLow ? "low" : "ok";
      const matchesStatus = ingredientFilterStatus === "all" || status === ingredientFilterStatus;
      return matchesSearch && matchesStatus;
    });
    setFilteredIngredients(filtered);
  }, [ingredients, ingredientSearchTerm, ingredientFilterStatus]);
  useEffect(() => {
    const filtered = movements.filter(movement => {
      const itemName = retailProducts.find(p => p.id === movement.item_id)?.name
        || ingredients.find(i => i.id === movement.item_id)?.name
        || "";
      const performedBy = profileMap[movement.performed_by || ""] || "";
      const notes = movement.notes || "";

      const matchesSearch = itemName.toLowerCase().includes(auditSearchTerm.toLowerCase()) ||
        performedBy.toLowerCase().includes(auditSearchTerm.toLowerCase()) ||
        notes.toLowerCase().includes(auditSearchTerm.toLowerCase()) ||
        movement.movement_type.toLowerCase().includes(auditSearchTerm.toLowerCase());

      const matchesType = auditTypeFilter === "all" || movement.movement_type.toLowerCase() === auditTypeFilter.toLowerCase();

      return matchesSearch && matchesType;
    });
    setFilteredMovements(filtered);
  }, [movements, auditSearchTerm, auditTypeFilter, retailProducts, ingredients, profileMap]);

  async function load() {
    try {
      const supabase = createClient();

      // Get total counts first
      const [{ count: retailCount }, { count: ingredientCount }] = await Promise.all([
        supabase.from("products").select("*", { count: "exact", head: true }).eq("type", "retail").eq("active", true),
        supabase.from("ingredients").select("*", { count: "exact", head: true })
      ]);

      if (retailCount !== null) setTotalRetailProducts(retailCount);
      if (ingredientCount !== null) setTotalIngredients(ingredientCount);

      // Fetch paginated data
      const [{ data: prods }, { data: ings }] = await Promise.all([
        supabase.from("products").select("*, retail_stock(*)").eq("type", "retail").eq("active", true).order("name").range(retailProductPage * PAGE_SIZE, (retailProductPage + 1) * PAGE_SIZE - 1),
        supabase.from("ingredients").select("*").order("name").range(ingredientPage * PAGE_SIZE, (ingredientPage + 1) * PAGE_SIZE - 1)
      ]);
      setRetailProducts(
        (prods ?? []).map((p: Record<string, unknown>) => ({
          ...p,
          retail_stock: Array.isArray(p.retail_stock) ? (p.retail_stock as RetailStock[])[0] ?? null : p.retail_stock,
        })) as (Product & { retail_stock: RetailStock | null })[]
      );
      setFilteredRetailProducts(
        (prods ?? []).map((p: Record<string, unknown>) => ({
          ...p,
          retail_stock: Array.isArray(p.retail_stock) ? (p.retail_stock as RetailStock[])[0] ?? null : p.retail_stock,
        })) as (Product & { retail_stock: RetailStock | null })[]
      );
      setIngredients((ings ?? []) as Ingredient[]);
      setFilteredIngredients((ings ?? []) as Ingredient[]);
      loadMovements();
    } catch (err) {
      console.error("StockPage load error:", err);
    }
  }

  async function loadMovements() {
    try {
      const supabase = createClient();
      const PAGE_SIZE = 10;

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
      setFilteredMovements((moves ?? []) as InventoryMovement[]);
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
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2"><Package className="w-5 h-5 text-blue-600" /> Retail Items</h2>
        <div className="flex items-center gap-4">
          <div className="relative inline-flex items-center group">
            <select
              value={retailFilterStatus}
              onChange={(e) => setRetailFilterStatus(e.target.value)}
              className="appearance-none bg-white border border-gray-200 text-gray-700 text-sm font-normal rounded-lg focus:outline-none focus:ring-4 focus:ring-amber-500/10 focus:border-amber-400 block w-full pl-3 pr-8 py-1.5 shadow-sm hover:bg-gray-50 hover:border-gray-300 cursor-pointer transition-all"
            >
              <option value="all">All Status</option>
              <option value="low">Low Stock</option>
              <option value="out">Out of Stock</option>
              <option value="ok">OK Stock</option>
            </select>
            <div className="absolute right-2.5 pointer-events-none text-gray-400 group-hover:text-gray-600 transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7" /></svg>
            </div>
          </div>
          <div className="relative group w-64">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 group-hover:text-gray-500 transition-colors pointer-events-none">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </span>
            <input
              type="text"
              placeholder="Search retail items..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 pr-3 py-1.5 text-sm w-full bg-white border border-gray-200 rounded-lg shadow-sm hover:border-gray-300 focus:outline-none focus:ring-4 focus:ring-gray-100 focus:border-gray-400 transition-all"
            />
          </div>
          <span className="text-xs text-gray-500 uppercase tracking-wider">
            {totalRetailProducts > 0 ? `${retailProductPage * PAGE_SIZE + 1}-${Math.min((retailProductPage + 1) * PAGE_SIZE, totalRetailProducts)} of ${totalRetailProducts}` : "No items"}
          </span>
          <div className="flex gap-1">
            <button
              onClick={() => setRetailProductPage(p => Math.max(0, p - 1))}
              disabled={retailProductPage === 0}
              className="px-2 py-1 rounded bg-white border text-xs shadow-sm hover:bg-gray-50 disabled:opacity-40"
            >
              ← Prev
            </button>
            <button
              onClick={() => setRetailProductPage(p => p + 1)}
              disabled={(retailProductPage + 1) * PAGE_SIZE >= totalRetailProducts}
              className="px-2 py-1 rounded bg-white border text-xs shadow-sm hover:bg-gray-50 disabled:opacity-40"
            >
              Next →
            </button>
          </div>
        </div>
      </div>
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
            {filteredRetailProducts.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-10 text-center text-gray-400">
                  {searchTerm ? `No retail items found matching "${searchTerm}"` : "No retail items found"}
                </td>
              </tr>
            ) : (
              filteredRetailProducts.map((p) => {
                const stock = p.retail_stock?.stock ?? 0;
                const threshold = p.low_stock_threshold ?? 5;
                const isOut = stock === 0;
                const isLow = stock > 0 && stock <= threshold;
                return (
                  <tr key={p.id} className="border-b border-gray-50">
                    <td className="py-3 px-4 font-medium text-gray-900">{p.name}</td>
                    <td className="py-3 px-4 text-right font-medium">{stock}</td>
                    <td className="py-3 px-4 text-right text-gray-500">{threshold}</td>
                    <td className="py-3 px-4 text-center">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${isOut ? "bg-red-50 text-red-700" : isLow ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"
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
                            className={`text-xs font-medium px-2 py-1 rounded ${reason === "restock" ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100" :
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
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Ingredients */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2"><FlaskConical className="w-5 h-5 text-emerald-600" /> Ingredients</h2>
        <div className="flex items-center gap-4">
          <div className="relative inline-flex items-center group">
            <select
              value={ingredientFilterStatus}
              onChange={(e) => setIngredientFilterStatus(e.target.value)}
              className="appearance-none bg-white border border-gray-200 text-gray-700 text-sm font-normal rounded-lg focus:outline-none focus:ring-4 focus:ring-amber-500/10 focus:border-amber-400 block w-full pl-3 pr-8 py-1.5 shadow-sm hover:bg-gray-50 hover:border-gray-300 cursor-pointer transition-all"
            >
              <option value="all">All Status</option>
              <option value="low">Low Stock</option>
              <option value="out">Out of Stock</option>
              <option value="ok">OK Stock</option>
            </select>
            <div className="absolute right-2.5 pointer-events-none text-gray-400 group-hover:text-gray-600 transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7" /></svg>
            </div>
          </div>
          <div className="relative group w-64">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 group-hover:text-gray-500 transition-colors pointer-events-none">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </span>
            <input
              type="text"
              placeholder="Search ingredients..."
              value={ingredientSearchTerm}
              onChange={(e) => setIngredientSearchTerm(e.target.value)}
              className="pl-9 pr-3 py-1.5 text-sm w-full bg-white border border-gray-200 rounded-lg shadow-sm hover:border-gray-300 focus:outline-none focus:ring-4 focus:ring-gray-100 focus:border-gray-400 transition-all"
            />
          </div>
          <span className="text-xs text-gray-500 uppercase tracking-wider">
            {totalIngredients > 0 ? `${ingredientPage * PAGE_SIZE + 1}-${Math.min((ingredientPage + 1) * PAGE_SIZE, totalIngredients)} of ${totalIngredients}` : "No ingredients"}
          </span>
          <div className="flex gap-1">
            <button
              onClick={() => setIngredientPage(p => Math.max(0, p - 1))}
              disabled={ingredientPage === 0}
              className="px-2 py-1 rounded bg-white border text-xs shadow-sm hover:bg-gray-50 disabled:opacity-40"
            >
              ← Prev
            </button>
            <button
              onClick={() => setIngredientPage(p => p + 1)}
              disabled={(ingredientPage + 1) * PAGE_SIZE >= totalIngredients}
              className="px-2 py-1 rounded bg-white border text-xs shadow-sm hover:bg-gray-50 disabled:opacity-40"
            >
              Next →
            </button>
          </div>
        </div>
      </div>
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
            {filteredIngredients.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-10 text-center text-gray-400">
                  {ingredientSearchTerm ? `No ingredients found matching "${ingredientSearchTerm}"` : "No ingredients found"}
                </td>
              </tr>
            ) : (
              filteredIngredients.map((i) => {
                const isOut = i.stock === 0;
                const isLow = i.stock > 0 && i.stock <= i.low_stock_threshold;
                return (
                  <tr key={i.id} className="border-b border-gray-50">
                    <td className="py-3 px-4 font-medium text-gray-900">{i.name}</td>
                    <td className="py-3 px-4 text-gray-500">{i.unit}</td>
                    <td className="py-3 px-4 text-right font-medium">{Number(i.stock).toLocaleString()}</td>
                    <td className="py-3 px-4 text-right text-gray-500">{Number(i.low_stock_threshold).toLocaleString()}</td>
                    <td className="py-3 px-4 text-center">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${isOut ? "bg-red-50 text-red-700" : isLow ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"
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
                              type: "ingredient", id: i.id, name: i.name,
                              currentStock: i.stock, newStock: "", reason, notes: "",
                            })}
                            className={`text-xs font-medium px-2 py-1 rounded ${reason === "restock" ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100" :
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
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Stock History Logs */}
      <div className="mt-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2"><Scroll className="w-5 h-5 text-amber-600" /> Stock Audit History</h2>
          <div className="flex items-center gap-4">
            <div className="relative inline-flex items-center group">
              <select
                value={auditTypeFilter}
                onChange={(e) => setAuditTypeFilter(e.target.value)}
                className="appearance-none bg-white border border-gray-200 text-gray-700 text-sm font-normal rounded-lg focus:outline-none focus:ring-4 focus:ring-amber-500/10 focus:border-amber-400 block w-full pl-3 pr-8 py-1.5 shadow-sm hover:bg-gray-50 hover:border-gray-300 cursor-pointer transition-all"
              >
                <option value="all">All Types</option>
                <option value="sale">Sale</option>
                <option value="restock">Restock</option>
                <option value="adjustment">Adjustment</option>
                <option value="spoilage">Spoilage</option>
              </select>
              <div className="absolute right-2.5 pointer-events-none text-gray-400 group-hover:text-gray-600 transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7" /></svg>
              </div>
            </div>
            <div className="relative group w-64">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 group-hover:text-gray-500 transition-colors pointer-events-none">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </span>
              <input
                type="text"
                placeholder="Search audit history..."
                value={auditSearchTerm}
                onChange={(e) => setAuditSearchTerm(e.target.value)}
                className="pl-9 pr-3 py-1.5 text-sm w-full bg-white border border-gray-200 rounded-lg shadow-sm hover:border-gray-300 focus:outline-none focus:ring-4 focus:ring-gray-100 focus:border-gray-400 transition-all"
              />
            </div>
            <span className="text-xs text-gray-500 uppercase tracking-wider">
              {totalMovements > 0 ? `${page * 10 + 1}-${Math.min((page + 1) * 10, totalMovements)} of ${totalMovements}` : "No movements"}
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
                disabled={(page + 1) * 10 >= totalMovements}
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
                {filteredMovements.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-gray-400">
                      {auditSearchTerm ? `No audit history found matching "${auditSearchTerm}"` : "No recent stock movements found."}
                    </td>
                  </tr>
                ) : (
                  filteredMovements.map((move) => {
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
                          <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${move.movement_type === "restock" ? "bg-emerald-50 text-emerald-700" :
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
                          {move.movement_type === "sale" ? "Customer" : (move.performed_by ? (profileMap[move.performed_by] || "Admin") : "Admin")}
                        </td>
                        <td className="py-3 px-4 max-w-[200px]">
                          <NoteCell text={move.notes || ""} onOpenModal={setNoteModal} />
                        </td>
                      </tr>
                    );
                  })
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

      {/* View Note Modal */}
      {noteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm px-4">
          <div className="card p-6 w-full max-w-md mx-4 animate-slide-in">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-gray-900">
                Audit Note
              </h3>
              <button 
                onClick={() => setNoteModal(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
            </div>
            
            <div className="bg-gray-50 border border-gray-100 rounded-lg p-4 text-sm text-gray-700 leading-relaxed max-h-[60vh] overflow-y-auto whitespace-pre-wrap">
              {noteModal}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
