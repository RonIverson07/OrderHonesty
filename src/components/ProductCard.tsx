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
  const [isZoomed, setIsZoomed] = useState(false);
  
  const stock = product.retail_stock?.stock ?? null;
  const isOutOfStock = showStock && stock !== null && stock <= 0;
  const isDisabled = disabled || isOutOfStock;
  const maxQty = showStock && stock !== null ? stock : undefined;

  return (
    <div
      className={`card overflow-hidden animate-slide-in ${
        isDisabled ? "opacity-60" : ""
      }`}
    >
      {/* Image Container with Zoom Affordance */}
      <div 
        className={`aspect-[4/3] bg-gradient-to-br from-amber-50 to-orange-50 relative overflow-hidden ${product.image_url ? "cursor-zoom-in group" : ""}`}
        onClick={() => {
          if (product.image_url) setIsZoomed(true);
        }}
      >
        {product.image_url ? (
          <>
            <img
              src={getImageUrl(product.image_url) ?? ""}
              alt={product.name}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            />
            {/* Hover overlay hint */}
            <div className="absolute inset-0 bg-black/10 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
              <span className="bg-white/90 text-gray-800 p-2 rounded-full shadow-md text-xl">
                🔍
              </span>
            </div>
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
      <div className="p-4">
        <div className="flex items-start justify-between mb-1">
          <h3 className="text-sm font-semibold text-gray-900">{product.name}</h3>
        </div>
        {unavailableReason && (
          <p className="text-xs text-red-500 mb-2">{unavailableReason}</p>
        )}
        <p className="text-lg font-bold text-amber-600 mb-3">
          {formatCurrency(product.selling_price)}
        </p>

        {/* Quantity Controls */}
        <div className="flex items-center justify-between">
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

      {/* Floating Zoom Modal */}
      {isZoomed && product.image_url && (
        <div 
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in"
          onClick={(e) => { e.stopPropagation(); setIsZoomed(false); }}
        >
          <div className="relative max-w-3xl max-h-[90vh] w-full flex items-center justify-center">
            <button 
              className="absolute -top-12 right-0 text-white hover:text-gray-300 transition-colors"
              onClick={(e) => { e.stopPropagation(); setIsZoomed(false); }}
            >
              <span className="text-sm font-medium tracking-wider uppercase bg-white/20 hover:bg-white/30 transition px-4 py-1.5 rounded-full">✕ Close</span>
            </button>
            <img 
              src={getImageUrl(product.image_url) ?? ""} 
              alt={product.name} 
              className="w-full h-auto max-h-[85vh] object-contain rounded-xl shadow-2xl scale-100 animate-in zoom-in-95 duration-200"
              onClick={(e) => e.stopPropagation()} 
            />
          </div>
        </div>
      )}
    </div>
  );
}
