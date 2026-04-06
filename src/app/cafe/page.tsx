"use client";

import { useState, useEffect, useTransition, useRef } from "react";
import OrderSnapshot from "@/components/OrderSnapshot";
import CafeProductCard from "@/components/CafeProductCard";
import Skeleton from "@/components/Skeleton";
import { createClient } from "@/lib/supabase/browser";
import { submitOrder, adminUploadFile } from "@/lib/domain/orders";
import { formatCurrency } from "@/lib/utils";
import type { CafeProductAvailability, PaymentMethod } from "@/lib/types";
import { Coffee, Banknote, Smartphone, QrCode, Landmark, CreditCard, Keyboard, Lightbulb, CheckSquare, ChevronRight } from "lucide-react";

const ALL_PAYMENT_OPTIONS: { value: PaymentMethod; label: string; icon: React.ReactNode }[] = [
  { value: "cash", label: "Cash", icon: <Banknote className="w-5 h-5 text-green-600" /> },
  { value: "gcash", label: "GCash", icon: <Smartphone className="w-5 h-5 text-blue-600" /> },
  { value: "qr_code", label: "QR Code", icon: <QrCode className="w-5 h-5 text-gray-800" /> },
  { value: "bank_transfer", label: "Bank Transfer", icon: <Landmark className="w-5 h-5 text-indigo-600" /> },
  { value: "hitpay", label: "HitPay", icon: <CreditCard className="w-5 h-5 text-purple-600" /> },
];

