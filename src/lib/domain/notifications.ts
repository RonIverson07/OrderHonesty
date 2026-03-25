"use server";

import { createClient } from "@/lib/supabase/server";
import { getSetting } from "@/lib/domain/settings";

type NotificationType = "new_order" | "low_stock" | "reconciliation_reminder" | "test";

async function logNotification(type: NotificationType, status: "sent" | "failed", errorMessage?: string) {
  const supabase = await createClient();
  await supabase.from("notification_logs").insert({
    type,
    status,
    error_message: errorMessage || null,
  });
}

/**
 * Throttling logic. Returns true if the notification is allowed.
 * Prevents spamming low stock and reconciliation alerts.
 */
async function canSendNotification(type: NotificationType, identityKey?: string): Promise<boolean> {
  if (type === "new_order" || type === "test") return true; 

  const supabase = await createClient();
  // Check if sent in last 24h
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  
  let query = supabase
    .from("notification_logs")
    .select("created_at")
    .eq("type", type)
    .eq("status", "sent")
    .gte("created_at", yesterday);
    
  if (identityKey && type === "low_stock") {
    // We append the product ID directly to the type string for throttling uniqueness, e.g. "low_stock_abc-123"
    // Wait, the column is `type`. So we query `low_stock___${productId}`
    query = query.eq("type", `low_stock___${identityKey}`);
  }

  const { data, error } = await query;
  if (error) return true; // If error checking, fail open and send
  
  return !data || data.length === 0;
}

/**
 * Base email dispatcher
 */
async function sendEmail(to: string, subject: string, htmlHtml: string, type: NotificationType, identityKey?: string) {
  const throttleType = identityKey && type === "low_stock" ? (`low_stock___${identityKey}` as NotificationType) : type;
  
  const allowed = await canSendNotification(throttleType, identityKey);
  if (!allowed) {
    console.log(`[Notification] Throttled (${throttleType}) -> ${subject}`);
    return { success: false, reason: "throttled" };
  }

  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    // Missing API key fallback: console log & mark failed in DB
    console.log(`[Email Fallback - NO API KEY] `);
    console.log(`To: ${to}`);
    console.log(`Subject: ${subject}`);
    console.log(`Body: ${htmlHtml}`);
    await logNotification(throttleType, "failed", "Missing RESEND_API_KEY configuration");
    return { success: false, reason: "missing_api_key" };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "LaBrew System <noreply@labrew.app>", // Assumes a verified domain exists, or gracefully fails via API response
        to,
        subject,
        html: htmlHtml,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Resend Error: ${err}`);
    }

    await logNotification(throttleType, "sent");
    return { success: true };
  } catch (e: any) {
    console.error("Failed to send email:", e);
    await logNotification(throttleType, "failed", e.message);
    return { success: false, error: e.message };
  }
}

// ==== Public Dispatchers ====

export async function sendTestNotification(toEmail?: string) {
  const adminEmail = await getSetting("admin_email", "");
  const target = toEmail || adminEmail;
  if (!target) return { success: false, error: "No admin email configured" };

  return sendEmail(
    target,
    "LaBrew: Systematic Notification Test ☕",
    `<p>This is a test notification from your LaBrew system settings.</p><p>If you received this, your email configuration is working perfectly.</p>`,
    "test"
  );
}

export async function sendNewOrderAlert(orderNumber: string, total: number) {
  const adminEmail = await getSetting("admin_email", "");
  if (!adminEmail) return { success: false, reason: "no_email" };

  return sendEmail(
    adminEmail,
    `New Café Order: ${orderNumber}`,
    `<h2>New Café Order #${orderNumber}</h2><p>A new order was just placed with a total of ₱${total.toFixed(2)}.</p>`,
    "new_order"
  );
}

export async function sendLowStockAlert(productId: string, productName: string, remainingStock: number, threshold: number) {
  const adminEmail = await getSetting("admin_email", "");
  if (!adminEmail) return { success: false, reason: "no_email" };

  return sendEmail(
    adminEmail,
    `⚠️ Low Stock Alert: ${productName}`,
    `<h2>Low Stock Warning</h2><p>The product <strong>${productName}</strong> has dropped to ${remainingStock} units. The current threshold is ${threshold}. Please arrange a restock soon.</p>`,
    "low_stock",
    productId
  );
}

export async function sendReconciliationReminder(date: string) {
  const adminEmail = await getSetting("admin_email", "");
  if (!adminEmail) return { success: false, reason: "no_email" };

  return sendEmail(
    adminEmail,
    `⏳ Pending Reconciliation: ${date}`,
    `<h2>Reconciliation Reminder</h2><p>Please remember to reconcile the system and confirm all physical inventory and payments for ${date}.</p>`,
    "reconciliation_reminder"
  );
}
