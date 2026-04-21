import { NextResponse } from "next/server";
import { getSetting } from "@/lib/domain/settings";
import { sendReconciliationReminder } from "@/lib/domain/notifications";

/**
 * Cron endpoint to trigger reconciliation reminders.
 * This should be called by a cron service (e.g., Vercel Cron, GitHub Actions)
 * every hour or every 30 minutes.
 * 
 * The function checks if the current hour matches the configured 
 * reconciliation_reminder_time setting and sends the email if so.
 * Throttling logic in sendReconciliationReminder ensures it's only sent once per day.
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
    const configuredTime = await getSetting<string>("reconciliation_reminder_time");
    
    if (!configuredTime) {
      return NextResponse.json({ 
        success: false, 
        message: "reconciliation_reminder_time is not configured in settings" 
      });
    }

    // Get current time in Philippine Time (GMT+8)
    const now = new Date();
    const manilaTimeStr = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Manila",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(now);

    // Compare times: If current time is AT or AFTER the configured time, attempt to send.
    // The 24h throttling in sendReconciliationReminder ensures it only sends once per day.
    const [currentHour, currentMin] = manilaTimeStr.split(":");
    const [configuredHour, configuredMin] = configuredTime.split(":");
    
    const currentTotalMinutes = parseInt(currentHour) * 60 + parseInt(currentMin);
    const configuredTotalMinutes = parseInt(configuredHour) * 60 + parseInt(configuredMin);

    if (currentTotalMinutes >= configuredTotalMinutes) {
      const dateStr = now.toLocaleDateString("en-US", { 
        month: "long", 
        day: "numeric", 
        year: "numeric",
        timeZone: "Asia/Manila"
      });
      
      console.log(`[Cron] Triggering reconciliation reminder for ${dateStr} (Current: ${manilaTimeStr}, Configured: ${configuredTime})`);
      
      const result = await sendReconciliationReminder(dateStr);
      
      return NextResponse.json({ 
        success: true, 
        triggered: result.success, 
        result 
      });
    }

    return NextResponse.json({ 
      success: true, 
      triggered: false, 
      message: `Time not yet reached. Current: ${manilaTimeStr}, Configured: ${configuredTime}`,
      currentTime: manilaTimeStr,
      configuredTime: configuredTime
    });
  } catch (error: any) {
    console.error("[Cron Error]", error);
    return NextResponse.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
}
