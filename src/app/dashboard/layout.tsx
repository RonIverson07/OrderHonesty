"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/browser";
import type { Profile } from "@/lib/types";
import { useState, useEffect } from "react";

const adminLinks = [
  { href: "/barista", label: "Order Queue", icon: "🎟️", exact: false },
  { href: "/dashboard", label: "Overview", icon: "📊", exact: true },
  { href: "/dashboard/products", label: "Products", icon: "📦", exact: false },
  { href: "/dashboard/ingredients", label: "Ingredients", icon: "🧪", exact: false },
  { href: "/dashboard/recipes", label: "Recipes", icon: "📋", exact: false },
  { href: "/dashboard/stock", label: "Stock", icon: "📥", exact: false },
  { href: "/dashboard/reconciliation", label: "Reconciliation", icon: "🧾", exact: false },
  { href: "/dashboard/users", label: "Users", icon: "👥", exact: false },
  { href: "/dashboard/settings", label: "Settings", icon: "⚙️", exact: false },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-6">
      <DashboardSidebar />
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

function DashboardSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    async function loadAuth() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", user.id)
          .single();
        if (data) setProfile(data as Profile);
      }
    }
    loadAuth();
  }, []);

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  return (
    <aside className="hidden lg:block w-52 shrink-0">
      <div className="card p-3 sticky top-20">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-3 mb-2">
          Admin
        </p>
        <nav className="space-y-0.5">
          {adminLinks.map((link) => {
            const isActive = link.exact
              ? pathname === link.href
              : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all",
                  isActive
                    ? "bg-amber-50 text-amber-700"
                    : "text-gray-500 hover:bg-gray-50 hover:text-gray-900"
                )}
              >
                <span>{link.icon}</span>
                <span>{link.label}</span>
              </Link>
            );
          })}
        </nav>
        
        {profile && (
          <div className="mt-8 pt-4 border-t border-gray-100">
            <div className="flex items-center gap-2 px-3 py-2 mb-2 bg-gray-50 rounded-lg">
              <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center text-amber-700 font-bold text-sm">
                {profile.full_name?.charAt(0) ?? "A"}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{profile.full_name}</p>
                <p className="text-xs text-gray-500 capitalize">{profile.role}</p>
              </div>
            </div>
            
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-red-600 hover:bg-red-50 transition-colors"
            >
              <span>🚪</span>
              <span>Logout</span>
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
