"use client";

import { useState, useEffect, useTransition } from "react";
import { createClient } from "@/lib/supabase/browser";
import { confirmOrderPayment, markDayReconciled, updatePaymentProofStatus, saveInventoryCheck, saveIngredientCheck } from "@/lib/domain/orders";
import { formatCurrency, timeAgo } from "@/lib/utils";
import type { OrderWithItems, Product, RetailStock, Ingredient } from "@/lib/types";
import Link from "next/link";

// ---- Demo Data ----

const DEMO_ORDERS: OrderWithItems[] = [
  {
    id: "demo-r1", order_number: "CF-0012", source: "cafe", status: "completed", payment_method: "cash",
    payment_proof_url: null, payment_proof_status: "none", payment_confirmed: true, order_snapshot_url: null, notes: null,
    total_price: 280, total_cost: 45.6, margin: 234.4, created_at: new Date().toISOString(),
    preparing_at: null, ready_at: null, completed_at: new Date().toISOString(),
    confirmed_by: null, confirmed_at: new Date().toISOString(), customer_name: null,
    payment_provider: "manual", payment_status: "paid", payment_reference: null, payment_amount: 280, risk_flag: null,
    order_items: [],
  },
  {
    id: "demo-r2", order_number: "FR-0005", source: "fridge", status: "completed", payment_method: "gcash",
    payment_proof_url: "https://example.com/proof.jpg", payment_proof_status: "uploaded", payment_confirmed: false, order_snapshot_url: null, notes: null,
    total_price: 520, total_cost: 260, margin: 260, created_at: new Date(Date.now() - 3600000).toISOString(),
    preparing_at: null, ready_at: null, completed_at: new Date(Date.now() - 3600000).toISOString(),
    confirmed_by: null, confirmed_at: null, customer_name: null,
    payment_provider: "manual", payment_status: "pending", payment_reference: null, payment_amount: null, risk_flag: "High-value fridge order without payment proof",
    order_items: [],
  },
  {
    id: "demo-r3", order_number: "CF-0013", source: "cafe", status: "completed", payment_method: "cash",
    payment_proof_url: null, payment_proof_status: "none", payment_confirmed: false, order_snapshot_url: null, notes: null,
    total_price: 140, total_cost: 22.8, margin: 117.2, created_at: new Date().toISOString(),
    preparing_at: null, ready_at: null, completed_at: new Date().toISOString(),
    confirmed_by: null, confirmed_at: null, customer_name: "John",
    payment_provider: "manual", payment_status: "unpaid", payment_reference: null, payment_amount: null, risk_flag: null,
    order_items: [],
  },
  {
    id: "demo-r4", order_number: "FR-0006", source: "fridge", status: "completed", payment_method: "bank_transfer",
    payment_proof_url: "https://example.com/proof2.jpg", payment_proof_status: "flagged", payment_confirmed: false, order_snapshot_url: null, notes: "Blurred image",
    total_price: 150, total_cost: 75, margin: 75, created_at: new Date(Date.now() - 7200000).toISOString(),
    preparing_at: null, ready_at: null, completed_at: new Date(Date.now() - 7200000).toISOString(),
    confirmed_by: null, confirmed_at: null, customer_name: null,
    payment_provider: "manual", payment_status: "pending", payment_reference: null, payment_amount: null, risk_flag: null,
    order_items: [],
  },
];

interface InventoryItem {
  id: string;
  name: string;
  systemStock: number;
  actualCount: string; // string for input binding
}

interface IngredientAuditItem {
  id: string;
  name: string;
  unit: string;
  systemStock: number;
  actualCount: string;
}

const DEMO_INVENTORY: InventoryItem[] = [
  { id: "d1", name: "Bottled Water", systemStock: 20, actualCount: "" },
  { id: "d2", name: "Chocolate Bar", systemStock: 15, actualCount: "" },
  { id: "d3", name: "Chips Pack", systemStock: 18, actualCount: "" },
  { id: "d4", name: "Energy Drink", systemStock: 3, actualCount: "" },
  { id: "d5", name: "Granola Bar", systemStock: 0, actualCount: "" },
];

const PROOF_STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  none: { bg: "bg-gray-100", text: "text-gray-500", label: "No Proof" },
  uploaded: { bg: "bg-amber-50", text: "text-amber-700", label: "Uploaded" },
  confirmed: { bg: "bg-emerald-50", text: "text-emerald-700", label: "✓ Confirmed" },
  flagged: { bg: "bg-red-50", text: "text-red-700", label: "⚠ Flagged" },
};

