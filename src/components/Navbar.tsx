"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/browser";
import type { Profile } from "@/lib/types";

const publicLinks = [
  { href: "/fridge", label: "Fridge", icon: "🧊" },
  { href: "/cafe", label: "Café", icon: "☕" },
];

export default function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();

    async function getProfile(userId: string) {
      try {
        const { data } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", userId)
          .single();
        if (data) {
          setProfile(data as Profile);
        } else {
          // Fallback if profile row is missing
          setProfile({ id: userId, full_name: "Staff", role: 'barista', created_at: '' });
        }
      } catch (err) {
        console.error("Profile fetch error:", err);
      } finally {
        setLoading(false);
      }
    }

    // 1. Initial check
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        getProfile(session.user.id);
      } else {
        // Quick check for local demo bypass cookie
        const isDemo = document.cookie.includes("demo_role=");
        if (isDemo) {
          const roleMatch = document.cookie.match(/demo_role=(barista|admin)/);
          const demoRole = roleMatch ? roleMatch[1] : "barista";
          setProfile({ id: "demo-user", full_name: "Demo User", role: demoRole as any, created_at: "" });
        } else {
          setProfile(null);
        }
        setLoading(false);
      }
    });

    // 2. Listen for changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session?.user) {
        getProfile(session.user.id);
      } else if (event === "SIGNED_OUT") {
        setProfile(null);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const handleLogout = async () => {
    // Clear demo cookie if it exists
    document.cookie = "demo_role=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";

    const supabase = createClient();
    await supabase.auth.signOut();
    setProfile(null);
    router.push("/cafe");
    router.refresh();
  };

  const links = publicLinks;

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 border-b border-gray-200 bg-white/90 backdrop-blur-lg">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="flex h-14 items-center justify-between">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 group">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500 text-sm font-bold text-white shadow-sm transition-transform group-hover:scale-105">
              L
            </div>
            <span className="text-lg font-bold text-gray-900 hidden sm:block">
              LaBrew
            </span>
          </Link>

          {/* Nav Links */}
          <div className="flex items-center gap-0.5">
            {links.map((link) => {
              const isActive =
                pathname === link.href ||
                (link.href !== "/" && pathname.startsWith(link.href + "/"));
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-all",
                    isActive
                      ? "bg-amber-50 text-amber-700"
                      : "text-gray-500 hover:bg-gray-50 hover:text-gray-900"
                  )}
                >
                  <span className="text-base">{link.icon}</span>
                  <span className="hidden sm:inline">{link.label}</span>
                </Link>
              );
            })}

            <div className="w-px h-6 bg-gray-200 mx-2 hidden sm:block"></div>

            {!loading && (
              <>
                {profile && (
                  <Link
                    key={`nav-${profile.role}`}
                    href={profile.role === "admin" ? "/dashboard" : "/barista"}
                    className={cn(
                      "flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-all group",
                      pathname === "/dashboard" || pathname === "/barista" || pathname.startsWith("/dashboard/") || pathname.startsWith("/barista/")
                        ? "bg-amber-100 text-amber-900 border border-amber-200 shadow-sm"
                        : "text-amber-600 hover:bg-amber-50 hover:text-amber-700 font-bold"
                    )}
                  >
                    <span className="text-base group-hover:scale-110 transition-transform">📊</span>
                    <span className="hidden sm:inline">
                      {profile.role === "admin" ? "Admin Panel" : "Barista Queue"}
                    </span>
                  </Link>
                )}
                {profile ? (
                  <div className="flex items-center gap-3 ml-1">
                    <span className="text-xs font-semibold px-2 py-1 bg-gray-100 text-gray-700 rounded-full hidden sm:block">
                      {profile.role}
                    </span>
                    <button
                      onClick={handleLogout}
                      className="text-sm font-medium text-red-600 hover:text-red-700 hover:bg-red-50 px-3 py-2 rounded-lg transition-colors"
                    >
                      Logout
                    </button>
                  </div>
                ) : (
                  <Link
                    href="/login"
                    className="ml-1 text-sm font-medium text-amber-600 hover:text-amber-700 hover:bg-amber-50 px-3 py-2 rounded-lg transition-colors"
                  >
                    Login
                  </Link>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
