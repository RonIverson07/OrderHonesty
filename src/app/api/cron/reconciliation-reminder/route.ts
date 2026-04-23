import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendReconciliationReminder } from "@/lib/domain/notifications";

/**
 * Cron endpoint to trigger reconciliation reminders.
 * Delegating scheduling responsibility to external cron service.
 */
export async function GET(req: Request) {
  // Basic security check: verify CRON_SECRET if provided in env
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    console.warn("[Cron] Unauthorized access attempt");
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const supabase = await createClient();
    const now = new Date();
    
    // Setup Manila Date string for the email
    const dateStr = now.toLocaleDateString("en-US", { 
      month: "long", 
      day: "numeric", 
      year: "numeric",
      timeZone: "Asia/Manila"
    });

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    // 1. Double-Check Guard: Don't send if already reconciled in database
    const { data: existingReconciliation } = await supabase
      .from("reconciliations")
      .select("id")
      .gte("reconciled_date", startOfDay.toISOString())
      .lte("reconciled_date", endOfDay.toISOString())
      .maybeSingle();

    if (existingReconciliation) {
      return NextResponse.json({ 
        success: true, 
        message: "Day is already reconciled. No reminder needed." 
      });
    }

    // 2. Fetch today's orders to see status
    const { data: unconfirmed } = await supabase
      .from("orders")
      .select("order_number, total_price")
      .gte("created_at", startOfDay.toISOString())
      .lte("created_at", endOfDay.toISOString())
      .eq("payment_confirmed", false);

    const { data: totalOrders } = await supabase
      .from("orders")
      .select("id")
      .gte("created_at", startOfDay.toISOString())
      .lte("created_at", endOfDay.toISOString());

    // 3. Determine if everything is balanced
    const isReady = (totalOrders?.length ?? 0) > 0 && (!unconfirmed || unconfirmed.length === 0);
    
    // 4. Send the notification (Throttling inside will still handle the 1-per-day rule)
    const result = await sendReconciliationReminder(dateStr, isReady, unconfirmed || []);
    
    return NextResponse.json({ 
      success: true, 
      triggered: result.success,
      status: isReady ? "Balanced" : "Action Required",
      message: result.success ? "Reminder sent" : (result.reason || result.error || "Execution skipped")
    });

  } catch (error: any) {
    console.error("[Cron Error]", error);
    return NextResponse.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
}
