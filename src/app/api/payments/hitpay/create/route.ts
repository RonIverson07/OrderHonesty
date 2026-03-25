import { NextRequest, NextResponse } from "next/server";
import { createHitPayRequest } from "@/lib/payments/hitpay";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { orderId, amount, email, name } = body;

    if (!orderId || !amount) {
      return NextResponse.json({ error: "orderId and amount are required" }, { status: 400 });
    }

    // Create HitPay payment request
    const result = await createHitPayRequest({
      orderId,
      amount: parseFloat(amount),
      email,
      name,
    });

    if (!result.success || !result.data) {
      return NextResponse.json({ error: result.error || "Failed to create payment" }, { status: 500 });
    }

    // Update order with payment reference
    const supabase = await createClient();
    const { error } = await supabase
      .from("orders")
      .update({
        payment_provider: "hitpay",
        payment_status: "pending",
        payment_reference: result.data.id,
      })
      .eq("id", orderId);

    if (error) {
      console.error("[HitPay Create] DB update error:", error);
    }

    return NextResponse.json({
      paymentUrl: result.data.url,
      paymentId: result.data.id,
    });
  } catch (err) {
    console.error("[HitPay Create]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
