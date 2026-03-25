"use server";

import { createClient } from "@supabase/supabase-js";
import { requireRole } from "@/lib/supabase/auth";

export async function createStaffAccount(formData: FormData) {
  await requireRole("admin");

  const email = formData.get("email") as string;
  const password = formData.get("password") as string;
  const role = formData.get("role") as string;

  if (!email || !password || (role !== "barista" && role !== "admin")) {
    return { success: false, error: "Invalid form data." };
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    return { 
      success: false, 
      error: "SUPABASE_SERVICE_ROLE_KEY is not set in .env.local. Admin creation requires the service role key." 
    };
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl || !supabaseUrl.startsWith("http")) {
    return { 
      success: false, 
      error: "NEXT_PUBLIC_SUPABASE_URL is not configured properly in .env.local. A valid HTTP URL is required to use the Admin API." 
    };
  }

  // Use the admin API with the service role key
  const supabaseAdmin = createClient(
    supabaseUrl,
    serviceRoleKey,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  try {
    // 1. Create the user in auth.users
    const { data, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (authError || !data.user) {
      console.error("[createUser]", authError);
      return { success: false, error: authError?.message || "Failed to create authentication user." };
    }

    // 2. The profile is automatically created by the generic Supabase trigger (if they have one), 
    // but just in case, we'll actively UPDATE or INSERT into profiles to set the correct role.
    const { error: profileError } = await supabaseAdmin
      .from("profiles")
      .upsert({ id: data.user.id, role: role, updated_at: new Date().toISOString() });

    if (profileError) {
      console.error("[createUserProfile]", profileError);
      return { success: false, error: "User created, but failed to assign role." };
    }

    return { success: true };
  } catch (err: any) {
    console.error("[createStaffAccount]", err);
    return { success: false, error: "An unexpected error occurred." };
  }
}
