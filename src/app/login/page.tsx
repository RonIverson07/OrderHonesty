"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import Link from "next/link";
import { Coffee, BarChart3, X, AlertCircle } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [loginMode, setLoginMode] = useState<"barista" | "admin">("barista");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [toastVisible, setToastVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (message: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(message);
    setToastVisible(true);
    toastTimer.current = setTimeout(() => setToastVisible(false), 4000);
  };

  const dismissToast = () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToastVisible(false);
  };

  useEffect(() => {
    return () => { if (toastTimer.current) clearTimeout(toastTimer.current); };
  }, []);

  // Auto-redirect if already logged in
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        supabase.from("profiles").select("role").eq("id", session.user.id).single().then(({ data }) => {
          if (data?.role === "admin") router.push("/dashboard");
          else if (data?.role === "barista") router.push("/barista");
          else setChecking(false);
        });
      } else {
        setChecking(false);
      }
    });
  }, [router]);

  if (checking) return null;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const isDemoMode = !rawUrl || rawUrl === "https://demo.supabase.co" || !rawUrl.startsWith("http");

      if (isDemoMode) {
        if (email === "admin@zencafe.local" && password === "admin123") {
          document.cookie = `demo_role=${loginMode}; path=/`;
          if (loginMode === "admin") {
            router.push("/dashboard");
          } else {
            router.push("/barista");
          }
          return;
        } else {
          throw new Error("Demo Mode Active: The database is not connected. Please use the demo credentials provided below.");
        }
      }

      const supabase = createClient();

      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (authError) {
        throw new Error("Invalid credentials. Please check your email and password.");
      }

      if (!authData.user) {
        throw new Error("Login failed. No user returned.");
      }

      const { data: profileData, error: profileError } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", authData.user.id)
        .single();

      if (profileError || !profileData) {
        throw new Error("Unable to fetch user profile. Please contact administrator.");
      }

      if (loginMode === "admin" && profileData.role !== "admin") {
        await supabase.auth.signOut();
        throw new Error("Access Denied: You must be an administrator to log in here.");
      }

      if (loginMode === "barista" && profileData.role !== "admin" && profileData.role !== "barista") {
        await supabase.auth.signOut();
        throw new Error("Access Denied: You must be a barista or administrator to log in here.");
      }

      if (loginMode === "admin") {
        router.push("/dashboard");
      } else {
        router.push("/barista");
      }

      router.refresh();
    } catch (err: any) {
      showToast(err.message || "An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* Toast Popup */}
      <div
        style={{
          position: "fixed",
          top: "24px",
          right: "24px",
          zIndex: 9999,
          transition: "all 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)",
          transform: toastVisible ? "translateX(0) scale(1)" : "translateX(120%) scale(0.9)",
          opacity: toastVisible ? 1 : 0,
          pointerEvents: toastVisible ? "auto" : "none",
        }}
      >
        <div style={{
          display: "flex",
          alignItems: "flex-start",
          gap: "12px",
          background: "#fff",
          border: "1px solid #fecaca",
          borderLeft: "4px solid #ef4444",
          borderRadius: "10px",
          boxShadow: "0 10px 25px -5px rgba(0,0,0,0.15), 0 4px 10px -5px rgba(0,0,0,0.1)",
          padding: "14px 16px",
          maxWidth: "340px",
          minWidth: "260px",
        }}>
          <AlertCircle style={{ color: "#ef4444", flexShrink: 0, marginTop: "1px" }} size={20} />
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, fontWeight: 600, fontSize: "14px", color: "#111827" }}>Login Failed</p>
            <p style={{ margin: "4px 0 0 0", fontSize: "13px", color: "#6b7280", lineHeight: 1.5 }}>{toast}</p>
          </div>
          <button onClick={dismissToast} style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af", padding: 0, marginTop: "1px" }}>
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="min-h-screen bg-neutral-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8 -mt-15">
        <div className="sm:mx-auto sm:w-full sm:max-w-md">
          <div className="flex justify-center mb-6">
            <img
              src="/startuplogo.png"
              alt="StartupLab Logo"
              className="h-28 w-auto object-contain drop-shadow-sm"
            />
          </div>
          <h2 className="mt-2 text-center text-3xl font-bold text-gray-900">
            Sign in to dashboard
          </h2>
          <p className="mt-2 text-center text-sm text-neutral-600">
            Or return to the{" "}
            <Link href="/cafe" className="font-medium text-amber-600 hover:text-amber-500">
              public café menu
            </Link>
          </p>
        </div>

        <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">

          {/* Mode Toggle */}
          <div className="flex bg-neutral-200 p-1 rounded-lg mb-6 shadow-inner mx-4 sm:mx-0">
            <button
              onClick={() => setLoginMode("barista")}
              className={`flex flex-1 items-center justify-center gap-2 py-2 text-sm font-medium rounded-md transition-all ${loginMode === "barista"
                ? "bg-white text-amber-700 shadow-sm"
                : "text-neutral-500 hover:text-neutral-700"
                }`}
            >
              <Coffee className="w-4 h-4" /> Login as Barista
            </button>
            <button
              onClick={() => setLoginMode("admin")}
              className={`flex flex-1 items-center justify-center gap-2 py-2 text-sm font-medium rounded-md transition-all ${loginMode === "admin"
                ? "bg-white text-amber-700 shadow-sm"
                : "text-neutral-500 hover:text-neutral-700"
                }`}
            >
              <BarChart3 className="w-4 h-4 text-emerald-600" /> Login as Admin
            </button>
          </div>

          <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10 border border-neutral-100 mx-4 sm:mx-0">
            <div className="mb-6 text-center text-sm text-neutral-500">
              {loginMode === "barista"
                ? "Access the barista queue and prep dashboard."
                : "Access the system settings and management toolkit."}
              <br /><br />
              <span className="text-amber-600 font-medium bg-amber-50 px-2 py-1 rounded">
                Demo Credentials: {loginMode === "barista" ? "barista@zencafe.local" : "admin@zencafe.local"} / admin123
              </span>
            </div>

            <form className="space-y-6" onSubmit={handleLogin}>
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-neutral-700">
                  Email address
                </label>
                <div className="mt-1">
                  <input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="appearance-none block w-full px-3 py-2 border border-neutral-300 rounded-md shadow-sm placeholder-neutral-400 focus:outline-none focus:ring-amber-500 focus:border-amber-500 sm:text-sm"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-medium text-neutral-700">
                  Password
                </label>
                <div className="mt-1">
                  <input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="appearance-none block w-full px-3 py-2 border border-neutral-300 rounded-md shadow-sm placeholder-neutral-400 focus:outline-none focus:ring-amber-500 focus:border-amber-500 sm:text-sm"
                  />
                </div>
              </div>

              <div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-amber-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {loading ? "Signing in..." : "Sign in"}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </>
  );
}
