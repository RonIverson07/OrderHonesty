/**
 * HitPay Payment Integration
 * 
 * Handles payment request creation and webhook verification.
 * Docs: https://hit-pay.com/docs
 */

import crypto from "crypto";

const HITPAY_API_URL = process.env.HITPAY_API_URL || "https://api.hit-pay.com/v1";
const HITPAY_API_KEY = process.env.HITPAY_API_KEY || "";
const HITPAY_SALT = process.env.HITPAY_SALT || "";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

// ---- Types ----

export interface HitPayCreateRequest {
  orderId: string;
  amount: number;
  currency?: string;
  email?: string;
  name?: string;
  purpose?: string;
  redirectUrl?: string;
  webhookUrl?: string;
}

export interface HitPayCreateResponse {
  id: string;
  url: string;
  status: string;
}

export interface HitPayWebhookPayload {
  payment_id: string;
  payment_request_id: string;
  status: string;
  reference_number: string;
  amount: string;
  currency: string;
  hmac: string;
  [key: string]: string;
}

// ---- Create Payment Request ----

export async function createHitPayRequest(
  params: HitPayCreateRequest
): Promise<{ success: boolean; data?: HitPayCreateResponse; error?: string }> {
  if (!HITPAY_API_KEY) {
    return { success: false, error: "HitPay API key not configured" };
  }

  try {
    const body = {
      amount: params.amount.toFixed(2),
      currency: params.currency || "PHP",
      email: params.email || undefined,
      name: params.name || undefined,
      purpose: params.purpose || `Cafe Order ${params.orderId}`,
      reference_number: params.orderId,
      redirect_url: params.redirectUrl || `${APP_URL}/order/success`,
      webhook: params.webhookUrl || `${APP_URL}/api/payments/hitpay/webhook`,
    };

    const response = await fetch(`${HITPAY_API_URL}/payment-requests`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-BUSINESS-API-KEY": HITPAY_API_KEY,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { success: false, error: `HitPay API error: ${response.status} ${errorText}` };
    }

    const data = await response.json();
    return {
      success: true,
      data: { id: data.id, url: data.url, status: data.status },
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "HitPay request failed" };
  }
}

// ---- Verify Webhook HMAC ----

export function verifyHitPayHmac(payload: Record<string, string>): boolean {
  if (!HITPAY_SALT) return false;

  const receivedHmac = payload.hmac;
  if (!receivedHmac) return false;

  // Build the HMAC string: sort keys, exclude 'hmac', concatenate values
  const sortedKeys = Object.keys(payload)
    .filter((k) => k !== "hmac")
    .sort();

  const message = sortedKeys.map((k) => payload[k]).join("");

  const computedHmac = crypto
    .createHmac("sha256", HITPAY_SALT)
    .update(message)
    .digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(computedHmac, "hex"),
    Buffer.from(receivedHmac, "hex")
  );
}

// ---- Map HitPay status to our status ----

export function mapHitPayStatus(hitpayStatus: string): "paid" | "failed" | "pending" {
  switch (hitpayStatus) {
    case "completed":
      return "paid";
    case "failed":
    case "expired":
      return "failed";
    default:
      return "pending";
  }
}
