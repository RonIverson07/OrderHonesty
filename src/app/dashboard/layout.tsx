"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useState, useEffect } from "react";

import { Ticket, BarChart3, Package, FlaskConical, ClipboardList, Inbox, Receipt, Users, Settings } from "lucide-react";

const adminLinks = [
  { href: "/barista", label: "Order Queue", icon: <Ticket className="w-5 h-5 text-gray-500" />, exact: false },
  { href: "/dashboard", label: "Overview", icon: <BarChart3 className="w-5 h-5 text-indigo-500" />, exact: true },
  { href: "/dashboard/products", label: "Products", icon: <Package className="w-5 h-5 text-amber-600" />, exact: false },
  { href: "/dashboard/ingredients", label: "Ingredients", icon: <FlaskConical className="w-5 h-5 text-emerald-500" />, exact: false },
  { href: "/dashboard/recipes", label: "Recipes", icon: <ClipboardList className="w-5 h-5 text-blue-500" />, exact: false },
  { href: "/dashboard/stock", label: "Stock", icon: <Inbox className="w-5 h-5 text-purple-500" />, exact: false },
  { href: "/dashboard/reconciliation", label: "Reconciliation", icon: <Receipt className="w-5 h-5 text-rose-500" />, exact: false },
  { href: "/dashboard/users", label: "Users", icon: <Users className="w-5 h-5 text-cyan-600" />, exact: false },
  { href: "/dashboard/settings", label: "Settings", icon: <Settings className="w-5 h-5 text-gray-700" />, exact: false },
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
        
      </div>
    </aside>
  );
}
