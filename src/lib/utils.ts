import { type ClassValue, clsx } from "clsx";

// ---- Conditional class name helper ----
// Lightweight replacement for clsx if not available

export function cn(...inputs: ClassValue[]): string {
    return clsx(inputs);
}

// ---- Currency formatter ----

export function formatCurrency(amount: number): string {
    return `₱${amount.toFixed(2)}`;
}

// ---- Date formatter ----

export function formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleString("en-PH", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
    });
}

// ---- Relative time ----

export function timeAgo(dateStr: string): string {
    const seconds = Math.floor(
        (Date.now() - new Date(dateStr).getTime()) / 1000
    );
    if (seconds < 60) return "just now";
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
}
// ---- Image URL helper ----

export function getImageUrl(url: string | null): string | null {
  if (!url) return null;
  if (url.startsWith("http") || url.startsWith("data:")) return url;
  
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) return url;
  
  return `${supabaseUrl}/storage/v1/object/public/product-images/${url.replace(/^\/+/, '')}`;
}
