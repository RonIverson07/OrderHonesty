"use client";

import { useState } from "react";
import { formatCurrency, getImageUrl } from "@/lib/utils";
import type { ProductWithStock } from "@/lib/types";

interface ProductCardProps {
  product: ProductWithStock;
  qty: number;
  onQtyChange: (qty: number) => void;
  showStock?: boolean;
  disabled?: boolean;
  unavailableReason?: string;
}

export default function ProductCard({
  product,
  qty,
  onQtyChange,
  showStock = false,
  disabled = false,
  unavailableReason,
}: ProductCardProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalQty, setModalQty] = useState(0);

  // Image click: add +1 directly (no modal)
  const handleImageClick = () => {
    if (isDisabled) return;
    const next = maxQty !== undefined ? Math.min(maxQty, qty + 1) : qty + 1;
    onQtyChange(next);
  };

  const openModal = () => {
    setModalQty(qty > 0 ? qty : 1);
    setIsModalOpen(true);
  };

  const handleApplyOrder = () => {
    onQtyChange(modalQty);
    setIsModalOpen(false);
  };
  const stock = product.retail_stock?.stock ?? null;
  const isOutOfStock = showStock && stock !== null && stock <= 0;
  const isDisabled = disabled || isOutOfStock;
  const maxQty = showStock && stock !== null ? stock : undefined;

  return (
    <div
      className={`card overflow-hidden h-full flex flex-col animate-slide-in ${isDisabled ? "opacity-60" : ""
        }`}
    >
      {/* Image Container — click to add +1 */}
      <div
        className={`aspect-[4/3] bg-gradient-to-br from-amber-50 to-orange-50 relative overflow-hidden ${isDisabled ? "cursor-not-allowed" : "cursor-pointer group"
          }`}
        onClick={handleImageClick}
      >
        {product.image_url ? (
          <>
            <img
              src={getImageUrl(product.image_url) ?? ""}
              alt={product.name}
              className="w-full h-full object-contain p-2 group-hover:scale-110 transition-transform duration-500"
            />
            {/* Hover overlay: tap to add */}
            {!isDisabled && (
              <div className="absolute inset-0 bg-black/15 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <span className="bg-white/95 text-gray-800 w-11 h-11 flex items-center justify-center rounded-full shadow-lg text-2xl font-bold leading-none">
                  +
                </span>
              </div>
            )}
          </>
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-4xl opacity-40">
              {product.type === "cafe" ? "☕" : "🧊"}
            </span>
          </div>
        )}

        {/* Status badges */}
        {isOutOfStock && (
          <div className="absolute top-2 right-2 px-2 py-1 rounded-full bg-red-500 text-white text-xs font-semibold">
            Out of Stock
          </div>
        )}
        {showStock && stock !== null && stock > 0 && stock <= (product.low_stock_threshold ?? 5) && (
          <div className="absolute top-2 right-2 px-2 py-1 rounded-full bg-amber-500 text-white text-xs font-semibold">
            Low Stock
          </div>
        )}
        {!isOutOfStock && showStock && stock !== null && stock > (product.low_stock_threshold ?? 5) && (
          <div className="absolute top-2 right-2 px-2 py-1 rounded-full bg-white/90 backdrop-blur text-gray-600 text-xs font-medium">
            {stock} left
          </div>
        )}
        {unavailableReason && (
          <div className="absolute top-2 right-2 px-2 py-1 rounded-full bg-red-500 text-white text-xs font-semibold">
            Unavailable
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-4 flex flex-col flex-1">
        <div className="flex-1">
        <div className="flex items-start justify-between mb-1">
          <h3 className="text-sm font-semibold text-gray-900">{product.name}</h3>
        </div>
        {unavailableReason && (
          <p className="text-xs text-red-500 mb-2">{unavailableReason}</p>
        )}
        <p className="text-lg font-bold text-amber-600 mb-3">
          {formatCurrency(product.selling_price)}
        </p>

        </div>

        {/* Quantity Controls */}
        <div className="flex items-center justify-between mt-auto pt-3">
          <div className="flex items-center gap-1.5 bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => onQtyChange(Math.max(0, qty - 1))}
              className="w-8 h-8 flex items-center justify-center rounded-md text-gray-500 hover:bg-white hover:text-gray-900 hover:shadow-sm transition-all disabled:opacity-30"
              disabled={qty === 0 || isDisabled}
            >
              −
            </button>
            <span className="w-8 text-center text-sm font-semibold tabular-nums text-gray-900">
              {qty}
            </span>
            <button
              onClick={() =>
                onQtyChange(maxQty !== undefined ? Math.min(maxQty, qty + 1) : qty + 1)
              }
              className="w-8 h-8 flex items-center justify-center rounded-md text-gray-500 hover:bg-white hover:text-gray-900 hover:shadow-sm transition-all disabled:opacity-30"
              disabled={isDisabled || (maxQty !== undefined && qty >= maxQty)}
            >
              +
            </button>
          </div>

          {qty > 0 && (
            <span className="text-sm font-semibold text-amber-600">
              {formatCurrency(product.selling_price * qty)}
            </span>
          )}
        </div>
      </div>

      {/* Kiosk-style Product Modal */}
      {isModalOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in zoom-in duration-200"
          onClick={(e) => { e.stopPropagation(); setIsModalOpen(false); }}
        >
          <div
            className="relative bg-white rounded-3xl shadow-2xl overflow-hidden max-w-[340px] md:max-w-3xl w-full flex flex-col md:flex-row animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close Button X */}
            <button
              className="absolute top-4 right-4 z-10 w-9 h-9 flex items-center justify-center bg-black/10 hover:bg-black/20 text-gray-800 rounded-full transition-colors"
              onClick={(e) => { e.stopPropagation(); setIsModalOpen(false); }}
            >
              <span className="text-xl leading-none">×</span>
            </button>

            {/* Left/Top: Image section */}
            <div className="w-full md:w-1/2 bg-gradient-to-br from-amber-50 to-orange-50 aspect-square md:aspect-auto flex items-center justify-center relative overflow-hidden">
              {product.image_url ? (
                <img
                  src={getImageUrl(product.image_url) ?? ""}
                  alt={product.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <span className="text-8xl opacity-40">
                  {product.type === "cafe" ? "☕" : "🧊"}
                </span>
              )}
            </div>

            {/* Right/Bottom: Product info & Actions */}
            <div className="w-full md:w-1/2 p-6 md:p-8 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <span className={`px-2.5 py-1 text-[10px] uppercase tracking-wider font-bold rounded-full ${product.type === "cafe" ? "bg-amber-100 text-amber-800" : "bg-blue-100 text-blue-800"
                    }`}>
                    {product.type === "cafe" ? "☕ Handcrafted" : "❄️ Chilled Drink"}
                  </span>
                  {showStock && stock !== null && stock > 0 && stock <= (product.low_stock_threshold ?? 5) && (
                    <span className="px-2.5 py-1 text-[10px] uppercase tracking-wider font-bold rounded-full bg-orange-100 text-orange-800">
                      ⚡ Low Stock
                    </span>
                  )}
                  {isOutOfStock && (
                    <span className="px-2.5 py-1 text-[10px] uppercase tracking-wider font-bold rounded-full bg-red-100 text-red-800">
                      🚨 Sold Out
                    </span>
                  )}
                </div>

                <h2 className="text-2xl md:text-3xl font-extrabold text-gray-900 mb-1 leading-tight">{product.name}</h2>
                <div className="flex items-baseline justify-between mb-8">
                  <p className="text-xl md:text-2xl font-bold text-amber-600">{formatCurrency(product.selling_price)}</p>
                  {showStock && stock !== null && stock > 0 && (
                    <p className="text-sm font-medium text-gray-500">{stock} available</p>
                  )}
                </div>

                {/* Modal Auto-Quantity Counter Simulator */}
                <div className="flex flex-col items-center justify-center pt-2 pb-6">
                  <div className="flex items-center gap-6">
                    <button
                      onClick={() => setModalQty(Math.max(0, modalQty - 1))}
                      className="w-14 h-14 rounded-full border-2 border-gray-200 flex items-center justify-center text-3xl font-light text-gray-500 hover:bg-amber-50 hover:text-amber-600 hover:border-amber-300 transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:border-gray-200 disabled:hover:text-gray-500"
                      disabled={modalQty === 0 || isDisabled}
                    >
                      −
                    </button>
                    <span className="text-4xl font-black w-14 text-center tabular-nums text-gray-900">
                      {modalQty}
                    </span>
                    <button
                      onClick={() => setModalQty(maxQty !== undefined ? Math.min(maxQty, modalQty + 1) : modalQty + 1)}
                      className="w-14 h-14 rounded-full border-2 border-gray-200 flex items-center justify-center text-3xl font-light text-gray-500 hover:bg-amber-50 hover:text-amber-600 hover:border-amber-300 transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:border-gray-200 disabled:hover:text-gray-500"
                      disabled={isDisabled || (maxQty !== undefined && modalQty >= maxQty)}
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>

              {/* Action Button */}
              <button
                onClick={handleApplyOrder}
                className={`w-full py-4 rounded-2xl text-lg font-bold shadow-lg transition-all active:scale-[0.98] ${modalQty > 0
                  ? 'bg-amber-500 hover:bg-amber-600 text-white border border-amber-600'
                  : 'bg-red-50 hover:bg-red-100 text-red-600 border border-red-200'
                  }`}
              >
                {modalQty === 0
                  ? "Remove from Order"
                  : qty > 0
                    ? `Update Order — ${formatCurrency(product.selling_price * modalQty)}`
                    : `Add to Order — ${formatCurrency(product.selling_price * modalQty)}`
                }
              </button>

            </div>
          </div>
        </div>
      )}
    </div>
  );
}
