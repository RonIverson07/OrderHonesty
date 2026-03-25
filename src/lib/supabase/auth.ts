import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import type { Profile, UserRole } from "@/lib/types";

/**
 * Get the current authenticated user, or null if not logged in.
 */
export async function getUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

/**
 * Get the current user's ID, or null if not authenticated.
 */
export async function getCurrentUserId(): Promise<string | undefined> {
  const user = await getUser();
  return user?.id ?? undefined;
}

/**
 * Get the profile (with role) for the current user.
 * Returns null if not authenticated or no profile exists.
 */
export async function getProfile(): Promise<Profile | null> {
  const user = await getUser();
  if (!user) return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (error || !data) return null;
  return data as Profile;
}

/**
 * Check if the system is running in demo mode (no valid DB connection)
 */
function isDemoMode() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return !url || !url.startsWith("http") || url === "https://demo.supabase.co";
}

/**
 * Require a specific role. Redirects to /cafe if unauthorized.
 * Use in server components / page.tsx files.
 */
export async function requireRole(...allowedRoles: UserRole[]): Promise<Profile> {
  if (isDemoMode()) {
    return { id: "demo-admin", role: "admin", created_at: new Date().toISOString() } as Profile;
  }

  const profile = await getProfile();
  console.log(`[auth] requireRole check for ${profile?.role} (allowed: ${allowedRoles.join(",")})`);

  if (!profile || !allowedRoles.includes(profile.role)) {
    console.warn(`[auth] unauthorized access attempt by ${profile?.id}`);
    redirect("/cafe?error=unauthorized");
  }

  return profile;
}

/**
 * Check role without redirecting (for conditional rendering).
 */
export async function checkRole(...allowedRoles: UserRole[]): Promise<boolean> {
  if (isDemoMode()) return true;

  const profile = await getProfile();
  if (!profile) return false;
  return allowedRoles.includes(profile.role);
}
