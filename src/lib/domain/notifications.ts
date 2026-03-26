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
        from: "LaBrew System <onboarding@resend.dev>", // Uses Resend's default onboarding email so you don't have to buy a domain name!
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

function buildEmailLayout(title: string, contentHtml: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f9fafb; margin: 0; padding: 20px;">
  <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); border: 1px solid #f3f4f6;">
    <div style="background-color: #d97706; padding: 24px 32px; text-align: center;">
      <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 700; letter-spacing: -0.5px;">LaBrew</h1>
    </div>
    <div style="padding: 32px; color: #374151; font-size: 15px; line-height: 1.6;">
      ${contentHtml}
    </div>
    <div style="background-color: #f9fafb; padding: 24px 32px; text-align: center; font-size: 13px; color: #6b7280; border-top: 1px solid #f3f4f6;">
      <p style="margin: 0;">This is an automated notification from your LaBrew Management System.</p>
    </div>
  </div>
</body>
</html>`;
}

// ==== Public Dispatchers ====

export async function sendTestNotification(toEmail?: string) {
  const adminEmail = await getSetting("admin_email", "");
  const target = toEmail || adminEmail;
  if (!target) return { success: false, error: "No admin email configured" };

  return sendEmail(
    target,
    "LaBrew: Systematic Notification Test ☕",
    buildEmailLayout("System Test", `<h2 style="color: #111827; font-size: 20px; margin-top: 0; margin-bottom: 16px;">System Test Successful</h2><p style="margin:0 0 16px 0;">This is a test notification from your LaBrew system settings. If you received this, your automated email configuration is working perfectly natively!</p>`),
    "test"
  );
}

export async function sendNewOrderAlert(orderNumber: string, total: number, customerName?: string | null, snapshotUrl?: string | null, itemsList?: string | null) {
  const adminEmail = await getSetting("admin_email", "");
  if (!adminEmail) return { success: false, reason: "no_email" };

  const labelStyle = `margin-bottom: 12px; background-color: #f9fafb; padding: 12px 16px; border-radius: 8px; border: 1px solid #f3f4f6;`;
  const strongStyle = `color: #111827; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 4px;`;

  const nameHtml = customerName ? `<div style="${labelStyle}"><strong style="${strongStyle}">Customer Name</strong> ${customerName}</div>` : "";
  const itemsHtml = itemsList ? `<div style="${labelStyle}"><strong style="${strongStyle}">Order Items</strong> ${itemsList}</div>` : "";
  const totalHtml = `<div style="${labelStyle}"><strong style="${strongStyle}">Order Total</strong> ₱${total.toFixed(2)}</div>`;
  const snapHtml = snapshotUrl ? `<div style="margin-top: 24px; text-align: center; background-color: #f9fafb; padding: 16px; border-radius: 8px; border: 1px solid #f3f4f6;"><strong style="${strongStyle}">Customer Snapshot</strong><br/><img src="${snapshotUrl}" alt="Customer Snapshot" style="max-width: 100%; width: 400px; height: auto; border-radius: 8px; margin-top: 8px;" /></div>` : "";

  return sendEmail(
    adminEmail,
    `New Café Order: ${orderNumber}${customerName ? ` from ${customerName}` : ''}`,
    buildEmailLayout("New Order", `<h2 style="color: #111827; font-size: 20px; font-weight: 600; margin-top: 0; margin-bottom: 16px;">New Order Received: #${orderNumber}</h2><p style="margin:0 0 16px 0;">A new order has just successfully entered the system.</p>${nameHtml}${itemsHtml}${totalHtml}${snapHtml}`),
    "new_order"
  );
}

export async function sendLowStockAlert(productId: string, productName: string, remainingStock: number, threshold: number) {
  const adminEmail = await getSetting("admin_email", "");
  if (!adminEmail) return { success: false, reason: "no_email" };

  const labelStyle = `margin-bottom: 12px; background-color: #f9fafb; padding: 12px 16px; border-radius: 8px; border: 1px solid #f3f4f6;`;
  const strongStyle = `color: #111827; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 4px;`;

  const details = `
    <div style="${labelStyle}"><strong style="${strongStyle}">Product Name</strong> ${productName}</div>
    <div style="${labelStyle}"><strong style="${strongStyle}">Current Stock</strong> <span style="color: #dc2626; font-weight: bold;">${remainingStock} units</span></div>
    <div style="${labelStyle}"><strong style="${strongStyle}">Restock Threshold</strong> ${threshold} units</div>
  `;

  return sendEmail(
    adminEmail,
    `⚠️ Low Stock Alert: ${productName}`,
    buildEmailLayout("Low Stock Alert", `<h2 style="color: #111827; font-size: 20px; font-weight: 600; margin-top: 0; margin-bottom: 16px;">Low Stock Warning</h2><p style="margin:0 0 16px 0;">Please note that one of your inventory items has dropped to or below its automated safety threshold. Please arrange a restock as soon as possible.</p>${details}`),
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
    buildEmailLayout("Pending Reconciliation", `<h2 style="color: #111827; font-size: 20px; font-weight: 600; margin-top: 0; margin-bottom: 16px;">Reconciliation Reminder</h2><p style="margin:0;">Please remember to systematically reconcile and confirm all physical inventory and unconfirmed GCash payments for the session dated <strong style="color: #111827;">${date}</strong>.</p>`),
    "reconciliation_reminder"
  );
}
