import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";

function base64UrlEncode(input: string): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function signEmailActionToken(payload: { orderId: string; action: "confirm" | "flag"; exp: number }): string {
  const secret = process.env.EMAIL_ACTION_SECRET;
  if (!secret) {
    throw new Error("Missing EMAIL_ACTION_SECRET configuration");
  }

  const body = base64UrlEncode(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", secret).update(body).digest("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  return `${body}.${sig}`;
}

function buildUrl(orderId: string, action: "confirm" | "flag"): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) throw new Error("Missing NEXT_PUBLIC_APP_URL configuration");

  const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7;
  const token = signEmailActionToken({ orderId, action, exp });
  return `${appUrl.replace(/\/+$/g, "")}/api/email/order-action/${action}?token=${encodeURIComponent(token)}`;
}

export async function GET(request: NextRequest) {
  try {
    const orderId = request.nextUrl.searchParams.get("orderId");
    if (!orderId) {
      return NextResponse.json({ success: false, error: "Missing orderId" }, { status: 400 });
    }

    const confirmUrl = buildUrl(orderId, "confirm");
    const flagUrl = buildUrl(orderId, "flag");

    return NextResponse.json({ success: true, orderId, confirmUrl, flagUrl });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err?.message || "Unexpected error" }, { status: 500 });
  }
}
