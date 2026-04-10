"use client";

import { useState, useEffect, useTransition, useRef } from "react";
import ProductCard from "@/components/ProductCard";
import OrderSnapshot from "@/components/OrderSnapshot";
import Skeleton from "@/components/Skeleton";
import { createClient } from "@/lib/supabase/browser";
import { submitOrder, adminUploadFile } from "@/lib/domain/orders";
import { formatCurrency } from "@/lib/utils";
import type { ProductWithStock, PaymentMethod } from "@/lib/types";
import { Snowflake, Banknote, Smartphone, QrCode, Landmark, CreditCard, Keyboard, Lightbulb, CheckSquare, ChevronRight, User, AlertCircle, X } from "lucide-react";

const ALL_PAYMENT_OPTIONS: { value: PaymentMethod; label: string; icon: React.ReactNode }[] = [
  { value: "cash", label: "Cash", icon: <Banknote className="w-5 h-5 text-green-600" /> },
  { value: "gcash", label: "GCash", icon: <Smartphone className="w-5 h-5 text-blue-600" /> },
  { value: "qr_code", label: "QR Code", icon: <QrCode className="w-5 h-5 text-gray-800" /> },
  { value: "bank_transfer", label: "Bank Transfer", icon: <Landmark className="w-5 h-5 text-indigo-600" /> },
  { value: "hitpay", label: "HitPay", icon: <CreditCard className="w-5 h-5 text-purple-600" /> },
];