// ---- Tabs ----
type ReconciliationTab = "payments" | "inventory" | "ingredients";

export default function ReconciliationPage() {
  const [activeTab, setActiveTab] = useState<ReconciliationTab>("payments");
  const [orders, setOrders] = useState<OrderWithItems[]>([]);
  const [isDemo, setIsDemo] = useState(true);
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().slice(0, 10));

  // Inventory state
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [inventorySaved, setInventorySaved] = useState(false);

  // Ingredient state
  const [ingredientItems, setIngredientItems] = useState<IngredientAuditItem[]>([]);
  const [ingredientsSaved, setIngredientsSaved] = useState(false);

  // Admin Override Modal state
  const [showOverrideModal, setShowOverrideModal] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");

  useEffect(() => {
    loadOrders();
    loadInventory();
  }, [selectedDate]);

  async function loadOrders() {
    try {
      const supabase = createClient();
      const start = new Date(selectedDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(selectedDate);
      end.setHours(23, 59, 59, 999);

      const { data, error } = await supabase
        .from("orders")
        .select("*, order_items(*, products!product_id(*))")
        .gte("created_at", start.toISOString())
        .lte("created_at", end.toISOString())
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Orders load error:", error);
        return;
      }
      setOrders((data ?? []) as OrderWithItems[]);
      setIsDemo(false);
    } catch (err) {
      console.error("Critical reconciliation load error:", err);
    }
  }

  async function loadInventory() {
    try {
      const supabase = createClient();
      const [{ data: retail }, { data: ingredients }] = await Promise.all([
        supabase.from("products").select("*, retail_stock(*)").eq("type", "retail").eq("active", true).order("name"),
        supabase.from("ingredients").select("*").order("name")
      ]);

      setInventoryItems(
        (retail ?? []).map((p: Product & { retail_stock: RetailStock[] | RetailStock | null }) => ({
          id: p.id,
          name: p.name,
          systemStock: Array.isArray(p.retail_stock) ? (p.retail_stock[0]?.stock ?? 0) : ((p.retail_stock as RetailStock)?.stock ?? 0),
          actualCount: "",
        }))
      );

      setIngredientItems(
        (ingredients ?? []).map((i: Ingredient) => ({
          id: i.id,
          name: i.name,
          unit: i.unit,
          systemStock: Number(i.stock ?? 0),
          actualCount: "",
        }))
      );

      setInventorySaved(false);
      setIngredientsSaved(false);
    } catch (err) {
      console.error("Inventory load error:", err);
    }
  }

  // ---- Payment Stats ----
  const totalExpected = orders.reduce((s, o) => s + Number(o.total_price), 0);
  const totalConfirmed = orders.filter((o) => o.payment_confirmed).reduce((s, o) => s + Number(o.total_price), 0);
  const paymentVariance = totalExpected - totalConfirmed;
  const variancePct = totalExpected > 0 ? ((paymentVariance / totalExpected) * 100).toFixed(1) : "0";

  const cafeRevenue = orders.filter((o) => o.source === "cafe").reduce((s, o) => s + Number(o.total_price), 0);
  const fridgeRevenue = orders.filter((o) => o.source === "fridge").reduce((s, o) => s + Number(o.total_price), 0);
  const cashRevenue = orders.filter((o) => o.payment_method === "cash").reduce((s, o) => s + Number(o.total_price), 0);
  const qrRevenue = orders.filter((o) => o.payment_method !== "cash").reduce((s, o) => s + Number(o.total_price), 0);
  const flaggedCount = orders.filter((o) => o.payment_proof_status === "flagged").length;
  const uploadedCount = orders.filter((o) => o.payment_proof_status === "uploaded").length;

  // ---- Inventory Stats ----
  const inventoryWithCount = inventoryItems.filter((i) => i.actualCount !== "");
  const inventoryMismatches = inventoryWithCount.filter((i) => {
    const actual = parseFloat(i.actualCount);
    return !isNaN(actual) && actual !== i.systemStock;
  });
  const totalStockVariance = inventoryWithCount.reduce((sum, i) => {
    const actual = parseFloat(i.actualCount);
    return sum + (isNaN(actual) ? 0 : actual - i.systemStock);
  }, 0);

  // ---- Ingredient Stats ----
  const ingredientsWithCount = ingredientItems.filter((i) => i.actualCount !== "");
  const ingredientMismatches = ingredientsWithCount.filter((i) => {
    const actual = parseFloat(i.actualCount);
    return !isNaN(actual) && actual !== i.systemStock;
  });
  const totalIngredientVariance = ingredientsWithCount.reduce((sum, i) => {
    const actual = parseFloat(i.actualCount);
    return sum + (isNaN(actual) ? 0 : actual - i.systemStock);
  }, 0);

  // ---- Lifecycle Blockers Calculation ----
  const blockers: string[] = [];
  if (orders.some((o) => o.payment_status === "pending" || o.payment_status === "failed")) {
    blockers.push("Unresolved pending or failed payments exist.");
  }
  if (orders.some((o) => o.payment_proof_status === "flagged")) {
    blockers.push("Payment proofs are flagged and unresolved.");
  }
  if (orders.some((o) => !!o.risk_flag)) {
    blockers.push("Critical risk flags exist.");
  }
  if (inventoryItems.length > 0 && !inventorySaved) {
    blockers.push("Retail inventory audit not completed or saved today.");
  }
  if (ingredientItems.length > 0 && !ingredientsSaved) {
    blockers.push("Ingredients audit not completed or saved today.");
  }

  // ---- Payment Actions ----
  const handleMarkReconciled = (isOverride = false) => {
    if (isOverride && !overrideReason.trim()) return;

    startTransition(async () => {
      if (isDemo) {
        setOrders((prev) => prev.map((o) => ({ ...o, payment_confirmed: true, payment_proof_status: "confirmed" as const })));
        setMessage(`✅ Demo: all orders marked reconciled${isOverride ? ` (Admin Override: ${overrideReason})` : ""}`);
        setShowOverrideModal(false);
        setOverrideReason("");
        setTimeout(() => setMessage(""), 3000);
        return;
      }
      const result = await markDayReconciled(selectedDate, isOverride ? overrideReason : undefined);
      if (result.success) {
        setMessage(`✅ ${result.count} orders marked as reconciled${isOverride ? " via Admin Override" : ""}`);
        setShowOverrideModal(false);
        setOverrideReason("");
        await loadOrders();
        setTimeout(() => setMessage(""), 3000);
      } else {
        setMessage(`❌ ${result.error}`);
      }
    });
  };

  const handleConfirm = (orderId: string) => {
    if (!window.confirm("Confirm payment for this order? This will mark it as settled in the system.")) return;

    console.log(`[Reconciliation] Confirming order ${orderId}`);

    // Save original state for possible revert
    const originalOrders = [...orders];

    // Optimistic Update
    setOrders((prev) =>
      prev.map((o) => o.id === orderId ? { ...o, payment_confirmed: true, payment_proof_status: "confirmed" as const } : o)
    );

    startTransition(async () => {
      try {
        const result = await confirmOrderPayment(orderId);
        if (!result.success) {
          throw new Error(result.error);
        }
        console.log(`[Reconciliation] Order ${orderId} confirmed successfully`);
        // Force re-fetch to ensure sync with server
        await loadOrders();
      } catch (err) {
        console.error(`[Reconciliation] Confirm failed:`, err);
        setMessage(`❌ Failed to confirm order: ${err instanceof Error ? err.message : "Error"}`);
        // REVERT optimistic update on failure
        setOrders(originalOrders);
        alert(`Failed to save confirmation: ${err instanceof Error ? err.message : "Database Error"}`);
      }
    });
  };

  const handleFlag = (orderId: string) => {
    if (!window.confirm("Flag this order for manual review?")) return;

    console.log(`[Reconciliation] Flagging order ${orderId}`);

    // Save original state
    const originalOrders = [...orders];

    // Optimistic Update
    setOrders((prev) =>
      prev.map((o) => o.id === orderId ? { ...o, payment_proof_status: "flagged" as const } : o)
    );

    startTransition(async () => {
      try {
        const result = await updatePaymentProofStatus(orderId, "flagged");
        if (!result.success) {
          throw new Error(result.error);
        }
        console.log(`[Reconciliation] Order ${orderId} flagged successfully`);
        await loadOrders();
      } catch (err) {
        console.error(`[Reconciliation] Flag failed:`, err);
        setMessage(`❌ Failed to flag order: ${err instanceof Error ? err.message : "Error"}`);
        // REVERT
        setOrders(originalOrders);
      }
    });
  };

  const updateActualCount = (id: string, value: string) => {
    setInventoryItems((prev) => prev.map((item) => item.id === id ? { ...item, actualCount: value } : item));
    setInventorySaved(false);
  };

  const updateIngredientCount = (id: string, value: string) => {
    setIngredientItems((prev) => prev.map((item) => item.id === id ? { ...item, actualCount: value } : item));
    setIngredientsSaved(false);
  };

  const handleSaveInventoryCheck = () => {
    const itemsToSave = inventoryItems
      .filter((i) => i.actualCount !== "")
      .map((i) => ({
        productId: i.id,
        productName: i.name,
        systemStock: i.systemStock,
        actualCount: parseFloat(i.actualCount),
      }))
      .filter((i) => !isNaN(i.actualCount));

    if (itemsToSave.length === 0) {
      setMessage("⚠ Enter at least one actual count");
      setTimeout(() => setMessage(""), 3000);
      return;
    }

    startTransition(async () => {
      if (isDemo) {
        setInventorySaved(true);
        setMessage(`✅ Demo: ${itemsToSave.length} items checked, ${inventoryMismatches.length} adjustments`);
        setTimeout(() => setMessage(""), 3000);
        return;
      }
      const result = await saveInventoryCheck(itemsToSave);
      if (result.success) {
        setInventorySaved(true);
        setMessage(`✅ Inventory check saved: ${result.adjusted} items adjusted (total variance: ${result.totalVariance > 0 ? "+" : ""}${result.totalVariance})`);
        await loadInventory();
        setTimeout(() => setMessage(""), 5000);
      } else {
        setMessage(`❌ ${result.error}`);
      }
    });
  };

  const handleSaveIngredientCheck = () => {
    const itemsToSave = ingredientItems
      .filter((i) => i.actualCount !== "")
      .map((i) => ({
        ingredientId: i.id,
        ingredientName: i.name,
        unit: i.unit,
        systemStock: i.systemStock,
        actualCount: parseFloat(i.actualCount),
      }))
      .filter((i) => !isNaN(i.actualCount));

    if (itemsToSave.length === 0) {
      setMessage("⚠ Enter at least one ingredient count");
      setTimeout(() => setMessage(""), 3000);
      return;
    }

    startTransition(async () => {
      if (isDemo) {
        setIngredientsSaved(true);
        setMessage(`✅ Demo: ${itemsToSave.length} ingredients checked.`);
        setTimeout(() => setMessage(""), 3000);
        return;
      }
      const result = await saveIngredientCheck(itemsToSave);
      if (result.success) {
        setIngredientsSaved(true);
        setMessage(`✅ Ingredient audit saved: ${result.adjusted} items adjusted.`);
        await loadInventory();
        setTimeout(() => setMessage(""), 5000);
      } else {
        setMessage(`❌ ${result.error}`);
      }
    });
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">🧾 Reconciliation</h1>
          <p className="text-sm text-gray-500">Payment verification &amp; inventory checks</p>
          {isDemo && (
            <div className="mt-2 p-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-xs">
              ⚡ Demo mode
            </div>
          )}
        </div>
        <div className="flex items-center gap-3">
          <Link href="/dashboard/reconciliation/history" className="btn-secondary text-sm">
            History &amp; Trends
          </Link>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="input text-sm"
          />
        </div>
      </div>

      {message && (
        <div className={`mb-4 p-3 rounded-lg text-sm ${message.startsWith("❌") ? "bg-red-50 border border-red-200 text-red-700" : message.startsWith("⚠") ? "bg-amber-50 border border-amber-200 text-amber-700" : "bg-emerald-50 border border-emerald-200 text-emerald-700"}`}>
          {message}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 w-fit">
        <button
          onClick={() => setActiveTab("payments")}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${activeTab === "payments" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
            }`}
        >
          💰 Payments
        </button>
        <button
          onClick={() => setActiveTab("inventory")}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${activeTab === "inventory" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
            }`}
        >
          📦 Retail Check
          {inventoryMismatches.length > 0 && (
            <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-red-500 text-white text-xs">
              {inventoryMismatches.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab("ingredients")}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${activeTab === "ingredients" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
            }`}
        >
          🧪 Ingredients Audit
          {ingredientMismatches.length > 0 && (
            <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-red-500 text-white text-xs">
              {ingredientMismatches.length}
            </span>
          )}
        </button>
      </div>

      {/* ===== PAYMENTS TAB ===== */}
      {activeTab === "payments" && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <div className="card p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Expected</p>
              <p className="text-2xl font-bold text-gray-900">{formatCurrency(totalExpected)}</p>
              <p className="text-xs text-gray-400 mt-1">{orders.length} orders</p>
            </div>
            <div className="card p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Confirmed</p>
              <p className="text-2xl font-bold text-emerald-600">{formatCurrency(totalConfirmed)}</p>
              <p className="text-xs text-gray-400 mt-1">{orders.filter((o) => o.payment_confirmed).length} orders</p>
            </div>
            <div className="card p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Variance</p>
              <p className={`text-2xl font-bold ${paymentVariance > 0 ? "text-red-600" : "text-emerald-600"}`}>
                {paymentVariance > 0 ? "-" : ""}{formatCurrency(Math.abs(paymentVariance))}
              </p>
              <p className="text-xs text-gray-400 mt-1">{variancePct}% gap</p>
            </div>
            <div className="card p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Flagged</p>
              <p className={`text-2xl font-bold ${flaggedCount > 0 ? "text-red-600" : "text-gray-400"}`}>{flaggedCount}</p>
              <p className="text-xs text-gray-400 mt-1">{uploadedCount} pending review</p>
            </div>
          </div>

          {/* Breakdowns */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            <div className="card p-4">
              <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">By Source</h3>
              <div className="space-y-3">
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-600">☕ Café</span>
                    <span className="font-medium">{formatCurrency(cafeRevenue)}</span>
                  </div>
                  <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-amber-500 rounded-full transition-all" style={{ width: totalExpected > 0 ? `${(cafeRevenue / totalExpected) * 100}%` : "0%" }} />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-600">🧊 Fridge</span>
                    <span className="font-medium">{formatCurrency(fridgeRevenue)}</span>
                  </div>
                  <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: totalExpected > 0 ? `${(fridgeRevenue / totalExpected) * 100}%` : "0%" }} />
                  </div>
                </div>
              </div>
            </div>
            <div className="card p-4">
              <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">By Payment</h3>
              <div className="space-y-3">
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-600">💵 Cash</span>
                    <span className="font-medium">{formatCurrency(cashRevenue)}</span>
                  </div>
                  <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: totalExpected > 0 ? `${(cashRevenue / totalExpected) * 100}%` : "0%" }} />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-600">📱 QR / Bank</span>
                    <span className="font-medium">{formatCurrency(qrRevenue)}</span>
                  </div>
                  <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-purple-500 rounded-full transition-all" style={{ width: totalExpected > 0 ? `${(qrRevenue / totalExpected) * 100}%` : "0%" }} />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Mark Day Reconciled action & Lifecycle Enforcement */}
          <div className="flex flex-col mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Order Details</h2>
              <div className="flex gap-2">
                {blockers.length > 0 && (
                  <button
                    onClick={() => setShowOverrideModal(true)}
                    className="btn-secondary text-sm border-red-200 text-red-700 bg-red-50 hover:bg-red-100 font-bold"
                  >
                    ⚠ Admin Override
                  </button>
                )}
                <button
                  onClick={() => handleMarkReconciled(false)}
                  disabled={isPending || paymentVariance === 0 || blockers.length > 0}
                  className="btn-primary text-sm disabled:opacity-50"
                  title={blockers.length > 0 ? "Resolve blockers first" : "Reconcile Day"}
                >
                  {isPending ? "Processing..." : "Mark Day Reconciled"}
                </button>
              </div>
            </div>

            {blockers.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 w-full">
                <h3 className="text-sm font-bold text-red-800 mb-2 flex items-center gap-1.5">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                  EndOfDay Close Blocked
                </h3>
                <ul className="list-disc list-inside text-sm text-red-700 space-y-1 ml-1">
                  {blockers.map((b, i) => <li key={i}>{b}</li>)}
                </ul>
              </div>
            )}
          </div>

          {/* Order Table */}
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="text-left py-3 px-4 font-medium text-gray-500">Order</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-500">Source</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-500">Method</th>
                    <th className="text-right py-3 px-4 font-medium text-gray-500">Amount</th>
                    <th className="text-center py-3 px-4 font-medium text-gray-500">Proof</th>
                    <th className="text-center py-3 px-4 font-medium text-gray-500">Confirmed</th>
                    <th className="text-right py-3 px-4 font-medium text-gray-500">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order) => {
                    const ps = PROOF_STATUS_STYLES[order.payment_proof_status] ?? PROOF_STATUS_STYLES.none;
                    return (
                      <tr key={order.id} className="border-b border-gray-50 hover:bg-gray-25">
                        <td className="py-3 px-4">
                          <span className="font-semibold text-amber-600">{order.order_number ?? `#${order.id.slice(0, 8)}`}</span>
                          <span className="text-xs text-gray-400 ml-1.5">{timeAgo(order.created_at)}</span>
                        </td>
                        <td className="py-3 px-4">
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${order.source === "cafe" ? "bg-amber-50 text-amber-700" : "bg-blue-50 text-blue-700"}`}>
                            {order.source === "cafe" ? "☕ Café" : "🧊 Fridge"}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-gray-600 capitalize">{order.payment_method.replace("_", " ")}</td>
                        <td className="py-3 px-4 text-right font-medium">{formatCurrency(order.total_price)}</td>
                        <td className="py-3 px-4 text-center">
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${ps.bg} ${ps.text}`}>
                            {ps.label}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-center">
                          {order.payment_confirmed
                            ? <span className="text-emerald-600 font-medium text-xs">✓ Yes</span>
                            : <span className="text-gray-400 text-xs">No</span>}
                        </td>
                        <td className="py-3 px-4 text-right">
                          {!order.payment_confirmed && (
                            <div className="flex gap-1 justify-end">
                              <button onClick={() => handleConfirm(order.id)} disabled={isPending}
                                className="text-xs px-2 py-1 rounded bg-emerald-50 text-emerald-700 hover:bg-emerald-100 font-medium disabled:opacity-50">
                                ✓ Confirm
                              </button>
                              {order.payment_proof_status !== "flagged" && (
                                <button onClick={() => handleFlag(order.id)} disabled={isPending}
                                  className="text-xs px-2 py-1 rounded bg-red-50 text-red-700 hover:bg-red-100 font-medium disabled:opacity-50">
                                  ⚠ Flag
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {orders.length === 0 && (
                    <tr><td colSpan={7} className="py-8 text-center text-gray-400">No orders for this date</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ===== INVENTORY TAB ===== */}
      {activeTab === "inventory" && (
        <>
          {/* Inventory Summary Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <div className="card p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Total Items</p>
              <p className="text-2xl font-bold text-gray-900">{inventoryItems.length}</p>
              <p className="text-xs text-gray-400 mt-1">retail products</p>
            </div>
            <div className="card p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Counted</p>
              <p className="text-2xl font-bold text-blue-600">{inventoryWithCount.length}</p>
              <p className="text-xs text-gray-400 mt-1">of {inventoryItems.length} items</p>
            </div>
            <div className="card p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Mismatches</p>
              <p className={`text-2xl font-bold ${inventoryMismatches.length > 0 ? "text-red-600" : "text-emerald-600"}`}>
                {inventoryMismatches.length}
              </p>
              <p className="text-xs text-gray-400 mt-1">{inventoryMismatches.length > 0 ? "items need adjustment" : "all match ✓"}</p>
            </div>
            <div className="card p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Stock Variance</p>
              <p className={`text-2xl font-bold ${totalStockVariance < 0 ? "text-red-600" : totalStockVariance > 0 ? "text-amber-600" : "text-emerald-600"}`}>
                {totalStockVariance > 0 ? "+" : ""}{totalStockVariance}
              </p>
              <p className="text-xs text-gray-400 mt-1">
                {totalStockVariance < 0 ? "units missing" : totalStockVariance > 0 ? "units excess" : "balanced"}
              </p>
            </div>
          </div>

          {/* Inventory Check Table */}
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">📋 Retail Inventory Count</h2>
            <button
              onClick={handleSaveInventoryCheck}
              disabled={isPending || inventoryWithCount.length === 0 || inventorySaved}
              className="btn-primary text-sm"
            >
              {isPending ? "Saving..." : inventorySaved ? "✓ Saved" : "Save Inventory Check"}
            </button>
          </div>

          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left py-3 px-4 font-medium text-gray-500">Item</th>
                  <th className="text-right py-3 px-4 font-medium text-gray-500">System Stock</th>
                  <th className="text-center py-3 px-4 font-medium text-gray-500 w-32">Actual Count</th>
                  <th className="text-right py-3 px-4 font-medium text-gray-500">Variance</th>
                  <th className="text-center py-3 px-4 font-medium text-gray-500">Status</th>
                </tr>
              </thead>
              <tbody>
                {inventoryItems.map((item) => {
                  const actual = item.actualCount !== "" ? parseFloat(item.actualCount) : null;
                  const variance = actual !== null && !isNaN(actual) ? actual - item.systemStock : null;
                  const isMismatch = variance !== null && variance !== 0;
                  const isSevere = variance !== null && Math.abs(variance) >= 3;
                  const isMinor = variance !== null && Math.abs(variance) > 0 && Math.abs(variance) < 3;

                  return (
                    <tr
                      key={item.id}
                      className={`border-b border-gray-50 transition-colors ${isSevere ? "bg-red-50/50" : isMinor ? "bg-amber-50/30" : ""
                        }`}
                    >
                      <td className="py-3 px-4">
                        <span className="font-medium text-gray-900">{item.name}</span>
                      </td>
                      <td className="py-3 px-4 text-right font-medium text-gray-600 tabular-nums">
                        {item.systemStock}
                      </td>
                      <td className="py-3 px-4">
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={item.actualCount}
                          onChange={(e) => updateActualCount(item.id, e.target.value)}
                          placeholder="—"
                          className={`input text-center w-full tabular-nums ${isMismatch
                            ? isSevere
                              ? "!border-red-300 !ring-red-100"
                              : "!border-amber-300 !ring-amber-100"
                            : ""
                            }`}
                        />
                      </td>
                      <td className="py-3 px-4 text-right tabular-nums">
                        {variance !== null ? (
                          <span className={`font-semibold ${variance < 0 ? "text-red-600" : variance > 0 ? "text-amber-600" : "text-emerald-600"
                            }`}>
                            {variance > 0 ? "+" : ""}{variance}
                          </span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-center">
                        {variance === null ? (
                          <span className="text-xs text-gray-300">—</span>
                        ) : variance === 0 ? (
                          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">✓ Match</span>
                        ) : isSevere ? (
                          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-50 text-red-700">
                            ⚠ {variance < 0 ? "Missing" : "Excess"}
                          </span>
                        ) : (
                          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">
                            ~ {variance < 0 ? "Short" : "Over"}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {inventoryItems.length === 0 && (
                  <tr><td colSpan={5} className="py-8 text-center text-gray-400">No retail items found</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Mismatch Summary (when items counted) */}
          {inventoryMismatches.length > 0 && (
            <div className="mt-4 card p-4 border-l-4 border-l-amber-400">
              <h3 className="text-sm font-semibold text-gray-900 mb-2">
                ⚠ {inventoryMismatches.length} item{inventoryMismatches.length > 1 ? "s" : ""} with discrepancy
              </h3>
              <div className="space-y-1">
                {inventoryMismatches.map((item) => {
                  const actual = parseFloat(item.actualCount);
                  const delta = actual - item.systemStock;
                  return (
                    <div key={item.id} className="flex items-center justify-between text-sm">
                      <span className="text-gray-600">{item.name}</span>
                      <span className={`font-medium ${delta < 0 ? "text-red-600" : "text-amber-600"}`}>
                        {item.systemStock} → {actual} ({delta > 0 ? "+" : ""}{delta})
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* ===== INGREDIENTS TAB ===== */}
      {activeTab === "ingredients" && (
        <>
          {/* Ingredient Audit Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <div className="card p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Total Ingredients</p>
              <p className="text-2xl font-bold text-gray-900">{ingredientItems.length}</p>
              <p className="text-xs text-gray-400 mt-1">audit items</p>
            </div>
            <div className="card p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Counted</p>
              <p className="text-2xl font-bold text-blue-600">{ingredientsWithCount.length}</p>
              <p className="text-xs text-gray-400 mt-1">of {ingredientItems.length} items</p>
            </div>
            <div className="card p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Mismatches</p>
              <p className={`text-2xl font-bold ${ingredientMismatches.length > 0 ? "text-red-600" : "text-emerald-600"}`}>
                {ingredientMismatches.length}
              </p>
              <p className="text-xs text-gray-400 mt-1">
                {ingredientMismatches.length > 0 ? `${ingredientMismatches.length} item${ingredientMismatches.length > 1 ? "s" : ""} need adjustment` : "all match ✓"}
              </p>
            </div>
            <div className="card p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Audit Variance</p>
              <p className={`text-2xl font-bold ${totalIngredientVariance < 0 ? "text-red-600" : totalIngredientVariance > 0 ? "text-amber-600" : "text-emerald-600"}`}>
                {totalIngredientVariance > 0 ? "+" : ""}{totalIngredientVariance}
              </p>
              <p className="text-xs text-gray-400 mt-1">
                {totalIngredientVariance < 0 ? "raw materials short" : totalIngredientVariance > 0 ? "excess stock" : "balanced"}
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">🧪 Daily Ingredients Audit</h2>
              <p className="text-sm text-gray-500">Record physical counts for raw materials (beans, milk, syrups)</p>
            </div>
            <button
              onClick={handleSaveIngredientCheck}
              disabled={isPending || ingredientsWithCount.length === 0 || ingredientsSaved}
              className="btn-primary text-sm"
            >
              {isPending ? "Saving..." : ingredientsSaved ? "✓ Saved" : "Save Ingredient Audit"}
            </button>
          </div>

          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left py-3 px-4 font-medium text-gray-500">Ingredient Name</th>
                  <th className="text-right py-3 px-4 font-medium text-gray-500">System Stock</th>
                  <th className="text-center py-3 px-4 font-medium text-gray-500 w-32">Physical Count</th>
                  <th className="text-right py-3 px-4 font-medium text-gray-500">Variance</th>
                  <th className="text-center py-3 px-4 font-medium text-gray-500">Status</th>
                </tr>
              </thead>
              <tbody>
                {ingredientItems.map((item) => {
                  const actual = item.actualCount !== "" ? parseFloat(item.actualCount) : null;
                  const variance = actual !== null && !isNaN(actual) ? parseFloat((actual - item.systemStock).toFixed(2)) : null;
                  const isMismatch = variance !== null && variance !== 0;

                  return (
                    <tr
                      key={item.id}
                      className={`border-b border-gray-50 transition-colors ${isMismatch ? "bg-amber-50/30" : ""
                        }`}
                    >
                      <td className="py-3 px-4">
                        <span className="font-medium text-gray-900">{item.name}</span>
                      </td>
                      <td className="py-3 px-4 text-right text-gray-600 tabular-nums">
                        {item.systemStock} <span className="text-gray-400 text-xs">{item.unit}</span>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <div className="flex items-center gap-1 justify-center">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={item.actualCount}
                            onChange={(e) => updateIngredientCount(item.id, e.target.value)}
                            placeholder="—"
                            className={`input text-center w-24 tabular-nums ${isMismatch ? "!border-amber-300 !ring-amber-100" : ""
                              }`}
                          />
                          <span className="text-xs text-gray-400 w-6 text-left">{item.unit}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right tabular-nums">
                        {variance !== null ? (
                          <span className={`font-semibold ${variance < 0 ? "text-red-600" : variance > 0 ? "text-amber-600" : "text-emerald-600"
                            }`}>
                            {variance > 0 ? "+" : ""}{variance}
                          </span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-center">
                        {variance === null ? (
                          <span className="text-xs text-gray-300">—</span>
                        ) : variance === 0 ? (
                          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">✓ Match</span>
                        ) : (
                          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">
                            ⚠ {variance < 0 ? "Short" : "Over"}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {ingredientItems.length === 0 && (
                  <tr><td colSpan={5} className="py-8 text-center text-gray-400">No ingredients found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
      {/* ===== OVERRIDE MODAL ===== */}
      {showOverrideModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="card p-6 w-full max-w-md mx-4 animate-slide-in shadow-2xl border border-red-100">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-red-600 border border-red-200 bg-red-50 p-1.5 rounded-full">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
              </span>
              <h3 className="text-xl font-bold text-gray-900">Admin Override</h3>
            </div>
            <p className="text-sm text-red-600 mb-4 bg-red-50 p-2 rounded">
              You are bypassing <b>{blockers.length} active blockers</b>. This action will be securely logged and audited.
            </p>

            <div className="space-y-3 mb-5">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Override Reason <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  className="input min-h-[100px] border-amber-300 focus:ring-amber-500"
                  placeholder="Explain why you are force-closing this day (e.g., Physical POS was offline, discrepancy manually verified by owner)"
                  required
                  autoFocus
                />
              </div>
            </div>

            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowOverrideModal(false)} className="btn-secondary text-sm px-4">
                Cancel
              </button>
              <button
                onClick={() => handleMarkReconciled(true)}
                disabled={isPending || !overrideReason.trim()}
                className="btn-primary bg-red-600 text-white hover:bg-red-700 hover:ring-red-200 text-sm font-bold shadow-sm disabled:opacity-50 px-6"
              >
                {isPending ? "Forcing..." : "Force Close Day"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
