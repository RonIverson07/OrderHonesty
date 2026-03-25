"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import Link from "next/link";

export default function LoginPage() {
  const router = useRouter();
  const [loginMode, setLoginMode] = useState<"barista" | "admin">("barista");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);

  // Auto-redirect if already logged in
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        // Fetch profile to obtain role
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
    setError(null);
    setLoading(true);

    try {
      const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const isDemoMode = !rawUrl || rawUrl === "https://demo.supabase.co" || !rawUrl.startsWith("http");

      if (isDemoMode) {
        // Local Developer Bypass (Demo Mode)
        if (email === "admin@labrew.local" && password === "admin123") {
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

      // Fetch profile to determine routing
      const { data: profileData, error: profileError } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", authData.user.id)
        .single();

      if (profileError || !profileData) {
        throw new Error("Unable to fetch user profile. Please contact administrator.");
      }

      // Strict Role Validation
      if (loginMode === "admin" && profileData.role !== "admin") {
        await supabase.auth.signOut();
        throw new Error("Access Denied: You must be an administrator to log in here.");
      }

      if (loginMode === "barista" && profileData.role !== "admin" && profileData.role !== "barista") {
        await supabase.auth.signOut();
        throw new Error("Access Denied: You must be a barista or administrator to log in here.");
      }

      // Route based on selected mode (if validation passes)
      if (loginMode === "admin") {
        router.push("/dashboard");
      } else {
        router.push("/barista");
      }
      
      router.refresh(); // Refresh to catch new auth state in server components
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center text-4xl mb-4">
          ☕
        </div>
        <h2 className="mt-2 text-center text-3xl font-extrabold text-neutral-900">
          Sign in to LaBrew
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
            className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${
              loginMode === "barista" 
                ? "bg-white text-amber-700 shadow-sm" 
                : "text-neutral-500 hover:text-neutral-700"
            }`}
          >
            ☕ Login as Barista
          </button>
          <button
            onClick={() => setLoginMode("admin")}
            className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${
              loginMode === "admin" 
                ? "bg-white text-amber-700 shadow-sm" 
                : "text-neutral-500 hover:text-neutral-700"
            }`}
          >
            📊 Login as Admin
          </button>
        </div>

        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10 border border-neutral-100 mx-4 sm:mx-0">
          
          {error && (
            <div className="mb-4 bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-md text-sm">
              {error}
            </div>
          )}

          <div className="mb-6 text-center text-sm text-neutral-500">
            {loginMode === "barista" 
              ? "Access the barista queue and prep dashboard." 
              : "Access the system settings and management toolkit."}
            <br/><br/>
            <span className="text-amber-600 font-medium bg-amber-50 px-2 py-1 rounded">
              Demo Credentials: {loginMode === "barista" ? "barista@labrew.local" : "admin@labrew.local"} / admin123
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
  );
}
