"use client";

import { useState, useEffect, useTransition, useRef } from "react";
import OrderSnapshot from "@/components/OrderSnapshot";
import Skeleton from "@/components/Skeleton";
import { createClient } from "@/lib/supabase/browser";
import { submitOrder, adminUploadFile } from "@/lib/domain/orders";
import { formatCurrency, getImageUrl } from "@/lib/utils";
import type { CafeProductAvailability, PaymentMethod } from "@/lib/types";

const ALL_PAYMENT_OPTIONS: { value: PaymentMethod; label: string; icon: string }[] = [
  { value: "cash", label: "Cash", icon: "💵" },
  { value: "gcash", label: "GCash", icon: "📱" },
  { value: "qr_code", label: "QR Code", icon: "🔳" },
  { value: "bank_transfer", label: "Bank Transfer", icon: "🏦" },
  { value: "hitpay", label: "HitPay", icon: "💳" },
];

export default function CafePage() {
  const [products, setProducts] = useState<CafeProductAvailability[]>([]);
  const [enabledPayments, setEnabledPayments] = useState<Record<string, boolean>>({ cash: true });
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofPreview, setProofPreview] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<"idle" | "snapshot" | "submitting" | "success" | "error">("idle");
  const [successOrderNumber, setSuccessOrderNumber] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const isSubmitting = useRef(false);

  useEffect(() => {
    async function load() {
      setIsLoading(true);
      try {
        const supabase = createClient();

        // Load products (existing logic)
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

        // Load payment settings (new logic)
        const { data: sData } = await supabase
          .from("system_settings")
          .select("*")
          .eq("key", "payment_methods_enabled")
          .single();
        if (sData?.value) {
          setEnabledPayments(sData.value);
          const enabled: string[] = [];
          Object.keys(sData.value).forEach((k) => {
            if (sData.value[k]) enabled.push(k);
          });
          if (enabled.length > 0) setPaymentMethod(enabled[0] as PaymentMethod);
        }
      } catch (err) {
        console.error("Failed to load products:", err);
        setProducts([]);
      } finally {
        setIsLoading(false);
      }
    }
    load();
  }, []);

  const setQty = (productId: string, qty: number) => {
    setQuantities((prev) => ({ ...prev, [productId]: qty }));
  };

  const cartItems = products.filter((p) => (quantities[p.id] ?? 0) > 0);
  const totalPrice = cartItems.reduce((sum, p) => sum + p.selling_price * (quantities[p.id] ?? 0), 0);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setProofFile(file);
    if (file) {
      const reader = new FileReader();
      reader.onload = () => setProofPreview(reader.result as string);
      reader.readAsDataURL(file);
    } else {
      setProofPreview(null);
    }
  };

  const handleSubmitClick = () => {
    if (cartItems.length === 0) return;
    if (!customerName.trim()) {
      alert("Please enter your name to proceed.");
      return;
    }
    setStatus("snapshot");
  };

  const finalSubmit = (blob: Blob | null) => {
    if (isSubmitting.current) return;
    isSubmitting.current = true;
    setStatus("submitting");

    startTransition(async () => {
      try {
        let snapshotUrl: string | null = null;
        let proofUrl: string | null = null;
        const supabase = createClient();

        if (blob) {
          const formData = new FormData();
          formData.append("file", new File([blob], "snapshot.jpg", { type: "image/jpeg" }));
          formData.append("bucket", "order-snapshots");
          
          const uploadRes = await adminUploadFile(formData);
          if (uploadRes.success && uploadRes.url) {
            snapshotUrl = uploadRes.url;
          } else {
            console.error("Snapshot upload failed:", uploadRes.error);
          }
        }

        if (proofFile) {
          const formData = new FormData();
          formData.append("file", proofFile);
          formData.append("bucket", "payment-proofs");
          
          const uploadRes = await adminUploadFile(formData);
          if (uploadRes.success && uploadRes.url) {
            proofUrl = uploadRes.url;
          } else {
            console.error("Proof upload failed:", uploadRes.error);
          }
        }

        const result = await submitOrder({
          items: cartItems.map((p) => ({ productId: p.id, qty: quantities[p.id] ?? 0 })),
          source: "cafe",
          paymentMethod,
          paymentProofUrl: proofUrl,
          orderSnapshotUrl: snapshotUrl,
          customerName: customerName.trim() || null,
        });

        if (result.success) {
          setStatus("success");
          setSuccessOrderNumber(result.orderNumber ?? null);
          setQuantities({});
          setProofFile(null);
          setProofPreview(null);
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
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">☕ Café Menu</h1>
        <p className="text-gray-500">Choose your drink, we&apos;ll prepare it fresh!</p>
      </div>

      {/* Loading Skeleton */}
      {isLoading && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 mb-8">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="card overflow-hidden">
              <Skeleton className="aspect-[4/3] w-full" />
              <div className="p-4 space-y-3">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-6 w-1/3" />
                <div className="flex justify-between items-center pt-2">
                  <Skeleton className="h-8 w-1/2 rounded-md" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Product Grid */}
      {!isLoading && (
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
                  <img src={getImageUrl(product.image_url) ?? ""} alt={product.name} className="w-full h-full object-cover" />
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
      )}

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
            <label className="block text-xs font-medium text-gray-500 mb-1">Your Name</label>
            <input
              type="text"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="e.g. Robi"
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300"
              maxLength={100}
            />
          </div>

          {/* Payment Method Selector */}
          <div className="mb-4 pt-4 border-t border-gray-100">
            <label className="text-xs font-medium text-gray-500 mb-2 block">Payment Method</label>
            <div className="flex gap-2">
              {ALL_PAYMENT_OPTIONS.filter(opt => enabledPayments[opt.value]).map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setPaymentMethod(opt.value)}
                  className={`flex-1 py-2 px-3 rounded-lg text-xs font-medium transition-all border ${paymentMethod === opt.value
                    ? "bg-amber-50 border-amber-300 text-amber-700"
                    : "bg-white border-gray-200 text-gray-500 hover:bg-gray-50"
                    }`}
                >
                  <span className="block text-lg mb-0.5">{opt.icon}</span>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          {/* QR Code Helper for GCash */}
          {paymentMethod === "gcash" && (
            <div className="mb-4 p-4 rounded-xl bg-amber-50 border border-amber-200 animate-slide-in">
              <p className="text-xs font-bold text-amber-800 mb-2 uppercase tracking-wider flex items-center gap-1.5">
                <span className="text-lg">🔳</span> Scan to Pay (GCash)
              </p>
              <div className="aspect-square w-full max-w-[320px] mx-auto bg-white rounded-lg p-2 shadow-sm border border-amber-100 overflow-hidden">
                <img
                  src="/gcashqr.jpeg"
                  alt="GCash QR Code"
                  className="w-full h-full object-contain"
                />
              </div>
              <p className="text-[11px] text-amber-700 mt-3 text-center font-medium leading-relaxed bg-amber-100/40 p-2.5 rounded-lg border border-amber-200/50 shadow-sm mx-1">
                Get ready to take a fun selfie with your payment proof! 📸 <br/> 
                After paying, click <strong className="text-amber-900 font-bold">Submit Order</strong> or message us your proof at <a href="https://www.facebook.com/StartupLabAI" target="_blank" rel="noopener noreferrer" className="underline font-bold text-amber-900 hover:text-amber-700 transition-colors">StartupLabAI</a> ✨
              </p>
            </div>
          )}

          {/* Payment Proof */}
          {paymentMethod !== "cash" && (
            <div className="mb-4">
              <label className="text-xs font-medium text-gray-500 mb-2 block">Payment Proof (optional)</label>
              <input
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                className="block w-full text-[10px] text-gray-500 file:mr-4 file:py-1.5 file:px-3 file:rounded-lg file:border file:border-gray-200 file:bg-gray-50 file:text-gray-700 file:text-xs file:font-medium hover:file:bg-gray-100 cursor-pointer"
              />
              {proofPreview && (
                <div className="mt-3 relative inline-block">
                  <img src={proofPreview} alt="" className="h-16 rounded-lg border border-gray-200" />
                  <button
                    onClick={() => { setProofFile(null); setProofPreview(null); }}
                    className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center transform scale-75"
                  >×</button>
                </div>
              )}
            </div>
          )}

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
