"use client";

import { useState, useEffect, useTransition, useRef } from "react";
import OrderSnapshot from "@/components/OrderSnapshot";
import { createClient } from "@/lib/supabase/browser";
import { submitOrder } from "@/lib/domain/orders";
import { formatCurrency } from "@/lib/utils";
import type { CafeProductAvailability } from "@/lib/types";


export default function CafePage() {
  const [products, setProducts] = useState<CafeProductAvailability[]>([]);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<"idle" | "snapshot" | "submitting" | "success" | "error">("idle");
  const [successOrderNumber, setSuccessOrderNumber] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [customerName, setCustomerName] = useState("");
  const isSubmitting = useRef(false);

  useEffect(() => {
    async function load() {
      try {
        const supabase = createClient();
        const { data: productsData, error: prodError } = await supabase
          .from("products").select("*").eq("type", "cafe").eq("active", true).order("name");
        if (prodError) throw prodError;

        const productIds = (productsData ?? []).map((p: { id: string }) => p.id);
        let recipes: any[] = [];
        try {
          const { data: rd, error: re } = await supabase
            .from("recipes").select("*, ingredients(*)").in("product_id", productIds);
          if (!re) recipes = rd ?? [];
        } catch (e) {
          console.warn("Recipes fetch error (skipping availability check):", e);
        }

        const withAvailability: CafeProductAvailability[] = (productsData ?? []).map(
          (product: CafeProductAvailability) => {
            const myRecipes = recipes.filter((r: { product_id: string }) => r.product_id === product.id);
            if (myRecipes.length === 0) return { ...product, available: true, max_servings: 999 };

            let minServings = Infinity;
            for (const recipe of myRecipes) {
              const ing = (recipe as { ingredients: { stock: number; name: string } }).ingredients;
              if (!ing) continue;
              const needed = (recipe as { qty_required: number }).qty_required;
              const servings = Math.floor(ing.stock / (needed || 1));
              minServings = Math.min(minServings, servings);
            }
            return { 
              ...product, 
              available: minServings === Infinity || minServings > 0, 
              max_servings: minServings === Infinity ? 999 : minServings 
            };
          }
        );
        setProducts(withAvailability);
      } catch (err) {
        console.error("Error loading products:", err);
        setProducts([]);
      }
    }
    load();
  }, []);

  const setQty = (productId: string, qty: number) => {
    setQuantities((prev) => ({ ...prev, [productId]: qty }));
  };

  const cartItems = products.filter((p) => (quantities[p.id] ?? 0) > 0);
  const totalPrice = cartItems.reduce((sum, p) => sum + p.selling_price * (quantities[p.id] ?? 0), 0);

  const handleSubmitClick = () => {
    if (cartItems.length === 0) return;
    setStatus("snapshot");
  };

  const finalSubmit = (blob: Blob | null) => {
    if (isSubmitting.current) return;
    isSubmitting.current = true;
    setStatus("submitting");

    startTransition(async () => {
      try {
        let snapshotUrl: string | null = null;

        if (blob) {
          const supabase = createClient();
          const fileName = `${crypto.randomUUID()}.jpg`;
          await supabase.storage.from("order-snapshots").upload(fileName, blob);
          const { data: urlData } = supabase.storage.from("order-snapshots").getPublicUrl(fileName);
          snapshotUrl = urlData.publicUrl;
        }

        const result = await submitOrder({
          items: cartItems.map((p) => ({ productId: p.id, qty: quantities[p.id] ?? 0 })),
          source: "cafe",
          paymentMethod: "cash",
          orderSnapshotUrl: snapshotUrl,
          customerName: customerName.trim() || null,
        });

        if (result.success) {
          setStatus("success");
          setSuccessOrderNumber(result.orderNumber ?? null);
          setQuantities({});
        } else {
          setStatus("error");
          setErrorMsg(result.error ?? "Failed to submit");
        }
      } catch (err) {
        setStatus("error");
        setErrorMsg(err instanceof Error ? err.message : "Unexpected error");
      } finally {
        isSubmitting.current = false;
      }
    });
  };

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-1">☕ Café Menu</h1>
        <p className="text-gray-500">Choose your drink, we&apos;ll prepare it fresh!</p>
      </div>

      {/* Product Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 mb-8">
        {products.filter(p => p.available && (p.max_servings === undefined || p.max_servings > 0)).map((product) => {
          const isUnavailable = !product.available;
          return (
            <div
              key={product.id}
              className={`card overflow-hidden animate-slide-in ${isUnavailable ? "opacity-60" : ""}`}
            >
              {/* Image */}
              <div className="aspect-[4/3] bg-gradient-to-br from-amber-50 to-orange-50 relative">
                {product.image_url ? (
                  <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <span className="text-4xl opacity-40">☕</span>
                  </div>
                )}
                {isUnavailable && (
                  <div className="absolute top-2 right-2 px-2 py-1 rounded-full bg-red-500 text-white text-xs font-semibold">
                    Unavailable
                  </div>
                )}
                {product.available && product.max_servings !== undefined && product.max_servings <= 5 && product.max_servings > 0 && (
                  <div className="absolute top-2 right-2 px-2 py-1 rounded-full bg-amber-500 text-white text-xs font-semibold">
                    {product.max_servings} left
                  </div>
                )}
              </div>

              {/* Content */}
              <div className="p-4">
                <h3 className="text-sm font-semibold text-gray-900 mb-0.5">{product.name}</h3>
                {isUnavailable && product.unavailable_reason && (
                  <p className="text-xs text-red-500 mb-1">{product.unavailable_reason}</p>
                )}
                <p className="text-lg font-bold text-amber-600 mb-3">{formatCurrency(product.selling_price)}</p>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 bg-gray-100 rounded-lg p-1">
                    <button
                      onClick={() => setQty(product.id, Math.max(0, (quantities[product.id] ?? 0) - 1))}
                      className="w-8 h-8 flex items-center justify-center rounded-md text-gray-500 hover:bg-white hover:shadow-sm transition-all disabled:opacity-30"
                      disabled={(quantities[product.id] ?? 0) === 0 || isUnavailable}
                    >−</button>
                    <span className="w-8 text-center text-sm font-semibold tabular-nums">{quantities[product.id] ?? 0}</span>
                    <button
                      onClick={() => setQty(product.id, (quantities[product.id] ?? 0) + 1)}
                      className="w-8 h-8 flex items-center justify-center rounded-md text-gray-500 hover:bg-white hover:shadow-sm transition-all disabled:opacity-30"
                      disabled={isUnavailable}
                    >+</button>
                  </div>
                  {(quantities[product.id] ?? 0) > 0 && (
                    <span className="text-sm font-semibold text-amber-600">
                      {formatCurrency(product.selling_price * (quantities[product.id] ?? 0))}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Cart & Submit */}
      {cartItems.length > 0 && (
        <div className="card p-6 animate-slide-in">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Your Order</h2>
          <div className="space-y-2 mb-4">
            {cartItems.map((p) => (
              <div key={p.id} className="flex justify-between text-sm text-gray-600">
                <span>{p.name} × {quantities[p.id]}</span>
                <span className="font-medium">{formatCurrency(p.selling_price * (quantities[p.id] ?? 0))}</span>
              </div>
            ))}
            <div className="border-t border-gray-100 pt-2 flex justify-between text-base font-semibold">
              <span>Total</span>
              <span className="text-amber-600">{formatCurrency(totalPrice)}</span>
            </div>
          </div>
          {/* V3: Customer Name */}
          <div className="mb-4">
            <label className="block text-xs font-medium text-gray-500 mb-1">Your Name / Seat (optional)</label>
            <input
              type="text"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="e.g. Robi — Seat 3"
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300"
              maxLength={100}
            />
          </div>
          <button
            onClick={handleSubmitClick}
            disabled={isPending || status === "submitting"}
            className="btn-primary w-full"
          >
            {status === "submitting" ? "Sending to barista..." : `Place Order — ${formatCurrency(totalPrice)}`}
          </button>
        </div>
      )}

      {/* Snapshot */}
      {status === "snapshot" && (
        <OrderSnapshot onCapture={(blob) => finalSubmit(blob)} onSkip={() => finalSubmit(null)} />
      )}

      {/* Success */}
      {status === "success" && (
        <div className="mt-6 p-6 rounded-xl bg-emerald-50 border border-emerald-200 text-center animate-slide-in">
          <div className="text-lg font-semibold text-emerald-700 mb-1">✅ Order Placed!</div>
          {successOrderNumber && (
            <div className="text-3xl font-bold text-emerald-600 mb-1">{successOrderNumber}</div>
          )}
          <p className="text-sm text-emerald-600/70">Head to the counter — your drink will be ready soon! ☕</p>
          <button onClick={() => setStatus("idle")} className="mt-3 text-sm text-emerald-600 underline">New Order</button>
        </div>
      )}

      {status === "error" && (
        <div className="mt-6 p-4 rounded-xl bg-red-50 border border-red-200 text-center animate-slide-in">
          <p className="text-red-700">❌ {errorMsg}</p>
          <button onClick={() => setStatus("idle")} className="mt-2 text-sm text-red-600 underline">Dismiss</button>
        </div>
      )}
    </div>
  );
}
