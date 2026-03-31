import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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

function verifyToken(token: string): { orderId: string; action: "confirm" | "flag"; exp: number } {
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
  if (!payload?.orderId || !payload?.action || !payload?.exp) throw new Error("Invalid token payload");
  if (payload.action !== "confirm" && payload.action !== "flag") throw new Error("Invalid token action");

  const now = Math.floor(Date.now() / 1000);
  if (now > payload.exp) throw new Error("Token expired");

  return payload;
}

function renderHtml(title: string, message: string) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /></head><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f9fafb;margin:0;padding:24px;"><div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #f3f4f6;border-radius:12px;overflow:hidden;"><div style="background:#d97706;padding:18px 22px;color:#fff;font-weight:700;">Lebrew</div><div style="padding:22px;"><h2 style="margin:0 0 10px 0;color:#111827;font-size:18px;">${title}</h2><p style="margin:0;color:#374151;line-height:1.5;">${message}</p></div></div></body></html>`;
}

export async function GET(request: NextRequest) {
  try {
    const token = request.nextUrl.searchParams.get("token");
    if (!token) {
      return new NextResponse(renderHtml("Missing Token", "This action link is missing its token."), {
        status: 400,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    let payload: { orderId: string; action: "confirm" | "flag"; exp: number };
    try {
      payload = verifyToken(token);
    } catch (e: any) {
      return new NextResponse(renderHtml("Invalid Link", e?.message || "Invalid token"), {
        status: 400,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
    if (payload.action !== "confirm") {
      return new NextResponse(renderHtml("Invalid Action", "This link is not a confirm link."), {
        status: 400,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseUrl.startsWith("http") || !serviceRoleKey) {
      return new NextResponse(
        renderHtml(
          "Server Not Configured",
          "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in your environment."
        ),
        { status: 500, headers: { "Content-Type": "text/html; charset=utf-8" } }
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { error } = await supabaseAdmin
      .from("orders")
      .update({
        payment_proof_status: "confirmed",
        payment_confirmed: true,
      })
      .eq("id", payload.orderId);

    if (error) {
      return new NextResponse(renderHtml("Update Failed", error.message), {
        status: 500,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    return new NextResponse(
      renderHtml("Order Confirmed", "Confirmation saved. You can now return to the Reconciliation screen."),
      { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  } catch (err: any) {
    return new NextResponse(renderHtml("Action Failed", err?.message || "Unexpected error"), {
      status: 500,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
}
