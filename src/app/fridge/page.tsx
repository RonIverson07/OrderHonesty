"use client";

import { useState, useEffect, useTransition, useRef } from "react";
import ProductCard from "@/components/ProductCard";
import OrderSnapshot from "@/components/OrderSnapshot";
import { createClient } from "@/lib/supabase/browser";
import { submitOrder } from "@/lib/domain/orders";
import { formatCurrency } from "@/lib/utils";
import type { ProductWithStock, PaymentMethod } from "@/lib/types";

const ALL_PAYMENT_OPTIONS: { value: PaymentMethod; label: string; icon: string }[] = [
  { value: "cash", label: "Cash", icon: "💵" },
  { value: "gcash", label: "GCash", icon: "📱" },
  { value: "qr_code", label: "QR Code", icon: "🔳" },
  { value: "bank_transfer", label: "Bank Transfer", icon: "🏦" },
  { value: "hitpay", label: "HitPay", icon: "💳" },
];

export default function FridgePage() {
  const [products, setProducts] = useState<ProductWithStock[]>([]);
  const [enabledPayments, setEnabledPayments] = useState<Record<string, boolean>>({ cash: true });
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofPreview, setProofPreview] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<"idle" | "snapshot" | "submitting" | "success" | "error">("idle");
  const [snapshotBlob, setSnapshotBlob] = useState<Blob | null>(null);
  const [successOrderNumber, setSuccessOrderNumber] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [customerName, setCustomerName] = useState("");
  const isSubmitting = useRef(false);

  useEffect(() => {
    async function load() {
      try {
        const supabase = createClient();

        // Load products
        const { data: pData, error: pError } = await supabase
          .from("products")
          .select("*, retail_stock(*)")
          .eq("type", "retail")
          .eq("active", true)
          .order("name");
        if (pError) throw pError;
        setProducts(
          (pData ?? []).map((p: ProductWithStock & { retail_stock: unknown }) => ({
            ...p,
            retail_stock: Array.isArray(p.retail_stock) ? p.retail_stock[0] ?? null : p.retail_stock,
          }))
        );

        // Load payment settings
        const { data: sData } = await supabase
          .from("system_settings")
          .select("*")
          .eq("key", "payment_methods_enabled")
          .single();
        if (sData?.value) {
          setEnabledPayments(sData.value);
          // Set default payment to the first enabled one
          const firstEnabled = Object.keys(sData.value).find(k => sData.value[k]);
          if (firstEnabled) setPaymentMethod(firstEnabled as PaymentMethod);
        }
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

  // Step 1: User clicks submit → show snapshot
  const handleSubmitClick = () => {
    if (cartItems.length === 0) return;
    if (!customerName.trim()) {
      alert("Please enter your name to proceed.");
      return;
    }
    setStatus("snapshot");
  };

  // Step 2: After snapshot captured/skipped → submit order
  const finalSubmit = (blob: Blob | null) => {
    if (isSubmitting.current) return;
    isSubmitting.current = true;
    setSnapshotBlob(blob);
    setStatus("submitting");

    startTransition(async () => {
      try {
        let proofUrl: string | null = null;
        let snapshotUrl: string | null = null;

        const supabase = createClient();

        if (proofFile) {
          const ext = proofFile.name.split(".").pop() ?? "jpg";
          const fileName = `${crypto.randomUUID()}.${ext}`;
          await supabase.storage.from("payment-proofs").upload(fileName, proofFile);
          const { data: urlData } = supabase.storage.from("payment-proofs").getPublicUrl(fileName);
          proofUrl = urlData.publicUrl;
        }

        if (blob) {
          const fileName = `${crypto.randomUUID()}.jpg`;
          await supabase.storage.from("order-snapshots").upload(fileName, blob);
          const { data: urlData } = supabase.storage.from("order-snapshots").getPublicUrl(fileName);
          snapshotUrl = urlData.publicUrl;
        }

        const result = await submitOrder({
          items: cartItems.map((p) => ({ productId: p.id, qty: quantities[p.id] ?? 0 })),
          source: "fridge",
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
          setErrorMsg(result.error ?? "Failed to submit order");
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
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-1">🧊 Fridge & Honesty Store</h1>
        <p className="text-gray-500">Grab what you need, select your payment method, and go!</p>
      </div>

      {/* Product Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 mb-8">
        {products.filter(p => (p.retail_stock?.stock ?? 0) > 0).map((product) => (
          <ProductCard
            key={product.id}
            product={product}
            qty={quantities[product.id] ?? 0}
            onQtyChange={(q) => setQty(product.id, q)}
            showStock
          />
        ))}
      </div>

      {/* Cart Summary & Payment */}
      {cartItems.length > 0 && (
        <div className="card p-6 animate-slide-in">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Order Summary</h2>

          <div className="space-y-2 mb-4">
            {cartItems.map((p) => (
              <div key={p.id} className="flex justify-between text-sm text-gray-600">
                <span>{p.name} × {quantities[p.id]}</span>
                <span className="font-medium">{formatCurrency(p.selling_price * (quantities[p.id] ?? 0))}</span>
              </div>
            ))}

            {/* V3: Customer Name */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Your Name</label>
              <input
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="e.g. Robi"
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300"
                maxLength={100}
              />
            </div>

            <div className="pt-4 border-t border-gray-100 flex items-center justify-between mb-4">
              <span className="text-base font-semibold text-gray-900">Total Selection</span>
              <span className="text-xl font-bold text-amber-600">{formatCurrency(totalPrice)}</span>
            </div>
          </div>

          {/* Payment Method */}
          <div className="mb-4">
            <label className="text-sm text-gray-500 mb-2 block">Payment Method</label>
            <div className="flex gap-2">
              {ALL_PAYMENT_OPTIONS.filter(opt => enabledPayments[opt.value]).map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setPaymentMethod(opt.value)}
                  className={`flex-1 py-2.5 px-3 rounded-lg text-sm font-medium transition-all border ${paymentMethod === opt.value
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
              <div className="w-full max-w-[350px] mx-auto bg-white rounded-lg p-2 shadow-sm border border-amber-100 overflow-hidden">
                <img
                  src="/gcashqr.jpeg"
                  alt="GCash QR Code"
                  className="w-full h-auto object-contain"
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
              <label className="text-sm text-gray-500 mb-2 block">Payment Proof (optional)</label>
              <input
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border file:border-gray-200 file:bg-gray-50 file:text-gray-700 file:text-sm file:font-medium hover:file:bg-gray-100 cursor-pointer"
              />
              {proofPreview && (
                <div className="mt-3 relative inline-block">
                  <img src={proofPreview} alt="" className="h-20 rounded-lg border border-gray-200" />
                  <button
                    onClick={() => { setProofFile(null); setProofPreview(null); }}
                    className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center"
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
            {status === "submitting" ? "Submitting..." : `Submit Order — ${formatCurrency(totalPrice)}`}
          </button>
        </div>
      )}

      {/* Snapshot Modal */}
      {status === "snapshot" && (
        <OrderSnapshot
          onCapture={(blob) => finalSubmit(blob)}
          onSkip={() => finalSubmit(null)}
        />
      )}

      {/* Success */}
      {status === "success" && (
        <div className="mt-6 p-6 rounded-xl bg-emerald-50 border border-emerald-200 text-center animate-slide-in">
          <div className="text-lg font-semibold text-emerald-700 mb-1">✅ Order Submitted!</div>
          {successOrderNumber && (
            <div className="text-3xl font-bold text-emerald-600 mb-1">{successOrderNumber}</div>
          )}
          <p className="text-sm text-emerald-600/70">Thank you for your honesty! 🙏</p>
          <button onClick={() => setStatus("idle")} className="mt-3 text-sm text-emerald-600 underline">
            New Order
          </button>
        </div>
      )}

      {/* Error */}
      {status === "error" && (
        <div className="mt-6 p-4 rounded-xl bg-red-50 border border-red-200 text-center animate-slide-in">
          <p className="text-red-700">❌ {errorMsg}</p>
          <button onClick={() => setStatus("idle")} className="mt-2 text-sm text-red-600 underline">Dismiss</button>
        </div>
      )}
    </div>
  );
}
