"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUserId } from "@/lib/supabase/auth";
import { z } from "zod";
import { revalidatePath } from "next/cache";

// Settings validation schema
const SettingsSchema = z.object({
  payment_methods_enabled: z.object({
    cash: z.boolean(),
    gcash: z.boolean(),
    bank_transfer: z.boolean(),
    hitpay: z.boolean(),
  }),
  low_stock_threshold: z.number().min(1).max(100),
  admin_email: z.string().email().optional().or(z.literal("")),
  reconciliation_reminder_time: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).optional().or(z.literal("")),
});

type SettingsKeys = keyof z.infer<typeof SettingsSchema>;

/**
 * In-memory cache for settings to reduce DB reads.
 * Note: In a multi-instance edge deployment, this memory cache might be inconsistent across instances.
 * Next.js unstable_cache or Redis would be better for a true distributed app, 
 * but for this single-instance Supabase edge function approach, this simple cache is fine.
 */
let settingsCache: Record<string, any> = {};
let lastCacheUpdate: number = 0;
const CACHE_TTL_MS = 60000; // 1 minute

export async function getSetting<T>(key: SettingsKeys, defaultValue?: T): Promise<T | null> {
  const now = Date.now();
  
  if (settingsCache[key] !== undefined && now - lastCacheUpdate < CACHE_TTL_MS) {
    return settingsCache[key] as T;
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("system_settings")
    .select("value")
    .eq("key", key)
    .single();

  if (error || !data) {
    if (defaultValue !== undefined) return defaultValue;
    return null;
  }

  settingsCache[key] = data.value;
  lastCacheUpdate = now;

  return data.value as T;
}

export async function getAllSettings() {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("system_settings")
      .select("*");

    if (error || !data) return {};

    return data.reduce((acc, row) => {
      acc[row.key] = row.value;
      return acc;
    }, {} as Record<string, any>);
  } catch (err) {
    console.error("Error loading settings:", err);
    return {};
  }
}

export async function setSetting(key: SettingsKeys, value: any) {
  const adminId = await getCurrentUserId();
  if (!adminId) throw new Error("Unauthorized");

  const supabase = await createClient();

  // 1. Get current version for audit log
  const { data: current, error: getErr } = await supabase
    .from("system_settings")
    .select("value, version")
    .eq("key", key)
    .single();

  const old_value = current?.value ?? null;
  const current_version = current?.version ?? 0;
  const new_version = current_version + 1;

  // 2. Validate using Zod snippet trick
  const partialSchema = SettingsSchema.pick({ [key]: true } as any);
  const validated = partialSchema.safeParse({ [key]: value });
  
  if (!validated.success) {
    throw new Error(`Invalid setting value for ${key}: ${validated.error.message}`);
  }

  // 3. Update or Insert Settings
  const { error: upsertErr } = await supabase
    .from("system_settings")
    .upsert({
      key,
      value: validated.data[key],
      version: new_version,
      updated_at: new Date().toISOString(),
    });

  if (upsertErr) throw upsertErr;

  // 4. Log to Audit
  await supabase.from("settings_audit_log").insert({
    key,
    old_value,
    new_value: validated.data[key],
    version: new_version,
    changed_by: adminId,
  });

  // Update memory cache
  settingsCache[key] = validated.data[key];
  lastCacheUpdate = Date.now();

  revalidatePath("/dashboard/settings");
  revalidatePath("/cafe");
  revalidatePath("/fridge");

  return { success: true };
}

export async function getAuditLogs(key?: SettingsKeys, limit = 50) {
  try {
    const supabase = await createClient();
    let query = supabase
      .from("settings_audit_log")
      .select("*, profiles(full_name)")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (key) {
      query = query.eq("key", key);
    }

    const { data, error } = await query;
    if (error || !data) return [];
    return data;
  } catch (err) {
    console.error("Error loading audit logs:", err);
    return [];
  }
}

export async function rollbackSetting(logId: string) {
  const adminId = await getCurrentUserId();
  if (!adminId) throw new Error("Unauthorized");

  const supabase = await createClient();
  
  // Get log entry
  const { data: log, error: logErr } = await supabase
    .from("settings_audit_log")
    .select("*")
    .eq("id", logId)
    .single();

  if (logErr || !log) throw new Error("Audit log not found");

  // Re-apply old_value (or new_value if rolling forward to a specific snapshot state? Usually we rollback setting the value back to old_value)
  // Let's set it to new_value of the snapshot so they can select any snapshot to restore to:
  await setSetting(log.key as SettingsKeys, log.new_value);
  
  return { success: true };
}
