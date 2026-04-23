"use server";

import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseAdmin } from "@supabase/supabase-js";
import { getSetting } from "@/lib/domain/settings";
import crypto from "crypto";

type NotificationType = "new_order" | "low_stock" | "reconciliation_reminder" | "test" | "forgot_password" | "reconciliation_success" | "unconfirmed_alert";

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
  if (type === "new_order" || type === "test" || type === "forgot_password" || type === "reconciliation_success" || type === "unconfirmed_alert") return true;

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
        from: "Cafe System <noreply@cafe.moonshotdigital.com.ph>",
        to,
        subject,
        html: htmlHtml,
        clickTracking: false,
        openTracking: false,
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
    <div style="background: #d97706; padding: 24px; text-align: center;">
      <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 700; letter-spacing: -0.5px;">Cafe</h1>
    </div>
    <div style="padding: 32px; color: #374151; font-size: 15px; line-height: 1.6;">
      ${contentHtml}
    </div>
    <div style="padding: 24px; text-align: center; border-top: 1px solid #f3f4f6;">
      <p style="margin: 0;">This is an automated notification from your Cafe Management System.</p>
    </div>
  </div>
</body>
</html>`;
}

function base64UrlEncode(input: string): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function signEmailActionToken(payload: any): string {
  const secret = process.env.EMAIL_ACTION_SECRET;
  if (!secret) {
    throw new Error("Missing EMAIL_ACTION_SECRET configuration");
  }

  const body = base64UrlEncode(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", secret).update(body).digest("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  return `${body}.${sig}`;
}

function buildReconciliationActionUrl(date: string): string {
  // Force production domain for official emails, fallback to localhost for dev
  const isProd = process.env.NODE_ENV === "production";
  const appUrl = isProd 
    ? "https://cafe.moonshotdigital.com.ph" 
    : (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000");

  const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24; // Valid for 24h
  const token = signEmailActionToken({ date, action: "reconcile", exp });
  return `${appUrl.replace(/\/+$/g, "")}/api/email/reconcile?token=${encodeURIComponent(token)}&date=${date}`;
}

function buildOrderActionUrl(orderId: string, action: "confirm" | "flag"): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) {
    throw new Error("Missing NEXT_PUBLIC_APP_URL configuration");
  }

  const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7;
  const token = signEmailActionToken({ orderId, action, exp });
  return `${appUrl.replace(/\/+$/g, "")}/api/email/order-action/${action}?token=${encodeURIComponent(token)}`;
}

// ==== Public Dispatchers ====

export async function sendTestNotification(toEmail?: string) {
  const adminEmail = await getSetting("admin_email", "");
  const target = toEmail || adminEmail;
  if (!target) return { success: false, error: "No admin email configured" };

  return sendEmail(
    target,
    "Cafe: Systematic Notification Test ☕",
    buildEmailLayout("System Test", `<h2 style="color: #111827; font-size: 20px; margin-top: 0; margin-bottom: 16px;">System Test Successful</h2><p style="margin:0 0 16px 0;">This is a test notification from your Cafe system settings. If you received this, your automated email configuration is working perfectly natively!</p>`),
    "test"
  );
}

export async function sendNewOrderAlert(orderId: string, orderNumber: string, total: number, customerName?: string | null, snapshotUrl?: string | null, itemsList?: string | null) {
  const adminEmail = await getSetting("admin_email", "");
  if (!adminEmail) return { success: false, reason: "no_email" };

  const labelStyle = `margin-bottom: 12px; background-color: #f9fafb; padding: 12px 16px; border-radius: 8px; border: 1px solid #f3f4f6;`;
  const strongStyle = `color: #111827; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 4px;`;

  const nameHtml = customerName ? `<div style="${labelStyle}"><strong style="${strongStyle}">Customer Name</strong> ${customerName}</div>` : "";
  const itemsHtml = itemsList ? `<div style="${labelStyle}"><strong style="${strongStyle}">Order Items</strong> ${itemsList}</div>` : "";
  const totalHtml = `<div style="${labelStyle}"><strong style="${strongStyle}">Order Total</strong> ₱${total.toFixed(2)}</div>`;
  const snapHtml = snapshotUrl ? `<div style="margin-top: 24px; text-align: center; background-color: #f9fafb; padding: 16px; border-radius: 8px; border: 1px solid #f3f4f6;"><strong style="${strongStyle}">Customer Snapshot</strong><br/><img src="${snapshotUrl}" alt="Customer Snapshot" style="max-width: 100%; width: 400px; height: auto; border-radius: 8px; margin-top: 8px;" /></div>` : "";

  let actionButtonsHtml = "";
  try {
    const confirmUrl = buildOrderActionUrl(orderId, "confirm");
    const flagUrl = buildOrderActionUrl(orderId, "flag");

    actionButtonsHtml = `
      <div style="margin-top: 20px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse: separate;">
          <tr>
            <td style="padding-right: 10px;">
              <a href="${confirmUrl}" style="display: inline-block; background-color: #10b981; color: #ffffff; text-decoration: none; padding: 10px 14px; border-radius: 8px; font-weight: 600; font-size: 14px;">✓ Confirm</a>
            </td>
            <td>
              <a href="${flagUrl}" style="display: inline-block; background-color: #ef4444; color: #ffffff; text-decoration: none; padding: 10px 14px; border-radius: 8px; font-weight: 600; font-size: 14px;">⚠ Flag</a>
            </td>
          </tr>
        </table>
        <p style="margin: 10px 0 0 0; font-size: 13px; color: #6b7280;">These buttons update your Reconciliation status inside the Cafe System.</p>
      </div>
    `;
  } catch (e) {
    actionButtonsHtml = "";
  }

  return sendEmail(
    adminEmail,
    `New Café Order: ${orderNumber}${customerName ? ` from ${customerName}` : ''}`,
    buildEmailLayout("New Order", `<h2 style="color: #111827; font-size: 20px; font-weight: 600; margin-top: 0; margin-bottom: 16px;">New Order Received: #${orderNumber}</h2><p style="margin:0 0 16px 0;">A new order has just successfully entered the system.</p>${nameHtml}${itemsHtml}${totalHtml}${snapHtml}${actionButtonsHtml}`),
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

export async function sendReconciliationReminder(
  date: string,
  isReady: boolean = false,
  pendingOrders: { order_number: string; total_price: number }[] = []
) {
  const adminEmail = (await getSetting<string>("admin_email")) || "roniversonroguel.startuplab@gmail.com";

  // Force production domain for official emails, fallback to localhost for dev
  const isProd = process.env.NODE_ENV === "production";
  const appUrl = isProd 
    ? "https://cafe.moonshotdigital.com.ph" 
    : (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000");
  const reconciliationUrl = `${appUrl.replace(/\/+$/g, "")}/dashboard/reconciliation`;

  const title = isReady ? "Everything is Balanced!" : "Action Required: Reconciliation";
  const buttonText = "Mark Day Reconciled";
  const statusColor = isReady ? "#059669" : "#d97706";

  // We always use the action URL now so the "Mark Day Reconciled" button 
  // actually tries to perform the action and gives feedback in the browser.
  const actionUrl = buildReconciliationActionUrl(date);

  const ordersListHtml = pendingOrders.length > 0 ? `
    <div style="margin: 24px 0; background-color: #fef2f2; border: 1px solid #fee2e2; padding: 20px; border-radius: 12px; border-left: 4px solid #ef4444;">
      <p style="margin: 0 0 16px 0; color: #991b1b; font-weight: 700; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">🚨 Unconfirmed Payments (${pendingOrders.length})</p>
      ${pendingOrders.map(order => `
        <div style="font-size: 15px; color: #b91c1c; margin-bottom: 12px; padding-bottom: 10px; border-bottom: 1px dashed #fecaca;">
          <span style="font-weight: 500;">Order #${order.order_number}</span>
          <span style="float: right; font-weight: 700;">₱${order.total_price.toFixed(2)}</span>
          <div style="clear: both;"></div>
        </div>
      `).join("")}
    </div>
  ` : "";

  const contentHtml = `
    <h2 style="color: #111827; font-size: 20px; font-weight: 600; margin-top: 0; margin-bottom: 16px;">${title}</h2>
    <p style="margin:0 0 20px 0;">
      ${isReady
      ? `Great news! All payments for the session dated <strong>${date}</strong> have been confirmed and the accounts are balanced.`
      : `Hi! Don't forget you still need to mark the day as reconciled for <strong>${date}</strong>. ${pendingOrders.length > 0 ? `There are <strong>${pendingOrders.length}</strong> payments awaiting your verification below. once you have confirmed all orders, you can finalize the session directly by clicking the button.` : "Please ensure your audits are complete before closing."}`
    }
    </p>
    ${ordersListHtml}
    <div style="margin-top: 24px;">
      <a href="${actionUrl}" style="display: inline-block; background-color: ${statusColor}; color: #ffffff; text-decoration: none; padding: 12px 20px; border-radius: 8px; font-weight: 600; font-size: 15px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);">${buttonText}</a>
    </div>
  `;

  return sendEmail(
    adminEmail,
    `${isReady ? "✅ Ready to Reconcile" : "⏳ Reminder"}: Session ${date}`,
    buildEmailLayout("Management Alert", contentHtml),
    "reconciliation_reminder"
  );
}

export async function sendUnconfirmedOrderAlert(date: string, pendingOrders: { order_number: string; total_price: number }[]) {
  const adminEmail = (await getSetting<string>("admin_email")) || "roniversonroguel.startuplab@gmail.com";

  const ordersListHtml = pendingOrders.map(order => `
    <div style="background-color: #fef2f2; border: 1px solid #fee2e2; padding: 12px 16px; border-radius: 8px; margin-bottom: 12px;">
      <p style="margin: 0; color: #991b1b; font-weight: 600;">Pending Order: #${order.order_number}</p>
      <p style="margin: 4px 0 0 0; color: #b91c1c;">Amount: ₱${order.total_price.toFixed(2)}</p>
    </div>
  `).join("");

  const contentHtml = `
    <h2 style="color: #111827; font-size: 20px; font-weight: 600; margin-top: 0; margin-bottom: 16px;">Action Required: Unconfirmed Orders</h2>
    <p style="margin:0 0 16px 0;">The session for <strong>${date}</strong> still has <strong>${pendingOrders.length}</strong> unconfirmed orders that require attention.</p>
    ${ordersListHtml}
    <p style="margin:20px 0 0 0; font-size: 14px;">Please log in to the dashboard to verify these payments and reconcile the day.</p>
  `;

  return sendEmail(
    adminEmail,
    `🚨 Alert: ${pendingOrders.length} Unconfirmed Orders - ${date}`,
    buildEmailLayout("Unconfirmed Payments", contentHtml),
    "unconfirmed_alert"
  );
}

export async function sendReconciliationSuccess(date: string, totalOrders: number, totalAmount: number) {
  const adminEmail = (await getSetting<string>("admin_email")) || "roniversonroguel.startuplab@gmail.com";

  const contentHtml = `
    <h2 style="color: #111827; font-size: 20px; font-weight: 600; margin-top: 0; margin-bottom: 16px;">Reconciliation Successful</h2>
    <p style="margin:0 0 16px 0;">The session for <strong>${date}</strong> has been successfully reconciled and closed.</p>
    <div style="background-color: #ecfdf5; border: 1px solid #d1fae5; padding: 16px; border-radius: 8px; margin-bottom: 20px;">
      <p style="margin: 0; color: #065f46;"><strong>Total Orders:</strong> ${totalOrders}</p>
      <p style="margin: 4px 0 0 0; color: #065f46;"><strong>Total Revenue:</strong> ₱${totalAmount.toFixed(2)}</p>
    </div>
    <p style="margin:0;">All records are now finalized in the financial history.</p>
  `;

  return sendEmail(
    adminEmail,
    `✅ Reconciliation Success: ${date}`,
    buildEmailLayout("Reconciliation Complete", contentHtml),
    "reconciliation_success"
  );
}

export async function processAdminPasswordRecovery(emailAttempt: string) {
  // 1. Init master admin client to bypass RLS and forcefully reset the password
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!serviceRoleKey || !supabaseUrl) return { success: false, reason: "no_admin_keys" };

  const supabaseAdmin = createSupabaseAdmin(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  // 2. See if the email actually exists
  const { data: { users }, error } = await supabaseAdmin.auth.admin.listUsers();
  if (error) return { success: false, reason: "db_error" };

  const targetUser = users.find(u => u.email === emailAttempt);
  if (!targetUser) return { success: false, reason: "not_found" };

  // 3. Generate a Highly Secure Temporary Password (prefix + 8 random digits + symbol)
  const tempPassword = "Zencafe" + Math.floor(10000000 + Math.random() * 90000000) + "!";

  // 4. Force Update the User's Supabase Auth layer
  const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(targetUser.id, {
    password: tempPassword,
  });

  if (updateError) return { success: false, reason: "update_failed" };

  // 5. Securely dispatch the active key to the requested owner email
  const targetEmail = "robimikemanalo.ih@gmail.com";

  return sendEmail(
    targetEmail,
    `🚨 Admin Password Reset Request`,
    buildEmailLayout("Password Reset", `<h2 style="color: #111827; font-size: 20px; font-weight: 600; margin-top: 0; margin-bottom: 16px;">Master Admin Password Reset Request</h2><p style="margin:0 0 12px 0;">An authorized temporary password reset has been triggered for the Admin Dashboard.</p><p style="margin:0 0 8px 0;"><strong>Account Email:</strong> ${emailAttempt}</p><p style="margin:0 0 16px 0;"><strong>New Temporary Password:</strong> <span style="font-family: monospace; background: #f3f4f6; padding: 4px 8px; border-radius: 4px; border: 1px solid #e5e7eb; font-weight: bold; color: #d97706;">${tempPassword}</span></p><p style="margin:0;">You can use this immediately to log in. Please securely update/change it in the User Management tab as soon as you log in.</p>`),
    "forgot_password"
  );
}

