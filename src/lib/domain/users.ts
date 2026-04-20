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
      .upsert({ 
        id: data.user.id, 
        role: role, 
        email: email, // <--- Added email synchronization
        updated_at: new Date().toISOString() 
      });

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

export async function deleteStaffAccount(userIdToDelete: string) {
  const adminProfile = await requireRole("admin");
  const adminId = adminProfile.id;

  if (userIdToDelete === adminId) {
    return { success: false, error: "You cannot delete your own account." };
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  if (!serviceRoleKey || !supabaseUrl) {
    return { success: false, error: "Configuration Error: Service role key missing." };
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  // 1. Fetch target user to check their role and identity
  const { data: targetUser, error: fetchError } = await supabaseAdmin
    .from("profiles")
    .select("role, email")
    .eq("id", userIdToDelete)
    .single();

  if (fetchError || !targetUser) {
    return { success: false, error: "Account not found in Profiles." };
  }

  // Ensure the main admin can NEVER be deleted
  if (targetUser.email === "desk@startuplab.ph") {
    return { success: false, error: "The primary owner account (desk@startuplab.ph) can never be deleted." };
  }

  // Fetch the current acting administrator's true email
  const { data: adminAuthData } = await supabaseAdmin.auth.admin.getUserById(adminId);
  const adminEmail = adminAuthData?.user?.email;

  // Restore admin protections, but create an exception for the main owner
  if (targetUser.role === "admin" && adminEmail !== "desk@startuplab.ph") {
    return { success: false, error: "Only the main owner (desk@startuplab.ph) can delete other administrators." };
  }

  // 1.5. Clear any constraints from business data so we can safely delete the user
  await supabaseAdmin.from("orders").update({ confirmed_by: null }).eq("confirmed_by", userIdToDelete);
  await supabaseAdmin.from("inventory_movements").update({ performed_by: null }).eq("performed_by", userIdToDelete);

  // 2. Clear public Profile FIRST (to remove the foreign key reference holding back auth layer deletion)
  const { error: profileError } = await supabaseAdmin.from("profiles").delete().eq("id", userIdToDelete);
  if (profileError) {
    console.warn("[deleteUserProfile] Profiling record deletion failed or missing (ignoring):", profileError);
  }

  // 3. Clear Auth account last
  const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(userIdToDelete);
  if (authError) {
    console.error("[deleteUserAuth]", authError);
    return { success: false, error: "Failed to delete from authentication layer: " + authError.message };
  }

  return { success: true };
}

/**
 * Synchronizes email addresses from auth.users to public.profiles.
 * Useful after adding the 'email' column to the profiles table.
 */
export async function syncStaffEmails() {
  await requireRole("admin");
  
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!serviceRoleKey || !supabaseUrl) return { success: false, error: "Service role key missing." };

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  try {
    // 1. Fetch all users from Auth
    const { data: { users }, error: authError } = await supabaseAdmin.auth.admin.listUsers();
    if (authError) throw authError;

    // 2. Batch update profiles
    let successCount = 0;
    for (const user of users) {
      if (!user.email) continue;
      const { error } = await supabaseAdmin
        .from("profiles")
        .update({ email: user.email })
        .eq("id", user.id);
      
      if (!error) successCount++;
    }

    return { success: true, count: successCount };
  } catch (err: any) {
    console.error("[syncStaffEmails]", err);
    return { success: false, error: err.message || "Failed to sync emails." };
  }
}

export async function changeStaffPassword(userId: string, newPassword: string) {
  const adminProfile = await requireRole("admin");
  const adminId = adminProfile.id;

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  if (!serviceRoleKey || !supabaseUrl) {
    return { success: false, error: "Configuration Error: Service role key missing." };
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  // Fetch current user to check their role (Admin protection)
  const { data: targetUser, error: fetchError } = await supabaseAdmin
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .single();

  if (fetchError || !targetUser) {
    return { success: false, error: "Account not found in Profiles." };
  }

  // Admin cannot change other admins' passwords
  if (targetUser.role === "admin" && userId !== adminId) {
    return { success: false, error: "Administrators cannot change other administrators' passwords. Action blocked." };
  }

  // Update Auth account password
  const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
    password: newPassword
  });

  if (authError) {
    console.error("[updateUserPassword]", authError);
    return { success: false, error: authError.message || "Failed to update password." };
  }

  return { success: true };
}
