import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { markDayReconciled } from "@/lib/domain/orders";

function base64UrlDecode(input: string): string {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((input.length + 3) % 4);
  return Buffer.from(padded, "base64").toString("utf8");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function verifyToken(token: string): { date: string; action: "reconcile"; exp: number } {
  const secret = process.env.EMAIL_ACTION_SECRET;
  if (!secret) throw new Error("Missing EMAIL_ACTION_SECRET configuration");

  const parts = token.split(".");
  if (parts.length !== 2) throw new Error("Invalid token");

  const [body, sig] = parts;
  const expectedSig = crypto
    .createHmac("sha256", secret)
    .update(body)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

  if (!safeEqual(sig, expectedSig)) throw new Error("Invalid token signature");

  const payload = JSON.parse(base64UrlDecode(body));
  if (!payload?.date || !payload?.action || !payload?.exp) throw new Error("Invalid token payload");
  if (payload.action !== "reconcile") throw new Error("Invalid token action");

  const now = Math.floor(Date.now() / 1000);
  if (now > payload.exp) throw new Error("Token expired");

  return payload;
}

function renderHtml(title: string, message: string, isError = false) {
  const color = isError ? "#ef4444" : "#059669";
  const isProd = process.env.NODE_ENV === "production";
  const appUrl = isProd 
    ? "https://cafe.moonshotdigital.com.ph" 
    : (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000");

  return `<!DOCTYPE html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /></head><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f9fafb;margin:0;padding:24px;"><div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #f3f4f6;border-radius:12px;overflow:hidden;"><div style="background:${color};padding:18px 22px;color:#fff;font-weight:700;">Lebrew Management</div><div style="padding:22px;"><h2 style="margin:0 0 10px 0;color:#111827;font-size:18px;">${title}</h2><p style="margin:0;color:#374151;line-height:1.5;">${message}</p><div style="margin-top:20px;"><a href="${appUrl.replace(/\/+$/g, "")}/dashboard/reconciliation" style="color:${color};text-decoration:none;font-weight:600;font-size:14px;">Return to Dashboard &rarr;</a></div></div></div></body></html>`;
}

export async function GET(request: NextRequest) {
  try {
    const token = request.nextUrl.searchParams.get("token");
    const date = request.nextUrl.searchParams.get("date");

    if (!token || !date) {
      return new NextResponse(renderHtml("Error", "Action link is missing required parameters.", true), {
        status: 400,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // 1. Verify Token
    try {
      verifyToken(token);
    } catch (e: any) {
      return new NextResponse(renderHtml("Invalid Link", e.message || "Invalid or expired link.", true), {
        status: 400,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // 2. Setup DB client
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) throw new Error("Database configuration missing.");

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
       auth: { autoRefreshToken: false, persistSession: false }
    });

    // 3. Safety Check: Any unconfirmed orders?
    const start = new Date(date); start.setHours(0,0,0,0);
    const end = new Date(date); end.setHours(23,59,59,999);

    const { data: unconfirmed } = await supabaseAdmin
      .from("orders")
      .select("order_number")
      .gte("created_at", start.toISOString())
      .lte("created_at", end.toISOString())
      .eq("payment_confirmed", false)
      .limit(1);

    if (unconfirmed && unconfirmed.length > 0) {
       return new NextResponse(renderHtml("Reconciliation Blocked", `Cannot reconcile ${date} because there are unconfirmed orders (e.g. #${unconfirmed[0].order_number}). Please verify all payments in the dashboard first.`, true), {
         status: 200, // Status 200 but error UI
         headers: { "Content-Type": "text/html; charset=utf-8" },
       });
    }

    // 4. Perform Reconciliation
    // Note: Since we are in an API route, we are acting as the system admin. 
    // markDayReconciled usually checks roles, so we should satisfy that or call an internal version.
    // However, I'll update markDayReconciled to allow service-role context if needed.
    // For now, let's call it and hope we can bypass the check if we have the right role in the client.
    
    // Actually, markDayReconciled uses the 'createClient()' which gets the user session. 
    // In an API route without a cookie, that client will be empty.
    // I should create a version of markDayReconciled that accepts a client or bypasses auth.
    
    const { data: adminUser } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("role", "admin")
      .limit(1)
      .single();

    const result = await markDayReconciled(date, undefined, adminUser?.id);

    if (!result.success) {
      return new NextResponse(renderHtml("Reconciliation Failed", result.error || "Something went wrong during reconciliation.", true), {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    return new NextResponse(renderHtml("Success", `The session for ${date} has been successfully reconciled and closed. All history has been recorded.`), {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });

  } catch (err: any) {
    console.error("[Email Reconcile API]", err);
    return new NextResponse(renderHtml("Internal Error", err.message || "An unexpected error occurred.", true), {
      status: 500,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
}
