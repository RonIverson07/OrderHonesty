import { NextRequest, NextResponse } from "next/server";
import { verifyHitPayHmac, mapHitPayStatus } from "@/lib/payments/hitpay";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const payload: Record<string, string> = {};
    formData.forEach((value, key) => {
      payload[key] = value.toString();
    });

    // --- Security: HMAC verification ---
    if (!verifyHitPayHmac(payload)) {
      console.error("[HitPay Webhook] HMAC verification failed");
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    const paymentRequestId = payload.payment_request_id;
    const paymentStatus = mapHitPayStatus(payload.status);
    const paymentAmount = parseFloat(payload.amount || "0");

    if (!paymentRequestId) {
      return NextResponse.json({ error: "Missing payment_request_id" }, { status: 400 });
    }

    const supabase = await createClient();

    // --- Idempotency: check if already processed ---
    const { data: existingOrder } = await supabase
      .from("orders")
      .select("id, payment_status")
      .eq("payment_reference", paymentRequestId)
      .single();

    if (!existingOrder) {
      console.error("[HitPay Webhook] No order found for reference:", paymentRequestId);
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    // Skip if already in terminal state (paid/failed/expired)
    if (["paid", "failed", "expired"].includes(existingOrder.payment_status)) {
      return NextResponse.json({ status: "already_processed" }, { status: 200 });
    }

    // --- Update order based on payment status ---
    const updateData: Record<string, unknown> = {
      payment_status: paymentStatus,
      payment_amount: paymentAmount,
    };

    if (paymentStatus === "paid") {
      // Payment consistency: auto-confirm if paid
      updateData.payment_confirmed = true;
      updateData.payment_proof_status = "confirmed";
      updateData.confirmed_at = new Date().toISOString();
    } else if (paymentStatus === "failed") {
      updateData.payment_confirmed = false;
    }

    const { error: updateError } = await supabase
      .from("orders")
      .update(updateData)
      .eq("id", existingOrder.id);

    if (updateError) {
      console.error("[HitPay Webhook] Update error:", updateError);
      return NextResponse.json({ error: "Failed to update order" }, { status: 500 });
    }

    return NextResponse.json({ status: "ok" }, { status: 200 });
  } catch (err) {
    console.error("[HitPay Webhook]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