export default function FridgePage() {
  const [products, setProducts] = useState<ProductWithStock[]>([]);
  const [enabledPayments, setEnabledPayments] = useState<Record<string, boolean>>({ cash: true });
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofPreview, setProofPreview] = useState<string | null>(null);
  const proofInputRef = useRef<HTMLInputElement | null>(null);
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<"idle" | "snapshot" | "submitting" | "success" | "error">("idle");
  const productScrollRef = useRef<HTMLDivElement>(null);
  const skeletonScrollRef = useRef<HTMLDivElement>(null);
  const [snapshotBlob, setSnapshotBlob] = useState<Blob | null>(null);
  const [successOrderNumber, setSuccessOrderNumber] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const isSubmitting = useRef(false);
  const [showNameModal, setShowNameModal] = useState(false);

  // V3: UX Step Flow
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
          const enabled: string[] = [];
          Object.keys(sData.value).forEach((k) => {
            if (sData.value[k]) enabled.push(k);
          });
          if (enabled.length > 0) setPaymentMethod(enabled[0] as PaymentMethod);
        }
      } catch (err) {
        console.error("Failed to load products:", err);
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
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Snowflake className="w-8 h-8 text-blue-500" /> Fridge & Honesty Store
        </h1>
        <p className="text-gray-500">Grab what you need, select your payment method, and go!</p>
      </div>

      <div className={`${step === "products" ? "block" : "hidden"} 2xl:block`}>
        {isLoading && (
          <div className="relative group">
            <div 
              ref={skeletonScrollRef}
              className="flex overflow-x-auto snap-x snap-mandatory 2xl:grid 2xl:grid-cols-4 gap-4 pb-4 -mx-4 px-4 sm:mx-0 sm:px-0 hide-scrollbar items-stretch 2xl:pb-0"
            >
              {[...Array(4)].map((_, i) => (
                <div key={i} className="card overflow-hidden snap-start min-w-[220px] md:min-w-[260px] xl:min-w-0 xl:w-auto shrink-0 xl:shrink">
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
                <ChevronRight className="w-5 h-5 text-blue-500" />
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
              {products.filter(p => (p.retail_stock?.stock ?? 0) > 0).map((product) => (
                <div key={product.id} className="snap-start w-[220px] md:w-[260px] 2xl:w-auto shrink-0 2xl:shrink">
                  <ProductCard
                    product={product}
                    qty={quantities[product.id] ?? 0}
                    onQtyChange={(q) => setQty(product.id, q)}
                    showStock
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
                <ChevronRight className="w-5 h-5 text-blue-500" />
              </button>
            </div>
          </div>
        )}

        {cartItems.length > 0 && (
          <div className="mt-4 md:mt-6 flex justify-end animate-slide-in 2xl:hidden">
            <button
              onClick={() => setStep("summary")}
              className="btn-primary py-4 px-8 text-lg w-full md:w-auto shadow-xl"
            >
              Review Order
            </button>
          </div>
        )}

        <style dangerouslySetInnerHTML={{
          __html: `
          .hide-scrollbar::-webkit-scrollbar { display: none; }
          .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        `}} />
      </div>

      {/* Step 2: Order Summary — items + name + choose payment method */}
      {cartItems.length > 0 && (
        <div className={`card p-5 md:p-6 lg:p-8 animate-slide-in max-w-6xl mx-auto shadow-2xl xl:shadow-sm border-gray-200 ${step === "summary" ? "block" : "hidden"} 2xl:block 2xl:max-w-7xl xl:mt-8`}>

          <div className="flex items-center justify-between mb-5 md:mb-6 border-b pb-4">
            <h2 className="text-xl md:text-2xl font-black text-gray-900 tracking-tight">Order Summary</h2>
            <button
              onClick={() => setStep("products")}
              className="2xl:hidden px-4 md:px-5 py-2 md:py-2.5 bg-gray-100 hover:bg-gray-200 active:scale-95 transition-all rounded-xl text-sm md:text-base font-bold text-gray-700 flex items-center gap-2"
            >
              <span>←</span> Back
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12">

            {/* Left Column: Items & Total */}
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

                <div className="bg-gray-50/80 p-4 rounded-2xl border border-gray-200/60 shadow-sm transition-all duration-300 hover:shadow-md">
                  <label className="block text-[10px] font-black text-gray-400 mb-2 uppercase tracking-[0.2em]">Customer Name</label>
                  <div className="flex gap-2 items-center max-w-lg">
                    <input
                      id="customer-name-input"
                      type="text"
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      placeholder="Enter your name..."
                      className="flex-1 px-5 py-3.5 rounded-2xl border border-gray-200 text-lg font-bold text-gray-900 placeholder:text-gray-300 focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 bg-white transition-all shadow-sm"
                      maxLength={100}
                    />
                    <button
                      type="button"
                      onClick={() => document.getElementById("customer-name-input")?.blur()}
                      className="p-3.5 bg-white border border-gray-200 text-gray-400 rounded-2xl text-xs font-black hover:bg-gray-50 hover:text-gray-600 flex items-center justify-center active:scale-90 transition-all shadow-sm outline-none"
                    >
                      <Keyboard className="w-5 h-5" />
                      <span className="hidden 2xl:inline ml-2">HIDE</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Column: Payment Method Selector + Next */}
            <div className="flex flex-col border-t md:border-t-0 md:border-l xl:border-l-0 xl:border-t border-gray-100 pt-5 md:pt-0 md:pl-8 lg:pl-12 xl:pl-0 xl:pt-6">

              <div className="mb-5 flex-1">
                <label className="text-sm font-bold text-gray-700 mb-3 block">How will you pay?</label>
                <div className="flex flex-wrap gap-2 md:gap-3">
                  {ALL_PAYMENT_OPTIONS.filter(opt => enabledPayments[opt.value]).map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => {
                        if (!customerName.trim()) {
                          setShowNameModal(true);
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

      {/* Step 3: Dedicated Payment Page — no-scroll two-column layout */}
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

      {/* Snapshot Modal */}
      {status === "snapshot" && (
        <OrderSnapshot
          onCapture={(blob) => finalSubmit(blob)}
          onSkip={() => finalSubmit(null)}
        />
      )}

      {/* Submitting Overlay */}
      {status === "submitting" && (
        <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-white/90 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-16 h-16 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin mb-6 shadow-sm"></div>
          <h3 className="text-2xl md:text-3xl font-black text-gray-900 tracking-tight mb-2 text-center px-4">Processing your order...</h3>
          <p className="text-gray-500 font-medium text-center px-4">Please wait while we securely post your transaction.</p>
        </div>
      )}

      {/* Success */}
      {status === "success" && (
        <div className="mt-6 p-10 rounded-2xl bg-emerald-50 border border-emerald-200 text-center animate-slide-in max-w-2xl mx-auto shadow-sm">
          <div className="text-2xl font-black text-emerald-700 mb-2 flex items-center justify-center gap-2">
            <span className="text-3xl">✅</span> Order Submitted!
          </div>
          {successOrderNumber && (
            <div className="text-5xl font-black text-emerald-600 mb-4 tracking-tight">{successOrderNumber}</div>
          )}
          <p className="text-lg text-emerald-700/80 font-medium mb-8">Thank you for your honesty! 🙏</p>

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

      {/* Error */}
      {status === "error" && (
        <div className="mt-6 p-4 rounded-xl bg-red-50 border border-red-200 text-center animate-slide-in">
          <p className="text-red-700">❌ {errorMsg}</p>
          <button onClick={() => setStatus("idle")} className="mt-2 text-sm text-red-600 underline">Dismiss</button>
        </div>
      )}
      {/* Custom Name Warning Modal */}
      {showNameModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 animate-in fade-in duration-300">
          <div className="absolute inset-0 bg-gray-900/40 backdrop-blur-md" onClick={() => setShowNameModal(false)} />
          <div className="relative bg-white rounded-[2rem] shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 slide-in-from-bottom-10 duration-500">
            <div className="p-8 text-center">
              <div className="w-20 h-20 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-6">
                <AlertCircle className="w-10 h-10 text-blue-500" />
              </div>
              <h3 className="text-2xl font-black text-gray-900 mb-2">Wait a second!</h3>
              <p className="text-gray-600 font-medium mb-8">Please enter your name so we know whose drink this is.</p>
              <button
                onClick={() => {
                  setShowNameModal(false);
                  setTimeout(() => document.getElementById("customer-name-input")?.focus(), 100);
                }}
                className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-black text-lg shadow-xl shadow-blue-500/20 active:scale-95 transition-all outline-none"
              >
                Got it!
              </button>
            </div>
            <button 
              onClick={() => setShowNameModal(false)}
              className="absolute top-4 right-4 p-2 text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X className="w-6 h-6" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