export default function CafePage() {
  const [products, setProducts] = useState<CafeProductAvailability[]>([]);
  const [enabledPayments, setEnabledPayments] = useState<Record<string, boolean>>({ cash: true });
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofPreview, setProofPreview] = useState<string | null>(null);
  const proofInputRef = useRef<HTMLInputElement | null>(null);
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<"idle" | "snapshot" | "submitting" | "success" | "error">("idle");
  const [successOrderNumber, setSuccessOrderNumber] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const isSubmitting = useRef(false);
  const productScrollRef = useRef<HTMLDivElement>(null);
  const skeletonScrollRef = useRef<HTMLDivElement>(null);

  // 3-step UX flow
  const [step, setStep] = useState<"products" | "summary" | "payment">("products");
  const [successCountdown, setSuccessCountdown] = useState(5);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (status === "success") {
      setSuccessCountdown(5);
      timer = setInterval(() => {
        setSuccessCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(timer);
            setStatus("idle");
            setStep("products");
            setQuantities({});
            setCustomerName("");
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [status]);

  useEffect(() => {
    async function load() {
      setIsLoading(true);
      try {
        const supabase = createClient();

        const { data: productsData, error: prodError } = await supabase
          .from("products").select("*, retail_stock(*)").eq("type", "cafe").eq("active", true).order("name");
        if (prodError) throw prodError;

        const productIds = (productsData ?? []).map((p: { id: string }) => p.id);
        let recipes: any[] = [];
        try {
          const { data: rd, error: re } = await supabase
            .from("recipes").select("*, ingredients(*)").in("product_id", productIds);
          if (!re) recipes = rd ?? [];
        } catch (e) {
          console.warn("Recipes fetch error:", e);
        }

        const withAvailability: CafeProductAvailability[] = (productsData ?? []).map(
          (product: CafeProductAvailability & { retail_stock?: any }) => {
            const myRecipes = recipes.filter((r: { product_id: string }) => r.product_id === product.id);
            if (myRecipes.length === 0) {
              const rStockVal = Array.isArray(product.retail_stock) ? product.retail_stock[0]?.stock : product.retail_stock?.stock;
              const directStock = rStockVal ?? 0;
              return { ...product, available: directStock > 0, max_servings: directStock };
            }
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

        const { data: sData } = await supabase
          .from("system_settings").select("*").eq("key", "payment_methods_enabled").single();
        if (sData?.value) {
          setEnabledPayments(sData.value);
          const enabled: string[] = [];
          Object.keys(sData.value).forEach((k) => { if (sData.value[k]) enabled.push(k); });
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

  useEffect(() => {
    if (paymentMethod === "cash" || paymentMethod === "gcash") {
      setProofFile(null);
      setProofPreview(null);
      if (proofInputRef.current) proofInputRef.current.value = "";
    }
  }, [paymentMethod]);

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
          if (uploadRes.success && uploadRes.url) snapshotUrl = uploadRes.url;
          else console.error("Snapshot upload failed:", uploadRes.error);
        }

        if (proofFile) {
          const formData = new FormData();
          formData.append("file", proofFile);
          formData.append("bucket", "payment-proofs");
          const uploadRes = await adminUploadFile(formData);
          if (uploadRes.success && uploadRes.url) proofUrl = uploadRes.url;
          else console.error("Proof upload failed:", uploadRes.error);
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
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Coffee className="w-8 h-8 text-amber-700" /> Café Menu
        </h1>
        <p className="text-gray-500">Choose your drink, we&apos;ll prepare it fresh!</p>
      </div>

      {/* Step 1: Product Selection */}
      <div className={`${step === "products" ? "block" : "hidden"} 2xl:block`}>
        {isLoading && (
          <div className="relative group">
            <div 
              ref={skeletonScrollRef}
              className="flex overflow-x-auto snap-x snap-mandatory 2xl:grid 2xl:grid-cols-4 gap-4 pb-4 -mx-4 px-4 sm:mx-0 sm:px-0 hide-scrollbar items-stretch 2xl:pb-0"
            >
              {[...Array(4)].map((_, i) => (
                <div key={i} className="card overflow-hidden snap-start min-w-[220px] md:min-w-[260px] 2xl:min-w-0 2xl:w-auto shrink-0 2xl:shrink">
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
            {/* Scroll Indicator */}
            <div className="absolute right-0 top-0 bottom-4 w-12 bg-gradient-to-l from-white/60 via-white/40 to-transparent pointer-events-none flex items-center justify-end px-2 2xl:hidden">
              <button 
                onClick={() => skeletonScrollRef.current?.scrollBy({ left: 300, behavior: "smooth" })}
                className="bg-white/90 p-1.5 rounded-full shadow-md border border-gray-100 pointer-events-auto active:scale-90 transition-all animate-pulse"
              >
                <ChevronRight className="w-5 h-5 text-amber-700" />
              </button>
            </div>
          </div>
        )}

        {!isLoading && (
          <div className="relative group">
            <div 
              ref={productScrollRef}
              className="flex overflow-x-auto snap-x snap-mandatory 2xl:grid 2xl:grid-cols-4 gap-4 pb-4 -mx-4 px-4 sm:mx-0 sm:px-0 hide-scrollbar items-stretch 2xl:pb-0"
            >
              {products.filter(p => p.available && (p.max_servings === undefined || p.max_servings > 0)).map((product) => (
                <div key={product.id} className="snap-start w-[220px] md:w-[260px] 2xl:w-auto shrink-0 2xl:shrink">
                  <CafeProductCard
                    product={product}
                    qty={quantities[product.id] ?? 0}
                    onQtyChange={(qty) => setQty(product.id, qty)}
                  />
                </div>
              ))}
            </div>
            {/* Scroll Indicator */}
            <div className="absolute right-0 top-0 bottom-4 w-12 bg-gradient-to-l from-white/60 via-white/40 to-transparent pointer-events-none flex items-center justify-end px-2 2xl:hidden">
              <button 
                onClick={() => productScrollRef.current?.scrollBy({ left: 300, behavior: "smooth" })}
                className="bg-white/90 p-1.5 rounded-full shadow-md border border-gray-100 pointer-events-auto active:scale-90 transition-all animate-pulse"
              >
                <ChevronRight className="w-5 h-5 text-amber-700" />
              </button>
            </div>
          </div>
        )}

        {cartItems.length > 0 && (
          <div className="mt-4 md:mt-6 flex justify-end animate-slide-in 2xl:hidden">
            <button
              onClick={() => setStep("summary")}
              className="btn-primary py-4 px-8 text-lg w-full md:w-auto shadow-xl flex items-center justify-center gap-2"
            >
              Next: Review Order ({cartItems.length} items)
            </button>
          </div>
        )}

        <style dangerouslySetInnerHTML={{ __html: `
          .hide-scrollbar::-webkit-scrollbar { display: none; }
          .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        `}} />
      </div>

      {/* Step 2: Order Summary — items + name + choose payment method */}
      {cartItems.length > 0 && (
        <div className={`card p-5 md:p-6 lg:p-8 animate-slide-in max-w-5xl mx-auto shadow-2xl xl:shadow-sm border-gray-200 ${step === "summary" ? "block mt-4 md:mt-8" : "hidden"} 2xl:block xl:max-w-3xl xl:mt-8`}>

          <div className="flex items-center justify-between mb-5 md:mb-6 border-b pb-4">
            <h2 className="text-xl md:text-2xl font-black text-gray-900 tracking-tight">Your Order</h2>
            <button
              onClick={() => setStep("products")}
              className="2xl:hidden px-4 md:px-5 py-2 md:py-2.5 bg-gray-100 hover:bg-gray-200 active:scale-95 transition-all rounded-xl text-sm md:text-base font-bold text-gray-700 flex items-center gap-2"
            >
              <span>←</span> Back
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12">

            {/* Left: Items & Total */}
            <div className="flex flex-col space-y-5 md:space-y-6">
              <div className="space-y-2 md:space-y-3">
                {cartItems.map((p) => (
                  <div key={p.id} className="flex justify-between text-base text-gray-700">
                    <span className="font-medium">{p.name} <span className="text-gray-400 mx-1">×</span> <span className="font-bold text-gray-900">{quantities[p.id]}</span></span>
                    <span className="font-bold text-gray-900">{formatCurrency(p.selling_price * (quantities[p.id] ?? 0))}</span>
                  </div>
                ))}
              </div>

              <div className="pt-4 border-t border-gray-200 flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <span className="text-lg md:text-xl font-bold text-gray-900">Total Selection</span>
                  <span className="text-2xl md:text-3xl font-black text-amber-600">{formatCurrency(totalPrice)}</span>
                </div>

                <div className="bg-gray-50/80 p-3.5 rounded-2xl border border-gray-200/60 shadow-sm">
                  <label className="block text-sm font-bold text-gray-700 mb-2">Customer Name</label>
                  <div className="flex gap-1.5">
                    <input
                      id="customer-name-input"
                      type="text"
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      placeholder="e.g. Robi"
                      className="flex-1 px-3 py-3 rounded-xl border border-gray-300 text-base font-medium focus:outline-none focus:ring-2 focus:ring-amber-500 bg-white shadow-sm"
                      maxLength={100}
                    />
                    <button
                      type="button"
                      onClick={() => document.getElementById("customer-name-input")?.blur()}
                      className="px-3 py-3 bg-white border border-gray-300 text-gray-700 rounded-xl text-sm font-bold hover:bg-gray-50 flex items-center gap-2 active:scale-95 transition-all shadow-sm outline-none"
                    >
                      <Keyboard className="w-5 h-5 text-gray-500" />
                      <span className="hidden xl:inline">Hide</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Right: Payment Method Selector + Next */}
            <div className="flex flex-col border-t md:border-t-0 md:border-l xl:border-l-0 xl:border-t border-gray-100 pt-5 md:pt-0 md:pl-8 lg:pl-12 xl:pl-0 xl:pt-6">

              <div className="mb-5 flex-1">
                <label className="text-sm font-bold text-gray-700 mb-3 block">How will you pay?</label>
                <div className="flex flex-wrap gap-2 md:gap-3">
                  {ALL_PAYMENT_OPTIONS.filter(opt => enabledPayments[opt.value]).map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => {
                        if (!customerName.trim()) {
                          alert("Please enter your name to proceed.");
                          return;
                        }
                        setPaymentMethod(opt.value);
                        if (opt.value === "cash") {
                           handleSubmitClick();
                        } else {
                           setStep("payment");
                        }
                      }}
                      className="flex flex-col items-center justify-center flex-1 min-w-[80px] py-4 md:py-6 px-2 rounded-2xl text-xs md:text-sm font-bold transition-all border-2 shadow-sm bg-white border-gray-200 text-gray-600 hover:bg-gray-50 hover:border-gray-300 active:bg-gray-100 active:scale-95"
                    >
                      <span className="mb-2 text-3xl md:text-4xl">{opt.icon}</span>
                      {opt.label}
                    </button>
                  ))}
                </div>
                <div className="mt-4 p-3 bg-blue-50 border border-blue-100 rounded-xl flex gap-2 items-start">
                  <Lightbulb className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
                  <p className="text-[11px] md:text-xs text-blue-700 font-medium leading-snug">
                    <strong>Tip:</strong> Selecting <strong>Cash</strong> will instantly open the camera for a quick verification selfie. Selecting <strong>GCash</strong> will proceed to the next page to show the GCash QR code.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Step 3: Payment Page — two-column no-scroll layout */}
      {cartItems.length > 0 && step === "payment" && (
        <div className="card p-3 md:p-4 animate-slide-in max-w-3xl mx-auto shadow-2xl border-gray-200 mt-0">

          {/* Header */}
          <div className="flex items-center justify-between mb-2 border-b pb-2">
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1.5 bg-blue-600 text-white px-3 py-1 rounded-full text-sm font-black shadow-md">
                <Smartphone className="w-4 h-4" /> GCash Payment
              </span>
            </div>
            <button
              onClick={() => setStep("summary")}
              className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 active:scale-95 transition-all rounded-xl text-sm font-bold text-gray-700 flex items-center gap-1.5"
            >
              <span>←</span> Back
            </button>
          </div>

          {/* GCash QR — full width, maximized for scanning */}
          <div className="flex flex-col max-w-xl mx-auto gap-2">
            <div className="rounded-2xl bg-white border-2 border-blue-100 overflow-hidden shadow-sm p-1">
              <img
                src="/newqr.jpg"
                alt="GCash QR Code"
                className="w-full object-contain mix-blend-multiply"
                style={{ maxHeight: "38vh" }}
              />
            </div>

            <div className="text-center">
              <p className="text-xs text-gray-500 font-medium leading-none mb-1">Scan & pay exactly</p>
              <p className="text-2xl md:text-3xl font-black text-blue-700 tabular-nums leading-none">{formatCurrency(totalPrice)}</p>
            </div>

            <button
              onClick={handleSubmitClick}
              disabled={isPending || status === "submitting"}
              className="w-full py-2.5 shadow-xl text-lg font-black rounded-2xl transition-all active:scale-95 bg-sky-400 hover:bg-sky-500 text-white shadow-sky-400/30 flex justify-center items-center gap-2"
            >
              {status === "submitting" ? (
                 "Submitting..."
               ) : (
                 <>
                   <CheckSquare fill="#22c55e" color="white" className="w-6 h-6" />
                   <span>Done paying — Submit Order</span>
                 </>
               )}
            </button>
            <p className="text-[10px] text-center text-gray-500 font-medium -mt-1 leading-tight">
              Tap only after your payment is complete. The camera will instantly open for a quick verification selfie.
            </p>
          </div>
        </div>
      )}

      {/* Snapshot */}
      {status === "snapshot" && (
        <OrderSnapshot onCapture={(blob) => finalSubmit(blob)} onSkip={() => finalSubmit(null)} />
      )}

      {/* Success */}
      {status === "success" && (
        <div className="mt-6 p-10 rounded-2xl bg-emerald-50 border border-emerald-200 text-center animate-slide-in max-w-2xl mx-auto shadow-sm">
          <div className="text-2xl font-black text-emerald-700 mb-2 flex items-center justify-center gap-2">
            <span className="text-3xl">✅</span> Order Placed!
          </div>
          {successOrderNumber && (
            <div className="text-5xl font-black text-emerald-600 mb-4 tracking-tight">{successOrderNumber}</div>
          )}
          <p className="text-lg text-emerald-700/80 font-medium mb-8">Head to the counter — your drink will be ready soon! ☕</p>

          <div className="inline-flex rounded-full bg-emerald-100 text-emerald-800 px-6 py-2 text-sm font-bold animate-pulse">
            Resetting in {successCountdown}s...
          </div>

          <div className="mt-8">
            <button
              onClick={() => {
                setStatus("idle");
                setStep("products");
                setQuantities({});
                setCustomerName("");
              }}
              className="w-full sm:w-auto inline-flex justify-center items-center px-8 py-4 bg-emerald-600 text-white rounded-xl font-bold shadow-xl shadow-emerald-600/20 hover:bg-emerald-700 active:scale-95 transition-all text-lg"
            >
              Start New Order Now
            </button>
          </div>
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
